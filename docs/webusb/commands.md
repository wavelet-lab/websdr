# SDR Command Catalog

This file documents each high-level command used by the wsdr.io control abstraction. For each command there is:

- a short description
- an example input JSON (what the frontend sends)
- an expected response shape / example (what drivers return)

General request shape (typical):
```json5
{
    "id": "<id>",                           // optional identifier, if you want to get the same id in the response
    "req_method": "<req_method>",           // the command name (see sections below)
    "req_params": { ... },                  // optional command-specific parameters
	"req_data": "<optional base64 payload>" // optional command-specific data
}
```

General response shape (typical):

```json5
{
    "id": "<id>",                           // optional request identifier (echoed back if provided)
    "result": 0,                            // 0 indicates success, non-zero for errors
	"error": "<description>",               // optional error description if the result is non-zero
	"details": { ... }                      // optional command-specific details
}
```

Description of common parameters:

- `chans`: channel bitmask selecting logical channels (bit0 -> channel 0, bit1 -> channel 1, etc.). Use a small integer mask (e.g., `1` = channel0, `3` = channel0+channel1).
- `samplerate`: sample rate in Hz (integer).
- `packetsize`: packet size in samples/symbols for each channel (integer).
- `throttleon`: throttle threshold; if `0` throttling is disabled, otherwise start throttling if `samplerate > throttleon`.
- `param`: implementation-specific bitfield used by streaming/control calls (see `sdr_init_streaming` / `sdr_ctrl_streaming` / `sdr_calibrate` sections for details).
- `mode`: stream mode — `1` = RX, `2` = TX, `3` = RX+TX.
- `dataformat`: data format string. Can be a single format (e.g., `ci16`, `cf32`) or `HOST@WIRE` form (e.g., `cf32@ci12`) meaning the device uses `ci12` on its wire/internal interface while presenting `cf32` to the host.
- `frequency`: frequency in Hz (integer).
- `bandwidth`: bandwidth in Hz (integer).
- `gain`: gain value (units/device-specific).
- `path`: hierarchical device parameter path (for `sdr_set_parameter` / `sdr_get_parameter`).
- `offset`, `length`, `checksum`: flash operation parameters (byte offsets, lengths, and checksum values). `req_data` carries base64-encoded bytes for write operations.

---

## Command Categories Overview


The abstract command set is grouped into the following logical categories:

