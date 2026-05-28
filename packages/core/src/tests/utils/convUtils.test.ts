import { describe, it, expect } from "vitest";
import { stringToBoolean, toBoolean } from "@/utils/convUtils";

describe("toBoolean", () => {
    it("returns true for truthy textual values (case-insensitive, trimmed)", () => {
        expect(toBoolean("true")).toBe(true);
        expect(toBoolean(" TrUe  ")).toBe(true);
        expect(toBoolean("yes")).toBe(true);
        expect(toBoolean("  YES")).toBe(true);
        expect(toBoolean("1")).toBe(true);
        expect(toBoolean("on")).toBe(true);
    });

    it("returns false for explicit falsey textual values", () => {
        expect(toBoolean("false")).toBe(false);
        expect(toBoolean("No")).toBe(false);
        expect(toBoolean("0")).toBe(false);
        expect(toBoolean("off")).toBe(false);
        expect(toBoolean("")).toBe(false);
    });

    it("returns false for null-like values", () => {
        expect(toBoolean("null")).toBe(false);
        expect(toBoolean("undefined")).toBe(false);
        expect(toBoolean(null)).toBe(false);
        expect(toBoolean(undefined)).toBe(false);
    });

    it("passes boolean values through", () => {
        expect(toBoolean(true)).toBe(true);
        expect(toBoolean(false)).toBe(false);
    });

    it("converts number values using JavaScript boolean semantics", () => {
        expect(toBoolean(1)).toBe(true);
        expect(toBoolean(-1)).toBe(true);
        expect(toBoolean(0)).toBe(false);
        expect(toBoolean(NaN)).toBe(false);
    });

    it("returns false for unsupported values", () => {
        expect(toBoolean({ value: "true" })).toBe(false);
    });

    it("returns false for unknown strings", () => {
        expect(toBoolean("not a json")).toBe(false);
        expect(toBoolean('asd')).toBe(false);
    });

    it("keeps stringToBoolean as a backwards-compatible alias", () => {
        expect(stringToBoolean).toBe(toBoolean);
        expect(stringToBoolean("true")).toBe(true);
    });
});
