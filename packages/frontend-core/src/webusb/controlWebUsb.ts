import { DataType, CHUNK_SIZE } from '@websdr/core/common';
import { Buffer } from 'buffer';
import { sleep } from '@websdr/core/utils';
import { NngWebSocket, Protocol } from '@/common/nngWebSocket';
import {
    getWebUsbManagerInstance, WebUsbManager, WebUsbManagerMode
} from './webUsbManager';
import { WebUsbEndpoints } from './webUsbBase'
import type { StreamStatus } from './webUsbBase'

const debug_control = false;

export interface WebUsbDeviceInfo {
    device: string,
    deviceId: string,
    deviceRev: string,
    firmwareRev: string,
}

export type RequestKeys = keyof typeof ControlWebUsb.Requests;

interface DeferredParameter {
    timer: ReturnType<typeof setTimeout> | undefined;
    lastTime: number;
}

export enum WebUsbChannels {
    CHAN1 = 1 << 0,
    CHAN2 = 1 << 1,
    ALL_CHANS = CHAN1 | CHAN2,
}

export enum WebUsbDirection {
    RX = 1 << 0,
    TX = 1 << 1,
    RX_TX = RX | TX,
}

export class ControlWebUsb extends EventTarget {
    static FIRMWARE_GOLD = 1337;
    static FLASH_SIZE = 0x1c0000;
    static FLASH_SECTOR_SIZE = 256;
    static HEADER_SIZE = 16;
    static TRAILER_SIZE = 8;
    static TRAILER_EXTRA_SIZE = 8;
    static MIN_SAMPLES_IN_PKT = 128;
    static MAX_SAMPLES_IN_PKT = 8192;
    static SET_PARAMETER_TIMEOUT = 250;

    static Requests = {
        //RX
        SET_RX_FREQUENCY: {
            req_method: 'sdr_set_rx_frequency',
            req_params: {
                chans: WebUsbChannels.CHAN1,
                frequency: 100e6,
            },
        },
        SET_RX_BANDWIDTH: {
            req_method: 'sdr_set_rx_bandwidth',
            req_params: {
                chans: WebUsbChannels.CHAN1,
                frequency: 1e6,
            },
        },
        SET_RX_GAIN: {
            req_method: 'sdr_set_rx_gain',
            req_params: {
                chans: WebUsbChannels.CHAN1,
                gain: 15,
            },
        },
        GET_RX_STREAM_STATUS: {
            req_method: 'sdr_get_rx_stream_stats',
        },
        //TX
        SET_TX_FREQUENCY: {
            req_method: 'sdr_set_tx_frequency',
            req_params: {
                chans: WebUsbChannels.CHAN1,
                frequency: 100e6,
            },
        },
        SET_TX_BANDWIDTH: {
            req_method: 'sdr_set_tx_bandwidth',
            req_params: {
                chans: WebUsbChannels.CHAN1,
                frequency: 1e6,
            },
        },
        SET_TX_GAIN: {
            req_method: 'sdr_set_tx_gain',
            req_params: {
                chans: WebUsbChannels.ALL_CHANS,
                gain: 0,
            },
        },
        //Common
        CONNECT: {
            req_method: 'sdr_connect',
            req_params: {
                connection_string: '*',
            }
        },
        DISCONNECT: {
            req_method: 'sdr_disconnect',
        },
        START_STREAMING: {
            req_method: 'sdr_init_streaming',
            req_params: {
                chans: WebUsbChannels.CHAN1,
                samplerate: 1e6,
                packetsize: CHUNK_SIZE,
                throttleon: 10e6,
                param: 0,
                mode: WebUsbDirection.RX_TX,
                dataformat: DataType.ci16,
                // stream_type: ControlStreamType.raw, //right now just for behemoth daemon
            },
        },
        STOP_STREAMING: {
            req_method: 'sdr_stop_streaming',
        },
        CONTROL_STREAMING: {
            req_method: 'sdr_ctrl_streaming',
            req_params: {
                samplerate: 1e6,
                throttleon: 10e6,
                param: 42,
            },
        },
        GET_SENSOR: {
            req_method: 'sdr_get_sensor',
            req_params: {
                sensor: 'sdr_temp',
            },
        },
        SET_PARAMETER: {
            req_method: 'sdr_set_parameter',
            req_params: {
                path: '',
                value: 0,
            },
        },
        GET_PARAMETER: {
            req_method: 'sdr_get_parameter',
            req_params: {
                path: '',
            },
        },
        DEBUG_DUMP: {
            req_method: 'sdr_debug_dump',
        },
        CALIBRATE: {
            req_method: 'sdr_calibrate',
            req_params: {
                param: 0,
                chans: 0,
            }
        },
        //Flash
        FLASH_READ: {
            req_method: 'flash_read',
            req_params: {
                offset: 0,
                param: 0,
            },
        },
        FLASH_WRITE: {
            req_method: 'flash_write_sector',
            req_data: '',
            req_params: {
                offset: 0,
                checksum: 0,
                param: 0,
            },
        },
        FLASH_ERASE: {
            req_method: 'flash_erase',
            req_params: {
                offset: 0,
                length: 0,
            },
        },
        //Information
        GET_FIRMWARE_REVISION: {
            req_method: 'sdr_get_revision',
        },
        DISCOVER: {
            req_method: 'sdr_discover'
        },
    };

