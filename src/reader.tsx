import type { ReactElement } from "react";
import { removeExistingById, recreateSingleton } from "./domSingletons.ts";
import { factory, closeOnClick, type Modal } from "./modals.ts";
import { getReaderNds, replaceTategaki, serialisNde } from "./tategaki.tsx";
import { replaceSsmlAuthoring } from "./ssml.ts";
import MediaStyler from "./mediaStyler.tsx";
import * as config from "./config.ts";
import { render2Frag, render2Mkup } from "./reactHelpers.tsx";
import * as icons from "./icons.tsx";
import * as helpers from "./helpers.ts";

void recreateSingleton;

const READER_PARA_NUMS_COOKIE = "showParagraphNumbers";
const READER_PARA_NUMS_CLASS = "reader-show-paragraph-numbers";
const PNUM_TOGGLE_SELECTOR = ".btn-toggle-paragraph-numbers";
const READER_CTRL_FLOAT_MARKER_ID = "kc-reader-controls-float-marker";
const READER_CTRL_SPACER_ID = "kc-reader-controls-spacer";

type ReaderButtonKey =
    | "toggleParagraphNumbers"
    | "clearBookmark"
    | "prevChapter"
    | "jumpToChapter"
    | "nextChapter"
    | "scrollDown"
    | "showInfo"
    | "decreaseFont"
    | "resetFont"
    | "increaseFont"
    | "scrollUp";

interface ReaderButtonDef {
    icon: icons.ReaderIcon;
    action: string;
}

// Type-safe access to the modal decorator ctx without importing non-exported types
type ModalDecorator = ReturnType<typeof closeOnClick>;
type ModalCtx = Parameters<NonNullable<ModalDecorator["mount"]>>[0];

type ReaderButtons = Record<ReaderButtonKey, ReaderButtonDef>;

interface StoriesIndex {
    [storyName: string]: string[];
}

interface ChaptersIndexResult {
    chapters: number[];
    urls: string[];
}

interface RenderXmlDocOpts {
    withBookmarks: boolean;
    storyBase: string | null;
    chapter: number | null;
}

interface DebugApi {
    pickXml?: () => Promise<void>;
    renderXmlText?: (xmlText: string) => Promise<void>;
    renderXmlFile?: (file: File) => Promise<void>;
    [k: string]: unknown;
}

declare global {
    interface Window {
        params: URLSearchParams;
        storyPath: string | null;
        storyName: string | null;
        chapter: number;
        fallback: HTMLElement | null;
        chapterCacheKey: string;
        lastKnownChapter: number;
        readerRoot: HTMLElement | null;
        storyPickerRoot: HTMLElement | null;
        buttons: ReaderButtons;

        __kcReaderCtrlObserver?: IntersectionObserver | null;
        readerTopAnchor?: HTMLElement | null;

        debug?: DebugApi;
    }
}

/**
 * @returns {number[]}
 */
