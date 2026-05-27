import { describe, it, expect, vi } from 'vitest';
import { Allocator } from '@/utils/allocator';

function createMockModule() {
    let nextPtr = 1000; // start of free memory
    const buf = new ArrayBuffer(4096);
    const mod = {
        HEAPU8: new Uint8Array(buf),
        HEAP8: new Int8Array(buf),
        HEAPU16: new Uint16Array(buf),
        HEAP16: new Int16Array(buf),
        HEAPU32: new Uint32Array(buf),
        HEAP32: new Int32Array(buf),
        HEAPF32: new Float32Array(buf),
        _malloc: vi.fn((size: number) => {
            const p = nextPtr;
            nextPtr += size;
            return p;
        }),
        _free: vi.fn((p: number) => {
            // noop
        })
    } as unknown as EmscriptenModule;
    return mod;
}

describe('Allocator', () => {
    const cases: Array<[string, any, number]> = [
        ['allocUint8Buffer', Uint8Array, Uint8Array.BYTES_PER_ELEMENT],
        ['allocInt8Buffer', Int8Array, Int8Array.BYTES_PER_ELEMENT],
        ['allocUint16Buffer', Uint16Array, Uint16Array.BYTES_PER_ELEMENT],
        ['allocInt16Buffer', Int16Array, Int16Array.BYTES_PER_ELEMENT],
        ['allocUint32Buffer', Uint32Array, Uint32Array.BYTES_PER_ELEMENT],
        ['allocInt32Buffer', Int32Array, Int32Array.BYTES_PER_ELEMENT],
        ['allocFloat32Buffer', Float32Array, Float32Array.BYTES_PER_ELEMENT]
    ];

    for (const [method, ctor, bytes] of cases) {
        it(`${method} returns correct typed array view`, () => {
            const mod = createMockModule();
            const a = new Allocator(mod);
            const size = 64; // bytes
            // call specific allocator method
            // @ts-ignore - dynamic call of method
            const view = (a as any)[method](size);

            expect(view).toBeInstanceOf(ctor);
            expect(view.length).toBe(size / bytes);
            expect(view.buffer).toBe(mod.HEAPU8.buffer);
            // ensure malloc was called
            expect(mod._malloc).toHaveBeenCalled();
        });
    }

    it('alloc and dealloc call malloc/free with same pointer', () => {
        const mod = createMockModule();
        const a = new Allocator(mod);
        const size = 32;
        const ptr = a.alloc(size);
        expect(mod._malloc).toHaveBeenCalledWith(size);
        a.dealloc();
        expect(mod._free).toHaveBeenCalledWith(ptr);
    });

    it('alloc throws if module is undefined', () => {
        const a = new Allocator(undefined as any);
        expect(() => a.alloc(8)).toThrow();
    });
});
