function normaliseCssContent(raw: string): string {
    if (!raw || raw === "none" || raw === "normal") return "";

    const quote = raw[0];
    const hasQuotes =
        (quote === "\"" || quote === "'") &&
        raw[raw.length - 1] === quote;

    const content = hasQuotes ? raw.slice(1, -1) : raw;

    return content
        .replaceAll("\\A", "\n")
        .replaceAll("\\a", "\n")
        .replaceAll("\\00000A", "\n")
        .replaceAll("\\00000a", "\n")
        .replaceAll('\\"', '"')
        .replaceAll("\\'", "'")
        .replaceAll("\\\\", "\\");
}

function readBadgeText(): string {
    const preEl = document.querySelector(".kc-badge-snippet__code");
    if (!(preEl instanceof HTMLElement)) return "";

    const raw = window.getComputedStyle(preEl, "::before").content;
    const generated = normaliseCssContent(raw).trim();
    if (generated) return generated;

    return (preEl.textContent ?? "").trim();
}

async function copyText(text: string): Promise<boolean> {
    if (!text) return false;

    const clipboard = navigator.clipboard;

    if (clipboard && typeof clipboard.writeText === "function") {
        try {
            await clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to the legacy copy path.
        }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";

    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
}

export function initBadgeCopy(): void {
    const button = document.querySelector(".kc-badge-snippet__copy");
    if (!(button instanceof HTMLButtonElement)) return;

    button.addEventListener("click", () => {
        void copyText(readBadgeText());
    });
}
