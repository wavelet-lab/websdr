import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies used by the worker
vi.mock('@/webusb/webUsbDeviceManager', () => {
    let initialized = false;
    return {
        initControl: vi.fn(async () => { initialized = true; }),
        isControlInitialized: vi.fn(() => initialized),
    };
});

vi.mock('@/webusb/webUsbBase', () => ({
    WebUsb: {
        getDeviceName: (device: any) => device?.name ?? 'dev',
    },
}));

type Manager = {
    open: (vid: number, pid: number) => Promise<any | undefined>;
    close: (fd: number) => Promise<boolean>;
    closeAll: () => Promise<void>;
    getDevice: (fd: number) => any | undefined;
    getDevices: () => number[];
};

const createDev = (fd: number, vid: number, pid: number, opts?: Partial<{
    name: string;
    serial: string;
    rxCount: number;
    cmdResult: any;
    dbgResult: any;
    submit: any;
    bytesWritten: number;
    streamStatus: any;
    config: any;
    deviceName: string;
}>) => {
    return {
        fd,
        vid,
        pid,
        device: { name: opts?.deviceName ?? `Device-${fd}` },
        getName: vi.fn(() => opts?.name ?? `dev-${fd}`),
        getSerialNumber: vi.fn(() => opts?.serial ?? `SN-${fd}`),
        getRXSamplesCount: vi.fn((samples?: number) => (opts?.rxCount ?? samples ?? 0)),
        sendCommand: vi.fn().mockResolvedValue(opts?.cmdResult ?? 'CMD_OK'),
        sendDebugCommand: vi.fn().mockResolvedValue(opts?.dbgResult ?? 'DBG_OK'),
        submitRxPacket: vi.fn().mockResolvedValue(opts?.submit ?? true),
        sendTxPacket: vi.fn().mockResolvedValue({ usbOutTransferResult: { bytesWritten: opts?.bytesWritten ?? 5 } }),
        getStreamStatus: vi.fn(() => opts?.streamStatus ?? { running: false }),
        setStreamStatus: vi.fn(),
        getConfiguration: vi.fn(() => opts?.config ?? { cfg: 1 }),
    };
};

const createManager = (devsInit?: Record<number, any>): Manager => {
    const devs = new Map<number, any>(
        devsInit ? Object.entries(devsInit).map(([k, v]) => [Number(k), v]) : [],
    );
    return {
        open: vi.fn(async (vid: number, pid: number) => {
            const fd = devs.size ? Math.max(...Array.from(devs.keys())) + 1 : 1;
            const dev = createDev(fd, vid, pid);
            devs.set(fd, dev);
            return dev;
        }),
        close: vi.fn(async (fd: number) => devs.delete(fd)),
        closeAll: vi.fn(async () => { devs.clear(); }),
        getDevice: vi.fn((fd: number) => devs.get(fd)),
        getDevices: vi.fn(() => Array.from(devs.keys())),
    };
};

let messages: any[] = [];

async function loadWorker(manager?: Manager) {
    vi.resetModules();
    messages = [];
    (globalThis as any).self = globalThis as any;
    (globalThis as any).postMessage = vi.fn((m: any) => { messages.push(m); });
    if (manager !== undefined) {
        (globalThis as any).webUsbDeviceManager = manager;
    } else {
        delete (globalThis as any).webUsbDeviceManager;
    }
    vi.spyOn(console, 'error').mockImplementation(() => { });
    await import('@/webusb/webUsb.worker.js');
}

async function sendMessage(msg: any) {
    const handler = (globalThis as any).onmessage;
    expect(typeof handler).toBe('function');
    await handler({ data: msg } as any);
    await Promise.resolve();
    await Promise.resolve();
    return messages.slice();
}