    private fd: number = -1;
    protected control_ep: number;
    protected control_rep_ep: number;
    protected notification_ep: number;
    protected type: DataType;
    protected commands: Record<string, any> = {};
    protected parameters: Record<string, any> = {};
    protected _start_ms: number = 0;
    protected _end_ms: number = 0;
    protected _changeParmTimers = new Map<RequestKeys, DeferredParameter>();
    protected _onControlOpen: EventListenerOrEventListenerObject;
    protected _onDebugWSMessage: EventListenerOrEventListenerObject;
    protected _onDebugWSOpen: EventListenerOrEventListenerObject;
    protected _onDebugWSClose: EventListenerOrEventListenerObject;
    // protected _fillData: (outbuf: ArrayBuffer, iqbuf: ArrayBuffer) => void;
    // protected _getSamplesCnt: (iqbuf: ArrayBuffer) => number;
    protected _debugServer?: string;
    protected _debugWS?: NngWebSocket;
    protected _mode: WebUsbManagerMode;
    protected _webUsbManager?: WebUsbManager;

    constructor(params: ControlWebUsbParams = ControlWebUsbInitialParams) {
        super()
        this.control_ep = params.control_ep !== undefined ? params.control_ep : ControlWebUsbInitialParams.control_ep!;
        this.control_rep_ep = params.control_rep_ep !== undefined ? params.control_rep_ep : ControlWebUsbInitialParams.control_rep_ep!;
        this.notification_ep = params.notification_ep !== undefined ? params.notification_ep : ControlWebUsbInitialParams.notification_ep!;
        this.type = params.type !== undefined ? params.type : ControlWebUsbInitialParams.type!;
        this._debugServer = params.debugServer !== undefined ? params.debugServer : ControlWebUsbInitialParams.debugServer!;
        this._mode = params.mode !== undefined ? params.mode : ControlWebUsbInitialParams.mode!;
        if (this._mode !== WebUsbManagerMode.UNKNOWN)
            this._webUsbManager = getWebUsbManagerInstance(this._mode);
        this._onControlOpen = this.onControlOpen.bind(this)
        this._onDebugWSMessage = this.onDebugWSMessage.bind(this)
        this._onDebugWSOpen = this.onDebugWSOpen.bind(this)
        this._onDebugWSClose = this.onDebugWSClose.bind(this)
        this.addEventListener('open', this._onControlOpen)
    }

