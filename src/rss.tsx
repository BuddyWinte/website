import React from "react";
import { Clusteriser } from "./clusterise.ts";
import * as cfg from "./config.ts";
import { render2Frag, render2Mkup } from "./reactHelpers.tsx";
import { CalCtrl, type CalHasArg, type CalSel } from "./calendar.tsx";
import * as helpers from "./helpers.ts";
import * as icons from "./icons.tsx";
import { atchRssComments, initRssComments, mkRssCommentSlug } from "./rssComments.ts";
import {
    findByPstRef,
    fmtDt,
    getReqJumpId,
    getReqPstRef,
    mkPstDomRef,
    mkPstSegShareUrl,
    mkPstShareUrl,
    mkPstShortId,
    mkPstSlug,
    mkPsts,
    mkPstsRefs,
    mkPstsSel,
    prsRss
} from "./rss/postModel.ts";
import {
    isBlogPth,
    isDirectRssPth,
    isResourcePth,
    pstsForCurPage
} from "./rss/routing.ts";
import {
    fmtCodeLang,
    getCodeLang,
    normCodeLangKey
} from "./rss/codeLanguage.ts";
import {
    applyBlockquoteAccents,
    CODE_DIRECTIVE_COMMENT_PREFIX as RSS_CODE_DIRECTIVE_COMMENT_PREFIX,
    getExternalCodeDirective,
    prepareRssMarkdown
} from "./rss/markdown.ts";
import { wireExternalCodeBlocks } from "./rss/externalCode.ts";
import {
    applSegShares,
    moveCodeSegShareToFrame
} from "./rss/segments.ts";

declare global {
    namespace JSX {
        interface Element extends React.ReactElement { }
        interface IntrinsicElements {
            [elemName: string]: Record<string, unknown>;
        }
    }
}

declare const marked: {
    parse: (markdown: string) => string;
};

import type {
    AthFilterCfg,
    AthMenuRs,
    AthOpt,
    CodeGroupActiveOptions,
    CodeVariant,
    FiltRs,
    FiltSumKnd,
    FiltSumPill,
    HljsApi,
    PillSnap,
    Pst,
    RssItm,
    SegPoint,
    SegRevealReq,
    SegTapSnap,
    WrapRs
} from "./rss/types.ts";

declare const hljs: HljsApi | undefined;

const RSS_RESOURCE_TITLE_PREFIX = "${resource}";
const RSS_CODE_PREF_STORAGE_KEY = "kittycrow:rss-code-language-preferences:v1";
const RSS_SEG_DOUBLE_TAP_MS = 420;
const RSS_SEG_POINTER_REVEAL_MS = 1800;
const RSS_SEG_SHARE_SEL = "[data-rss-seg-id]";
const RSS_SEG_SHARE_BTN_SEL = "[data-rss-seg-share-btn]";
const RSS_JUMP_RETRY_FRAMES = 18;
const RSS_JUMP_SETTLE_MS = 520;

const RSS_FILT_CHILD_PILL_SEL = [
    ".cal .cal__selPill[data-cal-lvl][data-cal-val]",
    ".rss-author-filter__btn[data-rss-author][data-on='1']"
].join(",");

const RSS_FILT_SUM_PILL_SEL =
    ".rss-filters__summaryPill[data-rss-filter-summary-key]";

const authorFilterCfg: AthFilterCfg = {
    defaultUnselect: new Set<string>([
        "autoKitty"
    ])
};

let blogClstr: Clusteriser | null = null;
let calCtl: CalCtrl | null = null;
let allPsts: readonly Pst[] = [];
let authorOff: Set<string> = new Set<string>(authorFilterCfg.defaultUnselect);
let pendingRevealPostRefs: readonly string[] = [];
let pendingRevealJumpId: string | null = null;
let athMenuOpen = false;
let rssCodeGroupIx = 0;
let activeSegShare: HTMLElement | null = null;
let lastSegTap: SegTapSnap | null = null;
let pendingSegReveal: SegRevealReq | null = null;
let segRevealTimer: number | null = null;
let segDismissWired = false;

let curCalSel: CalSel = {
    yrs: new Set<number>(),
    mos: new Set<number>(),
    dys: new Set<number>()
};

/**
 * Existing selected date state.
 * @param {CalSel} sel
 * @returns {boolean}
 */
function hasCalSel(sel: CalSel): boolean {
    return sel.yrs.size > 0 || sel.mos.size > 0 || sel.dys.size > 0;
}

/**
 * Default calendar selection is current year, or latest post year.
 * @param {readonly Pst[]} psts
 * @returns {CalSel}
 */
function mkDefaultYearSel(psts: readonly Pst[]): CalSel {
    const nowYr = new Date().getFullYear();
    const yrs = Array.from(
        new Set<number>(
            psts
                .map((pst) => pst.yr)
                .filter((yr) => Number.isFinite(yr) && yr > 0)
        )
    ).sort((left, right) => right - left);

    if (yrs.length === 0) {
        return mkCalSel([], [], []);
    }

    return mkCalSel([yrs.includes(nowYr) ? nowYr : yrs[0]], [], []);
}

/**
 * Picks requested-post selection when present, otherwise the default year.
 * @param {readonly Pst[]} psts
 * @returns {CalSel}
 */
function mkInitialCalSel(psts: readonly Pst[]): CalSel {
    return hasCalSel(curCalSel) ? curCalSel : mkDefaultYearSel(psts);
}

/**
 * layout nudge, kinda blunt.
 * @returns {void}
 */
function aplyBlogLyt(): void {
    const sels = [".frame", ".frame-content", "#main-content", ".blog-wrapper", ".blog-container"];

    sels.forEach((sel) => {
        const el = document.querySelector(sel);
        if (!(el instanceof HTMLElement)) return;
        if (el.classList.contains("window-frame")) return;

        el.style.height = "auto";
        el.style.maxHeight = "none";
        el.style.overflow = "visible";
    });
}

/**
 * Prepares and renders RSS markdown.
 * @param {string} markdown
 * @param {string} seed
 * @returns {string}
 */
function rndrRssMD(markdown: string, seed: string): string {
    const prepared = prepareRssMarkdown(markdown);
    const html = applyBlockquoteAccents(marked.parse(prepared));

    return applSegShares(html, seed);
}

/**
 * Checks a parsed value is a simple string map.
 * @param {unknown} value
 * @returns {value is Record<string, string>}
 */
function isStringRecord(value: unknown): value is Record<string, string> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    return Object.values(value).every((item: unknown) => typeof item === "string");
}

/**
 * Safely returns localStorage.
 * @returns {Storage | null}
 */