function readChCache(): number[] {
    const raw: unknown = JSON.parse(localStorage.getItem(window.chapterCacheKey) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

window.params = new URLSearchParams(window.location.search);
window.storyPath = window.params.get("story");
window.storyName = window.storyPath ? (window.storyPath.split("/").pop() ?? null) : null;
window.chapter = parseInt(window.params.get("chapter") || "1");

const params = window.params;

window.fallback = document.getElementById("js-content-fallback");
if (window.fallback) window.fallback.style.display = "none";

window.chapterCacheKey = `chapterCache_${window.storyName}`;
window.lastKnownChapter = parseInt(localStorage.getItem(window.chapterCacheKey) || "0");

window.readerRoot = document.getElementById("reader");
window.storyPickerRoot = document.getElementById("story-picker");

window.buttons = {
    toggleParagraphNumbers: { icon: icons.MakeToggleParagraphNumbersIcon(), action: "Toggle paragraph numbers" },
    clearBookmark: { icon: icons.MakeClearBookmarkIcon(), action: "Clear bookmark for this chapter" },
    prevChapter: { icon: icons.MakePrevChapterIcon(), action: "Previous chapter" },
    jumpToChapter: { icon: icons.MakeJumpToChapterIcon(), action: "Jump to chapter" },
    nextChapter: { icon: icons.MakePrevChapterIcon(180), action: "Next chapter" },
    scrollDown: { icon: icons.MakePrevChapterIcon(270), action: "Scroll down" },
    showInfo: { icon: icons.MakeShowInfoIcon(), action: "Show navigation info" },
    decreaseFont: { icon: icons.MakeDecreaseFontIcon(), action: "Decrease font size" },
    resetFont: { icon: icons.MakeResetFontIcon(), action: "Reset font size" },
    increaseFont: { icon: icons.MakeIncreaseFontIcon(), action: "Increase font size" },
    scrollUp: { icon: icons.MakePrevChapterIcon(90), action: "Scroll up" }
};

/**
 * @param {ReaderButtonDef}
 * @returns {ReactElement}
 */
function InfoLine(def: ReaderButtonDef): ReactElement {
    return (
        <li>
            <span className="kc-info-icon">{def.icon}</span>
            <span className="kc-info-text">{def.action}</span>
        </li>
    );
}

/**
 * @param {HTMLButtonElement} button
 * @param {icons.ReaderIcon} icon
 * @returns {void}
 */
function setButtonIcon(button: HTMLButtonElement, icon: icons.ReaderIcon): void {
    if (typeof icon === "string") {
        button.replaceChildren(document.createTextNode(icon));
        return;
    }

    button.replaceChildren(render2Frag(icon));
}

/**
 * @returns {ReactElement}
 */
function InfoModal(): ReactElement {
    const b = window.buttons;

    return (
        <>
            <div className="modal-header">
                <h2>Navigation Button Guide</h2>
            </div>

            <div className="modal-content">
                <ul className="kc-info-list">
                    <InfoLine {...b.toggleParagraphNumbers} />
                    <InfoLine {...b.clearBookmark} />
                    <InfoLine {...b.prevChapter} />
                    <InfoLine {...b.jumpToChapter} />
                    <InfoLine {...b.nextChapter} />
                    <InfoLine {...b.scrollDown} />
                    <InfoLine {...b.scrollUp} />
                </ul>

                <h3>Font Controls</h3>

                <ul className="kc-info-list">
                    <InfoLine {...b.decreaseFont} />
                    <InfoLine {...b.resetFont} />
                    <InfoLine {...b.increaseFont} />
                </ul>

                <div className="kc-modal-actions" />

                <p className="modal-note">Click outside or press <kbd>Esc</kbd> to close.</p>
            </div>
        </>
    );
}

/**
 * @returns {ReactElement}
 */
function LangTipModal(): ReactElement {
    return (
        <>
            <div className="modal-header">
                <h3>Did you know?</h3>
            </div>

            <div className="modal-content">
                <p>
                    Some bits of text in the story are interactive. If you see something in another
                    language, hover your mouse over it to reveal a quick translation. On phones and
                    tablets, just tap the text instead.
                </p>

                <label className="kc-checkbox-row">
                    <input id="kc-language-tooltips-help-hide" type="checkbox" />
                    <span>Do not show this tip again</span>
                </label>

                <div className="kc-modal-actions">
                    <button
                        id="kc-language-tooltips-help-close"
                        type="button"
                        style={{ display: "block", margin: "0 auto" }}
                    >
                        Close
                    </button>
                </div>

                <p className="modal-note">You can close this window with <kbd>Esc</kbd>.</p>
            </div>
        </>
    );
}

/**
 * @returns {ReactElement}
 */
function ReaderModeTipModal(): ReactElement {
    return (
        <>
            <div className="modal-header">
                <h3>Did you know?</h3>
            </div>

            <div className="modal-content">
                <p>
                    Too many distractions? Try Reader Mode here.
                </p>

                <label className="kc-checkbox-row">
                    <input id="kc-reader-mode-help-hide" type="checkbox" />
                    <span>Do not show this tip again</span>
                </label>

                <div className="kc-modal-actions">
                    <button
                        id="kc-reader-mode-help-close"
                        type="button"
                        style={{ display: "block", margin: "0 auto" }}
                    >
                        Close
                    </button>
                </div>

                <p className="modal-note">You can close this window with <kbd>Esc</kbd>.</p>
            </div>
        </>
    );
}

/**
 * @returns {ReactElement}
 */
function ReaderCtrls(): ReactElement {
    return (
        <>
            <div className="chapter-navigation">
                <button className="btn-toggle-paragraph-numbers">{window.buttons.toggleParagraphNumbers.icon}</button>
                <button className="btn-clear-bookmark">{window.buttons.clearBookmark.icon}</button>
                <button className="btn-prev">{window.buttons.prevChapter.icon}</button>
                <input
                    className="chapter-display"
                    id="reader-chapter-display-top"
                    type="text"
                    value="1"
                    readOnly
                    style={{
                        width: "2ch",
                        textAlign: "center",
                        border: "none",
                        background: "transparent",
                        fontWeight: "bold"
                    }}
                />
                <input
                    className="chapter-input"
                    id="reader-chapter-input-top"
                    type="number"
                    min="0"
                    style={{ width: "2ch", textAlign: "center" }}
                />
                <button className="btn-jump">{window.buttons.jumpToChapter.icon}</button>
                <button
                    className="chapter-end"
                    disabled
                    style={{ width: "2ch", textAlign: "center", fontWeight: "bold" }}
                />
                <button className="btn-next">{window.buttons.nextChapter.icon}</button>
                <button className="btn-scroll-down">{window.buttons.scrollDown.icon}</button>
                <button className="btn-info">{window.buttons.showInfo.icon}</button>
            </div>

            <div className="font-controls">
                <button className="font-decrease">{window.buttons.decreaseFont.icon}</button>
                <button className="font-reset">{window.buttons.resetFont.icon}</button>
                <button className="font-increase">{window.buttons.increaseFont.icon}</button>
            </div>
        </>
    );
}

/**
 * @returns {ReactElement}
 */
function ImgNav(): ReactElement {
    return (
        <>
            <button className="btn-up" title="Move image up" aria-label="Move image up">
                {icons.MakeImageNavigationArrowIcon(0)}
            </button>

            <div className="horizontal">
                <button className="btn-left" title="Move image left" aria-label="Move image left">
                    {icons.MakeImageNavigationArrowIcon(270)}
                </button>

                <button className="btn-center" title="Reset image position" aria-label="Reset image position">
                    {window.buttons.jumpToChapter.icon}
                </button>

                <button className="btn-right" title="Move image right" aria-label="Move image right">
                    {icons.MakeImageNavigationArrowIcon(90)}
                </button>
            </div>

            <button className="btn-down" title="Move image down" aria-label="Move image down">
                {icons.MakeImageNavigationArrowIcon(180)}
            </button>
        </>
    );
}

/**
 * @param {{ chapter: number }} props
 * @returns {ReactElement}
 */
function MissingCh(props: { chapter: number }): ReactElement {
    return (
        <div className="chapter-404">
            <h2>📕 Chapter {props.chapter} Not Found</h2>
            <p>Looks like this XML chapter doesn't exist yet.</p>
        </div>
    );
}

/**
 * @param {"p" | "h1" | "h2" | "blockquote"} tag
 * @param {string} className
 * @param {string} innerHtml
 * @returns {string}
 */
function renderBlk(
    tag: "p" | "h1" | "h2" | "blockquote",
    className: string,
    innerHtml: string
): string {
    const markup = { __html: innerHtml };

    switch (tag) {
        case "h1":
            return render2Mkup(<h1 className={className} dangerouslySetInnerHTML={markup} />);
        case "h2":
            return render2Mkup(<h2 className={className} dangerouslySetInnerHTML={markup} />);
        case "blockquote":
            return render2Mkup(<blockquote className={className} dangerouslySetInnerHTML={markup} />);
        default:
            return render2Mkup(<p className={className} dangerouslySetInnerHTML={markup} />);
    }
}

/**
 * @param {string} id
 * @param {string} blockHtml
 * @returns {string}
 */
function wrapBkm(id: string, blockHtml: string): string {
    return render2Mkup(
        <div
            className="reader-bookmark"
            id={id}
            dangerouslySetInnerHTML={{ __html: blockHtml }}
        />
    );
}

/**
 * @param {ReturnType<typeof getReaderNds>} readerNodes
 * @returns {string}
 */
function buildHtml(readerNodes: ReturnType<typeof getReaderNds>): string {
    return readerNodes
        .map((node) => {
            const tatMarkup = serialisNde(node);
            if (tatMarkup) return tatMarkup;

            const p = node;
            const isCleaned = p.tagName === "paragraph";
            const pPr = isCleaned ? null : p.getElementsByTagName("w:pPr")[0];
            let style = "";

            const styleEl =
                !isCleaned && pPr
                    ? pPr.getElementsByTagName("w:pStyle")[0]
                    : null;

            if (styleEl) style = styleEl.getAttribute("w:val") || "";

            const isTitle = style === "Title";
            const isHeading = style === "Heading1" || style === "Heading2";
            const isQuote = style === "Quote";
            const isIntenseQuote = style === "IntenseQuote";

            const tag: "p" | "h1" | "h2" | "blockquote" =
                isTitle
                    ? "h1"
                    : isHeading
                        ? "h2"
                        : isQuote || isIntenseQuote
                            ? "blockquote"
                            : "p";

            const className =
                isTitle
                    ? "reader-title"
                    : isHeading
                        ? "reader-subtitle"
                        : isIntenseQuote
                            ? "reader-quote reader-intense"
                            : isQuote
                                ? "reader-quote"
                                : "reader-paragraph";

            const runs = isCleaned
                ? Array.from(p.childNodes)
                    .map((childNode) =>
                        childNode.nodeType === 1
                            ? new XMLSerializer().serializeToString(childNode)
                            : (childNode.textContent || "")
                    )
                    .join("")
                : Array.from(p.getElementsByTagName("w:r"))
                    .map((run) => {
                        const text = Array.from(run.getElementsByTagName("w:t"))
                            .map((t) => t.textContent || "")
                            .join("");

                        const rPr = run.getElementsByTagName("w:rPr")[0];
                        const spanClass: string[] = [];

                        const hasBold = Boolean(rPr?.getElementsByTagName("w:b").length);
                        const hasItalic = Boolean(rPr?.getElementsByTagName("w:i").length);
                        const hasUnderline = Boolean(rPr?.getElementsByTagName("w:u").length);
                        const hasStrike = Boolean(rPr?.getElementsByTagName("w:strike").length);
                        const hasSmallCaps = Boolean(rPr?.getElementsByTagName("w:smallCaps").length);

                        if (hasBold) spanClass.push("reader-bold");
                        if (hasItalic) spanClass.push("reader-italic");
                        if (hasUnderline) spanClass.push("reader-underline");
                        if (hasStrike) spanClass.push("reader-strike");
                        if (hasSmallCaps) spanClass.push("reader-smallcaps");

                        return render2Mkup(<span className={spanClass.join(" ")}>{text}</span>);
                    })
                    .join("");

            return renderBlk(tag, className, runs);
        })
        .join("\n");
}

const READER_INFO_MODAL_ID = "kc-reader-info-modal";

const READER_INFO_MODAL_HTML = (): string => render2Mkup(<InfoModal />);

const infoModal: Modal = factory.create({
    id: READER_INFO_MODAL_ID,
    mode: "blocking",
    content: READER_INFO_MODAL_HTML,
    decorators: [
        closeOnClick("#kc-reader-info-close")
    ]
});

const LANG_TIP_MODAL_ID = "kc-language-tooltips-help-modal";
const LANG_TIP_HIDE_KEY = "languageTooltipsHelpModalHide";
const READER_MODE_TIP_MODAL_ID = "kc-reader-mode-help-modal";
const READER_MODE_TIP_HIDE_KEY = "readerModeHelpModalHide";

let langTipShown = false;
let langTipObs: IntersectionObserver | null = null;
let readerModeTipShown = false;
let readerModeTipObs: IntersectionObserver | null = null;
let ctrlBottomObs: IntersectionObserver | null = null;
let ctrlMarkerAbove = false;
let ctrlBottomSeen = false;
let ctrlScrollFn: (() => void) | null = null;
let ctrlResizeFn: (() => void) | null = null;

/**
 * @param {string} key
 * @returns {boolean}
 */
function readLsBool(key: string): boolean {
    return localStorage.getItem(key) === "true";
}

/**
 * @param {string} key
 * @param {boolean} value
 * @returns {void}
 */
function writeLsBool(key: string, value: boolean): void {
    localStorage.setItem(key, value ? "true" : "false");
}

/**
 * @returns {boolean}
 */
function showLangTip(): boolean {
    if (langTipShown) return false;
    if (readLsBool(LANG_TIP_HIDE_KEY)) return false;
    return true;
}

/**
 * @returns {boolean}
 */
function showReaderModeTip(): boolean {
    if (readerModeTipShown) return false;
    if (readLsBool(READER_MODE_TIP_HIDE_KEY)) return false;
    return true;
}

const LANG_TIP_MODAL_HTML = (): string => render2Mkup(<LangTipModal />);

const persistLangTipHide: ModalDecorator = {
    mount: (ctx: ModalCtx) => {
        const box = ctx.modalEl.querySelector("#kc-language-tooltips-help-hide");
        if (!(box instanceof HTMLInputElement)) return;

        box.checked = readLsBool(LANG_TIP_HIDE_KEY);

        const onChange = (): void => {
            const nextHidden = box.checked;
            writeLsBool(LANG_TIP_HIDE_KEY, nextHidden);
            if (nextHidden) ctx.close();
        };

        box.addEventListener("change", onChange);
        return () => box.removeEventListener("change", onChange);
    }
};

const langTipModal: Modal = factory.create({
    id: LANG_TIP_MODAL_ID,
    mode: "non-blocking",
    readerModeCompatible: false,
    modalClassName: "did-you-know-tip",
    content: LANG_TIP_MODAL_HTML,
    closeOnOutsideClick: false,
    decorators: [
        closeOnClick("#kc-language-tooltips-help-close"),
        persistLangTipHide
    ]
});

/**
 * @returns {void}
 */
function openLangTip(): void {
    if (!showLangTip()) return;
    if (langTipModal.isOpen()) return;

    langTipModal.open();
    langTipShown = true;
}

/**
 * @param {Document} root
 * @returns {void}
 */
function initLangObs(root: Document = document): void {
    if (!showLangTip()) return;

    const triggers = Array.from(root.querySelectorAll("span.tooltip-trigger"))
        .filter((n): n is HTMLSpanElement => n instanceof HTMLSpanElement);

    if (!triggers.length) return;

    langTipObs?.disconnect();

    langTipObs = new IntersectionObserver(
        (entries: IntersectionObserverEntry[]) => {
            const anyVisible = entries.some((e) => e.isIntersecting);
            if (!anyVisible) return;

            openLangTip();

            langTipObs?.disconnect();
            langTipObs = null;
        },
        { threshold: 0.15 }
    );

    for (const el of triggers) {
        langTipObs.observe(el);
    }
}


const READER_MODE_TIP_MODAL_HTML = (): string => render2Mkup(<ReaderModeTipModal />);

const persistReaderModeTipHide: ModalDecorator = {
    mount: (ctx: ModalCtx) => {
        const box = ctx.modalEl.querySelector("#kc-reader-mode-help-hide");
        if (!(box instanceof HTMLInputElement)) return;

        box.checked = readLsBool(READER_MODE_TIP_HIDE_KEY);

        const onChange = (): void => {
            const nextHidden = box.checked;
            writeLsBool(READER_MODE_TIP_HIDE_KEY, nextHidden);
            if (nextHidden) ctx.close();
        };

        box.addEventListener("change", onChange);
        return () => box.removeEventListener("change", onChange);
    }
};

const readerModeTipModal: Modal = factory.create({
    id: READER_MODE_TIP_MODAL_ID,
    mode: "non-blocking",
    readerModeCompatible: false,
    modalClassName: "did-you-know-tip",
    position: {
        target: "#reader-toggle"
    },
    asTextBubble: true,
    content: READER_MODE_TIP_MODAL_HTML,
    closeOnOutsideClick: false,
    decorators: [
        closeOnClick("#kc-reader-mode-help-close"),
        persistReaderModeTipHide
    ]
});

/**
 * @returns {void}
 */
function openReaderModeTip(): void {
    if (!showReaderModeTip()) return;
    if (readerModeTipModal.isOpen()) return;

    readerModeTipModal.open();
    readerModeTipShown = true;
}

/**
 * Reuses the existing reader "Did you know?" observer logic for the
 * Reader Mode toggle.
 *
 * @param {HTMLButtonElement} button
 * @returns {void}
 */
export function initReaderModeTip(button: HTMLButtonElement): void {
    if (!showReaderModeTip()) return;

    readerModeTipObs?.disconnect();

    readerModeTipObs = new IntersectionObserver(
        (entries: IntersectionObserverEntry[]) => {
            const anyVisible = entries.some((entry) => entry.isIntersecting);
            if (!anyVisible) return;

            openReaderModeTip();

            readerModeTipObs?.disconnect();
            readerModeTipObs = null;
        },
        { threshold: 0.15 }
    );

    readerModeTipObs.observe(button);
}


// Reader-specific cookie helpers to avoid collision with main.js
/**
 * @param {string} name
 * @param {string} value
 * @param {number} days
 * @param {Document} root
 * @returns {void}
 */
function setRCookie(name: string, value: string, days = 365, root: Document = document): void {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    root.cookie = `reader_${name}=${value}; expires=${expires}; path=/`;
}

/**
 * @param {string} name
 * @param {Document} root
 * @returns {string | null}
 */
function getRCookie(name: string, root: Document = document): string | null {
    const cookies = root.cookie.split("; ");
    const cookie = cookies.find((row) => row.startsWith(`reader_${name}=`));
    return cookie ? cookie.split("=")[1] : null;
}

/**
 * @param {Document} root
 * @returns {void}
 */
function renderPNum(root: Document = document): void {
    void root;

    const reader = window.readerRoot;
    if (!reader) return;

    /**
     * @param {Element} bkm
     * @returns {boolean}
     */
    const shouldNum = (bkm: Element): boolean => {
        const contentEl = bkm.firstElementChild;
        if (!contentEl) return false;

        const clone = contentEl.cloneNode(true) as Element;

        clone.querySelectorAll(".reader-paragraph-num, .bookmark-emoji").forEach((n) => n.remove());

        if (clone.querySelector("email, sms, tooltip, signature, content, logo")) return false;
        if (clone.querySelector("img, svg, video, audio, iframe")) return false;

        const txt = (clone.textContent || "").replace(/\s+/g, "").trim();
        return txt.length > 0;
    };

    const allBkms = Array.from(reader.querySelectorAll(".reader-bookmark"));

    const numBkms = allBkms.filter(
        (el) => typeof el.id === "string" && /-ch\d+-\d+$/.test(el.id)
    );

    if (numBkms.length === 0) return;

    const maxOrd = Math.max(
        ...numBkms.map((el) => {
            const m = el.id.match(/-(\d+)$/);
            return m ? Number(m[1]) : 0;
        })
    );

    const digits = String(maxOrd).length;

    reader.style.setProperty("--reader-para-num-col-width", `${digits}ch`);
    reader.style.setProperty("--reader-para-num-gap", "0.9em");

    for (const el of numBkms) {
        const m = el.id.match(/-(\d+)$/);
        if (!m) continue;

        const ord = Number(m[1]);
        const label = String(ord).padStart(digits, "0");

        const shouldRender = shouldNum(el);
        let num = el.querySelector(":scope > .reader-paragraph-num") as HTMLSpanElement | null;

        if (!shouldRender && num) num.remove();
        if (!shouldRender) continue;

        if (!num) {
            num = document.createElement("span");
            num.className = "reader-paragraph-num";
            num.setAttribute("aria-hidden", "true");
            el.insertAdjacentElement("afterbegin", num);
        }

        if (num.textContent !== label) {
            num.textContent = label;
        }
    }
}

/**
 * @param {boolean} enabled
 * @returns {void}
 */
function enablePNum(enabled: boolean): void {
    const reader = window.readerRoot;
    if (!reader) return;

    /**
     * @param {boolean} isOn
     * @param {Document} root
     * @returns {void}
     */
    const syncPNumBtns = (isOn: boolean, root: Document = document): void => {
        root.querySelectorAll<HTMLElement>(PNUM_TOGGLE_SELECTOR).forEach((btn) => {
            btn.classList.toggle("menu-crossed", isOn);
        });
    };

    /**
     * @returns {void}
     */
    const clearPNums = (): void => {
        reader.querySelectorAll(".reader-paragraph-num").forEach((n) => n.remove());
        reader.style.removeProperty("--reader-para-num-col-width");
        reader.style.removeProperty("--reader-para-num-gap");
    };

    reader.classList.toggle(READER_PARA_NUMS_CLASS, enabled);
    setRCookie(READER_PARA_NUMS_COOKIE, enabled ? "true" : "false");

    syncPNumBtns(enabled, document);

    if (!enabled) {
        clearPNums();
        return;
    }

    renderPNum(document);
}

/**
 * @param {Document} root
 * @returns {void}
 */
function refreshPNum(root: Document = document): void {
    const reader = window.readerRoot;
    if (!reader) return;
    if (!reader.classList.contains(READER_PARA_NUMS_CLASS)) return;

    renderPNum(root);
}

/**
 * @param {Document} root
 * @returns {HTMLElement | null}
 */
function getMidBkm(root: Document = document): HTMLElement | null {
    const bkms = Array.from(root.querySelectorAll<HTMLElement>(".reader-bookmark"));
    if (!bkms.length) return null;

    const midY = window.innerHeight / 2;

    let best: HTMLElement | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const bkm of bkms) {
        const rect = bkm.getBoundingClientRect();
        const bkmMid = rect.top + (rect.height / 2);
        const dist = Math.abs(bkmMid - midY);

        if (dist >= bestDist) continue;

        best = bkm;
        bestDist = dist;
    }

    return best;
}

/**
 * @param {string} bkmId
 * @param {Document} root
 * @returns {void}
 */
function recentreBkm(bkmId: string, root: Document = document): void {
    const bkm = root.getElementById(bkmId) as HTMLElement | null;
    if (!bkm) return;

    const rect = bkm.getBoundingClientRect();
    const top = window.scrollY + rect.top - (window.innerHeight / 2) + (rect.height / 2);

    window.scrollTo({
        top: Math.max(0, top),
        behavior: "auto"
    });
}

/**
 * @returns {void}
 */
function togglePNum(): void {
    const reader = window.readerRoot;
    if (!reader) return;

    const midBkm = getMidBkm(document);
    const midBkmId = midBkm?.id || null;

    const next = !reader.classList.contains(READER_PARA_NUMS_CLASS);
    enablePNum(next);

    if (!midBkmId) return;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            recentreBkm(midBkmId, document);
        });
    });
}