    setCustomWebUsbManager(webUsbManager: WebUsbManager | undefined) {
        this._webUsbManager = webUsbManager;
    }

    getRequest(req: Record<string, any>, args = {}, ext_args = {}) {
        let ret = req
        // ret.id = '12345';
        if (ret.req_params)
            Object.assign(ret.req_params, args)
        Object.assign(ret, ext_args)
        return ret
    }

    getRequestBuffer(req: Record<string, any>, args = {}, ext_args = {}) {
        return JSON.stringify(this.getRequest(req, args, ext_args))
    }

    async setParameterNow(parm: RequestKeys, args: (() => Record<string, any>) | Record<string, any>) {
        // console.log('SEND COMMAND AT', Date.now());
        const a = typeof args === 'function' ? args() : args;
        await this.sendCommand(parm as RequestKeys, a);
    }

    async setParameter(parm: RequestKeys, args: (() => Record<string, any>) | Record<string, any>, now = false) {
        if (globalThis.debug_mode || debug_control)
            console.log('ControlWebUsb.setParameter(', parm, ', ', args, '): ')
        if (now) {
            await this.setParameterNow(parm, args);
        } else {
            if (!this._changeParmTimers.has(parm))
                this._changeParmTimers.set(parm, { timer: undefined, lastTime: 0 });

            const defferedParm: DeferredParameter = this._changeParmTimers.get(parm)!;

            // if (defferedParm.timer !== undefined) {
            //     clearTimeout(defferedParm.timer);
            //     defferedParm.timer = undefined;
            // }
            const curtime = Date.now();
            if (curtime - defferedParm.lastTime > ControlWebUsb.SET_PARAMETER_TIMEOUT) {
                defferedParm.lastTime = curtime;
                this._changeParmTimers.set(parm, defferedParm);
                await this.setParameterNow(parm, args);
            } else if (defferedParm.timer === undefined) {
                defferedParm.timer = setTimeout(async () => {
                    const defferedParm = this._changeParmTimers.get(parm);
                    if (defferedParm !== undefined) {
                        defferedParm.timer = undefined;
                        defferedParm.lastTime = Date.now();
                        this._changeParmTimers.set(parm, defferedParm);
                    }
                    await this.setParameterNow(parm, args);
                }, ControlWebUsb.SET_PARAMETER_TIMEOUT)
            }
        }
    }

    async setSdrParameter(path: string, value: string | bigint | number | undefined): Promise<void> {
        if (globalThis.debug_mode || debug_control)
            console.log('ControlWebUsb.setSdrParameter(', path, ', ', value, '): ')
        const data = await this.sendCommand('SET_PARAMETER', { path, value });
        if (!data || data.result !== 0) {
            throw new Error(`ControlWebUsb.setSdrParameter: Error setting parameter ${path}`);
        }
    }

    async getSdrParameter(path: string): Promise<string | bigint | number | undefined> {
        if (globalThis.debug_mode || debug_control)
            console.log('ControlWebUsb.getSdrParameter(', path, '): ')
        const data = await this.sendCommand('GET_PARAMETER', { path });
        if (data && data.result === 0 && data.details?.path === path) {
            return data.details.value;
        } else {
            throw new Error(`ControlWebUsb.getSdrParameter: Error getting parameter ${path}`);
        }
        // return undefined; //???
    }

    async sendRawCommand(req: Record<string, any>): Promise<Record<string, any>> {
        return this._webUsbManager ? await this._webUsbManager.sendCommand(this.fd, req) : {};
    }

