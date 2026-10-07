export function escapeCssIdentifier(value: string): string {
    if (
        typeof globalThis.CSS !== "undefined" &&
        typeof globalThis.CSS.escape === "function"
    ) return globalThis.CSS.escape(value);

    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

export function escapeHtml(value: string | null | undefined): string {
    return (value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}
