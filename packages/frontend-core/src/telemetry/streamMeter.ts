export interface StreamMeterState {
    is_up: boolean;
    cloud_is_up: boolean;
    downloaded: number;
    processed: number;
    overrun: number;
    wr_ahead_avg: number;
    lastSend: number;
    uploaded: number;
    dropped: number;
    skipped: number;
    realigned: number;
    errors: number;
}

export type StreamMeterListener = (state: Readonly<StreamMeterState>, meter: StreamMeter) => void;

const StreamMeterInitialState: StreamMeterState = {
    is_up: false,
    cloud_is_up: false,
    downloaded: 0,
    processed: 0,
    overrun: 0,
    wr_ahead_avg: 0,
    lastSend: 0,
    uploaded: 0,
    dropped: 0,
    skipped: 0,
    realigned: 0,
    errors: 0,
};

export class StreamMeter {
    //config
    config: StreamMeterConfig = { ...StreamMeterInitialConfig };
    notifyIntervalMs: number;

    private _state: StreamMeterState = { ...StreamMeterInitialState };
    private _listeners: Set<StreamMeterListener> = new Set();
    private _notifyTimer: ReturnType<typeof setTimeout> | undefined = undefined;
    private _dirty = false;

    constructor(params: StreamMeterParams = {}) {
        this.notifyIntervalMs = params.notifyIntervalMs ?? 100;
        this.configure(params.config);
    }

    configure(config?: StreamMeterConfig) {
        this.config.show_cloud_link = (config && config.show_cloud_link) ?? StreamMeterInitialConfig.show_cloud_link;
    }

    subscribe(listener: StreamMeterListener, emitCurrent = true) {
        this._listeners.add(listener);
        if (emitCurrent) listener(this.snapshot(), this);
        return () => this.unsubscribe(listener);
    }

    unsubscribe(listener: StreamMeterListener) {
        this._listeners.delete(listener);
    }

    snapshot(): StreamMeterState {
        return { ...this._state };
    }

    update(patch: Partial<StreamMeterState>) {
        let changed = false;
        const nextState: StreamMeterState = { ...this._state };
        for (const key of Object.keys(patch) as Array<keyof StreamMeterState>) {
            const value = patch[key];
            if (value !== undefined && nextState[key] !== value) {
                (nextState as Record<keyof StreamMeterState, boolean | number>)[key] = value;
                changed = true;
            }
        }
        if (!changed) return;
        this._state = nextState;
        this.scheduleNotify();
    }

    flush() {
        if (this._notifyTimer !== undefined) {
            clearTimeout(this._notifyTimer);
            this._notifyTimer = undefined;
        }
        this.notify();
    }

    reset() {
        this.update(StreamMeterInitialState);
    }

    up() {
        this.is_up = true;
    }

    down() {
        this.is_up = false;
    }

    cloud_up() {
        this.cloud_is_up = true;
    }

    cloud_down() {
        this.cloud_is_up = false;
    }

    resetDownload() {
        this.update({ downloaded: 0, processed: 0, overrun: 0 });
    }

    resetUpload() {
        this.update({ uploaded: 0, dropped: 0, skipped: 0, realigned: 0, errors: 0 });
    }

    resetErrors() {
        this.update({ dropped: 0, skipped: 0, overrun: 0, realigned: 0, errors: 0 });
    }

    get is_up() {
        return this._state.is_up;
    }
    set is_up(value: boolean) {
        this.setStateValue("is_up", value);
    }

    get cloud_is_up() {
        return this._state.cloud_is_up;
    }
    set cloud_is_up(value: boolean) {
        this.setStateValue("cloud_is_up", value);
    }

    get downloaded() {
        return this._state.downloaded;
    }
    set downloaded(value: number) {
        this.setStateValue("downloaded", value);
    }

    get processed() {
        return this._state.processed;
    }
    set processed(value: number) {
        this.setStateValue("processed", value);
    }

    get overrun() {
        return this._state.overrun;
    }
    set overrun(value: number) {
        this.setStateValue("overrun", value);
    }

    get wr_ahead_avg() {
        return this._state.wr_ahead_avg;
    }
    set wr_ahead_avg(value: number) {
        this.setStateValue("wr_ahead_avg", value);
    }

    get lastSend() {
        return this._state.lastSend;
    }
    set lastSend(value: number) {
        this.setStateValue("lastSend", value);
    }

    get uploaded() {
        return this._state.uploaded;
    }
    set uploaded(value: number) {
        this.setStateValue("uploaded", value);
    }

    get dropped() {
        return this._state.dropped;
    }
    set dropped(value: number) {
        this.setStateValue("dropped", value);
    }

    get skipped() {
        return this._state.skipped;
    }
    set skipped(value: number) {
        this.setStateValue("skipped", value);
    }

    get realigned() {
        return this._state.realigned;
    }
    set realigned(value: number) {
        this.setStateValue("realigned", value);
    }

    get errors() {
        return this._state.errors;
    }
    set errors(value: number) {
        this.setStateValue("errors", value);
    }

    private setStateValue<K extends keyof StreamMeterState>(key: K, value: StreamMeterState[K]) {
        if (this._state[key] === value) return;
        this._state[key] = value;
        this.scheduleNotify();
    }

    private scheduleNotify() {
        if (this._listeners.size === 0) return;

        this._dirty = true;
        if (this._notifyTimer !== undefined) return;
        this._notifyTimer = setTimeout(() => {
            this._notifyTimer = undefined;
            this.notify();
        }, this.notifyIntervalMs);
    }

    private notify() {
        if (!this._dirty) return;
        this._dirty = false;
        const state = this.snapshot();
        this._listeners.forEach(listener => listener(state, this));
    }
}

export interface StreamMeterParams {
    config?: StreamMeterConfig;
    notifyIntervalMs?: number;
}

export interface StreamMeterConfig {
    show_cloud_link?: boolean;
}

const StreamMeterInitialConfig: StreamMeterConfig = {
    show_cloud_link: false,
}
