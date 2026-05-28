# @websdr/core

Core TypeScript utilities for the WebSDR ecosystem: shared types/constants, small runtime helpers, and fast sample format conversions.

**What’s inside**
- **Common:** shared types + size/format constants.
- **Utils:** circular buffer, timing helpers, logging, promise helper, string helpers, journal types.
- **Transform:** sample format converters used by DSP pipelines.

## Install

```bash
npm install @websdr/core
```

```bash
pnpm add @websdr/core
```

```bash
yarn add @websdr/core
```

## Importing

This package is published as ESM (see `type: module`). Most users should import from the package root:

```ts
import { CircularBuffer, SimpleLogger, bufferF32ToI16 } from '@websdr/core';
```

Subpath exports are also available (often better for clarity / tree-shaking):

```ts
import { CircularBuffer } from '@websdr/core/utils';
import { bufferI16ToF32 } from '@websdr/core/transform';
import { CHUNK_SIZE, DataType } from '@websdr/core/common';
```

## API reference and examples

### CircularBuffer

Files: `packages/core/src/utils/circularbuffer.ts`

Provides a fixed-capacity deque for low-allocation queues, rolling windows, and
producer/consumer buffers. It keeps logical order even when the internal array
wraps around, so `get(0)` is always the oldest/front item and `get(size() - 1)`
is the newest/back item.

- `new CircularBuffer<T>(len)` — create a buffer with fixed capacity.
- `push_back(value)` / `push_front(value)` — append/prepend an item; when full,
  discard one item from the opposite side.
- `pop_front(count?)` / `pop_back(count?)` — remove one or more items.
- `front()` / `back()` — read the first/last logical item.
- `get(index)` / `set(index, value)` — read/write by logical index from the
  front.
- `alloc_front(count?)` / `alloc_back(count?)` — reserve logical slots without
  writing values.
- `capacity()`, `size()`, `isEmpty()`, `isFull()` — inspect buffer state.
- `clear()` — reset to an empty state.
- `waitForChangeSize()` / `onChangeSize` — react to size-changing operations.

```ts
import { CircularBuffer } from '@websdr/core/utils';

const buf = new CircularBuffer<number>(4);
buf.push_back(1);
buf.push_back(2);

console.log(buf.size());   // 2
console.log(buf.front());  // 1
console.log(buf.back());   // 2
```

When the buffer is full, adding an item drops one item from the opposite side:
`push_back()` drops the oldest/front item, and `push_front()` drops the
newest/back item.

```ts
const buf = new CircularBuffer<number>(3);

buf.push_back(1);
buf.push_back(2);
buf.push_back(3);
buf.push_back(4);

console.log(buf.size()); // 3
console.log([buf.get(0), buf.get(1), buf.get(2)]); // [2, 3, 4]
```

Notes

- `front()` and `back()` return `undefined` when the buffer is empty.
- Counts larger than the current size clear the buffer; zero or negative counts
  are ignored.
- `get(index)` and `set(index, value)` throw if the index is outside the active
  range.

### Timing helpers

Files: `packages/core/src/utils/time.ts`

Provides small timing helpers for async delays, monotonic elapsed-time
measurements, and journal/log timestamp formatting.

- `sleep(seconds): Promise<void>` — wait for a number of seconds.
- `usleep(milliseconds): Promise<void>` — wait for a number of milliseconds.
- `now(): number` — return `performance.now()` for elapsed-time measurements.
- `timestampToTimeString(timestamp): string` — format a wall-clock timestamp as
  `HH:mm:ss.SSS`.

```ts
import { now, sleep, usleep } from '@websdr/core/utils';

const t0 = now();
await usleep(10); // ms
await sleep(0.05); // seconds
console.log('elapsed', now() - t0);
```

Use `Date.now()` when you need a wall-clock timestamp. Use `now()` when you need
to measure duration without being affected by system clock changes.

### Float/Int16 sample conversions

Files: `packages/core/src/transform/converters.ts`

Provides fast typed-array conversions between normalized `Float32` samples in
the `[-1.0, 1.0]` range and signed 16-bit integer samples. These helpers are
useful for audio, IQ, and other DSP data paths, and can reuse caller-provided
output buffers to avoid allocations.

- `bufferF32ToI16(input, outbuf?): Int16Array` — convert normalized float
  samples to signed 16-bit integer samples.
- `bufferI16ToF32(input, outbuf?): Float32Array` — convert signed 16-bit
  integer samples to normalized float samples.
- `clipF32Buffer(buffer, outbuf?): void` — clip float samples to the
  `[-1.0, 1.0]` range.

If an output buffer is provided, conversion runs for
`min(input.length, outbuf.length)` elements and the same `outbuf` instance is
returned.

