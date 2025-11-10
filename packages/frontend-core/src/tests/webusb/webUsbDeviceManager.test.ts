import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('WebUsbDeviceManager', () => {
    let mod: typeof import('@/webusb/webUsbDeviceManager');
    const fakeControlModule = { foo: 'bar' };

    beforeEach(async () => {
        vi.resetModules();

        // mock webUsb helpers used by the manager
        vi.mock('@/webusb/webUsb', () => {
            return {
                getDeviceHash: (_: any) => 'DEV_HASH',
                getWebUsbInstance: (_hash: string, params: any) => {
                    // return a minimal fake WebUsb instance
                    return {
                        fd: params.fd,
                        vid: params.vid,
                        pid: params.pid,
                        open: vi.fn(async () => { /* opened */ }),
                        close: vi.fn(async () => { /* closed */ }),
                    };
                },
            };
        });

        // mock control init module for initControl()
        vi.mock('@/control/control', async () => {
            return {
                // return a stable fake control module directly to avoid closure/scope issues
                default: async (overrides?: any) => ({ foo: 'bar', ...overrides }),
            };
        });

        // import module under test after mocks are set
        mod = await import('@/webusb/webUsbDeviceManager');
    });

    afterEach(() => {
        // cleanup globals to avoid test leakage
        delete (globalThis as any).controlModule;
        delete (globalThis as any).webUsbDeviceManager;
        vi.restoreAllMocks();
    });

    it('initControl sets global controlModule and webUsbDeviceManager', async () => {
        expect((globalThis as any).controlModule).toBeUndefined();
        expect((globalThis as any).webUsbDeviceManager).toBeUndefined();

        await mod.initControl();
        expect((globalThis as any).controlModule).toBeDefined();
        expect((globalThis as any).controlModule).toMatchObject(fakeControlModule);
        expect((globalThis as any).webUsbDeviceManager).toBeInstanceOf(mod.WebUsbDeviceManager);
        expect(mod.isControlInitialized()).toBe(true);
    });

    it('open creates new device at slot 0 and calls open', async () => {
        const mgr = new mod.WebUsbDeviceManager({ module: fakeControlModule as any });
        // first open should create device at fd=0
        const dev = await mgr.open(0x1111, 0x2222);
        expect(dev).toBeDefined();
        expect(dev!.fd).toBe(0);
        // second open with same vid/pid should return same instance
        const dev2 = await mgr.open(0x1111, 0x2222);
        expect(dev2).toBe(dev);
    });

    it('open reuses first undefined slot if present', async () => {
        const mgr = new mod.WebUsbDeviceManager({ module: fakeControlModule as any });
        // create one device to grow internal array
        const first = await mgr.open(1, 2);
        // manually create an undefined gap at index 1 and a defined device at index 2
        (mgr as any).webUsbDevices = [first, undefined, { fd: 2, vid: 9, pid: 9, open: vi.fn(async () => { }) }];
        // open new device should use slot index 1 (first undefined)
        const newDev = await mgr.open(3, 4);
        expect(newDev).toBeDefined();
        expect(newDev!.fd).toBe(1);
    });

    it('close returns false for invalid fd and true for valid', async () => {
        const mgr = new mod.WebUsbDeviceManager({ module: fakeControlModule as any });
        // nothing opened => close invalid fd
        expect(await mgr.close(-1)).toBe(false);
        expect(await mgr.close(0)).toBe(false);

        const dev = await mgr.open(10, 11);
        expect(dev).toBeDefined();
        const ok = await mgr.close(dev!.fd);
        expect(ok).toBe(true);
        // after close device slot should be undefined
        expect(mgr.getDevice(dev!.fd)).toBeUndefined();
    });

    it('getDevice and getDevices reflect current state', async () => {
        const mgr = new mod.WebUsbDeviceManager({ module: fakeControlModule as any });
        const d0 = await mgr.open(0xa, 0xb);
        const d1 = await mgr.open(0xc, 0xd);
        const devices = mgr.getDevices();
        expect(Array.isArray(devices)).toBe(true);
        expect(devices).toContain(d0!.fd);
        expect(devices).toContain(d1!.fd);

        // out-of-range returns undefined
        expect(mgr.getDevice(999)).toBeUndefined();
    });
});