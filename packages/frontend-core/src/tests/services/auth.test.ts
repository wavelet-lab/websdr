import { describe, it, expect, vi, beforeEach } from "vitest";
import { login } from "@/services/auth";
import { apiFetch } from "@/services/api";

// Mock the @/services/api module used by auth.ts
vi.mock("@/services/api", () => ({
    apiFetch: vi.fn(),
    apiUrl: vi.fn((p: string) => p),
}));


describe("login", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("performs regular login with credentials", async () => {
        vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, status: 200 } as any);

        const credentials = { username: "user", password: "pass" };
        await expect(login(credentials)).resolves.toBeUndefined();

        expect(apiFetch).toHaveBeenCalledTimes(1);
        expect(apiFetch).toHaveBeenCalledWith("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials),
        });
    });

    it("performs guest login when no credentials are provided", async () => {
        vi.mocked(apiFetch).mockResolvedValueOnce({ ok: true, status: 200 } as any);

        await expect(login()).resolves.toBeUndefined();

        expect(apiFetch).toHaveBeenCalledTimes(1);
        expect(apiFetch).toHaveBeenCalledWith("/api/auth/guest", { method: "POST" });
    });

    it("throws an error when regular login fails", async () => {
        vi.mocked(apiFetch).mockResolvedValueOnce({ ok: false, status: 401 } as any);

        await expect(login({ username: "bad", password: "creds" })).rejects.toThrow(
            "Login failed: 401"
        );

        expect(apiFetch).toHaveBeenCalledWith("/api/auth/login", expect.any(Object));
    });

    it("throws an error when guest login fails", async () => {
        vi.mocked(apiFetch).mockResolvedValueOnce({ ok: false, status: 500 } as any);

        await expect(login()).rejects.toThrow("Login failed: 500");

        expect(apiFetch).toHaveBeenCalledWith("/api/auth/guest", { method: "POST" });
    });

    it("propagates network errors for regular login", async () => {
        const err = new Error("Network down");
        vi.mocked(apiFetch).mockRejectedValueOnce(err);

        await expect(login({ username: "user", password: "pass" })).rejects.toThrow("Network down");
        expect(apiFetch).toHaveBeenCalledWith("/api/auth/login", expect.any(Object));
    });

    it("propagates network errors for guest login", async () => {
        const err = new Error("Fetch failed");
        vi.mocked(apiFetch).mockRejectedValueOnce(err);

        await expect(login()).rejects.toThrow("Fetch failed");
        expect(apiFetch).toHaveBeenCalledWith("/api/auth/guest", { method: "POST" });
    });
})
// Tests for logout and getProfile
describe("logout", () => {
    let originalSendBeacon: any;

    beforeEach(() => {
        vi.clearAllMocks();
        originalSendBeacon = (navigator as any).sendBeacon;
    });

    afterEach(() => {
        // restore original sendBeacon
        Object.defineProperty(navigator, "sendBeacon", {
            value: originalSendBeacon,
            configurable: true,
            writable: true,
        });
    });

    it("uses navigator.sendBeacon when available", async () => {
        const sendBeaconMock = vi.fn().mockReturnValue(true);
        Object.defineProperty(navigator, "sendBeacon", {
            value: sendBeaconMock,
            configurable: true,
            writable: true,
        });

        const { logout } = await import("@/services/auth");
        await expect(logout()).resolves.toBeUndefined();

        expect(sendBeaconMock).toHaveBeenCalledTimes(1);
        expect(sendBeaconMock).toHaveBeenCalledWith("/api/auth/logout");
        expect(apiFetch).not.toHaveBeenCalled();
    });

    it("falls back to fetch when sendBeacon throws", async () => {
        Object.defineProperty(navigator, "sendBeacon", {
            value: vi.fn(() => {
                throw new Error("sendBeacon failed");
            }),
            configurable: true,
            writable: true,
        });

        const { logout } = await import("@/services/auth");
        await expect(logout()).resolves.toBeUndefined();

        expect(apiFetch).toHaveBeenCalledWith("/api/auth/logout", {
            method: "POST",
            keepalive: true,
        });
    });
});

describe("getProfile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the user when response is ok", async () => {
        const user = { id: "u1", name: "Alice" };
        vi.mocked(apiFetch).mockResolvedValueOnce({
            ok: true,
            status: 200,
            user,
        } as any);

        const { getProfile } = await import("@/services/auth");
        await expect(getProfile()).resolves.toEqual(user);

        expect(apiFetch).toHaveBeenCalledWith("/api/auth/profile");
    });

    it("throws an error when response is not ok", async () => {
        vi.mocked(apiFetch).mockResolvedValueOnce({
            ok: false,
            status: 403,
        } as any);

        const { getProfile } = await import("@/services/auth");
        await expect(getProfile()).rejects.toThrow("Failed to fetch profile: 403");

        expect(apiFetch).toHaveBeenCalledWith("/api/auth/profile");
    });

    it("propagates network errors", async () => {
        const err = new Error("Network issue");
        vi.mocked(apiFetch).mockRejectedValueOnce(err);

        const { getProfile } = await import("@/services/auth");
        await expect(getProfile()).rejects.toThrow("Network issue");
    });
});
