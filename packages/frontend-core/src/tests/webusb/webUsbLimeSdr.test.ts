import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebUsbLimeSdr } from '@/webusb/webUsbLimeSdr';
import { DataType, COMPLEX_INT16_SIZE } from '@websdr/core/common';

const mkParams = () => ({ fd: 0, vid: 0x1111, pid: 0x2222, module: {} as any });

describe('WebUsbLimeSdr', () => {
    let inst: WebUsbLimeSdr;

    beforeEach(() => {
        // stub navigator safely in Node test env
        vi.stubGlobal('navigator', { usb: { addEventListener: () => { }, removeEventListener: () => { }, getDevices: async () => [] } } as any);
        inst = new WebUsbLimeSdr(mkParams());
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('_fillHeader throws for too small buffer and for non-multiple-of-4 samples', () => {
        const small = new ArrayBuffer(WebUsbLimeSdr.HEADER_SIZE - 1);
        expect(() => (inst as any)._fillHeader(small, 0, false, BigInt(1), 4)).toThrow();

        const okBuf = new ArrayBuffer(WebUsbLimeSdr.HEADER_SIZE);
        expect(() => (inst as any)._fillHeader(okBuf, 0, false, BigInt(1), 3)).toThrow(/multiple of 4/);
    });

    it('_fillHeader writes expected header fields', () => {
        const buf = new ArrayBuffer(WebUsbLimeSdr.HEADER_SIZE);
        const ts = BigInt(0x1122334455667788n);
        (inst as any)._fillHeader(buf, 0, true, ts, 4);

        const dv = new DataView(buf);
        // discard flag in high nibble -> 1 << 4 = 0x10
        expect(dv.getUint8(0)).toBe(0x10);
        // samples * COMPLEX_INT16_SIZE
        expect(dv.getUint16(1, true)).toBe(4 * COMPLEX_INT16_SIZE);
        // timestamp written at offset 8
        expect(dv.getBigUint64(8, true)).toBe(ts);
    });

    it('packet size / samples count helpers are consistent', () => {
        const spp = WebUsbLimeSdr.SAMPLES_PER_PACKET;
        // one packet worth of samples -> packet size
        expect(inst.getRXPacketSize(spp)).toBe(WebUsbLimeSdr.PACKET_SIZE);
        // less than one packet -> aligned-down samples = 0
        expect(inst.getRXSamplesCount(spp - 1)).toBe(0);
        // TX packet size for exact multiple of samples should be integer multiple
        const txSize = inst.getTXPacketSize(spp * 3);
        expect(txSize % WebUsbLimeSdr.PACKET_SIZE).toBe(0);
    });

    it('encodeTxData produces buffer with expected length and header present', async () => {
        const samplesCnt = WebUsbLimeSdr.SAMPLES_PER_PACKET + 4; // >1 packet last partial
        const byteLen = samplesCnt * COMPLEX_INT16_SIZE;
        const dataBuf = new ArrayBuffer(byteLen);
        const txBuf = {
            datatype: DataType.ci16,
            data: dataBuf,
            byteLength: dataBuf.byteLength,
            byteOffset: 0,
            timestamp: BigInt(1234),
            discard_timestamp: false,
        } as any;

        const out = await inst.encodeTxData(txBuf);
        const expectedSize = inst.getTXPacketSize(samplesCnt);
        expect(out.byteLength).toBe(expectedSize);

        // verify first header in output
        const dv = new DataView(out, 0, WebUsbLimeSdr.HEADER_SIZE);
        // timestamp at offset 8 equals original timestamp
        expect(dv.getBigUint64(8, true)).toBe(BigInt(1234));
    });

    it('decodeRxData decodes single-packet buffer and returns RXBuffer', async () => {
        const spp = WebUsbLimeSdr.SAMPLES_PER_PACKET;
        // create a single packet buffer
        const ab = new ArrayBuffer(WebUsbLimeSdr.PACKET_SIZE);
        // fill header
        (inst as any)._fillHeader(ab, 0, false, BigInt(1000), spp);
        // fill payload with incremental bytes for simple verification
        const payload = new Uint8Array(ab, WebUsbLimeSdr.HEADER_SIZE);
        for (let i = 0; i < payload.length; i++) payload[i] = (i & 0xff);

        const dv = new DataView(ab);
        const reqSamples = spp;
        const rx = await inst.decodeRxData(dv, reqSamples, { datatype: DataType.ci16, id: 7 });
        expect(rx).toHaveProperty('data');
        expect(rx.samples).toBeGreaterThanOrEqual(reqSamples);
        expect(rx.id).toBe(7);
        expect(rx.recvsize).toBe(WebUsbLimeSdr.PACKET_SIZE);
    });
});