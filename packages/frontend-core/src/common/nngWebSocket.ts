import { sleep } from '@websdr/core/utils';

const nngVerbose = false;

enum BinaryType {
    BLOB = 0,
    ARRAYBUFFER = 1,
    TEXT = 2,
}

const REQ_ID_HEADER_LEN = 4;
const REQ_ID_FLAG_BIT = 1 << 7;
const REQ_ID_MAX = 0x7fffffff;
const REQ_ID_MOD = 0x80000000;
const DEFAULT_RECONNECT_TIME = 5;
const DEFAULT_SEND_TIMEOUT_MS = 30000;

// see the rfc on sp websocket mapping:
// raw.githubusercontent.com/nanomsg/nanomsg/master/rfc/sp-websocket-mapping-01.txt
export const Protocol = {
    UNKNOWN: '',
    REQ: 'rep.sp.nanomsg.org',
    SUB: 'pub.sp.nanomsg.org',
    PUB: 'sub.sp.nanomsg.org',
}

export class NngWebSocket extends EventTarget {
    static BLOB = BinaryType.BLOB;
    static ARRAYBUFFER = BinaryType.ARRAYBUFFER;
    static TEXT = BinaryType.TEXT;
    static reqIdHeaderLen = REQ_ID_HEADER_LEN;
    static RECONNECT_TIME = DEFAULT_RECONNECT_TIME;

    protected _url: string;
    protected _binaryType: number;
    protected _protocol: string;
    protected _closing: boolean;
    protected _websocket: WebSocket | undefined;
    protected _onOpen: (event: Event) => Promise<void>;
    protected _onClose: (event: CloseEvent) => Promise<void>;
    protected _onMessage: (event: MessageEvent) => Promise<void>;
    protected _onError: (event: Event) => Promise<void>;
    protected _open_promise:
        {
            resolve: ((value: NngWebSocket | PromiseLike<NngWebSocket>) => void) | undefined,
            reject: ((reason?: any) => void) | undefined,
        }
        | undefined;
    protected _send_promises: {
        [reqId: number]: {
            resolve: ((value: any) => void) | undefined,
            reject: ((reason?: any) => void) | undefined,
        }
    };
    protected _reqId: number;
    protected _reconnectTime: number;

    constructor(parms: { url?: string, binaryType?: number, protocol?: string, reconnectTime?: number }) {
        super();
        this._url = parms.url ?? '';
        // use enum default
        this._binaryType = parms.binaryType ?? BinaryType.ARRAYBUFFER;
        this._protocol = parms.protocol ?? Protocol.SUB;
        this._closing = true;
        this._websocket = undefined;
        this._onOpen = this.onWsOpen.bind(this);
        this._onClose = this.onWsClose.bind(this);
        this._onMessage = this.onWsMessage.bind(this);
        this._onError = this.onWsError.bind(this);
        this._open_promise = undefined;
        this._send_promises = {};
        this._reqId = Math.floor(Math.random() * REQ_ID_MAX);
        this._reconnectTime = parms.reconnectTime ?? NngWebSocket.RECONNECT_TIME;
    }

    get url() {
        return this._url;
    }

    isConnecting() {
        return this._websocket !== undefined && this._websocket.readyState === WebSocket.CONNECTING
    }

    isConnected() {
        return this._websocket !== undefined && this._websocket.readyState === WebSocket.OPEN
    }

    // helper: map internal binaryType to WebSocket.binaryType value
    protected wsBinaryTypeValue(): 'arraybuffer' | 'blob' {
        // TEXT handled as arraybuffer (we still decode to string on receive)
        return this._binaryType === NngWebSocket.BLOB ? 'blob' : 'arraybuffer';
    }

    async open(url = undefined, binaryType = undefined, protocol = undefined) {
        if (url !== undefined) this._url = url
        if (binaryType !== undefined) this._binaryType = binaryType
        if (protocol !== undefined) this._protocol = protocol

        let promise = new Promise((resolve, reject) => {
            this._open_promise = { resolve, reject }
        })
        if (!this.isConnecting()) {
            try {
                // ensure previous socket fully closed before creating a new one
                await this.close();
                this._closing = false;
                if (this._protocol !== undefined && this._protocol !== Protocol.UNKNOWN) {
                    this._websocket = new WebSocket(this._url, this._protocol);
                } else {
                    this._websocket = new WebSocket(this._url);
                }
                // set only allowed values for binaryType
                if (this._websocket && typeof this._websocket.binaryType === 'string') {
                    this._websocket.binaryType = this.wsBinaryTypeValue();
                }

                this._websocket.addEventListener('open', this._onOpen);
                this._websocket.addEventListener('close', this._onClose);
                this._websocket.addEventListener('message', this._onMessage);
                this._websocket.addEventListener('error', this._onError);
            } catch (err) {
                if (this._open_promise) {
                    this._open_promise.reject?.('NngWebSocket: ' + String(err));
                    this._open_promise = undefined;
                }
            }
        } else if (this.isConnected()) {
            if (this._open_promise) {
                this._open_promise.resolve?.(this);
                this._open_promise = undefined;
            }
        }

        return promise;
    }

