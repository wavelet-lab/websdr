export function alawEncode(input: number): number {
    let mask = 0x8000;
    const sign = (input & mask) >> 8;
    if (sign) input = ~input;
    let shift = 0b111;
    for (; shift > 0; --shift) {
        if (input & mask) break;
        mask >>= 1;
    }
    input >>= 4 + shift;
    const output = sign + (shift << 4) + input;

    return output;
}

export function alawDecode(input: number): number {
    const sign = input & 0x80;
    const shift = (input >> 4) & 0x7;
    let output = ((shift ? 0x10 : 0) | (input & 0x0f)) << (shift + (shift ? 3 : 4));
    if (sign) output = ~output;
    return output;
}

export function alawEncodeBuffer(input: Int16Array, outbuf?: Uint8Array): Uint8Array {
    const output = outbuf ? outbuf : new Uint8Array(input.length);
    const len = Math.min(input.length, output.length);
    for (let i = 0; i < len; ++i) {
        output[i] = alawEncode(input[i]!);
    }
    return output;
}

export function alawDecodeBuffer(input: Uint8Array, outbuf?: Int16Array): Int16Array {
    const output = outbuf ? outbuf : new Int16Array(input.length);
    const len = Math.min(input.length, output.length);
    for (let i = 0; i < len; ++i) {
        output[i] = alawDecode(input[i]!);
    }
    return output;
}

export function alawEncodeBufferF32(input: Float32Array, outbuf?: Uint8Array): Uint8Array {
    const output = outbuf ? outbuf : new Uint8Array(input.length);
    const len = Math.min(input.length, output.length);
    for (let i = 0; i < len; ++i) {
        output[i] = alawEncode(input[i]!  * 0x7000);
    }
    return output;
}

export function alawDecodeBufferF32(input: Uint8Array, outbuf?: Float32Array): Float32Array {
    const output = outbuf ? outbuf : new Float32Array(input.length);
    const len = Math.min(input.length, output.length);
    for (let i = 0; i < len; ++i) {
        output[i] = alawDecode(input[i]!) / 0x8000;
    }
    return output;
}