- [RX control](#rx-control): frequency, bandwidth, gain, and stream statistics
- [TX control](#tx-control): frequency, bandwidth, gain, and channel selection
- [Streaming control](#streaming-control): start, stop, and runtime streaming configuration
- [Device management](#device-management): firmware revision and device info
- [Parameters & sensors](#parameters--sensors): generic parameter access and runtime sensor queries
- [Calibration & diagnostics](#calibration--diagnostics): calibration procedures and debug dumps
- [Persistent storage (flash)](#persistent-storage-flash): flash read, write, and erase operations

For command details and examples, see the sections below.

---

## Categories (quick links)

### RX control

Receive-side commands: frequency, bandwidth, gain, and stream statistics.

- [sdr_set_rx_frequency](#sdr_set_rx_frequency)
- [sdr_set_rx_bandwidth](#sdr_set_rx_bandwidth)
- [sdr_set_rx_gain](#sdr_set_rx_gain)
- [sdr_get_rx_stream_stats](#sdr_get_rx_stream_stats)

### TX control

Transmit-side commands: frequency, bandwidth, and gain control.

- [sdr_set_tx_frequency](#sdr_set_tx_frequency)
- [sdr_set_tx_bandwidth](#sdr_set_tx_bandwidth)
- [sdr_set_tx_gain](#sdr_set_tx_gain)

### Streaming control

Commands to initialize, control, and stop IQ streaming.

- [sdr_init_streaming](#sdr_init_streaming)
- [sdr_stop_streaming](#sdr_stop_streaming)
- [sdr_ctrl_streaming](#sdr_ctrl_streaming)

### Device management

Device info operations.

- [sdr_get_revision](#sdr_get_revision)

### Parameters & sensors

Generic parameter access and sensor queries.

- [sdr_set_parameter](#sdr_set_parameter)
- [sdr_get_parameter](#sdr_get_parameter)
- [sdr_get_sensor](#sdr_get_sensor)

### Calibration & diagnostics

Calibration routines and debug dumps.

- [sdr_calibrate](#sdr_calibrate)
- [sdr_debug_dump](#sdr_debug_dump)

### Persistent storage (flash)

Flash read/write/erase operations.

- [flash_read](#flash_read)
- [flash_write_sector](#flash_write_sector)
- [flash_erase](#flash_erase)

---

## RX control

Receive-side commands: frequency, bandwidth, gain, and stream statistics.

### sdr_set_rx_frequency

Set receive frequency for one or more channels.

Input example:

```json5
{
	"req_method": "sdr_set_rx_frequency",
	"req_params": {
		"chans": 1,
		"frequency": 100000000
	}
}
```

Expected response example:

```json5
{
	"result": 0,
	"details": {
		"actual-frequency": 100000000
	}
}
```

---

### sdr_set_rx_bandwidth

Set receive bandwidth for channel(s).

Input example:

```json5
{
	"req_method": "sdr_set_rx_bandwidth",
	"req_params": {
		"chans": 1,
		"bandwidth": 1000000
	}
}
```

Expected response:

```json5
{
	"result": 0,
	"details": {
		"actual-frequency": 1000000
	}
}
```

---

### sdr_set_rx_gain

Set RX gain for channel(s).

Input example:

```json5
{
	"req_method": "sdr_set_rx_gain",
	"req_params": {
		"chans": 1,
		"gain": 15
	}
}
```

Expected response:

```json5
{
	"result": 0,
	"details": {
		"actual-gain": 15
	}
}
```

---

### sdr_get_rx_stream_stats

Request current RX stream statistics (processed, loss).

Input example:

```json5
{
	"req_method": "sdr_get_rx_stream_stats"
}
```

Expected response (example):

```json5
{
	"result": 0,
	"details": {
		"samples_processed": 12345678,
		"samples_lost": 12
	}
}
```

---

## TX control

Transmit-side commands: frequency, bandwidth, and gain control.

### sdr_set_tx_frequency

Set transmit frequency for TX channels.

Input example:

```json5
{
	"req_method": "sdr_set_tx_frequency",
	"req_params": {
		"chans": 1,
		"frequency": 100000000
	}
}
```

Expected response:

```json5
{
	"result": 0,
	"details": {
		"actual-frequency": 100000000
	}
}
```

---

## sdr_set_tx_bandwidth

Set TX bandwidth.

Input example:

```json5
{
	"req_method": "sdr_set_tx_bandwidth",
	"req_params": {
		"chans": 1,
		"bandwidth": 1000000
	}
}
```

Expected response:

```json5
{
	"result": 0,
	"details": {
		"actual-frequency": 1000000
	}
}
```

---

## sdr_set_tx_gain

Set TX gain for one or more channels.

Input example:

```json5
{
	"req_method": "sdr_set_tx_gain",
	"req_params": {
		"chans": 1,
		"gain": 0
	}
}
```

Expected response:

```json5
{
	"result": 0,
	"details": {
		"actual-gain": 0
	}
}
```

---


## Streaming control

Commands to initialize, control, and stop IQ streaming.

### sdr_init_streaming

Initialize and start streaming with explicit packetization and format.

Input example:

```json5
{
	"req_method": "sdr_init_streaming",
	"req_params": {
		"chans": 1,
		"samplerate": 1000000,
		"packetsize": 8192,
		"throttleon": 10000000,
		"param": 0,    // see description below
		"mode": 1,
		"dataformat": "ci16"
	}
}
```

Param bitfield (`req_params.param`):

- Bits 0..2 (`0x1..0x7`): synchronization selector. Mapped values are: `1` => "1pps", `2` => "rx", `3` => "tx", `5` => "any", `7` => "none" (others => "off").
- Bit 3 (`0x8`): start/stop control. If set, stream is not started; if clear, stream is started.
- Bit 4 (`0x10`): enable RX extended statistics.

Examples: `param=15` => start stream; `param=31` - start stream with extended RX stats.

Expected response:

```json5
{
	"result": 0,
	"details": {
		"wire-block-size": 0,
		"wire-bursts": 0
	}
}
```

Note: actual stream data is sent on the streaming endpoint; this command configures and readies the device.

---

### sdr_stop_streaming

Stop streaming.

Input example:

```json5
{
	"req_method": "sdr_stop_streaming"
}
```

Expected response:

```json5
{
	"result": 0,
	"details": { }
}
```

---

### sdr_ctrl_streaming

Runtime streaming control (update samplerate, throttling, etc.).

Input example:

```json5
{
	"req_method": "sdr_ctrl_streaming",
	"req_params": {
		"samplerate": 1000000,
		"throttleon": 0,
		"param": 42    // see description below
	}
}
```

Param bitfield (`req_params.param`):

- Bits 0..2 (`0x1..0x7`): synchronization selector. Mapped values are: `1` => "1pps", `2` => "rx", `3` => "tx", `5` => "any", `7` => "none" (others => "off").
- Bit 3 (`0x8`): start/stop control. If set, stream is not started; if clear, stream is started.
- Bit 4 (`0x10`): If set, restart stream
- Special value 42 (`0x2A`) - don't touch timestamp

Examples: `param=42` - don't touch timestamp.

Expected response:

```json5
{
	"result": 0,
	"details": { }
}
```

---

## Device management

Device info operations.

### sdr_get_revision

Query firmware/device revision information.

Input example:

```json5
{
	"req_method": "sdr_get_revision"
}
```

Expected response (example):

```json5
{
	"result": 0,
	"details": {
		"device": "usdr",
		"devid": "1234",
		"devrev": "3",
		"revision": "20251205151723"
	}
}
```

---

## Parameters & sensors

Generic parameter access and sensor queries.

### sdr_get_sensor

Query a sensor (temperature, RSSI, etc.).

Input example:

```json5
{
	"req_method": "sdr_get_sensor",
	"req_params": {
		"sensor": "sdr_temp"
	}
}
```

Expected response example:

```json5
{
	"result": 0,
	"details": {
		"sensor": "sdr_temp",
		"value": 42.3
	}
}
```

---

### sdr_set_parameter

Generic parameter setter for hierarchical device parameters.

Input example:

```json5
{
	"req_method": "sdr_set_parameter",
	"req_params": {
		"path": "/dm/sdr/0/rx/bandwidth",
		"value": 1000000
	}
}
```

Expected response:

```json5
{
	"result": 0,
	"details": {
		"path": "/dm/sdr/0/rx/bandwidth",
		"value": 1000000
	}
}
```

---

### sdr_get_parameter

Read a generic parameter.

Input example:

```json5
{
	"req_method": "sdr_get_parameter",
	"req_params": {
		"path": "/dm/sensor/temp"
	}
}
```

Expected response:

```json5
{
	"result": 0,
	"details": {
		"path": "/dm/sensor/temp",
		"value": 42.3
	}
}
```

---

## Calibration & diagnostics

Calibration routines and debug dumps.

### sdr_debug_dump

Request debug state dump from device/adapter.

Input example:

```json5
{
	"req_method": "sdr_debug_dump"
}
```

Expected response (example):

```json5
{
	"result": 0,
	"details": {
		"dump": "..."
	}
}
```

---

### sdr_calibrate

Trigger calibration routines.

Input example:

```json5
{
	"req_method": "sdr_calibrate",
	"req_params": {
		"chans": 1,
		"param": 15    // see description below
	}
}
```

Parameters (`req_params.param`):

- This `param` is a bitmask selecting calibration sub-steps/options. The value is passed directly to the device calibration routine.
- Known flags for xsdr:
	- `1` (XSDR_CAL_RXLO): calibrate RX local oscillator (RX LO)
	- `2` (XSDR_CAL_TXLO): calibrate TX local oscillator (TX LO)
	- `4` (XSDR_CAL_RXIQIMB): calibrate RX IQ imbalance
	- `8` (XSDR_CAL_TXIQIMB): calibrate TX IQ imbalance
	- `256` (XSDR_CAL_EXT_FB): use external TX feed/feedback during calibration
	- `65536` (XSDR_DONT_SETBACK): do not apply calibration restore/setback (implementation-specific)

Examples:
- `param: 5` — RX LO imbalance calibration.
- `param: 10` — TX LO imbalance calibration.
- `param: 15` — RX LO + TX LO imbalance calibration.

Note: Some flags are device-specific and may be ignored by other hardware. Check the device documentation or driver implementation for exact behavior.

Expected response:

```json5
{
	"result": 0,
	"details": { }
}
```

---


## Persistent storage (flash)

Flash read/write/erase operations.

### flash_read

Read flash/EEPROM sectors. Returns base64-encoded data in `details.data`.

Input example:

```json5
{
	"req_method": "flash_read",
	"req_params": {
		"offset": 0,
		"param": 0
	}
}
```

Expected response (example):

```json5
{
	"result": 0,
	"details": {
		"offset": 0,
		"length": 256,
		"data": "<base64>"
	}
}
```

Client code should base64-decode `details.data` to obtain bytes (see `ControlWebUsb.flashReadSector`).

---

### flash_write_sector

Write a flash sector. `req_data` should carry base64-encoded bytes.

Input example:

```json5
{
	"req_method": "flash_write_sector",
	"req_params": {
		"offset": 0,
		"checksum": 12345,
		"param": 0
	},
	"req_data": "<base64>"
}
```

Expected response:

```json5
{
	"result": 0,
	"details": { }
}
```

---

### flash_erase

Erase flash region.

Input example:

```json5
{
	"req_method": "flash_erase",
	"req_params": {
		"offset": 0,
		"length": 4096
	}
}
```

Expected response:

```json5
{
	"result": 0,
	"details": { }
}
```

---

## Notes

- Implementations may provide additional fields in `details` specific to the driver.
- On error, `result` will be non-zero and `error` may contain a message.
- For streaming commands, most payloads are delivered asynchronously over the streaming endpoint; control replies only indicate command acceptance/state.