    async sendCommand(cmd: RequestKeys, args = {}, ext_args = {}) {
        if (this.fd < 0) {
            throw new Error(`ControlWebUsb::sendCommand(${cmd}): Error this.fd = ${this.fd}`)
        }
        try {
            // Ensure we have a known request template for this command
            const template = ControlWebUsb.Requests[cmd]
            if (!template) {
                throw new Error(`ControlWebUsb.sendCommand: Unknown command "${String(cmd)}"`)
            }
            if (cmd === 'START_STREAMING' || cmd === 'STOP_STREAMING' || (cmd === 'CONTROL_STREAMING' && (args as any).param === 0)) {
                // console.log('START/STOP COMMAND DETECTED', cmd, 'streamSatatus', await this.getStreamStatus())
                while (await this.getStreamStatus() === 'PENDING') await sleep(0.01);
                const streamStatus = await this.getStreamStatus();
                if (streamStatus === 'STARTED' && cmd === 'CONTROL_STREAMING' && (args as any).param === 0 ||
                    streamStatus === 'PREPARED' && cmd === 'START_STREAMING' ||
                    streamStatus === 'STOPPED' && cmd === 'STOP_STREAMING') {
                    // console.log('ALREADY STARTED/STOPPED, streamStatus', streamStatus, 'cmd', cmd)
                    return {};
                }
                await this.setStreamStatus('PENDING');
            }
            const req = this.getRequest(ControlWebUsb.Requests[cmd], args, ext_args);
            // console.log('REQUEST', req);
            if (globalThis.debug_mode || debug_control) {
                this._start_ms = Date.now();
                console.log('1. ControlWebUsb.sendCommand(', cmd, ', ', args, ', ', ext_args, '): req =', req);
            }
            const data = await this.sendRawCommand(req);
            // console.log('DATA', data);
            if (globalThis.debug_mode || debug_control) {
                this._end_ms = Date.now();
                console.log('2. ControlWebUsb.sendCommand(', cmd, ', ', args, ', ', ext_args, '): data =', data, 'duration', this._end_ms - this._start_ms);
            }
            if (cmd === 'START_STREAMING' || cmd === 'STOP_STREAMING' || cmd === 'CONTROL_STREAMING' && (args as any).param === 0) {
                if (data['error'] === undefined) {
                    if (cmd === 'START_STREAMING') this.setStreamStatus('PREPARED');
                    else if (cmd === 'STOP_STREAMING') this.setStreamStatus('STOPPED');
                    else if (cmd === 'CONTROL_STREAMING' && (args as any).param === 0) this.setStreamStatus('STARTED');
                } else this.setStreamStatus('INVALID');
            }

            return data;
        } catch (err) {
            console.error('ControlWebUsb.sendCommand:', err)
            throw err;
        }
    }

    init() {
        // console.log('init()')
        try {
            this.dispatchEvent(new Event('init'));
        } catch (err) {
            console.error('init:', err)
        }
    }

    async open(fd: number) {
        // console.log('open(', dev, ')')
        try {
            this.fd = fd;
            this.dispatchEvent(new Event('open'));
            if (this._debugServer !== undefined && this._debugServer !== '') {
                console.warn(`Debug WS server at ${this._debugServer}`)
                this._debugWS = new NngWebSocket({ url: this._debugServer, binaryType: NngWebSocket.TEXT, protocol: Protocol.UNKNOWN });
                this._debugWS.addEventListener('open', this._onDebugWSOpen)
                this._debugWS.addEventListener('close', this._onDebugWSClose)
                this._debugWS.addEventListener('message', this._onDebugWSMessage)
                await this._debugWS.open();
            }
        } catch (err) {
            console.error('open:', err)
        }
    }

    isOpen() {
        return this.fd >= 0;
    }

    async close() {
        this.dispatchEvent(new Event('close'));

        // clear pending parameter timers to avoid leaks
        for (const [_, t] of this._changeParmTimers) {
            if (t.timer !== undefined) {
                clearTimeout(t.timer as any);
                t.timer = undefined;
            }
        }
        this._changeParmTimers.clear();

        if (this._debugWS !== undefined) {
            try {
                // ensure debug WS is closed before removing listeners
                await this._debugWS.close();
            } catch (err) {
                console.warn('ControlWebUsb.close: debugWS.close() failed', err);
            }
            this._debugWS.removeEventListener('open', this._onDebugWSOpen)
            this._debugWS.removeEventListener('close', this._onDebugWSClose)
            this._debugWS.removeEventListener('message', this._onDebugWSMessage)
            this._debugWS = undefined;
        }

        // reset fd so isOpen() reflects closed state
        this.fd = -1;
    }

