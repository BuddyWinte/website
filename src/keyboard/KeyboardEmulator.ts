import { nextFrame } from "../helpers.js";
import {
    DESKTOP_PRESETS,
    SHIFT_MAP
} from "./constants.ts";
import { buildKeySequence } from "./sequences.ts";
import type {
    CssRes,
    DeskPreset,
    ModKey,
    Mods,
    SendCb,
    SendMsg
} from "./types.ts";

declare global {
    interface Window {
        term?: unknown;
    }
}

export class keyboardEmu {
    static MARKER_ID = "keyboard-emu-html-loaded";
    static CSS_LINK_ID = "keyboard-emu-css";
    static DEFAULT_Z_INDEX = 2147483647;
    static HIDDEN_Z = -1;
    static VIEWPORT_OVERLAP_PX = 1;

    static SHIFT_MAP = SHIFT_MAP;
    static DESKTOP_PRESETS = DESKTOP_PRESETS;


    /**
     * Resolves a path against this module when possible.
     * If URL blows up for some reason it just gives the input back.
     * @param {string} path
     * @returns {string}
     */
    static __url(path: string): string {
        try {
            return new URL(path, import.meta.url).toString();
        } catch {
            return path;
        }
    }

    isMobile: boolean;
    htmlUrl: string;
    cssUrl: string;

    opts: unknown;
    zIndex: number;

    bar: HTMLDivElement | null;
    cssLink: HTMLLinkElement | null;
    cssInjected: boolean;

    mods: Mods;
    send: SendCb | null;

    lastEditable: HTMLElement | null;
    toolbarVisible: boolean;
    skipNextRefocus: boolean;
    suppressNextClick: boolean;

    vv: VisualViewport | null;
    raf: number;
    ro: ResizeObserver | null;

    private __onFocusInBound: (e: FocusEvent) => void;
    private __onFocusOutBound: (e: FocusEvent) => void;
    private __onPointerDownCaptureBound: (e: PointerEvent) => void;
    private __onClickBound: (e: MouseEvent) => void;
    private __onBeforeInputCaptureBound: (e: Event) => void;
    private __onKeyDownCaptureBound: (e: KeyboardEvent) => void;
    private __scheduleBound: () => void;
    private __refocusEditableBound: () => void;
    private __onTouchMoveBound: (e: TouchEvent) => void;
    private __onDocClickCaptureBound: (e: MouseEvent) => void;
    private __onTransitionEndBound: (e: TransitionEvent) => void;

    /**
     * Builds the thing and binds all the boring handler refs.
     * @param {unknown} isMobile
     * @param {unknown} htmlUrl
     * @param {unknown} cssUrl
     * @returns {void}
     */
    constructor(isMobile?: unknown, htmlUrl?: unknown, cssUrl?: unknown) {
        this.isMobile = !!isMobile;

        this.htmlUrl = typeof htmlUrl === "string" && htmlUrl !== ""
            ? keyboardEmu.__url(htmlUrl)
            : keyboardEmu.__url("/ui/keyboard.html");

        this.cssUrl = typeof cssUrl === "string" && cssUrl !== ""
            ? keyboardEmu.__url(cssUrl)
            : keyboardEmu.__url("/styles/modules/keyboard.css");

        this.opts = null;
        this.zIndex = keyboardEmu.DEFAULT_Z_INDEX;

        this.bar = null;
        this.cssLink = null;
        this.cssInjected = false;

        this.mods = { ctrl: false, alt: false, meta: false, shift: false, fn: false };
        this.send = null;

        this.lastEditable = null;
        this.toolbarVisible = true;
        this.skipNextRefocus = false;
        this.suppressNextClick = false;

        this.vv = null;
        this.raf = 0;
        this.ro = null;

        this.__onFocusInBound = this.__onFocusIn.bind(this);
        this.__onFocusOutBound = this.__onFocusOut.bind(this);
        this.__onPointerDownCaptureBound = this.__onPointerDownCapture.bind(this);
        this.__onClickBound = this.__onClick.bind(this);
        this.__onBeforeInputCaptureBound = this.__onBeforeInputCapture.bind(this);
        this.__onKeyDownCaptureBound = this.__onKeyDownCapture.bind(this);
        this.__scheduleBound = this.__schedule.bind(this);
        this.__refocusEditableBound = this.__refocusEditable.bind(this);
        this.__onTouchMoveBound = this.__onTouchMove.bind(this);
        this.__onDocClickCaptureBound = this.__onDocClickCapture.bind(this);
        this.__onTransitionEndBound = this.__onTransitionEnd.bind(this);
    }