```ts
import { bufferF32ToI16, bufferI16ToF32, clipF32Buffer } from '@websdr/core/transform';

const f32 = new Float32Array([0.0, 0.5, -0.5]);

// Optional: clip before converting if your pipeline can produce out-of-range values
clipF32Buffer(f32);

const i16 = bufferF32ToI16(f32);
const f32roundtrip = bufferI16ToF32(i16);
```

Scaling rules:

- `bufferI16ToF32()` divides samples by `0x8000`, so `-32768` becomes `-1.0`
  and `32767` becomes about `0.99997`.
- `bufferF32ToI16()` multiplies samples by `0x7fff`. It does not clamp
  out-of-range floats for speed, so clip first if your upstream can produce
  values outside `[-1.0, 1.0]`.
- `clipF32Buffer(buffer)` clips in place. `NaN` values are left unchanged.

If you want to avoid allocations in a hot path, reuse an output buffer:

```ts
import { bufferF32ToI16 } from '@websdr/core/transform';

const out = new Int16Array(8192);

function onAudioFrame(frame: Float32Array) {
  // Converts up to min(frame.length, out.length)
  bufferF32ToI16(frame, out);
  return out;
}
```

For an out-of-place clip, initialize or copy the output first. The current
`clipF32Buffer(input, out)` implementation only writes values that need
clipping; in-range values in `out` are left as they were.

```ts
const input = new Float32Array([1.2, 0.25, -1.5]);
const clipped = new Float32Array(input);

clipF32Buffer(input, clipped);
console.log([...clipped]); // [1, 0.25, -1]
```

### Common constants and types

Files: `packages/core/src/common/types.ts`, `packages/core/src/common/defines.ts`

Provides shared data-type enums, readable names, and byte-size constants used by
streaming and transform code.

- `DataType` — internal buffer/sample formats: `cf32`, `ci16`, `f32`, `i16`,
  `i8`.
- `StreamDataType` — stream-level formats: `cf32`, `ci16`, `f32`, `i16`,
  `alaw`.
- `DataTypeNames` / `StreamDataTypeNames` — display names for data types.
- `CHUNK_SIZE` — default stream chunk size, currently `8192` samples.
- `FLOAT_SIZE`, `COMPLEX_FLOAT_SIZE`, `INT16_SIZE`, `COMPLEX_INT16_SIZE`,
  `INT8_SIZE` — byte-size constants for sample calculations.

```ts
import { CHUNK_SIZE, COMPLEX_FLOAT_SIZE, DataType } from '@websdr/core/common';

const streamType: DataType = DataType.cf32;
const bytesPerChunk = CHUNK_SIZE * COMPLEX_FLOAT_SIZE;
console.log({ streamType, bytesPerChunk });
```

### Logging

Files: `packages/core/src/utils/logger.ts`

Provides a small console-backed logger and shared logger types for components
that should accept any compatible logging implementation.

- `SimpleLogger(context?)` — prefixes messages with an optional context and
  writes to the browser/Node console.
- `LoggerInterface` — common logger contract with `log`, `warn`, `error`, and
  optional `debug`, `verbose`, `fatal` methods.
- `LOG_LEVELS` / `LogLevel` — supported log-level values.

```ts
import { SimpleLogger } from '@websdr/core/utils';

const logger = new SimpleLogger('websdr');
logger.log('hello');
logger.warn('something odd');
logger.error('something bad');
```

### PromiseHelper (request/response correlation)

Files: `packages/core/src/utils/promiseHelper.ts`

Provides a small request/response correlation helper. It creates numbered
promises that can be resolved or rejected later from an event handler.

- `createPromise<T>(): [number, Promise<T>]` — allocate the next numeric id and
  store the promise callbacks.
- `getPromise(id)` — retrieve the stored callbacks for an id.
- `deletePromise(id)` — remove an id from the map.
- `promiseResolve(entry, value?)` / `promiseReject(entry, reason?)` — settle a
  stored promise entry.
- `clear()` — remove all pending entries and reset id generation.

```ts
import { PromiseHelper } from '@websdr/core/utils';

const promises = new PromiseHelper();

function sendRequest(payload: unknown) {
  const [id, promise] = promises.createPromise<{ ok: boolean }>();
  transport.send({ id, payload });
  return promise;
}

transport.on('message', (msg: { id: number; result?: unknown; error?: unknown }) => {
  const entry = promises.getPromise(msg.id);
  if (!entry) return;
  promises.deletePromise(msg.id);
  if (msg.error) promises.promiseReject(entry, msg.error);
  else promises.promiseResolve(entry, msg.result);
});
```

### Filtering helpers

Files: `packages/core/src/utils/convUtils.ts`, `packages/core/src/utils/stringUtils.ts`