/**
 * @returns {void}
 */
function initPNumCookie(): void {
    const v = getRCookie(READER_PARA_NUMS_COOKIE);
    enablePNum(v === "true");
}

/**
 * @param {Document} doc
 * @param {readonly string[]} aliases
 * @returns {Element[]}
 */
function getElsByAliases(doc: Document, aliases: readonly string[]): Element[] {
    for (const tag of aliases) {
        const found = doc.getElementsByTagName(tag);
        if (found.length > 0) return Array.from(found);
    }
    return [];
}

/**
 * @param {number} chapter
 * @param {number[]} chapters
 * @returns {boolean}
 */
function prevBtnEn(chapter: number, chapters: number[]): boolean {
    const hasCh0 = chapters.includes(0);
    chapter = Number(chapter);
    if (chapter <= 1 && !hasCh0) return false;
    if (chapter <= 0) return false;
    return true;
}

/**
 * @param {Document} root
 * @returns {void}
 */
function updatePrevBtn(root: Document = document): void {
    const chapters = readChCache();
    const enablePrev = prevBtnEn(window.chapter, chapters);

    root.querySelectorAll<HTMLButtonElement>(".btn-prev").forEach((btn) => {
        btn.disabled = !enablePrev;
    });
}

/**
 * @param {Document} _root
 * @returns {void}
 */
