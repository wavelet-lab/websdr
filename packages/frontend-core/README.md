# @websdr/frontend-core

Frontend-focused TypeScript core for the WebSDR ecosystem.

This package provides:
- Small **frontend common** helpers (debug flag, env helpers, WASM errno enum).
- Minimal **HTTP API helpers** for browser apps.
- A **WebUSB control + streaming layer** used by WebSDR-compatible devices.

## Install

```bash
npm install @websdr/frontend-core
```

```bash
pnpm add @websdr/frontend-core
```

```bash
yarn add @websdr/frontend-core
```

## Importing

This package is published as ESM (see `type: module`).

Import from the root:

```ts
import { apiFetch, setApiBase, ensureWebUsb } from '@websdr/frontend-core';
```

Or use subpath exports:

```ts
import { configureDebug, debug_mode, getEnvValue } from '@websdr/frontend-core/common';
import { NngWebSocket, Protocol } from '@websdr/frontend-core/transport';
import { apiFetch, setApiBase } from '@websdr/frontend-core/services';
import { ensureWebUsb, WebUsbManagerMode, getWebUsbManagerInstance } from '@websdr/frontend-core/webusb';
```

## Examples

### API helpers

`apiFetch()` builds a URL from the configured base, includes cookies (`credentials: 'include'`), and throws on non-OK responses.

```ts
import { setApiBase, apiFetch } from '@websdr/frontend-core/services';

setApiBase('http://localhost:3000');

type ProfileResponse = {
  ok: boolean;
  message: string;
  user: {
    sub: string | number;
    username: string;
    name?: string;
  };
};

const { user } = await apiFetch<ProfileResponse>('/api/auth/profile');
```

If `setApiBase()` is not called, the helper tries `globalThis.__API_BASE__`, then `process.env.VITE_API_URL` / `process.env.API_URL`, then `import.meta.env.VITE_API_URL` / `import.meta.env.API_URL`, and finally falls back to `/`.

For WebSocket endpoints that share the same API base, use `apiWsUrl()`. It resolves the `/` fallback against `globalThis.location` and converts `http:` / `https:` to `ws:` / `wss:`.

```ts
import { apiWsUrl } from '@websdr/frontend-core/services';

const rpcUrl = apiWsUrl('/rpc');
```

You can also set the API base via a global variable (useful for `index.html` deployments):

```ts
import { apiFetch } from '@websdr/frontend-core/services';

(globalThis as any).__API_BASE__ = 'http://localhost:3000';
const profile = await apiFetch('/api/auth/profile');
```

Error handling (JSON errors are provided via `Error.cause`):

```ts
import { apiFetch } from '@websdr/frontend-core/services';

try {
  await apiFetch('/api/auth/profile');
} catch (e) {
  const err = e as any;
  console.error(err.message);
  if (err.cause) console.error('cause:', err.cause);
}
```

### Debug and env helpers

`debug_mode` is initialized from `process.env.VITE_DEBUG` / `process.env.DEBUG`, then `import.meta.env.VITE_DEBUG` / `import.meta.env.DEBUG`. You can also configure it explicitly:

```ts
import { configureDebug, isDebugMode } from '@websdr/frontend-core/common';

configureDebug({ debug: import.meta.env.DEV });
console.log(isDebugMode());
```

Common env access is available through `getEnvValue()`, which checks `process.env` before `import.meta.env` by default:

```ts
import { getEnvValue } from '@websdr/frontend-core/common';

const apiUrl = getEnvValue(['VITE_API_URL', 'API_URL']);
```

### NNG-over-WebSocket (REQ/SUB)

```ts
import { NngWebSocket, Protocol } from '@websdr/frontend-core/transport';

const ws = new NngWebSocket({
  url: 'ws://localhost:8000/ws',
  protocol: Protocol.SUB,
});

await ws.open();
ws.addEventListener('message', (ev) => {
  // handle events emitted by the class
});
```

REQ example (request/response). The `send()` promise resolves when a reply with the same request id arrives:

```ts
import { NngWebSocket, Protocol } from '@websdr/frontend-core/transport';

const ws = new NngWebSocket({
  url: 'ws://localhost:8000/rpc',
  protocol: Protocol.REQ,
  binaryType: NngWebSocket.TEXT,
});

await ws.open();
const reply = await ws.send('ping', 1000);
console.log('reply:', reply);
```

### WebUSB: ensure implementation + request a device

In browsers, `navigator.usb` exists when WebUSB is supported. In Node.js, you can use a polyfill implementation.
`ensureWebUsb()` attempts to provide `navigator.usb` (prefers the `usb` package, falls back to `webusb`).

