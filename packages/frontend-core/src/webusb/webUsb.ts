import type { WebUsbParams } from './webUsbBase';
import { WebUsbXsdr, WebUsbUsdr } from './webUsbWsdr';
import { WebUsbLimeSdr } from './webUsbLimeSdr';

export interface DeviceId {
    vendorId: number,
    productId: number,
}

export const SDRDevicesIds: Array<DeviceId> = [
    { vendorId: 0xfaee, productId: 0xdea9 }, //Wavelet WebSDR (LMS6002) mock ids
    { vendorId: 0xfaef, productId: 0xdea9 }, //Wavelet WebSDR (LMS7002) mock ids
    { vendorId: 0x3727, productId: 0x1001 }, //Wavelet WebSDR (LMS6002) real ids
    { vendorId: 0x3727, productId: 0x1011 }, //Wavelet WebSDR (LMS7002) real ids
    { vendorId: 0x0403, productId: 0x601f }, //Future Technology Devices International, Ltd LimeSDR Mini (LMS7002)
];

export function getDeviceHash(devId: DeviceId | undefined): number {
    if (!devId) return 0;
    // ensure 32-bit unsigned hash to avoid negative values because of JS bitshift sign
    const v = (devId.vendorId & 0xffff) >>> 0;
    const p = (devId.productId & 0xffff) >>> 0;
    return ((v << 16) | p) >>> 0;
}

// use Map for clearer typing and safer lookups
type WebUsbConstructor = new (params: WebUsbParams) => any;

const webUsbMap = new Map<number, WebUsbConstructor>([
    [getDeviceHash(SDRDevicesIds[0]), WebUsbUsdr],
    [getDeviceHash(SDRDevicesIds[1]), WebUsbXsdr],
    [getDeviceHash(SDRDevicesIds[2]), WebUsbUsdr],
    [getDeviceHash(SDRDevicesIds[3]), WebUsbXsdr],
    [getDeviceHash(SDRDevicesIds[4]), WebUsbLimeSdr],
]);

export function getWebUsbInstance(key: number, params: WebUsbParams): InstanceType<WebUsbConstructor> | undefined {
    const webUsbConstructor = webUsbMap.get(key);
    if (!webUsbConstructor) return undefined;
    return new webUsbConstructor(params);
}
