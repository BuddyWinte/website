import type {
    Dec,
    DecInfo,
    OpenRec
} from "./types.ts";

export const MOD_CLS = "modal";
export const OVR_CLS = "modal-overlay";
const NB_STACK_ID = "non-blocking-modal-stack";
export const RM_BAD_CLS = "readerModeIncompatible";
export const WIN_FRAME_SFX = "-window-frame";
export const WIN_STATE_ID_PREF = "modal-window-";

const initsRan = new WeakSet<() => void>();

let escOn = false;
const openZ: string[] = [];
export const openByKey = new Map<string, OpenRec>();

/**
 * hooks the global escape handler once.
 * pretty plain, just closes the top one that says escape is fine.
 *
 * @returns {void}
 */
export function ensEsc(): void {
    if (escOn) return;
    escOn = true;

    document.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        if (ev.defaultPrevented) return;

        for (let i = openZ.length - 1; i >= 0; i -= 1) {
            const key = openZ[i];
            const rec = openByKey.get(key);
            if (!rec) continue;
            if (!rec.closeOnEscape) continue;

            rec.close();
            return;
        }
    });
}

/**
 * makes sure a css file is around.
 * does a couple of checks first so it doesnt spam duplicate links everywhere.
 *
 * @param {string} href
 * @returns {void}
 */
function ensCss(href: string): void {
    const sheets = Array.from(document.styleSheets);

    for (const sheet of sheets) {
        if (!sheet.href) continue;
        if (sheet.href.endsWith(href)) return;
    }

    const links = Array.from(
        document.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']")
    );

    for (const link of links) {
        if (link.getAttribute("href") === href) return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
}

/**
 * gets the host for non-blocking modals.
 * creates it if needed.
 *
 * @returns {HTMLDivElement}
 */
export function ensNbHost(): HTMLDivElement {
    const ex = document.getElementById(NB_STACK_ID);
    if (ex instanceof HTMLDivElement) return ex;

    const host = document.createElement("div");
    host.id = NB_STACK_ID;
    document.body.appendChild(host);
    return host;
}

/**
 * body no-scroll toggler.
 * if any blocking modal is open, body gets locked. otherwise not.
 *
 * @returns {void}
 */
export function syncScrl(): void {
    for (const rec of openByKey.values()) {
        if (rec.mode !== "blocking") continue;

        document.body.classList.add("no-scroll");
        return;
    }

    document.body.classList.remove("no-scroll");
}

/**
 * pushes one open modal to the top and redoes z values.
 *
 * @param {string} key
 * @returns {void}
 */
export function zTop(key: string): void {
    if (!key) return;

    const idx = openZ.indexOf(key);
    if (idx >= 0) openZ.splice(idx, 1);
    openZ.push(key);

    const base = 10000;

    for (let i = 0; i < openZ.length; i += 1) {
        const zKey = openZ[i];
        const rec = openByKey.get(zKey);
        if (!rec) continue;

        const oZ = base + i * 2;
        const mZ = base + i * 2 + 1;

        if (rec.overlayEl) rec.overlayEl.style.zIndex = String(oZ);
        rec.stackEl.style.zIndex = String(mZ);
    }
}

/**
 * removes a key from the z order and re-stacks whats left.
 *
 * @param {string} key
 * @returns {void}
 */
export function zRm(key: string): void {
    const idx = openZ.indexOf(key);
    if (idx < 0) return;

    openZ.splice(idx, 1);

    const top = openZ[openZ.length - 1] ?? "";
    if (!top) return;

    zTop(top);
}

/**
 * id maker.
 * uses the preferred one if you gave it one, otherwise cobbles one together.
 *
 * @param {string | undefined} pref
 * @returns {string}
 */
export function mkId(pref: string | undefined): string {
    const raw = (pref ?? "").trim();
    if (raw) return raw;

    if (
        typeof globalThis.crypto !== "undefined" &&
        typeof globalThis.crypto.randomUUID === "function"
    ) {
        return `modal-${globalThis.crypto.randomUUID()}`;
    }

    const rand = Math.random().toString(16).slice(2);
    return `modal-${Date.now()}-${rand}`;
}

/**
 * runs decorator init hooks once each.
 * also makes sure decorator css is loaded.
 *
 * @param {readonly Dec[]} decs
 * @returns {void}
 */
export function runInit(decs: readonly Dec[]): void {
    for (const dec of decs) {
        if (dec.cssHref) ensCss(dec.cssHref);

        const init = dec.init;
        if (!init) continue;
        if (initsRan.has(init)) continue;

        initsRan.add(init);
        init();
    }
}

/**
 * lets decorators patch the html in order.
 * one after another, nothing clever.
 *
 * @param {string} html
 * @param {readonly Dec[]} decs
 * @param {DecInfo} info
 * @returns {string}
 */
export function patchHtml(
    html: string,
    decs: readonly Dec[],
    info: DecInfo
): string {
    let out = html;

    for (const dec of decs) {
        if (!dec.patchHtml) continue;
        out = dec.patchHtml(out, info);
    }

    return out;
}

/**
 * px parser. not exactly thrilling.
 *
 * @param {string} value
 * @returns {number}
 */
export function px(value: string): number {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * horizontal box extras from computed style.
 *
 * @param {CSSStyleDeclaration | null} cs
 * @returns {number}
 */
export function bx(cs: CSSStyleDeclaration | null): number {
    if (!cs) return 0;
    return px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
}

/**
 * vertical box extras from computed style.
 *
 * @param {CSSStyleDeclaration | null} cs
 * @returns {number}
 */
export function by(cs: CSSStyleDeclaration | null): number {
    if (!cs) return 0;
    return px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
}

/**
 * outer-ish height helper, margins included.
 *
 * @param {Element | null} el
 * @returns {number}
 */
export function oh(el: Element | null): number {
    if (!(el instanceof HTMLElement)) return 0;

    const cs = globalThis.getComputedStyle(el);
    return Math.ceil(el.getBoundingClientRect().height + px(cs.marginTop) + px(cs.marginBottom));
}

/**
 * turns an id into a window title that doesnt look awful.
 * good enough for modal headings anyway.
 *
 * @param {string} id
 * @returns {string}
 */
export function winTitle(id: string): string {
    const parts = id
        .trim()
        .replace(/[_-]+/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    if (!parts.length) return "Modal";

    return parts
        .map((part) => {
            const lower = part.toLowerCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ");
}

