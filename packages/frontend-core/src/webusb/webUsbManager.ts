import { WebUsb, DefaultDeviceConfiguration } from './webUsbBase';
import type {
    StreamStatus, RXBuffer, RXDecoderOptions, DeviceConfiguration,
    TXBuffer, TXResult, TXEncoderOptions
} from './webUsbBase';
import { SDRDevicesIds } from './webUsb';
import { PromiseHelper } from '@websdr/core/utils';
import type { WebUsbWorkerResponse } from './webUsb.worker.types';


let webUsbManager: Array<WebUsbManager | undefined> = [undefined, undefined, undefined, undefined];

export enum WebUsbManagerMode {
    UNKNOWN = 0,
    SINGLE = 1,
    WORKER = 2,
};

export function getWebUsbManagerInstance(mode: WebUsbManagerMode): WebUsbManager {
    if (webUsbManager[mode] === undefined) {
        switch (mode) {
            case WebUsbManagerMode.SINGLE:
                webUsbManager[mode] = new WebUsbSingleManager();
                break;
            case WebUsbManagerMode.WORKER:
                webUsbManager[mode] = new WebUsbWorkerManager();
                break;
        }
    }
    if (webUsbManager[mode] === undefined) throw new Error("webUsbManager[mode] can't be undefined")
    return webUsbManager[mode]!;
}

export interface RequestDeviceInfo {
    devName: string,
    vendorId: number,
    productId: number,
}

export abstract class WebUsbManager {
    protected _filters: Array<Record<string, any>>;

    constructor() {
        this._filters = SDRDevicesIds;
    }

    async requestDevice(): Promise<RequestDeviceInfo | undefined> {
        try {
            const device = await navigator.usb.requestDevice({
                filters: this._filters,
            });
            if (device) {
                // await device.open();
                const devName = WebUsb.getDeviceName(device);
                const vendorId = device.vendorId;
                const productId = device.productId;

                return { devName, vendorId, productId }
            }
        } catch (err) {
            console.error('requestDevice: error:', err);
        }
        return undefined;
    }

    abstract open(vendorId?: number, productId?: number): Promise<number>;
    abstract close(fd: number): Promise<void>;
    abstract closeAll(): Promise<void>;
    abstract getName(fd: number): Promise<string>;
    abstract getSerialNumber(fd: number): Promise<string>;
    abstract getRXSamplesCount(fd: number, samples: number): Promise<number>;
    abstract sendCommand(fd: number, req: Record<string, any>): Promise<Record<string, any>>;
    abstract sendDebugCommand(fd: number, req: string): Promise<string>;
    abstract submitRxPacket(fd: number, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer>;
    abstract sendTxPacket(fd: number, data: TXBuffer, opts?: TXEncoderOptions): Promise<TXResult>;
    abstract getStreamStatus(fd: number): Promise<StreamStatus>;
    abstract setStreamStatus(fd: number, status: StreamStatus): Promise<void>;
    abstract getConfiguration(fd: number): Promise<DeviceConfiguration>;
    abstract getOpenedDeviceList(): Promise<Array<RequestDeviceInfo> | undefined>;
}

class WebUsbSingleManager extends WebUsbManager {
    constructor() {
        super()
    }

    async open(vendorId?: number, productId?: number): Promise<number> {
        // console.warn('WebUsbSingleManager.open', vendorId, productId);
        if (vendorId === undefined || productId === undefined) return -1;
        const dev = await globalThis.webUsbDeviceManager?.open(vendorId, productId);
        if (!dev) return -1;
        return dev.fd;
    }

    async close(fd: number) {
        // console.warn('WebUsbSingleManager.close', fd);
        if (fd < 0) return;
        await globalThis.webUsbDeviceManager?.close(fd);
    }

    async closeAll() {
        // console.warn('WebUsbSingleManager.closeAll');
        await globalThis.webUsbDeviceManager?.closeAll();
    }

    async getName(fd: number): Promise<string> {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        if (!dev) return '';
        return dev.getName();
    }

