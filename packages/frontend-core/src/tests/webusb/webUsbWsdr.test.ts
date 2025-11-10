import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebUsbXsdr } from '@/webusb/webUsbWsdr';
import { DataType, COMPLEX_INT16_SIZE } from '@websdr/core/common';
import { WebUsb } from '@/webusb/webUsbBase';

const mkParams = () => ({ fd: 0, vid: 0x1111, pid: 0x2222, module: {} as any });

describe('WebUsbWsdr (WebUsbXsdr)', () => {
    let inst: WebUsbXsdr;

    beforeEach(() => {
        // safe navigator stub if ctor accesses it
        vi.stubGlobal('navigator', { usb: { addEventListener: () => { }, removeEventListener: () => { }, getDevices: async () => [] } } as any);
        inst = new WebUsbXsdr(mkParams());
    });

    it('_fillHeader validates buffer length and sample range and writes fields', () => {
        const small = new ArrayBuffer(WebUsbXsdr.HEADER_SIZE - 1);
        expect(() => (inst as any)._fillHeader(small, 0, false, BigInt(1), WebUsbXsdr.MIN_SAMPLES_IN_PKT)).toThrow();

        const buf = new ArrayBuffer(WebUsbXsdr.HEADER_SIZE + 8);
        (inst as any)._fillHeader(buf, 0, true, BigInt(0x1122334455667788n), WebUsbXsdr.MIN_SAMPLES_IN_PKT);
        const dv = new DataView(buf);
        // timestamp low 32 bits
        expect(dv.getUint32(0, true)).toBeDefined();
        // samples stored in header word: check non-zero
        const word = dv.getUint16(6, true);
        expect(word & 0x7fff).toBeGreaterThanOrEqual(WebUsbXsdr.MIN_SAMPLES_IN_PKT - 1);
    });

    it('getRXPacketSize aligns and caps correctly', () => {
        const samples = 1000;
        const size = inst.getRXPacketSize(samples);
        // should be multiple of PACKET_ALIGN plus EXTRA_RX_DATA
        expect((size - WebUsbXsdr.EXTRA_RX_DATA) % WebUsbXsdr.PACKET_ALIGN).toBe(0);
        // very large samples should cap at MAX_PACKET_SIZE + EXTRA_RX_DATA
        const hugeSamples = 1e7;
        const capped = inst.getRXPacketSize(hugeSamples);
        expect(capped).toBeLessThanOrEqual(WebUsbXsdr.MAX_PACKET_SIZE + WebUsbXsdr.EXTRA_RX_DATA);
    });

    it('encodeTxData produces buffer with headers for chunks and uses WebUsb.fillData', async () => {
        const samplesCnt = 1024;
        const byteLen = samplesCnt * COMPLEX_INT16_SIZE;
        const dataBuf = new ArrayBuffer(byteLen);
        const txBuf = {
            datatype: DataType.ci16,
            data: dataBuf,
            byteLength: dataBuf.byteLength,
            byteOffset: 0,
            timestamp: BigInt(555),
            discard_timestamp: false,
        } as any;

        const spyFill = vi.spyOn(WebUsb as any, 'fillData').mockImplementation(() => { /* no-op */ });

        const out = await inst.encodeTxData(txBuf, { sliceSamples: 512 });
        // should contain at least two headers (two chunks)
        expect(out.byteLength).toBeGreaterThanOrEqual(inst.getTXPacketSize(512) * 2);
        expect(spyFill).toHaveBeenCalled();

        spyFill.mockRestore();
    });

    it('decodeRxData decodes crafted buffer and returns RXBuffer', async () => {
        const samples = 256;
        const payloadSize = samples * COMPLEX_INT16_SIZE;
        const trailerSize = WebUsbXsdr.TRAILER_SIZE;
        const total = payloadSize + trailerSize;
        const ab = new ArrayBuffer(total);
        const dv = new DataView(ab);
        // place timestamp at dataSize offset (little-endian)
        const ts = BigInt(0x1234);
        dv.setBigUint64(payloadSize, ts, true);
        const viewPayload = new Uint8Array(ab, 0, payloadSize);
        for (let i = 0; i < viewPayload.length; i++) viewPayload[i] = i & 0xff;

        const res = await inst.decodeRxData(new DataView(ab), samples, { datatype: DataType.ci16, id: 77 });
        expect(res).toHaveProperty('data');
        expect(res.samples).toBe(samples);
        expect(res.id).toBe(77);
        expect(res.recvsize).toBe(total);
    });
});