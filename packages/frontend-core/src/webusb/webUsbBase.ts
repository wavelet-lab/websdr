import type { ControlModule } from '@/control/control'
import { CircularBuffer } from '@websdr/core/utils';
import { DataType } from '@websdr/core/common';
import { CHUNK_SIZE, COMPLEX_FLOAT_SIZE, COMPLEX_INT16_SIZE } from '@websdr/core/common';
import { bufferF32ToI16, bufferI16ToF32 } from '@websdr/core/transform';
import { sleep } from '@websdr/core/utils';

const debug_webusb = false;

export enum WebUsbEndpoints {
    CONTROL_EP = 1,
    NOTIFY_EP = 2,
    STREAM_EP = 3,
}

export type StreamStatus = 'INVALID' | 'STOPPED' | 'STARTED' | 'PREPARED' | 'PENDING';

export interface RXBuffer {
    data: ArrayBufferLike,
    datatype: DataType,
    id: number,
    samples: number,
    timestamp: bigint,
    overrun: number,
    realigned: number,
    dropped: number,
    recvsize: number,
}

export interface RXDecoderOptions {
    extra_meta?: boolean,
    datatype?: DataType,
    data?: ArrayBufferLike,
    id?: number,
}

export interface TXBuffer {
    data: ArrayBufferLike,
    byteOffset?: number,
    byteLength?: number,
    datatype: DataType,
    discard_timestamp: boolean,
    timestamp: bigint,
}

export interface TXResult {
    usbOutTransferResult?: USBOutTransferResult,
}

export interface TXEncoderOptions {
    data?: ArrayBufferLike,
    // id?: number,
    allowDrop?: boolean,
    sliceSamples?: number,
}

export interface CommandRequest {
    req: Record<string, any>,
    resolve?: (rep: Record<string, any>) => void | undefined,
    reject?: (errmsg: string) => void | undefined,
}

export interface DataRequest {
    pkt: ArrayBufferLike;
    resolve?: (rep: Record<string, any>) => void | undefined,
    reject?: (errmsg: string) => void | undefined,
}

export interface DeviceParamRange {
    min: number,
    max: number,
}

export interface DeviceStreamParameters {
    dataTypes: Array<DataType>,
}

export enum DeviceStreamType {
    raw = 'raw',
    sa = 'sa',
    rtsa = 'rtsa',
}

export const DeviceStreamTypeNames = {
    [DeviceStreamType.raw]: 'raw',
    [DeviceStreamType.sa]: 'sa',
    [DeviceStreamType.rtsa]: 'rtsa',
}

export type DeviceStreamTypes = { [key in DeviceStreamType]?: DeviceStreamParameters };

export enum DeviceDataType {
    ci16 = 'ci16',
    ci12 = 'ci12',
}

export const DeviceDataTypeNames = {
    [DeviceDataType.ci16]: 'ci16',
    [DeviceDataType.ci12]: 'ci12',
}

export type DeviceDataTypes = { [key in DeviceStreamType]?: DeviceStreamParameters };

export interface DeviceConfiguration {
    defaultSamplesCount: number,
    rxFrequencyRange: DeviceParamRange,
    txFrequencyRange: DeviceParamRange,
    bandwidthRange: DeviceParamRange,
    rateRange: DeviceParamRange,
    streamTypes: DeviceStreamTypes,
    txRxDelay: number,
    warmupPackets: number,
}

export const DefaultDeviceConfiguration: DeviceConfiguration = {
    defaultSamplesCount: CHUNK_SIZE,
    rxFrequencyRange: { min: 30e6, max: 3800e6 },
    txFrequencyRange: { min: 30e6, max: 3800e6 },
    bandwidthRange: { min: 500e3, max: 20e6 },
    rateRange: { min: 100e3, max: 40e6 },
    streamTypes: { [DeviceStreamType.raw]: { dataTypes: [DataType.ci16] } },
    txRxDelay: 0,
    warmupPackets: 0,
}

