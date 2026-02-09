import type { ControlModule } from '@/control/control'
import type { DeviceConfiguration } from './deviceParameters';
import { CommandQueue } from './commandQueue';
import { TxManager } from './txManager';
import { RxManager } from './rxManager';
import { DataType } from '@websdr/core/common';
import { COMPLEX_FLOAT_SIZE, COMPLEX_INT16_SIZE } from '@websdr/core/common';
import { bufferF32ToI16, bufferI16ToF32 } from '@websdr/core/transform';
import { sleep } from '@websdr/core/utils';

const debug_webusb = false;

/**
 * WebUSB abstraction layer for SDR devices.
 *
 * This module provides a base `WebUsb` class which implements common
 * USB interaction patterns (read/write, command queueing, device
 * discovery) and declares abstract methods that device-specific drivers
 * must implement (data decoding/encoding, packet sizing, configuration).
 */

export enum WebUsbEndpoints {
    CONTROL_EP = 1,
    NOTIFY_EP = 2,
    STREAM_EP = 3,
}

export type StreamStatus = 'INVALID' | 'STOPPED' | 'STARTED' | 'PREPARED' | 'PENDING';

/**
 * Decoded RX packet returned by driver `decodeRxData`.
 */
export interface RXBuffer {
    data: ArrayBufferLike, // Raw IQ data buffer (typed array backing)
    datatype: DataType, // DataType of samples in `data` (cf32/ci16 etc.)
    id: number, // Optional packet identifier assigned by driver
    samples: number, // Number of complex samples contained in `data`
    timestamp: bigint, // Timestamp associated with the packet (ns or ms depending on driver)
    overrun: number, // Device-side overrun count or flag
    realigned: number, // Number of bytes/elements realigned to correct framing
    dropped: number, // Count of dropped samples/packets detected by driver
    recvsize: number, // Received byte length of the USB transfer
}

/**
 * Optional parameters passed to `decodeRxData` to control decoding.
 */
export interface RXDecoderOptions {
    extra_meta?: boolean, // If true, driver should include extra metadata
    datatype?: DataType, // Hint/override for expected incoming data type
    data?: ArrayBufferLike, // Optional pre-fetched data buffer to decode
    id?: number, // Optional id propagated for debugging/traceability
}

/**
 * High-level transmit buffer description passed to `encodeTxData`.
 */
export interface TXBuffer {
    data: ArrayBufferLike, // Source IQ buffer to send
    byteOffset?: number, // Optional byte offset within `data`
    byteLength?: number, // Optional byte length within `data`
    datatype: DataType, // Data type of the provided samples
    discard_timestamp: boolean, // Whether to ignore provided timestamp
    timestamp: bigint, // Desired timestamp for the transmitted block
}

/**
 * Result returned after attempting to send a TX packet.
 */
export interface TXResult {
    usbOutTransferResult?: USBOutTransferResult, // Underlying USB transfer result
}

/**
 * Options for `encodeTxData` and `sendTxPacket`.
 */
export interface TXEncoderOptions {
    data?: ArrayBufferLike, // Optional data override
    allowDrop?: boolean, // Allow dropping packet if TX queue is full
    sliceSamples?: number, // Send only a slice of samples from provided data
}

/** RX packet handler callback type. */
export type RxHandler = (buf: RXBuffer) => void;

export abstract class WebUsb extends EventTarget {
    fd: number; // File descriptor or handle provided by the native control module.

    vid: number; // USB vendor id for the target device.
    pid: number; // USB product id for the target device.

    device: USBDevice | undefined; // The underlying `USBDevice` instance once discovered/opened.

    module: ControlModule | undefined; // Emscripten/wasm control module exposing helper functions.

    streamStatus: StreamStatus = 'STOPPED'; // Current streaming state.

    protected _maxSendDataRequests?: number; // Maximum number of concurrent send requests allowed in the TX manager.

    protected _commandQueue: CommandQueue; // Command queue used to serialize command requests.
    protected _txManager?: TxManager; // TX manager that handles send queue, backpressure and counters.
    protected _rxManager?: RxManager; // RX manager handling receive loop and decoding.

