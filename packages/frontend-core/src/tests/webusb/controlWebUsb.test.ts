import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ControlWebUsb, WebUsbChannels, WebUsbDirection } from '@/webusb/controlWebUsb';
import { WebUsbManagerMode } from '@/webusb/webUsbManager';
import { DataType } from '@websdr/core/common';

describe('ControlWebUsb', () => {
    let control: ControlWebUsb;
    let mockWebUsbManager: any;

    beforeEach(() => {
        // Mocking the Worker class
        (globalThis as any).Worker = class {
            constructor() { }
            addEventListener(_: string, __: any) { }
            removeEventListener(_: string, __: any) { }
            postMessage(_: any, __?: any) { }
            terminate() { }
        };

        mockWebUsbManager = {
            sendCommand: vi.fn().mockResolvedValue({ result: 0 }),
            getStreamStatus: vi.fn().mockResolvedValue('STOPPED'),
            setStreamStatus: vi.fn().mockResolvedValue(undefined),
            sendDebugCommand: vi.fn().mockResolvedValue('{}'),
        };

        control = new ControlWebUsb();
        control.setCustomWebUsbManager(mockWebUsbManager);
    });

    afterEach(async () => {
        if (control.isOpen()) {
            await control.close();
        }
        // Delete Worker mock after test
        delete (globalThis as any).Worker;
    });

    describe('constructor', () => {
        it('should create instance with default parameters', () => {
            const ctrl = new ControlWebUsb();
            expect(ctrl).toBeInstanceOf(ControlWebUsb);
        });

        it('should create instance with custom parameters', () => {
            const ctrl = new ControlWebUsb({
                control_ep: 1,
                control_rep_ep: 2,
                notification_ep: 3,
                type: DataType.ci16,
                mode: WebUsbManagerMode.WORKER,
            });
            expect(ctrl).toBeInstanceOf(ControlWebUsb);
        });
    });

    describe('open and close', () => {
        it('should open connection', async () => {
            await control.open(1);
            expect(control.isOpen()).toBe(true);
        });

        it('should close connection', async () => {
            await control.open(1);
            await control.close();
            expect(control.isOpen()).toBe(false);
        });

        it('should dispatch open event', async () => {
            const openHandler = vi.fn();
            control.addEventListener('open', openHandler);
            await control.open(1);
            expect(openHandler).toHaveBeenCalled();
        });

        it('should dispatch close event', async () => {
            const closeHandler = vi.fn();
            control.addEventListener('close', closeHandler);
            await control.open(1);
            await control.close();
            expect(closeHandler).toHaveBeenCalled();
        });
    });

    describe('sendCommand', () => {
        beforeEach(async () => {
            await control.open(1);
        });

        it('should throw error when fd is invalid', async () => {
            await control.close();
            await expect(control.sendCommand('CONNECT')).rejects.toThrow();
        });

        it('should send CONNECT command', async () => {
            await control.sendCommand('CONNECT');
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalled();
        });

        it('should send command with arguments', async () => {
            await control.sendCommand('SET_RX_FREQUENCY', { frequency: 915e6 });
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalledWith(
                1,
                expect.objectContaining({
                    req_method: 'sdr_set_rx_frequency',
                    req_params: expect.objectContaining({ frequency: 915e6 }),
                })
            );
        });

        it('should handle START_STREAMING command', async () => {
            mockWebUsbManager.getStreamStatus.mockResolvedValue('STOPPED');
            await control.sendCommand('START_STREAMING');
            expect(mockWebUsbManager.setStreamStatus).toHaveBeenCalledWith(1, 'PREPARED');
        });

        it('should handle STOP_STREAMING command', async () => {
            mockWebUsbManager.getStreamStatus.mockResolvedValue('STARTED');
            await control.sendCommand('STOP_STREAMING');
            expect(mockWebUsbManager.setStreamStatus).toHaveBeenCalledWith(1, 'STOPPED');
        });
    });

    describe('setParameter', () => {
        beforeEach(async () => {
            await control.open(1);
        });

        it('should set parameter immediately when now=true', async () => {
            await control.setParameter('SET_RX_GAIN', { gain: 20 }, true);
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalled();
        });

        it('should defer parameter setting when now=false', async () => {
            await control.setParameter('SET_RX_GAIN', { gain: 20 }, false);
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalled();
        });

        it('should handle function arguments', async () => {
            await control.setParameter('SET_RX_GAIN', () => ({ gain: 25 }), true);
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalled();
        });
    });

    describe('setSdrParameter and getSdrParameter', () => {
        beforeEach(async () => {
            await control.open(1);
        });

        it('should set SDR parameter', async () => {
            mockWebUsbManager.sendCommand.mockResolvedValue({ result: 0 });
            await control.setSdrParameter('test.path', 42);
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalledWith(
                1,
                expect.objectContaining({
                    req_method: 'sdr_set_parameter',
                    req_params: expect.objectContaining({ path: 'test.path', value: 42 }),
                })
            );
        });

        it('should throw error when set parameter fails', async () => {
            mockWebUsbManager.sendCommand.mockResolvedValue({ result: -1 });
            await expect(control.setSdrParameter('test.path', 42)).rejects.toThrow();
        });

        it('should get SDR parameter', async () => {
            mockWebUsbManager.sendCommand.mockResolvedValue({
                result: 0,
                details: { path: 'test.path', value: 100 },
            });
            const value = await control.getSdrParameter('test.path');
            expect(value).toBe(100);
        });

        it('should throw error when get parameter fails', async () => {
            mockWebUsbManager.sendCommand.mockResolvedValue({ result: -1 });
            await expect(control.getSdrParameter('test.path')).rejects.toThrow();
        });
    });

    describe('getDeviceInfo', () => {
        beforeEach(async () => {
            await control.open(1);
        });

        it('should return device info', async () => {
            mockWebUsbManager.sendCommand.mockResolvedValue({
                result: 0,
                details: {
                    device: 'TestDevice',
                    devid: '12345',
                    devrev: 'v1',
                    revision: '1.0.0',
                },
            });
            const info = await control.getDeviceInfo();
            expect(info.device).toBe('TestDevice');
            expect(info.deviceId).toBe('12345');
        });

        it('should return empty info when non-strict and error occurs', async () => {
            mockWebUsbManager.sendCommand.mockResolvedValue({ result: -1 });
            const info = await control.getDeviceInfo(false);
            expect(info.device).toBe('');
        });

        it('should throw when strict and error occurs', async () => {
            mockWebUsbManager.sendCommand.mockResolvedValue({ result: -1 });
            await expect(control.getDeviceInfo(true)).rejects.toThrow();
        });
    });

    describe('calibrate', () => {
        beforeEach(async () => {
            await control.open(1);
        });

        it('should calibrate TX only', async () => {
            await control.calibrate('tx');
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalledWith(
                1,
                expect.objectContaining({
                    req_method: 'sdr_calibrate',
                    req_params: expect.objectContaining({ param: 10 }),
                })
            );
        });

        it('should calibrate RX only', async () => {
            await control.calibrate('rx');
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalledWith(
                1,
                expect.objectContaining({
                    req_method: 'sdr_calibrate',
                    req_params: expect.objectContaining({ param: 5 }),
                })
            );
        });

        it('should calibrate both TX and RX', async () => {
            await control.calibrate('trx');
            expect(mockWebUsbManager.sendCommand).toHaveBeenCalledWith(
                1,
                expect.objectContaining({
                    req_method: 'sdr_calibrate',
                    req_params: expect.objectContaining({ param: 15 }),
                })
            );
        });
    });

    describe('getStreamStatus', () => {
        it('should return INVALID when not open', async () => {
            const status = await control.getStreamStatus();
            expect(status).toBe('INVALID');
        });

        it('should return stream status when open', async () => {
            await control.open(1);
            mockWebUsbManager.getStreamStatus.mockResolvedValue('STARTED');
            const status = await control.getStreamStatus();
            expect(status).toBe('STARTED');
        });
    });
});