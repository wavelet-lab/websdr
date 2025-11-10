import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebUsb, DefaultDeviceConfiguration } from '@/webusb/webUsbBase';
import { DataType } from '@websdr/core/common';

class TestWebUsb extends WebUsb {
    getConfiguration() {
        return DefaultDeviceConfiguration;
    }
    getRXSamplesCount(samples: number) {
        return samples;
    }
    getRXPacketSize(samples: number) {
        return samples * WebUsb.getSampleByteLength(DataType.ci16);
    }
    getTXPacketSize(samples: number) {
        return samples * WebUsb.getSampleByteLength(DataType.ci16);
    }
    async decodeRxData(): Promise<any> {
        return Promise.resolve({
            data: new ArrayBuffer(0),
            datatype: DataType.ci16,
            id: 0,
            samples: 0,
            timestamp: 0n,
            overrun: 0,
            realigned: 0,
            dropped: 0,
            recvsize: 0,
        });
    }
    async encodeTxData(data: any): Promise<ArrayBufferLike> {
        return data.data ?? new ArrayBuffer(0);
    }
}

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

function createMockModule() {
    return {
        _close_device: vi.fn(),
        _malloc: vi.fn().mockImplementation(() => Math.floor(Math.random() * 100000) + 1),
        _free: vi.fn(),
        stringToAscii: vi.fn(),
        AsciiToString: vi.fn().mockImplementation(() => '{"answer":"ok"}'),
        ccall: vi.fn().mockResolvedValue(0),
    };
}

function createMockUSBDevice(outs: Deferred<any>[]) {
    const transferOut = vi.fn().mockImplementation((_ep: number, buf: BufferSource) => {
        const d = outs.shift();
        if (!d) return Promise.resolve({ status: 'ok', bytesWritten: (buf as ArrayBufferLike).byteLength });
        return d.promise;
    });
    const transferIn = vi.fn().mockResolvedValue({ status: 'ok', data: new DataView(new ArrayBuffer(0)) });
    return {
        transferOut,
        transferIn,
        opened: true,
        close: vi.fn(),
        claimInterface: vi.fn(),
        selectConfiguration: vi.fn(),
        configuration: { interfaces: [{ interfaceNumber: 0 }] },
        vendorId: 0x1234,
        productId: 0xabcd,
        manufacturerName: 'MockVendor',
        productName: 'MockProduct',
        serialNumber: 'SN123',
        open: vi.fn(),
        reset: vi.fn(),
    } as unknown as USBDevice;
}

describe('WebUsb static utilities', () => {
    it('getSampleByteLength returns expected sizes', () => {
        expect(WebUsb.getSampleByteLength(DataType.ci16)).toBe(4);
        expect(WebUsb.getSampleByteLength(DataType.cf32)).toBe(8);
    });

    it('getSamplesCnt computes floor count by datatype', () => {
        expect(WebUsb.getSamplesCnt(DataType.ci16, 400)).toBe(100);
        expect(WebUsb.getSamplesCnt(DataType.cf32, 400)).toBe(50);
    });

    it('fillData copies and converts between ci16 and cf32', () => {
        const f32 = new Float32Array([-1, -0.5, 0, 0.25, 0.5, 0.75, 1, -0.25]);
        const i16buf = new ArrayBuffer(f32.byteLength); // same length in bytes works fine for convert helper
        WebUsb.fillData(DataType.ci16, i16buf, 0, DataType.cf32, f32.buffer, f32.byteOffset, f32.length);
        const i16 = new Int16Array(i16buf, 0, f32.length);
        // Basic monotonic/sign checks
        expect(i16.length).toBe(f32.length);
        expect(i16[0]).toBeLessThan(0);
        expect(i16[2]).toBe(0);
        expect(i16[i16.length - 1]).toBeLessThan(0);

        // Convert back and check approximate roundtrip
        const f32rtBuf = new ArrayBuffer(f32.byteLength);
        WebUsb.fillData(DataType.cf32, f32rtBuf, 0, DataType.ci16, i16buf, 0, i16.length);
        const f32rt = new Float32Array(f32rtBuf);
        const eps = 1e-3;
        for (let i = 0; i < f32.length; i++) {
            expect(Math.abs(f32rt[i]! - f32[i]!)).toBeLessThanOrEqual(0.02 + eps); // allow quantization
        }
    });

    it('fillData copies same-type arrays', () => {
        const src = new Int16Array([1, 2, -3, 4, -5, 6]);
        const dstBuf = new ArrayBuffer(src.byteLength);
        WebUsb.fillData(DataType.ci16, dstBuf, 0, DataType.ci16, src.buffer, 0, src.length);
        const dst = new Int16Array(dstBuf);
        expect(Array.from(dst)).toEqual(Array.from(src));
    });
});

describe('WebUsb command queue', () => {
    it('sendCommand resolves via runCommandPool', async () => {
        const module = createMockModule();
        const device = createMockUSBDevice([]);
        const inst = new TestWebUsb({ fd: 1, vid: 0, pid: 0, module: module as any });
        inst.device = device;

        const p = inst.sendCommand({ cmd: 'ping' });
        const res = await p;
        expect(res).toEqual({ answer: 'ok' });
        expect(module.ccall).toHaveBeenCalledWith(
            'send_command',
            'number',
            ['number', 'number', 'number', 'number', 'number'],
            expect.any(Array),
            { async: true }
        );
    });
});

describe('WebUsb TX queue limits', () => {
    beforeEach(() => {
        (WebUsb as any).MAX_SEND_DATA_REQUEST = 2;
    });

    it('sendTxRawPacket drops when queue full and allowDrop=true', async () => {
        const d1 = deferred<any>();
        const d2 = deferred<any>();
        const device = createMockUSBDevice([d1, d2]);
        const module = createMockModule();
        const inst = new TestWebUsb({ fd: 1, vid: 0, pid: 0, module: module as any });
        inst.device = device;

        const pkt = new ArrayBuffer(64);

        const p1 = inst.sendTxRawPacket(pkt);
        const p2 = inst.sendTxRawPacket(pkt);
        // third should drop immediately due to full queue
        await expect(inst.sendTxRawPacket(pkt, true)).rejects.toMatch(/packet dropped/);

        // Resolve first two writes
        d1.resolve({ status: 'ok', bytesWritten: pkt.byteLength });
        d2.resolve({ status: 'ok', bytesWritten: pkt.byteLength });

        await expect(p1).resolves.toMatchObject({ usbOutTransferResult: { status: 'ok' } });
        await expect(p2).resolves.toMatchObject({ usbOutTransferResult: { status: 'ok' } });
    });

    it('waitForChangeSendDataReq resolves when a TX completes', async () => {
        const d = deferred<any>();
        const device = createMockUSBDevice([d]);
        const module = createMockModule();
        const inst = new TestWebUsb({ fd: 1, vid: 0, pid: 0, module: module as any });
        inst.device = device;

        const pkt = new ArrayBuffer(16);
        const pending = inst.sendTxRawPacket(pkt); // increases queued count

        const waiter = inst.waitForChangeSendDataReq();
        d.resolve({ status: 'ok', bytesWritten: pkt.byteLength });

        await waiter; // should resolve when internal counter decremented
        await expect(pending).resolves.toMatchObject({ usbOutTransferResult: { status: 'ok' } });
    });
});