# SDR Driver Development Guide

This document explains how to add support for new SDR hardware in **WebSDR**.

WebSDR is frontend-only: all SDR control and streaming happen inside the browser.
New devices are supported by implementing a driver that inherits from the shared
base class and provides device-specific logic through a small set of abstract methods.

---

## Driver Model

To support a new SDR, implement a subclass of the base driver:

- **Inherit from** `WebUsb` class
- **Implement all abstract methods**
- **Map WebSDR high-level commands** to device-specific control operations
- **Provide IQ streaming decode/encode** compatible with the framework

The web application and higher-level control logic interact with the base API and
do not need to know the concrete SDR type.

---

## Base Class: `WebUsb`

The `WebUsb` base class provides:

- WebUSB discovery and lifecycle helpers (`open()`, `close()`)
- Convenience transport wrappers (`read`, `write`, `readControl`, `writeControl`)
- A built-in command queue (`_commands`) and dispatcher (`runCommandPool`)
- TX queue limiting (`MAX_SEND_DATA_REQUEST`, `sendDataReqCnt`, `waitForChangeSendDataReq`)
- Generic streaming helpers (`submitRxPacket`, `sendTxPacket`, `sendTxRawPacket`)
- EventTarget-based integration hooks (`onConnect`, `onDisconnect`, custom events)

Your subclass focuses on:
1) device framing (packet sizes),  
2) IQ parsing/packing,  
3) device command transport/mapping.

---

## What you must implement

A driver must implement the following abstract methods:

### 1) Device configuration

#### `getConfiguration(): DeviceConfiguration`
Return device-specific static configuration, such as:

- supported frequency ranges
- supported sample rates / bandwidth ranges
- default sample counts / preferred packetization
- supported stream directions/modes (RX, TX, TX and RX)
- supported stream types and data formats for them

This is the main capability descriptor used by higher-level logic.

---

### 2) Streaming geometry (packet sizes and sample alignment)

These methods define how the framework allocates USB buffers and requests transfer sizes.

#### `getRXSamplesCount(samples: number): number`
The framework may request `samples`, but the device may require alignment (e.g. multiples of N).
Return the device-corrected number of samples that will actually be transferred/decoded.

#### `getRXPacketSize(samples: number): number`
Return RX packet byte size for `samples` complex samples (including device headers, if any).

#### `getTXPacketSize(samples: number): number`
Return TX packet byte size for `samples` complex samples (including device headers, if any).

These three methods are critical to prevent underruns/overruns and to keep USB transfers stable.

---

### 3) IQ decoding and encoding

These methods convert between **device-native binary framing** and **WebSDR buffer objects**.

#### `decodeRxData(data: DataView, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer>`
Parse an incoming RX packet and produce an `RXBuffer`:

- parse device-specific headers
- detect misalignment or dropped/partial packets
- extract/normalize metadata (datatype, sample count, timestamps if present)
- return the decoded IQ payload

#### `encodeTxData(data: TXBuffer, opts?: TXEncoderOptions): Promise<ArrayBufferLike>`
Convert a `TXBuffer` into device-native format ready for `transferOut`:

- apply required headers/framing
- enforce alignment
- handle datatype conversion if necessary (e.g., cf32↔ci16)
- honor `TXEncoderOptions` (e.g. allowDrop behavior is handled by base TX queue logic)

---

### 4) Command transport / request mapping

#### `sendCommandToDevice(req: Record<string, any>): Promise<Record<string, any>>`
This is the main control hook used by `runCommandPool()`.

Full command descriptions are available in [docs/webusb/commands.md](commands.md).

Your implementation must perform the full request/response cycle using the chosen mechanism:

- WASM control module call (e.g. Emscripten-exported function)
- direct USB control transfers
- pure-JS mapping (no WASM)


**Return value contract:**
- On success: `{ ...parsed reply... }`
- On device-level error: `{ error: <string>, ...optional fields... }`

Drivers should avoid throwing for expected device errors; either return `{ error: ... }`
or throw only for transport-level failures (timeouts, disconnected device, etc.).
`runCommandPool()` normalizes both.

---

## Optional debug command hook

### `sendDebugCommandToDevice(req: string): Promise<string>`
The base implementation returns `Error: not implemented`.

Implement this if your device supports:
- vendor debug endpoints
- raw command console
- development-only diagnostic channel

This method is called via `sendDebugCommand()`.

---

## How command dispatch works in the base class

`WebUsb` provides a structured command queue:

- `sendCommand(req)` enqueues a `CommandRequest`
- `runCommandPool()` processes the queue sequentially
- for each command it calls `sendCommandToDevice(req)`
- it resolves/rejects the original promise depending on `{ error: ... }` or thrown exception

This ensures:
- no concurrent control transactions collide
- command ordering is deterministic
- driver implementations stay simple

---

## Streaming helpers you get

Your driver does not need to reimplement USB transfer orchestration.

### RX
`submitRxPacket(samples, opts)`:
- allocates the correct RX transfer size using `getRXPacketSize()`
- reads from the streaming endpoint
- calls your `decodeRxData()` and returns an `RXBuffer`

