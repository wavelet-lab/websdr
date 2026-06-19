# WebSDR

[WebSDR](https://github.com/wavelet-lab/websdr) is an open-source TypeScript monorepo that provides libraries and tools for building web applications that work with Software Defined Radios (SDR) using WebUSB and related browser/node tooling.

## Supported SDR hardware

Currently supported SDR devices:

1. [Wavelet uSDR](https://docs.wsdr.io/hardware/usdr.html) — can be connected via the [Development Board](https://docs.wsdr.io/hardware/devboard.html) or the [USB adapter](https://docs.wsdr.io/hardware/usbadapter.html).
2. [Wavelet xSDR](https://docs.wsdr.io/hardware/xsdr.html) — can be connected via the [Development Board](https://docs.wsdr.io/hardware/devboard.html) or the [USB adapter](https://docs.wsdr.io/hardware/usbadapter.html).
3. [LimeSDR Mini v2](https://limesdr-mini.myriadrf.org/v2.2/) — tested with v2.2; should also work with v2.3 and v2.4.
4. [SSDR](https://www.crowdsupply.com/wavelet-lab/ssdr)
5. [XTRX](https://www.crowdsupply.com/fairwaves/xtrx)
6. RTLSDR - support is in progress

## What is WebSDR?

WebSDR contains utilities, UI components, backend modules, and small test apps to make it easier to build browser-based SDR applications and tooling. The primary goal is to enable interaction with SDR devices connected over USB from web applications (via WebUSB), and to provide supporting building blocks for dashboards, demos, and server-side microservices.

Core capabilities include:
- [WebUSB device management](docs/webusb/README.md) (requesting devices, selecting devices in UI components).
- A small Vue 3 component library for dashboards and controls (dropdowns, lists, inputs, log viewers).
- NestJS modules for microservices (authentication, API scaffolding) useful for backend parts of an SDR web platform.
- Utility modules: circular buffers, data conversion helpers, string utilities, time helpers and promise helpers used across frontend and backend.

## Documentation

- Docs index: [docs/README.md](docs/README.md)
- WebUSB / SDR interaction subsystem: [docs/webusb/README.md](docs/webusb/README.md)
- Manual / hardware tests: [test-apps/README.md](test-apps/README.md)

## Repository layout

Top-level structure (important folders):

```
packages/
├─ core/                # Shared domain types, utilities, constants
├─ frontend-core/       # Front-end utilities and WebUSB adapters
├─ vue3-components/     # Reusable Vue 3 UI components and styles
├─ nestjs-microservice/ # NestJS modules (auth, API helpers, microservice wiring)
docs/                   # Architecture and subsystem documentation
test-apps/              # Small example/test applications and scripts
```

Brief package descriptions:
- `packages/core` — Core shared library with domain types, utilities, constants and radio-related helpers.
- `packages/frontend-core` — Front-end core utilities, WebUSB adapters, and services used by client apps.
- `packages/vue3-components` — Vue 3 component library (examples: `SdrInput`, `Dropdown`, `List`, `LogArea`). Built with Vite; ships TypeScript types and styles.
- `packages/nestjs-microservice` — Reusable NestJS modules for authentication, users, and logging.
- `test-apps` — Small scripts and demo pages used to test low-level functionality (e.g., `usb-test.ts`).

## Published npm packages

This monorepo publishes several packages under the `@websdr/*` scope. If you only want to consume the libraries (not develop inside the monorepo), install them from npm.

- `@websdr/core` — shared types/constants and small utilities.
	- Docs: [packages/core/README.md](packages/core/README.md)
	- Install: `npm install @websdr/core`
- `@websdr/frontend-core` — frontend utilities (API helpers, WebUSB abstraction).
	- Docs: [packages/frontend-core/README.md](packages/frontend-core/README.md)
	- Install: `npm install @websdr/frontend-core`
- `@websdr/vue3-components` — Vue 3 UI components + styles.
	- Docs: [packages/vue3-components/README.md](packages/vue3-components/README.md)
	- Install: `npm install @websdr/vue3-components`
- `@websdr/nestjs-microservice` — reusable NestJS modules (auth/users/logging).
	- Docs: [packages/nestjs-microservice/README.md](packages/nestjs-microservice/README.md)
	- Install: `npm install @websdr/nestjs-microservice`

## Quick setup

Install dependencies for the workspace:

```bash
npm install
```

If you only want to use the libraries as dependencies, see **Published npm packages** above.

Build the packages:

```bash
npm run build
```

Run tests (runs workspace tests):

```bash
npm run test
```

Run all tests
```bash
npm run test:all
```

Run all tests and watch for changes
```bash
npm run test:watch
```

Run coverage check
```bash
npm run test:coverage
```

## Running test applications

Example test apps live in `test-apps`. To run them:

```bash
cd test-apps
npm install
npm run test:usb
```

Note: WebUSB requires HTTPS or localhost and browser support. Running tests that access USB devices may require additional browser flags or permissions.

Manual test notes and troubleshooting: [test-apps/README.md](test-apps/README.md)

## Environment / Configuration

`packages/nestjs-microservice` uses the host NestJS application's environment. The package currently reads:

| Variable | Required | Default | Used for |
| --- | --- | --- | --- |
| `JWT_SECRET` | Recommended | `just_a_demo_secret_key_you_should_change_me` | JWT signing secret. Set a strong value outside development. |
| `JWT_ALGORITHM` | No | `HS256` | JWT signing algorithm and verification allowlist. |
| `JWT_EXPIRES_IN` | No | `1h` | Default access-token lifetime. |
| `LOG_LEVELS` | No | NestJS default | Optional comma-separated NestJS log levels, or `all`/`on`/`off`, when wired through the logging helpers. |
| `NODE_ENV` | No | unset | When set to `production`, auth cookies are marked `secure`. |

## Funding

This project is funded through [NGI0 Commons Fund](https://nlnet.nl/commonsfund), a fund established by [NLnet](https://nlnet.nl) with financial support from the European Commission's [Next Generation Internet](https://ngi.eu) program. Learn more at the [NLnet project page](https://nlnet.nl/project/WSDR).

[<img src="https://nlnet.nl/logo/banner.png" alt="NLnet foundation logo" width="20%" />](https://nlnet.nl)
[<img src="https://nlnet.nl/image/logos/NGI0_tag.svg" alt="NGI Zero Logo" width="20%" />](https://nlnet.nl/commonsfund)

## License

WebSDR is [MIT licensed](https://github.com/wavelet-lab/websdr/blob/main/LICENSE)