    /** Timing helpers for debug profiling. */
    protected _start_ms = 0;
    protected _end_ms = 0;

    /** Bound event handler for navigator.usb connect. */
    protected _onConnect: (this: USB, ev: USBConnectionEvent) => any;

    /** Bound event handler for navigator.usb disconnect. */
    protected _onDisconnect: (this: USB, ev: USBConnectionEvent) => any;

    //////////////////////////////////////////////////////////////////////////////////////////// 
    // Abstract methods that device-specific drivers must implement:
    ////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * Return device-specific configuration parameters such as default
     * sample count, frequency ranges and supported stream types.
     */
    abstract getConfiguration(): DeviceConfiguration;

    /**
     * Return the number of RX samples the device expects or produces for
     * a logical request of `samples` items. Drivers may adjust this
     * for alignment or hardware constraints.
     */
    abstract getRXSamplesCount(samples: number): number;

    /**
     * Return the RX packet size in bytes for the given number of samples.
     * Used to allocate USB transfer buffers and to request correct lengths
     * from the device.
     */
    abstract getRXPacketSize(samples: number): number;

    /**
     * Return the TX packet size in bytes for the given number of samples.
     * Drivers should match the device's transmit framing and alignment.
     */
    abstract getTXPacketSize(samples: number): number;

