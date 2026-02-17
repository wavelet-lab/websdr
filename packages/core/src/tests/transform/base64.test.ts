import { describe, it, expect } from 'vitest'
import { Buffer } from 'buffer';
import { base64ToUint8Array, uint8ArrayToBase64 } from '@/transform/base64'

function randomBytes(len: number): Uint8Array {
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
}

describe('base64 transform', () => {
    it('roundtrip small arrays', () => {
        const samples = [new Uint8Array([]), new Uint8Array([0, 1, 2, 3, 255]), randomBytes(100)];
        for (const s of samples) {
            const b64 = uint8ArrayToBase64(s);
            const fromB64 = base64ToUint8Array(b64);
            expect(fromB64).toEqual(s);
        }
    });

    it('matches Node Buffer base64 encoding', () => {
        const bytes = randomBytes(1024);
        // Buffer conversion
        const expectedB64 = Buffer.from(bytes).toString('base64');
        const gotB64 = uint8ArrayToBase64(bytes);
        expect(gotB64).toBe(expectedB64);

        const decoded = base64ToUint8Array(expectedB64);
        expect(decoded).toEqual(bytes);
    });

    it('handles large arrays (chunking)', () => {
        // larger than internal chunk size (0x8000 == 32768)
        const size = 70000;
        const bytes = randomBytes(size);
        const expectedB64 = Buffer.from(bytes).toString('base64');
        const gotB64 = uint8ArrayToBase64(bytes);
        expect(gotB64).toBe(expectedB64);

        const decoded = base64ToUint8Array(expectedB64);
        expect(decoded).toEqual(bytes);
    });
});
