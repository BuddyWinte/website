export function toSafeIdPart(value: unknown): string {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
}

export function makeStableId(prefix: string, value: unknown): string {
    const part = toSafeIdPart(value);
    return part ? prefix + part : prefix + "x";
}
