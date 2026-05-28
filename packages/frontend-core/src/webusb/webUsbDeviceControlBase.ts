import { CHUNK_SIZE, DataType } from '@websdr/core/common';
import {
    buildWebUsbStreamingParam,
    ControlWebUsb,
    ControlWebUsbInitialParams,
    WebUsbStreamingSync,
    type ControlWebUsbParams,
    type RequestKeys,
} from './controlWebUsb';
import {
    DefaultDeviceConfiguration,
    WebUsbDirection,
} from './deviceParameters';
import { getWebUsbManagerInstance, WebUsbManager, WebUsbManagerMode } from './webUsbManager';
import type {
    RXBuffer,
    RXDecoderOptions,
    TXBuffer,
    TXEncoderOptions,
    TXResult,
} from './webUsbBase';
import type {
    DeviceConfiguration,
    DeviceParamRange,
} from './deviceParameters';

export interface DeviceDirectionParameterState {
    frequency: number;
    bandwidth: number;
    gain: number;
}

export interface DeviceParameterState {
    rate: number;
    packet_size: number;
    throttleon: number;
    rx: DeviceDirectionParameterState;
    tx: DeviceDirectionParameterState;
}

export type DeviceParameterInitialState = Partial<Omit<DeviceParameterState, 'rx' | 'tx'>> & {
    rx?: Partial<DeviceDirectionParameterState>;
    tx?: Partial<DeviceDirectionParameterState>;
};

export type WebUsbDeviceControlBaseParams = ControlWebUsbParams & DeviceParameterInitialState;

export const WebUsbDeviceControlBaseInitialParams: WebUsbDeviceControlBaseParams = {
    ...ControlWebUsbInitialParams,
    rate: 1e6,
    packet_size: CHUNK_SIZE,
    throttleon: 10e6,
    rx: {
        frequency: 1e9,
        bandwidth: 1e6,
        gain: 15,
    },
    tx: {
        frequency: 1e9,
        bandwidth: 1e6,
        gain: 15,
    },
};

export type DeviceParameterKey =
    | 'rate'
    | 'packet_size'
    | 'throttleon'
    | 'rx.frequency'
    | 'rx.bandwidth'
    | 'rx.gain'
    | 'tx.frequency'
    | 'tx.bandwidth'
    | 'tx.gain';

export interface DeviceStreamingStartResult {
    mode: WebUsbDirection;
    packetSize: number;
}

export interface DeviceStreamingStartOptions {
    requestedMode?: WebUsbDirection;
    start?: boolean;
    restart?: boolean;
    sync?: WebUsbStreamingSync;
}

export class WebUsbDeviceControlBase {
    protected _fd: number = -1;
    protected _type: DataType;
    protected _mode: WebUsbManagerMode;
    protected _webUsbManager: WebUsbManager | undefined;
    protected _configuration: DeviceConfiguration;
    protected _state: DeviceParameterState;
    protected _control: ControlWebUsb;

    constructor(
        params: WebUsbDeviceControlBaseParams = {},
        configuration: DeviceConfiguration = DefaultDeviceConfiguration,
    ) {
        this._configuration = configuration;
        this._type = params.type ?? WebUsbDeviceControlBaseInitialParams.type!;
        this._mode = params.mode ?? WebUsbDeviceControlBaseInitialParams.mode!;
        this._state = {
            rate: params.rate ?? WebUsbDeviceControlBaseInitialParams.rate!,
            packet_size: params.packet_size ?? configuration.defaultSamplesCount ?? WebUsbDeviceControlBaseInitialParams.packet_size!,
            throttleon: params.throttleon ?? WebUsbDeviceControlBaseInitialParams.throttleon!,
            rx: {
                frequency: params.rx?.frequency ?? WebUsbDeviceControlBaseInitialParams.rx!.frequency!,
                bandwidth: params.rx?.bandwidth ?? WebUsbDeviceControlBaseInitialParams.rx!.bandwidth!,
                gain: params.rx?.gain ?? WebUsbDeviceControlBaseInitialParams.rx!.gain!,
            },
            tx: {
                frequency: params.tx?.frequency ?? WebUsbDeviceControlBaseInitialParams.tx!.frequency!,
                bandwidth: params.tx?.bandwidth ?? WebUsbDeviceControlBaseInitialParams.tx!.bandwidth!,
                gain: params.tx?.gain ?? WebUsbDeviceControlBaseInitialParams.tx!.gain!,
            },
        };
        this._control = new ControlWebUsb({
            type: this._type,
            mode: this._mode,
        });
    }

