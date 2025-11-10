import { WebUsb, DeviceStreamType } from './webUsbBase';
import type {
    WebUsbParams, RXDecoderOptions, RXBuffer, DeviceConfiguration, TXBuffer, TXEncoderOptions
} from './webUsbBase';
import {
    DataType, CHUNK_SIZE, COMPLEX_FLOAT_SIZE, COMPLEX_INT16_SIZE
} from '@websdr/core/common';

const debug_usb_log = false;

export abstract class WebUsbWsdr extends WebUsb {
    static MAX_PACKET_SIZE = 0x000fffff;
    static PACKET_ALIGN = 512
    static PACKET_ALIGN_MASK = WebUsbWsdr.PACKET_ALIGN - 1;
    static MAX_PACKET_MASK = WebUsbWsdr.MAX_PACKET_SIZE - WebUsbWsdr.PACKET_ALIGN_MASK;
    static HEADER_SIZE = 16;
    static TRAILER_SIZE = 8;
    static TRAILER_EXTRA_SIZE = 8;
    static EXTRA_RX_DATA = 512 + 2048;
    static MIN_SAMPLES_IN_PKT = 128;
    static MAX_SAMPLES_IN_PKT = 8192;

    protected _timestamp: bigint = 0n;

    constructor(parms: WebUsbParams) {
        super(parms)
    }

    getRXSamplesCount(samples: number): number {
        // any samples count in range [WebUsbWsdr.MIN_SAMPLES_IN_PKT;WebUsbWsdr.MAX_SAMPLES_IN_PKT]
        return samples;
    }

    getRXPacketSize(samples: number): number {
        // Should be rounded up to 512b boundary and less than 1M, also added extra buffer for packet metadata
        return ((samples * COMPLEX_INT16_SIZE + WebUsbWsdr.PACKET_ALIGN_MASK) & WebUsbWsdr.MAX_PACKET_MASK) + WebUsbWsdr.EXTRA_RX_DATA;
    }

    getTXPacketSize(samples: number): number {
        // Should be rounded up to 512b boundary and less than 1M, also added extra buffer for packet metadata
        return (samples * COMPLEX_INT16_SIZE + WebUsbWsdr.HEADER_SIZE/*  + WebUsbWsdr.PACKET_ALIGN_MASK */)/*  & WebUsbWsdr.MAX_PACKET_MASK */;
    }

    protected _fillHeader(buf: ArrayBufferLike, offset: number, discard_timestamp: boolean, timestamp: bigint, samples: number) {
        // console.log('_fillHeader', /* buf, offset, discard_timestamp,  */timestamp/* , samples */)
        const discard_timestamp_flag = discard_timestamp ? 1 : 0;
        /*
        16 bytes packet header

        DW0: [31:0]  timestamp[31:0]
        DW1: [31]    discard_timestamp_flag
             [30:16] samples_in_packet
             [15:0]  timestamp[47:32]
        DW2: 00000000
        DW3: 00000000

        DW4-N IQ 16 bit
        */
        const bufLen = (buf as ArrayBufferLike).byteLength || 0;
        if (bufLen - offset < WebUsbWsdr.HEADER_SIZE)
            throw new Error(`WebUsbWsdr.fillHeader: Error: buffer slice must be at least ${WebUsbWsdr.HEADER_SIZE} bytes (offset ${offset})`);
        if (samples < WebUsbWsdr.MIN_SAMPLES_IN_PKT || samples > WebUsbWsdr.MAX_SAMPLES_IN_PKT)
            throw new Error(`WebUsbWsdr.fillHeader: Error: count of samples in the packet must be in range [${WebUsbWsdr.MIN_SAMPLES_IN_PKT}, ${WebUsbWsdr.MAX_SAMPLES_IN_PKT}], but set to ${samples} `)

        const view16 = new Uint16Array(buf, offset);
        const view64 = new BigUint64Array(buf, offset);
        view64[0] = timestamp & BigInt(0x0000ffffffffffff); //(timestamp >> BigInt(1)) & BigInt(0x0000ffffffffffff)
        view64[1] = BigInt(0);
        view16[3] = (discard_timestamp_flag << 15) + ((samples - 1) & 0x7fff);
        // console.log('TX HEADER', view64[0].toString(16), view64[1].toString(16), buf.slice(0, 16));
    }

