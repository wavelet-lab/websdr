import { DataType, StreamDataType } from "@/common/types";
import { bufferF32ToI16, bufferI16ToF32 } from "./converters";
import { COMPLEX_FLOAT_SIZE, COMPLEX_INT16_SIZE, FLOAT_SIZE, INT16_SIZE, INT8_SIZE } from "@/common/defines";
import { alawDecodeBuffer, alawDecodeBufferF32, alawEncodeBuffer, alawEncodeBufferF32 } from "@/transform/compressors";

export type TransformDataType = DataType | StreamDataType;
export type TransformArrayType = Float32Array | Int16Array | Int8Array | Uint8Array;

export interface BufferParams {
    type: TransformDataType,    // DataType or StreamDataType
    buffer: ArrayBufferLike,    // ArrayBuffer or SharedArrayBuffer
    offset?: number,            // byte offset
    length?: number,            // samples count
}

export function transformData(inBuffer: BufferParams, outBuffer: BufferParams) {
    // console.log('transformData: inBuffer =', inBuffer, ', outBuffer =', outBuffer);
    const inBufView = getDataView(inBuffer);
    const outBufView = getDataView(outBuffer);
    if (inBuffer.type === outBuffer.type) {
        outBufView.set(inBufView);
    } else if ((inBuffer.type === DataType.cf32 || inBuffer.type === DataType.f32) && (outBuffer.type === DataType.ci16 || outBuffer.type === DataType.i16)) {
        bufferF32ToI16(inBufView as Float32Array, outBufView as Int16Array);
    } else if ((inBuffer.type === DataType.ci16 || inBuffer.type === DataType.i16) && (outBuffer.type === DataType.cf32 || outBuffer.type === DataType.f32)) {
        bufferI16ToF32(inBufView as Int16Array, outBufView as Float32Array);
    } else if ((inBuffer.type === DataType.cf32 || inBuffer.type === DataType.f32) && outBuffer.type === StreamDataType.alaw) {
        alawEncodeBufferF32(inBufView as Float32Array, outBufView as Uint8Array);
    } else if (inBuffer.type === StreamDataType.alaw && (outBuffer.type === DataType.cf32 || outBuffer.type === DataType.f32)) {
        alawDecodeBufferF32(inBufView as Uint8Array, outBufView as Float32Array);
    } else if ((inBuffer.type === DataType.ci16 || inBuffer.type === DataType.i16) && outBuffer.type === StreamDataType.alaw) {
        alawEncodeBuffer(inBufView as Int16Array, outBufView as Uint8Array);
    } else if (inBuffer.type === StreamDataType.alaw && (outBuffer.type === DataType.ci16 || outBuffer.type === DataType.i16)) {
        alawDecodeBuffer(inBufView as Uint8Array, outBufView as Int16Array);
    } else {
        throw new Error(`transformData: unsupported data type combination: input type ${inBuffer.type}, output type ${outBuffer.type}`);
    }
}

export function getSampleByteLength(datatype: TransformDataType): number {
    switch (datatype) {
        case DataType.cf32:
            return COMPLEX_FLOAT_SIZE;
        case DataType.ci16:
            return COMPLEX_INT16_SIZE;
        case DataType.f32:
            return FLOAT_SIZE;
        case DataType.i16:
            return INT16_SIZE;
        case DataType.i8:
            return INT8_SIZE;
        case StreamDataType.alaw:
            return INT8_SIZE;
    }
    throw new Error(`getSampleByteLength: unsupported data type ${datatype}`)
}

export function getElementByteLength(datatype: TransformDataType): number {
    switch (datatype) {
        case DataType.cf32:
        case DataType.f32:
            return FLOAT_SIZE;
        case DataType.ci16:
        case DataType.i16:
            return INT16_SIZE;
        case DataType.i8:
        case StreamDataType.alaw:
            return INT8_SIZE;
    }
    throw new Error(`getSampleByteLength: unsupported data type ${datatype}`)
}

export function getElementsPerSample(datatype: TransformDataType): number {
    switch (datatype) {
        case DataType.cf32:
        case DataType.ci16:
            return 2;
        case DataType.f32:
        case DataType.i16:
        case DataType.i8:
        case StreamDataType.alaw:
            return 1;
    }
    throw new Error(`getElementsPerSample: unsupported data type ${datatype}`)
}

export function getSamplesCount(datatype: TransformDataType, byteLength: number): number {
    return Math.floor(byteLength / getSampleByteLength(datatype));
}

export function getElementsCount(datatype: TransformDataType, byteLength: number): number {
    return Math.floor(byteLength / getElementByteLength(datatype));
}

export function getDataView(bufferParams: BufferParams): TransformArrayType {
    // console.log('getDataView', bufferParams)
    switch (bufferParams.type) {
        case DataType.cf32:
            return new Float32Array(bufferParams.buffer, bufferParams.offset, bufferParams.length);
        case DataType.f32:
            return new Float32Array(bufferParams.buffer, bufferParams.offset, bufferParams.length);
        case DataType.ci16:
            return new Int16Array(bufferParams.buffer, bufferParams.offset, bufferParams.length);
        case DataType.i16:
            return new Int16Array(bufferParams.buffer, bufferParams.offset, bufferParams.length);
        case DataType.i8:
            return new Int8Array(bufferParams.buffer, bufferParams.offset, bufferParams.length);
        case StreamDataType.alaw:
            return new Uint8Array(bufferParams.buffer, bufferParams.offset, bufferParams.length);
    }
    throw new Error(`getDataView: unsupported data type ${bufferParams.type}`)
}

export function createTypedArray(datatype: TransformDataType, samples: number): TransformArrayType {
    switch (datatype) {
        case DataType.cf32:
        case DataType.f32:
            return new Float32Array(samples * getElementsPerSample(datatype));
        case DataType.ci16:
        case DataType.i16:
            return new Int16Array(samples * getElementsPerSample(datatype));
        case DataType.i8:
            return new Int8Array(samples * getElementsPerSample(datatype));
        case StreamDataType.alaw:
            return new Uint8Array(samples * getElementsPerSample(datatype));
    }
    throw new Error(`createTypedArray: unsupported data type ${datatype}`)
}