function getCodePrefsStorage(): Storage | null {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

/**
 * Reads saved code language preferences.
 * @returns {Record<string, string>}
 */
function rdCodePrefs(): Record<string, string> {
    const storage = getCodePrefsStorage();

    if (!storage) {
        return {};
    }

    try {
        const raw = storage.getItem(RSS_CODE_PREF_STORAGE_KEY);

        if (!raw) {
            return {};
        }

        const parsed: unknown = JSON.parse(raw);

        return isStringRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Saves a preferred language for one exact language set.
 * @param {string} groupKey
 * @param {string} langKey
 * @returns {void}
 */
function saveCodePref(groupKey: string, langKey: string): void {
    const storage = getCodePrefsStorage();

    if (!storage) {
        return;
    }

    const prefs = rdCodePrefs();

    prefs[groupKey] = langKey;

    try {
        storage.setItem(RSS_CODE_PREF_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        return;
    }
}

/**
 * Reads a preferred language for one exact language set.
 * @param {string} groupKey
 * @returns {string | null}
 */
function rdCodePref(groupKey: string): string | null {
    const pref = rdCodePrefs()[groupKey];

    return pref && pref.trim().length > 0 ? pref : null;
}

/**
 * Builds the stable key for one language switcher.
 * @param {readonly CodeVariant[]} variants
 * @returns {string}
 */
function mkCodeGroupPrefKey(variants: readonly CodeVariant[]): string {
    return Array.from(new Set<string>(variants.map((variant) => variant.langKey)))
        .sort((left, right) => left.localeCompare(right))
        .join("|");
}

/**
 * Picks the saved variant index, if this exact language set has one.
 * @param {readonly CodeVariant[]} variants
 * @param {string} groupKey
 * @returns {number}
 */
function getPrefCodeVariantIndex(variants: readonly CodeVariant[], groupKey: string): number {
    const preferredLang = rdCodePref(groupKey);

    if (!preferredLang) {
        return 0;
    }

    const index = variants.findIndex((variant) => variant.langKey === preferredLang);

    return index >= 0 ? index : 0;
}

/**
 * Finds the selected variant lang key from a frame.
 * @param {HTMLDivElement} frame
 * @param {number} activeIndex
 * @returns {string | null}
 */
function getCodeChoiceLangKey(frame: HTMLDivElement, activeIndex: number): string | null {
    const input = frame.querySelector<HTMLInputElement>(
        `[data-rss-code-choice][data-rss-code-choice-index="${activeIndex}"]`
    );

    return input?.dataset.rssCodeChoiceLang ?? null;
}

/**
 * Finds the first variant index matching a language key.
 * @param {HTMLDivElement} frame
 * @param {string} langKey
 * @returns {number | null}
 */
function findCodeChoiceIndex(frame: HTMLDivElement, langKey: string): number | null {
    const inputs = Array.from(frame.querySelectorAll<HTMLInputElement>("[data-rss-code-choice]"));
    const match = inputs.find((input) => input.dataset.rssCodeChoiceLang === langKey);
    const index = Number(match?.dataset.rssCodeChoiceIndex ?? "");

    return Number.isNaN(index) ? null : index;
}

/**
 * Updates surrounding post layout after code height changes.
 * @param {HTMLDivElement} frame
 * @returns {void}
 */
function qCodeGroupLayout(frame: HTMLDivElement): void {
    const content = frame.closest(".rss-post-content");

    window.requestAnimationFrame(() => {
        if (content instanceof HTMLElement) {
            calcExpHgt(content);
        }

        adjScrHgt();
    });
}

/**
 * Selects the preferred language in all matching groups.
 * @param {HTMLDivElement} sourceFrame
 * @param {string} groupKey
 * @param {string} langKey
 * @returns {void}
 */
function syncCodeGroupPeers(sourceFrame: HTMLDivElement, groupKey: string, langKey: string): void {
    Array.from(document.querySelectorAll<HTMLDivElement>(".rss-code-frame[data-rss-code-group='1']")).forEach((frame) => {
        if (frame === sourceFrame) return;
        if (frame.dataset.rssCodeGroupPrefKey !== groupKey) return;

        const index = findCodeChoiceIndex(frame, langKey);

        if (index === null) {
            return;
        }

        setCodeGroupActive(frame, index, {
            savePreference: false,
            syncPeers: false
        });
    });
}

/**
 * Tiny text bit.
 * @param {string} lang
 * @returns {HTMLSpanElement}
 */
function mkLangTxt(lang: string): HTMLSpanElement {
    const text = document.createElement("span");

    text.className = "rss-code-lang__text";
    text.textContent = `\u00A0${fmtCodeLang(lang)}`;

    return text;
}

/**
 * Resets lang label, prob overkill.
 * @param {HTMLSpanElement} label
 * @param {string} lang
 * @returns {void}
 */
function setLangLblTxt(label: HTMLSpanElement, lang: string): void {
    const text = label.querySelector(".rss-code-lang__text");

    if (text instanceof HTMLSpanElement) {
        text.textContent = `\u00A0${fmtCodeLang(lang)}`;
        return;
    }

    label.replaceChildren(
        render2Frag(icons.MakeCodeIcon()),
        mkLangTxt(lang)
    );
}

/**
 * Back to copy state.
 * @param {HTMLButtonElement} btn
 * @returns {void}
 */
function setCpyIco(btn: HTMLButtonElement): void {
    btn.replaceChildren(render2Frag(icons.MakeCopyIcon()));
    btn.classList.remove("rss-code-copy--done", "rss-code-copy--failed");
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.title = "Copy code";
}

/**
 * Happy icon.
 * @param {HTMLButtonElement} btn
 * @returns {void}
 */
function setOkIco(btn: HTMLButtonElement): void {
    btn.replaceChildren(render2Frag(icons.MakeCheckIcon()));
    btn.classList.add("rss-code-copy--done");
    btn.classList.remove("rss-code-copy--failed");
    btn.setAttribute("aria-label", "Copied to clipboard");
    btn.title = "Copied";
}

/**
 * Sad copy icon thing.
 * @param {HTMLButtonElement} btn
 * @returns {void}
 */
function setBadIco(btn: HTMLButtonElement): void {
    btn.replaceChildren(render2Frag(icons.MakeCopyIcon()));
    btn.classList.add("rss-code-copy--failed");
    btn.classList.remove("rss-code-copy--done");
    btn.setAttribute("aria-label", "Copy failed");
    btn.title = "Copy failed";
}

/**
 * Clipboard, hopefully.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function cpyTxt(text: string): Promise<boolean> {
    if (!navigator.clipboard) return false;

    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Little copied flash.
 * @param {HTMLButtonElement} btn
 * @param {boolean} ok
 * @returns {void}
 */
function setCpyDone(btn: HTMLButtonElement, ok: boolean): void {
    if (ok) {
        setOkIco(btn);
    } else {
        setBadIco(btn);
    }

    window.setTimeout(() => {
        btn.disabled = false;
        setCpyIco(btn);
    }, 1200);
}

/**
 * Button for stealing code from a dynamic source.
 * @param {() => string} readText
 * @returns {HTMLButtonElement}
 */
function mkDynCpyBtn(readText: () => string): HTMLButtonElement {
    const btn = document.createElement("button");

    btn.type = "button";
    btn.className = "rss-code-copy";
    setCpyIco(btn);

    btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        btn.disabled = true;

        void cpyTxt(readText()).then((ok) => {
            setCpyDone(btn, ok);
        });
    });

    return btn;
}

/**
 * Button for stealing code.
 * @param {HTMLElement} code
 * @returns {HTMLButtonElement}
 */
function mkCpyBtn(code: HTMLElement): HTMLButtonElement {
    return mkDynCpyBtn(() => code.textContent ?? "");
}

/**
 * Lang badge thing.
 * @param {string} lang
 * @returns {HTMLSpanElement}
 */
function mkLangLbl(lang: string): HTMLSpanElement {
    const label = document.createElement("span");

    label.className = "rss-code-lang";
    setLangLblTxt(label, lang);

    return label;
}

/**
 * Top bit for code blocks.
 * @param {HTMLElement} code
 * @returns {HTMLDivElement}
 */
function mkCodeBar(code: HTMLElement): HTMLDivElement {
    const toolbar = document.createElement("div");

    toolbar.className = "rss-code-toolbar";
    toolbar.append(mkLangLbl(getCodeLang(code)), mkCpyBtn(code));

    return toolbar;
}

/**
 * Reads the code element inside a pre.
 * @param {HTMLPreElement} pre
 * @returns {HTMLElement | null}
 */
function getPreCode(pre: HTMLPreElement): HTMLElement | null {
    const code = pre.querySelector("code");

    return code instanceof HTMLElement ? code : null;
}

/**
 * Turns one pre block into a switchable variant.
 * @param {HTMLPreElement} pre
 * @returns {CodeVariant | null}
 */
function mkCodeVariant(pre: HTMLPreElement): CodeVariant | null {
    const code = getPreCode(pre);

    if (!code) {
        return null;
    }

    const lang = getCodeLang(code);

    return {
        pre,
        code,
        lang,
        langKey: normCodeLangKey(lang),
        label: fmtCodeLang(lang)
    };
}

/**
 * Blank text and comments may sit between adjacent markdown code blocks.
 * @param {ChildNode} node
 * @returns {boolean}
 */
function isCodeRunGap(node: ChildNode): boolean {
    if (node.nodeType === Node.COMMENT_NODE) {
        return true;
    }

    if (node.nodeType !== Node.TEXT_NODE) {
        return false;
    }

    return (node.textContent ?? "").trim().length === 0;
}

/**
 * Collects adjacent code block runs from one parent.
 * @param {ParentNode} parent
 * @returns {HTMLPreElement[][]}
 */
function colCodeRunsFromParent(parent: ParentNode): HTMLPreElement[][] {
    const runs: HTMLPreElement[][] = [];
    let run: HTMLPreElement[] = [];

    const flush = (): void => {
        if (run.length > 1) {
            runs.push(run);
        }

        run = [];
    };

    Array.from(parent.childNodes).forEach((node) => {
        if (isCodeRunGap(node)) {
            return;
        }

        if (node instanceof HTMLPreElement && getPreCode(node) !== null && !node.closest(".rss-code-frame")) {
            run.push(node);
            return;
        }

        flush();
    });

    flush();

    return runs;
}

/**
 * Collects adjacent code block runs from a post.
 * @param {HTMLElement} root
 * @returns {HTMLPreElement[][]}
 */
function colCodeRuns(root: HTMLElement): HTMLPreElement[][] {
    const parents = new Set<ParentNode>();

    Array.from(root.querySelectorAll<HTMLPreElement>("pre")).forEach((pre) => {
        if (pre.closest(".rss-code-frame")) {
            return;
        }

        if (!pre.parentNode) {
            return;
        }

        parents.add(pre.parentNode);
    });

    return Array.from(parents).flatMap((parent) => colCodeRunsFromParent(parent));
}

/**
 * Gets the active code block inside a grouped code frame.
 * @param {HTMLDivElement} frame
 * @returns {HTMLElement | null}
 */
function getActCodeVariant(frame: HTMLDivElement): HTMLElement | null {
    const active = frame.querySelector(".rss-code-variant.is-active code");

    return active instanceof HTMLElement ? active : null;
}

/**
 * Syncs the visual state of the language radio buttons.
 * @param {HTMLDivElement} frame
 * @param {number} activeIndex
 * @returns {void}
 */
function syncCodeChoiceState(frame: HTMLDivElement, activeIndex: number): void {
    Array.from(frame.querySelectorAll<HTMLLabelElement>(".rss-code-choice")).forEach((label) => {
        const input = label.querySelector<HTMLInputElement>("[data-rss-code-choice]");
        const index = Number(input?.dataset.rssCodeChoiceIndex ?? "");

        if (Number.isNaN(index)) {
            return;
        }

        const active = index === activeIndex;

        label.dataset.on = active ? "1" : "0";

        if (input) {
            input.checked = active;
        }
    });
}

/**
 * Selects one code variant in a grouped code block.
 * @param {HTMLDivElement} frame
 * @param {number} activeIndex
 * @param {CodeGroupActiveOptions} options
 * @returns {void}
 */
function setCodeGroupActive(
    frame: HTMLDivElement,
    activeIndex: number,
    options: CodeGroupActiveOptions = {}
): void {
    const panes = Array.from(frame.querySelectorAll<HTMLDivElement>(".rss-code-variant"));
    const activeLangKey = getCodeChoiceLangKey(frame, activeIndex);
    const groupKey = frame.dataset.rssCodeGroupPrefKey ?? "";

    if (!activeLangKey) {
        return;
    }

    panes.forEach((pane) => {
        const index = Number(pane.dataset.rssCodeVariantIndex ?? "");
        const active = index === activeIndex;
        const code = pane.querySelector("code");

        pane.hidden = !active;
        pane.classList.toggle("is-active", active);
        pane.setAttribute("aria-hidden", active ? "false" : "true");

        if (active && code instanceof HTMLElement) {
            frame.dataset.language = getCodeLang(code);
            frame.dataset.rssCodeActiveLang = activeLangKey;
            hglCode(code);
        }
    });

    frame.dataset.rssCodeActiveIndex = String(activeIndex);
    syncCodeChoiceState(frame, activeIndex);
    qCodeGroupLayout(frame);

    if (options.savePreference && groupKey) {
        saveCodePref(groupKey, activeLangKey);
    }

    if (options.syncPeers && groupKey) {
        syncCodeGroupPeers(frame, groupKey, activeLangKey);
    }
}

/**
 * Creates one radio choice for a grouped code block.
 * @param {string} groupName
 * @param {CodeVariant} variant
 * @param {number} index
 * @returns {HTMLLabelElement}
 */
function mkCodeChoice(
    groupName: string,
    variant: CodeVariant,
    index: number
): HTMLLabelElement {
    const label = document.createElement("label");
    const input = document.createElement("input");
    const dot = document.createElement("span");
    const text = document.createElement("span");

    label.className = "rss-code-choice";
    label.dataset.on = index === 0 ? "1" : "0";
    label.title = `Show ${variant.label}`;

    input.type = "radio";
    input.name = groupName;
    input.value = String(index);
    input.checked = index === 0;
    input.className = "rss-code-choice__input";
    input.dataset.rssCodeChoice = "1";
    input.dataset.rssCodeChoiceIndex = String(index);
    input.dataset.rssCodeChoiceLang = variant.langKey;
    input.setAttribute("aria-label", variant.label);

    dot.className = "rss-code-choice__dot";
    dot.setAttribute("aria-hidden", "true");

    text.className = "rss-code-choice__text";
    text.textContent = variant.label;

    input.addEventListener("change", () => {
        const frame = input.closest(".rss-code-frame");

        if (!(frame instanceof HTMLDivElement)) {
            return;
        }

        setCodeGroupActive(frame, index, {
            savePreference: true,
            syncPeers: true
        });
    });

    label.append(input, dot, text);

    return label;
}

/**
 * Builds the language switcher for a grouped code block.
 * @param {string} groupName
 * @param {readonly CodeVariant[]} variants
 * @returns {HTMLDivElement}
 */
function mkCodeSwitch(
    groupName: string,
    variants: readonly CodeVariant[]
): HTMLDivElement {
    const root = document.createElement("div");
    const icon = document.createElement("span");
    const choices = document.createElement("div");

    root.className = "rss-code-lang rss-code-lang--switch";

    icon.className = "rss-code-lang__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.append(render2Frag(icons.MakeCodeIcon()));

    choices.className = "rss-code-choice-list";
    choices.setAttribute("role", "radiogroup");
    choices.setAttribute("aria-label", "Code language");

    variants.forEach((variant, index) => {
        choices.appendChild(mkCodeChoice(groupName, variant, index));
    });

    root.append(icon, choices);

    return root;
}

/**
 * Builds the toolbar for a grouped code block.
 * @param {HTMLDivElement} frame
 * @param {readonly CodeVariant[]} variants
 * @returns {HTMLDivElement}
 */
function mkCodeGroupBar(
    frame: HTMLDivElement,
    variants: readonly CodeVariant[]
): HTMLDivElement {
    const toolbar = document.createElement("div");
    const groupName = `rss-code-group-${rssCodeGroupIx}`;

    toolbar.className = "rss-code-toolbar rss-code-toolbar--group";
    toolbar.append(
        mkCodeSwitch(groupName, variants),
        mkDynCpyBtn(() => getActCodeVariant(frame)?.textContent ?? "")
    );

    return toolbar;
}

/**
 * Creates one switchable code variant pane.
 * @param {CodeVariant} variant
 * @param {number} index
 * @returns {HTMLDivElement}
 */
function mkCodeVariantPane(variant: CodeVariant, index: number): HTMLDivElement {
    const pane = document.createElement("div");

    pane.className = "rss-code-variant";
    pane.dataset.rssCodeVariantIndex = String(index);
    pane.dataset.rssCodeVariantLang = variant.langKey;
    pane.setAttribute("aria-hidden", index === 0 ? "false" : "true");
    pane.hidden = index !== 0;
    pane.appendChild(variant.pre);

    if (index === 0) {
        pane.classList.add("is-active");
    }

    return pane;
}

/**
 * Turns adjacent markdown code blocks into one switchable code frame.
 * @param {readonly HTMLPreElement[]} run
 * @returns {void}
 */
function mkCodeGroupFrame(run: readonly HTMLPreElement[]): void {
    const parent = run[0]?.parentElement;

    if (!parent) {
        return;
    }

    const variants = run
        .map((pre) => mkCodeVariant(pre))
        .filter((variant): variant is CodeVariant => variant !== null);

    if (variants.length < 2) {
        return;
    }

    rssCodeGroupIx += 1;

    const groupKey = mkCodeGroupPrefKey(variants);
    const preferredIndex = getPrefCodeVariantIndex(variants, groupKey);
    const frame = document.createElement("div");
    const deck = document.createElement("div");

    frame.className = "rss-code-frame rss-code-frame--group";
    frame.dataset.rssCodeGroup = "1";
    frame.dataset.rssCodeGroupPrefKey = groupKey;
    frame.dataset.language = variants[preferredIndex]?.lang ?? variants[0].lang;

    moveCodeSegShareToFrame(frame, variants.map((variant) => variant.pre));

    deck.className = "rss-code-variants";

    parent.insertBefore(frame, run[0]);

    variants.forEach((variant, index) => {
        deck.appendChild(mkCodeVariantPane(variant, index));
    });

    frame.append(mkCodeGroupBar(frame, variants), deck);

    setCodeGroupActive(frame, preferredIndex, {
        savePreference: false,
        syncPeers: false
    });

    stopPstEvts(frame);

    variants.forEach((variant) => {
        hglCode(variant.code);
    });
}

/**
 * Groups adjacent markdown code blocks before single-code toolbar wiring runs.
 * @param {HTMLElement} root
 * @returns {void}
 */
function grpAdjacentCodeBlocks(root: HTMLElement): void {
    colCodeRuns(root).forEach((run) => {
        mkCodeGroupFrame(run);
    });
}

/**
 * Fixes old bar text.
 * @param {HTMLDivElement} frame
 * @param {HTMLElement} code
 * @returns {void}
 */
function updCodeBar(frame: HTMLDivElement, code: HTMLElement): void {
    const label = frame.querySelector(".rss-code-lang");
    if (!(label instanceof HTMLSpanElement)) return;

    setLangLblTxt(label, getCodeLang(code));
}

/**
 * Do not let post eat this stuff.
 * @param {HTMLElement} root
 * @returns {void}
 */
function stopPstEvts(root: HTMLElement): void {
    if (root.dataset.rssStopPropagationWired === "1") return;

    root.dataset.rssStopPropagationWired = "1";

    const stop = (ev: Event): void => {
        ev.stopPropagation();
    };

    root.addEventListener("click", stop);
    root.addEventListener("mousedown", stop);
    root.addEventListener("pointerdown", stop);
    root.addEventListener("touchstart", stop);
    root.addEventListener("keydown", stop);
}

/**
 * Wraps code if needed.
 * @param {HTMLPreElement} pre
 * @param {HTMLElement} code
 * @returns {void}
 */
function ensCodeTls(pre: HTMLPreElement, code: HTMLElement): void {
    const parent = pre.parentElement;
    if (!parent) return;

    const currentFrame = pre.closest(".rss-code-frame");
    if (currentFrame instanceof HTMLDivElement) {
        updCodeBar(currentFrame, code);
        stopPstEvts(currentFrame);
        return;
    }

    const frame = document.createElement("div");

    frame.className = "rss-code-frame";
    frame.dataset.language = getCodeLang(code);

    moveCodeSegShareToFrame(frame, [pre]);

    parent.insertBefore(frame, pre);
    frame.append(mkCodeBar(code), pre);

    stopPstEvts(frame);
}

/**
 * Highlight once, maybe.
 * @param {HTMLElement} code
 * @returns {void}
 */
function hglCode(code: HTMLElement): void {
    if (code.dataset.rssHighlighted === "1") return;
    if (typeof hljs === "undefined") return;

    code.dataset.rssHighlighted = "1";
    hljs.highlightElement(code);
}

/**
 * Post code bits.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function hglPstCode(pstDiv: HTMLElement): void {
    wireExternalCodeBlocks(pstDiv, {
        getPreCode,
        highlightCode: hglCode,
        updateCodeBar: updCodeBar,
        queueCodeGroupLayout: qCodeGroupLayout,
        queuePostHeight: qPstHgt
    });
    grpAdjacentCodeBlocks(pstDiv);

    Array.from(pstDiv.querySelectorAll<HTMLElement>("pre code")).forEach((code) => {
        if (code.closest("[data-rss-code-group='1']")) {
            hglCode(code);
            return;
        }

        const pre = code.closest("pre");
        if (!(pre instanceof HTMLPreElement)) return;

        ensCodeTls(pre, code);
        hglCode(code);
    });
}

/**
 * Render helper for shared collapse wiring.
 * @param {boolean} open
 * @returns {DocumentFragment}
 */
function renderTglIco(open: boolean): DocumentFragment {
    return render2Frag(open ? icons.MakeDecreaseFontIcon() : icons.MakeIncreaseFontIcon());
}

/**
 * Plus/minus thing, yep.
 * @param {HTMLButtonElement} btn
 * @param {boolean} opn
 * @returns {void}
 */
function setFiltIco(btn: HTMLButtonElement, opn: boolean): void {
    btn.replaceChildren(renderTglIco(opn));
    btn.setAttribute("aria-expanded", opn ? "true" : "false");
    btn.setAttribute("aria-label", opn ? "Collapse filters" : "Expand filters");
    btn.title = opn ? "Collapse filters" : "Expand filters";
}

/**
 * Same toy, different cave.
 * @param {HTMLButtonElement} btn
 * @param {boolean} opn
 * @returns {void}
 */
function setAthIco(btn: HTMLButtonElement, opn: boolean): void {
    btn.replaceChildren(renderTglIco(opn));
    btn.setAttribute("aria-expanded", opn ? "true" : "false");
    btn.setAttribute("aria-label", opn ? "Collapse author filters" : "Expand author filters");
    btn.title = opn ? "Collapse author filters" : "Expand author filters";
}

/**
 * Silly round filter btn.
 * @returns {HTMLButtonElement}
 */
function mkFiltBtn(): HTMLButtonElement {
    const btn = document.createElement("button");

    btn.type = "button";
    btn.className = "rss-filters__toggle kc-round-icon-btn kc-click-header__control";
    btn.dataset.rssFiltersToggle = "1";
    btn.setAttribute("aria-controls", "kc-blog-filters-body");
    setFiltIco(btn, false);

    return btn;
}

/**
 * Clear all thing.
 * @returns {HTMLButtonElement}
 */
function mkFiltClearBtn(): HTMLButtonElement {
    const btn = document.createElement("button");

    btn.type = "button";
    btn.className = "rss-filters__clear kc-click-header__control";
    btn.dataset.rssFiltersClearAll = "1";
    btn.textContent = "Clear all";
    btn.hidden = true;
    btn.setAttribute("aria-hidden", "true");
    btn.title = "Clear all filters";

    return btn;
}

/**
 * Tiny month.
 * @param {number} mo
 * @returns {string}
 */
function fmtSumMo(mo: number): string {
    return new Date(2000, mo - 1, 1).toLocaleString("en-GB", { month: "short" });
}

/**
 * Date key thing.
 * @param {"yr" | "mo" | "dy"} lvl
 * @param {number} val
 * @returns {string}
 */
function mkDtPillKey(lvl: "yr" | "mo" | "dy", val: number): string {
    return `date:${lvl}:${val}`;
}

/**
 * Author key thing.
 * @param {string} ath
 * @returns {string}
 */
function mkAthPillKey(ath: string): string {
    return `author:${ath}`;
}

/**
 * Flattens the sets.
 * @param {CalSel} sel
 * @returns {Readonly<{ yrs: number[]; mos: number[]; dys: number[] }>}
 */
function flatSel(sel: CalSel): Readonly<{ yrs: number[]; mos: number[]; dys: number[] }> {
    return {
        yrs: Array.from(sel.yrs),
        mos: Array.from(sel.mos),
        dys: Array.from(sel.dys)
    };
}

/**
 * Date set thing.
 * @param {Iterable<number>} yrs
 * @param {Iterable<number>} mos
 * @param {Iterable<number>} dys
 * @returns {CalSel}
 */
function mkCalSel(
    yrs: Iterable<number>,
    mos: Iterable<number>,
    dys: Iterable<number>
): CalSel {
    return {
        yrs: new Set<number>(yrs),
        mos: new Set<number>(mos),
        dys: new Set<number>(dys)
    };
}

/**
 * Authors on, for the tiny row.
 * @returns {readonly string[]}
 */
function selAthsForSum(): readonly string[] {
    return mkAthOpts(datePsts(allPsts, curCalSel), authorOff)
        .filter((opt) => opt.on)
        .map((opt) => opt.ath);
}

/**
 * Tiny row pills.
 * @returns {readonly FiltSumPill[]}
 */
function mkFiltSumPills(): readonly FiltSumPill[] {
    const yrs = Array.from(curCalSel.yrs).sort((a, b) => b - a);
    const mos = Array.from(curCalSel.mos).sort((a, b) => a - b);
    const dys = Array.from(curCalSel.dys).sort((a, b) => a - b);
    const aths = selAthsForSum();

    return [
        ...yrs.map((yr) => ({
            key: mkDtPillKey("yr", yr),
            kind: "date" as const,
            lvl: "yr" as const,
            val: yr,
            label: String(yr)
        })),
        ...mos.map((mo) => ({
            key: mkDtPillKey("mo", mo),
            kind: "date" as const,
            lvl: "mo" as const,
            val: mo,
            label: fmtSumMo(mo)
        })),
        ...dys.map((dy) => ({
            key: mkDtPillKey("dy", dy),
            kind: "date" as const,
            lvl: "dy" as const,
            val: dy,
            label: String(dy)
        })),
        ...aths.map((ath) => ({
            key: mkAthPillKey(ath),
            kind: "author" as const,
            author: ath,
            label: ath
        }))
    ];
}

/**
 * Tiny row btn.
 * @param {FiltSumPill} pill
 * @returns {HTMLButtonElement}
 */
function mkFiltSumPillBtn(pill: FiltSumPill): HTMLButtonElement {
    const btn = document.createElement("button");
    const value = document.createElement("span");

    btn.type = "button";
    btn.className = "cal__selPill rss-filters__summaryPill kc-click-header__control";
    btn.dataset.rssFilterSummaryPill = "1";
    btn.dataset.rssFilterSummaryKey = pill.key;
    btn.dataset.rssFilterSummaryKind = pill.kind;
    btn.title = pill.kind === "author"
        ? `Remove author ${pill.label}`
        : `Remove ${pill.label}`;

    if (pill.kind === "date" && pill.lvl && pill.val !== undefined) {
        btn.dataset.calLvl = pill.lvl;
        btn.dataset.calVal = String(pill.val);
    }

    if (pill.kind === "author" && pill.author) {
        btn.dataset.rssFilterSummaryAuthor = pill.author;
    }

    value.className = "cal__selV";
    value.textContent = pill.label;

    btn.appendChild(value);

    return btn;
}

/**
 * Summary cave.
 * @param {HTMLDivElement} shell
 * @returns {HTMLDivElement | null}
 */
function getFiltSumHost(shell: HTMLDivElement): HTMLDivElement | null {
    const host = shell.querySelector("[data-rss-filters-summary]");

    return host instanceof HTMLDivElement ? host : null;
}

/**
 * Clear btn lookup.
 * @param {HTMLDivElement} shell
 * @returns {HTMLButtonElement | null}
 */
function getFiltClrBtn(shell: HTMLDivElement): HTMLButtonElement | null {
    const btn = shell.querySelector("[data-rss-filters-clear-all]");

    return btn instanceof HTMLButtonElement ? btn : null;
}

/**
 * Summary row sync.
 * @param {HTMLDivElement} shell
 * @param {boolean} collapsed
 * @param {boolean} vis
 * @returns {void}
 */
function syncFiltSum(
    shell: HTMLDivElement,
    collapsed: boolean = shell.dataset.rssFiltersOpen !== "1",
    vis: boolean = true
): void {
    const host = getFiltSumHost(shell);
    const clearBtn = getFiltClrBtn(shell);

    if (!host || !clearBtn) return;

    const pills = collapsed ? mkFiltSumPills() : [];
    const hasPills = pills.length > 0;
    const pending = hasPills && !vis;

    host.replaceChildren(...pills.map((pill) => mkFiltSumPillBtn(pill)));
    host.hidden = !hasPills;
    host.setAttribute("aria-hidden", hasPills && vis ? "false" : "true");

    clearBtn.hidden = !hasPills;
    clearBtn.disabled = pending;
    clearBtn.setAttribute("aria-hidden", hasPills && vis ? "false" : "true");

    shell.dataset.rssFiltersHasSummary = hasPills ? "1" : "0";
    shell.dataset.rssFiltersSummaryPending = pending ? "1" : "0";
}

/**
 * Current summary sync.
 * @returns {void}
 */
function syncCurFiltSum(): void {
    const shell = document.getElementById("kc-blog-filters");

    if (!(shell instanceof HTMLDivElement)) return;

    syncFiltSum(shell);
}

/**
 * Show the hidden row.
 * @param {HTMLDivElement} shell
 * @returns {void}
 */
function rvlFiltSum(shell: HTMLDivElement): void {
    const host = getFiltSumHost(shell);
    const clearBtn = getFiltClrBtn(shell);
    const hasPills = shell.dataset.rssFiltersHasSummary === "1";

    shell.dataset.rssFiltersSummaryPending = "0";

    if (!host || !clearBtn || !hasPills) return;

    host.setAttribute("aria-hidden", "false");
    clearBtn.disabled = false;
    clearBtn.setAttribute("aria-hidden", "false");
}

/**
 * Fly key, ish.
 * @param {HTMLElement} el
 * @returns {string | null}
 */
function getPillFlyKey(el: HTMLElement): string | null {
    const sumKey = el.dataset.rssFilterSummaryKey;
    if (sumKey) return sumKey;

    const ath = el.dataset.rssAuthor;
    if (ath) return mkAthPillKey(ath);

    const lvl = el.dataset.calLvl as "yr" | "mo" | "dy" | undefined;
    const rawVal = el.dataset.calVal ?? "";
    const val = Number(rawVal);

    if (!lvl || Number.isNaN(val)) return null;

    return mkDtPillKey(lvl, val);
}

/**
 * Pill spots.
 * @param {ParentNode} root
 * @param {string} sel
 * @returns {Map<string, PillSnap>}
 */
function colPillRects(root: ParentNode, sel: string): Map<string, PillSnap> {
    const snaps = new Map<string, PillSnap>();

    Array.from(root.querySelectorAll<HTMLElement>(sel)).forEach((el) => {
        const key = getPillFlyKey(el);
        if (!key || snaps.has(key)) return;

        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        snaps.set(key, {
            key,
            rect,
            el
        });
    });

    return snaps;
}

/**
 * Css clock thing.
 * @param {string} raw
 * @param {number} fallback
 * @returns {number}
 */
function cssMs(raw: string, fallback: number): number {
    const value = raw.trim();

    if (value.endsWith("ms")) {
        const ms = Number.parseFloat(value);
        return Number.isFinite(ms) ? ms : fallback;
    }

    if (value.endsWith("s")) {
        const sec = Number.parseFloat(value);
        return Number.isFinite(sec) ? sec * 1000 : fallback;
    }

    return fallback;
}

/**
 * Flight timeout.
 * @returns {number}
 */
function pillFlyMs(): number {
    const styles = window.getComputedStyle(document.documentElement);
    const duration = styles.getPropertyValue("--kc-pill-migrate-duration");

    return cssMs(duration, 620) + 160;
}

/**
 * Little flying ghosts.
 * @param {ReadonlyMap<string, PillSnap>} from
 * @param {ReadonlyMap<string, PillSnap>} to
 * @returns {Promise<void>}
 */
async function flyPills(
    from: ReadonlyMap<string, PillSnap>,
    to: ReadonlyMap<string, PillSnap>
): Promise<void> {
    const flights: Promise<void>[] = [];
    const timeoutMs = pillFlyMs();

    from.forEach((snap, key) => {
        const target = to.get(key);
        if (!target) return;

        const ghost = target.el.cloneNode(true);
        if (!(ghost instanceof HTMLElement)) return;

        ghost.classList.add("kc-pill-migrate-fly");
        ghost.removeAttribute("id");

        ghost.style.left = `${snap.rect.left}px`;
        ghost.style.top = `${snap.rect.top}px`;
        ghost.style.width = `${snap.rect.width}px`;
        ghost.style.height = `${snap.rect.height}px`;
        ghost.style.setProperty("--kc-pill-fly-x", `${target.rect.left - snap.rect.left}px`);
        ghost.style.setProperty("--kc-pill-fly-y", `${target.rect.top - snap.rect.top}px`);

        const flight = new Promise<void>((resolve) => {
            let done = false;

            const finish = (): void => {
                if (done) return;

                done = true;
                window.clearTimeout(timer);
                ghost.remove();
                resolve();
            };

            const timer = window.setTimeout(finish, timeoutMs);

            ghost.addEventListener("animationend", finish, { once: true });
            ghost.addEventListener("animationcancel", finish, { once: true });

            document.body.appendChild(ghost);
        });

        flights.push(flight);
    });

    return Promise.all(flights).then(() => undefined);
}

/**
 * Drops a date pill.
 * @param {"yr" | "mo" | "dy"} lvl
 * @param {number} val
 * @returns {void}
 */
function rmSumDtPill(lvl: "yr" | "mo" | "dy", val: number): void {
    const cur = flatSel(curCalSel);
    const next = {
        yrs: lvl === "yr" ? cur.yrs.filter((yr) => yr !== val) : cur.yrs,
        mos: lvl === "mo" ? cur.mos.filter((mo) => mo !== val) : cur.mos,
        dys: lvl === "dy" ? cur.dys.filter((dy) => dy !== val) : cur.dys
    };

    if (calCtl) {
        calCtl.setSel(next);
        syncCurFiltSum();
        return;
    }

    curCalSel = mkCalSel(next.yrs, next.mos, next.dys);
    repaintFiltersAndBlog();
}

/**
 * Repaint the filter mess.
 * @returns {void}
 */
function repaintFiltersAndBlog(): void {
    const rs = ensBlogWrap();
    const authorSlot = document.getElementById("kc-blog-author-filter");

    if (authorSlot instanceof HTMLDivElement) {
        rndAthFilt(authorSlot, allPsts, curCalSel);
    }

    if (rs?.box) {
        rndBlog(rs.box, allPsts, curCalSel, authorOff);
    }

    syncCurFiltSum();
    afterDrawerMove();
}

/**
 * Summary pill click.
 * @param {HTMLElement} pill
 * @returns {void}
 */
function hdlSumPillClick(pill: HTMLElement): void {
    const kind = pill.dataset.rssFilterSummaryKind as FiltSumKnd | undefined;

    const ath = pill.dataset.rssFilterSummaryAuthor;
    if (kind === "author" && !ath) return;

    if (kind === "author") {
        authorOff.add(ath as string);
        repaintFiltersAndBlog();
        return;
    }

    if (kind !== "date") return;

    const lvl = pill.dataset.calLvl as "yr" | "mo" | "dy" | undefined;
    const val = Number(pill.dataset.calVal ?? "");

    if (!lvl || Number.isNaN(val)) return;

    rmSumDtPill(lvl, val);
}

/**
 * Nukes the tiny row.
 * @returns {void}
 */
function clrAllSumFilt(): void {
    authorOff = new Set<string>(pstAths(allPsts));

    if (calCtl) {
        calCtl.setSel({
            yrs: [],
            mos: [],
            dys: []
        });
        syncCurFiltSum();
        return;
    }

    curCalSel = mkCalSel([], [], []);
    repaintFiltersAndBlog();
}

/**
 * Tiny shell lookup.
 * @param {HTMLDivElement} shell
 * @returns {FiltRs | null}
 */
function getFiltRs(shell: HTMLDivElement): FiltRs | null {
    const body = shell.querySelector(".rss-filters__body");
    const btn = shell.querySelector("[data-rss-filters-toggle]");
    const hdr = shell.querySelector("[data-rss-filters-header]");

    if (!(body instanceof HTMLDivElement)) return null;
    if (!(btn instanceof HTMLButtonElement)) return null;
    if (!(hdr instanceof HTMLElement)) return null;

    return {
        shell,
        body,
        btn,
        hdr
    };
}

/**
 * Tiny author lookup, because yes.
 * @param {HTMLElement} root
 * @returns {AthMenuRs | null}
 */
function getAthRs(root: HTMLElement): AthMenuRs | null {
    const body = root.querySelector(".rss-author-filter__body");
    const btn = root.querySelector("[data-rss-author-menu-tgl]");
    const hdr = root.querySelector("[data-rss-author-menu-hdr]");

    if (!(body instanceof HTMLDivElement)) return null;
    if (!(btn instanceof HTMLButtonElement)) return null;
    if (!(hdr instanceof HTMLElement)) return null;

    return {
        root,
        body,
        btn,
        hdr
    };
}

/**
 * Layout bump after drawers move.
 * @returns {void}
 */
function afterDrawerMove(): void {
    window.requestAnimationFrame(() => {
        aplyBlogLyt();
        adjScrHgt();
    });
}

/**
 * Opens the filter cave, or shuts it.
 * @param {HTMLDivElement} shell
 * @param {boolean} opn
 * @returns {void}
 */
function setFiltOpn(shell: HTMLDivElement, opn: boolean): void {
    const rs = getFiltRs(shell);
    if (!rs) return;
    if (rs.shell.dataset.rssFiltersMigrating === "1") return;

    rs.shell.dataset.rssFiltersMigrating = "1";

    const from = colPillRects(
        rs.shell,
        opn ? RSS_FILT_SUM_PILL_SEL : RSS_FILT_CHILD_PILL_SEL
    );

    rs.shell.dataset.rssFiltersChildPending = "1";

    if (!opn) {
        syncFiltSum(rs.shell, true, false);
    }

    helpers.animateCollapsibleOpen({
        root: rs.shell,
        body: rs.body,
        header: rs.hdr,
        toggle: rs.btn,
        open: opn,
        renderIcon: renderTglIco,
        rootDatasetKey: "rssFiltersOpen",
        collapseLabel: "Collapse filters",
        expandLabel: "Expand filters",
        collapseTitle: "Collapse filters",
        expandTitle: "Expand filters",
        onLayout: afterDrawerMove
    });

    window.requestAnimationFrame(() => {
        const to = colPillRects(
            rs.shell,
            opn ? RSS_FILT_CHILD_PILL_SEL : RSS_FILT_SUM_PILL_SEL
        );

        const done = flyPills(from, to);

        if (opn) {
            syncFiltSum(rs.shell, false);
        }

        void done.then(() => {
            if (!opn) {
                rvlFiltSum(rs.shell);
            }

            rs.shell.dataset.rssFiltersChildPending = "0";
            rs.shell.dataset.rssFiltersMigrating = "0";
            afterDrawerMove();
        });
    });
}

/**
 * Opens the author drawer thing.
 * @param {HTMLElement} root
 * @param {boolean} opn
 * @returns {void}
 */
function setAthOpn(root: HTMLElement, opn: boolean): void {
    const rs = getAthRs(root);
    if (!rs) return;

    athMenuOpen = opn;

    helpers.animateCollapsibleOpen({
        root: rs.root,
        body: rs.body,
        header: rs.hdr,
        toggle: rs.btn,
        open: opn,
        renderIcon: renderTglIco,
        rootDatasetKey: "rssAuthorOpen",
        collapseLabel: "Collapse author filters",
        expandLabel: "Expand author filters",
        collapseTitle: "Collapse author filters",
        expandTitle: "Expand author filters",
        onLayout: afterDrawerMove
    });
}

/**
 * Wire the wee filter drawer.
 * @param {HTMLDivElement} shell
 * @returns {void}
 */
function wireFilt(shell: HTMLDivElement): void {
    if (shell.dataset.rssFiltersWired === "1") return;

    const rs = getFiltRs(shell);
    if (!rs) return;

    shell.dataset.rssFiltersWired = "1";

    rs.btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        setFiltOpn(shell, shell.dataset.rssFiltersOpen !== "1");
    });

    rs.hdr.addEventListener("click", (ev) => {
        const trg = ev.target;
        if (!(trg instanceof Element)) return;

        const sumPill = trg.closest<HTMLElement>("[data-rss-filter-summary-pill]");
        if (sumPill) {
            ev.preventDefault();
            ev.stopPropagation();

            hdlSumPillClick(sumPill);
            return;
        }

        const clearBtn = trg.closest<HTMLElement>("[data-rss-filters-clear-all]");
        if (clearBtn) {
            ev.preventDefault();
            ev.stopPropagation();

            clrAllSumFilt();
            return;
        }

        if (trg.closest("[data-rss-filters-summary]")) return;
        if (helpers.eventHasBlockedControl(ev)) return;

        setFiltOpn(shell, shell.dataset.rssFiltersOpen !== "1");
    });

    rs.hdr.addEventListener("keydown", (ev) => {
        if (ev.target !== rs.hdr) return;
        if (ev.key !== "Enter" && ev.key !== " ") return;

        ev.preventDefault();
        setFiltOpn(shell, shell.dataset.rssFiltersOpen !== "1");
    });

    syncFiltSum(shell);
}