    async getSerialNumber(fd: number): Promise<string> {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        if (!dev) return '';
        return dev.getSerialNumber() ?? '';
    }

    async getRXSamplesCount(fd: number, samples: number): Promise<number> {
        return globalThis.webUsbDeviceManager?.getDevice(fd)?.getRXSamplesCount(samples) || 0;
    }

    async sendCommand(fd: number, req: Record<string, any>): Promise<Record<string, any>> {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        return dev ? dev.sendCommand(req) : {};
    }

    async sendDebugCommand(fd: number, req: string): Promise<string> {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        return dev ? dev.sendDebugCommand(req) : '';
    }

    async submitRxPacket(fd: number, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        return new Promise((resolve, reject) => {
            const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
            // console.log('SUBMIT RX', dev, fd, samples, opts)
            if (!dev) reject({ err: 'Device is not defined', id: opts?.id })
            dev?.submitRxPacket(samples, opts)
                .then((data: RXBuffer) => {
                    resolve(data);
                })
                .catch(err => reject(err));
        })
    }

    async sendTxPacket(fd: number, data: TXBuffer, opts?: TXEncoderOptions): Promise<TXResult> {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        return dev ? dev.sendTxPacket(data, opts) : {};
    }

    async getStreamStatus(fd: number): Promise<StreamStatus> {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        return dev ? dev.getStreamStatus() : 'INVALID';
    }

    async setStreamStatus(fd: number, status: StreamStatus): Promise<void> {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        dev?.setStreamStatus(status);
    }

    async getConfiguration(fd: number): Promise<DeviceConfiguration> {
        const dev = globalThis.webUsbDeviceManager?.getDevice(fd);
        return dev?.getConfiguration() || DefaultDeviceConfiguration;
    }

    async getOpenedDeviceList(): Promise<Array<RequestDeviceInfo> | undefined> {
        if (!globalThis.webUsbDeviceManager) return undefined;
        const ret = new Array<RequestDeviceInfo>();
        const dev_fds = globalThis.webUsbDeviceManager.getDevices();
        if (dev_fds !== undefined) {
            dev_fds.forEach(fd => {
                const dev = globalThis.webUsbDeviceManager!.getDevice(fd);
                if (dev) ret.push({ devName: WebUsb.getDeviceName(dev.device), vendorId: dev.vid, productId: dev.pid })
            })
        }
        return ret;
    }
}

class WebUsbWorkerManager extends WebUsbManager {
    protected worker: Worker | undefined = undefined;
    protected _promiseHelper: PromiseHelper = new PromiseHelper();
    protected _onWorkerMessage: EventListenerOrEventListenerObject;
    protected _onWorkerError: EventListenerOrEventListenerObject;

    constructor() {
        super()
        this._onWorkerMessage = this.onWorkerMessage.bind(this) as EventListenerOrEventListenerObject;
        this._onWorkerError = this.onWorkerError.bind(this) as EventListenerOrEventListenerObject;
        this.startWorker();
    }

    async open(vendorId?: number, productId?: number): Promise<number> {
        // console.warn('WebUsbWorkerManager.open', vendorId, productId);
        if (vendorId === undefined || productId === undefined) return -1;
        if (!this.worker) {
            await this.startWorker();
            if (!this.worker) throw new Error('WebUsbManager: error creating worker');
        }
        const [id, ret] = this._promiseHelper.createPromise<number>();
        this.worker.postMessage({ type: 'OPEN', id: id, vendorId: vendorId, productId: productId });
        return ret;
    }

    async close(fd: number): Promise<void> {
        // console.warn('WebUsbWorkerManager.close', fd);
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        if (fd < 0) return;
        const [id, ret] = this._promiseHelper.createPromise<void>();
        this.worker.postMessage({ type: 'CLOSE', id: id, fd: fd });
        return ret;
    }

    async closeAll(): Promise<void> {
        // console.warn('WebUsbWorkerManager.closeAll');
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<void>();
        this.worker.postMessage({ type: 'CLOSE_ALL', id: id });
        return ret;
    }

