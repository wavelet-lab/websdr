import { describe, expect, it } from 'vitest';
import { DataType } from '@websdr/core/common';
import { WebUsbDeviceControlBase } from '@/webusb/webUsbDeviceControlBase';
import type { RequestKeys } from '@/webusb/controlWebUsb';
import type { DeviceParameterKey } from '@/webusb/webUsbDeviceControlBase';
import { DeviceStreamType, WebUsbDirection } from '@/webusb/deviceParameters';
import type { DeviceConfiguration } from '@/webusb/deviceParameters';

const makeConfiguration = (operationModes: WebUsbDirection): DeviceConfiguration => ({
    operationModes,
    defaultSamplesCount: 1024,
    rxFrequencyRange: { min: 100, max: 200 },
    txFrequencyRange: { min: 300, max: 400 },
    bandwidthRange: { min: 10, max: 20 },
    rateRange: { min: 1000, max: 2000 },
    streamTypes: { [DeviceStreamType.raw]: { dataTypes: [DataType.ci16] } },
    txRxDelay: 0,
    warmupPackets: 0,
});

describe('WebUsbDeviceControlBase', () => {
    it('validates RX parameters against device ranges', () => {
        const params = new WebUsbDeviceControlBase({}, makeConfiguration(WebUsbDirection.RX));

        params.setRxFrequency(150);
        params.setRxBandwidth(15);
        params.rate = 1500;

        expect(params.rx.frequency).toBe(150);
        expect(params.rx.bandwidth).toBe(15);
        expect(params.rate).toBe(1500);
        expect(params.state.rx).toEqual({ frequency: 150, bandwidth: 15, gain: 15 });
        expect(() => params.setRxFrequency(250)).toThrow(/RX frequency/);
    });

    it('rejects TX parameters for RX-only devices', () => {
        const params = new WebUsbDeviceControlBase({}, makeConfiguration(WebUsbDirection.RX));

        expect(params.getSupportedStreamingMode(WebUsbDirection.RX_TX)).toBe(WebUsbDirection.RX);
        expect(() => params.setTxFrequency(350)).toThrow(/not supported/);
        expect(() => params.ensureDirection(WebUsbDirection.TX, 'TX data')).toThrow(/not supported/);
    });

    it('validates only directions used for streaming', () => {
        const params = new WebUsbDeviceControlBase({
            rate: 1500,
            rx: {
                frequency: 150,
                bandwidth: 15,
            },
            tx: {
                frequency: 0,
                bandwidth: 0,
            },
        }, makeConfiguration(WebUsbDirection.RX));

        expect(() => params.validateForStreaming(WebUsbDirection.RX)).not.toThrow();
    });

    it('accepts nested direction initial params', () => {
        const params = new WebUsbDeviceControlBase({
            rx: {
                frequency: 150,
                bandwidth: 15,
                gain: 7,
            },
        }, makeConfiguration(WebUsbDirection.RX));

        expect(params.state.rx).toEqual({ frequency: 150, bandwidth: 15, gain: 7 });
    });

    it('calls change hook after successful parameter updates', () => {
        class HookedConfigurator extends WebUsbDeviceControlBase {
            changes: Array<{ parameter: DeviceParameterKey; value: number }> = [];

            protected onParameterChanged(parameter: DeviceParameterKey, value: number) {
                this.changes.push({ parameter, value });
            }
        }

        const params = new HookedConfigurator({}, makeConfiguration(WebUsbDirection.RX_TX));

        params.setRxFrequency(150);
        params.setTxGain(4);

        expect(params.changes).toEqual([
            { parameter: 'rx.frequency', value: 150 },
            { parameter: 'tx.gain', value: 4 },
        ]);
    });

    it('syncs changed device parameters through the control layer when open', () => {
        class ControlBackedConfigurator extends WebUsbDeviceControlBase {
            parameters: Array<{ parameter: RequestKeys; args: Record<string, number>; now: boolean }> = [];

            protected isControlOpen() {
                return true;
            }

            protected async setControlParameter(
                parameter: RequestKeys,
                args: (() => Record<string, any>) | Record<string, any>,
                now = false,
            ) {
                this.parameters.push({
                    parameter,
                    args: (typeof args === 'function' ? args() : args) as Record<string, number>,
                    now,
                });
            }
        }

        const params = new ControlBackedConfigurator({}, makeConfiguration(WebUsbDirection.RX_TX));

        params.setRxFrequency(150);
        params.setTxBandwidth(15);
        params.rate = 1500;

        expect(params.parameters).toEqual([
            { parameter: 'SET_RX_FREQUENCY', args: { frequency: 150 }, now: true },
            { parameter: 'SET_TX_BANDWIDTH', args: { frequency: 15 }, now: true },
        ]);
    });

    it('starts and stops device streaming through the control layer', async () => {
        class StreamingConfigurator extends WebUsbDeviceControlBase {
            commands: Array<{ command: RequestKeys; args: Record<string, any> }> = [];
            parameters: Array<{ parameter: RequestKeys; args: Record<string, number>; now: boolean }> = [];

            async prepare() {
                return this.prepareDeviceStreaming();
            }

            async start() {
                return this.startDeviceStreaming();
            }

            async startPrepared() {
                await this.startPreparedDeviceStreaming();
            }

            async stop() {
                await this.stopDeviceStreaming();
            }

            protected async sendControlCommand(command: RequestKeys, args = {}) {
                this.commands.push({ command, args });
                return {};
            }

            protected async getDeviceRxSamplesCount(samples: number): Promise<number> {
                return samples * 2;
            }

            protected async setControlParameter(
                parameter: RequestKeys,
                args: (() => Record<string, any>) | Record<string, any>,
                now = false,
            ) {
                this.parameters.push({
                    parameter,
                    args: (typeof args === 'function' ? args() : args) as Record<string, number>,
                    now,
                });
            }
        }

        const params = new StreamingConfigurator({
            rate: 1500,
            throttleon: 10,
            rx: { frequency: 150, bandwidth: 15, gain: 3 },
            tx: { frequency: 350, bandwidth: 16, gain: 4 },
        }, makeConfiguration(WebUsbDirection.RX_TX));

        await expect(params.prepare()).resolves.toEqual({
            mode: WebUsbDirection.RX_TX,
            packetSize: 2048,
        });
        await params.startPrepared();
        await params.stop();

        expect(params.commands).toEqual([
            {
                command: 'START_STREAMING',
                args: {
                    samplerate: 1500,
                    packetsize: 2048,
                    throttleon: 10,
                    param: 31,
                    mode: WebUsbDirection.RX_TX,
                },
            },
            { command: 'CONTROL_STREAMING', args: { samplerate: 0, throttleon: 0, param: 0 } },
            { command: 'STOP_STREAMING', args: {} },
        ]);
        expect(params.parameters).toEqual([
            { parameter: 'SET_RX_FREQUENCY', args: { frequency: 150 }, now: true },
            { parameter: 'SET_RX_BANDWIDTH', args: { frequency: 15 }, now: true },
            { parameter: 'SET_RX_GAIN', args: { gain: 3 }, now: true },
            { parameter: 'SET_TX_FREQUENCY', args: { frequency: 350 }, now: true },
            { parameter: 'SET_TX_BANDWIDTH', args: { frequency: 16 }, now: true },
            { parameter: 'SET_TX_GAIN', args: { gain: 4 }, now: true },
        ]);
    });

    it('starts device streaming immediately when using start helper', async () => {
        class StreamingConfigurator extends WebUsbDeviceControlBase {
            commands: Array<{ command: RequestKeys; args: Record<string, any> }> = [];

            async start() {
                return this.startDeviceStreaming();
            }

            protected async sendControlCommand(command: RequestKeys, args = {}) {
                this.commands.push({ command, args });
                return {};
            }

            protected async getDeviceRxSamplesCount(samples: number): Promise<number> {
                return samples * 2;
            }

            protected async setControlParameter() {
            }
        }

        const params = new StreamingConfigurator({
            rate: 1500,
            throttleon: 10,
            rx: { frequency: 150, bandwidth: 15 },
            tx: { frequency: 350, bandwidth: 16 },
        }, makeConfiguration(WebUsbDirection.RX_TX));

        await expect(params.start()).resolves.toEqual({
            mode: WebUsbDirection.RX_TX,
            packetSize: 2048,
        });

        expect(params.commands).toEqual([
            {
                command: 'START_STREAMING',
                args: {
                    samplerate: 1500,
                    packetsize: 2048,
                    throttleon: 10,
                    param: 23,
                    mode: WebUsbDirection.RX_TX,
                },
            },
        ]);
    });
});