    /**
     * Decode raw incoming device data (provided as DataView) into an
     * `RXBuffer` containing metadata (datatype, samples, timestamp, etc.).
     * Implementations should parse any device-specific headers and handle
     * alignment/overrun detection.
     */
    abstract decodeRxData(data: DataView, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer>

    /**
     * Encode a transmit buffer (`TXBuffer`) into the device-specific binary
     * format to be sent via USB. Return an ArrayBufferLike ready for
     * `transferOut`.
     */
    abstract encodeTxData(data: TXBuffer, opts?: TXEncoderOptions): Promise<ArrayBufferLike>

    /**
     * Transport-agnostic hook to send a JSON command to the device and
     * receive a parsed JSON reply. Subclasses must implement this method
     * to perform the full request/response cycle using their chosen
     * transport (e.g. WASM control module, direct USB control transfer,
     * or pure-JS handling). The returned value should be a parsed JSON
     * object (or an object containing an `error` field on failure).
     *
     * Example semantics:
     * - Successful reply: { ...parsed reply... }
     * - Failure: { error: <number or string> }
     *
     * Implementations should not throw for expected device-level errors
     * (they may either throw for transport-level failures or return an
     * `{ error: ... }` object; `runCommandPool` already normalizes both).
     */
    abstract sendCommandToDevice(req: Record<string, any>): Promise<Record<string, any>>;

    //////////////////////////////////////////////////////////////////////////////////////////////
    // Concrete methods with default implementations that can be overridden by subclasses:
    //////////////////////////////////////////////////////////////////////////////////////////////

    /** Transport-agnostic hook for sending raw debug command strings and
     * receiving a raw string reply. Concrete subclasses must implement
     * this method to perform the transport-specific debug command
     * exchange (e.g. WASM `send_debug_command` call, USB control
     * transfer, or JS emulation). The method should return the reply
     * string; on error an implementation may either throw or return an
     * error string.
     */
    async sendDebugCommandToDevice(req: string): Promise<string> {
        return 'Error: not implemented';
    }

    /**
     * Send prepared packet buffer to the device.
     *
     * This public wrapper exists to allow subclasses or tests to override
     * low-level transmit behavior (for example to route packets via an
     * alternative transport, send to a different endpoint, or inject
     * instrumentation). By default it delegates to
     * `USBDevice.transferOut` on the `WebUsbEndpoints.STREAM_EP` endpoint.
     *
     * Subclasses that need custom transmit logic should override this
     * method entirely.
     *
     * @param pkt - Packet buffer prepared by `encodeTxData`/driver
     * @returns Promise resolving to `USBOutTransferResult` or `undefined`
     */
    async sendDataToDevice(pkt: ArrayBufferLike): Promise<USBOutTransferResult | undefined> {
        return this.write(WebUsbEndpoints.STREAM_EP, pkt as BufferSource);
    }

    /**
     * Receive raw data from the device STREAM endpoint.
     *
     * This public wrapper exists to allow subclasses or tests to override
     * low-level receive behavior (for example to route packets via an
     * alternative transport, provide synthetic data, or inject
     * instrumentation). By default it delegates to
     * `USBDevice.transferIn` on the `WebUsbEndpoints.STREAM_EP` endpoint.
     *
     * Subclasses that need custom receive logic should override this
     * method entirely.
     *
     * @param len - Number of bytes to request from the device
     * @returns Promise resolving to `USBInTransferResult` or `undefined`
     */
    async receiveDataFromDevice(len: number): Promise<USBInTransferResult | undefined> {
        return this.read(WebUsbEndpoints.STREAM_EP, len);
    }

    /**
     * Return the device serial number if available. If the device has no
     * serial number, returns the default string ''. If no device is
     * attached, returns `undefined`.
     */
    getSerialNumber() {
        let sn = undefined;
        if (this.device) {
            sn = this.device.serialNumber && this.device.serialNumber !== '' ? this.device.serialNumber : '';
        }
        return sn;
    }

    /**
     * Discover existing devices matching `vid`/`pid` and attach USB event
     * listeners for future connect/disconnect events. Concrete drivers
     * should call `open()` and then perform device-specific claiming and
     * configuration (control transfers etc.).
     */
    async open(): Promise<boolean> {
        if (debug_webusb) console.log('WebUsbBase.open()')
        navigator.usb.removeEventListener("connect", this._onConnect);
        navigator.usb.removeEventListener("disconnect", this._onDisconnect);
        navigator.usb.addEventListener("connect", this._onConnect);
        navigator.usb.addEventListener("disconnect", this._onDisconnect);
        this.device = undefined;
        const devices = await navigator.usb.getDevices();
        for (let device of devices) {
            if (debug_webusb) console.log('DEVICE', device, this.vid, this.pid)
            if (device.vendorId === this.vid && device.productId === this.pid) {
                this.device = device;
                if (debug_webusb) console.log('FOUND DEVICE', device)
                break;
            }
        }
        if (globalThis.debug_mode || debug_webusb) console.log('WebUsbBase.device', this.device)
        // Ensure TX manager is usable after open (recreate if it was closed)
        if (this._txManager?.isClosed()) {
            this._initTxManager();
        }
        // configure RX manager warmup from device configuration if available
        try {
            const cfg = this.getConfiguration();
            this._rxManager?.setWarmup(cfg.warmupPackets || 0);
        } catch (e) {
            // ignore if subclass not ready yet
        }

        return this.device !== undefined;
    }

    /**
     * Close and clean up the underlying USB device, cancel pending
     * commands and release resources held by the control module.
     */
    async close() {
        if (debug_webusb) console.log('WebUsbBase.close()')
        navigator.usb.removeEventListener("connect", this._onConnect);
        navigator.usb.removeEventListener("disconnect", this._onDisconnect);
        this._commandQueue.clear();
        this._txManager?.close();
        this._rxManager?.stop();
        this.module?._close_device(this.fd);
        await sleep(1); //waiting to finish all requests //!!! TODO: need to check finishing of the all requests
        this.fd = -1;
        await this.device?.close();
        this.device = undefined;
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Static helper methods for device name formatting, sample size calculations,
    // and data copying/conversion.
    ///////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * Return a human-readable name for a USB device.
     * If `manufacturerName` and/or `productName` exist, returns
     * "<manufacturer> <product>"; otherwise returns a hex
     * `vendorId:productId` string like "0x3727:0x1001".
     */
    static getDeviceName(device: USBDevice | undefined) {
        let name = '';
        if (device) {
            const vname = device.manufacturerName ? device.manufacturerName + ' ' : '0x' + device.vendorId.toString(16) + ':';
            const pname = device.productName ? device.productName : '0x' + device.productId.toString(16);
            name = vname + pname;
        }
        return name;
    }

    /**
     * Return the byte length of a single complex IQ sample for the
     * specified `DataType` (e.g. cf32 -> 8 bytes, ci16 -> 4 bytes).
     */
    static getSampleByteLength(datatype: DataType): number {
        return datatype === DataType.cf32 ? COMPLEX_FLOAT_SIZE : COMPLEX_INT16_SIZE;
    }

    /**
     * Compute how many complex samples of `datatype` fit into a buffer
     * of `byteLength` bytes (floor division).
     */
    static getSamplesCnt(datatype: DataType, byteLength: number): number {
        return Math.floor(byteLength / WebUsb.getSampleByteLength(datatype));
    }

    /**
     * Copy or convert IQ data from `iqBuf` into `outBuf`.
     * Supported conversions:
     *  - cf32 -> cf32 : direct Float32Array copy
     *  - ci16 -> ci16 : direct Int16Array copy
     *  - cf32 -> ci16 : convert Float32 -> Int16 using `bufferF32ToI16`
     *  - ci16 -> cf32 : convert Int16 -> Float32 using `bufferI16ToF32`
     * `iqBufLength` is the number of elements (not bytes) to copy/convert.
     */
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

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Instance methods for device management, command handling, and data transmission/reception.
    ///////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * Construct a WebUsb instance for a specific device id (vid/pid).
     * `parms.module` is the control module used for MCU/firmware commands
     * and memory helpers. `fd` is the file descriptor/handle used by the
     * control module.
     */
    constructor(parms: WebUsbParams) {
        super()
        this.fd = parms.fd;
        this.vid = parms.vid;
        this.pid = parms.pid;
        this.module = parms.module;
        this.device = undefined;
        this._commandQueue = new CommandQueue((req) => this.sendCommandToDevice(req));
        this._maxSendDataRequests = parms.max_send_data_requests;
        this._initTxManager();
        // create rx manager (warmup configured on open)
        this._rxManager = new RxManager(this.receiveDataFromDevice.bind(this), (data: DataView, samples: number, opts?: any) => this.decodeRxData(data, samples, opts), this.getRXPacketSize.bind(this), 0);
        this._onConnect = this.onConnect.bind(this, navigator.usb);
        this._onDisconnect = this.onDisconnect.bind(this, navigator.usb);
    }

    protected _initTxManager() {
        this._txManager = new TxManager(this.sendDataToDevice.bind(this), this._maxSendDataRequests);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////
    // Public methods for device management, command handling,
    // and data transmission/reception follow.
    ///////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * Check whether the underlying `USBDevice` is opened.
     * @returns truthy value if a device is present and opened, otherwise falsy
     */
    isOpened(): boolean {
        return this.device !== undefined && this.device.opened;
    }

    /**
     * Return the human-readable device name (manufacturer + product)
     * or vendor:product hex ids when names are unavailable.
     */
    getName() {
        return WebUsb.getDeviceName(this.device);
    }

    /**
     * Wrapper around `USBDevice.transferOut` that sends a buffer to the
     * specified endpoint. Returns the transfer result or `undefined` if
     * the device is not available.
     */
    async write(ep: number, buf: BufferSource): Promise<USBOutTransferResult | undefined> {
        return this.device?.transferOut(ep, buf);
    }

    /**
     * Wrapper around `USBDevice.transferIn` that requests `len` bytes from
     * the given endpoint and returns the `USBInTransferResult`.
     */
    async read(ep: number, len: number): Promise<USBInTransferResult | undefined> {
        return this.device?.transferIn(ep, len);
    }

    /**
     * Wrapper around `USBDevice.controlTransferOut` that sends a control buffer to the
     * specified control transfer parameters. Returns the transfer result or `undefined` if
     * the device is not available.
     */
    async writeControl(params: USBControlTransferParameters, buf: BufferSource): Promise<USBOutTransferResult | undefined> {
        return this.device?.controlTransferOut(params, buf);
    }

    /**
     * Wrapper around `USBDevice.controlTransferIn` that requests `len` bytes from
     * the given control transfer parameters and returns the `USBInTransferResult`.
     */
    async readControl(params: USBControlTransferParameters, len: number): Promise<USBInTransferResult | undefined> {
        return this.device?.controlTransferIn(params, len);
    }

    /**
     * Public helper to enqueue a JSON command and receive a promise that
     * resolves with the parsed reply. Typical users are higher-level
     * control APIs that need to talk to device firmware.
     */
    sendCommand(req: Record<string, any>): Promise<any> {
        return this._commandQueue.push(req);
    }

    /**
     * Convenience method to send a raw debug command string to the
     * control module and return the raw string response. Useful during
     * development or for vendor-specific debugging endpoints.
     */
    async sendDebugCommand(req: string): Promise<string> {
        return this.sendDebugCommandToDevice(req);
    }

    /**
     * Read a single RX packet from the STREAM endpoint and decode it
     * using the driver-specific `decodeRxData` implementation. Returns
     * a promise that resolves to `RXBuffer` or rejects with an Error.
     */
    async submitRxPacket(samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        const bsz = this.getRXPacketSize(samples);
        return new Promise((extresolve, extreject) => {
            this.receiveDataFromDevice(bsz)
                .then((res: USBInTransferResult | undefined) => {
                    if (res && res.status == "ok" && res.data) {
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
    }

    /** Start continuous RX loop handled by `RxManager`. Handler is called for each decoded `RXBuffer`. */
    async startRx(samples: number, handler: RxHandler) {
        if (!this._rxManager) {
            this._rxManager = new RxManager(this.receiveDataFromDevice.bind(this), this.decodeRxData.bind(this), this.getRXPacketSize.bind(this), 0);
        }
        return this._rxManager.start(samples, handler);
    }

    /** Stop the continuous RX loop. */
    stopRx() {
        this._rxManager?.stop();
    }

    /**
     * Public transmit entry: checks queue limits, optionally drops packets
     * when the queue is full, increments counters and delegates to
     * `_sendTxPacket` to perform the USB transfer.
     */
    async sendTxRawPacket(pkt: ArrayBufferLike, allowDrop: boolean = false): Promise<TXResult> {
        const res = await (this._txManager ? this._txManager.send(pkt, allowDrop) : this.sendDataToDevice(pkt));
        if (res && res.status == 'ok' && res.bytesWritten === pkt.byteLength) {
            return { usbOutTransferResult: res };
        }
        throw new Error(`WebUsb.sendTxPacket: Error: ${res?.status}`);
    }

    /**
     * Encode a high-level `TXBuffer` using the driver implementation and
     * transmit it. Honors the `allowDrop` flag in `TXEncoderOptions`.
     */
    async sendTxPacket(data: TXBuffer, opts?: TXEncoderOptions): Promise<TXResult> {
        const buf = await this.encodeTxData(data, opts);
        return this.sendTxRawPacket(buf, opts !== undefined && opts.allowDrop !== undefined ? opts.allowDrop : false);
    }

    /**
     * Navigator USB connect event handler. Device-specific drivers may
     * override this to react to new connections; base implementation
     * simply logs in debug mode.
     */
    async onConnect(usb: USB, event: USBConnectionEvent) {
        if (globalThis.debug_mode)
            console.log(`WebUsb: connection to device ${this.device?.vendorId}:${this.device?.productId} established`);
        this.dispatchEvent(new Event('connect', event));
    }

    /**
     * Navigator USB disconnect event handler. Default implementation
     * logs the event; drivers should perform cleanup when appropriate.
     */
    async onDisconnect(usb: USB, event: USBConnectionEvent) {
        if (globalThis.debug_mode)
            console.log(`WebUsb: connection to device ${this.device?.vendorId}:${this.device?.productId} has been closed`);
        this.dispatchEvent(new Event('disconnect', event));
    }

    getStreamStatus(): StreamStatus {
        return this.streamStatus;
    }

    setStreamStatus(status: StreamStatus) {
        this.streamStatus = status;
    }
}

/**
 * Construction parameters required to create a `WebUsb` instance.
 */
export interface WebUsbParams {
    max_send_data_requests?: number, // Optional maximum number of concurrent send requests for the TX manager (default: 128)
    max_recv_data_requests?: number, // Optional maximum number of concurrent receive requests for the RX manager (default: 256)
    fd: number, // File descriptor / control handle
    vid: number, // USB vendor id
    pid: number, // USB product id
    module?: ControlModule, // Control module (wasm/emscripten) instance
}
