import { registerWebUsbInstance } from '../webUsb';
import { DefaultDeviceConfiguration } from '../deviceParameters';
import type { DeviceConfiguration } from '../deviceParameters';
import { WebUsb } from '../webUsbBase';
import type { WebUsbParams, RXBuffer, TXBuffer, RXDecoderOptions, TXEncoderOptions } from '../webUsbBase';
import { DataType } from '@websdr/core/common';

// Driver template for a new SDR device.
// Copy this file, rename the class, and fill in vendorId/productId and device-specific logic.

export class WebUsbTemplate extends WebUsb {
    static VENDOR_ID = 0x1234; // TODO: replace with real vendorId
    static PRODUCT_ID = 0xabcd; // TODO: replace with real productId

    constructor(params: WebUsbParams) {
        super(params);
    }

    getConfiguration(): DeviceConfiguration {
        // Return device configuration (frequency ranges, stream types, defaults).
        return DefaultDeviceConfiguration;
    }

    getRXSamplesCount(samples: number): number {
        // Adjust samples count for device-specific requirements if needed.
        return samples;
    }

    getRXPacketSize(samples: number): number {
        // RX packet size in bytes for the given number of samples
        const dtype = DataType.ci16;
        return samples * WebUsb.getSampleByteLength(dtype);
    }

    getTXPacketSize(samples: number): number {
        const dtype = DataType.ci16;
        return samples * WebUsb.getSampleByteLength(dtype);
    }

    async decodeRxData(data: DataView, samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        // Minimal implementation: return raw buffer metadata.
        // A real driver should parse headers, handle alignment, overruns, timestamps, etc.
        return {
            data: data.buffer,
            datatype: DataType.ci16,
            id: opts?.id ?? 0,
            samples: samples,
            timestamp: BigInt(Date.now()),
            overrun: 0,
            realigned: 0,
            dropped: 0,
            recvsize: data.byteLength,
        };
    }

    async encodeTxData(data: TXBuffer, opts?: TXEncoderOptions): Promise<ArrayBufferLike> {
        // Convert `data.data` to device-specific transmit format.
        // By default return the provided buffer as-is.
        return data.data;
    }

    async sendCommandToDevice(req: Record<string, any>): Promise<Record<string, any>> {
        return {
            result: 'ok',
            details: {},
        };
    }
}

/*
 Register the new driver class with the WebUsb system
 just uncomment the registerWebUsbInstance call and
 replace WebUsbTemplate with your new class name.
*/
// registerWebUsbInstance(WebUsbTemplate);
