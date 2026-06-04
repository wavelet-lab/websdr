import { getEnvValue } from "@/common/env";

// Minimal API helper for the frontend
// Use VITE_API_URL/API_URL for an absolute API base, or rely on the dev proxy (/api)

let apiBase: string | undefined = undefined;

type ApiEnv = {
    VITE_API_URL?: string;
    API_URL?: string;
};

/**
 * Set the API base URL dynamically (call from your app initialization).
 * Example: setApiBase('http://localhost:3000')
 */
export function setApiBase(base?: string) {
    apiBase = base;
}

/** Determine the API base URL by checking multiple locations (manual -> global -> env for SSR). */
function getEnvApiBase(): string | undefined {
    const g = globalThis as { __API_BASE__?: unknown };

    // 1) Explicit global variable (can be set from index.html)
    if (typeof g.__API_BASE__ === 'string' && g.__API_BASE__) {
        return g.__API_BASE__;
    }

    // 2) process.env (SSR / Node), then import.meta.env (Vite / bundler builds).
    const envApiBase = getEnvValue<ApiEnv>(["VITE_API_URL", "API_URL"]);
    return envApiBase === undefined ? undefined : String(envApiBase);
}

/** Return the current API base URL (manual -> env -> fallback '/'). */
export function getApiBase(): string {
    const base = apiBase ?? getEnvApiBase();
    return base ? String(base) : '/';
}

export function apiUrl(path = ''): string {
    const base = getApiBase();
    // If base looks like a relative path ("/api"), ensure the leading slash and normalize slashes
    if (base.startsWith('/')) {
        return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    }
    return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function apiWsUrl(path = '', port?: number): string {
    const httpUrl = apiUrl(path);
    const baseUrl = typeof globalThis.location === 'object'
        ? globalThis.location.href
        : undefined;

    if (!baseUrl && httpUrl.startsWith('/')) {
        throw new Error('Cannot build a WebSocket API URL from a relative API base without globalThis.location');
    }

    const url = new URL(httpUrl, baseUrl);

    if (url.protocol === 'https:') {
        url.protocol = 'wss:';
    } else if (url.protocol === 'http:') {
        url.protocol = 'ws:';
    }

    if (port !== undefined) {
        url.port = String(port);
    }

    return url.toString();
}

export async function apiFetch<T = any>(path: string, init?: RequestInit): Promise<T> {
    const url = apiUrl(path);
    const res = await fetch(url, { ...init, credentials: 'include' });

    const contentType = res?.headers?.get("content-type");

    if (!res.ok) {
        // try to provide better error messages
        let errorBody: any;
        if (contentType?.includes("application/json")) {
            errorBody = await res.json();
            throw new Error(`API error ${res.status}`, { cause: errorBody });
        } else {
            errorBody = await res.text();
            throw new Error(`API error ${res.status}: ${errorBody}`);
        }
    }

    if (contentType?.includes("application/json")) {
        return (await res.json()) as unknown as T;
    }

    // Fallback: return raw text (useful for plain responses)
    return (await res.text()) as unknown as T;
}

export default {
    setApiBase,
    getApiBase,
    apiUrl,
    apiWsUrl,
    apiFetch,
};