function clearBkm(_root?: Document): void {
    void _root;

    const base = getStoryBase();
    if (!base) return;

    const storyKey = mkStoryKey(base);
    localStorage.removeItem(`bookmark_${storyKey}_ch${window.chapter}`);
    showTmpNotice("Bookmark cleared for this chapter.");
}

/**
 * @param {string} msg
 * @param {number} timeout
 * @returns {void}
 */
function showTmpNotice(msg: string, timeout = 1000): void {
    const note = document.createElement("div");
    note.textContent = msg;
    note.style.position = "fixed";
    note.style.top = "50%";
    note.style.left = "50%";
    note.style.transform = "translate(-50%, -50%)";
    note.style.background = "var(--chatroom-bg-colour)";
    note.style.color = "var(--chatroom-text-colour)";
    note.style.padding = "10px 20px";
    note.style.borderRadius = "8px";
    note.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
    note.style.zIndex = "9999";
    document.body.appendChild(note);

    setTimeout(() => {
        note.remove();
    }, timeout);
}

/**
 * @param {Element | null} el
 * @returns {boolean}
 */
function isVis(el: Element | null): boolean {
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
}

/**
 * @param {Document} root
 * @returns {void}
 */
function syncCtrlDock(root: Document = document): void {
    const ctrls = root.querySelector(".reader-controls-top") as HTMLElement | null;
    const spacer = root.getElementById(READER_CTRL_SPACER_ID) as HTMLDivElement | null;
    const marker = root.getElementById(READER_CTRL_FLOAT_MARKER_ID) as HTMLElement | null;
    const bottomCtrls = root.querySelector(".reader-controls-bottom") as HTMLElement | null;
    if (!ctrls || !spacer || !marker) return;

    ctrlMarkerAbove = marker.getBoundingClientRect().bottom <= 0;
    ctrlBottomSeen = isVis(bottomCtrls);

    const bottomRect = bottomCtrls?.getBoundingClientRect() ?? null;
    const viewportPastBottom = bottomRect ? bottomRect.bottom <= 0 : false;

    const detached = ctrlMarkerAbove && !ctrlBottomSeen && !viewportPastBottom;
    const wasDetached = ctrls.classList.contains("is-detached");

    if (detached) {
        const h = Math.ceil(ctrls.getBoundingClientRect().height);
        spacer.style.display = "block";
        spacer.style.height = `${h}px`;
    } else {
        spacer.style.height = "0px";
        spacer.style.display = "none";
    }

    if (wasDetached === detached) return;

    ctrls.classList.toggle("is-detached", detached);
    window.dispatchEvent(
        new CustomEvent("reader:controls-detached", {
            detail: { detached }
        })
    );
}

/**
 * @param {"down" | "up"} mode
 * @param {Document} root
 * @returns {void}
 */
function setTopScrollMode(mode: "down" | "up", root: Document = document): void {
    const btn = root.querySelector(
        ".reader-controls-top .btn-scroll-down, .reader-controls-top .btn-scroll-up"
    ) as HTMLButtonElement | null;

    if (!btn) return;

    const isUp = mode === "up";
    const icon = isUp ? window.buttons.scrollUp.icon : window.buttons.scrollDown.icon;
    const action = isUp ? window.buttons.scrollUp.action : window.buttons.scrollDown.action;

    setButtonIcon(btn, icon);
    btn.title = action;
    btn.setAttribute("aria-label", action);
    btn.classList.toggle("btn-scroll-up", isUp);
    btn.classList.toggle("btn-scroll-down", !isUp);
}

/**
 * @param {Document} root
 * @returns {void}
 */
function syncTopScrollMode(root: Document = document): void {
    const scrollTop = window.scrollY || window.pageYOffset || 0;
    const vh = window.innerHeight;
    const docEl = root.documentElement;
    const body = root.body;
    const scrollH = Math.max(
        docEl.scrollHeight,
        body ? body.scrollHeight : 0
    );

    const distTop = scrollTop;
    const distBottom = Math.max(0, scrollH - (scrollTop + vh));
    const shouldUp = distTop > distBottom;

    setTopScrollMode(shouldUp ? "up" : "down", root);
}

/**
 * @returns {void}
 */