```ts
import {
  ensureWebUsb,
  WebUsbManagerMode,
  getWebUsbManagerInstance,
} from '@websdr/frontend-core/webusb';

await ensureWebUsb();

const mgr = getWebUsbManagerInstance(WebUsbManagerMode.SINGLE);
const picked = await mgr.requestDevice(); // requires user gesture in browsers
if (!picked) throw new Error('No device selected');

const fd = await mgr.open(picked.vendorId, picked.productId, picked.device);

const name = await mgr.getName(fd);
const serial = await mgr.getSerialNumber(fd);
console.log({ name, serial });

await mgr.close(fd);
```

### WebUSB: control + streaming via `ControlWebUsb`

`ControlWebUsb` is a high-level helper built on top of `WebUsbManager`. It prepares structured device parameter and streaming commands.

```ts
import { CHUNK_SIZE, DataType } from '@websdr/core/common';
import {
  ensureWebUsb,
  WebUsbManagerMode,
  getWebUsbManagerInstance,
  ControlWebUsb,
  WebUsbChannels,
  WebUsbDirection,
} from '@websdr/frontend-core/webusb';

const mode = WebUsbManagerMode.SINGLE;

await ensureWebUsb();
const mgr = getWebUsbManagerInstance(mode);

const picked = await mgr.requestDevice(); // requires user gesture
if (!picked) throw new Error('No device selected');

const fd = await mgr.open(picked.vendorId, picked.productId, picked.device);
if (fd < 0) throw new Error('Failed to open device');

const control = new ControlWebUsb({ mode });
await control.open(fd);

const info = await control.getDeviceInfo(false);
console.log('device:', info);

await control.sendCommand('SET_RX_FREQUENCY', { chans: WebUsbChannels.CHAN1, frequency: 100e6 });
await control.sendCommand('SET_RX_GAIN', { chans: WebUsbChannels.CHAN1, gain: 15 });

// Prepare streaming (device-specific firmware decides how these map to actual stream state)
await control.sendCommand('START_STREAMING', {
  chans: WebUsbChannels.CHAN1,
  samplerate: 1e6,
  packetsize: CHUNK_SIZE,
  mode: WebUsbDirection.RX_TX,
  dataformat: DataType.ci16,
});

console.log('stream status:', await control.getStreamStatus());

await control.sendCommand('STOP_STREAMING');

await control.close();
await mgr.close(fd);
```

### WebUSB: receive RX packets via `WebUsbManager`

`submitRxPacket()` requests one RX packet worth of IQ samples and returns a decoded `RXBuffer`.

```ts
import { DataType } from '@websdr/core/common';
import {
  ensureWebUsb,
  WebUsbManagerMode,
  getWebUsbManagerInstance,
} from '@websdr/frontend-core/webusb';

await ensureWebUsb();
const mgr = getWebUsbManagerInstance(WebUsbManagerMode.SINGLE);

const picked = await mgr.requestDevice();
if (!picked) throw new Error('No device selected');

const fd = await mgr.open(picked.vendorId, picked.productId, picked.device);
if (fd < 0) throw new Error('Failed to open device');

// Drivers may adjust your requested sample count (alignment, framing, etc.)
const cfg = await mgr.getConfiguration(fd);
const samples = await mgr.getRXSamplesCount(fd, cfg.defaultSamplesCount);

const rx = await mgr.submitRxPacket(fd, samples, {
  datatype: DataType.ci16,
  id: 1,
});

if (rx.datatype === DataType.ci16) {
  // Complex int16 IQ is typically interleaved: I0,Q0,I1,Q1,...
  const iq = new Int16Array(rx.data);
  const i0 = iq[0];
  const q0 = iq[1];
  console.log({ i0, q0, samples: rx.samples, ts: rx.timestamp });
} else if (rx.datatype === DataType.cf32) {
  const iq = new Float32Array(rx.data);
  const i0 = iq[0];
  const q0 = iq[1];
  console.log({ i0, q0, samples: rx.samples, ts: rx.timestamp });
}

await mgr.close(fd);
```

### WebUSB: transmit TX packets via `WebUsbManager`

`sendTxPacket()` encodes and sends an IQ buffer to the device. In many device firmwares TX requires the stream to be started first (for example via `ControlWebUsb` commands).

