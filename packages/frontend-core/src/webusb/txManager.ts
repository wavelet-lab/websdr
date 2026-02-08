export type LowLevelSender = (pkt: ArrayBufferLike) => Promise<USBOutTransferResult | undefined>;

/**
 * TxManager manages a queue of outgoing packets to be sent to the device. It
 * supports limiting the number of outstanding concurrent `sendFn` calls to
 * avoid creating an unbounded number of pending promises (which can exhaust
 * memory/stack when sendFn resolves synchronously).
 */
export class TxManager {
    static MAX_SEND_DATA_REQUEST = 128; // Maximum number of concurrent TX requests queued to the device.

    private _maxRequests: number; // maximum number of concurrent requests allowed (must be > 0, otherwise default is used)
    private _in = 0; // number of completed TX requests
    private _out = 0; // number of sent TX requests (including pending)
    private _pending = 0; // number of pending TX requests (sent but not completed)
    private _gate: Promise<void> | null = null; // shared promise used to wait for free slots when queue is full (pending >= maxRequests)
    private _gateResolve: (() => void) | null = null; // resolver for the shared gate promise
    private _sendFn: LowLevelSender; // low level send function that performs the actual USB transfer
    private _onChange?: () => void; // optional callback that is called whenever the pending count changes (e.g. to update UI)
    private _closed = false; // whether the manager is closed (no more sends allowed, all waiters rejected) - can be reopened with reopen()

    constructor(sendFn: LowLevelSender, maxRequests?: number, onChange?: () => void) {
        this._sendFn = sendFn;
        this._maxRequests = maxRequests && maxRequests > 0 ? maxRequests : TxManager.MAX_SEND_DATA_REQUEST;
        this._onChange = onChange;
    }

    getPendingCount(): number {
        return this._pending;
    }

    /** Resolve the shared gate, waking all waiters. They re-check the while condition. */
    private _notify() {
        if (this._gateResolve) {
            const resolve = this._gateResolve;
            this._gate = null;
            this._gateResolve = null;
            resolve();
        }
    }

    /** Return a shared promise that resolves when a slot might be free. */
    private _waitForFreeSlot(): Promise<void> {
        if (!this._gate) {
            this._gate = new Promise<void>(r => { this._gateResolve = r; });
        }
        return this._gate;
    }

    /** Send a packet, optionally allowing it to be dropped if the queue is full. */
    async send(pkt: ArrayBufferLike, allowDrop: boolean = false): Promise<USBOutTransferResult | undefined> {
        if (this._pending >= this._maxRequests) {
            if (allowDrop) return Promise.reject(`packet dropped due queue is full (${this._pending} >= ${this._maxRequests})`);
            while (this._pending >= this._maxRequests) {
                await this._waitForFreeSlot();
                if (this._closed) return Promise.reject(new Error('TxManager closed'));
            }
        }
        ++this._pending;
        ++this._out;
        this._onChange?.();

        try {
            return await this._sendFn(pkt);
        } finally {
            --this._pending;
            ++this._in;
            this._notify();
            this._onChange?.();
        }
    }

    /** Clear pending count and notify waiters, but keep manager open and usable. */
    clear() {
        this._pending = 0;
        this._notify();
        this._onChange?.();
    }

    /** Permanently close the manager and reject/wake all waiters. */
    close() {
        this._closed = true;
        this._notify();
        this._onChange?.();
    }

    /** Reopen/reset closed state so manager can be reused. */
    reopen() {
        this._closed = false;
        this._pending = 0;
        this._gate = null;
        this._gateResolve = null;
        this._onChange?.();
    }

    /** Check if the manager is currently closed. */
    isClosed(): boolean {
        return this._closed;
    }
}