    async close() {
        if (globalThis.debug_mode || nngVerbose)
            console.log(`NngWebSocket: close connection to url ${this._url}`);
        this._closing = true
        if (this._websocket !== undefined) {
            // reject all outstanding send promises to avoid leaks
            for (const k of Object.keys(this._send_promises)) {
                this._send_promises[Number(k)]!.reject?.(new Error('NngWebSocket: connection closed'));
                delete this._send_promises[Number(k)];
            }
            this._websocket.removeEventListener('open', this._onOpen);
            this._websocket.removeEventListener('close', this._onClose);
            this._websocket.removeEventListener('message', this._onMessage);
            this._websocket.removeEventListener('error', this._onError);
            this._websocket.close();
            this._websocket = undefined;
            this._open_promise = undefined;
            this._send_promises = {};
        }
    }

    encodeReqIdHeader(reqId: number) {
        let buf = new Uint8Array(NngWebSocket.reqIdHeaderLen);
        buf[0] = ((reqId >> 24) & 0xff) | REQ_ID_FLAG_BIT;
        buf[1] = (reqId >> 16) & 0xff;
        buf[2] = (reqId >> 8) & 0xff;
        buf[3] = reqId & 0xff;
        return buf;
    }

    decodeReqIdHeader(reqIdHeader: ArrayBuffer) {
        const view = new Uint8Array(reqIdHeader);
        if (view.length !== NngWebSocket.reqIdHeaderLen) return -1;
        // use arithmetic to avoid sign/bitshift issues
        return ((view[0]! & ~REQ_ID_FLAG_BIT) * 16777216) + (view[1]! * 65536) + (view[2]! * 256) + view[3]!;
    }

    incReqId() {
        this._reqId = (this._reqId + 1) % REQ_ID_MOD;
    }

    async send(data: string | ArrayBuffer | Uint8Array | Blob, timeoutMs = DEFAULT_SEND_TIMEOUT_MS): Promise<any> {
        if (!this.isConnected()) {
            return Promise.reject(`NngWebSocket: cannot send data, websocket to url ${this._url} is not connected`)
        }
        if (this._protocol === Protocol.REQ) {
            this.incReqId()
            const reqIdHeader = this.encodeReqIdHeader(this._reqId)
            let enc_data: Uint8Array;
            if (this._binaryType == NngWebSocket.TEXT) {
                const encoder = new TextEncoder()
                if (typeof data === 'string') {
                    enc_data = encoder.encode(data)
                } else if (data instanceof Uint8Array) {
                    enc_data = data
                } else if (data instanceof ArrayBuffer) {
                    enc_data = new Uint8Array(data)
                } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
                    const ab = await data.arrayBuffer()
                    enc_data = new Uint8Array(ab)
                } else {
                    enc_data = encoder.encode(String(data))
                }
            } else if (data instanceof Uint8Array) {
                enc_data = data
            } else if (data instanceof ArrayBuffer) {
                enc_data = new Uint8Array(data)
            } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
                const ab = await data.arrayBuffer()
                enc_data = new Uint8Array(ab)
            } else {
                // fallback: stringify
                enc_data = new TextEncoder().encode(String(data))
            }

            const buf_len = enc_data.length + reqIdHeader.length
            let buf = new Uint8Array(buf_len)
            buf.set(reqIdHeader)
            buf.set(enc_data, reqIdHeader.length)

            this._websocket!.send(buf)

