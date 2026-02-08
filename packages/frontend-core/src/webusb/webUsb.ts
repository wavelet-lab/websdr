import type { WebUsbParams } from './webUsbBase';

export interface DeviceId {
    vendorId: number,
    productId: number,
}

export const SDRDevicesIds: Array<DeviceId> = [];

// use Map for clearer typing and safer lookups
type WebUsbConstructor = {
    new (params: WebUsbParams): any;
    readonly VENDOR_ID: number;
    readonly PRODUCT_ID: number;
};

const webUsbMap = new Map<number, WebUsbConstructor>();

export function getDeviceHash(devId: DeviceId | undefined): number {
    if (!devId) return 0;
    // ensure 32-bit unsigned hash to avoid negative values because of JS bitshift sign
    const v = (devId.vendorId & 0xffff) >>> 0;
    const p = (devId.productId & 0xffff) >>> 0;
    return ((v << 16) | p) >>> 0;
}

export function registerWebUsbInstance(constructor: WebUsbConstructor): void {
    const devId: DeviceId = { vendorId: constructor.VENDOR_ID, productId: constructor.PRODUCT_ID };
    const key = getDeviceHash(devId);
    webUsbMap.set(key, constructor);
    // ensure SDRDevicesIds contains this id for device filtering (avoid duplicates)
    const exists = SDRDevicesIds.some(d => d.vendorId === devId.vendorId && d.productId === devId.productId);
    if (!exists) {
        SDRDevicesIds.push(devId);
    }
}

export function getWebUsbInstance(key: number, params: WebUsbParams): InstanceType<WebUsbConstructor> | undefined {
    const webUsbConstructor = webUsbMap.get(key);
    if (!webUsbConstructor) return undefined;
    return new webUsbConstructor(params);
}
