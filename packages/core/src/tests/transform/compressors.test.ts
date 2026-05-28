import { describe, expect, test } from 'vitest';
import {
    alawEncodeBuffer,
    alawDecodeBuffer,
    alawEncodeBufferF32,
    alawDecodeBufferF32,
    alawEncode,
    alawDecode,
} from '@/transform/compressors';

describe('A-law compressors', () => {
    test('Int16Array roundtrip is exact', () => {
        const input = Int16Array.from([0, 1, 15, 31, 127, 1023, -1, -32768, 12345, -12345]);
        const encoded = alawEncodeBuffer(input);
        expect(encoded).toBeInstanceOf(Uint8Array);
        const decoded = alawDecodeBuffer(encoded);
        expect(decoded.length).toBe(input.length);
        for (let i = 0; i < input.length; ++i) {
            const expected = alawDecode(alawEncode(input[i]!));
            expect(decoded[i]).toBe(expected);
        }
    });

    test('Float32Array roundtrip is approximately equal', () => {
        const input = Float32Array.from([0, 0.1, -0.5, 0.99, -0.99, 0.1234, -0.2345]);
        const encoded = alawEncodeBufferF32(input);
        expect(encoded).toBeInstanceOf(Uint8Array);
        const decoded = alawDecodeBufferF32(encoded);
        expect(decoded.length).toBe(input.length);
        for (let i = 0; i < input.length; ++i) {
            const expected = alawDecode(alawEncode(input[i]! * 0x7000)) / 0x8000;
            expect(decoded[i]).toBeCloseTo(expected, 6);
        }
    });

    test('A-law matches encode/decode', () => {
        const code_test_data: Array<{ input: number, output: number, output2: number }> = [
            { input: 0b0000000000000000, output: 0b00000000, output2: 0b0000000000000000 },
            { input: 0b0000000000000001, output: 0b00000000, output2: 0b0000000000000000 },
            { input: 0b0000000000000011, output: 0b00000000, output2: 0b0000000000000000 },
            { input: 0b0000000000000111, output: 0b00000000, output2: 0b0000000000000000 },
            { input: 0b0000000000001111, output: 0b00000000, output2: 0b0000000000000000 },
            { input: 0b0000000000011111, output: 0b00000001, output2: 0b0000000000010000 },
            { input: 0b0000000000111111, output: 0b00000011, output2: 0b0000000000110000 },
            { input: 0b0000000001111111, output: 0b00000111, output2: 0b0000000001110000 },
            { input: 0b0000000011111111, output: 0b00001111, output2: 0b0000000011110000 },
            { input: 0b0000000111111111, output: 0b00011111, output2: 0b0000000111110000 },
            { input: 0b0000001111111111, output: 0b00101111, output2: 0b0000001111100000 },
            { input: 0b0000011111111111, output: 0b00111111, output2: 0b0000011111000000 },
            { input: 0b0000111111111111, output: 0b01001111, output2: 0b0000111110000000 },
            { input: 0b0001111111111111, output: 0b01011111, output2: 0b0001111100000000 },
            { input: 0b0011111111111111, output: 0b01101111, output2: 0b0011111000000000 },
            { input: 0b0111111111111111, output: 0b01111111, output2: 0b0111110000000000 },
        ];

        code_test_data.forEach(v => {
            const o = alawEncode(v.input);
            expect(o).toBe(v.output);
            const o2 = alawDecode(o);
            expect(o2).toBe(v.output2);
        });
    });
});