    /**
     * Switches mobile mode and redoes labels/layout.
     * @param {unknown} v
     * @returns {void}
     */
    setIsMobile(v: unknown): void {
        this.isMobile = !!v;
        if (!this.bar) return;

        this.__setLabels(this.bar);
        this.__schedule();
    }

    /**
     * Installs the toolbar and wires it to the allowed editables.
     * Yeah this one does a lot.
     * @param {unknown} options
     * @param {unknown} targets
     * @returns {Promise<this>}
     */
    async install(options?: unknown, targets?: unknown): Promise<this> {
        const opts = options || {};
        this.opts = opts;

        /**
         * Picks the first defined value from a bunch of possibles.
         * @param {...unknown[]} values
         * @returns {unknown | null}
         */
        const firstDef = (...values: readonly unknown[]): unknown | null => {
            for (const v of values) {
                if (v !== undefined) return v;
            }

            return null;
        };

        const optsRec = opts as Record<string, unknown>;

        const allowRaw = firstDef(
            targets,
            optsRec["targets"],
            optsRec["target"],
            optsRec["allowed"],
            optsRec["allow"],
            optsRec["editables"],
            optsRec["editable"]
        );

        const allowed = (() => {
            if (!allowRaw) return [];
            if (Array.isArray(allowRaw)) return allowRaw;
            if (allowRaw instanceof Element) return [allowRaw];

            if (typeof allowRaw === "object" && typeof (allowRaw as { length?: unknown }).length === "number") {
                try {
                    return Array.from(allowRaw as ArrayLike<unknown>);
                } catch {
                    return [];
                }
            }

            return [];
        })()
            .filter((x): x is Element => x instanceof Element);

        const baseIsEditable = keyboardEmu.prototype.__isEditable.bind(this);
        const allowedSet = new Set<Element>(allowed);

        (this as unknown as { __isEditable: (el: unknown) => boolean }).__isEditable = (el: unknown): boolean => {
            if (!baseIsEditable(el)) return false;
            if (!allowedSet.size) return false;
            if (!(el instanceof Element)) return false;

            for (const a of allowedSet) {
                if (a === el) return true;
                if (typeof a.contains === "function" && a.contains(el)) return true;
            }

            return false;
        };

        const zIndex = typeof optsRec["zIndex"] === "number"
            ? (optsRec["zIndex"] as number)
            : keyboardEmu.DEFAULT_Z_INDEX;
        this.zIndex = zIndex;

        const existing = document.getElementById("keyboard-emu");
        if (existing) existing.remove();

        const existingCss = document.getElementById(keyboardEmu.CSS_LINK_ID);
        if (
            existingCss &&
            existingCss.tagName === "LINK" &&
            existingCss.getAttribute("data-owner") === "keyboard-emu"
        ) {
            existingCss.remove();
        }

        const { link: cssLink, injected: cssInjected } = this.__ensCss();
        this.cssLink = cssLink;
        this.cssInjected = cssInjected;

        const bar = document.createElement("div");
        this.bar = bar;

        bar.id = "keyboard-emu";
        bar.setAttribute("role", "toolbar");
        bar.setAttribute("aria-label", "Terminal keys");
        bar.classList.add("kb-hidden");

        bar.style.setProperty("--toolbar-z", String(keyboardEmu.HIDDEN_Z));

        await this.__injHtml(bar);
        this.__setLabels(bar);

        this.mods = { ctrl: false, alt: false, meta: false, shift: false, fn: false };
        this.__syncBtns();

        const sendCandidate = optsRec["send"];
        this.send =
            typeof sendCandidate === "function"
                ? (sendCandidate as SendCb)
                : (p: SendMsg): void => {
                    const t = (window as unknown as { term?: unknown }).term;
                    if (t && typeof (t as { write?: unknown }).write === "function") {
                        (t as { write: (seq: string) => void }).write(p.seq);
                    }
                };

        this.lastEditable = null;
        this.toolbarVisible = false;

        document.addEventListener("focusin", this.__onFocusInBound, true);
        document.addEventListener("focusout", this.__onFocusOutBound, true);

        const initialActive = document.activeElement;
        if ((this as unknown as { __isEditable: (el: unknown) => boolean }).__isEditable(initialActive)) {
            this.lastEditable = initialActive as HTMLElement;
            this.__setVis(true);
        } else {
            this.__setVis(false);
        }

        for (const b of bar.querySelectorAll("button")) b.tabIndex = -1;

        bar.addEventListener("touchmove", this.__onTouchMoveBound, { passive: false });
        bar.addEventListener("pointerdown", this.__onPointerDownCaptureBound, { capture: true, passive: false });
        bar.addEventListener("click", this.__onClickBound);
        bar.addEventListener("transitionend", this.__onTransitionEndBound);

        this.suppressNextClick = false;

        document.addEventListener("beforeinput", this.__onBeforeInputCaptureBound, true);
        document.addEventListener("keydown", this.__onKeyDownCaptureBound, true);

        this.vv = window.visualViewport || null;
        this.raf = 0;

        this.ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.__schedule()) : null;
        if (this.ro) {
            this.ro.observe(document.documentElement);
            this.ro.observe(bar);
        }

