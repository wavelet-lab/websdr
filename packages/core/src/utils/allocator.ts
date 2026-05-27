export class Allocator {
    private pointer: number = 0;
    private module: EmscriptenModule | undefined;

    constructor(module: EmscriptenModule | undefined) {
        this.module = module;
    }

    alloc(sizeOfBuffer: number): number {
        if (!this.module) throw new Error('Module with malloc is undefined');
        this.pointer = this.module._malloc(sizeOfBuffer);
        return this.pointer;
    }

    allocFloat32Buffer(sizeOfBuffer: number) {
        if (!this.module) throw new Error('Module with malloc is undefined');
        const pointer = this.alloc(sizeOfBuffer);
        return new Float32Array(this.module.HEAPF32.buffer, pointer, sizeOfBuffer / Float32Array.BYTES_PER_ELEMENT);
    }

    allocUint32Buffer(sizeOfBuffer: number) {
        if (!this.module) throw new Error('Module with malloc is undefined');
        const pointer = this.alloc(sizeOfBuffer);
        return new Uint32Array(this.module.HEAPU32.buffer, pointer, sizeOfBuffer / Uint32Array.BYTES_PER_ELEMENT);
    }

    allocInt32Buffer(sizeOfBuffer: number) {
        if (!this.module) throw new Error('Module with malloc is undefined');
        const pointer = this.alloc(sizeOfBuffer);
        return new Int32Array(this.module.HEAP32.buffer, pointer, sizeOfBuffer / Int32Array.BYTES_PER_ELEMENT);
    }

    allocUint16Buffer(sizeOfBuffer: number) {
        if (!this.module) throw new Error('Module with malloc is undefined');
        const pointer = this.alloc(sizeOfBuffer);
        return new Uint16Array(this.module.HEAPU16.buffer, pointer, sizeOfBuffer / Uint16Array.BYTES_PER_ELEMENT);
    }

    allocInt16Buffer(sizeOfBuffer: number) {
        if (!this.module) throw new Error('Module with malloc is undefined');
        const pointer = this.alloc(sizeOfBuffer);
        return new Int16Array(this.module.HEAP16.buffer, pointer, sizeOfBuffer / Int16Array.BYTES_PER_ELEMENT);
    }

    allocUint8Buffer(sizeOfBuffer: number) {
        if (!this.module) throw new Error('Module with malloc is undefined');
        const pointer = this.alloc(sizeOfBuffer);
        return new Uint8Array(this.module.HEAPU8.buffer, pointer, sizeOfBuffer / Uint8Array.BYTES_PER_ELEMENT);
    }

    allocInt8Buffer(sizeOfBuffer: number) {
        if (!this.module) throw new Error('Module with malloc is undefined');
        const pointer = this.alloc(sizeOfBuffer);
        return new Int8Array(this.module.HEAP8.buffer, pointer, sizeOfBuffer / Int8Array.BYTES_PER_ELEMENT);
    }

    dealloc() {
        if (!this.pointer) return;
        if (!this.module) throw new Error('Module with malloc is undefined');
        this.module._free(this.pointer);
        this.pointer = 0;
    }
}
