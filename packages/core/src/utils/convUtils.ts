export function toBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        return Boolean(value);
    }

    if (typeof value !== "string") {
        return false;
    }

    switch (value.toLowerCase().trim()) {
        case "true":
        case "yes":
        case "1":
        case "on":
            return true;

        case "false":
        case "no":
        case "0":
        case "off":
        case "":
        case "null":
        case "undefined":
            return false;
    }

    return false;
}

export const stringToBoolean = toBoolean;
