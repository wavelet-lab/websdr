import { describe, it, expect, vi } from 'vitest';
import { RxManager } from '@/webusb/rxManager';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (v: T) => void;
    reject: (e: any) => void;
};
function deferred<T>(): Deferred<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: any) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('RxManager', () => {
    it('calls handler after successful decode', async () => {
        const d = deferred<any>();
        const receiveFn = vi.fn().mockImplementation(() => d.promise);
        const decodeFn = vi.fn().mockResolvedValue({ samples: 10, id: 1 });

        const mgr = new RxManager(receiveFn as any, decodeFn as any, (_s: number) => 128, 0);

        const handlerDeferred = deferred<any>();
        mgr.start(10, (buf: any) => handlerDeferred.resolve(buf));

        // deliver a USBInTransferResult with DataView
        const data = new DataView(new ArrayBuffer(16));
        d.resolve({ status: 'ok', data } as any);

        const res = await handlerDeferred.promise;
        expect(res).toEqual({ samples: 10, id: 1 });
        mgr.stop();
    });

    it('honors warmupPackets and does not call handler until warmup exhausted', async () => {
        const d1 = deferred<any>();
        const d2 = deferred<any>();
        const d3 = deferred<any>();
        const queue = [d1, d2, d3];
        // Helper receive function: return next deferred from queue; when empty,
        // simulate waiting for device by returning a delayed (macrotask) result.
        function makeReceiveFn(q: Array<ReturnType<typeof deferred>>) {
            return () => {
                const cur = q.shift();
                if (cur) return cur.promise;
                return new Promise<USBInTransferResult | undefined>(res => {
                    // simulate device idle: respond after small delay
                    setTimeout(() => res({ status: 'ok', data: new DataView(new ArrayBuffer(0)) } as any), 20);
                });
            };
        }
        const receiveFn = makeReceiveFn(queue) as any;
        const decodeFn = vi.fn().mockResolvedValue({ samples: 4 });

        const mgr = new RxManager(receiveFn as any, decodeFn as any, (_s: number) => 64, 2);

        let called = 0;
        const handlerDeferred = deferred<void>();
        const handler = (buf: any) => { called++; handlerDeferred.resolve(); };
        mgr.start(4, handler);

        // resolve two warmup packets
        d1.resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) } as any);
        d2.resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) } as any);

        // allow loop to process microtasks
        await Promise.resolve();
        await Promise.resolve();

        expect(called).toBe(0);

        // third packet should be delivered to handler
        d3.resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) } as any);
        // wait for handler to be invoked
        await handlerDeferred.promise;
        mgr.stop();
    });

    it('stop prevents handler being called after stop', async () => {
        const d = deferred<any>();
        const receiveFn = vi.fn().mockImplementation(() => d.promise);
        const decodeFn = vi.fn().mockResolvedValue({ samples: 2 });

        const mgr = new RxManager(receiveFn as any, decodeFn as any, (_s: number) => 32, 0);
        let called = 0;
        mgr.start(2, () => { called++; });

        // stop before delivering data
        mgr.stop();
        d.resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) } as any);

        // ensure handler not called
        await Promise.resolve();
        await Promise.resolve();
        expect(called).toBe(0);
    });

    it('continues after decode error and later calls handler', async () => {
        const d1 = deferred<any>();
        const d2 = deferred<any>();
        const queue = [d1, d2];
        const receiveFn = vi.fn().mockImplementation(() => {
            const cur = queue.shift();
            return cur ? cur.promise : Promise.resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) });
        });
        const decodeFn = vi.fn()
            .mockImplementationOnce(() => { throw new Error('decode fail'); })
            .mockResolvedValue({ samples: 6 });

        const mgr = new RxManager(receiveFn as any, decodeFn as any, (_s: number) => 96, 0);

        const handlerDeferred = deferred<any>();
        mgr.start(6, (buf: any) => handlerDeferred.resolve(buf));

        d1.resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) } as any);
        // allow loop to continue
        await Promise.resolve();
        await Promise.resolve();

        d2.resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) } as any);
        const res = await handlerDeferred.promise;
        expect(res).toEqual({ samples: 6 });
        mgr.stop();
    });
});
