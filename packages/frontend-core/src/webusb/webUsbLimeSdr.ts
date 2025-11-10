import { WebUsb, DeviceStreamType } from './webUsbBase';
import type {
    WebUsbParams, RXDecoderOptions, RXBuffer, DeviceConfiguration, TXBuffer, TXEncoderOptions
} from './webUsbBase';
import {
    DataType, COMPLEX_FLOAT_SIZE, COMPLEX_INT16_SIZE
} from '@websdr/core/common';


const debug_usb_log = false;

export class WebUsbLimeSdr extends WebUsb {
    static PACKET_SIZE = 4096;
    static HEADER_SIZE = 16;
    static SAMPLES_PER_PACKET = ((WebUsbLimeSdr.PACKET_SIZE - WebUsbLimeSdr.HEADER_SIZE) / COMPLEX_INT16_SIZE);
    static ELEMENTS_PER_PACKET = WebUsbLimeSdr.SAMPLES_PER_PACKET << 1;
    static SAMPLES_MULTIPLY = 4;

    protected _lastRecvTimestamp = 0n;

    constructor(parms: WebUsbParams) {
        super(parms)
        if (globalThis.debug_mode || debug_usb_log) console.log('Created WebUsbLimeSdr')
    }

    getConfiguration(): DeviceConfiguration {
        return {
            defaultSamplesCount: WebUsbLimeSdr.SAMPLES_PER_PACKET * 8,
            rxFrequencyRange: { min: 30e6, max: 3800e6 },
            txFrequencyRange: { min: 30e6, max: 3800e6 },
            bandwidthRange: { min: 500e3, max: 40e6 },
            rateRange: { min: 192e3, max: 40e6 },
            streamTypes: { [DeviceStreamType.raw]: { dataTypes: [DataType.ci16] } },
            txRxDelay: 94,
            warmupPackets: 500,
        };
    }

    getRXSamplesCount(samples: number): number {
        // Each packet contains 16 bytes header and 1020 iq samples
        return Math.floor(samples / WebUsbLimeSdr.SAMPLES_PER_PACKET) * WebUsbLimeSdr.SAMPLES_PER_PACKET;
    }

    getRXPacketSize(samples: number): number {
        // Each packet contains 16 bytes header and 1020 iq samples
        return Math.ceil(samples / WebUsbLimeSdr.SAMPLES_PER_PACKET) * WebUsbLimeSdr.PACKET_SIZE;
    }

    getTXPacketSize(samples: number): number {
        // Each packet contains 16 bytes header and 1020 iq samples
        const lastPktFill = samples % WebUsbLimeSdr.SAMPLES_PER_PACKET;
        return Math.floor(samples / WebUsbLimeSdr.SAMPLES_PER_PACKET) * WebUsbLimeSdr.PACKET_SIZE
            + (lastPktFill > 0 ? WebUsbLimeSdr.HEADER_SIZE + lastPktFill * COMPLEX_INT16_SIZE : 0);
    }