function ctrlDetach(): void {
    const ctrls = document.querySelector(".reader-controls-top") as HTMLElement | null;
    const bottomCtrls = document.querySelector(".reader-controls-bottom") as HTMLElement | null;
    if (!ctrls) return;

    removeExistingById(READER_CTRL_FLOAT_MARKER_ID);
    removeExistingById(READER_CTRL_SPACER_ID);

    if (
        window.__kcReaderCtrlObserver &&
        typeof window.__kcReaderCtrlObserver.disconnect === "function"
    ) {
        window.__kcReaderCtrlObserver.disconnect();
        window.__kcReaderCtrlObserver = null;
    }

    if (ctrlBottomObs) {
        ctrlBottomObs.disconnect();
        ctrlBottomObs = null;
    }

    if (ctrlScrollFn) {
        window.removeEventListener("scroll", ctrlScrollFn);
        ctrlScrollFn = null;
    }

    if (ctrlResizeFn) {
        window.removeEventListener("resize", ctrlResizeFn);
        ctrlResizeFn = null;
    }

    ctrlMarkerAbove = false;
    ctrlBottomSeen = false;

    const spacer = document.createElement("div");
    spacer.id = READER_CTRL_SPACER_ID;
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.display = "none";
    spacer.style.height = "0px";
    spacer.style.margin = "0";
    spacer.style.padding = "0";
    spacer.style.border = "0";
    spacer.style.pointerEvents = "none";

    const marker = document.createElement("div");
    marker.id = READER_CTRL_FLOAT_MARKER_ID;
    marker.setAttribute("aria-hidden", "true");
    marker.style.width = "1px";
    marker.style.height = "1px";
    marker.style.margin = "0";
    marker.style.padding = "0";
    marker.style.border = "0";
    marker.style.opacity = "0";
    marker.style.pointerEvents = "none";

    ctrls.insertAdjacentElement("afterend", spacer);
    spacer.insertAdjacentElement("afterend", marker);

    const markerObs = new IntersectionObserver(
        () => {
            syncCtrlDock(document);
        },
        { threshold: 0 }
    );

    markerObs.observe(marker);
    window.__kcReaderCtrlObserver = markerObs;
    window.readerTopAnchor = marker;

    if (bottomCtrls) {
        ctrlBottomObs = new IntersectionObserver(
            () => {
                syncCtrlDock(document);
            },
            { threshold: 0 }
        );

        ctrlBottomObs.observe(bottomCtrls);
    }

    ctrlScrollFn = (): void => {
        syncTopScrollMode(document);
        syncCtrlDock(document);
    };

    ctrlResizeFn = (): void => {
        syncTopScrollMode(document);
        syncCtrlDock(document);
    };

    window.addEventListener("scroll", ctrlScrollFn, { passive: true });
    window.addEventListener("resize", ctrlResizeFn);

    requestAnimationFrame(() => {
        syncTopScrollMode(document);
        syncCtrlDock(document);
    });
}

/**
 * @returns {void}
 */
function injectNav(): void {
    const TOP_ID = "kc-reader-controls-top";
    const BOTTOM_ID = "kc-reader-controls-bottom";

    removeExistingById(TOP_ID);
    removeExistingById(BOTTOM_ID);

    const navTop = document.createElement("div");
    navTop.id = TOP_ID;
    navTop.classList.add("reader-controls-top");
    navTop.appendChild(render2Frag(<ReaderCtrls />));

    const navBottom = document.createElement("div");
    navBottom.id = BOTTOM_ID;
    navBottom.classList.add("reader-controls-bottom");
    navBottom.appendChild(render2Frag(<ReaderCtrls />));

    navBottom.querySelectorAll<HTMLInputElement>
        (".chapter-input, .chapter-display").forEach((input) => {
            input.id = input.id.replace("-top", "-bottom");
        });

    const scrollBtn = navBottom.querySelector(".btn-scroll-down") as HTMLButtonElement | null;
    if (scrollBtn) {
        setButtonIcon(scrollBtn, window.buttons.scrollUp.icon);
        scrollBtn.title = window.buttons.scrollUp.action;
        scrollBtn.setAttribute("aria-label", window.buttons.scrollUp.action);
        scrollBtn.classList.remove("btn-scroll-down");
        scrollBtn.classList.add("btn-scroll-up");
    }

    if (!window.readerRoot) return;

    window.readerRoot.insertAdjacentElement("beforebegin", navTop);
    window.readerRoot.insertAdjacentElement("afterend", navBottom);
}

/**
 * @param {number} delta
 * @returns {void}
 */
function updateFont(delta = 0): void {
    const cur = parseFloat(getRCookie("fontSize") || "") || 1;
    const next = Math.max(0.7, Math.min(2.0, cur + delta));
    setRCookie("fontSize", next.toFixed(2));
    window.readerRoot!.style.setProperty("font-size", `${next}em`);
    refreshTatFont();
}

/**
 * @returns {void}
 */
function showNavInfo(): void {
    infoModal.open();
}

/**
 * @param {Document} root
 * @returns {void}
 */
function bindNavEvents(root: Document = document): void {
    const chapters = readChCache();

    root.querySelectorAll<HTMLButtonElement>(".btn-toggle-paragraph-numbers").forEach((btn) => {
        btn.onclick = () => togglePNum();
    });

    root.querySelectorAll<HTMLButtonElement>(".btn-prev").forEach((btn) => (btn.onclick = () => {
        if (!prevBtnEn(window.chapter, chapters)) {
            btn.disabled = true;
            return;
        }
        jumpTo(window.chapter - 1);
    }));

    root.querySelectorAll<HTMLButtonElement>(".btn-next").forEach((btn) => (btn.onclick = () => {
        if (window.chapter < window.lastKnownChapter) jumpTo(window.chapter + 1);
    }));

    root.querySelectorAll<HTMLButtonElement>(".btn-jump").forEach((btn) => {
        btn.onclick = () => {
            const input = btn.parentElement!.querySelector(".chapter-input") as HTMLInputElement | null;
            if (!input) return;

            const val = parseInt(input.value, 10);
            if (!isNaN(val) && val >= 0 && val <= window.lastKnownChapter) {
                jumpTo(val);
            }
        };
    });

    root.querySelectorAll<HTMLInputElement>(".chapter-input").forEach((input) => {
        input.value = String(window.chapter);
        input.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key !== "Enter") return;

            const target = e.target as HTMLInputElement;
            const val = parseInt(target.value, 10);
            if (val >= 0 && val <= window.lastKnownChapter) jumpTo(val);
        });
    });

    root.querySelectorAll<HTMLButtonElement>(".btn-rescan").forEach((btn) => (btn.onclick = async () => {
        localStorage.removeItem(window.chapterCacheKey);
        const chapters = await discoverChs();
        window.lastKnownChapter = chapters.length > 0 ? Math.max(...chapters) : 0;
        updateNav();
    }));

    root.querySelectorAll<HTMLButtonElement>(".btn-clear-bookmark").forEach((btn) => {
        btn.onclick = () => clearBkm(root);
    });

    root.querySelectorAll<HTMLButtonElement>(".font-increase").forEach((btn) => (btn.onclick = () => updateFont(0.1)));
    root.querySelectorAll<HTMLButtonElement>(".font-decrease").forEach((btn) => (btn.onclick = () => updateFont(-0.1)));
    root.querySelectorAll<HTMLButtonElement>(".font-reset").forEach((btn) => (btn.onclick = () => updateFont(0)));
    root.querySelectorAll<HTMLButtonElement>(".btn-info").forEach((btn) => (btn.onclick = showNavInfo));
}

// /**
//  * @param {Document} root
//  * @returns {Promise<void>}
//  */
// async function populatePicker(root: Document = document): Promise<void> {
//     if (!window.storyPickerRoot) return;
//     try {
//         const res = await fetch(`${config.storiesIndexURL}`);
//         if (!res.ok) throw new Error("No stories found");
//         const storiesUnknown: unknown = await res.json();

//         if (!helpers.isRecord(storiesUnknown)) throw new Error("Invalid stories index format");
//         const stories = storiesUnknown as StoriesIndex;

//         const select = root.createElement("select");
//         select.className = "story-selector";
//         select.setAttribute("id", "reader-story-selector");
//         select.innerHTML = render2Mkup(<option value="">Select a story...</option>);

//         Object.keys(stories).forEach((name) => {
//             const opt = root.createElement("option");
//             opt.value = name;
//             opt.textContent = name;
//             if (name === window.storyName) opt.selected = true;
//             select.appendChild(opt);
//         });

//         select.onchange = () => {
//             if (select.value) {
//                 window.location.search = `?story=${encodeURIComponent(select.value)}&chapter=1`;
//             }
//         };

//         window.storyPickerRoot.appendChild(select);
//     } catch (err) {
//         console.warn("No stories found or failed to load stories.json", err);
//     }
// }

/**
 * @param {Document} root
 * @returns {Promise<void>}
 */