/**
 * Makes the filter sandwich.
 * @param {HTMLDivElement} cal
 * @returns {HTMLDivElement}
 */
function ensFiltShell(cal: HTMLDivElement): HTMLDivElement {
    const current = cal.closest(".rss-filters");

    const existingInner = current instanceof HTMLDivElement
        ? current.querySelector(".rss-filters__body-inner")
        : null;

    if (existingInner instanceof HTMLDivElement && !existingInner.contains(cal)) {
        existingInner.prepend(cal);
    }

    if (current instanceof HTMLDivElement && existingInner instanceof HTMLDivElement) {
        wireFilt(current);
        syncFiltSum(current);
        return existingInner;
    }

    const parent = cal.parentElement;
    if (!parent) return cal;

    const shell = document.createElement("div");
    const hdr = document.createElement("div");
    const ttl = document.createElement("h3");
    const summary = document.createElement("div");
    const actions = document.createElement("div");
    const body = document.createElement("div");
    const inner = document.createElement("div");
    const clearBtn = mkFiltClearBtn();
    const btn = mkFiltBtn();

    shell.id = "kc-blog-filters";
    shell.className = "rss-filters";
    shell.dataset.rssFiltersOpen = "0";

    hdr.className = "rss-filters__hdr kc-click-header";
    hdr.dataset.rssFiltersHeader = "1";
    hdr.setAttribute("role", "button");
    hdr.setAttribute("tabindex", "0");
    hdr.setAttribute("aria-expanded", "false");
    hdr.setAttribute("title", "Expand filters");

    ttl.className = "rss-filters__ttl";
    ttl.textContent = "Filters: ";

    summary.className = "rss-filters__summary kc-click-header__control";
    summary.dataset.rssFiltersSummary = "1";
    summary.hidden = true;
    summary.setAttribute("aria-hidden", "true");
    summary.setAttribute("aria-label", "Selected filters");

    actions.className = "rss-filters__hdrActions kc-click-header__actions";
    actions.append(clearBtn, btn);

    body.id = "kc-blog-filters-body";
    body.className = "rss-filters__body";
    body.setAttribute("aria-hidden", "true");

    inner.className = "rss-filters__body-inner";

    hdr.append(ttl, summary, actions);
    body.appendChild(inner);

    parent.insertBefore(shell, cal);
    inner.appendChild(cal);
    shell.append(hdr, body);

    wireFilt(shell);

    return inner;
}