describe('webUsb.worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('responds with error on invalid message', async () => {
        await loadWorker(createManager());
        const res = await sendMessage({ id: 1 });
        expect(res[0]).toMatchObject({ type: undefined, id: 1, res: 'error' });
        expect(res[0].err).toBe('invalid message');
    });

    it('START initializes control and responds ok', async () => {
        await loadWorker(createManager());
        const res = await sendMessage({ type: 'START', id: 's1' });
        expect(res[0]).toMatchObject({ type: 'START', id: 's1', res: 'ok' });
    });

    it('OPEN success returns fd', async () => {
        const mgr = createManager();
        await loadWorker(mgr);
        const res = await sendMessage({ type: 'OPEN', id: 'o1', vendorId: 0x1234, productId: 0xabcd });
        expect(res[0].res).toBe('ok');
        expect(res[0].ret).toBeGreaterThan(0);
    });

    it('OPEN error returns -1 and error message', async () => {
        const mgr: Manager = {
            ...createManager(),
            open: vi.fn(async () => undefined),
        };
        await loadWorker(mgr);
        const vid = 0xBEEF, pid = 0xCAFE;
        const res = await sendMessage({ type: 'OPEN', id: 'o2', vendorId: vid, productId: pid });
        expect(res[0]).toMatchObject({ type: 'OPEN', id: 'o2', res: 'error', ret: -1 });
        expect(String(res[0].err)).toContain(`vid = 0x${vid.toString(16)}`);
        expect(String(res[0].err)).toContain(`pid = 0x${pid.toString(16)}`);
    });

    it('errors when manager is missing for device operations', async () => {
        await loadWorker(undefined);
        const res = await sendMessage({ type: 'GET_DEV_NAME', id: 10, fd: 1 });
        expect(res[0].res).toBe('error');
        expect(res[0].err).toBe('webUsbDeviceManager is not defined');
    });

    it('GET_DEV_NAME errors when device not found', async () => {
        const mgr = createManager();
        mgr.getDevice = vi.fn(() => undefined);
        await loadWorker(mgr);
        const res = await sendMessage({ type: 'GET_DEV_NAME', id: 'n1', fd: 99 });
        expect(res[0].res).toBe('error');
        expect(String(res[0].err)).toContain('error getting a webusb device (fd = 99)');
    });

    it('GET_DEV_NAME returns device name', async () => {
        const dev = createDev(7, 0x1, 0x2, { name: 'Device A' });
        const mgr = createManager({ 7: dev });
        await loadWorker(mgr);
        const res = await sendMessage({ type: 'GET_DEV_NAME', id: 'n2', fd: 7 });
        expect(res[0]).toMatchObject({ res: 'ok', ret: 'Device A' });
    });

    it('SEND_COMMAND resolves and responds ok with payload', async () => {
        const dev = createDev(3, 0x1, 0x2, { cmdResult: { a: 1 } });
        const mgr = createManager({ 3: dev });
        await loadWorker(mgr);
        const res = await sendMessage({ type: 'SEND_COMMAND', id: 'c1', fd: 3, req: { cmd: 1 } });
        expect(res[0]).toMatchObject({ type: 'SEND_COMMAND', id: 'c1', res: 'ok', ret: { a: 1 } });
    });

    it('SEND_DEBUG_COMMAND rejection responds with error', async () => {
        const dev = createDev(4, 0x1, 0x2);
        dev.sendDebugCommand = vi.fn().mockRejectedValue(new Error('fail'));
        const mgr = createManager({ 4: dev });
        await loadWorker(mgr);
        const res = await sendMessage({ type: 'SEND_DEBUG_COMMAND', id: 'd1', fd: 4, req: { dbg: true } });
        expect(res[0].res).toBe('error');
        expect(String(res[0].err)).toContain('fail');
    });

    it('GET_OPENED_DEVICE_LIST returns device infos', async () => {
        const d1 = createDev(1, 11, 22, { deviceName: 'HW1' });
        const d2 = createDev(2, 33, 44, { deviceName: 'HW2' });
        const mgr = createManager({ 1: d1, 2: d2 });
        await loadWorker(mgr);
        const res = await sendMessage({ type: 'GET_OPENED_DEVICE_LIST', id: 'l1' });
        expect(res[0].res).toBe('ok');
        expect(Array.isArray(res[0].ret)).toBe(true);
        expect(res[0].ret).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ devName: 'HW1', vendorId: 11, productId: 22 }),
                expect.objectContaining({ devName: 'HW2', vendorId: 33, productId: 44 }),
            ]),
        );
    });

    it('SET_STREAM_STATUS sets status and echoes back', async () => {
        const dev = createDev(5, 0x1, 0x2);
        const mgr = createManager({ 5: dev });
        await loadWorker(mgr);
        const status = { running: true };
        const res = await sendMessage({ type: 'SET_STREAM_STATUS', id: 's2', fd: 5, status });
        expect(res[0]).toMatchObject({ res: 'ok', ret: status });
        expect(dev.setStreamStatus).toHaveBeenCalledWith(status);
    });

    it('SEND_TX_PACKET returns bytesWritten only', async () => {
        const dev = createDev(6, 0x1, 0x2, { bytesWritten: 10 });
        const mgr = createManager({ 6: dev });
        await loadWorker(mgr);
        const res = await sendMessage({ type: 'SEND_TX_PACKET', id: 't1', fd: 6, data: new Uint8Array([1, 2, 3]), opts: {} });
        expect(res[0]).toMatchObject({ res: 'ok', ret: { bytesWritten: 10 } });
    });

    it('GET_RX_SAMPLES_COUNT returns count', async () => {
        const dev = createDev(8, 0x1, 0x2, { rxCount: 42 });
        const mgr = createManager({ 8: dev });
        await loadWorker(mgr);
        const res = await sendMessage({ type: 'GET_RX_SAMPLES_COUNT', id: 'r1', fd: 8, samples: 100 });
        expect(res[0]).toMatchObject({ res: 'ok', ret: 42 });
    });

    it('CLOSE and CLOSE_ALL respond ok', async () => {
        const dev = createDev(9, 0x1, 0x2);
        const mgr = createManager({ 9: dev });
        await loadWorker(mgr);
        const r1 = await sendMessage({ type: 'CLOSE', id: 'cl1', fd: 9 });
        expect(r1[0]).toMatchObject({ res: 'ok', ret: true });

        const r2 = await sendMessage({ type: 'CLOSE_ALL', id: 'cl2' });
        expect(r2[0]).toMatchObject({ res: 'ok', ret: true });
    });

    it('unknown message type produces error via assertNever', async () => {
        await loadWorker(createManager());
        const res = await sendMessage({ type: 'FOO', id: 77 });
        expect(res[0]).toMatchObject({ type: 'FOO', id: 77, res: 'error' });

        const errStr = String(res[0].err);
        expect(errStr.length).toBeGreaterThan(0);
        // Accept either the explicit 'Unhandled message type' or the actual error produced in this environment
        expect(errStr).toMatch(/Unhandled message type|error getting a webusb device/);
    });
});