async function populatePicker(root: Document = document): Promise<void> {
    const picker = window.storyPickerRoot;
    if (!picker) return;

    const makePickerHint = (): HTMLDivElement => {
        const hint = root.createElement("div");

        hint.className = "story-dropdown__hint";
        hint.textContent = "Pick a story...";
        hint.setAttribute("aria-hidden", "true");

        return hint;
    };

    const makeSizerItem = (text: string, className = ""): HTMLDivElement => {
        const item = root.createElement("div");

        item.className = ["story-dropdown__sizer-item", className]
            .filter(Boolean)
            .join(" ");

        item.textContent = text;

        return item;
    };

    try {
        const res = await fetch(`${config.storiesIndexURL}`);
        if (!res.ok) throw new Error("No stories found");

        const storiesUnknown: unknown = await res.json();

        if (!helpers.isRecord(storiesUnknown)) {
            throw new Error("Invalid stories index format");
        }

        const stories = storiesUnknown as StoriesIndex;
        const storyNames = Object.keys(stories);

        const makeStoryHref = (storyName: string): string =>
            `${window.location.pathname}?story=${encodeURIComponent(storyName)}&chapter=1`;

        const makeStoryItem = (storyName: string): HTMLAnchorElement => {
            const item = root.createElement("a");

            item.className = "story-dropdown__item";
            item.href = makeStoryHref(storyName);
            item.textContent = storyName;

            if (storyName === window.storyName) {
                item.classList.add("is-current");
                item.setAttribute("aria-current", "page");
            }

            return item;
        };

        const dropdown = root.createElement("div");
        dropdown.className = "story-dropdown";

        const button = root.createElement("button");
        button.id = "reader-story-selector";
        button.type = "button";
        button.className = "story-dropdown__button";
        button.textContent = window.storyName || "Pick a story...";
        button.setAttribute("aria-haspopup", "true");

        const sizer = root.createElement("div");
        sizer.className = "story-dropdown__sizer";
        sizer.setAttribute("aria-hidden", "true");

        sizer.appendChild(makeSizerItem("Pick a story...", "story-dropdown__sizer-item--hint"));

        storyNames
            .map((storyName) => makeSizerItem(storyName))
            .forEach((item) => sizer.appendChild(item));

        const menu = root.createElement("div");
        menu.className = "story-dropdown__content";

        menu.appendChild(makePickerHint());

        storyNames
            .map(makeStoryItem)
            .forEach((item) => menu.appendChild(item));

        dropdown.append(button, sizer, menu);
        picker.replaceChildren(dropdown);
    } catch (err) {
        console.warn("No stories found or failed to load stories.json", err);
    }
}

/**
 * @param {string | null} storyName
 * @returns {string | null}
 */
function getStoryBase(storyName: string | null = null): string | null {
    const name = storyName || window.storyName || (window.storyPath ? window.storyPath.split("/").pop() : null);
    if (!name) return null;
    return `${config.storiesURL}/${encodeURIComponent(name)}`;
}

const media = new MediaStyler();

/**
 * @param {number} n
 * @returns {Promise<void>}
 */
async function loadCh(n: number): Promise<void> {
    window.chapter = n;
    try {
        const base = getStoryBase();
        if (!base) throw new Error("No story selected.");

        const res = await fetch(`${base}/chapt${n}.xml`);
        if (!res.ok) throw new Error("Chapter not found");
        const xmlText = await res.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");

        const readerNodes = getReaderNds(xmlDoc);

        let htmlContent = buildHtml(readerNodes);

        htmlContent = await media.replaceEmails(htmlContent);
        htmlContent = await media.replaceSmsMessages(htmlContent);
        htmlContent = await replaceTategaki(htmlContent);
        htmlContent = await replaceSsmlAuthoring(htmlContent);
        htmlContent = await media.replaceImageTags(htmlContent);
        htmlContent = await media.replaceTooltips(htmlContent);
        htmlContent = await injectBookmarksIntoHTML(htmlContent, base, window.chapter);

        window.readerRoot!.innerHTML = htmlContent;
        await media.replaceSVGs(window.readerRoot!);

        requestAnimationFrame(() => {
            refreshPNum(document);
        });

        saveBkms(document);

        requestAnimationFrame(() => {
            restoreBkm(base, window.chapter);
            syncTopScrollMode(document);
            syncCtrlDock(document);
        });

        activateImageNavigation(document);

        updateNav(document);
        bindNavEvents(document);
        initLangObs(document);
        setRCookie(`bookmark_${mkStoryKey(base)}`, String(window.chapter));
        window.scrollTo(0, 0);
    } catch (err) {
        window.readerRoot!.innerHTML = render2Mkup(<MissingCh chapter={n} />);
        console.error(err);
    }
}

/**
 * @param {string} storyName
 * @returns {Promise<ChaptersIndexResult>}
 */
export async function getChapters(storyName: string): Promise<ChaptersIndexResult> {
    const indexRes = await fetch(`${config.storiesIndexURL}`);
    if (!indexRes.ok) throw new Error("Failed to load stories index");

    const indexUnknown: unknown = await indexRes.json();
    if (!helpers.isRecord(indexUnknown)) throw new Error("Invalid stories index format");
    const index = indexUnknown as StoriesIndex;

    const files = index[storyName];
    if (!Array.isArray(files)) return { chapters: [], urls: [] };

    const base = getStoryBase(storyName);

    const chapters = files
        .map((f) => {
            if (typeof f !== "string") return null;
            const m = /^chapt(\d+)\.xml$/i.exec(f);
            return m ? Number(m[1]) : null;
        })
        .filter((n): n is number => Number.isInteger(n))
        .sort((a, b) => a - b);

    const urls = chapters.map((n) => `${String(base)}/chapt${n}.xml`);

    return { chapters, urls };
}

/**
 * @param {string | null} storyName
 * @returns {Promise<number[]>}
 */
async function discoverChs(storyName: string | null = null): Promise<number[]> {
    const { chapters } = await getChapters(storyName || String(window.storyName));

    const last = chapters.length > 0 ? Math.max(...chapters) : 0;
    window.lastKnownChapter = last;

    localStorage.setItem(window.chapterCacheKey, JSON.stringify(chapters));
    return chapters;
}

/**
 * @param {number} n
 * @returns {void}
 */
function jumpTo(n: number): void {
    const curStoryPath =
        decodeURIComponent(window.storyPath as unknown as string) ||
        localStorage.getItem("currentStoryPath");

    if (!curStoryPath) {
        alert("No story selected. Please select a story first.");
        return;
    }

    localStorage.setItem("currentStoryPath", curStoryPath);

    const encodedPath = encodeURIComponent(curStoryPath);
    window.location.search = `?story=${encodedPath}&chapter=${n}`;
}

/**
 * @param {Document} root
 * @returns {void}
 */
function refreshTatFont(root: Document = document): void {
    const px = parseFloat(getComputedStyle(window.readerRoot as unknown as Element).fontSize);
    root
        .querySelectorAll<SVGTextElement>(".tategaki-container svg text")
        .forEach((t) => t.setAttribute("font-size", String(px)));
}

/**
 * @param {Document} root
 * @returns {void}
 */
function updateNav(root: Document = document): void {
    root.querySelectorAll<HTMLInputElement>(".chapter-display").forEach((el) => (el.value = String(window.chapter)));
    root.querySelectorAll<HTMLButtonElement>(".chapter-end").forEach((btn) => (btn.textContent = String(window.lastKnownChapter)));

    root.querySelectorAll<HTMLButtonElement>(".btn-next").forEach((btn) => {
        btn.disabled = window.chapter === window.lastKnownChapter;
    });

    updatePrevBtn(root);
    syncTopScrollMode(root);
}

/**
 * @returns {Promise<void>}
 */
async function initReader(): Promise<void> {
    await populatePicker(document);
    if (!window.storyPath) return;

    injectNav();
    ctrlDetach();
    initPNumCookie();

    const chapters = await discoverChs();
    window.lastKnownChapter = chapters.length > 0 ? Math.max(...chapters) : 0;

    if (!params.get("chapter")) {
        const bkm = parseInt(
            getRCookie(
                `bookmark_${encodeURIComponent(window.storyPath as unknown as string)}`
            ) as unknown as string
        );

        window.chapter =
            bkm && chapters.includes(bkm)
                ? bkm
                : 1;
    }

    await loadCh(window.chapter);

    const initFont = parseFloat(getRCookie("fontSize") || "") || 1;
    window.readerRoot!.style.setProperty("font-size", `${initFont}em`);
    syncTopScrollMode(document);
}

/**
 * @param {Document} root
 * @returns {void}
 */