/**
 * Cal slot if it is there.
 * @returns {HTMLDivElement | null}
 */
function ensCalSlot(): HTMLDivElement | null {
    const slot = document.getElementById("kc-blog-cal-filter");
    return slot instanceof HTMLDivElement ? slot : null;
}

/**
 * Finds/makes the blog shell, fragile-ish.
 * @returns {WrapRs | null}
 */
function cleanExistingBlogContainers(
    wrap: HTMLElement,
    scroll: HTMLDivElement
): void {
    for (const child of Array.from(wrap.children)) {
        if (child === scroll) continue;
        if (!child.classList.contains("blog-container")) continue;
        wrap.removeChild(child);
    }
}

function ensBlogWrap(): WrapRs | null {
    const direct = isDirectRssPth();
    const directBox = direct
        ? document.querySelector(".blog-container")
        : null;

    if (direct && !(directBox instanceof HTMLDivElement)) return null;

    if (direct && directBox instanceof HTMLDivElement) {
        return {
            scr: null,
            box: directBox,
            cal: isBlogPth() ? ensCalSlot() : null
        };
    }

    const wrap = document.querySelector(".blog-wrapper");
    if (!(wrap instanceof HTMLElement)) return null;

    let scr: Element | null = wrap.querySelector(".rss-scroll-2");
    let box: Element | null = wrap.querySelector(".blog-container");

    if (!(box instanceof HTMLDivElement)) {
        const nxt = document.createElement("div");
        nxt.className = "blog-container";
        box = nxt;
    }

    if (!(scr instanceof HTMLDivElement)) {
        const nxt = document.createElement("div");
        nxt.className = "rss-scroll-2";
        nxt.appendChild(box);
        scr = nxt;

        cleanExistingBlogContainers(wrap, nxt);

        const hdr = wrap.querySelector(".comments-header");
        const aft = hdr?.nextSibling ?? null;

        aft ? wrap.insertBefore(nxt, aft) : wrap.appendChild(nxt);
    }

    if (!scr.contains(box)) scr.appendChild(box);

    if (!(scr instanceof HTMLDivElement) || !(box instanceof HTMLDivElement)) return null;

    return {
        scr,
        box,
        cal: null
    };
}