            return new Promise((resolve, reject) => {
                const reqId = this._reqId;
                this._send_promises[reqId] = { resolve, reject }

                // add timeout cleanup to avoid leaking promises
                const timer = setTimeout(() => {
                    if (this._send_promises[reqId]) {
                        this._send_promises[reqId]!.reject?.(`NngWebSocket: request ${reqId} timed out`);
                        delete this._send_promises[reqId];
                    }
                }, timeoutMs);

                // wrap resolve/reject to clear timeout
                const orig = this._send_promises[reqId]!;
                this._send_promises[reqId] = {
                    resolve: (v: any) => { clearTimeout(timer); orig.resolve?.(v) },
                    reject: (e: any) => { clearTimeout(timer); orig.reject?.(e) }
                }
            })
        }
        this._websocket!.send(data)
        return Promise.resolve()
    }

    receive(event: MessageEvent) {
        let reqId = -1;
        let buf: string | Uint8Array | ArrayBuffer | Blob | null = null;

        // Prefer explicit checks in order: ArrayBuffer -> Blob -> string/other
        if (event.data instanceof ArrayBuffer) {
            if (this._protocol === Protocol.REQ) {
                reqId = this.decodeReqIdHeader(event.data.slice(0, NngWebSocket.reqIdHeaderLen));
                const payload = event.data.slice(NngWebSocket.reqIdHeaderLen);
                if (this._binaryType == NngWebSocket.TEXT) {
                    buf = new TextDecoder('utf-8').decode(payload);
                } else {
                    buf = payload;
                }
            } else {
                if (this._binaryType == NngWebSocket.TEXT) {
                    buf = new TextDecoder('utf-8').decode(new Uint8Array(event.data));
                } else {
                    buf = event.data;
                }
            }
        } else if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
            // Blob handling
            if (this._protocol === Protocol.REQ) {
                // read header then payload
                // convert to ArrayBuffer once (async would be needed, but here we keep behavior similar to previous impl)
                // prefer converting to ArrayBuffer synchronously not possible — handle in onWsMessage if needed
                // for now keep blob as-is
                buf = event.data;
            } else {
                buf = event.data;
            }
        } else if (typeof event.data === 'string') {
            buf = event.data;
        }

        if (globalThis.debug_mode || nngVerbose) {
            let len = -1;
            if (buf != null) {
                if (typeof buf === 'string') {
                    len = buf.length;
                } else if (buf instanceof ArrayBuffer) {
                    len = buf.byteLength;
                } else if (buf instanceof Uint8Array) {
                    len = buf.length;
                } else if (typeof Blob !== 'undefined' && buf instanceof Blob) {
                    len = buf.size;
                }
            }
            console.log(`NngWebSocket: Received message from url ${this._url}, len = ${len}`);
        }

        if (reqId >= 0 && this._send_promises[reqId]) {
            if (buf) {
                this._send_promises[reqId]!.resolve?.(buf);
            } else {
                this._send_promises[reqId]!.reject?.(`NngWebSocket: Received an empty buffer from ${this._url}`);
            }
            delete this._send_promises[reqId];
        }

        return buf;
    }

    async onWsOpen(event: Event) {
        if (globalThis.debug_mode || nngVerbose)
            console.log(`NngWebSocket: connection to url ${this._url} established`);
        if (this._open_promise) {
            if (this._open_promise.resolve)
                this._open_promise.resolve(this);
            this._open_promise = undefined;
        }

        this.dispatchEvent(event);
    }

    async onWsClose(event: CloseEvent) {
        if (event.wasClean && this._closing) {
            if (globalThis.debug_mode || nngVerbose)
                console.log(`NngWebSocket: connection to url ${this._url} has been closed`);
        } else {
            const err_str = `NngWebSocket: connection to url ${this._url} has been droped... reopening`;
            if (this._open_promise) {
                this._open_promise.reject?.(err_str);
                this._open_promise = undefined;
            } else if (globalThis.debug_mode || nngVerbose) console.error(err_str);

            if (this._reconnectTime !== -1) {
                await sleep(this._reconnectTime);
                this.open().catch(() => { });
            }
        }

        // dispatch the actual CloseEvent so listeners get reason/code/etc.
        this.dispatchEvent(event);
    }

    async onWsMessage(event: MessageEvent) {
        if (globalThis.debug_mode || nngVerbose)
            console.log('NngWebSocket: receive event', event);
        // if we received a Blob, convert it to ArrayBuffer first so receive() can parse header
        if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
            const ab = await event.data.arrayBuffer();
            const converted = new MessageEvent('message', { data: ab });
            const buf = this.receive(converted);
            if (buf) this.dispatchEvent(new CustomEvent('data', { detail: { data: buf } }));
            this.dispatchEvent(converted);
            return;
        }
        const buf = this.receive(event);
        if (buf) this.dispatchEvent(new CustomEvent('data', { detail: { data: buf } }));
        this.dispatchEvent(event);
    }

    async onWsError(event: Event) {
        let detailStr = '';
        if ((event as any).data !== undefined) {
            detailStr = String((event as any).data);
        } else if (event instanceof ErrorEvent) {
            detailStr = event.message;
        } else {
            try {
                detailStr = JSON.stringify(event);
            } catch {
                detailStr = String(event);
            }
        }
        const err_str = `NngWebSocket: connection to url ${this._url}: an error has occurred: ` + detailStr;
        if (globalThis.debug_mode || nngVerbose) console.error(err_str, event);

        if (this._open_promise) {
            this._open_promise.reject?.(err_str);
            this._open_promise = undefined;
        }
        // reject all outstanding send promises (not only current reqId)
        for (const k of Object.keys(this._send_promises)) {
            this._send_promises[Number(k)]!.reject?.(err_str);
            delete this._send_promises[Number(k)];
        }
        this.dispatchEvent(event);
    }
}