export function activateImageNavigation(root: Document = document): void {
    root.querySelectorAll(".image-nav").forEach((nav) => nav.remove());

    root.querySelectorAll(".chapter-image-container").forEach((containerEl) => {
        const container = containerEl as HTMLElement;
        const image = container.querySelector(".chapter-image");

        if (!(image instanceof HTMLImageElement)) return;

        const navOverlay = document.createElement("div");
        navOverlay.classList.add("image-nav");
        navOverlay.appendChild(render2Frag(<ImgNav />));

        container.appendChild(navOverlay);

        let posX = 50;
        let posY = 50;
        const step = 5;

        /**
         * @returns {void}
         */
        const updatePos = (): void => {
            image.style.transformOrigin = `${posX}% ${posY}%`;
        };

        /**
         * @returns {void}
         */
        const syncNavOverlay = (): void => {
            navOverlay.classList.toggle("active", image.classList.contains("active"));
        };

        /**
         * @param {() => void} onHold
         * @returns {void}
         */
        const startHold = (onHold: () => void): void => {
            const interval = window.setInterval(onHold, 100);

            const stopHold = (): void => {
                clearInterval(interval);
                root.removeEventListener("mouseup", stopHold);
                root.removeEventListener("touchend", stopHold);
                root.removeEventListener("mouseleave", stopHold);
                root.removeEventListener("touchcancel", stopHold);
            };

            root.addEventListener("mouseup", stopHold);
            root.addEventListener("touchend", stopHold);
            root.addEventListener("mouseleave", stopHold);
            root.addEventListener("touchcancel", stopHold);
            onHold();
        };

        (navOverlay.querySelector(".btn-up") as HTMLButtonElement).addEventListener("mousedown", () => {
            startHold(() => {
                posY = Math.max(0, posY - step);
                updatePos();
            });
        });

        (navOverlay.querySelector(".btn-down") as HTMLButtonElement).addEventListener("mousedown", () => {
            startHold(() => {
                posY = Math.min(100, posY + step);
                updatePos();
            });
        });

        (navOverlay.querySelector(".btn-left") as HTMLButtonElement).addEventListener("mousedown", () => {
            startHold(() => {
                posX = Math.max(0, posX - step);
                updatePos();
            });
        });

        (navOverlay.querySelector(".btn-right") as HTMLButtonElement).addEventListener("mousedown", () => {
            startHold(() => {
                posX = Math.min(100, posX + step);
                updatePos();
            });
        });

        (navOverlay.querySelector(".btn-up") as HTMLButtonElement).addEventListener("touchstart", () => {
            startHold(() => {
                posY = Math.max(0, posY - step);
                updatePos();
            });
        });

        (navOverlay.querySelector(".btn-down") as HTMLButtonElement).addEventListener("touchstart", () => {
            startHold(() => {
                posY = Math.min(100, posY + step);
                updatePos();
            });
        });

        (navOverlay.querySelector(".btn-left") as HTMLButtonElement).addEventListener("touchstart", () => {
            startHold(() => {
                posX = Math.max(0, posX - step);
                updatePos();
            });
        });

        (navOverlay.querySelector(".btn-right") as HTMLButtonElement).addEventListener("touchstart", () => {
            startHold(() => {
                posX = Math.min(100, posX + step);
                updatePos();
            });
        });

        (navOverlay.querySelector(".btn-center") as HTMLButtonElement).addEventListener("click", () => {
            posX = 50;
            posY = 50;
            updatePos();
        });

        /**
         * @returns {void}
         */
        const toggleZoom = (): void => {
            image.classList.toggle("active");
            syncNavOverlay();
        };

        image.addEventListener("click", toggleZoom);

        container.addEventListener("mouseenter", () => {
            if (!image.classList.contains("active")) return;
            navOverlay.classList.add("active");
        });

        container.addEventListener("mouseleave", () => {
            navOverlay.classList.remove("active");
        });

        enableImgSwipe(
            image,
            () => posX,
            () => posY,
            (x, y) => {
                posX = x;
                posY = y;
                updatePos();
            }
        );
    });

    /**
     * @param {HTMLImageElement} image
     * @param {() => number} getX
     * @param {() => number} getY
     * @param {(x: number, y: number) => void} setPos
     * @returns {void}
     */
    function enableImgSwipe(
        image: HTMLImageElement,
        getX: () => number,
        getY: () => number,
        setPos: (x: number, y: number) => void
    ): void {
        let startX = 0;
        let startY = 0;
        let lastX = 0;
        let lastY = 0;
        let isSwiping = false;

        image.addEventListener(
            "touchstart",
            (e: TouchEvent) => {
                if (!image.classList.contains("active")) return;
                if (e.touches.length === 1) {
                    isSwiping = true;
                    startX = lastX = e.touches[0].clientX;
                    startY = lastY = e.touches[0].clientY;
                }
            },
            { passive: true }
        );

        image.addEventListener(
            "touchmove",
            (e: TouchEvent) => {
                if (!isSwiping || e.touches.length !== 1) return;

                const curX = e.touches[0].clientX;
                const curY = e.touches[0].clientY;

                const deltaX = curX - lastX;
                const deltaY = curY - lastY;
                lastX = curX;
                lastY = curY;

                const pxToPercent = 300;
                let nextX = getX() - (deltaX / pxToPercent) * 100;
                let nextY = getY() - (deltaY / pxToPercent) * 100;

                nextX = Math.min(100, Math.max(0, nextX));
                nextY = Math.min(100, Math.max(0, nextY));
                setPos(nextX, nextY);
            },
            { passive: true }
        );

        image.addEventListener("touchend", () => {
            isSwiping = false;
        });

        image.addEventListener("touchcancel", () => {
            isSwiping = false;
        });
    }
}

/**
 * @param {string} storyBase
 * @returns {string}
 */
function mkStoryKey(storyBase: string): string {
    return encodeURIComponent(storyBase).replace(/\W/g, "_");
}

/**
 * @param {string} htmlContent
 * @param {string} storyBase
 * @param {number} chapter
 * @returns {Promise<string>}
 */
export async function injectBookmarksIntoHTML(
    htmlContent: string,
    storyBase: string,
    chapter: number
): Promise<string> {
    const storyKey = mkStoryKey(storyBase);
    const bkmId = localStorage.getItem(`bookmark_${storyKey}_ch${chapter}`);
    let counter = 0;

    /**
     * @param {string} innerHtml
     * @returns {boolean}
     */
    const isMeaningful = (innerHtml: string): boolean => {
        if (/<(img|svg|video|audio|iframe)\b/i.test(innerHtml)) return true;

        const txt = innerHtml
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;|&#160;/gi, "")
            .replace(/\s+/g, "")
            .trim();

        return txt.length > 0;
    };

    return htmlContent.replace(
        /<(p|h1|h2|blockquote)(.*?)>([\s\S]*?)<\/\1>/g,
        (match: string, tag: string, attrs: string, inner: string) => {
            if (!isMeaningful(inner)) return match;

            const id = `bm-${storyKey}-ch${chapter}-${counter}`;
            counter += 1;

            const emoji =
                id === bkmId
                    ? `${render2Mkup(<span className="bookmark-emoji" aria-label="bookmark">🔖</span>)} `
                    : "";

            return wrapBkm(
                id,
                `<${tag}${attrs}>${emoji}${inner}</${tag}>`
            );
        }
    );
}

/**
 * @param {Document} root
 * @returns {void}
 */
function saveBkms(root: Document = document): void {
    const bkms = Array.from(root.querySelectorAll<HTMLElement>(".reader-bookmark"));
    const obs = new IntersectionObserver(
        (entries: IntersectionObserverEntry[]) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) return;

                const target = entry.target as HTMLElement;
                const id = target.id;
                const m = id.match(/^bm-([^]+)-ch(\d+)-\d+$/);
                if (!m) return;

                const storyKey = m[1];
                const chapter = m[2];
                const key = `bookmark_${storyKey}_ch${chapter}`;
                const nextIx = bkms.findIndex((el) => el.id === id);

                if (nextIx === bkms.length - 1) {
                    localStorage.removeItem(key);
                    return;
                }

                const savedId = localStorage.getItem(key);
                const savedIx = bkms.findIndex((el) => el.id === savedId);
                if (nextIx <= savedIx) return;

                localStorage.setItem(key, id);
            }
        },
        {
            threshold: 0.6
        }
    );

    setTimeout(() => {
        bkms.forEach((el) => obs.observe(el));
    }, 1000);
}

/**
 * @param {string} storyBase
 * @param {number} chapter
 * @returns {void}
 */
