# WebSDR API Reference

WebSDR is a TypeScript monorepo of reusable libraries rather than a standalone
service. Its API consists of four main surfaces:

1. The authentication HTTP API from `@websdr/nestjs-microservice`.
2. Frontend HTTP helpers from `@websdr/frontend-core/services`.
3. The NNG-over-WebSocket client from `@websdr/frontend-core/transport`.
4. The local SDR WebUSB API from `@websdr/frontend-core/webusb`.

The repository does not contain a NestJS bootstrap application, database, or
server-side WebSocket gateway. Applications embedding these packages provide
their own server configuration, middleware, persistence, and deployment.

## HTTP Authentication API

The `AuthModule` registers a controller under `/api/auth`.

Cookie authentication requires the host NestJS application to install
middleware that populates `req.cookies`. Runtime validation of `LoginDto`
requires a NestJS `ValidationPipe`.

### `POST /api/auth/login`

Authenticates a user and creates a JWT session.

Authentication: not required.

Request body:

```json
{
  "username": "admin",
  "password": "admin"
}
```

Both fields must be non-empty strings according to `LoginDto`.

Successful response:

```json
{
  "ok": true,
  "message": "User authenticated",
  "user_id": 1
}
```

The response sets the JWT in the `jwt` cookie.

Errors:

- `401 Invalid credentials`
- `500 Auth service error`

The bundled `UsersService` is a demonstration implementation containing the
users `admin/admin` and `user/user`. Production applications should replace it
with their own user storage and credential verification.

### `POST /api/auth/guest`

Creates a guest session or refreshes an existing session from the `jwt`
cookie.

Authentication: not required.

Request body: none.

Successful response:

```json
{
  "ok": true,
  "message": "Guest authenticated",
  "user_id": "UUID-v4"
}
```

When a valid JWT cookie is present, its payload is transferred to a newly
issued token. Otherwise, the endpoint generates a UUID and creates a token
with `username: "guest"` and `name: "Guest User"`.

Errors:

- `500 Auth service error`

### `GET /api/auth/profile`

Returns the payload of the current JWT.

Authentication: `JwtAuthGuard`.

Accepted token locations:

1. The `jwt` cookie.
2. `Authorization: Bearer <token>`.

Successful response:

```json
{
  "ok": true,
  "message": "",
  "user": {
    "sub": 1,
    "username": "admin",
    "name": "Administrator",
    "iat": 1781510400,
    "exp": 1781514000
  }
}
```

The `user` object is based on the JWT payload and may contain additional
fields supplied when the token was created.

Errors:

- `401 Unauthorized`
- `401 Token revoked`
- Passport JWT errors for invalid or expired tokens

### `POST /api/auth/refresh`

Creates a new JWT from the current token payload, excluding the old `iat` and
`exp` claims.

Authentication: `JwtAuthGuard`.

The endpoint itself reads the token from `req.cookies.jwt`. A Bearer-only
request can pass the guard but receives `400 No token`.

Successful response:

```json
{
  "ok": true,
  "message": "Token refreshed"
}
```

The response replaces the `jwt` cookie.

Errors:

- `400 No token`
- `401 Invalid token`
- authentication guard errors

### `POST /api/auth/logout`

Revokes the current cookie token and clears the `jwt` cookie.

Authentication: `JwtAuthGuard`.

Successful response:

```json
{
  "ok": true,
  "message": "Logged out successfully"
}
```

The controller revokes `req.cookies.jwt`. A Bearer-only request passes the
guard, but its Bearer token is not added to the revocation store.

## JWT Configuration

A standard user token has the following payload:

```json
{
  "sub": 1,
  "username": "admin",
  "name": "Administrator",
  "iat": 1781510400,
  "exp": 1781514000
}
```

Supported token sources, in lookup order:

1. The `jwt` cookie.
2. The Bearer authorization header.

Cookie attributes:

| Attribute | Value |
| --- | --- |
| Name | `jwt` |
| `httpOnly` | `true` |
| `secure` | `true` when `NODE_ENV=production` |
| `sameSite` | `strict` |
| `path` | `/` |
| `maxAge` | Derived from the JWT `exp` claim; one-hour fallback |

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | `just_a_demo_secret_key_you_should_change_me` | JWT signing secret |
| `JWT_ALGORITHM` | `HS256` | Signing algorithm and verification allowlist |
| `JWT_EXPIRES_IN` | `1h` | Access-token lifetime |
| `NODE_ENV` | Unset | Enables secure cookies in production |

The configured `JWT_ALGORITHM` is applied as `signOptions.algorithm` when
tokens are issued and as the only allowed verification algorithm in both
`JwtService` and the Passport JWT strategy. Unsupported values cause
application configuration to fail. When using an asymmetric algorithm, the
value of `JWT_SECRET` must contain a key accepted by that algorithm.

Token revocation uses an in-memory `Map<token, expiry>`. Its contents are local
to one application process and are cleared when the process restarts.

## Frontend HTTP API