    async decodeRxData(data: DataView, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        if (globalThis.debug_mode || debug_usb_log)
            console.log('RECEIVED DATA', data)
        const id = opts !== undefined && opts.id !== undefined ? opts.id : -1;
        const extraMeta = opts?.extra_meta === true;
        const trailerSize = WebUsbWsdr.TRAILER_SIZE + (extraMeta ? WebUsbWsdr.TRAILER_EXTRA_SIZE : 0);
        const dataSize = data.byteLength - trailerSize;
        const samplesRecv = (dataSize / COMPLEX_INT16_SIZE) >> 0;
        if (samples !== samplesRecv) {
            return Promise.reject({ err: new Error(`WebUsbWsdr.parseRxData: Unexpected usb packet size (${samplesRecv} received !== ${samples} expected)`), id: opts?.id });
        }
        const ts = data.getBigUint64(dataSize, true);
        const overrun = Number(ts & BigInt(0x0000000000ffffff));
        let realigned = 0;
        let dropped = 0;
        if (extraMeta) {
            const extra = data.getBigUint64(dataSize + WebUsbWsdr.TRAILER_SIZE, true);
            realigned = Number(extra >> BigInt(64 - 20))
            dropped = Number(extra & BigInt(0xffff))
        }

        const datatype = opts?.datatype || DataType.ci16;
        const elementSize = (datatype === DataType.cf32 || datatype === DataType.f32) ? COMPLEX_FLOAT_SIZE : COMPLEX_INT16_SIZE;
        const output = opts?.data !== undefined ? opts.data : new SharedArrayBuffer(samplesRecv * elementSize);
        WebUsb.fillData(datatype, output, 0, DataType.ci16, data.buffer, 0, (dataSize / Int16Array.BYTES_PER_ELEMENT) >> 0);

        this._timestamp += BigInt(overrun * samplesRecv);

        /*let output = undefined;
        const datatype = opts?.datatype || DataType.ci16;
        if (datatype === DataType.cf32 || datatype === DataType.f32) {
            output = opts?.data !== undefined ? opts.data : new SharedArrayBuffer(samplesRecv * COMPLEX_FLOAT_SIZE);
            const viewData = new Float32Array(output);
            const view16 = new Int16Array(data.buffer, 0, (dataSize / Int16Array.BYTES_PER_ELEMENT) >> 0);
            bufferI16ToF32(view16, viewData);
        } else {
            output = opts?.data !== undefined ? opts.data : new SharedArrayBuffer(samplesRecv * COMPLEX_INT16_SIZE);
            const viewData = new Int16Array(output);
            const view16 = new Int16Array(data.buffer, 0, (dataSize / Int16Array.BYTES_PER_ELEMENT) >> 0);
            viewData.set(view16);
        }*/
        // console.log('RECEIVED TIMESTAMP', this._timestamp);
        if (globalThis.debug_mode || debug_usb_log) console.log('RECEIVE timestamp', this._timestamp, overrun, 'output', output.byteLength);

        const ret: RXBuffer = {
            data: output,
            datatype: datatype,
            id: id,
            samples: samplesRecv,
            timestamp: this._timestamp,
            overrun: overrun,
            realigned: realigned,
            dropped: dropped,
            recvsize: data.byteLength,
        }
        this._timestamp += BigInt(samplesRecv);

        return ret;
    }