Provides lightweight string conversion and filtering helpers for config parsing,
log filtering, and diagnostics.

- `toBoolean(value): boolean` — convert booleans, numbers, and common boolean
  strings such as `true`, `yes`, `1`, `on`, `false`, `no`, `0`, and `off`;
  unsupported values return `false`.
- `stringToBoolean(value): boolean` — backwards-compatible alias for
  `toBoolean`.
- `containsAnySubstr(text, substrs, caseSensitive?)` — check whether a string
  contains any non-empty substring from a string or string array.
- `printBin(value, digits?)` — format a number as a binary string with fixed
  width.

```ts
import { containsAnySubstr, toBoolean } from '@websdr/core/utils';

const enabled = toBoolean(process.env.DEBUG);
const allow = containsAnySubstr('usb:device connected', ['usb:', 'webusb'], false);
console.log({ enabled, allow });
```

### Journal log items

Files: `packages/core/src/utils/journal.ts`

Provides serializable journal/log item types used by components that collect or
transport structured logs.

- `JournalLogLevel` — enum with `DEBUG`, `INFO`, `WARNING`, `ERROR`, `FATAL`.
- `JournalLogLevelKeys` — TypeScript union of journal level keys.
- `JournalLogItem` — timestamped log item shape with subsystem, level, and
  message.

```ts
import { JournalLogLevel, timestampToTimeString } from '@websdr/core/utils';
import type { JournalLogItem } from '@websdr/core/utils';

const item: JournalLogItem = {
  timestamp: Date.now(),
  subSystem: 'webusb',
  logLevel: JournalLogLevel.INFO,
  message: 'device opened',
};

console.log(`[${timestampToTimeString(item.timestamp)}] ${item.subSystem}: ${item.message}`);
```

### A-law companding

Files: `packages/core/src/transform/compressors.ts`

Provides functions to encode/decode A-law companded sample data and buffer
helpers for batch conversions.

- `alawEncode(input: number): number` — encode a signed 16-bit linear sample to
  8-bit A-law.
- `alawDecode(input: number): number` — decode 8-bit A-law to a signed 16-bit
  linear sample.
- `alawEncodeBuffer(input, outbuf?): Uint8Array` — encode an `Int16Array` into
  a `Uint8Array`.
- `alawDecodeBuffer(input, outbuf?): Int16Array` — decode a `Uint8Array` into an
  `Int16Array`.
- `alawEncodeBufferF32(input, outbuf?): Uint8Array` — encode normalized
  `Float32Array` samples to A-law.
- `alawDecodeBufferF32(input, outbuf?): Float32Array` — decode A-law samples to
  normalized `Float32Array` samples.

```ts
import { alawEncodeBufferF32, alawDecodeBufferF32 } from '@websdr/core/transform';

const f32 = new Float32Array([0.0, 0.5, -0.5]);
const alaw = alawEncodeBufferF32(f32);       // Uint8Array
const roundtrip = alawDecodeBufferF32(alaw); // Float32Array (approx)
```

Notes

- The A-law helpers operate on linear sample ranges expected by the package:
  `Int16Array` uses signed 16-bit values; `Float32Array` helpers scale to/from
  that range internally.
- Buffer helpers convert up to `min(input.length, outbuf.length)` when an output
  buffer is provided.

### Base64 helpers

Files: `packages/core/src/transform/base64.ts`

Provides conversion helpers for moving binary data through text-only channels.

- `uint8ArrayToBase64(bytes): string` — encode bytes into a base64 string.
- `base64ToUint8Array(base64): Uint8Array` — decode a base64 string into bytes.

```ts
import { base64ToUint8Array, uint8ArrayToBase64 } from '@websdr/core/transform';

const bytes = new Uint8Array([1, 2, 3]);
const encoded = uint8ArrayToBase64(bytes);
const decoded = base64ToUint8Array(encoded);
```

### Transform helpers

Files: `packages/core/src/transform/transformdata.ts`

Provides high-level helpers for converting between supported data
representations and for calculating typed-array sizes/views.

- `transformData(inBuffer, outBuffer): void` — convert data between supported
  input/output types.
- `createTypedArray(datatype, samples)` — allocate a typed array for a data
  type and sample count.
- `getDataView(bufferParams)` — create the matching typed-array view over an
  existing buffer.
- `getSampleByteLength(datatype)` — return bytes per logical sample.
- `getElementByteLength(datatype)` — return bytes per typed-array element.
- `getElementsPerSample(datatype)` — return element count per logical sample.
- `getSamplesCount(datatype, byteLength)` — convert byte length to sample count.
- `getElementsCount(datatype, byteLength)` — convert byte length to element
  count.
- `TransformDataType`, `TransformArrayType`, `BufferParams` — TypeScript helper
  types for transform buffers.