The following functions are exported from
`@websdr/frontend-core/services`:

| Function | Description |
| --- | --- |
| `setApiBase(base?)` | Sets the API base URL in module state |
| `getApiBase()` | Returns the configured API base URL |
| `apiUrl(path?)` | Joins the API base and a path |
| `apiWsUrl(path?, port?)` | Creates a `ws:` or `wss:` URL |
| `apiFetch<T>(path, init?)` | Calls `fetch` with included credentials |
| `login(credentials?)` | Calls the regular or guest login endpoint |
| `logout()` | Sends a logout request |
| `getProfile()` | Returns the authenticated user object |

### API Base Resolution

The API base is selected in this order:

1. Value passed to `setApiBase()`.
2. `globalThis.__API_BASE__`.
3. `process.env.VITE_API_URL`.
4. `process.env.API_URL`.
5. `import.meta.env.VITE_API_URL`.
6. `import.meta.env.API_URL`.
7. `/`.

Example:

```ts
import {
  apiFetch,
  apiWsUrl,
  setApiBase,
} from '@websdr/frontend-core/services';

setApiBase('https://api.example.com');

const { user } = await apiFetch('/api/auth/profile');
const rpcUrl = apiWsUrl('/rpc');
```

### `apiFetch`

Signature:

```ts
async function apiFetch<T = any>(
  path: string,
  init?: RequestInit,
): Promise<T>
```

The helper always calls `fetch` with `credentials: "include"`. JSON responses
are parsed when `Content-Type` contains `application/json`; other successful
responses are returned as text.

For an unsuccessful JSON response, it throws `Error("API error <status>")`
and stores the parsed body in `error.cause`. For other unsuccessful responses,
the response text is included in the error message.

### Authentication Helpers

```ts
import {
  getProfile,
  login,
  logout,
} from '@websdr/frontend-core/services';

await login({ username: 'admin', password: 'admin' });
const user = await getProfile();
await logout();
```

Calling `login()` without credentials uses `POST /api/auth/guest`.

`login()` wraps `apiFetch()` failures as `Login failed: <original message>`.
`getProfile()` wraps them as
`Failed to fetch profile: <original message>`. In both cases, the original
error is available through `error.cause`.

`logout()` first uses `navigator.sendBeacon()`. If that call throws, it falls
back to `apiFetch()` with `POST` and `keepalive: true`.

## WebSocket API

The repository provides the `NngWebSocket` client. The WebSocket server and
endpoint addresses are supplied by the integrating application.

Supported subprotocols:

| Constant | WebSocket subprotocol | Behavior |
| --- | --- | --- |
| `Protocol.REQ` | `rep.sp.nanomsg.org` | Request/reply using request IDs |
| `Protocol.SUB` | `pub.sp.nanomsg.org` | Receives publications |
| `Protocol.PUB` | `sub.sp.nanomsg.org` | Sends publications |
| `Protocol.UNKNOWN` | Empty | Standard WebSocket |

Constructor:

```ts
const socket = new NngWebSocket({
  url: 'wss://api.example.com/rpc',
  protocol: Protocol.REQ,
  binaryType: NngWebSocket.TEXT,
  reconnectTime: 5,
});
```

Public operations:

| Operation | Description |
| --- | --- |
| `open(url?, binaryType?, protocol?)` | Opens the connection |
| `close()` | Closes the connection |
| `send(data, timeoutMs = 30000)` | Sends data and optionally waits for a REQ reply |
| `isConnecting()` | Checks for `WebSocket.CONNECTING` |
| `isConnected()` | Checks for `WebSocket.OPEN` |

The class dispatches `open`, `close`, `message`, `data`, and `error` events.

In REQ mode, a four-byte big-endian request ID is prepended to the payload. A
reply with the same ID resolves the corresponding `send()` Promise. After an
unexpected close, the client attempts to reconnect after the configured
delay. The default delay is five seconds; `-1` disables reconnection.

Authentication, origin policy, TLS, and message limits are handled outside
this class.

## WebUSB API

WebUSB operates locally in a browser or through a Node.js polyfill. In a
browser, requesting a new device requires a user gesture and a secure context.

Typical lifecycle:

```ts
import {
  ControlWebUsb,
  ensureWebUsb,
  getWebUsbManagerInstance,
  WebUsbManagerMode,
} from '@websdr/frontend-core/webusb';

await ensureWebUsb();

const manager = getWebUsbManagerInstance(WebUsbManagerMode.SINGLE);
const selected = await manager.requestDevice();
if (!selected) throw new Error('No device selected');

const fd = await manager.open(
  selected.vendorId,
  selected.productId,
  selected.device,
);
if (fd < 0) throw new Error('Unable to open device');

const control = new ControlWebUsb({
  mode: WebUsbManagerMode.SINGLE,
});

await control.open(fd);
const device = await control.getDeviceInfo();

await control.close();
await manager.close(fd);
```

### Command Envelope

Request:

