import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebUsbManagerMode, getWebUsbManagerInstance } from '@/webusb/webUsbManager';
import type { WebUsbWorkerResponse } from '@/webusb/webUsb.worker.types';

describe('WebUsbSingleManager (unit)', () => {
    let originalGlobalMgr: any;

    beforeEach(() => {
        originalGlobalMgr = (globalThis as any).webUsbDeviceManager;
    });

    afterEach(() => {
        (globalThis as any).webUsbDeviceManager = originalGlobalMgr;
    });

    it('open/getName/getSerial/sendCommand/submitRxPacket roundtrip (single)', async () => {
        // fake device exposed by global webUsbDeviceManager
        const fakeDevice = {
            fd: 11,
            getName: () => 'FAKE',
            getSerialNumber: () => 'S123',
            getRXSamplesCount: (samples: number) => samples + 1,
            sendCommand: async (req: any) => ({ ok: true, in: req }),
            sendDebugCommand: async (req: string) => `DBG:${req}`,
            submitRxPacket: async (samples: number) => ({ samples }),
        };
        (globalThis as any).webUsbDeviceManager = {
            open: async (_v: number, _p: number) => Promise.resolve(fakeDevice),
            close: async (_fd: number) => { },
            closeAll: async () => { },
            getDevice: (_fd: number) => fakeDevice,
            getDevices: () => [11],
        };

        const mgr = getWebUsbManagerInstance(WebUsbManagerMode.SINGLE);

        const fd = await mgr.open(0x1234, 0x5678);
        expect(fd).toBe(11);

        const name = await mgr.getName(fd);
        expect(name).toBe('FAKE');

        const sn = await mgr.getSerialNumber(fd);
        expect(sn).toBe('S123');

        const count = await mgr.getRXSamplesCount(fd, 7);
        expect(count).toBe(8);

        const cmdRes = await mgr.sendCommand(fd, { a: 1 });
        expect(cmdRes).toEqual({ ok: true, in: { a: 1 } });

        const dbg = await mgr.sendDebugCommand(fd, 'hello');
        expect(dbg).toBe('DBG:hello');

        const rx = await mgr.submitRxPacket(fd, 128);
        expect(rx).toEqual({ samples: 128 });

        const list = await mgr.getOpenedDeviceList();
        expect(Array.isArray(list)).toBe(true);
        expect(list && list.length).toBeGreaterThanOrEqual(1);
    });
});

