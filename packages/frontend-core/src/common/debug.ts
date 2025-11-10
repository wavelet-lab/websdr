declare global {
    var debug_mode: boolean;

    interface ImportMeta {
        readonly env?: ImportMetaEnv;
    }
}

interface ImportMetaEnv {
    readonly VITE_DEBUG?: string;
}

// compute once and assign
const _debug_mode = ((import.meta.env?.VITE_DEBUG) ?? (typeof process !== 'undefined' ? process.env?.VITE_DEBUG : undefined)) === 'true';

// only set if not already set to avoid overwriting other code during tests
if (typeof globalThis.debug_mode !== 'boolean') {
    globalThis.debug_mode = _debug_mode;
} else {
    // keep existing value (no-op)
}
export const debug_mode = globalThis.debug_mode;