    protected _fillHeader(buf: ArrayBufferLike, offset: number, discard_timestamp: boolean, timestamp: bigint, samples: number) {
        const discard_timestamp_flag = discard_timestamp ? 1 : 0;
        /*
        16 bytes packet header

        DB0: [4]    discard_timestamp_flag
        DB1: [7:0]  samples_size_bytes[7:0]
        DB2: [15:8] samples_size_bytes[15:8]
        DB3: 00
        DB1: 00000000
        DW2: [31:0] timestamp[31:0]
        DW3: [31:0] timestamp[64:32]

        DW4-N IQ 16 bit
        */
        const bufLen = (buf as ArrayBufferLike).byteLength || 0;
        if (bufLen - offset < WebUsbLimeSdr.HEADER_SIZE)
            throw new Error(`WebUsbLimeSdr.fillHeader: Error: buffer slice must be at least ${WebUsbLimeSdr.HEADER_SIZE} bytes (offset ${offset})`);

        if (samples % 4 !== 0)
            throw new Error(`WebUsbLimeSdr.fillHeader: Error: count of samples must be a multiple of 4`)
        // if (samples < WebUsbLimeSdr.MIN_SAMPLES_IN_PKT || samples > WebUsbLimeSdr.MAX_SAMPLES_IN_PKT)
        //     throw new Error(`WebUsbLimeSdr.fillHeader: Error: count of samples in the packet must be in range [${WebUsbLimeSdr.MIN_SAMPLES_IN_PKT}, ${WebUsbLimeSdr.MAX_SAMPLES_IN_PKT}]`)

        const dataView = new DataView(buf, offset, WebUsbLimeSdr.HEADER_SIZE);
        dataView.setUint8(0, discard_timestamp_flag << 4);
        dataView.setUint16(1, samples * COMPLEX_INT16_SIZE, true);
        dataView.setUint8(3, 0);
        dataView.setUint32(4, 0);
        dataView.setBigUint64(8, timestamp, true);
        // console.log('TX HEADER', dataView.getUint8(0), dataView.getUint16(1, true), dataView.getBigUint64(8, true));
    }

    async decodeRxData(data: DataView, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        if (globalThis.debug_mode || debug_usb_log) console.log('RECEIVED DATA', data)
        const id = opts !== undefined && opts.id !== undefined ? opts.id : -1;
        const packetCnt = (data.byteLength / WebUsbLimeSdr.PACKET_SIZE) >> 0;
        const dataSize = data.byteLength - WebUsbLimeSdr.HEADER_SIZE * packetCnt;
        const samplesRecv = (dataSize / COMPLEX_INT16_SIZE) >> 0;
        // console.log('samplesRecv =', samplesRecv, ', samples =', samples)
        if (samplesRecv < samples) {
            throw new Error(`WebUsbLimeSdr.parseRxData: Unexpected usb packet size (${samplesRecv} received < ${samples} expected)`);
        }
        const timestamp = data.getBigUint64(8, true);
        if (timestamp - this._lastRecvTimestamp > 100000) {
            console.error('VERY BIG DIFFERENCE', data, timestamp, this._lastRecvTimestamp, timestamp - this._lastRecvTimestamp);
        }
        let prevPacketTS = timestamp;
        let overrun = 0;

        const datatype = opts?.datatype || DataType.ci16;
        const elementSize = (datatype === DataType.cf32 || datatype === DataType.f32) ? COMPLEX_FLOAT_SIZE : COMPLEX_INT16_SIZE;
        const output = opts?.data !== undefined ? opts.data : new SharedArrayBuffer(samplesRecv * elementSize);

        let freeSamples = samples;
        for (let i = 0; i < packetCnt; ++i) {
            const outBufOffset = i * WebUsbLimeSdr.SAMPLES_PER_PACKET * elementSize;
            const packetOffset = i * WebUsbLimeSdr.PACKET_SIZE;
            const packetTS = data.getBigUint64(packetOffset + 8, true);
            const samplesDelta = Number(packetTS - prevPacketTS) - WebUsbLimeSdr.SAMPLES_PER_PACKET;
            if (samplesDelta > 0) {
                overrun += (samplesDelta / WebUsbLimeSdr.SAMPLES_PER_PACKET) >> 0;
            }
            prevPacketTS = packetTS;
            const samplesCur = Math.min(WebUsbLimeSdr.SAMPLES_PER_PACKET, freeSamples);
            if (samplesCur > 0) {
                WebUsb.fillData(datatype, output, outBufOffset, DataType.ci16, data.buffer, packetOffset + WebUsbLimeSdr.HEADER_SIZE, samplesCur << 1);
                freeSamples -= samplesCur;
            }
        }

        if (globalThis.debug_mode || debug_usb_log) console.log('RECEIVE timestamp', timestamp - this._lastRecvTimestamp, timestamp, this._lastRecvTimestamp, 'output', output.byteLength);
        const ret: RXBuffer = {
            data: output,
            datatype: datatype,
            id: id,
            samples: samplesRecv,
            timestamp: timestamp,
            overrun: overrun,
            realigned: 0,
            dropped: 0,
            recvsize: data.byteLength,
        }

        this._lastRecvTimestamp = timestamp;

        return ret;
    }