describe('WebUsbWorkerManager (integration via FakeWorker)', () => {
    const originalWorker = (globalThis as any).Worker;
    beforeEach(() => { });
    afterEach(() => {
        (globalThis as any).Worker = originalWorker;
    });

    class FakeWorker {
        posted: any[] = [];
        listeners: Record<string, Function[]> = {};
        terminated = false;

        addEventListener(ev: string, cb: Function) {
            this.listeners[ev] = this.listeners[ev] || [];
            this.listeners[ev].push(cb);
        }
        removeEventListener(ev: string, cb: Function) {
            this.listeners[ev] = (this.listeners[ev] || []).filter(f => f !== cb);
        }
        postMessage(msg: any, _transfer?: any[]) {
            // record posted message
            this.posted.push(msg);
        }
        terminate() {
            this.terminated = true;
        }
        // helper to simulate worker -> main thread message
        simulateMessage(msg: WebUsbWorkerResponse) {
            const handlers = this.listeners['message'] || [];
            const ev = { data: msg } as MessageEvent;
            handlers.forEach(h => h(ev));
        }
        addEventListenerError(_: string, cb: Function) {
            this.listeners['error'] = this.listeners['error'] || [];
            this.listeners['error'].push(cb);
        }
    }

    it('start -> open resolves on ok response', async () => {
        const fw = new FakeWorker();
        // ensure fresh module load so the manager constructs with our FakeWorker
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        // manager constructor calls startWorker and posts START
        const startMsg = fw.posted.find(m => m.type === 'START');
        expect(startMsg).toBeDefined();
        // respond START ok
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        // call open
        const openP = (mgr as any).open(0x1111, 0x2222);
        const openMsg = fw.posted.find(m => m.type === 'OPEN');
        expect(openMsg).toBeDefined();
        // simulate worker response for OPEN
        fw.simulateMessage({ type: 'OPEN', id: openMsg!.id, res: 'ok', ret: 42 } as WebUsbWorkerResponse);

        const fd = await openP;
        expect(fd).toBe(42);
    });

    it('open rejects when worker responds error', async () => {
        const fw = new FakeWorker();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);
        const startMsg = fw.posted.find(m => m.type === 'START');
        if (startMsg) fw.simulateMessage({ type: 'START', id: startMsg.id, res: 'ok', ret: true });

        const p = (mgr as any).open(1, 2);
        const openMsg = fw.posted.find(m => m.type === 'OPEN');
        expect(openMsg).toBeDefined();
        fw.simulateMessage({ type: 'OPEN', id: openMsg!.id, res: 'error', err: 'open failed' } as WebUsbWorkerResponse);

        await expect(p).rejects.toBeDefined();
    });

    it('GET_OPENED_DEVICE_LIST resolves with worker payload', async () => {
        const fw = new FakeWorker();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);
        const startMsg = fw.posted.find(m => m.type === 'START');
        if (startMsg) fw.simulateMessage({ type: 'START', id: startMsg.id, res: 'ok', ret: true });

        const p = (mgr as any).getOpenedDeviceList();
        const qMsg = fw.posted.find(m => m.type === 'GET_OPENED_DEVICE_LIST');
        expect(qMsg).toBeDefined();

        const payload = [{ devName: 'X', vendorId: 1, productId: 2 }];
        fw.simulateMessage({ type: 'GET_OPENED_DEVICE_LIST', id: qMsg!.id, res: 'ok', ret: payload } as WebUsbWorkerResponse);

        const res = await p;
        expect(res).toEqual(payload);
    });

    it('startWorker posts STOP to old worker, START to new worker, registers handlers and resolves on ok', async () => {
        // initial worker used by constructor
        const fw1 = new FakeWorker();
        (globalThis as any).Worker = function () { return fw1; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        // complete initial START to avoid dangling pending promise
        const initStartMsg = fw1.posted.find(m => m.type === 'START');
        expect(initStartMsg).toBeDefined();
        fw1.simulateMessage({ type: 'START', id: initStartMsg!.id, res: 'ok', ret: true });

        // second worker for explicit startWorker call
        const fw2 = new FakeWorker();
        (globalThis as any).Worker = function () { return fw2; };

        const p = (mgr as any).startWorker();

        // old worker received STOP
        const stopMsg = fw1.posted.find(m => m.type === 'STOP');
        expect(stopMsg).toBeDefined();

        // new worker received START and listeners are attached
        const startMsgNew = fw2.posted.find(m => m.type === 'START');
        expect(startMsgNew).toBeDefined();
        expect((fw2.listeners['message'] || []).length).toBeGreaterThan(0);
        expect((fw2.listeners['error'] || []).length).toBeGreaterThan(0);

        // resolve startWorker promise
        fw2.simulateMessage({ type: 'START', id: startMsgNew!.id, res: 'ok', ret: true });
        await expect(p).resolves.toBeDefined();
    });

    it('startWorker rejects when worker responds with error', async () => {
        const fw1 = new FakeWorker();
        (globalThis as any).Worker = function () { return fw1; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        // complete initial START
        const initStartMsg = fw1.posted.find(m => m.type === 'START');
        expect(initStartMsg).toBeDefined();
        fw1.simulateMessage({ type: 'START', id: initStartMsg!.id, res: 'ok', ret: true });

        const fw2 = new FakeWorker();
        (globalThis as any).Worker = function () { return fw2; };

        const p = (mgr as any).startWorker();
        const startMsgNew = fw2.posted.find(m => m.type === 'START');
        expect(startMsgNew).toBeDefined();

        // reject
        fw2.simulateMessage({ type: 'START', id: startMsgNew!.id, res: 'error', err: 'failed to start' });
        await expect(p).rejects.toBeDefined();
    });

    it('startWorker can be called multiple times, always posting START on the latest worker', async () => {
        const fw1 = new FakeWorker();
        (globalThis as any).Worker = function () { return fw1; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        // finish initial
        const initStartMsg = fw1.posted.find(m => m.type === 'START');
        fw1.simulateMessage({ type: 'START', id: initStartMsg!.id, res: 'ok', ret: true });

        // 2nd worker
        const fw2 = new FakeWorker();
        (globalThis as any).Worker = function () { return fw2; };
        const p2 = (mgr as any).startWorker();
        const start2 = fw2.posted.find(m => m.type === 'START');
        expect(start2).toBeDefined();
        fw2.simulateMessage({ type: 'START', id: start2!.id, res: 'ok', ret: true });
        await expect(p2).resolves.toBeDefined();

        // 3rd worker
        const fw3 = new FakeWorker();
        (globalThis as any).Worker = function () { return fw3; };
        const p3 = (mgr as any).startWorker();
        const start3 = fw3.posted.find(m => m.type === 'START');
        expect(start3).toBeDefined();
        fw3.simulateMessage({ type: 'START', id: start3!.id, res: 'ok', ret: true });
        await expect(p3).resolves.toBeDefined();

        // ensure previous workers saw STOP
        expect(fw1.posted.some(m => m.type === 'STOP')).toBe(true);
        expect(fw2.posted.some(m => m.type === 'STOP')).toBe(true);
    });

    it('proxies basic requests to worker and resolves with payloads', async () => {
        const fw = new FakeWorker();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        const startMsg = fw.posted.find(m => m.type === 'START');
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        // getName
        const pName = (mgr as any).getName(7);
        const getNameMsg = fw.posted.find(m => m.type === 'GET_DEV_NAME');
        expect(getNameMsg).toBeDefined();
        fw.simulateMessage({ type: 'GET_DEV_NAME', id: getNameMsg!.id, res: 'ok', ret: 'NAME7' } as WebUsbWorkerResponse);
        await expect(pName).resolves.toBe('NAME7');

        // getSerialNumber
        const pSN = (mgr as any).getSerialNumber(7);
        const getSnMsg = fw.posted.find(m => m.type === 'GET_SERIAL_NUMBER' && m.id === (pSN as any)?.id) || fw.posted.find(m => m.type === 'GET_SERIAL_NUMBER');
        expect(getSnMsg).toBeDefined();
        fw.simulateMessage({ type: 'GET_SERIAL_NUMBER', id: getSnMsg!.id, res: 'ok', ret: 'SN7' } as WebUsbWorkerResponse);
        await expect(pSN).resolves.toBe('SN7');

        // getRXSamplesCount
        const pCount = (mgr as any).getRXSamplesCount(9, 128);
        const rxCntMsg = fw.posted.find(m => m.type === 'GET_RX_SAMPLES_COUNT');
        expect(rxCntMsg).toBeDefined();
        expect(rxCntMsg!.samples).toBe(128);
        fw.simulateMessage({ type: 'GET_RX_SAMPLES_COUNT', id: rxCntMsg!.id, res: 'ok', ret: 256 } as WebUsbWorkerResponse);
        await expect(pCount).resolves.toBe(256);

        // sendCommand
        const pCmd = (mgr as any).sendCommand(9, { a: 1 });
        const cmdMsg = fw.posted.find(m => m.type === 'SEND_COMMAND');
        expect(cmdMsg).toBeDefined();
        expect(cmdMsg!.req).toEqual({ a: 1 });
        fw.simulateMessage({ type: 'SEND_COMMAND', id: cmdMsg!.id, res: 'ok', ret: { ok: true } } as WebUsbWorkerResponse);
        await expect(pCmd).resolves.toEqual({ ok: true });

        // sendDebugCommand
        const pDbg = (mgr as any).sendDebugCommand(9, 'hello');
        const dbgMsg = fw.posted.find(m => m.type === 'SEND_DEBUG_COMMAND');
        expect(dbgMsg).toBeDefined();
        expect(dbgMsg!.req).toBe('hello');
        fw.simulateMessage({ type: 'SEND_DEBUG_COMMAND', id: dbgMsg!.id, res: 'ok', ret: 'DBG:hello' } as WebUsbWorkerResponse);
        await expect(pDbg).resolves.toBe('DBG:hello');
    });

    it('submitRxPacket transfers buffer when opts.data is ArrayBuffer, otherwise no transfer', async () => {
        class FakeWorkerWithTransfer extends FakeWorker {
            lastTransfer?: any[];
            postMessage(msg: any, transfer?: any[]) {
                this.posted.push(msg);
                this.lastTransfer = transfer;
            }
        }
        const fw = new FakeWorkerWithTransfer();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        const startMsg = fw.posted.find(m => m.type === 'START');
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        // with transfer
        const buf = new ArrayBuffer(16);
        const p1 = (mgr as any).submitRxPacket(3, 64, { id: 1, data: buf });
        const rxMsg1 = fw.posted.find(m => m.type === 'SUBMIT_RX_PACKET');
        expect(rxMsg1).toBeDefined();
        expect(fw.lastTransfer && fw.lastTransfer.length).toBe(1);
        expect(fw.lastTransfer![0]).toBe(buf);
        fw.simulateMessage({ type: 'SUBMIT_RX_PACKET', id: rxMsg1!.id, res: 'ok', ret: { samples: 64 } } as WebUsbWorkerResponse);
        await expect(p1).resolves.toEqual({ samples: 64 });

        // without transfer
        const p2 = (mgr as any).submitRxPacket(4, 32, { id: 2 });
        const rxMsg2 = fw.posted.filter(m => m.type === 'SUBMIT_RX_PACKET').pop();
        expect(rxMsg2).toBeDefined();
        expect(fw.lastTransfer).toBeUndefined();
        fw.simulateMessage({ type: 'SUBMIT_RX_PACKET', id: rxMsg2!.id, res: 'ok', ret: { samples: 32 } } as WebUsbWorkerResponse);
        await expect(p2).resolves.toEqual({ samples: 32 });
    });

    it('sendTxPacket transfers buffer when data.data is ArrayBuffer, otherwise no transfer', async () => {
        class FakeWorkerWithTransfer extends FakeWorker {
            lastTransfer?: any[];
            postMessage(msg: any, transfer?: any[]) {
                this.posted.push(msg);
                this.lastTransfer = transfer;
            }
        }
        const fw = new FakeWorkerWithTransfer();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        const startMsg = fw.posted.find(m => m.type === 'START');
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        // with transfer
        const ab = new ArrayBuffer(8);
        const p1 = (mgr as any).sendTxPacket(5, { data: ab }, { mode: 'x' });
        const txMsg1 = fw.posted.find(m => m.type === 'SEND_TX_PACKET');
        expect(txMsg1).toBeDefined();
        expect(fw.lastTransfer && fw.lastTransfer.length).toBe(1);
        expect(fw.lastTransfer![0]).toBe(ab);
        fw.simulateMessage({ type: 'SEND_TX_PACKET', id: txMsg1!.id, res: 'ok', ret: { ok: true } } as WebUsbWorkerResponse);
        await expect(p1).resolves.toEqual({ ok: true });

        // without transfer
        const p2 = (mgr as any).sendTxPacket(6, { data: { notBuffer: true } }, {});
        const txMsg2 = fw.posted.filter(m => m.type === 'SEND_TX_PACKET').pop();
        expect(txMsg2).toBeDefined();
        expect(fw.lastTransfer).toBeUndefined();
        fw.simulateMessage({ type: 'SEND_TX_PACKET', id: txMsg2!.id, res: 'ok', ret: { ok: 2 } } as WebUsbWorkerResponse);
        await expect(p2).resolves.toEqual({ ok: 2 });
    });

    it('close with negative fd returns immediately without posting CLOSE', async () => {
        const fw = new FakeWorker();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        const startMsg = fw.posted.find(m => m.type === 'START');
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        await (mgr as any).close(-1);
        expect(fw.posted.some(m => m.type === 'CLOSE')).toBe(false);
    });

    it('close and closeAll resolve on ok and reject on error', async () => {
        const fw = new FakeWorker();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        const startMsg = fw.posted.find(m => m.type === 'START');
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        // close ok
        const pClose = (mgr as any).close(10);
        const closeMsg = fw.posted.find(m => m.type === 'CLOSE');
        expect(closeMsg).toBeDefined();
        fw.simulateMessage({ type: 'CLOSE', id: closeMsg!.id, res: 'ok', ret: true } as WebUsbWorkerResponse);
        await expect(pClose).resolves.toBe(true);

        // closeAll reject
        const pCA = (mgr as any).closeAll();
        const caMsg = fw.posted.find(m => m.type === 'CLOSE_ALL');
        expect(caMsg).toBeDefined();
        fw.simulateMessage({ type: 'CLOSE_ALL', id: caMsg!.id, res: 'error', err: 'fail' } as WebUsbWorkerResponse);
        await expect(pCA).rejects.toBeDefined();
    });

    it('get/set stream status and getConfiguration', async () => {
        const fw = new FakeWorker();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        const startMsg = fw.posted.find(m => m.type === 'START');
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        const pSet = (mgr as any).setStreamStatus(1, 'RUNNING');
        const setMsg = fw.posted.find(m => m.type === 'SET_STREAM_STATUS');
        expect(setMsg).toBeDefined();
        expect(setMsg!.status).toBe('RUNNING');
        fw.simulateMessage({ type: 'SET_STREAM_STATUS', id: setMsg!.id, res: 'ok', ret: true } as WebUsbWorkerResponse);
        await expect(pSet).resolves.toBe(true);

        const pGet = (mgr as any).getStreamStatus(1);
        const getMsg = fw.posted.find(m => m.type === 'GET_STREAM_STATUS');
        expect(getMsg).toBeDefined();
        fw.simulateMessage({ type: 'GET_STREAM_STATUS', id: getMsg!.id, res: 'ok', ret: 'PREPARED' } as WebUsbWorkerResponse);
        await expect(pGet).resolves.toBe('PREPARED');

        const pCfg = (mgr as any).getConfiguration(1);
        const cfgMsg = fw.posted.find(m => m.type === 'GET_CONFIGURATION');
        expect(cfgMsg).toBeDefined();
        const cfg = { a: 1 };
        fw.simulateMessage({ type: 'GET_CONFIGURATION', id: cfgMsg!.id, res: 'ok', ret: cfg } as WebUsbWorkerResponse);
        await expect(pCfg).resolves.toEqual(cfg);
    });

    it('throws when worker is not running', async () => {
        const fw = new FakeWorker();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        const startMsg = fw.posted.find(m => m.type === 'START');
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        fw.simulateMessage({ type: 'STOP', res: 'ok' } as any);

        await expect((mgr as any).getName(1)).rejects.toThrow(/worker is not running/);
    });

    it('stopWorker posts STOP and resolves on response', async () => {
        const fw = new FakeWorker();
        (globalThis as any).Worker = function () { return fw; };
        vi.resetModules();
        const mod = await import('@/webusb/webUsbManager');
        const mgr = mod.getWebUsbManagerInstance(WebUsbManagerMode.WORKER);

        const startMsg = fw.posted.find(m => m.type === 'START');
        fw.simulateMessage({ type: 'START', id: startMsg!.id, res: 'ok', ret: true });

        const p = (mgr as any).stopWorker();
        const stopMsg = fw.posted.find(m => m.type === 'STOP');
        expect(stopMsg).toBeDefined();
        fw.simulateMessage({ type: 'STOP', id: stopMsg!.id, res: 'ok', ret: true } as WebUsbWorkerResponse);
        await expect(p).resolves.toBe(true);

        await expect((mgr as any).getName(1)).rejects.toThrow(/worker is not running/);
    });
});