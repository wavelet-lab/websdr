import { describe, it, expect } from 'vitest';
import { getDeviceHash, getWebUsbInstance, SDRDevicesIds } from '@/webusb/webUsb';
import { WebUsbUsdr, WebUsbXsdr } from '@/webusb/webUsbWsdr';
import { WebUsbLimeSdr } from '@/webusb/webUsbLimeSdr';
import type { WebUsbParams } from '@/webusb/webUsbBase';

const dummyParams = {} as WebUsbParams;

describe('webUsb utilities', () => {
    it('getDeviceHash: undefined -> 0 and deterministic unsigned value', () => {
        expect(getDeviceHash(undefined)).toBe(0);
        const h = getDeviceHash(SDRDevicesIds[0]);
        // value is a non-negative integer
        expect(Number.isInteger(h)).toBe(true);
        expect(h).toBeGreaterThanOrEqual(0);
    });

    it('getWebUsbInstance returns correct constructor instance for known devices', () => {
        const h2 = getDeviceHash(SDRDevicesIds[2]);
        const inst2 = getWebUsbInstance(h2, dummyParams);
        expect(inst2).toBeDefined();
        expect(inst2).toBeInstanceOf(WebUsbUsdr);

        const h3 = getDeviceHash(SDRDevicesIds[3]);
        const inst3 = getWebUsbInstance(h3, dummyParams);
        expect(inst3).toBeDefined();
        expect(inst3).toBeInstanceOf(WebUsbXsdr);

        const h4 = getDeviceHash(SDRDevicesIds[4]);
        const inst4 = getWebUsbInstance(h4, dummyParams);
        expect(inst4).toBeDefined();
        expect(inst4).toBeInstanceOf(WebUsbLimeSdr);
    });

    it('getWebUsbInstance returns undefined for unknown key', () => {
        const inst = getWebUsbInstance(0xdeadbeef, dummyParams);
        expect(inst).toBeUndefined();
    });
});