    onControlOpen() {
        this.init();
    }

    async flashReadSector(buf: Uint8Array, offs: number, gold: boolean = false): Promise<void> {
        const data = await this.sendCommand('FLASH_READ', { offset: offs, param: gold ? ControlWebUsb.FIRMWARE_GOLD : 0 });
        if (data && data.details && data.details.data) {
            const encBuf = Buffer.from(data.details.data, 'base64');
            buf.set(encBuf);
        } else {
            throw new Error('ControlWebUsb.flashRead: Error reading flash');
        }
    }

    async flashRead(gold: boolean = false): Promise<ArrayBuffer> {
        const buf = new ArrayBuffer(ControlWebUsb.FLASH_SIZE);
        const view = new Uint8Array(buf);
        const sectorCnt = ControlWebUsb.FLASH_SIZE / ControlWebUsb.FLASH_SECTOR_SIZE;

        try {
            for (let i = 0; i < sectorCnt; ++i) {
                this.dispatchEvent(new CustomEvent('progress', { detail: { message: 'Flash memory reading', value: i, max: sectorCnt } }))
                const offs = i * ControlWebUsb.FLASH_SECTOR_SIZE;
                await this.flashReadSector(view.subarray(offs, offs + ControlWebUsb.FLASH_SECTOR_SIZE), offs, gold);
            }
        } catch (err) {
            console.error('ControlWebUsb.flashRead: Error: ', err)
        }

        return buf;
    }

    async flashWriteSector(buf: Uint8Array, offs: number, gold: boolean = false): Promise<void> {
        let cksum = 0;
        buf.forEach((val) => cksum += val);
        const encBuf = Buffer.from(buf);
        const data = encBuf.toString('base64');
        await this.sendCommand('FLASH_WRITE', { offset: offs, checksum: cksum, param: gold ? ControlWebUsb.FIRMWARE_GOLD : 0 }, { req_data: data });
    }

    async flashErase(offs: number, len: number) {
        await this.sendCommand('FLASH_ERASE', { offset: offs, length: len });
    }

    async flashWrite(flash: ArrayBuffer, gold: boolean = false): Promise<void> {
        if (flash.byteLength > ControlWebUsb.FLASH_SIZE) {
            const errstr = `ControlWebUsb.flashWrite: Error: size of flash image (${flash.byteLength} bytes) bigger than flash size (${ControlWebUsb.FLASH_SIZE} bytes)`;
            console.error(errstr);
            throw new Error(errstr);
        }

        this.dispatchEvent(new CustomEvent('progress', { detail: { message: 'Flash memory erasing', value: 50, max: 100 } }))
        const writeLen = (flash.byteLength + 4095) & 0xfffff000;
        await this.flashErase(0, writeLen);

        const sectorBuf = new ArrayBuffer(ControlWebUsb.FLASH_SECTOR_SIZE);
        const viewSectorBuf = new Uint8Array(sectorBuf);
        const viewFlash = new Uint8Array(flash);
        // const sectorCnt = ControlWebUsb.FLASH_SIZE / ControlWebUsb.FLASH_SECTOR_SIZE;
        const flashSectorCnt = (writeLen / ControlWebUsb.FLASH_SECTOR_SIZE) >> 0;

        try {
            for (let i = 0; i < flashSectorCnt; ++i) {
                this.dispatchEvent(new CustomEvent('progress', { detail: { message: 'Flash memory writing', value: i, max: flashSectorCnt } }))
                const offs = i * ControlWebUsb.FLASH_SECTOR_SIZE;
                const buf = viewFlash.subarray(offs, offs + ControlWebUsb.FLASH_SECTOR_SIZE);
                let writeBuf = buf;
                if (buf.length < ControlWebUsb.FLASH_SECTOR_SIZE) {
                    viewSectorBuf.set(viewFlash.subarray(offs, offs + ControlWebUsb.FLASH_SECTOR_SIZE));
                    viewSectorBuf.fill(0xff, buf.length);
                    writeBuf = viewSectorBuf;
                }
                await this.flashWriteSector(writeBuf, offs, gold);
            }
            // viewSectorBuf.fill(0xff);
            // for (let i = flashSectorCnt; i < sectorCnt; ++i) {
            //     const offs = i * ControlWebUsb.FLASH_SECTOR_SIZE;
            //     await this.flashWriteSector(viewSectorBuf, offs);
            // }
        } catch (err) {
            console.error('ControlWebUsb.flashWrite: Error: ', err)
            throw err;
        }
    }

