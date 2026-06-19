import { apiUrl, apiFetch } from "./api";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function login(credentials?: { username: string; password: string }) {
    try {
        if (credentials) {
            await apiFetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...credentials })
            });
        } else {
            await apiFetch("/api/auth/guest", { method: "POST" });
        }
    } catch (error) {
        throw new Error(`Login failed: ${getErrorMessage(error)}`, { cause: error });
    }
}

export async function logout() {
    // Use sendBeacon for logout to ensure the request is sent even if the page is being unloaded
    try {
        navigator.sendBeacon(apiUrl('/api/auth/logout'));
    } catch {
        try {
            apiFetch("/api/auth/logout", { method: "POST", keepalive: true });
        } catch { /* ignore */ }
    }
}

export async function getProfile() {
    try {
        const { user } = await apiFetch<{ user: unknown }>("/api/auth/profile");
        return user;
    } catch (error) {
        throw new Error(`Failed to fetch profile: ${getErrorMessage(error)}`, { cause: error });
    }
}

export default {
    login,
    logout,
    getProfile,
};