```json
{
  "id": "optional-id",
  "req_method": "sdr_set_rx_frequency",
  "req_params": {
    "chans": 1,
    "frequency": 100000000
  },
  "req_data": "optional-base64"
}
```

Typical response:

```json
{
  "id": "optional-id",
  "result": 0,
  "error": "optional error",
  "details": {}
}
```

### `ControlWebUsb` Commands

| API key | `req_method` | Description |
| --- | --- | --- |
| `SET_RX_FREQUENCY` | `sdr_set_rx_frequency` | Sets RX frequency |
| `SET_RX_BANDWIDTH` | `sdr_set_rx_bandwidth` | Sets RX bandwidth |
| `SET_RX_GAIN` | `sdr_set_rx_gain` | Sets RX gain |
| `GET_RX_STREAM_STATUS` | `sdr_get_rx_stream_stats` | Gets RX statistics |
| `SET_TX_FREQUENCY` | `sdr_set_tx_frequency` | Sets TX frequency |
| `SET_TX_BANDWIDTH` | `sdr_set_tx_bandwidth` | Sets TX bandwidth |
| `SET_TX_GAIN` | `sdr_set_tx_gain` | Sets TX gain |
| `START_STREAMING` | `sdr_init_streaming` | Prepares streaming |
| `CONTROL_STREAMING` | `sdr_ctrl_streaming` | Starts or changes streaming |
| `STOP_STREAMING` | `sdr_stop_streaming` | Stops streaming |
| `GET_SENSOR` | `sdr_get_sensor` | Reads a sensor |
| `SET_PARAMETER` | `sdr_set_parameter` | Sets a device parameter |
| `GET_PARAMETER` | `sdr_get_parameter` | Reads a device parameter |
| `DEBUG_DUMP` | `sdr_debug_dump` | Requests a diagnostic dump |
| `CALIBRATE` | `sdr_calibrate` | Calibrates TX, RX, or both |
| `GET_FIRMWARE_REVISION` | `sdr_get_revision` | Gets firmware information |
| `FLASH_READ` | `flash_read` | Reads flash memory |
| `FLASH_WRITE` | `flash_write_sector` | Writes a flash sector |
| `FLASH_ERASE` | `flash_erase` | Erases flash memory |

See [webusb/commands.md](webusb/commands.md) for command parameters and response
examples.

### Main `ControlWebUsb` Methods

| Method | Description |
| --- | --- |
| `open(fd)` | Associates the control object with an open device |
| `close()` | Closes control and debug connections |
| `isOpen()` | Returns whether a device descriptor is assigned |
| `sendCommand(command, args?, extArgs?)` | Sends a predefined command |
| `sendRawCommand(request)` | Sends a raw request object |
| `setParameter(command, args, now?)` | Sends a rate-limited parameter update |
| `setSdrParameter(path, value)` | Sets a hierarchical SDR parameter |
| `getSdrParameter(path)` | Reads a hierarchical SDR parameter |
| `getDeviceInfo(strict?)` | Gets device and firmware identifiers |
| `getStreamStatus()` | Gets the local stream state |
| `setStreamStatus(status)` | Updates the local stream state |
| `calibrate(mode)` | Runs `tx`, `rx`, or `trx` calibration |
| `flashRead(gold?)` | Reads the complete flash image |
| `flashWrite(image, gold?)` | Erases and writes a flash image |
| `flashErase(offset, length)` | Erases a flash range |

`ControlWebUsb` dispatches these events:

- `init`
- `open`
- `close`
- `progress`, with `{ message, value, max }` in `event.detail`

When `debugServer` is configured, `ControlWebUsb` opens a WebSocket connection
to that server. Incoming messages are passed to the device through
`sendDebugCommand()`, and the device response is sent back over the socket.

## Public Package Entrypoints

| Package | Entrypoints |
| --- | --- |
| `@websdr/core` | `.`, `/common`, `/transform`, `/utils` |
| `@websdr/frontend-core` | `.`, `/common`, `/control`, `/services`, `/telemetry`, `/transport`, `/utils`, `/webusb` |
| `@websdr/vue3-components` | `.`, `/components`, `/utils`, `/styles/*` |
| `@websdr/nestjs-microservice` | `.`, `/auth`, `/users`, `/common` |

The HTTP controller is registered by importing `AuthModule`; it is not
exported directly. `AuthService` is exported by the NestJS module for
dependency injection but is not re-exported as a TypeScript symbol from the
package entrypoint. The users entrypoint exports `UsersModule`.

## Source Files

- HTTP controller: `packages/nestjs-microservice/src/auth/auth.controller.ts`
- JWT guard and strategy: `packages/nestjs-microservice/src/auth/`
- Demo users: `packages/nestjs-microservice/src/users/users.service.ts`
- HTTP client: `packages/frontend-core/src/services/`
- WebSocket client: `packages/frontend-core/src/transport/nngWebSocket.ts`
- WebUSB exports: `packages/frontend-core/src/webusb/index.ts`
- SDR commands: `packages/frontend-core/src/webusb/controlWebUsb.ts`
