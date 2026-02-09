import { describe, it, expect, vi } from 'vitest';
import { TxManager } from '@/webusb/txManager';

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

describe('TxManager', () => {
    it('sends and updates counters', async () => {
        const d = deferred<any>();
        const sender = vi.fn().mockImplementation(() => d.promise);
        const mgr = new TxManager(sender as any, 4);

        const pkt = new ArrayBuffer(8);
        const p = mgr.send(pkt);

        // pending increased
        expect(mgr.getPendingCount()).toBe(1);

        d.resolve({ status: 'ok', bytesWritten: pkt.byteLength });
        const res = await p;
        expect(res).toEqual({ status: 'ok', bytesWritten: pkt.byteLength });
        expect(mgr.getPendingCount()).toBe(0);
        expect(sender).toHaveBeenCalledTimes(1);
    });

    it('drops when full if allowDrop=true', async () => {
        const d1 = deferred<any>();
        const d2 = deferred<any>();
        const queue: Deferred<any>[] = [d1, d2];
        const sender = vi.fn().mockImplementation(() => {
            const cur = queue.shift();
            return cur ? cur.promise : Promise.resolve({ status: 'ok', bytesWritten: 0 });
        });
        const mgr = new TxManager(sender as any, 2);

        const pkt = new ArrayBuffer(4);
        const p1 = mgr.send(pkt);
        const p2 = mgr.send(pkt);

        await expect(mgr.send(pkt, true)).rejects.toMatch(/packet dropped/);

        d1.resolve({ status: 'ok', bytesWritten: pkt.byteLength });
        d2.resolve({ status: 'ok', bytesWritten: pkt.byteLength });

        await expect(p1).resolves.toMatchObject({ status: 'ok' });
        await expect(p2).resolves.toMatchObject({ status: 'ok' });
    });

    it('waits for free slot when full and allowDrop=false', async () => {
        const d1 = deferred<any>();
        const queue: Deferred<any>[] = [d1];
        const sender = vi.fn().mockImplementation(() => {
            const cur = queue.shift();
            return cur ? cur.promise : Promise.resolve({ status: 'ok', bytesWritten: 0 });
        });
        const mgr = new TxManager(sender as any, 1);

        const pkt = new ArrayBuffer(2);
        const p1 = mgr.send(pkt);

        // start a second send which will wait
        const p2Promise = mgr.send(pkt);

        // resolve first after a tick
        setTimeout(() => d1.resolve({ status: 'ok', bytesWritten: pkt.byteLength }), 0);

        await expect(p1).resolves.toMatchObject({ status: 'ok' });
        await expect(p2Promise).resolves.toMatchObject({ status: 'ok' });
    });

    it('propagates send errors and clears pending count', async () => {
        const sender = vi.fn().mockRejectedValue(new Error('send failed'));
        const mgr = new TxManager(sender as any, 4);
        const pkt = new ArrayBuffer(4);
        await expect(mgr.send(pkt)).rejects.toThrow(/send failed/);
        expect(mgr.getPendingCount()).toBe(0);
        expect(sender).toHaveBeenCalledTimes(1);
    });

    it('clear() rejects waiting senders with closed error', async () => {
        const d1 = deferred<any>();
        const queue: Deferred<any>[] = [d1];
        const sender = vi.fn().mockImplementation(() => {
            const cur = queue.shift();
            return cur ? cur.promise : Promise.resolve({ status: 'ok', bytesWritten: 0 });
        });
        const mgr = new TxManager(sender as any, 1);
        const pkt = new ArrayBuffer(2);
        const p1 = mgr.send(pkt);
        const p2 = mgr.send(pkt);

        // close should cause waiting sender to reject
        mgr.close();

        // p2 should reject
        await expect(p2).rejects.toThrow(/closed/);

        // resolve p1 to avoid unhandled promise
        d1.resolve({ status: 'ok', bytesWritten: pkt.byteLength });
        await expect(p1).resolves.toMatchObject({ status: 'ok' });
    });
});