```ts
import { DataType } from '@websdr/core/common';
import {
  ensureWebUsb,
  WebUsbManagerMode,
  getWebUsbManagerInstance,
} from '@websdr/frontend-core/webusb';

await ensureWebUsb();
const mgr = getWebUsbManagerInstance(WebUsbManagerMode.SINGLE);

const picked = await mgr.requestDevice();
if (!picked) throw new Error('No device selected');

const fd = await mgr.open(picked.vendorId, picked.productId, picked.device);
if (fd < 0) throw new Error('Failed to open device');

// A tiny dummy complex waveform (I/Q int16). Fill with real signal in your app.
const iq = new Int16Array(2 * 1024);
iq[0] = 0x1000;
iq[1] = 0;

const tx = await mgr.sendTxPacket(
  fd,
  {
    data: iq.buffer,
    byteOffset: iq.byteOffset,
    byteLength: iq.byteLength,
    datatype: DataType.ci16,
    discard_timestamp: true,
    timestamp: 0n,
  },
  { allowDrop: false }
);

console.log('tx status:', tx.usbOutTransferResult?.status);
await mgr.close(fd);
```

## Using WebSDR with Vite (WASM Configuration)

`@websdr/frontend-core` includes an Emscripten-based WebAssembly module (`control.wasm`) that is loaded at runtime next to its corresponding JavaScript file.

When using **Vite**, additional configuration is required in development mode.

---

### Why this is necessary

In dev mode, Vite performs dependency pre-bundling (`optimizeDeps`) and moves JavaScript dependencies into:

However, the WebAssembly file (`control.wasm`) is loaded dynamically by the Emscripten runtime and is **not automatically copied** into `.vite/deps/`.

As a result, the browser may attempt to load:

This file does not exist, leading to:
  Error requesting USB device: RuntimeError: Aborted(CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f @+0)

---

### Recommended Vite configuration

To prevent Vite from pre-bundling `@websdr/frontend-core`, add the following to your `vite.config.ts`:

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  ...
  optimizeDeps: {
    exclude: [
      '@websdr/frontend-core',
    ],
  },
  ...
})
```

## Public API (summary)

- **`@websdr/frontend-core/common`**:
  - `debug_mode`, `setDebugMode`, `configureDebug`, `isDebugMode`, `assert`
  - `getImportMetaEnv`, `getProcessEnv`, `getEnv`, `getEnvValue`
  - `WASMErrno`
- **`@websdr/frontend-core/services`**:
  - `setApiBase`, `getApiBase`, `apiUrl`, `apiWsUrl`, `apiFetch`
  - `login`, `logout`, `getProfile`
- **`@websdr/frontend-core/transport`**:
  - `Protocol`, `NngWebSocket`
- **`@websdr/frontend-core/utils`**:
  - `downloadFile`
- **`@websdr/frontend-core/webusb`** (high level):
  - `ensureWebUsb`
  - `ControlWebUsb`, `WebUsbChannels`, `ControlWebUsbInitialParams`
  - `WebUsbManager`, `WebUsbManagerMode`, `getWebUsbManagerInstance`
  - `registerWebUsbInstance`, `getWebUsbInstance`, `SDRDevicesIds`
  - WebUSB primitives and types: `WebUsb`, `WebUsbEndpoints`, `DeviceStreamType`, `DeviceDataType`, etc.

## Notes / caveats

- **WebUSB device registrations:** `@websdr/frontend-core/webusb` auto-imports `webUsbDevices.autogen`. When building from source inside the monorepo, this is generated by `scripts/prebuild.js`.
- **Node vs Browser:** WebUSB is browser-native on supported platforms. For Node usage, `ensureWebUsb()` tries to load `usb` (preferred) or `webusb` dynamically.
- **User gesture requirement:** `navigator.usb.requestDevice()` must be called in response to a user interaction (browser security requirement).

## Development

From the repository root:

```bash
npm install
npm run build
npm test --workspace=packages/frontend-core
```

From this package folder:

### Build
```bash
npm run prebuild
npm run build
```

### Test
```bash
npm test
```

## Source links

This package publishes `dist/` to npm. Source is available in the GitHub repository:
- Entry point: https://github.com/wavelet-lab/websdr/blob/main/packages/frontend-core/src/index.ts
- Common exports: https://github.com/wavelet-lab/websdr/blob/main/packages/frontend-core/src/common/index.ts
- Services exports: https://github.com/wavelet-lab/websdr/blob/main/packages/frontend-core/src/services/index.ts
- Transport exports: https://github.com/wavelet-lab/websdr/blob/main/packages/frontend-core/src/transport/index.ts
- Utils exports: https://github.com/wavelet-lab/websdr/blob/main/packages/frontend-core/src/utils/index.ts
- WebUSB exports: https://github.com/wavelet-lab/websdr/blob/main/packages/frontend-core/src/webusb/index.ts

Package folder (GitHub):
https://github.com/wavelet-lab/websdr/tree/main/packages/frontend-core

## License

WebSDR is [MIT licensed](https://github.com/wavelet-lab/websdr/blob/main/LICENSE)
