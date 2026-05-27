import { WebUsbDirection } from '@/webusb/deviceParameters';
import { WebUsbManagerMode } from '@/webusb/webUsbManager';
import { StreamMeter } from '@/telemetry/streamMeter';
import { DefaultDeviceConfiguration } from '@/webusb/deviceParameters';
import { WebUsbDeviceControlBase, WebUsbDeviceControlBaseInitialParams } from '@/webusb/webUsbDeviceControlBase';
import type { WebUsbDeviceControlBaseParams } from '@/webusb/webUsbDeviceControlBase';
import type { RXBuffer, RXDecoderOptions, TXResult } from '@/webusb/webUsbBase';
import { DataType } from '@websdr/core/common';
import { DataSlicer } from '@websdr/core/utils';


export class WebUsbSourceSink extends WebUsbDeviceControlBase {
    static MAX_IN_STREAM = 256;//128;
    protected _dataSlicer: DataSlicer = new DataSlicer();
    protected _in_stream = 0;
    protected _max_in_stream = 0;
    protected _stream_started = false;
    protected _onData: (buf: SharedArrayBuffer, overrun: number, timestamp: bigint) => void;
    protected _onReceiveData: (data: RXBuffer) => Promise<void>;
    protected _onReceiveError: (err: any) => void;
    protected _onTransmitData: (res: TXResult) => void;
    protected _onTransmitError: (err: any) => void;
    protected _debugTimer: string | number | NodeJS.Timeout | undefined = undefined;
    protected _discard_timestamp: boolean = false;
    protected _firstTimestamp: bigint | undefined = undefined;
    protected _streamMeterData: StreamMeter | undefined = undefined;
    protected _streamingPacketSize: number = 0;
    protected _warmupCounter = 0;

    constructor(params: WebUsbSourceSinkParams = WebUsbSourceSinkInitialParams) {
        super({ ...params, mode: WebUsbManagerMode.SINGLE }, DefaultDeviceConfiguration);
        this._streamMeterData = params.streamMeterData;
        this._onData = params.onData !== undefined ? params.onData : WebUsbSourceSinkInitialParams.onData!;
        this._onReceiveData = this.onReceiveData.bind(this);
        this._onReceiveError = this.onReceiveError.bind(this);
        this._onTransmitData = this.onTransmitData.bind(this);
        this._onTransmitError = this.onTransmitError.bind(this);
        this.resetStreamMeter();
        this._dataSlicer = new DataSlicer({ datatype: DataType.ci16, bufferSamplesSize: this.packet_size, buffersCount: WebUsbSourceSink.MAX_IN_STREAM << 1 })
    }

    get rx_frequency() {
        return this.rx.frequency;
    }

    set rx_frequency(value: number) {
        this.setRxFrequency(value);
    }

    get tx_frequency() {
        return this.tx.frequency;
    }

    set tx_frequency(value: number) {
        this.setTxFrequency(value);
    }

    get rx_bandwidth() {
        return this.rx.bandwidth;
    }

    set rx_bandwidth(value: number) {
        this.setRxBandwidth(value);
    }

    get tx_bandwidth() {
        return this.tx.bandwidth;
    }

    set tx_bandwidth(value: number) {
        this.setTxBandwidth(value);
    }

    get rx_gain() {
        return this.rx.gain;
    }

    set rx_gain(value: number) {
        this.setRxGain(value);
    }

    get tx_gain() {
        return this.tx.gain;
    }

    set tx_gain(value: number) {
        this.setTxGain(value);
    }

    resetStreamMeter() {
        this._streamMeterData?.reset();
    }

    async open(fd: number) {
        await this.openDevice(fd);
        this._streamMeterData?.up();
    }

    close() {
        void this.closeDevice();
        this._streamMeterData?.down();
    }

    async start() {
        const { packetSize } = await this.prepareDeviceStreaming();
        this._streamingPacketSize = packetSize;
    }

    async stop() {
        this.stopStream();
    }

    async startStream() {
        if (this._stream_started) return;
        this._stream_started = true;
        this._in_stream = 0;
        this._warmupCounter = this.configuration.warmupPackets;
        this._firstTimestamp = undefined;
        this._max_in_stream = WebUsbSourceSink.MAX_IN_STREAM;
        // console.log(`START STREAMING AT ${Date.now()}`)

        // await this.sendControlCommand('CALIBRATE', { param: 15 });
        await this.startDataPoll();
        this.schedulePreparedDeviceStreamingStart(1000);
        // this._debugTimer = setInterval(() => {this.sendControlCommand('DEBUG_DUMP')}, 10)
    }

