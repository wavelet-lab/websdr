import { describe, expect, test } from 'vitest';
import {
  transformData,
  getSampleByteLength,
  getElementsPerSample,
  getSamplesCount,
  getElementsCount,
  getDataView,
  createTypedArray,
} from '@/transform/transformdata';
import { DataType, StreamDataType } from '@/common/types';
import { alawEncode, alawDecode } from '@/transform/compressors';

describe('transformdata utilities', () => {
  test('createTypedArray and element/sample helpers', () => {
    const arr = createTypedArray(DataType.cf32, 4);
    expect(arr).toBeInstanceOf(Float32Array);
    expect(arr.length).toBe(4 * getElementsPerSample(DataType.cf32));

    const byteLen = getSampleByteLength(DataType.f32) * 10;
    expect(getSamplesCount(DataType.f32, byteLen)).toBe(10);
    expect(getElementsCount(DataType.f32, byteLen)).toBe(Math.floor(byteLen / getElementsPerSample(DataType.f32) / getSampleByteLength(DataType.f32) * getElementsPerSample(DataType.f32)) || 10);
  });

  test('getDataView returns correct typed views and same-type copy in transformData', () => {
    const inArr = new Float32Array([1.5, -2.5, 3.25]);
    const outArr = new Float32Array(inArr.length);
    transformData(
      { type: DataType.f32, buffer: inArr.buffer, offset: 0, length: inArr.length },
      { type: DataType.f32, buffer: outArr.buffer, offset: 0, length: outArr.length }
    );
    expect(Array.from(outArr)).toEqual(Array.from(inArr));

    const view = getDataView({ type: DataType.f32, buffer: inArr.buffer, offset: 0, length: inArr.length });
    expect(view).toBeInstanceOf(Float32Array);
  });

  test('f32 -> alaw -> f32 roundtrip (quantized) via transformData', () => {
    const input = new Float32Array([0, 0.1, -0.2, 0.9, -0.9]);
    const alawBuf = new Uint8Array(input.length);

    transformData(
      { type: DataType.f32, buffer: input.buffer, offset: 0, length: input.length },
      { type: StreamDataType.alaw, buffer: alawBuf.buffer, offset: 0, length: alawBuf.length }
    );

    const out = new Float32Array(input.length);
    transformData(
      { type: StreamDataType.alaw, buffer: alawBuf.buffer, offset: 0, length: alawBuf.length },
      { type: DataType.f32, buffer: out.buffer, offset: 0, length: out.length }
    );

    for (let i = 0; i < input.length; ++i) {
      const expected = alawDecode(alawEncode(input[i]! * 0x7000)) / 0x8000;
      expect(out[i]).toBeCloseTo(expected, 6);
    }
  });
});
