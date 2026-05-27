import { getDataView, getElementByteLength, getElementsPerSample, getSampleByteLength } from "@/transform/transformdata";
import { DataType } from "@/common/types";

const debugDataSlicer = false;

interface DataItem {
    buffer: SharedArrayBuffer,
    bufferFilled: number,
    overrun: number,
    timestamp: bigint,
}

export class DataSlicer {
    protected _firstTimeStamp: bigint | undefined = undefined;
    protected _datatype: DataType = DataType.ci16;
    protected _sampleSize: number = 0;
    protected _elementSize: number = 0;
    protected _elementsPerSample: number = 0;
    protected _buffer: Array<DataItem> = [];
    protected _bufferLen: number = 0;
    protected _bufferHead: number = 0;
    protected _bufferTail: number = 0;
    onChangeSize: () => void = () => void {};

    constructor(parms?: DataSlicerParams) {
        this.reinitialize(parms);
    }

    protected _clearBuffer(idx: number) {
        if (idx < 0 || idx >= this._buffer.length) return;
        const item = this._buffer[idx]!;
        item.bufferFilled = 0;
        item.overrun = 0;
        item.timestamp = 0n;
    }

    get datatype() {
        return this._datatype;
    }

    reinitialize(parms?: DataSlicerParams) {
        if (debugDataSlicer) console.log('DataSlicer.reinitialize', parms);
        if (!parms) return;
        this._datatype = parms.datatype;
        this._bufferLen = parms.buffersCount;
        this._buffer = this._bufferLen > 0 ? new Array<DataItem>(this._bufferLen) : [];
        this._sampleSize = getSampleByteLength(this._datatype);
        this._elementSize = getElementByteLength(this._datatype);
        this._elementsPerSample = getElementsPerSample(this._datatype);
        const bufferSize = parms.bufferSamplesSize * this._sampleSize;
        for (let i = 0; i < this._bufferLen; ++i) {
            this._buffer[i] = {
                buffer: new SharedArrayBuffer(bufferSize),
                bufferFilled: 0,
                overrun: 0,
                timestamp: -1n,
            }
        }
    }

    clear() {
        this._bufferHead = 0;
        this._bufferTail = 0;
        this.onChangeSize();
    }

    capacity() {
        return this._bufferLen;
    }

    size() {
        if (this._bufferHead <= this._bufferTail)
            return this._bufferTail - this._bufferHead;
        return this._bufferTail + this._bufferLen - this._bufferHead;
    }

    pushBack(iqBuf: ArrayBufferLike, iqBufOffset: number, iqBufByteLength: number | undefined, overrun: number, timestamp: bigint) {
        if (debugDataSlicer) console.log('DataSlicer.pushBack: iqBuf =', iqBuf, ', iqBufOffset =', iqBufOffset, ', iqBufByteLength =', iqBufByteLength, ', overrun =', overrun, ', timestamp =', timestamp);
        const outItem = this._buffer[this._bufferTail]!;
        let outView = getDataView({ type: this._datatype, buffer: outItem.buffer });
        let inView = getDataView({ type: this._datatype, buffer: iqBuf, offset: iqBufOffset, length: iqBufByteLength !== undefined ? Math.ceil(iqBufByteLength / this._elementSize) : undefined });

        if (this._firstTimeStamp === undefined)
            this._firstTimeStamp = timestamp;

        let outBufFree = outView.length - outItem.bufferFilled;
        //console.log('0 outBufFree =', outBufFree)

        if (outItem.bufferFilled === 0) {
            outItem.overrun = overrun;
            outItem.timestamp = timestamp;
        } else {
            const ourTimestamp = outItem.timestamp + BigInt(outItem.bufferFilled / this._elementsPerSample);
            // console.log('outItem.timestamp =', outItem.timestamp, ', outItem.bufferFilled =', outItem.bufferFilled, ', timestamp =', timestamp);
            if (ourTimestamp === timestamp) {
                if (debugDataSlicer) console.log('Timestamp is good');
            } else if (timestamp > ourTimestamp) {
                if (debugDataSlicer) console.log('Timestamp is bad, were overruns');
                const fillLen = Math.min(outBufFree, Math.max(0, Number(timestamp - ourTimestamp) * this._elementsPerSample));
                // console.log('fill from =', outItem.bufferFilled, ', len =', fillLen);
                outView.fill(0, outItem.bufferFilled, fillLen);
                outItem.bufferFilled += fillLen;
                outBufFree -= fillLen;
                // console.log('1 outBufFree =', outBufFree)
            }
        }

        const len = Math.min(inView.length, outBufFree);
        if (len > 0) {
            outView.set(inView.subarray(0, len), outItem.bufferFilled);
            outItem.bufferFilled += len;
            outBufFree -= len;
            // console.log('2 outBufFree =', outBufFree)
        }
        if (outBufFree === 0) {
            this._bufferTail = (this._bufferTail + 1) % this._bufferLen;
            if (this._bufferHead === this._bufferTail)
                this._bufferHead = (this._bufferHead + 1) % this._bufferLen;
            this._clearBuffer(this._bufferTail);
            if (inView.length > len) {
                const offset = len * inView.BYTES_PER_ELEMENT
                this.pushBack(iqBuf, iqBufOffset + offset, iqBufByteLength !== undefined ? iqBufByteLength - offset : undefined,
                    0, timestamp + BigInt(len >> 1));
            }
            this.onChangeSize();
        }
    }

    front() {
        return this._buffer[this._bufferHead];
    }

    pop_front(cnt: number = 1) {
        if (cnt < 1) return;
        const cntBiggerSize = (cnt >= this.size());
        this._bufferHead = (this._bufferHead + cnt) % this._bufferLen;
        if (cntBiggerSize)
            this._bufferTail = this._bufferHead;
        this.onChangeSize();
    }
}

export interface DataSlicerParams {
    datatype: DataType,
    bufferSamplesSize: number,
    buffersCount: number,
}

