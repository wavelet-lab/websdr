import { toBoolean } from "@websdr/core/utils";
import { getEnvValue } from "./env";

declare global {
    var debug_mode: boolean | undefined;
}

type DebugEnv = {
    VITE_DEBUG?: string;
    DEBUG?: string;
    MODE?: string;
    NODE_ENV?: string;
};

type DebugOptions = {
    debug?: boolean;
};

function parseBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;

    return toBoolean(value);
}

function readDebugMode(): boolean {
    if (typeof globalThis.debug_mode === 'boolean') {
        return globalThis.debug_mode;
    }

    return parseBoolean(getEnvValue<DebugEnv>(["VITE_DEBUG", "DEBUG"]))
        ?? false;
}

function readMode(): string | undefined {
    const mode = getEnvValue<DebugEnv>(["MODE", "NODE_ENV"]);
    return mode === undefined ? undefined : String(mode);
}

export let debug_mode = readDebugMode();

if (typeof globalThis.debug_mode !== 'boolean') {
    globalThis.debug_mode = debug_mode;
}

export function setDebugMode(value: boolean) {
    debug_mode = value;
    globalThis.debug_mode = value;
}

export function configureDebug(options: DebugOptions) {
    if (typeof options.debug === 'boolean') {
        setDebugMode(options.debug);
    }
}

export function isDebugMode(): boolean {
    return globalThis.debug_mode ?? debug_mode;
}

function shouldThrowAssertions(): boolean {
    return readMode() === 'test' || isDebugMode();
}

export function assert(value: any, ...rest: any[]): asserts value {
    console.assert(value, ...rest)
    if (shouldThrowAssertions() && !value) {
        const [msg, ..._] = rest
        throw new Error(msg ? 'Assertion failed: ' + msg : 'Assertion failed')
    }
}