/**
 * Weird scroll height fix.
 * @returns {void}
 */
function adjScrHgt(): void {
    const rs = ensBlogWrap();
    const scr = rs?.scr ?? null;
    if (!scr) return;

    const psts = Array.from(scr.querySelectorAll<HTMLElement>(".rss-post-block"));
    if (psts.length === 0) return;

    const top = scr.scrollTop;
    let fstIx = 0;

    for (let i = 0; i < psts.length; i += 1) {
        if ((psts[i]?.offsetTop ?? 0) <= top) {
            fstIx = i;
            continue;
        }

        break;
    }

    const sndIx = fstIx + 1 < psts.length ? fstIx + 1 : fstIx;
    const fstH = psts[fstIx]?.offsetHeight ?? 0;
    const sndH = psts[sndIx]?.offsetHeight ?? 0;

    scr.style.maxHeight = fstIx === sndIx ? `${fstH}px` : `${fstH + sndH}px`;
}

/**
 * Opened content needs its number again.
 * @param {HTMLElement} content
 * @returns {void}
 */
function calcExpHgt(content: HTMLElement): void {
    if (!content.classList.contains("content-expanded")) return;

    content.style.maxHeight = `${content.scrollHeight}px`;
}

/**
 * Post height poke.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function calcPstHgt(pstDiv: HTMLElement): void {
    const content = pstDiv.querySelector(".rss-post-content");
    if (!(content instanceof HTMLElement)) return;

    calcExpHgt(content);
    adjScrHgt();
}

/**
 * Do it twice because DOM is annoying.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function qPstHgt(pstDiv: HTMLElement): void {
    window.requestAnimationFrame(() => {
        calcPstHgt(pstDiv);

        window.requestAnimationFrame(() => {
            calcPstHgt(pstDiv);
        });
    });
}

/**
 * Comment box changes mess with size.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function wireCmntLyt(pstDiv: HTMLElement): void {
    if (pstDiv.dataset.rssCommentLayoutWired === "1") return;

    const comments = pstDiv.querySelector(".rss-comments");
    if (!(comments instanceof HTMLElement)) return;

    pstDiv.dataset.rssCommentLayoutWired = "1";

    comments.addEventListener("rss-comments-layout-change", () => {
        qPstHgt(pstDiv);
    });

    const mutationTarget = comments.querySelector("[data-rss-comments-box]");

    const observer = new MutationObserver(() => {
        qPstHgt(pstDiv);
    });

    observer.observe(
        mutationTarget instanceof HTMLElement ? mutationTarget : comments,
        {
            childList: true,
            subtree: true,
            characterData: true
        }
    );

    if (!("ResizeObserver" in window)) return;

    const resizeObserver = new ResizeObserver(() => {
        qPstHgt(pstDiv);
    });

    resizeObserver.observe(comments);
}

/**
 * Moving scroll thing.
 * @returns {void}
 */
function setDynScr(): void {
    const rs = ensBlogWrap();
    const scr = rs?.scr ?? null;
    if (!scr) return;

    scr.addEventListener("transitionend", () => adjScrHgt(), true);
    scr.addEventListener("scroll", () => adjScrHgt(), { passive: true });
    window.addEventListener("resize", () => adjScrHgt());
}

/**
 * Old toggle height bump.
 * @returns {void}
 */
function trgAdjOnTgl(): void {
    const blog = document.querySelector(".blog-container");
    if (!(blog instanceof HTMLElement)) return;

    blog.addEventListener("click", (ev) => {
        const trg = ev.target;
        if (!(trg instanceof Element)) return;
        if (!trg.closest(".rss-post-toggle")) return;

        window.setTimeout(() => adjScrHgt(), 350);
    });
}

/**
 * Hover class stuff.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function wireHvr(pstDiv: HTMLElement): void {
    if (pstDiv.dataset.rssHoverStateWired === "1") return;

    const tgl = pstDiv.querySelector(".rss-post-toggle");
    if (!(tgl instanceof HTMLElement)) return;

    pstDiv.dataset.rssHoverStateWired = "1";

    tgl.addEventListener("pointerenter", () => {
        pstDiv.classList.add("is-rss-toggle-hovered");
    });

    tgl.addEventListener("pointerleave", () => {
        pstDiv.classList.remove("is-rss-toggle-hovered");
    });

    tgl.addEventListener("pointercancel", () => {
        pstDiv.classList.remove("is-rss-toggle-hovered");
    });

    tgl.addEventListener("blur", () => {
        pstDiv.classList.remove("is-rss-toggle-hovered");
    });
}

/**
 * Waits for the next layout frame.
 * @returns {Promise<void>}
 */
function waitFrame(): Promise<void> {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
    });
}

/**
 * Waits several layout frames.
 * @param {number} count
 * @returns {Promise<void>}
 */
async function waitFrames(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
        await waitFrame();
    }
}

/**
 * Gets a visible jump target.
 * @param {string} jumpId
 * @returns {HTMLElement | null}
 */
function getReadyJumpEl(jumpId: string): HTMLElement | null {
    const el = document.getElementById(jumpId);

    if (!(el instanceof HTMLElement)) {
        return null;
    }

    if (el.getClientRects().length === 0) {
        return null;
    }

    return el;
}

/**
 * Waits until the jump target exists and has layout.
 * @param {string} jumpId
 * @returns {Promise<HTMLElement | null>}
 */
async function waitForJumpEl(jumpId: string): Promise<HTMLElement | null> {
    for (let i = 0; i < RSS_JUMP_RETRY_FRAMES; i += 1) {
        const el = getReadyJumpEl(jumpId);

        if (el) {
            return el;
        }

        await waitFrame();
    }

    return null;
}

/**
 * Viewport height, accounting for mobile visual viewport when present.
 * @returns {number}
 */
function getViewportHeight(): number {
    return window.visualViewport?.height ?? document.documentElement.clientHeight;
}

/**
 * Scrolls one jump target to the middle of the viewport.
 * @param {HTMLElement} el
 * @returns {void}
 */
function scrollJumpEl(el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const viewportHeight = getViewportHeight();
    const targetTop = window.scrollY + rect.top + (rect.height / 2) - (viewportHeight / 2);

    window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
    });
}

/**
 * Repeats the jump once after the expand animation/layout has settled.
 * @param {string} jumpId
 * @returns {void}
 */
function qSettledJump(jumpId: string): void {
    window.setTimeout(() => {
        const el = getReadyJumpEl(jumpId);

        if (!el) {
            return;
        }

        scrollJumpEl(el);
    }, RSS_JUMP_SETTLE_MS);
}

/**
 * Moves to one rendered segment.
 * @param {string | null} jumpId
 * @returns {Promise<boolean>}
 */
async function jumpToSeg(jumpId: string | null): Promise<boolean> {
    if (!jumpId) {
        return false;
    }

    const el = await waitForJumpEl(jumpId);

    if (!el) {
        return false;
    }

    scrollJumpEl(el);
    qSettledJump(jumpId);

    return true;
}

/**
 * Scrolls to the requested segment, or falls back to the post.
 * @param {HTMLElement} first
 * @param {string | null} jumpId
 * @returns {Promise<void>}
 */
async function scrollRevealTarget(first: HTMLElement, jumpId: string | null): Promise<void> {
    try {
        await waitFrames(2);

        const jumped = await jumpToSeg(jumpId);

        if (jumped) {
            return;
        }

        first.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    } finally {
        pendingRevealPostRefs = [];
        pendingRevealJumpId = null;
    }
}

/**
 * Open the post, even if toggle is weird.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function opnPstEl(pstDiv: HTMLElement): void {
    const tgl = pstDiv.querySelector(".rss-post-toggle");
    const cnt = pstDiv.querySelector(".rss-post-content");

    if (!(tgl instanceof HTMLElement)) return;
    if (!(cnt instanceof HTMLElement)) return;

    if (!cnt.classList.contains("content-expanded")) {
        tgl.click();
    }

    if (cnt.classList.contains("content-expanded")) {
        qPstHgt(pstDiv);
        return;
    }

    const arr = pstDiv.querySelector(".summary-arrow");

    cnt.classList.add("content-expanded");
    cnt.classList.remove("content-collapsed");
    cnt.style.maxHeight = `${cnt.scrollHeight}px`;
    cnt.style.visibility = "visible";
    cnt.style.pointerEvents = "auto";
    tgl.setAttribute("aria-expanded", "true");

    if (arr instanceof HTMLElement) arr.textContent = "🔽";

    qPstHgt(pstDiv);
}

/**
 * Reveal posts from saved refs.
 * @param {readonly string[]} postRefs
 * @param {string | null} jumpId
 * @returns {void}
 */
function rvlPstRefs(postRefs: readonly string[], jumpId: string | null = null): void {
    const refs = Array.from(new Set<string>(postRefs));

    pendingRevealPostRefs = refs;
    pendingRevealJumpId = jumpId;

    window.requestAnimationFrame(() => {
        const matched: HTMLElement[] = [];

        refs.forEach((postRef) => {
            const selector = `.rss-post-block[data-rss-post-ref="${helpers.escapeCssIdentifier(postRef)}"]`;

            document.querySelectorAll(selector).forEach((el) => {
                if (!(el instanceof HTMLElement)) return;
                if (matched.includes(el)) return;

                matched.push(el);
                opnPstEl(el);
            });
        });

        const first = matched[0];

        if (!first) {
            pendingRevealPostRefs = [];
            pendingRevealJumpId = null;
            return;
        }

        window.requestAnimationFrame(() => {
            void scrollRevealTarget(first, jumpId);
        });
    });
}