    async getName(fd: number): Promise<string> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<string>()
        this.worker.postMessage({ type: 'GET_DEV_NAME', id: id, fd: fd });
        return ret;
    }

    async getSerialNumber(fd: number): Promise<string> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<string>()
        this.worker.postMessage({ type: 'GET_SERIAL_NUMBER', id: id, fd: fd });
        return ret;
    }

    async getRXSamplesCount(fd: number, samples: number): Promise<number> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<number>()
        this.worker.postMessage({ type: 'GET_RX_SAMPLES_COUNT', id: id, fd: fd, samples: samples });
        return ret;
    }

    async sendCommand(fd: number, req: Record<string, any>): Promise<Record<string, any>> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<Record<string, any>>()
        this.worker.postMessage({ type: 'SEND_COMMAND', id: id, fd: fd, req: req });
        return ret;
    }

    async sendDebugCommand(fd: number, req: string): Promise<string> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<string>()
        this.worker.postMessage({ type: 'SEND_DEBUG_COMMAND', id: id, fd: fd, req: req });
        return ret;
    }

    async submitRxPacket(fd: number, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<RXBuffer>()
        // const data = new ArrayBuffer(samples * COMPLEX_INT16_SIZE + ControlWebUsb.TRAILER_SIZE)
        if (opts && opts.data && opts.data instanceof ArrayBuffer)
            this.worker.postMessage({ type: 'SUBMIT_RX_PACKET', id: id, fd: fd, samples: samples, opts: opts }, [opts.data]);
        else
            this.worker.postMessage({ type: 'SUBMIT_RX_PACKET', id: id, fd: fd, samples: samples, opts: opts });
        return ret;
    }

    async sendTxPacket(fd: number, data: TXBuffer, opts?: TXEncoderOptions): Promise<TXResult> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<TXResult>()
        if (data && data.data && data.data instanceof ArrayBuffer)
            this.worker.postMessage({ type: 'SEND_TX_PACKET', id: id, fd: fd, data: data, opts: opts }, [data.data]);
        else
            this.worker.postMessage({ type: 'SEND_TX_PACKET', id: id, fd: fd, data: data, opts: opts });
        return ret;
    }

    async getStreamStatus(fd: number): Promise<StreamStatus> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<StreamStatus>()
        this.worker.postMessage({ type: 'GET_STREAM_STATUS', id: id, fd: fd });
        return ret;
    }

    async setStreamStatus(fd: number, status: StreamStatus): Promise<void> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<void>()
        this.worker.postMessage({ type: 'SET_STREAM_STATUS', id: id, fd: fd, status: status });
        return ret;
    }

    async getConfiguration(fd: number): Promise<DeviceConfiguration> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<DeviceConfiguration>()
        this.worker.postMessage({ type: 'GET_CONFIGURATION', id: id, fd: fd });
        return ret;
    }


    async getOpenedDeviceList(): Promise<Array<RequestDeviceInfo> | undefined> {
        if (!this.worker) throw new Error('WebUsbManager: worker is not running');
        const [id, ret] = this._promiseHelper.createPromise<Array<RequestDeviceInfo> | undefined>()
        this.worker.postMessage({ type: 'GET_OPENED_DEVICE_LIST', id: id });
        return ret;
    }

    protected async startWorker(): Promise<void> {
        // console.log('Start WebUsbWorker')
        if (this.worker) this.stopWorker();
        this.worker = new Worker(new URL('./webUsb.worker.js', import.meta.url), { type: 'module' });
        this.worker.addEventListener('message', this._onWorkerMessage);
        this.worker.addEventListener('error', this._onWorkerError);
        const [id, ret] = this._promiseHelper.createPromise<void>();
        this.worker.postMessage({ type: 'START', id: id });
        return ret;
    }

    protected async stopWorker(): Promise<void> {
        // console.log('Stop WebUsbWorker')
        if (this.worker !== undefined) {
            const [id, ret] = this._promiseHelper.createPromise<void>();
            this.worker.postMessage({ type: 'STOP', id: id });
            return ret;
        }
        return;
    }

    protected onStopWorker() {
        if (this.worker !== undefined) {
            this.worker.removeEventListener('message', this._onWorkerMessage);
            this.worker.removeEventListener('error', this._onWorkerError);
            this.worker.terminate();
            this.worker = undefined;
        }
    }

    protected onWorkerMessage(event: MessageEvent) {
        const msg = event.data as WebUsbWorkerResponse;
        if (globalThis.debug_mode) console.log('Message from WebUsbWorker', msg)

        let promise = undefined;
        if (typeof msg.id === 'number') promise = this._promiseHelper.getPromise(msg.id);

        switch (msg.type) {
            case 'STOP':
                this.onStopWorker();
            // intentional fall-through: also resolve any pending promise for STOP using the common branch below
            // eslint-disable-next-line no-fallthrough
            case 'START':
            case 'OPEN':
            case 'CLOSE':
            case 'CLOSE_ALL':
            case 'GET_DEV_NAME':
            case 'GET_SERIAL_NUMBER':
            case 'GET_RX_SAMPLES_COUNT':
            case 'SEND_COMMAND':
            case 'SEND_DEBUG_COMMAND':
            case 'SUBMIT_RX_PACKET':
            case 'SEND_TX_PACKET':
            case 'GET_STREAM_STATUS':
            case 'SET_STREAM_STATUS':
            case 'GET_CONFIGURATION':
                if (promise) {
                    if (msg.res === 'ok') {
                        this._promiseHelper.promiseResolve(promise, msg.ret);
                    } else {
                        this._promiseHelper.promiseReject(promise, msg.err);
                    }
                }
                break;
            case 'GET_OPENED_DEVICE_LIST':
                if (promise) {
                    if (msg.res === 'ok') {
                        this._promiseHelper.promiseResolve(promise, msg.ret);
                    } else {
                        this._promiseHelper.promiseReject(promise, msg.err);
                    }
                }
                break;
            default:
                console.error('WebUsbWorkerManager: Unknown message', msg, 'from WebUsbWorker was received')
        }
        if (typeof msg.id === 'number' && promise !== undefined) this._promiseHelper.deletePromise(msg.id);
    }

    protected onWorkerError(evt: Event) {
        const event: ErrorEvent = evt as ErrorEvent
        console.error('WebUsbWorkerManager: Worker error: ', event.message)
    }
}

