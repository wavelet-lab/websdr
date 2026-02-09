# SDR Control Model

This document describes the high-level SDR control model used by the WebSDR
SDR interaction subsystem.

The control model is device-agnostic and hides USB- and vendor-specific
details from the web application.

---

## Command Structure

Each SDR command consists of:

- Method identifier (`req_method`)
- Optional parameters (`req_params`)
- Optional binary payload (`req_data`)

Commands are expressed as structured objects and dispatched to device drivers.

Typical request shape:

```json5
{
	"id": "<optional id>",
	"req_method": "<command name>",
	"req_params": { /* command-specific parameters */ },
	"req_data": "<optional base64 payload>"
}
```

Typical response shape:

```json5
{
	"id": "<optional id>",
	"result": 0,
	"error": "<optional error description>",
	"details": { /* optional command-specific details */ }
}
```

---

## Command Categories

- RX control (frequency, bandwidth, gain, statistics)
- TX control (frequency, bandwidth, gain)
- Streaming control (start, stop, runtime adjustments)
- Device management (remote session drivers; intentionally not covered in this WebUSB-focused documentation)
- Parameters and sensors
- Calibration and diagnostics
- Persistent storage access

---

## Command Lifecycle

A typical **local WebUSB** SDR session follows this lifecycle:

1. User selects a device via the WebUSB chooser
2. Driver opens/claims the device and initializes transport
3. Configure RX/TX parameters using high-level commands
4. Start streaming (`sdr_init_streaming`)
5. Adjust parameters at runtime (`sdr_ctrl_streaming`, tuning, gains)
6. Stop streaming (`sdr_stop_streaming`)
7. Driver closes/releases the device

This lifecycle is enforced locally in the browser.

For the command catalog and examples see: [SDR Command Catalog](commands.md).
