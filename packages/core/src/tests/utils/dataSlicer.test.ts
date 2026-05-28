import { describe, expect, test } from 'vitest';
import { DataSlicer } from '@/utils/dataSlicer';
import type { DataSlicerParams } from '@/utils/dataSlicer';
import { DataType } from '@/common/types';

describe('DataSlicer', () => {
  test('reinitialize and basic pushBack behavior', () => {
    const params: DataSlicerParams = { datatype: DataType.i16, bufferSamplesSize: 8, buffersCount: 2 };
    const slicer = new DataSlicer(params);
    expect(slicer.capacity()).toBe(2);
    expect(slicer.size()).toBe(0);

    const input = new Int16Array([10, 20, 30]);
    slicer.pushBack(input.buffer, 0, input.length * Int16Array.BYTES_PER_ELEMENT, 0, 0n);

    const front = slicer.front();
    expect(front).toBeDefined();
    expect(front!.bufferFilled).toBe(input.length);

    const view = new Int16Array(front!.buffer);
    expect(Array.from(view.slice(0, input.length))).toEqual(Array.from(input));
  });
});