    /**
     * Get device info.
     * @param strict if true, throw on error; otherwise return empty/default info and log a warning
     */
    async getDeviceInfo(strict = false): Promise<WebUsbDeviceInfo> {
        const res = await this.sendCommand('GET_FIRMWARE_REVISION');
        // console.log('GET_FIRMWARE_REVISION', res)
        // return { device: res?.device, deviceId: res?.devid, deviceRev: res?.devrev, firmwareRev: res?.revision };
        if (res && res.result === 0) {
            return { device: res.details.device, deviceId: res.details.devid, deviceRev: res.details.devrev, firmwareRev: res.details.revision };
        }
        const msg = 'ControlWebUsb.getDeviceInfo: Error retrieving firmware revision';
        if (strict) throw new Error(msg);
        console.warn(msg, res);
        return { device: '', deviceId: '', deviceRev: '', firmwareRev: '' };
    }

    async getStreamStatus(): Promise<StreamStatus> {
        if (this.fd < 0 || !this._webUsbManager) return 'INVALID'
        return await this._webUsbManager.getStreamStatus(this.fd);
    }

    async setStreamStatus(status: StreamStatus) {
        if (this.fd < 0 || !this._webUsbManager) return;
        await this._webUsbManager.setStreamStatus(this.fd, status);
    }

    async onDebugWSMessage(event: Event) {
        if (this._webUsbManager) {
            const data = (event as MessageEvent).data;
            console.warn('Received debug command:', data);
            const res = await this._webUsbManager.sendDebugCommand(this.fd, data);
            console.warn('Reply to debug command:', res);
            await this._debugWS?.send(res);
        }
    }

    onDebugWSOpen(event: Event) {
        console.log('ControlWebUsb: connected to url', this._debugServer);
    }

    onDebugWSClose(event: Event) {
        console.log('ControlWebUsb: disconnected from url', this._debugServer);
    }

    async calibrate(mode: 'tx' | 'rx' | 'trx') {
        const tx = mode === 'tx' || mode === 'trx' ? 10 : 0;
        const rx = mode === 'rx' || mode === 'trx' ? 5 : 0;
        await this.sendCommand('CALIBRATE', { param: tx + rx });
    }
}

export interface ControlWebUsbParams {
    control_ep?: number,
    control_rep_ep?: number,
    notification_ep?: number,
    type?: DataType,
    debugServer?: string,
    mode?: WebUsbManagerMode;
}

export const ControlWebUsbInitialParams: ControlWebUsbParams = {
    control_ep: WebUsbEndpoints.CONTROL_EP,
    control_rep_ep: WebUsbEndpoints.CONTROL_EP,
    notification_ep: WebUsbEndpoints.NOTIFY_EP,
    type: DataType.cf32,
    debugServer: '',
    mode: WebUsbManagerMode.WORKER,
}