```ts
import { transformData, createTypedArray } from '@websdr/core/transform';
import { DataType, StreamDataType } from '@websdr/core/common';

const inF32 = new Float32Array([0.1, -0.2, 0.3]);
const outAlaw = createTypedArray(StreamDataType.alaw, inF32.length);

transformData(
  { type: DataType.f32, buffer: inF32.buffer, length: inF32.length },
  { type: StreamDataType.alaw, buffer: outAlaw.buffer, length: outAlaw.length }
);
```

Notes

- `transformData()` throws on unsupported input/output combinations.
- Prefer pre-allocated output arrays with `createTypedArray()` in hot paths.

### DataSlicer

Files: `packages/core/src/utils/DataSlicer.ts`

Provides a fixed-capacity frame assembler that collects incoming sample chunks
into `SharedArrayBuffer` slots, tracks overruns/timestamps, and exposes a small
consumer queue API.

- `new DataSlicer(params?)` — create a slicer and optionally initialize buffer
  slots.
- `reinitialize(params)` — recreate slots for a datatype, samples-per-buffer,
  and buffer count.
- `pushBack(buffer, offset, byteLength, overrun, timestamp)` — append incoming
  sample bytes into the current output slot.
- `front()` — read the current filled slot.
- `pop_front(count?)` — release one or more filled slots.
- `capacity()`, `size()`, `clear()` — inspect or reset the queue.
- `datatype` — read the current data type.
- `onChangeSize` — callback invoked when filled slots are produced or removed.

```ts
import { DataSlicer } from '@websdr/core/utils';
import { DataType } from '@websdr/core/common';

const slicer = new DataSlicer({
  datatype: DataType.ci16,
  bufferSamplesSize: 1024,
  buffersCount: 4,
});

slicer.pushBack(iqBuf, 0, iqBuf.byteLength, 0, BigInt(timestamp));

const item = slicer.front();
if (item && item.bufferFilled > 0) {
  const samples = new Int16Array(item.buffer, 0, item.bufferFilled);
  slicer.pop_front();
}
```

## Public API (summary)

- **`@websdr/core/common`**: `DataType`, `DataTypeNames`, `StreamDataType`,
  `StreamDataTypeNames`, `CHUNK_SIZE`, `FLOAT_SIZE`, `COMPLEX_FLOAT_SIZE`,
  `INT16_SIZE`, `COMPLEX_INT16_SIZE`, `INT8_SIZE`.
- **`@websdr/core/utils`**:
  - `CircularBuffer`
  - `sleep`, `usleep`, `now`, `timestampToTimeString`
  - `PromiseHelper`
  - `JournalLogLevel`, `JournalLogLevelKeys`, `JournalLogItem`
  - `SimpleLogger`, `LOG_LEVELS`, `LoggerInterface`, `LogLevel`
  - `toBoolean`, `stringToBoolean`, `containsAnySubstr`, `printBin`
  - `DataSlicer`
- **`@websdr/core/transform`**:
  - `bufferF32ToI16`, `bufferI16ToF32`, `clipF32Buffer`
  - `alawEncode`, `alawDecode`, `alawEncodeBuffer`, `alawDecodeBuffer`,
    `alawEncodeBufferF32`, `alawDecodeBufferF32`
  - `base64ToUint8Array`, `uint8ArrayToBase64`
  - `transformData`, `createTypedArray`, `getDataView`
  - `getSampleByteLength`, `getElementByteLength`, `getElementsPerSample`,
    `getSamplesCount`, `getElementsCount`
  - `TransformDataType`, `TransformArrayType`, `BufferParams`

## Compatibility notes

- **TypeScript:** ships `*.d.ts` typings.
- **Runtime:** uses `performance.now()` in `now()`. In browsers this is always available; in Node.js it depends on your Node version / environment.

## Development

From the repository root:

```bash
npm install
npm run build
npm test --workspace=packages/core
```

From this package folder:

### Build
```bash
npm run build
```

### Test
```bash
npm test
```

## Source links

This package publishes `dist/` to npm. Source is available in the GitHub repository:
- Entry point: https://github.com/wavelet-lab/websdr/blob/main/packages/core/src/index.ts
- Common exports: https://github.com/wavelet-lab/websdr/blob/main/packages/core/src/common/index.ts
- Utils exports: https://github.com/wavelet-lab/websdr/blob/main/packages/core/src/utils/index.ts
- Transform exports: https://github.com/wavelet-lab/websdr/blob/main/packages/core/src/transform/index.ts

Package folder (GitHub):
https://github.com/wavelet-lab/websdr/tree/main/packages/core

## License

WebSDR is [MIT licensed](https://github.com/wavelet-lab/websdr/blob/main/LICENSE)