function restoreBkm(storyBase: string, chapter: number): void {
    const storyKey = mkStoryKey(storyBase);
    const key = `bookmark_${storyKey}_ch${chapter}`;
    const id = localStorage.getItem(key);
    if (!id) return;

    const bkm = document.getElementById(id);
    if (!bkm) return;

    const nextBkm = bkm.nextElementSibling as Element | null;
    if (nextBkm) {
        const scrollY = window.scrollY + nextBkm.getBoundingClientRect().top;
        window.scrollTo({ top: scrollY, behavior: "smooth" });
    }

    bkm.classList.add("reader-highlight");

    setTimeout(() => {
        bkm.classList.add("fade-out");
        bkm.addEventListener(
            "transitionend",
            () => {
                bkm.classList.remove("reader-highlight", "fade-out");
            },
            { once: true }
        );
    }, 5000);
}

/**
 * @returns {void}
 */
function restoreLastRead(): void {
    const story = window.params.get("story");
    const chapter = window.chapter;
    const lastKey = "lastStoryRead";

    if (story && chapter !== null) {
        localStorage.setItem(lastKey, JSON.stringify({ story, chapter }));
        return;
    }

    const last = localStorage.getItem(lastKey);
    if (!last) return;

    try {
        const parsed: unknown = JSON.parse(last);
        if (!helpers.isRecord(parsed)) return;

        const storyVal = parsed["story"];
        const chapterVal = parsed["chapter"];

        if (typeof storyVal !== "string") return;
        if (chapterVal === null) return;

        const encoded = `?story=${encodeURIComponent(storyVal)}&chapter=${String(chapterVal)}`;
        window.location.search = encoded;
    } catch (e) {
        console.warn("Failed to parse lastStoryRead:", e);
    }
}

/**
 * @returns {void}
 */
function bootReader(): void {
    document.addEventListener("DOMContentLoaded", () => {
        restoreLastRead();
        void initReader();
        activateImageNavigation(document);
        media.bindEmailActions();
    });

    document.addEventListener("click", (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (!target) return;

        const button = target.closest("button");
        if (!(button instanceof HTMLButtonElement)) return;

        const bkms = Array.from(document.querySelectorAll(".reader-bookmark"));
        if (!bkms.length) return;

        const scrollDown = button.classList.contains("btn-scroll-down");
        const bottomCtrls = scrollDown
            ? document.querySelector(".reader-controls-bottom") as Element | null
            : null;

        if (scrollDown && !bottomCtrls) return;

        if (scrollDown && bottomCtrls) {
            bottomCtrls.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
            return;
        }

        if (button.classList.contains("btn-scroll-up")) {
            const anchor = window.readerTopAnchor || document.body.firstElementChild || document.body;

            (anchor as Element).scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        }
    });
}

/**
 * @param {Document} root
 * @returns {Promise<void>}
 */
export async function setupReader(root: Document = document): Promise<void> {
    bindNavEvents(root);
    activateImageNavigation(root);
    refreshTatFont(root);
    saveBkms(root);
    initLangObs(root);
    ctrlDetach();
    syncTopScrollMode(root);
}

/**
 * @returns {Promise<boolean>}
 */
export async function readerIsFullyLoaded(): Promise<boolean> {
    /**
     * @param {(...args: unknown[]) => void} cb
     * @returns {Promise<unknown>}
     */
    const rafP = async (
        cb: (...args: unknown[]) => void
    ): Promise<unknown> => {
        const done = await new Promise<unknown>((resolve) => {
            requestAnimationFrame(() => {
                cb(resolve);
            });
        });
        return done;
    };

    return new Promise<boolean>((resolve) => {
        /**
         * @param {...unknown[]} _args
         * @returns {Promise<void>}
         */
        const checkReady = async (..._args: unknown[]): Promise<void> => {
            void _args;

            if (
                document.readyState === "complete" &&
                document.querySelectorAll(".reader-bookmark").length > 0
            ) {
                resolve(true);
            }

            await rafP(checkReady);
        };

        void checkReady(resolve);
    });
}

/**
 * @returns {{ storyPath: string | null; chapter: number }}
 */
export function getParams(): { storyPath: string | null; chapter: number } {
    return {
        storyPath: window.storyPath,
        chapter: window.chapter
    };
}

/**
 * @param {string} bookmarkId
 * @returns {void}
 */
export function forceBookmark(bookmarkId: string): void {
    const base = getStoryBase();
    if (!base) return;

    const storyKey = mkStoryKey(base);
    const key = `bookmark_${storyKey}_ch${window.chapter}`;

    const target = document.getElementById(bookmarkId);
    if (!target) {
        console.warn(`No element found with ID "${bookmarkId}".`);
        return;
    }

    localStorage.setItem(key, bookmarkId);
}

/**
 * @param {Document} xmlDoc
 * @param {RenderXmlDocOpts} opts
 * @returns {Promise<void>}
 */
async function renderXmlDoc(xmlDoc: Document, opts: RenderXmlDocOpts): Promise<void> {
    const readerNodes = getReaderNds(xmlDoc);

    let htmlContent: string = buildHtml(readerNodes);

    htmlContent = await media.replaceEmails(htmlContent);
    htmlContent = await media.replaceSmsMessages(htmlContent);
    htmlContent = await replaceTategaki(htmlContent);
    htmlContent = await replaceSsmlAuthoring(htmlContent);
    htmlContent = await media.replaceImageTags(htmlContent);

    if (opts.withBookmarks && opts.storyBase && Number.isInteger(opts.chapter)) {
        htmlContent = await injectBookmarksIntoHTML(
            htmlContent,
            opts.storyBase,
            opts.chapter as number
        );
    }

    window.readerRoot!.innerHTML = htmlContent;
    await media.replaceSVGs(window.readerRoot!);

    requestAnimationFrame(() => {
        refreshPNum(document);
    });

    saveBkms(document);
    activateImageNavigation(document);
    bindNavEvents(document);
    initLangObs(document);
    refreshTatFont(document);
    syncTopScrollMode(document);
    syncCtrlDock(document);

    if (opts.withBookmarks && opts.storyBase && Number.isInteger(opts.chapter)) {
        requestAnimationFrame(() => {
            restoreBkm(opts.storyBase as string, opts.chapter as number);
            syncTopScrollMode(document);
            syncCtrlDock(document);
        });
    }
}

/**
 * @param {string} xmlText
 * @returns {Document}
 */
function parseXml(xmlText: string): Document {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "application/xml");

    const parseError = xmlDoc.getElementsByTagName("parsererror")[0];
    if (parseError) {
        const msg = parseError.textContent || "Invalid XML";
        throw new Error(msg);
    }

    return xmlDoc;
}

/**
 * @param {string} accept
 * @returns {Promise<File | null>}
 */
function pickFile(accept: string): Promise<File | null> {
    return new Promise<File | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.style.display = "none";

        input.addEventListener(
            "change",
            () => {
                const file = input.files && input.files[0] ? input.files[0] : null;
                input.remove();
                resolve(file);
            },
            { once: true }
        );

        document.body.appendChild(input);
        input.click();
    });
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileTxt(file: File): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsText(file);
    });
}

window.debug = window.debug || {};

window.debug.pickXml = async function (): Promise<void> {
    const file = await pickFile(".xml,application/xml,text/xml");
    if (!file) return;

    const xmlText = await readFileTxt(file);
    const xmlDoc = parseXml(xmlText);

    await renderXmlDoc(xmlDoc, {
        withBookmarks: false,
        storyBase: null,
        chapter: null
    });
};

window.debug.renderXmlText = async function (xmlText: string): Promise<void> {
    const xmlDoc = parseXml(xmlText);

    await renderXmlDoc(xmlDoc, {
        withBookmarks: false,
        storyBase: null,
        chapter: null
    });
};

window.debug.renderXmlFile = async function (file: File): Promise<void> {
    const xmlText = await readFileTxt(file);
    const xmlDoc = parseXml(xmlText);

    await renderXmlDoc(xmlDoc, {
        withBookmarks: false,
        storyBase: null,
        chapter: null
    });
};

if (/\/reader(?:\.html)?(?:\/|$)/.test(window.location.pathname)) bootReader();

export const readerModeFocus = "#reader";

export const readerModeKeep: readonly string[] = [
    "#reader",
    "#story-picker",
    "#kc-reader-controls-top",
    "#kc-reader-controls-bottom"
];