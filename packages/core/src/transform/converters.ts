/**
 * Converts an Int16Array buffer to a Float32Array buffer.
 * @param input The input Int16Array buffer.
 * @param outbuf The output Float32Array buffer (optional)
 *        if not provided, a new buffer will be created.
 * @returns The converted Float32Array buffer.
 */
export function bufferI16ToF32(input: Int16Array, outbuf?: Float32Array): Float32Array {
    const output = outbuf ? outbuf : new Float32Array(input.length);
    const len = Math.min(input.length, output.length);
    for (let i = 0; i < len; ++i) {
        output[i] = input[i]! / 0x8000;
    }
    return output;
}

/**
 * Converts a Float32Array buffer to an Int16Array buffer.
 * It intentionally doesn't clip values outside the -1.0 to 1.0 range
 * because performance is more important in this context.
 * @param input The input Float32Array buffer.
 * @param outbuf The output Int16Array buffer (optional)
 *        if not provided, a new buffer will be created.
 * @returns The converted Int16Array buffer.
 */
export function bufferF32ToI16(input: Float32Array, outbuf?: Int16Array): Int16Array {
    const output = outbuf ? outbuf : new Int16Array(input.length);
    const len = Math.min(input.length, output.length);
    for (let i = 0; i < len; ++i) {
        output[i] = input[i]! * 0x7fff;
    }
    return output;
}

/**
 * Clips the values in a Float32Array buffer to the -1.0 to 1.0 range.
 * @param buffer The Float32Array buffer to clip.
 * @param outbuf The output Float32Array buffer (optional)
 *        if not provided, the input buffer will be modified in place.
 */
export function clipF32Buffer(buffer: Float32Array, outbuf?: Float32Array): void {
    const output = outbuf ? outbuf : buffer;
    const len = buffer.length;
    for (let i = 0; i < len; ++i) {
        if (buffer[i]! > 1.0) {
            output[i] = 1.0;
        } else if (buffer[i]! < -1.0) {
            output[i] = -1.0;
        }
    }
}