    async stopStream() {
        if (!this._stream_started) return;
        this._stream_started = false;
        clearInterval(this._debugTimer);
        this._debugTimer = undefined;
        this._in_stream = 0;
        this._max_in_stream = 0;
        await this.stopDeviceStreaming();
    }

    async startDataPoll() {
        if (!this.hasOpenDevice || !this._stream_started) {
            console.error('startDataPoll: fd', this.fd, 'stream_started', this._stream_started)
            return;
        }
        const opts: RXDecoderOptions = { datatype: DataType.ci16 };
        while (this._in_stream < this._max_in_stream) {
            this.submitDeviceRxPacket(this._streamingPacketSize, opts)
                .then(this._onReceiveData)
                .catch(this._onReceiveError)
            ++this._in_stream;
        }
    }

    async sendData(buf: SharedArrayBuffer, offset: number, byteLength: number, datatype: DataType, timestamp?: bigint, sliceSamples?: number) {
        this.ensureDirection(WebUsbDirection.TX, 'TX data');
        // console.log('sendData', timestamp)
        return this.sendDeviceTxPacket(
            {
                data: buf,
                byteOffset: offset,
                byteLength: byteLength,
                datatype: datatype,
                discard_timestamp: this._discard_timestamp,
                timestamp: (timestamp || BigInt(0n)) - BigInt(this.configuration.txRxDelay) + (this._firstTimestamp || BigInt(0))
            },
            { sliceSamples: sliceSamples })
            .then(this._onTransmitData)
            .catch(this._onTransmitError)
    }

    async onReceiveData(data: RXBuffer) {
        if (this._warmupCounter > 0) {
            --this._warmupCounter;
            if (this._in_stream > 0) --this._in_stream;
            if (this._stream_started) this.startDataPoll();
            return;
        }
        if (this._firstTimestamp === undefined) {
            console.warn('Starting accepting messages...')
            this._firstTimestamp = data.timestamp;
        }
        // console.log('RECEIVED DATA', data)
        if (this._streamMeterData) {
            this._streamMeterData.downloaded += data.recvsize;
            this._streamMeterData.overrun += data.overrun;
            this._streamMeterData.realigned = data.realigned;
            this._streamMeterData.dropped = data.dropped;
        }
        this._dataSlicer.pushBack(data.data, 0, undefined, data.overrun, data.timestamp - this._firstTimestamp/* this._timestamp */);
        while (this._dataSlicer.size() > 0) {
            const dataItem = this._dataSlicer.front();
            if (this._onData && dataItem) this._onData(dataItem.buffer, dataItem.overrun, dataItem.timestamp);
            this._dataSlicer.pop_front();
        }
        if (this._in_stream > 0) --this._in_stream;
        if (this._stream_started) this.startDataPoll();
    }

    async onReceiveError(err: any) {
        if (this._in_stream > 0) --this._in_stream;
        if (this._stream_started) {
            console.error('WebUsbSourceSink.receiveData error:', err)
            this.startDataPoll();
        }
    }

    onTransmitData(res: TXResult) {
        if (res !== undefined && res.usbOutTransferResult !== undefined
            && res.usbOutTransferResult.status === 'ok' && res.usbOutTransferResult.bytesWritten !== undefined) {
            if (this._streamMeterData) this._streamMeterData.uploaded += res.usbOutTransferResult.bytesWritten;
        }
    }

    onTransmitError(err: any) {
        if (this._stream_started) {
            // console.error('WebUsbSourceSink.sendData error:', err)
            if (this._streamMeterData) ++this._streamMeterData.errors;
        }
    }
}

export interface WebUsbSourceSinkParams extends WebUsbDeviceControlBaseParams {
    streamMeterData?: StreamMeter;
    onData?: (buf: SharedArrayBuffer, overrun: number, timestamp: bigint) => void;
}

export const WebUsbSourceSinkInitialParams: WebUsbSourceSinkParams = {
    ...WebUsbDeviceControlBaseInitialParams,
    streamMeterData: undefined,
    onData: () => { },
}
