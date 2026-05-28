export type EnvValue = string | boolean | number | undefined;
export type EnvRecord = Record<string, EnvValue>;
export type EnvSource = "process" | "importMeta";

export function getImportMetaEnv<TEnv extends EnvRecord = EnvRecord>(): TEnv | undefined {
    return (import.meta as ImportMeta & { env?: TEnv }).env;
}

export function getProcessEnv<TEnv extends EnvRecord = EnvRecord>(): TEnv | undefined {
    const proc = (globalThis as typeof globalThis & { process?: { env?: TEnv } }).process;
    return proc?.env;
}

export function getEnv<TEnv extends EnvRecord = EnvRecord>(
    sources: EnvSource[] = ["process", "importMeta"],
): TEnv | undefined {
    for (const source of sources) {
        const env = source === "process" ? getProcessEnv<TEnv>() : getImportMetaEnv<TEnv>();
        if (env) return env;
    }

    return undefined;
}

export function getEnvValue<TEnv extends EnvRecord = EnvRecord>(
    keys: (keyof TEnv & string)[],
    sources: EnvSource[] = ["process", "importMeta"],
): EnvValue {
    for (const source of sources) {
        const env = source === "process" ? getProcessEnv<TEnv>() : getImportMetaEnv<TEnv>();
        if (!env) continue;

        for (const key of keys) {
            const value = env[key];
            if (value !== undefined && value !== "") return value;
        }
    }

    return undefined;
}