        if (this.vv) {
            this.vv.addEventListener("resize", this.__scheduleBound);
            this.vv.addEventListener("scroll", this.__scheduleBound);
        }

        window.addEventListener("resize", this.__scheduleBound, { passive: true });
        window.addEventListener("scroll", this.__scheduleBound, { passive: true });
        window.addEventListener("orientationchange", this.__scheduleBound);

        this.__schedule();

        document.addEventListener("click", this.__onDocClickCaptureBound, true);

        return this;
    }

    /**
     * Replaces the send callback if the value is callable.
     * @param {unknown} fn
     * @returns {void}
     */
    setSend(fn: unknown): void {
        if (typeof fn === "function") this.send = fn as SendCb;
    }

    /**
     * Shows or hides the toolbar.
     * @param {boolean} v
     * @returns {void}
     */
    setVisible(v: boolean): void {
        if (!this.bar) return;
        if (v) this.__show();
        else this.__hide();
    }

    /**
     * Tears the whole thing down and removes listeners.
     * @returns {void}
     */
    destroy(): void {
        const bar = this.bar;
        if (!bar) return;

        if (this.vv) {
            this.vv.removeEventListener("resize", this.__scheduleBound);
            this.vv.removeEventListener("scroll", this.__scheduleBound);
        }

        window.removeEventListener("resize", this.__scheduleBound);
        window.removeEventListener("scroll", this.__scheduleBound);
        window.removeEventListener("orientationchange", this.__scheduleBound);
        document.removeEventListener("beforeinput", this.__onBeforeInputCaptureBound, true);
        document.removeEventListener("keydown", this.__onKeyDownCaptureBound, true);

        document.removeEventListener("focusin", this.__onFocusInBound, true);
        document.removeEventListener("focusout", this.__onFocusOutBound, true);

        bar.removeEventListener("pointerdown", this.__onPointerDownCaptureBound, true);
        bar.removeEventListener("click", this.__onClickBound);
        bar.removeEventListener("touchmove", this.__onTouchMoveBound);
        bar.removeEventListener("transitionend", this.__onTransitionEndBound);

        if (this.ro) this.ro.disconnect();
        if (this.raf) window.cancelAnimationFrame(this.raf);

        bar.remove();

        if (this.cssInjected && this.cssLink && this.cssLink.isConnected) {
            this.cssLink.remove();
        }

        this.bar = null;
        this.vv = null;
        this.ro = null;
        this.raf = 0;

        document.removeEventListener("click", this.__onDocClickCaptureBound, true);
    }

    /**
     * Swallows the synthetic click after a handled touch press.
     * @param {MouseEvent} e
     * @returns {void}
     */
    __onDocClickCapture(e: MouseEvent): void {
        if (!this.suppressNextClick) return;

        this.suppressNextClick = false;

        e.preventDefault();
        e.stopPropagation();

        if (typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
        }
    }

    /**
     * Finishes visibility bits after css transitions end.
     * Also tidies the Fn row state when that animation is done.
     * @param {TransitionEvent} e
     * @returns {void}
     */
    __onTransitionEnd(e: TransitionEvent): void {
        const bar = this.bar;
        if (!bar) return;

        const target = e.target;
        if (!(target instanceof HTMLElement)) return;

        const isBarTransition =
            target === bar &&
            (e.propertyName === "opacity" || e.propertyName === "transform");

        if (isBarTransition && this.toolbarVisible) {
            bar.style.setProperty("--toolbar-z", String(this.zIndex));
        }

        if (
            isBarTransition &&
            !this.toolbarVisible &&
            bar.classList.contains("kb-hidden")
        ) {
            bar.style.setProperty("--toolbar-z", String(keyboardEmu.HIDDEN_Z));
        }

        if (isBarTransition) return;

        if (!target.classList.contains("fn-grid-wrap")) return;
        if (e.propertyName !== "max-height" && e.propertyName !== "opacity" && e.propertyName !== "transform") return;
        if (this.mods.fn) return;
        if (!bar.classList.contains("fn-exiting")) return;

        bar.classList.remove("fn-exiting");
        this.__schedule();
    }

    /**
     * Waits until an element with this id exists in the DOM.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async __waitEl(id: string): Promise<void> {
        while (!document.getElementById(id)) {
            await nextFrame();
        }
    }

    /**
     * Makes sure the css link is there.
     * @returns {CssRes}
     */
    __ensCss(): CssRes {
        const existing = document.getElementById(keyboardEmu.CSS_LINK_ID);
        if (existing && existing.tagName === "LINK") {
            return { link: existing as HTMLLinkElement, injected: false };
        }

        const link = document.createElement("link");
        link.id = keyboardEmu.CSS_LINK_ID;
        link.rel = "stylesheet";
        link.href = this.cssUrl;
        link.setAttribute("data-owner", "keyboard-emu");
        document.head.appendChild(link);

        return { link, injected: true };
    }

    /**
     * Fetches and injects the keyboard html.
     * @param {HTMLDivElement} bar
     * @returns {Promise<void>}
     */
    async __injHtml(bar: HTMLDivElement): Promise<void> {
        const res = await fetch(this.htmlUrl, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`Failed to load ${this.htmlUrl} (${res.status})`);

        const html = await res.text();
        bar.innerHTML = html;

        document.body.appendChild(bar);
        await this.__waitEl(keyboardEmu.MARKER_ID);
    }

    /**
     * Applies mobile or desktop labels to responsive bits.
     * @param {HTMLElement} bar
     * @returns {void}
     */
    __setLabels(bar: HTMLElement): void {
        const nodes = bar.querySelectorAll<HTMLElement>("[data-mobile-text][data-desktop-text]");

        for (const el of nodes) {
            const m = el.getAttribute("data-mobile-text") || "";
            const d = el.getAttribute("data-desktop-text") || "";
            el.textContent = this.isMobile ? m : d;
        }
    }

    /**
     * Tiny number clamp.
     * @param {number} n
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    __clamp(n: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, n));
    }

    /**
     * Writes a px css var onto the toolbar root.
     * @param {string} name
     * @param {number} v
     * @returns {void}
     */
    __setPxVar(name: string, v: number): void {
        this.bar!.style.setProperty(name, `${v.toFixed(2)}px`);
    }

    /**
     * Says whether an element counts as editable for this tool.
     * @param {unknown} el
     * @returns {boolean}
     */
    __isEditable(el: unknown): boolean {
        if (!(el instanceof HTMLElement)) return false;
        if (el.isContentEditable) return true;
        if (el instanceof HTMLTextAreaElement) return true;

        if (el instanceof HTMLInputElement) {
            const t = (el.type || "").toLowerCase();

            return ![
                "button",
                "submit",
                "reset",
                "checkbox",
                "radio",
                "range",
                "file",
                "color",
                "date",
                "datetime-local",
                "month",
                "time",
                "week"
            ].includes(t);
        }

        return false;
    }

    /**
     * Refocuses the last editable if it still exists.
     * @returns {void}
     */
    __refocusEditable(): void {
        const el = this.lastEditable;
        if (!el) return;
        if (!document.contains(el)) return;

        try {
            el.focus({ preventScroll: true });
        } catch {
            el.focus();
        }
    }

    /**
     * Blurs the active editable if one is focused.
     * @returns {void}
     */
    __blurActiveEditable(): void {
        const a = document.activeElement;
        if (!(this as unknown as { __isEditable: (el: unknown) => boolean }).__isEditable(a)) return;

        try {
            (a as HTMLElement).blur();
        } catch {
        }
    }

    /**
     * Applies the visible/hidden state to the toolbar.
     * @param {boolean} visible
     * @returns {void}
     */
    __setVis(visible: boolean): void {
        const bar = this.bar!;
        const wasVisible = this.toolbarVisible;

        this.toolbarVisible = visible;

        if (!visible) {
            bar.classList.add("kb-hidden");
            bar.style.pointerEvents = "none";
            (bar as unknown as { inert: boolean }).inert = true;
        }

        if (!visible && !wasVisible) {
            bar.style.setProperty("--toolbar-z", String(keyboardEmu.HIDDEN_Z));
        }

        if (!visible) return;

        bar.style.setProperty("--toolbar-z", String(this.zIndex));
        bar.style.pointerEvents = "auto";
        (bar as unknown as { inert: boolean }).inert = false;

        window.requestAnimationFrame(() => {
            if (!this.bar || !this.toolbarVisible) return;

            this.bar.classList.remove("kb-hidden");
            this.__schedule();
        });
    }

    /**
     * Shows the toolbar if it is not already showing.
     * @returns {void}
     */
    __show(): void {
        if (this.toolbarVisible) return;
        this.__setVis(true);
        this.__schedule();
    }

    /**
     * Hides the toolbar and clears mods.
     * @returns {void}
     */
    __hide(): void {
        if (!this.toolbarVisible) return;
        this.__setVis(false);
        this.__clearMods();
    }

    /**
     * Re-checks visibility after focus has settled a frame later.
     * @returns {Promise<void>}
     */
    async __syncVisFromActive(): Promise<void> {
        await nextFrame();

        const a = document.activeElement;
        if ((this as unknown as { __isEditable: (el: unknown) => boolean }).__isEditable(a)) {
            this.lastEditable = a as HTMLElement;
            this.__show();
            return;
        }

        this.__hide();
    }

    /**
     * Focusin handler.
     * shows the toolbar when an editable gains focus.
     * @param {FocusEvent} e
     * @returns {void}
     */
    __onFocusIn(e: FocusEvent): void {
        const t = e.target;
        if (!(this as unknown as { __isEditable: (el: unknown) => boolean }).__isEditable(t)) return;

        this.lastEditable = t as HTMLElement;
        this.__show();
    }

    /**
     * Focusout handler.
     * lets the next frame decide if toolbar should stay.
     * @param {FocusEvent} _e
     * @returns {void}
     */
    __onFocusOut(_e: FocusEvent): void {
        void this.__syncVisFromActive();
    }

    /**
     * Adds stacked labels when button content no longer fits in one row.
     * @returns {void}
     */
    __stackIfNeeded(): void {
        const buttons = this.bar!.querySelectorAll<HTMLButtonElement>("button");

        for (const btn of buttons) {
            btn.classList.remove("stacked");

            const icon = btn.querySelector(".key-icon") as HTMLElement | null;
            const text = btn.querySelector(".key-text") as HTMLElement | null;
            if (!icon || !text) continue;

            const cs = getComputedStyle(btn);
            const padL = parseFloat(cs.paddingLeft) || 0;
            const padR = parseFloat(cs.paddingRight) || 0;
            const gap = parseFloat(cs.gap) || parseFloat(cs.columnGap) || 0;

            const available = btn.clientWidth - padL - padR;
            const needed = icon.offsetWidth + gap + Math.ceil(text.scrollWidth);

            if (needed > available + 1) btn.classList.add("stacked");
        }
    }

    /**
     * Fits the keyboard to mobile width.
     * @returns {void}
     */
    __fitMobile(): void {
        const cs = getComputedStyle(this.bar!);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const w = this.bar!.clientWidth - padL - padR;
        if (!w || !Number.isFinite(w)) return;

        const btnGap = this.__clamp(w * 0.01, 2, 6);

        const minKeyW = 28;
        const maxKeyW = 46;
        const cols = 7;
        const keyW = this.__clamp((w - ((cols - 1) * btnGap)) / cols, minKeyW, maxKeyW);

        const keyH = this.__clamp(keyW * 0.92, 30, 44);

        const font = this.__clamp(keyW * 0.3, 10.5, 13);
        const icon = this.__clamp(font * 1.08, 11.5, 15);
        const padX = this.__clamp(keyW * 0.18, 6, 10);
        const radius = this.__clamp(keyW * 0.22, 8, 10);
        const innerGap = this.__clamp(keyW * 0.1, 3, 6);

        this.__setPxVar("--key-w", keyW);
        this.__setPxVar("--key-h", keyH);
        this.__setPxVar("--btn-gap", btnGap);
        this.__setPxVar("--pad-x", padX);
        this.__setPxVar("--inner-gap", innerGap);
        this.__setPxVar("--font-size", font);
        this.__setPxVar("--icon-size", icon);
        this.__setPxVar("--radius", radius);
    }

    /**
     * Fits the keyboard to desktop width using the first preset that works.
     * @returns {void}
     */
    __fitDesk(): void {
        const cs = getComputedStyle(this.bar!);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const available = this.bar!.clientWidth - padL - padR;
        const grid = this.bar!.querySelector(".key-grid") as HTMLElement | null;

        for (const p of keyboardEmu.DESKTOP_PRESETS) {
            this.__setPxVar("--key-w", p.keyW);
            this.__setPxVar("--key-h", p.keyH);
            this.__setPxVar("--btn-gap", p.btnGap);
            this.__setPxVar("--pad-x", p.padX);
            this.__setPxVar("--inner-gap", p.innerGap);
            this.__setPxVar("--font-size", p.font);
            this.__setPxVar("--icon-size", p.icon);
            this.__setPxVar("--radius", p.radius);

            if (!grid) return;
            if (grid.scrollWidth <= available + 1) return;
        }
    }

    /**
     * Picks the right width-fit strategy.
     * @returns {void}
     */
    __fit(): void {
        if (this.isMobile) this.__fitMobile();
        else this.__fitDesk();
    }

    /**
     * Scales the Fn row down if it would overflow.
     * @returns {void}
     */
    __fitFn(): void {
        const wrap = this.bar!.querySelector(".fn-grid-wrap") as HTMLElement | null;
        const grid = this.bar!.querySelector(".fn-grid") as HTMLElement | null;
        if (!wrap || !grid) return;

        const isFnRowVisible = this.bar!.classList.contains("fn-on") || this.bar!.classList.contains("fn-exiting");
        if (!this.toolbarVisible || !isFnRowVisible) {
            grid.style.transform = "";
            return;
        }

        const aw = wrap.clientWidth;
        const sw = grid.scrollWidth;

        if (!aw || !sw || !Number.isFinite(aw) || !Number.isFinite(sw)) {
            grid.style.transform = "";
            return;
        }

        const scale = Math.min(1, aw / sw);
        grid.style.transform = scale < 1 ? `scale(${scale})` : "";
    }

    /**
     * Builds the terminal sequence for a key and modifier state.
     */
    __seq(key: string, mods: Mods): string {
        return buildKeySequence(key, mods);
    }

    /**
     * Updates pressed states and Fn classes.
     * @returns {void}
     */
    __syncBtns(): void {
        /**
         * Syncs one modifier button.
         * @param {ModKey} name
         * @returns {void}
         */
        const set = (name: ModKey): void => {
            const b = this.bar!.querySelector(`button[data-mod="${name}"]`) as HTMLButtonElement | null;
            if (!b) return;

            const on = this.mods[name];
            b.classList.toggle("sticky-on", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
        };

        set("ctrl");
        set("alt");
        set("meta");
        set("shift");
        set("fn");

        const bar = this.bar!;
        const hadFnOn = bar.classList.contains("fn-on");

        if (this.mods.fn) {
            bar.classList.remove("fn-exiting");
            bar.classList.add("fn-on");
        }

        if (!this.mods.fn) bar.classList.remove("fn-on");
        if (!this.mods.fn && hadFnOn) bar.classList.add("fn-exiting");

        const shouldResetGrid =
            !this.mods.fn &&
            !bar.classList.contains("fn-exiting");

        const grid = shouldResetGrid
            ? bar.querySelector(".fn-grid") as HTMLElement | null
            : null;

        if (grid) grid.style.transform = "";

        this.__schedule();
    }

    /**
     * Clears one-shot modifiers but leaves Fn alone.
     * @returns {void}
     */
    __clearOneShotMods(): void {
        const hadOneShot = this.mods.ctrl || this.mods.alt || this.mods.meta || this.mods.shift;
        if (!hadOneShot) return;

        this.mods.ctrl = false;
        this.mods.alt = false;
        this.mods.meta = false;
        this.mods.shift = false;
        this.__syncBtns();
    }

    /**
     * Clears all modifiers, Fn included.
     * @returns {void}
     */
    __clearMods(): void {
        this.mods.ctrl = false;
        this.mods.alt = false;
        this.mods.meta = false;
        this.mods.shift = false;
        this.mods.fn = false;
        this.__syncBtns();
    }

    /**
     * Toggles a modifier and refreshes button state.
     * @param {ModKey} name
     * @returns {void}
     */
    __tglMod(name: ModKey): void {
        this.mods[name] = !this.mods[name];
        this.__syncBtns();
    }

    /**
     * Sends one key and clears one-shot mods afterwards.
     * Escape is special and hides the toolbar.
     * @param {string} key
     * @returns {void}
     */
    __fire(key: string): void {
        const seq = this.__seq(key, this.mods);
        if (!seq) return;

        this.send!({ key, seq, mods: { ...this.mods } });

        if (key === "Escape") {
            this.skipNextRefocus = true;
            this.__blurActiveEditable();
            this.__hide();
            return;
        }

        this.__clearOneShotMods();
    }

    /**
     * Handles a toolbar button press.
     * either toggles a mod or fires a key.
     * @param {Element} btn
     * @returns {void}
     */
    __press(btn: Element): void {
        const mod = btn.getAttribute("data-mod");
        if (mod === "ctrl" || mod === "alt" || mod === "meta" || mod === "shift" || mod === "fn") {
            this.__tglMod(mod);
            return;
        }

        const key = btn.getAttribute("data-key");
        if (!key) return;

        this.__fire(key);
    }

    /**
     * Prevents toolbar touches from scrolling the page underneath.
     * @param {TouchEvent} e
     * @returns {void}
     */
    __onTouchMove(e: TouchEvent): void {
        e.preventDefault();
    }

    /**
     * Handles touch presses while keeping focus on the editable.
     * @param {PointerEvent} e
     * @returns {void}
     */
    __onPointerDownCapture(e: PointerEvent): void {
        if (!this.isMobile) return;
        if (e.pointerType && e.pointerType !== "touch") return;

        const t = e.target;
        if (!(t instanceof Element)) return;

        const btn = t.closest("button") as HTMLButtonElement | null;
        if (!btn) return;
        if (!this.lastEditable) return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        this.suppressNextClick = true;

        this.__press(btn);

        if (this.skipNextRefocus) {
            this.skipNextRefocus = false;
            return;
        }

        window.requestAnimationFrame(this.__refocusEditableBound);
    }

    /**
     * Handles mouse clicks on toolbar buttons.
     * @param {MouseEvent} e
     * @returns {void}
     */
    __onClick(e: MouseEvent): void {
        const suppressed = this.suppressNextClick;

        if (suppressed) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (
            suppressed &&
            typeof e.stopImmediatePropagation === "function"
        ) e.stopImmediatePropagation();

        if (suppressed) return;

        const t = e.target;
        if (!(t instanceof Element)) return;

        const btn = t.closest("button") as HTMLButtonElement | null;
        if (!btn) return;

        this.__press(btn);

        if (this.skipNextRefocus) {
            this.skipNextRefocus = false;
            return;
        }

        if (this.lastEditable) window.requestAnimationFrame(this.__refocusEditableBound);
    }

    /**
     * Intercepts beforeinput while modifiers are armed.
     * @param {Event} e
     * @returns {void}
     */
    __onBeforeInputCapture(e: Event): void {
        if (!this.mods.ctrl && !this.mods.alt && !this.mods.meta && !this.mods.shift && !this.mods.fn) return;
        if (!(e instanceof InputEvent)) return;

        const type = e.inputType || "";
        const data = typeof e.data === "string" ? e.data : "";

        const isTextInsert =
            type === "insertText" &&
            data.length === 1;

        const textSequence = isTextInsert
            ? this.__seq(data, this.mods)
            : "";

        if (isTextInsert && !textSequence) return;

        if (isTextInsert) {
            e.preventDefault();
            e.stopPropagation();
            this.send!({
                key: data,
                seq: textSequence,
                mods: { ...this.mods }
            });
            this.__clearOneShotMods();
            return;
        }

        const isLineInsert =
            type === "insertLineBreak" ||
            type === "insertParagraph";

        const lineSequence = isLineInsert
            ? this.__seq("Enter", this.mods)
            : "";

        if (isLineInsert && !lineSequence) return;

        if (isLineInsert) {
            e.preventDefault();
            e.stopPropagation();
            this.send!({
                key: "Enter",
                seq: lineSequence,
                mods: { ...this.mods }
            });
            this.__clearOneShotMods();
            return;
        }

        if (type !== "deleteContentBackward") return;

        const key = this.mods.fn ? "Delete" : "Backspace";
        const seq = this.__seq("Backspace", this.mods);
        if (!seq) return;

        e.preventDefault();
        e.stopPropagation();
        this.send!({ key, seq, mods: { ...this.mods } });
        this.__clearOneShotMods();
    }

    /**
     * Intercepts physical key presses while modifiers are armed.
     * @param {KeyboardEvent} e
     * @returns {void}
     */
    __onKeyDownCapture(e: KeyboardEvent): void {
        if (!this.mods.ctrl && !this.mods.alt && !this.mods.meta && !this.mods.shift && !this.mods.fn) return;

        const k = e.key;
        if (k === "Alt" || k === "Control" || k === "Meta" || k === "Shift") return;

        const seq = this.__seq(k, this.mods);
        if (!seq) return;

        e.preventDefault();
        e.stopPropagation();
        this.send!({ key: k, seq, mods: { ...this.mods } });
        this.__clearOneShotMods();
    }

    /**
     * Positions the toolbar against the bottom edge of the visual viewport.
     * @returns {void}
     */
    __place(): void {
        const bar = this.bar!;
        const rect = bar.getBoundingClientRect();
        const height = Math.max(0, Math.ceil(rect.height || bar.offsetHeight || 0));
        const bottom = this.vv ? this.vv.offsetTop + this.vv.height : window.innerHeight;

        const width = document.documentElement.clientWidth || window.innerWidth;
        const top = Math.round(bottom - height + keyboardEmu.VIEWPORT_OVERLAP_PX);

        bar.style.top = `${top}px`;
        bar.style.left = "0px";
        bar.style.width = `${width}px`;
    }

    /**
     * Schedules a layout pass on the next frame.
     * @returns {void}
     */
    __schedule(): void {
        if (!this.bar) return;
        if (this.raf) return;

        this.raf = window.requestAnimationFrame(() => {
            this.raf = 0;
            this.__fit();
            this.__fitFn();
            this.__stackIfNeeded();
            this.__place();
        });
    }
}