import type { RxHandler } from "./webUsbBase";

/**
 * RxManager runs a continuous receive loop. It supports limiting the number
 * of outstanding concurrent `receiveFn` calls to avoid creating an unbounded
 * number of pending promises (which can exhaust memory/stack when receiveFn
 * resolves synchronously).
 */
export class RxManager {
    static MAX_RECV_DATA_REQUEST = 256; // Maximum number of concurrent RX requests queued to the device.

    private _receiveFn: (len: number) => Promise<USBInTransferResult | undefined>; // low level receive function that performs the actual USB transfer and returns raw data
    private _decodeFn: (data: DataView, samples: number, opts?: any) => Promise<any>; // low level decode function that decodes raw data into a higher level format (e.g. IQ samples)
    private _getPacketSize: (samples: number) => number; // function that returns the expected packet size for a given number of samples (used to determine how much data to request from the device)
    private _warmupPackets: number; // number of initial packets to discard (e.g. to allow AGC to settle) - can be set with setWarmup() and is reset to this value on reopen()
    private _running = false; // whether the receive loop is currently running
    private _handler?: RxHandler; // user-provided handler that is called with decoded data for each received packet (not called for warmup packets)
    private _currentWarmup = 0; // number of remaining warmup packets to discard
    private _samplesPerRequest = 0; // number of samples to request per packet (used for decoding and determining packet size)

    // concurrency control
    private _maxOutstanding: number; // maximum number of concurrent receiveFn calls allowed (must be > 0, otherwise default is used)
    private _outstanding = 0; // number of currently outstanding receiveFn calls (sent but not completed)
    private _gate: Promise<void> | null = null; // shared promise used to wait for free slots when max outstanding requests are in flight
    private _gateResolve: (() => void) | null = null; // resolver for the shared gate promise

    constructor(
        receiveFn: (len: number) => Promise<USBInTransferResult | undefined>,
        decodeFn: (data: DataView, samples: number, opts?: any) => Promise<any>,
        getPacketSize: (samples: number) => number,
        warmupPackets?: number,
        maxOutstandingRequests?: number,
    ) {
        this._receiveFn = receiveFn;
        this._decodeFn = decodeFn;
        this._getPacketSize = getPacketSize;
        this._warmupPackets = warmupPackets ?? 0;
        this._currentWarmup = this._warmupPackets;
        this._maxOutstanding = maxOutstandingRequests && maxOutstandingRequests > 0 ? maxOutstandingRequests : RxManager.MAX_RECV_DATA_REQUEST;
    }

    /** Set the number of initial packets to discard (e.g. to allow AGC to settle). This also resets the current warmup counter to this value. */
    setWarmup(n: number) {
        this._warmupPackets = n;
        this._currentWarmup = n;
    }

    /** Wait until there is a free slot to send the next receive request, if the number of outstanding requests has reached the maximum. */
    private _waitForSlot(): Promise<void> | void {
        if (this._outstanding < this._maxOutstanding) return;
        if (!this._gate) {
            this._gate = new Promise<void>(r => { this._gateResolve = r; });
        }
        return this._gate;
    }

    /** Release a slot when a receive request completes, allowing the next one to be sent. */
    private _releaseSlot() {
        this._outstanding = Math.max(0, this._outstanding - 1);
        if (this._gateResolve) {
            const resolve = this._gateResolve;
            this._gate = null;
            this._gateResolve = null;
            resolve();
        }
    }

    /** Start the receive loop with the given handler and number of samples per request. The handler will be called with decoded data for each received packet (except for warmup packets). */
    async start(samples: number, handler: RxHandler) {
        if (this._running) return;
        this._running = true;
        this._handler = handler;
        this._samplesPerRequest = samples;
        const bsz = this._getPacketSize(this._samplesPerRequest);

        while (this._running) {
            try {
                while (this._outstanding >= this._maxOutstanding) {
                    await this._waitForSlot();
                    if (!this._running) return;
                }
                this._outstanding++;
                try {
                    const res = await this._receiveFn(bsz);
                    if (!this._running) break;
                    if (!res || res.status !== 'ok' || !res.data) {
                        throw new Error(`RxManager.submitRxPacket: Error: ${res?.status}`);
                    }
                    const decoded = await this._decodeFn(res.data, this._samplesPerRequest, {});
                    if (this._currentWarmup > 0) {
                        this._currentWarmup--;
                        continue;
                    }
                    this._handler?.(decoded);
                } finally {
                    this._releaseSlot();
                }
            } catch (err) {
            }
        }
    }

    /** Stop the receive loop. Outstanding receive requests will continue to resolve, but no new ones will be sent and the handler will not be called. */
    stop() {
        this._running = false;
    }

    /** Clear the handler and reset warmup counter, but keep manager open and usable. This also wakes any blocked waitForSlot so the loop can exit if it was waiting for a slot. */
    clear() {
        this.stop();
        this._handler = undefined;
        this._currentWarmup = this._warmupPackets;
        this._outstanding = 0;
        // wake any blocked waitForSlot so the loop can exit
        if (this._gateResolve) {
            const resolve = this._gateResolve;
            this._gate = null;
            this._gateResolve = null;
            resolve();
        }
    }

    /** Permanently close the manager and reject/wake all waiters. This also clears the handler and resets warmup counter. */
    close() {
        this.clear();
    }

    /** Reopen/reset the manager so it can be reused. */
    reopen() {
        this._currentWarmup = this._warmupPackets;
        this._running = false;
    }

    /** Check if the manager is currently running. */
    isRunning(): boolean { return this._running; }
}
