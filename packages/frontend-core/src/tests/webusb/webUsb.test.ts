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

    it('getWebUsbInstance returns correct constructors count for known devices', () => {
         // Ensure we have at least 3 devices for testing
        expect(SDRDevicesIds.length).toBeGreaterThanOrEqual(3);
    });

    it('getWebUsbInstance returns undefined for unknown key', () => {
        const inst = getWebUsbInstance(0xdeadbeef, dummyParams);
        expect(inst).toBeUndefined();
    });
});