/**
 * Set filters so the wanted posts can show up.
 * @param {readonly Pst[]} psts
 * @param {readonly Pst[]} tgts
 * @param {string | null} jumpId
 * @returns {void}
 */
function prepTgts(
    psts: readonly Pst[],
    tgts: readonly Pst[],
    jumpId: string | null = null
): void {
    if (tgts.length === 0) return;

    const targetAuthors = pstAths(tgts);
    const allAuthors = pstAths(psts);

    authorOff = new Set<string>(
        Array.from(allAuthors).filter((author) => !targetAuthors.has(author))
    );

    curCalSel = mkPstsSel(tgts);
    pendingRevealPostRefs = Array.from(mkPstsRefs(tgts));
    pendingRevealJumpId = jumpId;
}

/**
 * Little share thing.
 * @param {Readonly<{ pst: Pst; placement: "top" | "bottom" }>} props
 * @returns {JSX.Element}
 */
function RssShareBtn({
    pst,
    placement
}: Readonly<{
    pst: Pst;
    placement: "top" | "bottom";
}>): JSX.Element {
    const postRef = mkPstShortId(pst);

    return (
        <button
            type="button"
            className={`rss-post-share rss-post-share--${placement} kc-round-icon-btn`}
            data-rss-share-post={postRef}
            aria-label={`Share ${pst.ttl}`}
            title="Share post"
        >
            {icons.MakeShareIcon()}
        </button>
    );
}

/**
 * Comments slot, disabled sometimes.
 * @param {Readonly<{ slug: string; disabled: boolean }>} props
 * @returns {JSX.Element}
 */
function RssCmntSlot({
    slug,
    disabled
}: Readonly<{
    slug: string;
    disabled: boolean;
}>): JSX.Element {
    if (disabled) {
        return (
            <section
                className="rss-comments rss-comments--disabled comments-container"
                data-rss-comment-disabled="1"
            >
                <div className="segment-header">Visitor Comments</div>

                <p className="rss-comments__status">
                    Comments are disabled for automated posts.
                </p>
            </section>
        );
    }

    return (
        <section
            className="rss-comments comments-container"
            data-rss-comment-slug={slug}
            data-rss-comment-disabled="0"
        >
            <div className="segment-header">Leave your comment!</div>

            <div className="comment-input">
                <div className="comment-row comment-meta-row">
                    <input
                        type="text"
                        id="comment-nick"
                        maxLength={32}
                        placeholder="Your nickname (max 32 characters)"
                        data-rss-comment-nick="1"
                    />

                    <input
                        type="text"
                        id="comment-website"
                        placeholder="Your Website (Optional)"
                        data-rss-comment-website="1"
                    />

                    <div className="comment-location-field">
                        <div className="comment-location-control">
                            <select
                                id="comment-location"
                                aria-label="Your location"
                                data-rss-comment-location="1"
                            >
                                <option value="">Location (Optional)</option>
                            </select>

                            <span
                                id="comment-location-flag"
                                aria-hidden="true"
                                data-rss-comment-location-flag="1"
                            >
                                🌎
                            </span>
                        </div>
                    </div>
                </div>

                <div className="comment-row comment-body-row">
                    <textarea
                        id="new-comment"
                        maxLength={256}
                        rows={4}
                        placeholder="Write your comment here (max 256 characters)..."
                        data-rss-comment-msg="1"
                    />
                </div>

                <div className="comment-row comment-submit-row">
                    <button
                        id="post-comment-button"
                        type="button"
                        data-rss-comment-post="1"
                    >
                        Post
                    </button>
                </div>
            </div>

            <div className="segment-header">Visitor Comments</div>

            <p
                className="rss-comments__status"
                data-rss-comments-status="1"
                aria-live="polite"
            >
                Comments load when the post is opened.
            </p>

            <div className="comments-box" data-rss-comments-box="1" />
        </section>
    );
}

/**
 * Big post card thing.
 * @param {Readonly<{ pst: Pst; exp: boolean }>} props
 * @returns {JSX.Element}
 */
function PstCard({ pst, exp }: Readonly<{ pst: Pst; exp: boolean }>): JSX.Element {
    const postRef = mkPstDomRef(pst);
    const cnt = { __html: rndrRssMD(pst.cnt, postRef) };
    const arr = exp ? "🔽" : "▶️";
    const expd = exp ? "true" : "false";
    const cls = exp ? "rss-post-content content-expanded" : "rss-post-content content-collapsed";
    const commentsDisabled = authorFilterCfg.defaultUnselect.has(pst.ath);
    const slug = mkPstSlug(pst);

    return (
        <article
            className="rss-post-block"
            data-pub={pst.pub}
            data-gid={pst.gid}
            data-rss-post-ref={postRef}
        >
            <div
                className="rss-post-toggle"
                {...(exp ? {} : { tabIndex: 0, role: "button" })}
                aria-expanded={expd}
            >
                <div className="rss-post-header">
                    <span className="summary-arrow">{arr}</span>
                    <span className="rss-post-title">{pst.ttl}</span>
                    <span className="rss-post-date">{fmtDt(pst.pub)}</span>
                    <RssShareBtn pst={pst} placement="top" />
                </div>

                <div className="rss-post-meta">
                    <span className="rss-post-author">By: {pst.ath}</span>
                </div>

                <div className="rss-post-summary summary-collapsed">
                    <span className="summary-text">{pst.dsc}</span>
                </div>
            </div>

            <div className={cls}>
                <div className="rss-post-content__inner" dangerouslySetInnerHTML={cnt} />

                <div className="rss-post-share-row">
                    <RssShareBtn pst={pst} placement="bottom" />
                </div>

                <RssCmntSlot
                    slug={slug}
                    disabled={commentsDisabled}
                />
            </div>
        </article>
    );
}

/**
 * Empty state, boring.
 * @param {Readonly<{ ttl: string; body: string }>} props
 * @returns {JSX.Element}
 */
function EmptyBlk({ ttl, body }: Readonly<{ ttl: string; body: string }>): JSX.Element {
    return (
        <section className="rss-empty" aria-live="polite">
            <div className="rss-empty__ttl">{ttl}</div>
            <p className="rss-empty__txt">{body}</p>
        </section>
    );
}

/**
 * Wee author drawer button.
 * @param {Readonly<{ opn: boolean }>} props
 * @returns {JSX.Element}
 */
function AthTglBtn({ opn }: Readonly<{ opn: boolean }>): JSX.Element {
    return (
        <button
            type="button"
            className="rss-filters__toggle rss-author-filter__toggle kc-round-icon-btn kc-click-header__control"
            data-rss-author-menu-tgl="1"
            aria-controls="kc-blog-author-filter-body"
            aria-expanded={opn ? "true" : "false"}
            aria-label={opn ? "Collapse author filters" : "Expand author filters"}
            title={opn ? "Collapse author filters" : "Expand author filters"}
        >
            {opn ? icons.MakeDecreaseFontIcon() : icons.MakeIncreaseFontIcon()}
        </button>
    );
}

/**
 * Author all/select button.
 * @param {Readonly<{ act: string; txt: string; cnt: number; disabled: boolean }>} props
 * @returns {JSX.Element}
 */
function AuthorAllBtn({
    act,
    txt,
    cnt,
    disabled
}: Readonly<{
    act: string;
    txt: string;
    cnt: number;
    disabled: boolean;
}>): JSX.Element {
    return (
        <button
            type="button"
            className="rss-author-filter__all kc-click-header__control"
            data-rss-author-act={act}
            disabled={disabled}
            title={`${txt} (${cnt})`}
        >
            <span className="rss-author-filter__allTxt">{txt}</span>
            <span className="rss-author-filter__allCnt">{cnt}</span>
        </button>
    );
}

/**
 * Author buttons.
 * @param {Readonly<{ opts: readonly AthOpt[]; opn: boolean }>} props
 * @returns {JSX.Element}
 */