export class WebUsbDummyManager extends WebUsbManager {
    protected _stream_status: StreamStatus = 'INVALID';

    constructor() {
        super()
    }

    async open(vendorId?: number, productId?: number): Promise<number> {
        this._stream_status = 'PREPARED';
        return 0;
    }

    async close(fd: number) {
        this._stream_status = 'INVALID';
    }

    async closeAll() {
        this._stream_status = 'INVALID';
    }

    async getName(fd: number): Promise<string> {
        return '';
    }

    async getSerialNumber(fd: number): Promise<string> {
        return '';
    }

    async getRXSamplesCount(fd: number, samples: number): Promise<number> {
        return samples || 0;
    }

    async sendCommand(fd: number, req: Record<string, any>): Promise<Record<string, any>> {
        return {};
    }

    async sendDebugCommand(fd: number, req: string): Promise<string> {
        return '';
    }

    async submitRxPacket(fd: number, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        return Promise.reject({ err: 'This is dummy device', id: opts?.id })
    }

    async sendTxPacket(fd: number, data: TXBuffer, opts?: TXEncoderOptions): Promise<TXResult> {
        return {};
    }

    async getStreamStatus(fd: number): Promise<StreamStatus> {
        return this._stream_status;
    }

    async setStreamStatus(fd: number, status: StreamStatus): Promise<void> {
        this._stream_status = status;
    }

    async getConfiguration(fd: number): Promise<DeviceConfiguration> {
        return DefaultDeviceConfiguration;
    }

    async getOpenedDeviceList(): Promise<Array<RequestDeviceInfo> | undefined> {
        return undefined;
    }
}