    async encodeTxData(data: TXBuffer, opts?: TXEncoderOptions): Promise<ArrayBufferLike> {
        if (globalThis.debug_mode || debug_usb_log) console.log('DATA TO SEND', data, data.data.slice(0, 10));
        // console.log('SEND TIMESTAMP', data.timestamp, data.byteLength /* , data.data.slice(0, 10), data.data.slice(data.size - 10, data.size) */);
        // const viewin = new Int16Array(data.data, data.byteOffset, data.byteLength);
        // console.log('VIEWIN', viewin.length, viewin);
        let output = undefined;
        const samplesCnt = WebUsb.getSamplesCnt(data.datatype, data.byteLength || data.data.byteLength);
        const bufSize = this.getTXPacketSize(samplesCnt);
        output = opts?.data !== undefined ? opts.data : new ArrayBuffer(bufSize);
        if (output.byteLength < bufSize)
            throw new Error(`WebUsbLimeSdr.encodeTxData: Error: buffer length must be more than ${bufSize} bytes`);

        const pktCnt = Math.ceil(samplesCnt / WebUsbLimeSdr.SAMPLES_PER_PACKET);
        let timestamp = data.timestamp;
        if (!data.discard_timestamp && timestamp < this._lastRecvTimestamp) {
            console.warn('Send timestamp', timestamp, ' less than last received timestamp', this._lastRecvTimestamp);
        }
        const timestampInc = BigInt(WebUsbLimeSdr.SAMPLES_PER_PACKET);
        const dataOffsetMain = data.byteOffset || 0;
        const dataOffsetMult = WebUsbLimeSdr.SAMPLES_PER_PACKET * WebUsb.getSampleByteLength(data.datatype);
        // console.log(`samplesCnt=${samplesCnt}, bufSize=${bufSize}, pktCnt=${pktCnt}`)
        for (let i = 0; i < pktCnt; ++i) {
            const pktOffset = i * WebUsbLimeSdr.PACKET_SIZE;
            const dataOffset = dataOffsetMain + i * dataOffsetMult;
            const samples = i < pktCnt - 1 ? WebUsbLimeSdr.SAMPLES_PER_PACKET : samplesCnt - i * WebUsbLimeSdr.SAMPLES_PER_PACKET;
            this._fillHeader(output, pktOffset, data.discard_timestamp, timestamp, samples);
            WebUsb.fillData(DataType.ci16, output, pktOffset + WebUsbLimeSdr.HEADER_SIZE, data.datatype, data.data, dataOffset, samples << 1);
            timestamp += timestampInc;
        }
        // const view = new Int16Array(output/* , WebUsbLimeSdr.HEADER_SIZE */);
        // console.log('TIMESTAMP', data.timestamp, view.length, view /*, view.subarray(0, 10), view.subarray(view.length - 10, view.length) */);
        return output;
    }

    async open() {
        await super.open();

        if (this.module && this.device) {
            try {
                // if (!this.device.opened) await this.device.close();
                await this.device.open();
                try {
                    await this.device.reset(); //!!! this causes an error in windows 
                } catch (err) {
                    console.warn('Seems you use OS Windows and reset of usb device causes an error: ', err);
                }
                if (this.device.configuration === null) await this.device.selectConfiguration(1);
                await this.device.claimInterface(0);
                await this.device.claimInterface(1);
                const res = await this.module.ccall("init_lib", "number", ["number", "number", "number"],
                    [this.fd, this.device.vendorId, this.device.productId], { async: true }
                );
                if (res < 0) this.device.close();
            } catch (err) {
                console.error(err)
                this.fd = -1;
            }
        }
    }
}
