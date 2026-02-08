# WebUSB SDR layer (`packages/frontend-core/src/webusb`)

This folder contains the **WebUSB implementation layer** used by `frontend-core` to talk to SDR devices in the browser.

Architecture-level documentation is in:

- [README.md](/docs/webusb/README.md)

## What lives here

Core building blocks:

- `webUsbBase.ts` — base class `WebUsb` and common types
- `webUsb.ts` — registry (`registerWebUsbInstance`), device filters (`SDRDevicesIds`), and factory (`getWebUsbInstance`)
- `webUsbDeviceManager.ts` — holds opened devices and instantiates drivers using `getWebUsbInstance(getDeviceHash(...))`
- `webUsbManager.ts` — high-level API for apps (`requestDevice`, `open`, `submitRxPacket`, etc.)

Command/stream helpers:

- `commandQueue.ts` — queued command execution on top of `sendCommandToDevice`
- `rxManager.ts` / `txManager.ts` — RX/TX helpers
- `deviceParameters.ts` — configuration/types for stream parameters

Drivers:

- `webUsbWsdr.ts` — Wavelet uSDR/xSDR drivers
- `webUsbLimeSdr.ts` — LimeSDR Mini v2 driver

Transport implementation:

- `webUsbWasm.ts` — `WebUsbWasm` implements `sendCommandToDevice` using the wasm control module

Worker:

- `webUsb.worker.ts` / `webUsb.worker.types.ts` — optional Web Worker offload

Utilities:

- `ensureWebUsb.ts` — feature checks and guardrails
- `controlWebUsb.ts` — control-layer helpers

Templates:

- `templates/WebUsbTemplate.ts` — starting point for a new driver

## Adding support for a new SDR

At a high level you:

1) Implement a new `WebUsb` subclass (driver)
2) Register it via `registerWebUsbInstance()`

### 1) Implement a driver

Copy `templates/WebUsbTemplate.ts` or create a new file next to existing drivers.

Extend `WebUsb` from `webUsbBase.ts` and implement required abstract methods:

- `getConfiguration()`
- `getRXSamplesCount(samples)`
- `getRXPacketSize(samples)`
- `getTXPacketSize(samples)`
- `decodeRxData(data, samples, opts?)`
- `encodeTxData(data, opts?)`
- `sendCommandToDevice(req)`

If the device uses the existing wasm control module, consider extending `WebUsbWasm` instead of implementing `sendCommandToDevice` yourself.

### 2) Set VID/PID and register

The registry expects static IDs named exactly:

- `static VENDOR_ID = 0x....`
- `static PRODUCT_ID = 0x....`

Then register the constructor (most existing drivers do this at the bottom of the driver file):

```ts
import { registerWebUsbInstance } from './webUsb';

registerWebUsbInstance(WebUsbMySdr);
```

`registerWebUsbInstance()` also appends the VID/PID to `SDRDevicesIds`, which is used by `WebUsbManager.requestDevice()` as the WebUSB `filters` list.

### 3) Test

Use an app that calls `getWebUsbManagerInstance(...).requestDevice()` + `open()` and confirm the created instance is your driver.

## Notes

- Keep this README focused on **code-level** guidance; keep architecture/protocol narrative in `docs/webusb/`.