### TX
`sendTxPacket(data, opts)`:
- calls your `encodeTxData()`
- enforces TX queue limits (`MAX_SEND_DATA_REQUEST`)
- sends prepared packet via `_sendTxPacket()` and `transferOut`

This design keeps transport orchestration in the base class and pushes
only device-specific encoding/decoding into the driver.

---

## Overriding low-level transport (send/receive)

The base `WebUsb` class exposes two public wrapper methods that handle
the raw USB streaming I/O: `sendDataToDevice(pkt)` and
`receiveDataFromDevice(len)`. These methods delegate to the default
USB endpoints (STREAM_EP) and are intended to be overridden by drivers
or tests that need custom transport behavior.

Why override:
- Route IQ packets through a different endpoint or transport (e.g. a
   worker, tunnel, or emulated device).
- Inject test hooks, logging, or instrumentation around raw transfers.
- Implement device-specific framing that requires special reads/writes.

Default behavior:
- `sendDataToDevice(pkt)` — calls `USBDevice.transferOut(STREAM_EP, pkt)`
- `receiveDataFromDevice(len)` — calls `USBDevice.transferIn(STREAM_EP, len)`

Example: override to route TX packets to a custom endpoint or worker
while leaving RX on the default path:

```ts
export class MyDevice extends WebUsb {
   // implement abstract methods...

   // route TX to a different endpoint
   async sendDataToDevice(pkt: ArrayBufferLike): Promise<USBOutTransferResult | undefined> {
      // custom logic here (e.g. send to endpoint 4 or to a worker)
      return this.device?.transferOut(4, pkt as BufferSource);
   }

   // you can also override receive path if needed
   async receiveDataFromDevice(len: number): Promise<USBInTransferResult | undefined> {
      // custom receive implementation (e.g. synthetic data for tests)
      return this.device?.transferIn(WebUsbEndpoints.STREAM_EP, len);
   }
}
```

Notes:
- If you override these methods, be sure to preserve the Promise
   semantics (resolve to `USBOutTransferResult` / `USBInTransferResult` or
   `undefined`) so the base class logic continues to work.
- Overriding is optional — most drivers only need to implement
   `encodeTxData`/`decodeRxData` and `sendCommandToDevice`.

---

## Implementing mapping from WebSDR control model to device commands

WebSDR uses a high-level command catalog (e.g. set frequency, gain, streaming control).

Full command descriptions are available in [docs/webusb/commands.md](commands.md).

A driver is responsible for translating those abstract requests into device-native actions.

Typical strategies:

- **Direct JSON passthrough** to firmware (device understands WebSDR-like JSON)
- **JSON-to-binary mapping** (driver converts request into control transfers)
- **JS-native handling** (driver performs actions without firmware JSON)

The recommended approach is:
- keep the high-level command names stable at the WebSDR level
- implement device-specific mapping inside `sendCommandToDevice()`

---

## Add static metadata for mapping, e.g. `VENDOR_ID` and `PRODUCT_ID`

Drivers must expose their USB identifiers as static fields so the
framework can map a connected USB device to the correct driver class.

Use the exact static names `VENDOR_ID` and `PRODUCT_ID` (case-sensitive).

Example device class:

```ts
export class MyDevice extends WebUsb {
   static VENDOR_ID = 0x1234;
   static PRODUCT_ID = 0xabcd;

   constructor(params: WebUsbParams) {
      super(params);
   }

   // implement required abstract methods...
}
```

Register the class so the framework can create instances when a matching
USB device is plugged in. Call `registerWebUsbInstance()` with the class:

```ts
import { registerWebUsbInstance } from '../../packages/frontend-core/src/webusb/webUsb';

registerWebUsbInstance(MyDevice);
```

At runtime the framework computes a key from the connected device's `VENDOR_ID`
and `PRODUCT_ID` (via `getDeviceHash`) and then calls `getWebUsbInstance(key, params)`:

```ts
const key = getDeviceHash({ vendorId: usbDevice.vendorId, productId: usbDevice.productId });
const instance = getWebUsbInstance(key, params);
if (instance) await instance.open();
```

The class static fields must be present and correct for the registration and
lookup to work.

---

## Checklist: bringing up a new SDR

1. Create a subclass `class MyDevice extends WebUsb`
2. Implement all abstract methods
3. Define endpoints and transfer sizes (RX/TX framing)
4. Implement RX decode and TX encode (including headers if needed)
5. Implement `sendCommandToDevice()`:
   - map high-level commands to device operations
   - return `{ error: ... }` on device errors
6. Validate:
   - `open()` finds the device (vid/pid)
   - connect/config commands work
   - RX streaming decode produces correct IQ samples
   - TX streaming is stable under queue pressure
7. Add static metadata for mapping, e.g. `VENDOR_ID` and `PRODUCT_ID`.

---

## Driver Template

A driver template is available at [packages/frontend-core/src/webusb/templates/WebUsbTemplate.ts](../../packages/frontend-core/src/webusb/templates/WebUsbTemplate.ts).