    async encodeTxData(data: TXBuffer, opts?: TXEncoderOptions): Promise<ArrayBufferLike> {
        if (globalThis.debug_mode || debug_usb_log)
            console.log('DATA TO SEND', data, data.datatype, data.byteOffset, data.byteLength);
        // console.log('SEND TIMESTAMP', data.timestamp, data.byteLength);
        // const viewin = new Int16Array(data.data, data.byteOffset, data.byteLength);
        // console.log('VIEWIN', viewin.length, viewin);
        // console.log('SEND TIMESTAMP', data.timestamp);
        let output = undefined;
        const samplesCnt = WebUsb.getSamplesCnt(data.datatype, data.byteLength || data.data.byteLength);
        const sliceSamples = opts?.sliceSamples || samplesCnt;
        const chunkCnt = Math.ceil(samplesCnt / sliceSamples);
        const bufSize = samplesCnt * COMPLEX_INT16_SIZE + chunkCnt * WebUsbWsdr.HEADER_SIZE; /* this.getTXPacketSize(sampleCnt) */
        output = opts?.data !== undefined ? opts.data : new ArrayBuffer(bufSize);
        if (output.byteLength < bufSize)
            throw new Error(`WebUsbWsdr.encodeTxData: Error: buffer length must be more than ${bufSize} bytes`);

        let timestamp = data.timestamp;
        const timestampInc = BigInt(sliceSamples);
        const chunkSize = this.getTXPacketSize(sliceSamples);
        const dataOffsetMain = data.byteOffset || 0;
        const dataOffsetMult = sliceSamples * WebUsb.getSampleByteLength(data.datatype);
        for (let i = 0; i < chunkCnt; ++i) {
            const pktOffset = i * chunkSize
            const dataOffset = dataOffsetMain + i * dataOffsetMult;
            const samples = i < chunkCnt - 1 ? sliceSamples : samplesCnt - i * sliceSamples;
            this._fillHeader(output, pktOffset, data.discard_timestamp, timestamp, samples);
            WebUsb.fillData(DataType.ci16, output, pktOffset + WebUsbWsdr.HEADER_SIZE, data.datatype, data.data, dataOffset, samples << 1);
            timestamp += timestampInc;
            // console.log('OUTPUT', output);
        }

        // const viewout = new Int16Array(output/* , WebUsbLimeSdr.HEADER_SIZE */);
        // console.log('TIMESTAMP', data.timestamp, viewout.length, viewout /*, view.subarray(0, 10), view.subarray(view.length - 10, view.length) */);
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
                const ifaceNum = this.device.configuration?.interfaces[0]?.interfaceNumber ?? 0;
                await this.device.claimInterface(ifaceNum);
                // const res = await this.module._init_lib(this.fd, this.device.vendorId, this.device.productId);
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

export class WebUsbXsdr extends WebUsbWsdr {
    constructor(parms: WebUsbParams) {
        super(parms)
        if (globalThis.debug_mode || debug_usb_log)
            console.log('Created WebUsbXsdr')
    }

    getConfiguration(): DeviceConfiguration {
        return {
            defaultSamplesCount: CHUNK_SIZE,
            rxFrequencyRange: { min: 30e6, max: 3800e6 },
            txFrequencyRange: { min: 30e6, max: 3800e6 },
            bandwidthRange: { min: 500e3, max: 65e6 },
            rateRange: { min: 192e3, max: 80e6 },
            streamTypes: { [DeviceStreamType.raw]: { dataTypes: [DataType.ci16] } },
            txRxDelay: 76,
            warmupPackets: 0,
        };
    }
}

export class WebUsbUsdr extends WebUsbWsdr {
    constructor(parms: WebUsbParams) {
        super(parms)
        if (globalThis.debug_mode || debug_usb_log)
            console.log('Created WebUsbUsdr')
    }

    getConfiguration(): DeviceConfiguration {
        return {
            defaultSamplesCount: CHUNK_SIZE,
            rxFrequencyRange: { min: 100e3, max: 3600e6 },
            txFrequencyRange: { min: 300e6, max: 3600e6 },
            bandwidthRange: { min: 500e3, max: 40e6 },
            rateRange: { min: 1e6, max: 65e6 },
            streamTypes: { [DeviceStreamType.raw]: { dataTypes: [DataType.ci16] } },
            txRxDelay: 16,
            warmupPackets: 0,
        };
    }
}
