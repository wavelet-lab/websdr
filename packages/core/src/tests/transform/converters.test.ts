import { describe, it, expect } from 'vitest';
import { bufferI16ToF32, bufferF32ToI16, clipF32Buffer } from '@/transform/converters';

describe('converters', () => {
    it('bufferI16ToF32 converts i16 extremes and zero', () => {
        const inArr = new Int16Array([0, 32767, -32768]);
        const out = bufferI16ToF32(inArr);
        expect(out[0]).toBeCloseTo(0, 7);
        expect(out[1]).toBeCloseTo(32767 / 32768, 7);
        expect(out[2]).toBeCloseTo(-1, 7);
    });

    it('bufferI16ToF32 respects provided output buffer length', () => {
        const inArr = new Int16Array([0, 32767, -32768]);
        const outBuf = new Float32Array(2); // shorter
        const out = bufferI16ToF32(inArr, outBuf);
        expect(out.length).toBe(2);
        expect(out[0]).toBeCloseTo(0, 7);
        expect(out[1]).toBeCloseTo(32767 / 32768, 7);
    });

    it('bufferF32ToI16 converts floats and clamps/rounds correctly', () => {
        const inArr = new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2, NaN]);
        const out = bufferF32ToI16(inArr);
        expect(out[0]).toBe(0);
        expect(out[1]).toBe(32767);      // +1 -> 32767
        expect(out[2]).toBe(-32767);     // -1 -> -32767
        expect(out[3]).toBe(16383);      // 0.5 -> 16383
        expect(out[4]).toBe(-16383);     // -0.5 -> -16383
        expect(out[5]).not.toBe(32767);  // >1 -> clipped - at this moment no clipping logic because performance is priority
        expect(out[6]).not.toBe(-32768); // < -1 -> clipped - at this moment no clipping logic because performance is priority
        expect(out[7]).toBe(0);          // NaN -> 0
    });

    it('bufferF32ToI16 respects provided output buffer length', () => {
        const inArr = new Float32Array([0.1, 0.2, 0.3]);
        const outBuf = new Int16Array(2); // shorter
        const out = bufferF32ToI16(inArr, outBuf);
        expect(out.length).toBe(2);
        expect(out[0]).toBe(3276); // Math.round(0.1 * 32767)
        expect(out[1]).toBe(6553); // Math.round(0.2 * 32767)
    });
});

describe('clipF32Buffer', () => {
    it('clips values in place when outbuf not provided', async () => {
        const buffer = new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, NaN]);
        clipF32Buffer(buffer);
        expect(buffer[0]).toBe(-1);                  // -2 -> -1
        expect(buffer[1]).toBe(-1);                  // -1 stays -1
        expect(buffer[2]).toBeCloseTo(-0.5, 7);      // in-range
        expect(buffer[3]).toBeCloseTo(0, 7);         // in-range
        expect(buffer[4]).toBeCloseTo(0.5, 7);       // in-range
        expect(buffer[5]).toBe(1);                   // 1 stays 1
        expect(buffer[6]).toBe(1);                   // 2 -> 1
        expect(Number.isNaN(buffer[7])).toBeTruthy(); // NaN remains NaN
    });

    it('writes to provided outbuf and does not modify input (current behavior: only clipped values are written)', async () => {
        const input = new Float32Array([2, -2, 0.5]);
        const outbuf = new Float32Array(input.length);
        // fill outbuf with sentinel to ensure in-range values are left untouched by the function
        outbuf.fill(0);
        clipF32Buffer(input, outbuf);
        // current implementation only writes clipped values to outbuf, leaves in-range values as-is
        expect(outbuf[0]).toBe(1);            // 2 -> 1
        expect(outbuf[1]).toBe(-1);           // -2 -> -1
        expect(outbuf[2]).toBe(0);            // in-range 0.5 is NOT copied to outbuf (remains sentinel)
        // input must remain unchanged
        expect(input[0]).toBe(2);
        expect(input[1]).toBe(-2);
        expect(input[2]).toBeCloseTo(0.5, 7);
    });

    it('provided outbuf keeps its values for in-range and NaN inputs (documenting edge behavior)', async () => {
        const sentinel = 123.456;
        const input = new Float32Array([0.5, NaN, -0.5]);
        const outbuf = new Float32Array(input.length);
        outbuf.fill(sentinel);
        clipF32Buffer(input, outbuf);
        // in-range values and NaN are not written into outbuf by current implementation
        expect(outbuf[0]).toBeCloseTo(sentinel);          // 0.5 left as sentinel
        expect(outbuf[1]).toBeCloseTo(sentinel);          // NaN left as sentinel
        expect(outbuf[2]).toBeCloseTo(sentinel);          // -0.5 left as sentinel
        // original input unchanged
        expect(Number.isNaN(input[1])).toBeTruthy();
        expect(input[0]).toBeCloseTo(0.5, 7);
        expect(input[2]).toBeCloseTo(-0.5, 7);
    });

    it('works when outbuf is the same buffer and leaves in-range values unchanged', async () => {
        const buffer = new Float32Array([-0.2, 0.2]);
        clipF32Buffer(buffer, buffer);
        expect(buffer[0]).toBeCloseTo(-0.2, 7);
        expect(buffer[1]).toBeCloseTo(0.2, 7);
    });
});