function AuthorFilter({
    opts,
    opn
}: Readonly<{
    opts: readonly AthOpt[];
    opn: boolean;
}>): JSX.Element {
    const onCnt = opts.filter((opt) => opt.on).length;
    const allOn = opts.length > 0 && onCnt === opts.length;
    const act = allOn ? "clr" : "all";
    const txt = allOn ? "Clear all" : "Select all";
    const actionCnt = opts
        .filter((opt) => !allOn || opt.on)
        .reduce((total, opt) => total + opt.cnt, 0);

    return (
        <section
            className="rss-author-filter"
            aria-label="Author filters"
            data-rss-author-open={opn ? "1" : "0"}
        >
            <header
                className="rss-author-filter__hdr kc-click-header"
                data-rss-author-menu-hdr="1"
                role="button"
                tabIndex={0}
                aria-expanded={opn ? "true" : "false"}
                title={opn ? "Collapse author filters" : "Expand author filters"}
            >
                <div className="rss-author-filter__titleWrap">
                    <h3 className="rss-author-filter__ttl">Authors</h3>
                    <p className="rss-author-filter__txt">
                        Showing {onCnt} of {opts.length}
                    </p>
                </div>

                <div className="rss-author-filter__actions kc-click-header__actions">
                    <AuthorAllBtn
                        act={act}
                        txt={txt}
                        cnt={actionCnt}
                        disabled={opts.length === 0}
                    />

                    <AthTglBtn opn={opn} />
                </div>
            </header>

            <div
                id="kc-blog-author-filter-body"
                className="rss-filters__body rss-author-filter__body"
                aria-hidden={opn ? "false" : "true"}
            >
                <div className="rss-filters__body-inner rss-author-filter__body-inner">
                    <div className="rss-author-filter__list">
                        {opts.map((opt) => (
                            <button
                                key={opt.ath}
                                type="button"
                                className="rss-author-filter__btn"
                                data-rss-author={opt.ath}
                                data-on={opt.on ? "1" : "0"}
                                aria-pressed={opt.on ? "true" : "false"}
                                title={opt.on ? `Hide ${opt.ath}` : `Show ${opt.ath}`}
                            >
                                <span className="rss-author-filter__name">{opt.ath}</span>
                                <span className="rss-author-filter__dot" aria-hidden="true">
                                    •
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

/**
 * Links inside posts.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function cfgPstLks(pstDiv: HTMLElement): void {
    Array.from(pstDiv.querySelectorAll<HTMLAnchorElement>("a[href]")).forEach((lnk) => {
        if (lnk.dataset.rssNewTab === "1") return;

        lnk.dataset.rssNewTab = "1";
        lnk.target = "_blank";
        lnk.rel = "noopener noreferrer";

        lnk.addEventListener("click", (ev) => {
            ev.stopPropagation();
        });
    });
}

/**
 * Reads pointer coordinates from a pointer event.
 * @param {PointerEvent} ev
 * @returns {SegPoint}
 */
function segPointFromPointerEvent(ev: PointerEvent): SegPoint {
    return {
        clientX: ev.clientX,
        clientY: ev.clientY
    };
}

/**
 * Keeps a local segment coordinate inside its box.
 * @param {number} value
 * @param {number} max
 * @returns {number}
 */
function clampSegCoord(value: number, max: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(Math.max(value, 0), Math.max(max, 0));
}

/**
 * Checks if a target is an interactive element that should keep its own behaviour.
 * @param {Element} trg
 * @returns {boolean}
 */
function isSegControlTarget(trg: Element): boolean {
    return trg.closest("a,button,input,textarea,select,label") !== null;
}

/**
 * Stores the desired segment share button position as CSS variables.
 * @param {HTMLElement} seg
 * @param {SegPoint} point
 * @returns {void}
 */
function setSegSharePoint(seg: HTMLElement, point: SegPoint): void {
    const rect = seg.getBoundingClientRect();
    const localX = clampSegCoord(point.clientX - rect.left, rect.width);
    const localY = clampSegCoord(point.clientY - rect.top, rect.height);

    seg.style.setProperty("--rss-seg-share-x", `${localX}px`);
    seg.style.setProperty("--rss-seg-share-y", `${localY}px`);
}

/**
 * Cancels a delayed segment share reveal.
 * @returns {void}
 */
function cancelPendingSegReveal(): void {
    pendingSegReveal = null;

    if (segRevealTimer === null) {
        return;
    }

    window.clearTimeout(segRevealTimer);
    segRevealTimer = null;
}

/**
 * Hides the currently visible segment share button only.
 * @returns {void}
 */
function hideActiveSegShare(): void {
    if (!activeSegShare) {
        return;
    }

    activeSegShare.classList.remove("is-rss-seg-share-open");
    activeSegShare.dataset.rssSegShareOpen = "0";
    activeSegShare = null;
}

/**
 * Reveals one segment share button and hides the previous one.
 * @param {HTMLElement} seg
 * @returns {void}
 */
function rvlSegShare(seg: HTMLElement): void {
    if (activeSegShare && activeSegShare !== seg) {
        activeSegShare.classList.remove("is-rss-seg-share-open");
        activeSegShare.dataset.rssSegShareOpen = "0";
    }

    activeSegShare = seg;
    seg.classList.add("is-rss-seg-share-open");
    seg.dataset.rssSegShareOpen = "1";
}

/**
 * Reveals a segment share button at a pointer or tap position.
 * @param {HTMLElement} seg
 * @param {SegPoint} point
 * @returns {void}
 */
function rvlSegShareAt(seg: HTMLElement, point: SegPoint): void {
    cancelPendingSegReveal();
    setSegSharePoint(seg, point);
    rvlSegShare(seg);
}

/**
 * Queues a segment share reveal once the pointer enters a shareable segment.
 * @param {HTMLElement} seg
 * @param {SegPoint} point
 * @returns {void}
 */
function qSegShareReveal(seg: HTMLElement, point: SegPoint): void {
    if (activeSegShare === seg) {
        return;
    }

    if (pendingSegReveal?.seg === seg) {
        return;
    }

    if (activeSegShare) {
        hideActiveSegShare();
    }

    cancelPendingSegReveal();
    setSegSharePoint(seg, point);

    pendingSegReveal = {
        seg,
        point
    };

    segRevealTimer = window.setTimeout(() => {
        const pending = pendingSegReveal;

        segRevealTimer = null;
        pendingSegReveal = null;

        if (!pending?.seg.isConnected) {
            return;
        }

        rvlSegShare(pending.seg);
    }, RSS_SEG_POINTER_REVEAL_MS);
}

/**
 * Hides the active segment share button.
 * @returns {void}
 */
function hideSegShare(): void {
    cancelPendingSegReveal();
    hideActiveSegShare();
}

/**
 * Reads the post ref for one rendered segment.
 * @param {HTMLElement} seg
 * @returns {string | null}
 */
function getSegPostRef(seg: HTMLElement): string | null {
    const pstDiv = seg.closest(".rss-post-block");

    if (!(pstDiv instanceof HTMLElement)) {
        return null;
    }

    return pstDiv.dataset.rssPostRef ?? null;
}

/**
 * Reads the share URL for one rendered segment.
 * @param {HTMLElement} seg
 * @returns {string | null}
 */
function getSegShareUrl(seg: HTMLElement): string | null {
    const segId = seg.dataset.rssSegId;
    const postRef = getSegPostRef(seg);

    if (!segId || !postRef) {
        return null;
    }

    return mkPstSegShareUrl(postRef, segId);
}

/**
 * Copies a rendered segment URL.
 * @param {HTMLElement} seg
 * @returns {void}
 */
function copySegShareUrl(seg: HTMLElement): void {
    const url = getSegShareUrl(seg);

    if (!url) {
        return;
    }

    void cpyTxt(url);
    hideSegShare();
}

/**
 * Shares a rendered segment using the normal share helper.
 * @param {HTMLElement} seg
 * @returns {void}
 */
function shareSegUrl(seg: HTMLElement): void {
    const url = getSegShareUrl(seg);
    const postRef = getSegPostRef(seg);
    const pst = findByPstRef(allPsts, postRef).at(0);
    const title = pst?.ttl ?? document.title;

    if (!url) {
        return;
    }

    void helpers.shareUrl(url, title);
    hideSegShare();
}

/**
 * Handles touch tap on a shareable segment.
 * @param {HTMLElement} seg
 * @param {SegPoint} point
 * @returns {void}
 */
function hdlSegTap(seg: HTMLElement, point: SegPoint): void {
    const segId = seg.dataset.rssSegId;
    const now = Date.now();
    const isDoubleTap =
        !!segId
        && lastSegTap?.id === segId
        && now - lastSegTap.at <= RSS_SEG_DOUBLE_TAP_MS;

    if (isDoubleTap) {
        lastSegTap = null;
        copySegShareUrl(seg);
        return;
    }

    if (segId) {
        lastSegTap = {
            id: segId,
            at: now
        };
    }

    rvlSegShareAt(seg, point);
}

/**
 * Hides mobile revealed segment buttons on outside tap/click.
 * @returns {void}
 */
function wireSegShareDismiss(): void {
    if (segDismissWired) return;

    segDismissWired = true;

    document.addEventListener(
        "pointerdown",
        (ev) => {
            const trg = ev.target;

            if (!(trg instanceof Element)) {
                hideSegShare();
                return;
            }

            if (activeSegShare?.contains(trg)) {
                return;
            }

            hideSegShare();
        },
        true
    );
}

/**
 * Share btn click wires.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function wireShareBtns(pstDiv: HTMLElement): void {
    if (pstDiv.dataset.rssShareWired === "1") return;

    pstDiv.dataset.rssShareWired = "1";

    pstDiv.querySelectorAll<HTMLButtonElement>("[data-rss-share-post]").forEach((btn) => {
        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const postRef = btn.dataset.rssSharePost;
            if (!postRef) return;

            const psts = findByPstRef(allPsts, postRef);
            const shareTitle = psts.length === 1 ? psts[0].ttl : document.title;
            const shareUrl = mkPstShareUrl(postRef);

            void helpers.shareUrl(shareUrl, shareTitle);
        });
    });
}

/**
 * Segment share click wires.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function wireSegShares(pstDiv: HTMLElement): void {
    if (pstDiv.dataset.rssSegShareWired === "1") return;

    pstDiv.dataset.rssSegShareWired = "1";
    wireSegShareDismiss();

    pstDiv.addEventListener(
        "pointermove",
        (ev) => {
            if (ev.pointerType === "touch") {
                return;
            }

            const trg = ev.target;

            if (!(trg instanceof Element)) {
                hideSegShare();
                return;
            }

            if (trg.closest(RSS_SEG_SHARE_BTN_SEL)) {
                return;
            }

            const seg = trg.closest<HTMLElement>(RSS_SEG_SHARE_SEL);

            if (!(seg instanceof HTMLElement)) {
                hideSegShare();
                return;
            }

            qSegShareReveal(seg, segPointFromPointerEvent(ev));
        },
        true
    );

    pstDiv.addEventListener(
        "pointerleave",
        (ev) => {
            if (ev.pointerType === "touch") {
                return;
            }

            hideSegShare();
        },
        true
    );

    pstDiv.addEventListener(
        "click",
        (ev) => {
            const trg = ev.target;

            if (!(trg instanceof Element)) return;

            const shareBtn = trg.closest<HTMLButtonElement>(RSS_SEG_SHARE_BTN_SEL);

            if (!(shareBtn instanceof HTMLButtonElement)) return;

            ev.preventDefault();
            ev.stopPropagation();

            const seg = shareBtn.closest<HTMLElement>(RSS_SEG_SHARE_SEL);
            if (!(seg instanceof HTMLElement)) return;

            shareSegUrl(seg);
        },
        true
    );

    pstDiv.addEventListener(
        "dblclick",
        (ev) => {
            const trg = ev.target;

            if (!(trg instanceof Element)) return;

            const seg = trg.closest<HTMLElement>(RSS_SEG_SHARE_SEL);

            if (!(seg instanceof HTMLElement)) {
                return;
            }

            ev.preventDefault();
            ev.stopPropagation();
        },
        true
    );

    pstDiv.addEventListener(
        "pointerdown",
        (ev) => {
            const trg = ev.target;

            if (!(trg instanceof Element)) return;

            if (trg.closest(RSS_SEG_SHARE_BTN_SEL)) {
                ev.stopPropagation();
                return;
            }

            const seg = trg.closest<HTMLElement>(RSS_SEG_SHARE_SEL);

            if (!(seg instanceof HTMLElement)) {
                return;
            }

            ev.stopPropagation();

            if (ev.pointerType !== "touch") {
                return;
            }

            if (isSegControlTarget(trg)) {
                return;
            }

            hdlSegTap(seg, segPointFromPointerEvent(ev));
        },
        true
    );
}

/**
 * Attach the post bits.
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
function atchTgl(pstDiv: HTMLElement): void {
    const tgl = pstDiv.querySelector(".rss-post-toggle");
    if (!(tgl instanceof HTMLElement)) return;

    const hdr = tgl.querySelector(".rss-post-header");
    if (!(hdr instanceof HTMLElement)) return;

    const arr = hdr.querySelector(".summary-arrow");
    if (!(arr instanceof HTMLElement)) return;

    const cnt = pstDiv.querySelector(".rss-post-content");
    if (!(cnt instanceof HTMLElement)) return;

    cfgPstLks(pstDiv);
    hglPstCode(pstDiv);
    wireShareBtns(pstDiv);
    wireSegShares(pstDiv);
    wireHvr(pstDiv);
    wireCmntLyt(pstDiv);
    helpers.atchColl({ tgl, cnt, arr });
    atchRssComments(pstDiv);
}

/**
 * All post toggles.
 * @param {HTMLElement} box
 * @returns {void}
 */
function atchAllTgl(box: HTMLElement): void {
    const psts = Array.from(box.querySelectorAll<HTMLElement>(".rss-post-block"));
    if (psts.length === 0) return;

    psts.forEach((pst) => atchTgl(pst));

    if (pendingRevealPostRefs.length > 0) {
        rvlPstRefs(pendingRevealPostRefs, pendingRevealJumpId);
    }
}

/**
 * Years list.
 * @param {readonly Pst[]} psts
 * @returns {number[]}
 */
function mkYrOpts(psts: readonly Pst[]): number[] {
    const nowYr = new Date().getFullYear();
    const src = new Set<number>([nowYr]);

    psts.forEach((pst) => {
        if (Number.isNaN(pst.yr)) return;

        src.add(pst.yr);
    });

    return Array.from(src).sort((a, b) => b - a);
}

/**
 * Date match thing.
 * @param {Pst} pst
 * @param {CalSel} sel
 * @returns {boolean}
 */
function mtchPst(pst: Pst, sel: CalSel): boolean {
    const yrOk = sel.yrs.size === 0 || sel.yrs.has(pst.yr);
    const moOk = sel.mos.size === 0 || sel.mos.has(pst.mo);
    const dyOk = sel.dys.size === 0 || sel.dys.has(pst.dy);

    return yrOk && moOk && dyOk;
}

/**
 * Author slot by cal.
 * @param {HTMLDivElement} cal
 * @returns {HTMLDivElement}
 */
function ensAthSlot(cal: HTMLDivElement): HTMLDivElement {
    const host = ensFiltShell(cal);
    const found = document.getElementById("kc-blog-author-filter");

    if (found instanceof HTMLDivElement && !host.contains(found)) {
        host.appendChild(found);
    }

    if (found instanceof HTMLDivElement) return found;

    const slot = document.createElement("div");

    slot.id = "kc-blog-author-filter";
    slot.className = "rss-author-filter-slot";

    host.appendChild(slot);

    return slot;
}

/**
 * Default hidden authors.
 * @returns {Set<string>}
 */
function mkDefAthOff(): Set<string> {
    return new Set<string>(authorFilterCfg.defaultUnselect);
}

/**
 * Posts by date filter.
 * @param {readonly Pst[]} psts
 * @param {CalSel} sel
 * @returns {readonly Pst[]}
 */
function datePsts(psts: readonly Pst[], sel: CalSel): readonly Pst[] {
    return psts.filter((pst) => mtchPst(pst, sel));
}

/**
 * Posts with authors on.
 * @param {readonly Pst[]} psts
 * @param {ReadonlySet<string>} off
 * @returns {readonly Pst[]}
 */
function athPsts(psts: readonly Pst[], off: ReadonlySet<string>): readonly Pst[] {
    return psts.filter((pst) => !off.has(pst.ath));
}

/**
 * Author set.
 * @param {readonly Pst[]} psts
 * @returns {ReadonlySet<string>}
 */
function pstAths(psts: readonly Pst[]): ReadonlySet<string> {
    return new Set<string>(psts.map((pst) => pst.ath));
}

/**
 * Options for author ui.
 * @param {readonly Pst[]} psts
 * @param {ReadonlySet<string>} off
 * @returns {readonly AthOpt[]}
 */
function mkAthOpts(psts: readonly Pst[], off: ReadonlySet<string>): readonly AthOpt[] {
    const counts = new Map<string, number>();

    psts.forEach((pst) => {
        counts.set(pst.ath, (counts.get(pst.ath) ?? 0) + 1);
    });

    return Array.from(counts.entries())
        .map(([ath, cnt]) => ({
            ath,
            cnt,
            on: !off.has(ath)
        }))
        .sort((a, b) => a.ath.localeCompare(b.ath));
}

/**
 * Turn authors on.
 * @param {ReadonlySet<string>} aths
 * @returns {void}
 */
function selAths(aths: ReadonlySet<string>): void {
    aths.forEach((ath) => {
        authorOff.delete(ath);
    });
}

/**
 * Turn authors off.
 * @param {ReadonlySet<string>} aths
 * @returns {void}
 */
function unselAths(aths: ReadonlySet<string>): void {
    aths.forEach((ath) => {
        authorOff.add(ath);
    });
}

/**
 * Repaint authors.
 * @param {HTMLDivElement} slot
 * @param {readonly Pst[]} psts
 * @param {CalSel} sel
 * @returns {void}
 */
function rndAthFilt(slot: HTMLDivElement, psts: readonly Pst[], sel: CalSel): void {
    const opts = mkAthOpts(datePsts(psts, sel), authorOff);
    const frag = render2Frag(<AuthorFilter opts={opts} opn={athMenuOpen} />);

    slot.replaceChildren(frag);
    syncCurFiltSum();
}

/**
 * Clicks for author filter.
 * @param {HTMLDivElement} slot
 * @param {HTMLDivElement} box
 * @returns {void}
 */
function wireAthFilt(slot: HTMLDivElement, box: HTMLDivElement): void {
    if (slot.dataset.rssAuthorWired === "1") return;

    slot.dataset.rssAuthorWired = "1";

    slot.addEventListener("click", (ev) => {
        const trg = ev.target;
        if (!(trg instanceof Element)) return;

        const menuBtn = trg.closest<HTMLButtonElement>("[data-rss-author-menu-tgl]");

        const menuRoot = menuBtn?.closest(".rss-author-filter") ?? null;
        if (menuBtn && !(menuRoot instanceof HTMLElement)) return;

        if (menuBtn && menuRoot instanceof HTMLElement) {
            ev.preventDefault();
            ev.stopPropagation();
            setAthOpn(menuRoot, menuRoot.dataset.rssAuthorOpen !== "1");
            return;
        }

        const allBtn = trg.closest<HTMLButtonElement>("[data-rss-author-act]");

        if (allBtn) {
            ev.preventDefault();
            ev.stopPropagation();

            const aths = pstAths(datePsts(allPsts, curCalSel));
            const act = allBtn.dataset.rssAuthorAct;

            act === "clr"
                ? unselAths(aths)
                : selAths(aths);

            rndAthFilt(slot, allPsts, curCalSel);
            rndBlog(box, allPsts, curCalSel, authorOff);
            syncCurFiltSum();
            return;
        }

        const btn = trg.closest<HTMLButtonElement>("[data-rss-author]");
        if (!(btn instanceof HTMLButtonElement)) return;

        const ath = btn.dataset.rssAuthor;
        if (!ath) return;

        authorOff.has(ath)
            ? authorOff.delete(ath)
            : authorOff.add(ath);

        rndAthFilt(slot, allPsts, curCalSel);
        rndBlog(box, allPsts, curCalSel, authorOff);
        syncCurFiltSum();

        const hdr = trg.closest<HTMLElement>("[data-rss-author-menu-hdr]");
        if (!hdr) return;
        if (helpers.eventHasBlockedControl(ev)) return;

        const root = hdr.closest(".rss-author-filter");
        if (!(root instanceof HTMLElement)) return;

        setAthOpn(root, root.dataset.rssAuthorOpen !== "1");
    });

    slot.addEventListener("keydown", (ev) => {
        const trg = ev.target;
        if (!(trg instanceof HTMLElement)) return;
        if (!trg.matches("[data-rss-author-menu-hdr]")) return;
        if (ev.key !== "Enter" && ev.key !== " ") return;

        const root = trg.closest(".rss-author-filter");
        if (!(root instanceof HTMLElement)) return;

        ev.preventDefault();
        setAthOpn(root, root.dataset.rssAuthorOpen !== "1");
    });
}

/**
 * Calendar has callback.
 * @param {readonly Pst[]} psts
 * @returns {(arg: CalHasArg) => boolean}
 */
function mkHasFn(psts: readonly Pst[]): (arg: CalHasArg) => boolean {
    return ({ lvl, val, sel, ctx }: CalHasArg): boolean => {
        return psts.some((pst) => {
            const yrOk =
                lvl === "yr"
                    ? pst.yr === val
                    : ctx.yr !== undefined
                        ? pst.yr === ctx.yr
                        : sel.yrs.size === 0 || sel.yrs.has(pst.yr);

            const moOk =
                lvl === "mo"
                    ? pst.mo === val
                    : ctx.mo !== undefined
                        ? pst.mo === ctx.mo
                        : sel.mos.size === 0 || sel.mos.has(pst.mo);

            const dyOk =
                lvl === "dy"
                    ? ctx.dy !== undefined
                        ? pst.dy === ctx.dy
                        : pst.dy === val
                    : sel.dys.size === 0 || sel.dys.has(pst.dy);

            return yrOk && moOk && dyOk;
        });
    };
}

/**
 * Draw the blog list.
 * @param {HTMLDivElement} box
 * @param {readonly Pst[]} psts
 * @param {CalSel} sel
 * @param {ReadonlySet<string>} offAuthors
 * @returns {void}
 */
function rndBlog(
    box: HTMLDivElement,
    psts: readonly Pst[],
    sel: CalSel,
    offAuthors: ReadonlySet<string> = new Set<string>()
): void {
    const byDate = datePsts(psts, sel);
    const vis = athPsts(byDate, offAuthors);

    if (byDate.length === 0) {
        const frag = render2Frag(
            <EmptyBlk
                ttl="No posts for this date selection"
                body="Try adding another year, month, or day, or clear the filters to widen the range."
            />
        );

        box.replaceChildren(frag);
        aplyBlogLyt();
        syncCurFiltSum();
        return;
    }

    if (vis.length === 0) {
        const frag = render2Frag(
            <EmptyBlk
                ttl="No posts for the selected authors"
                body="Turn an author back on, or use Select all to show every author for this date selection."
            />
        );

        box.replaceChildren(frag);
        aplyBlogLyt();
        syncCurFiltSum();
        return;
    }

    const frag = render2Frag(
        <>
            {vis.map((pst) => (
                <PstCard
                    key={pst.gid || `${pst.pub}-${pst.ttl}`}
                    pst={pst}
                    exp={false}
                />
            ))}
        </>
    );

    box.replaceChildren(frag);
    atchAllTgl(box);
    aplyBlogLyt();
    syncCurFiltSum();
}

/**
 * Draw the resources list without filters.
 * @param {HTMLDivElement} box
 * @param {readonly Pst[]} psts
 * @returns {void}
 */
function rndResources(box: HTMLDivElement, psts: readonly Pst[]): void {
    if (psts.length === 0) {
        const frag = render2Frag(
            <EmptyBlk
                ttl="No resources found"
                body={`Posts whose title starts with ${RSS_RESOURCE_TITLE_PREFIX} will appear here.`}
            />
        );

        box.replaceChildren(frag);
        aplyBlogLyt();
        return;
    }

    const frag = render2Frag(
        <>
            {psts.map((pst) => (
                <PstCard
                    key={pst.gid || `${pst.pub}-${pst.ttl}`}
                    pst={pst}
                    exp={false}
                />
            ))}
        </>
    );

    box.replaceChildren(frag);
    atchAllTgl(box);
    aplyBlogLyt();
}

/**
 * Mount calendar, resets some stuff.
 * @param {HTMLDivElement} slot
 * @param {HTMLDivElement} box
 * @param {readonly Pst[]} psts
 * @returns {void}
 */
function mntCal(slot: HTMLDivElement, box: HTMLDivElement, psts: readonly Pst[]): void {
    const yrs = mkYrOpts(psts);
    const has = mkHasFn(psts);
    const authorSlot = ensAthSlot(slot);
    const initialSel = mkInitialCalSel(psts);

    authorOff = mkDefAthOff();
    curCalSel = initialSel;
    wireAthFilt(authorSlot, box);

    if (calCtl) {
        calCtl.destroy();
        calCtl = null;
    }

    calCtl = new CalCtrl({
        host: slot,
        ttl: "Browse by date",
        yrs,
        has,
        onChg: (sel) => {
            curCalSel = sel;
            rndAthFilt(authorSlot, psts, sel);
            rndBlog(box, psts, sel, authorOff);
            syncCurFiltSum();
        }
    });

    calCtl.init();
    calCtl.setSel(flatSel(initialSel));
    rndAthFilt(authorSlot, psts, curCalSel);
    rndBlog(box, psts, curCalSel, authorOff);
    syncCurFiltSum();
}

/**
 * Non calendar render path.
 * @param {HTMLDivElement} box
 * @param {readonly Pst[]} psts
 * @returns {void}
 */
function rndStd(box: HTMLDivElement, psts: readonly Pst[]): void {
    const rows = psts.map((pst) => render2Mkup(<PstCard pst={pst} exp={false} />));

    if (!blogClstr) {
        blogClstr = new Clusteriser(box);
        void blogClstr.init().then(() => {
            blogClstr?.update(rows);
            window.requestAnimationFrame(() => {
                atchAllTgl(box);
                trgAdjOnTgl();
                setDynScr();
                window.setTimeout(() => adjScrHgt(), 100);
            });
        });
        return;
    }

    blogClstr.update(rows);

    window.requestAnimationFrame(() => {
        atchAllTgl(box);
        trgAdjOnTgl();
        setDynScr();
        window.setTimeout(() => adjScrHgt(), 100);
    });
}

/**
 * Oops screen.
 * @param {HTMLDivElement} box
 * @param {unknown} err
 * @returns {void}
 */
function rndErr(box: HTMLDivElement, err: unknown): void {
    console.error(err);

    const frag = render2Frag(
        <EmptyBlk
            ttl="The blog feed could not be loaded"
            body="Please refresh the page or try again in a moment."
        />
    );

    box.replaceChildren(frag);
    aplyBlogLyt();
}

/**
 * Target posts while cal exists.
 * @param {HTMLDivElement} box
 * @param {HTMLDivElement} cal
 * @param {readonly Pst[]} psts
 * @param {readonly Pst[]} tgts
 * @param {string | null} jumpId
 * @returns {void}
 */
function rndTgtsCal(
    box: HTMLDivElement,
    cal: HTMLDivElement,
    psts: readonly Pst[],
    tgts: readonly Pst[],
    jumpId: string | null = null
): void {
    const authorSlot = ensAthSlot(cal);

    prepTgts(psts, tgts, jumpId);
    rndAthFilt(authorSlot, psts, curCalSel);
    rndBlog(box, psts, curCalSel, authorOff);
    syncCurFiltSum();
}

/**
 * Load rss and draw stuff.
 * @returns {Promise<void>}
 */
async function loadBlog(): Promise<void> {
    const rs = ensBlogWrap();
    if (!rs) return;

    const { box, cal } = rs;
    box.innerHTML = "";

    try {
        void initRssComments();

        const rsp = await fetch(`${cfg.RSS_BACKEND_URL}`);
        if (!rsp.ok) {
            throw new Error(`RSS fetch error: ${rsp.status} ${rsp.statusText}`);
        }

        const xml = await rsp.text();
        allPsts = pstsForCurPage(mkPsts(prsRss(xml)));

        const requestedPostRef = getReqPstRef();
        const requestedJumpId = requestedPostRef ? getReqJumpId() : null;
        const requestedPosts = findByPstRef(allPsts, requestedPostRef);

        if (requestedPosts.length > 0) {
            prepTgts(allPsts, requestedPosts, requestedJumpId);
        }

        if (isResourcePth()) {
            rndResources(box, allPsts);
            return;
        }

        const hasCalendar = cal instanceof HTMLDivElement;

        if (hasCalendar) mntCal(cal, box, allPsts);
        if (hasCalendar && requestedPosts.length > 0) {
            rndTgtsCal(box, cal, allPsts, requestedPosts, requestedJumpId);
        }
        if (hasCalendar) return;

        if (isBlogPth()) {
            rndBlog(box, allPsts, curCalSel, authorOff);
            return;
        }

        rndStd(box, allPsts);
    } catch (err: unknown) {
        rndErr(box, err);
    }
}

window.addEventListener("DOMContentLoaded", () => {
    aplyBlogLyt();
    void loadBlog();
});