    get configuration(): DeviceConfiguration {
        return this._configuration;
    }

    setConfiguration(configuration: DeviceConfiguration) {
        this._configuration = configuration;
        if (this._state.packet_size <= 0) {
            this._state.packet_size = configuration.defaultSamplesCount;
            this.onParameterChanged('packet_size', this._state.packet_size);
        }
    }

    get state(): DeviceParameterState {
        return {
            ...this._state,
            rx: { ...this._state.rx },
            tx: { ...this._state.tx },
        };
    }

    get rx(): DeviceDirectionParameterState {
        return { ...this._state.rx };
    }

    get tx(): DeviceDirectionParameterState {
        return { ...this._state.tx };
    }

    get rate() {
        return this._state.rate;
    }

    set rate(value: number) {
        this._state.rate = this.validateRange('Sample rate', value, this._configuration.rateRange);
        this.onParameterChanged('rate', this._state.rate);
    }

    get packet_size() {
        return this._state.packet_size;
    }

    set packet_size(value: number) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`Packet size must be a positive finite number, got ${value}`);
        }
        this._state.packet_size = value;
        this.onParameterChanged('packet_size', this._state.packet_size);
    }

    get throttleon() {
        return this._state.throttleon;
    }

    set throttleon(value: number) {
        this._state.throttleon = this.validateFinite('Throttle', value);
        this.onParameterChanged('throttleon', this._state.throttleon);
    }

    supportsDirection(direction: WebUsbDirection): boolean {
        return (this._configuration.operationModes & direction) === direction;
    }

    ensureDirection(direction: WebUsbDirection, parameterName: string) {
        if (!this.supportsDirection(direction)) {
            throw new Error(`${parameterName} is not supported by this SDR`);
        }
    }

    getSupportedStreamingMode(requestedMode: WebUsbDirection = WebUsbDirection.RX_TX): WebUsbDirection {
        const mode = requestedMode & this._configuration.operationModes;
        if (mode === 0) {
            throw new Error(`Requested streaming mode ${requestedMode} is not supported by this SDR`);
        }
        return mode;
    }

    setRxFrequency(frequency: number) {
        this.ensureDirection(WebUsbDirection.RX, 'RX frequency');
        this._state.rx.frequency = this.validateRange('RX frequency', frequency, this._configuration.rxFrequencyRange);
        this.onParameterChanged('rx.frequency', this._state.rx.frequency);
    }

    setTxFrequency(frequency: number) {
        this.ensureDirection(WebUsbDirection.TX, 'TX frequency');
        this._state.tx.frequency = this.validateRange('TX frequency', frequency, this._configuration.txFrequencyRange);
        this.onParameterChanged('tx.frequency', this._state.tx.frequency);
    }

    setRxBandwidth(bandwidth: number) {
        this.ensureDirection(WebUsbDirection.RX, 'RX bandwidth');
        this._state.rx.bandwidth = this.validateRange('RX bandwidth', bandwidth, this._configuration.bandwidthRange);
        this.onParameterChanged('rx.bandwidth', this._state.rx.bandwidth);
    }

    setTxBandwidth(bandwidth: number) {
        this.ensureDirection(WebUsbDirection.TX, 'TX bandwidth');
        this._state.tx.bandwidth = this.validateRange('TX bandwidth', bandwidth, this._configuration.bandwidthRange);
        this.onParameterChanged('tx.bandwidth', this._state.tx.bandwidth);
    }

    setRxGain(gain: number) {
        this.ensureDirection(WebUsbDirection.RX, 'RX gain');
        this._state.rx.gain = this.validateFinite('RX gain', gain);
        this.onParameterChanged('rx.gain', this._state.rx.gain);
    }

    setTxGain(gain: number) {
        this.ensureDirection(WebUsbDirection.TX, 'TX gain');
        this._state.tx.gain = this.validateFinite('TX gain', gain);
        this.onParameterChanged('tx.gain', this._state.tx.gain);
    }

    validateForStreaming(mode: WebUsbDirection) {
        if ((mode & WebUsbDirection.RX) !== 0) {
            this.validateRange('RX frequency', this._state.rx.frequency, this._configuration.rxFrequencyRange);
            this.validateRange('RX bandwidth', this._state.rx.bandwidth, this._configuration.bandwidthRange);
        }
        if ((mode & WebUsbDirection.TX) !== 0) {
            this.validateRange('TX frequency', this._state.tx.frequency, this._configuration.txFrequencyRange);
            this.validateRange('TX bandwidth', this._state.tx.bandwidth, this._configuration.bandwidthRange);
        }
        this.validateRange('Sample rate', this._state.rate, this._configuration.rateRange);
    }

    protected async prepareDeviceStreaming(
        options: DeviceStreamingStartOptions = {},
    ): Promise<DeviceStreamingStartResult> {
        const {
            requestedMode = WebUsbDirection.RX_TX,
            start = false,
            restart = true,
            sync = WebUsbStreamingSync.NONE,
        } = options;
        const streamingMode = this.getSupportedStreamingMode(requestedMode);
        this.validateForStreaming(streamingMode);
        const streamingPacketSize = await this.getDeviceRxSamplesCount(this.packet_size);
        await this.sendControlCommand('START_STREAMING', {
            samplerate: Math.floor(this.rate),
            packetsize: streamingPacketSize,
            throttleon: Math.floor(this.throttleon),
            param: buildWebUsbStreamingParam({
                sync,
                start,
                restart,
            }),
            mode: streamingMode,
        });

        if ((streamingMode & WebUsbDirection.RX) !== 0) {
            await this.setControlParameter('SET_RX_FREQUENCY', { frequency: Math.floor(this._state.rx.frequency) }, true);
            await this.setControlParameter('SET_RX_BANDWIDTH', { frequency: Math.floor(this._state.rx.bandwidth) }, true);
            await this.setControlParameter('SET_RX_GAIN', { gain: Math.floor(this._state.rx.gain) }, true);
        }
        if ((streamingMode & WebUsbDirection.TX) !== 0) {
            await this.setControlParameter('SET_TX_FREQUENCY', { frequency: Math.floor(this._state.tx.frequency) }, true);
            await this.setControlParameter('SET_TX_BANDWIDTH', { frequency: Math.floor(this._state.tx.bandwidth) }, true);
            await this.setControlParameter('SET_TX_GAIN', { gain: Math.floor(this._state.tx.gain) }, true);
        }

        return {
            mode: streamingMode,
            packetSize: streamingPacketSize,
        };
    }

    protected async startPreparedDeviceStreaming() {
        await this.sendControlCommand('CONTROL_STREAMING', { samplerate: 0, throttleon: 0, param: 0 });
    }

    protected schedulePreparedDeviceStreamingStart(delayMs = 0) {
        setTimeout(() => {
            void this.startPreparedDeviceStreaming().catch((err) => {
                console.error('WebUsbDeviceControlBase.startPreparedDeviceStreaming:', err);
            });
        }, delayMs);
    }

    protected async startDeviceStreaming(
        options: DeviceStreamingStartOptions = {},
    ): Promise<DeviceStreamingStartResult> {
        return await this.prepareDeviceStreaming({...options, start: true });
    }

    protected async stopDeviceStreaming() {
        await this.sendControlCommand('STOP_STREAMING');
    }

    protected async openDevice(fd: number) {
        if (this._fd !== fd) await this.closeDevice();
        this._fd = fd;
        await this.openControl(fd);
        try {
            this.setConfiguration(await this.getDeviceConfiguration());
        } catch {
            this.setConfiguration(DefaultDeviceConfiguration);
        }
    }

    protected async closeDevice() {
        await this.closeControl();
        if (this._fd >= 0) {
            await this.getWebUsbManager().close(this._fd);
        }
        this._fd = -1;
    }

    protected async getDeviceRxSamplesCount(samples: number): Promise<number> {
        return this.getWebUsbManager().getRXSamplesCount(this._fd, samples);
    }

    protected async submitDeviceRxPacket(samples: number, opts?: RXDecoderOptions): Promise<RXBuffer> {
        return this.getWebUsbManager().submitRxPacket(this._fd, samples, opts);
    }

    protected async sendDeviceTxPacket(data: TXBuffer, opts?: TXEncoderOptions): Promise<TXResult> {
        return this.getWebUsbManager().sendTxPacket(this._fd, data, opts);
    }

    protected get hasOpenDevice(): boolean {
        return this._fd >= 0;
    }

    protected get fd(): number {
        return this._fd;
    }

    private getWebUsbManager(): WebUsbManager {
        if (!this._webUsbManager && this._mode !== WebUsbManagerMode.UNKNOWN) {
            this._webUsbManager = getWebUsbManagerInstance(this._mode);
        }
        if (!this._webUsbManager) {
            throw new Error('WebUsbDeviceControlBase: WebUsbManager is not configured');
        }
        return this._webUsbManager;
    }

    private async getDeviceConfiguration(): Promise<DeviceConfiguration> {
        return this.getWebUsbManager().getConfiguration(this._fd);
    }

    protected validateRange(name: string, value: number, range: DeviceParamRange): number {
        this.validateFinite(name, value);
        if (value < range.min || value > range.max) {
            throw new Error(`${name} ${value} is out of supported range [${range.min}, ${range.max}]`);
        }
        return value;
    }

    protected validateFinite(name: string, value: number): number {
        if (!Number.isFinite(value)) {
            throw new Error(`${name} must be a finite number, got ${value}`);
        }
        return value;
    }

    protected async openControl(fd: number) {
        await this._control.open(fd);
    }

    protected async closeControl() {
        await this._control.close();
    }

    protected isControlOpen(): boolean {
        return this._control.isOpen();
    }

    protected async sendControlCommand(command: RequestKeys, args = {}, extArgs = {}) {
        return this._control.sendCommand(command, args, extArgs);
    }

    protected async setControlParameter(
        parameter: RequestKeys,
        args: (() => Record<string, any>) | Record<string, any>,
        now = false,
    ) {
        await this._control.setParameter(parameter, args, now);
    }

    protected onParameterChanged(parameter: DeviceParameterKey, value: number) {
        if (!this.isControlOpen()) return;
        switch (parameter) {
            case 'rx.frequency':
                void this.setControlParameter('SET_RX_FREQUENCY', { frequency: value }, true);
                break;
            case 'tx.frequency':
                void this.setControlParameter('SET_TX_FREQUENCY', { frequency: value }, true);
                break;
            case 'rx.bandwidth':
                void this.setControlParameter('SET_RX_BANDWIDTH', { frequency: value }, true);
                break;
            case 'tx.bandwidth':
                void this.setControlParameter('SET_TX_BANDWIDTH', { frequency: value }, true);
                break;
            case 'rx.gain':
                void this.setControlParameter('SET_RX_GAIN', { gain: value }, true);
                break;
            case 'tx.gain':
                void this.setControlParameter('SET_TX_GAIN', { gain: value }, true);
                break;
        }
    }
}