export abstract class WebUsb extends EventTarget {
    // static MAX_RECEIVE_DATA_REQUEST = 24;
    static MAX_SEND_DATA_REQUEST = 128;
    fd: number;
    vid: number;
    pid: number;
    device: USBDevice | undefined;
    module: ControlModule | undefined;
    streamStatus: StreamStatus = 'STOPPED';
    protected _commands = new CircularBuffer<CommandRequest>(100);
    protected _sendCommandInProcess: boolean = false;
    // protected _sendDataRequest = new CircularBuffer<DataRequest>(WebUsb.MAX_SEND_DATA_REQUEST);
    protected _sendDataReqCnt = 0;
    protected in = 0;
    protected out = 0;
    protected _start_ms = 0;
    protected _end_ms = 0;
    protected _onChangeSendDataReq?: () => void;
    protected _onConnect: (this: USB, ev: USBConnectionEvent) => any;
    protected _onDisconnect: (this: USB, ev: USBConnectionEvent) => any;

    abstract getConfiguration(): DeviceConfiguration;
    abstract getRXSamplesCount(samples: number): number;
    abstract getRXPacketSize(samples: number): number;
    abstract getTXPacketSize(samples: number): number;
    abstract decodeRxData(data: DataView, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer>
    abstract encodeTxData(data: TXBuffer, opts?: TXEncoderOptions): Promise<ArrayBufferLike>

    static getDeviceName(device: USBDevice | undefined) {
        let name = '';
        if (device) {
            const vname = device.manufacturerName ? device.manufacturerName + ' ' : '0x' + device.vendorId.toString(16) + ':';
            const pname = device.productName ? device.productName : '0x' + device.productId.toString(16);
            name = vname + pname;
        }
        return name;
    }

    static getSampleByteLength(datatype: DataType): number {
        return datatype === DataType.cf32 ? COMPLEX_FLOAT_SIZE : COMPLEX_INT16_SIZE;
    }

    static getSamplesCnt(datatype: DataType, byteLength: number): number {
        return Math.floor(byteLength / WebUsb.getSampleByteLength(datatype));
    }

    static fillData(outBufDataType: DataType, outBuf: ArrayBufferLike, outBufOffset: number, iqBufDataType: DataType, iqBuf: ArrayBufferLike, iqBufOffset?: number, iqBufLength?: number) {
        // console.log('fillData: outBufDataType =', outBufDataType, ', outBuf =', outBuf, ', outBufOffset =', outBufOffset, ', iqBufDataType =', iqBufDataType, ', iqBuf =', iqBuf, ', iqBufOffset =', iqBufOffset, ', iqBufLength =', iqBufLength);
        if (outBufDataType === DataType.cf32 && outBufDataType === iqBufDataType) {
            const outBufView = new Float32Array(outBuf, outBufOffset, iqBufLength);
            const iqBufView = new Float32Array(iqBuf, iqBufOffset, iqBufLength);
            outBufView.set(iqBufView);
        } else if (outBufDataType === DataType.ci16 && outBufDataType === iqBufDataType) {
            const outBufView = new Int16Array(outBuf, outBufOffset, iqBufLength);
            const iqBufView = new Int16Array(iqBuf, iqBufOffset, iqBufLength);
            outBufView.set(iqBufView);
        } else if (outBufDataType === DataType.ci16 && iqBufDataType === DataType.cf32) {
            const outBufView = new Int16Array(outBuf, outBufOffset, iqBufLength);
            const iqBufView = new Float32Array(iqBuf, iqBufOffset, iqBufLength);
            bufferF32ToI16(iqBufView, outBufView);
        } else if (outBufDataType === DataType.cf32 && iqBufDataType === DataType.ci16) {
            const outBufView = new Float32Array(outBuf, outBufOffset, iqBufLength);
            const iqBufView = new Int16Array(iqBuf, iqBufOffset, iqBufLength);
            bufferI16ToF32(iqBufView, outBufView);
        }
    }

    constructor(parms: WebUsbParams) {
        super()
        this.fd = parms.fd;
        this.vid = parms.vid;
        this.pid = parms.pid;
        this.module = parms.module;
        this.device = undefined;
        this._onConnect = this.onConnect.bind(this, navigator.usb);
        this._onDisconnect = this.onDisconnect.bind(this, navigator.usb);
    }

    protected set sendDataReqCnt(val: number) {
        if (this._onChangeSendDataReq) this._onChangeSendDataReq();
        this._sendDataReqCnt = val;
    }

    protected get sendDataReqCnt() {
        return this._sendDataReqCnt;
    }

    async waitForChangeSendDataReq(): Promise<void> {
        return new Promise(resolve => {
            this._onChangeSendDataReq = () => {
                resolve();
                this._onChangeSendDataReq = undefined;
            };
        });
    }

    isOpened() {
        return this.device && this.device.opened;
    }

    getName() {
        return WebUsb.getDeviceName(this.device);
    }

    getSerialNumber() {
        let sn = undefined;
        if (this.device) {
            sn = this.device.serialNumber && this.device.serialNumber !== '' ? this.device.serialNumber : '007';
        }
        return sn;
    }

    async open() {
        if (debug_webusb) console.log('WebUsbBase.open()')
        if (!this.module) {
            console.error('Control module is not initialized');
            return;
        }
        this._sendCommandInProcess = false;
        navigator.usb.removeEventListener("connect", this._onConnect);
        navigator.usb.removeEventListener("disconnect", this._onDisconnect);
        navigator.usb.addEventListener("connect", this._onConnect);
        navigator.usb.addEventListener("disconnect", this._onDisconnect);
        this.device = undefined;
        const devices = await navigator.usb.getDevices();
        for (let device of devices) {
            // console.log('DEVICE', device, this.vid, this.pid)
            if (device.vendorId === this.vid && device.productId === this.pid) {
                this.device = device;
                // console.log('FOUND DEVICE', device)
                break;
            }
        }
        if (globalThis.debug_mode || debug_webusb) console.log('WebUsbBase.device', this.device)
    }

    async close() {
        if (debug_webusb) console.log('WebUsbBase.close()')
        navigator.usb.removeEventListener("connect", this._onConnect);
        navigator.usb.removeEventListener("disconnect", this._onDisconnect);
        this._commands.clear();
        this.module?._close_device(this.fd);
        await sleep(1); //waiting to finish all requests //!!! TODO: need to check finishing of the all requests
        this.fd = -1;
        await this.device?.close();
        this.device = undefined;
        this._sendCommandInProcess = false;
    }

    async write(ep: number, buf: BufferSource): Promise<USBOutTransferResult | undefined> {
        // if (ep === 3) {
        //     let view64 = new BigUint64Array(buf);
        //     console.log(`transferOut header: 0x${view64[0].toString(16)}, 0x${view64[1].toString(16)}`);
        // }
        return this.device?.transferOut(ep, buf);
    }

    async read(ep: number, len: number): Promise<USBInTransferResult | undefined> {
        return this.device?.transferIn(ep, len);
    }

    async _sendCommand(req: Record<string, any>): Promise<Record<string, any>> {
        this._sendCommandInProcess = true;
        let ret: Record<string, any> = {};
        if (!this.module || !this.device) return { error: -1 };
        const in_cmd = this.module._malloc(512);
        const out_res = this.module._malloc(512);
        const req_str = JSON.stringify(req);
        // console.log('REQ_STR', req_str)
        this.module.stringToAscii(req_str, in_cmd);
        // let res = await this.module._send_command(this.fd, in_cmd, req_str.length, out_res, 512);
        if (debug_webusb) {
            this._start_ms = Date.now();
            console.log('1. WebUsbBase._sendCommand: req = ', req)
        }
        const res = await this.module.ccall("send_command", "number", ["number", "number", "number", "number", "number"],
            [this.fd, in_cmd, req_str.length, out_res, 512], { async: true }
        );
        if (debug_webusb) {
            this._end_ms = Date.now();
            console.log('2. WebUsbBase._sendCommand: res = ', res, 'duration', this._end_ms - this._start_ms)
        }

        if (res != 0) {
            ret = { error: res };
        } else {
            const out_res_str = this.module.AsciiToString(out_res)
            ret = await JSON.parse(out_res_str);
        }

        this.module._free(in_cmd);
        this.module._free(out_res);

        // console.log('sendCommand("', req, '") => ', res, ': ', ret);
        this._sendCommandInProcess = false;
        return ret;
    }

    async runCommandPool() {
        if (this._sendCommandInProcess) return;
        this._sendCommandInProcess = true;
        while (!this._commands.isEmpty()) {
            const com_req = this._commands.front();
            if (com_req) {
                try {
                    const rep = await this._sendCommand(com_req.req);
                    if (rep['error'] !== undefined) {
                        const err = rep['error']
                        const errmsg = `WebUsb: Reply to command request '${JSON.stringify(com_req.req)}' contains error: ${err}`;
                        com_req.reject?.(errmsg);
                    } else {
                        com_req.resolve?.(rep);
                    }
                } catch (err) {
                    const errmsg = `WebUsb: Reply to command request '${JSON.stringify(com_req.req)}' contains error: ${err}`;
                    com_req.reject?.(errmsg);
                }
            }
            this._commands.pop_front();
        }
        this._sendCommandInProcess = false;
    }

    sendCommand(req: Record<string, any>): Promise<any> {
        let com_req: CommandRequest = { req: req };
        const ret = new Promise((resolve, reject) => {
            com_req.resolve = resolve;
            com_req.reject = reject;
        });
        this._commands.push_back(com_req);
        this.runCommandPool();
        return ret;
    }

    async sendDebugCommand(req: string): Promise<string> {
        if (!this.module || !this.device) return 'Error: module or device is undefined';
        const in_cmd = this.module._malloc(4096);
        const out_res = this.module._malloc(4096);
        // console.log('REQ_STR', req_str)
        this.module.stringToAscii(req, in_cmd);
        const res = await this.module.ccall("send_debug_command", "number", ["number", "number", "number", "number", "number"],
            [this.fd, in_cmd, req.length, out_res, 4096], { async: true }
        );

        const ret = this.module.AsciiToString(out_res)

        this.module._free(in_cmd);
        this.module._free(out_res);

        console.log('sendDebugCommand("', req, '") => ', res, ': ', ret);
        return ret;
    }

    async submitRxPacket(samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        const bsz = this.getRXPacketSize(samples);
        // console.log('submitRxPacket', samples, bsz);
        return new Promise((extresolve, extreject) => {
            this.read(WebUsbEndpoints.STREAM_EP, bsz)
                .then((res: USBInTransferResult | undefined) => {
                    if (res && res.status == "ok" && res.data) {
                        // console.log('RECEIVED DATA AT', Date.now())
                        return this.decodeRxData(res.data, samples, opts);
                    } else {
                        throw new Error(`WebUsb.submitRxPacket: Error: ${res?.status}`);
                    }
                })
                .then((res: RXBuffer) => {
                    extresolve(res);
                })
                .catch((err) => {
                    // normalize rejection to Error for callers
                    const e = err instanceof Error ? err : new Error(String(err));
                    // attach optional id for debugging
                    if (opts?.id !== undefined) (e as any).id = opts.id;
                    extreject(e);
                })
        });
        /*!!! this.read(WebUsb.STREAM_EP, bsz).then((res: USBInTransferResult | undefined) => {
            if (res && res.status == "ok" && res.data) {
                const data = res.data.buffer;
                if (globalThis.debug_mode)
                    console.log(`WebUsb: got packet ${data.byteLength} bytes`);
                this.dispatchEvent(new CustomEvent('rxdata', { detail: { res: res, data: data } }))
            } else {
                throw new Error(`WebUsb.submitRxPacket: Error: ${res?.status}`);
            }
        }).catch((err) => {
            this.dispatchEvent(new CustomEvent('rxerror', { detail: { err: err } }))
        });*/
    }

    protected async _sendTxPacket(pkt: ArrayBufferLike): Promise<TXResult> {
        // console.log('_sendTxPacket', this._sendDataRequest.size())
        // if (this._sendDataReqCnt > 4)
        // console.log('_sendTxPacket', this._sendDataReqCnt, 'AT', Date.now())
        // const view = new Uint32Array(pkt)
        // console.log('_sendTxPacket', pkt.byteLength, view[0].toString(16), view[1].toString(16), view[2].toString(16), view[3].toString(16))
        // console.log(pkt);
        return new Promise((extresolve, extreject) => {
            this.write(WebUsbEndpoints.STREAM_EP, pkt as BufferSource)
                .then((res: USBOutTransferResult | undefined) => {
                    if (res && res.status == "ok" && res.bytesWritten === pkt.byteLength) {
                        // console.log('_sendTxPacket reply', res, this._sendDataReqCnt, 'AT', Date.now())
                        --this.sendDataReqCnt;
                        ++this.in;
                        extresolve({ usbOutTransferResult: res });
                    } else {
                        throw new Error(`WebUsb.sendTxPacket: Error: ${res?.status}`);
                    }
                })
                .catch((err) => {
                    // console.log('_sendTxPacket reply error', err, this._sendDataReqCnt, 'AT', Date.now())
                    --this.sendDataReqCnt;
                    ++this.in;
                    extreject(err);
                })
        });
        /*!!! this.write(WebUsb.STREAM_EP, pkt).then((res: USBOutTransferResult | undefined) => {
            // this._sendDataRequest.pop_front();
            // console.log('SEND PKT res', this._sendDataRequest.size())
            // console.log('SEND PKT res', this._sendDataReqCnt)
            if (res && res.status == "ok" && res.bytesWritten === pkt.byteLength) {
                --this.sendDataReqCnt;
                this.dispatchEvent(new CustomEvent('txdata', { detail: { res: res } }))
            } else {
                throw new Error(`WebUsb.sendTxPacket: Error: ${res?.status}`);
            }
        }).catch((err) => {
            --this.sendDataReqCnt;
            // this._sendDataRequest.pop_front();
            this.dispatchEvent(new CustomEvent('txerror', { detail: { err: err } }))
        });*/
    }

    async sendTxRawPacket(pkt: ArrayBufferLike, allowDrop: boolean = false): Promise<TXResult> {
        // let view32 = new Uint32Array(pkt);
        // console.log(`send timestamp 1: ${view32[0]}, 0x${view32[1].toString(16)}, 0x${view32[2].toString(16)}, 0x${view32[3].toString(16)}`);
        // view32 = new Uint32Array(pkt, 10016);
        // console.log(`send timestamp 2: ${view32[0]}, 0x${view32[1].toString(16)}, 0x${view32[2].toString(16)}, 0x${view32[3].toString(16)}`);
        // console.log('sendTxPacket', pkt)
        if (this.sendDataReqCnt >= WebUsb.MAX_SEND_DATA_REQUEST) {
            if (allowDrop) return Promise.reject(`packet dropped due queue is full (${this.sendDataReqCnt} >= ${WebUsb.MAX_SEND_DATA_REQUEST})`);
            while (this.sendDataReqCnt >= WebUsb.MAX_SEND_DATA_REQUEST) await this.waitForChangeSendDataReq();
        }
        ++this.sendDataReqCnt;
        ++this.out;
        // console.log('IN', this.in, 'OUT', this.out)
        return this._sendTxPacket(pkt);
    }

    async sendTxPacket(data: TXBuffer, opts?: TXEncoderOptions): Promise<TXResult> {
        const buf = await this.encodeTxData(data, opts);
        // console.log('BUF', buf);
        return this.sendTxRawPacket(buf, opts !== undefined && opts.allowDrop !== undefined ? opts.allowDrop : false);
    }

    async onConnect(usb: USB, event: USBConnectionEvent) {
        if (globalThis.debug_mode)
            console.log(`WebUsb: connection to device ${this.device?.vendorId}:${this.device?.productId} established`);
        //!!! this.dispatchEvent(new Event('connect', event));
        return 0;
    }

    async onDisconnect(usb: USB, event: USBConnectionEvent) {
        if (globalThis.debug_mode)
            console.log(`WebUsb: connection to device ${this.device?.vendorId}:${this.device?.productId} has been closed`);
        //!!! this.dispatchEvent(new Event('disconnect', event));
        return 0;
    }

    getStreamStatus(): StreamStatus {
        return this.streamStatus;
    }

    setStreamStatus(status: StreamStatus) {
        this.streamStatus = status;
    }
}

export interface WebUsbParams {
    max_send_data_requests?: number,
    fd: number,
    vid: number,
    pid: number,
    module: ControlModule,
}
