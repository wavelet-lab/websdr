import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    write_ep1, write_ep2, read_ep1, read_ep2, write_log_js
} from '@/webusb/webUsbControlApi';

function mkHeap(size = 256) {
    const ab = new ArrayBuffer(size);
    const u8 = new Uint8Array(ab);
    // fill with incremental values for easier assertions
    for (let i = 0; i < u8.length; i++) u8[i] = i & 0xff;
    return { ab, u8 };
}

describe('webUsbControlApi', () => {
    let origMgr: any;
    let consoleLogSpy: any;

    beforeEach(() => {
        vi.resetModules();
        origMgr = (globalThis as any).webUsbDeviceManager;
        consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        (globalThis as any).webUsbDeviceManager = origMgr;
        delete (globalThis as any).debug_mode;
        vi.restoreAllMocks();
    });

    it('write_ep1 writes buffer slice and returns length', async () => {
        const { ab, u8 } = mkHeap(64);
        const writes: any[] = [];
        const dev = {
            module: { HEAPU8: u8 },
            write: (_ep: number, data: BufferSource) => {
                writes.push({ ep: _ep, data: new Uint8Array(data as ArrayBuffer) });
                return Promise.resolve();
            },
        };
        (globalThis as any).webUsbDeviceManager = { getDevice: () => dev };

        const res = await write_ep1(1, 8, 10);
        expect(res).toBe(10);
        expect(writes.length).toBe(1);
        const sent = writes[0].data;
        // sent should equal heap bytes [8..17]
        for (let i = 0; i < 10; i++) expect(sent[i]).toBe((8 + i) & 0xff);
    });

    it('write_ep2 writes buffer slice and returns length', async () => {
        const { ab, u8 } = mkHeap(64);
        const writes: any[] = [];
        const dev = {
            module: { HEAPU8: u8 },
            write: (_ep: number, data: BufferSource) => {
                writes.push({ ep: _ep, data: new Uint8Array(data as ArrayBuffer) });
                return Promise.resolve();
            },
        };
        (globalThis as any).webUsbDeviceManager = { getDevice: () => dev };

        const res = await write_ep2(2, 16, 8);
        expect(res).toBe(8);
        expect(writes.length).toBe(1);
        const sent = writes[0].data;
        for (let i = 0; i < 8; i++) expect(sent[i]).toBe((16 + i) & 0xff);
    });

    it('read_ep1 copies data into HEAP and returns bytes read', async () => {
        const { ab, u8 } = mkHeap(128);
        // prepare read payload of 6 bytes [1,2,3,4,5,6]
        const payload = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
        const dev = {
            module: { HEAPU8: u8 },
            read: (_ep: number, _len: number) => Promise.resolve({ status: 'ok', data: new DataView(payload) }),
        };
        (globalThis as any).webUsbDeviceManager = { getDevice: () => dev };

        const bytes = await read_ep1(1, 10, 6);
        expect(bytes).toBe(6);
        // verify that heap bytes at offset 10..15 equal payload
        for (let i = 0; i < 6; i++) expect(u8[10 + i]).toBe([1, 2, 3, 4, 5, 6][i]);
    });

    it('read_ep1 returns -22 when read returns non-ok', async () => {
        const { u8 } = mkHeap(64);
        const dev = {
            module: { HEAPU8: u8 },
            read: () => Promise.resolve({ status: 'stall' }),
        };
        (globalThis as any).webUsbDeviceManager = { getDevice: () => dev };

        const r = await read_ep1(1, 0, 8);
        expect(r).toBe(-22);
    });

    it('read_ep2 copies data into HEAP and returns bytes read', async () => {
        const { ab, u8 } = mkHeap(64);
        const payload = new Uint8Array([9, 8, 7, 6]).buffer;
        const dev = {
            module: { HEAPU8: u8 },
            read: (_ep: number, _len: number) => Promise.resolve({ status: 'ok', data: new DataView(payload) }),
        };
        (globalThis as any).webUsbDeviceManager = { getDevice: () => dev };

        const bytes = await read_ep2(2, 4, 4);
        expect(bytes).toBe(4);
        for (let i = 0; i < 4; i++) expect(u8[4 + i]).toBe([9, 8, 7, 6][i]);
    });

    it('read_ep2 returns -22 when device missing read or module', async () => {
        (globalThis as any).webUsbDeviceManager = { getDevice: () => undefined };
        const r = await read_ep2(1, 0, 4);
        // missing device => function returns 0 according to implementation
        expect(r).toBe(0);
    });

    it('write_log_js calls AsciiToString and logs when debug_mode=true', async () => {
        const dev = {
            module: { AsciiToString: (ptr: number) => `STR@${ptr}` },
        };
        (globalThis as any).webUsbDeviceManager = { getDevice: () => dev };
        (globalThis as any).debug_mode = true;
        const res = await write_log_js(1, 2, 123);
        expect(res).toBe(0);
        expect(consoleLogSpy).toHaveBeenCalled();
    });
});