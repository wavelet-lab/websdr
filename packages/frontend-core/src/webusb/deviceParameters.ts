import { DataType } from '@websdr/core/common';
import { CHUNK_SIZE } from '@websdr/core/common';

/**
 * Numeric parameter range (min/max) used for device capabilities.
 */
export interface DeviceParamRange {
    min: number, // Minimum allowed value
    max: number, // Maximum allowed value
}

/**
 * Parameters describing a single device stream type (available data types).
 */
export interface DeviceStreamParameters {
    dataTypes: Array<DataType>, // Supported `DataType` values for this stream
}

export enum WebUsbDirection {
    RX = 1 << 0,
    TX = 1 << 1,
    RX_TX = RX | TX,
}

export enum DeviceStreamType {
    raw = 'raw',
    sa = 'sa',
    rtsa = 'rtsa',
}

export const DeviceStreamTypeNames = {
    [DeviceStreamType.raw]: 'raw',
    [DeviceStreamType.sa]: 'sa',
    [DeviceStreamType.rtsa]: 'rtsa',
}

export type DeviceStreamTypes = { [key in DeviceStreamType]?: DeviceStreamParameters };

export enum DeviceDataType {
    ci16 = 'ci16',
    ci12 = 'ci12',
}

export const DeviceDataTypeNames = {
    [DeviceDataType.ci16]: 'ci16',
    [DeviceDataType.ci12]: 'ci12',
}

export type DeviceDataTypes = { [key in DeviceStreamType]?: DeviceStreamParameters };

/**
 * Device configuration describing capabilities and defaults.
 */
export interface DeviceConfiguration {
    operationModes: WebUsbDirection; // Supported operation modes (RX, TX, or RX_TX)
    defaultSamplesCount: number, // Default samples count per request
    rxFrequencyRange: DeviceParamRange, // Supported RX frequency range
    txFrequencyRange: DeviceParamRange, // Supported TX frequency range
    bandwidthRange: DeviceParamRange, // Supported filter/bandwidth range
    rateRange: DeviceParamRange, // Supported sample rate range
    streamTypes: DeviceStreamTypes, // Supported stream types and parameters
    txRxDelay: number, // Recommended TX/RX switch delay in microseconds
    warmupPackets: number, // Number of packets to discard while device warms up
}

export const DefaultDeviceConfiguration: DeviceConfiguration = {
    operationModes: WebUsbDirection.RX_TX,
    defaultSamplesCount: CHUNK_SIZE,
    rxFrequencyRange: { min: 30e6, max: 3800e6 },
    txFrequencyRange: { min: 30e6, max: 3800e6 },
    bandwidthRange: { min: 500e3, max: 20e6 },
    rateRange: { min: 100e3, max: 40e6 },
    streamTypes: { [DeviceStreamType.raw]: { dataTypes: [DataType.ci16] } },
    txRxDelay: 0,
    warmupPackets: 0,
}
