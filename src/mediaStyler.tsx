import type { ReactElement } from "react";
import { smsEnterBounce } from "./physics.ts";
import { render2Mkup } from "./reactHelpers.tsx";
import * as helpers from "./helpers.ts";

const thms: Record<string, unknown> = {};

type TipState = Readonly<{
    wrapperEl: HTMLElement;
    triggerEl: HTMLElement;
    portalEl: HTMLElement;
}>;

type HtmlBits = Readonly<{
    __html: string;
}>;

/**
 * Tiny helper for dangerouslySetInnerHTML.
 * yes the name is boring, sorry.
 * @param {string} raw
 * @returns {HtmlBits}
 */
function html(raw: string): HtmlBits {
    return { __html: raw };
}

/**
 * Loads the themes json and swaps the in-memory map over.
 * pretty plain fetch really.
 * @param {string} url
 * @returns {Promise<void>}
 */
async function loadThms(url: string = "../data/themes.json"): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load themes from ${url}`);

    const data: unknown = await res.json();

    for (const key of Object.keys(thms)) delete thms[key];
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) thms[key] = value;
}

/**
 * Looks up the theme for an email address.
 * empty string if nothing matches.
 * @param {string} addr
 * @returns {string}
 */
function getThm(addr: string): string {
    const a = addr.toLowerCase();

    for (const [theme, addrsRaw] of Object.entries(thms)) {
        const addrs = addrsRaw as readonly string[];
        if (!addrs.some((x) => x.toLowerCase() === a)) continue;
        return theme;
    }

    return "";
}

/**
 * Serialises mixed node content into one html-ish string.
 * text gets escaped, elements keep their outer html.
 * @param {Node} node
 * @returns {string}
 */
export function serialiseMixedContent(node: Node): string {
    return Array.from(node.childNodes)
        .map((n) => {
            switch (n.nodeType) {
                case 3:
                    return helpers.escapeHtml(n.textContent || "");
                case 1:
                    return (n as Element).outerHTML;
                default:
                    return "";
            }
        })
        .join("")
        .trim();
}

/**
 * Checks if a stylesheet is already around.
 * name is a bit wonky but the job is simple enough.
 * @param {string} cssHref
 * @returns {boolean | Element | null}
 */
function hasCss(cssHref: string): boolean | Element | null {
    return (
        Array.from(document.styleSheets).some((s) => (s.href || "").includes(cssHref)) ||
        document.querySelector(`link[rel="stylesheet"][href="${cssHref}"]`)
    );
}

/**
 * Gets the trimmed text of the first matching tag inside a node.
 * blank string if missing.
 * @param {ParentNode} node
 * @param {string} tag
 * @returns {string}
 */
function txt(node: ParentNode, tag: string): string {
    return (node.querySelector(tag)?.textContent || "").trim();
}

/**
 * Finds the first direct child whose tag matches one from the list.
 * direct child only, not deep search.
 * @param {Element} parent
 * @param {readonly string[]} tagNames
 * @returns {Element | null}
 */
function getKidByTag(parent: Element, tagNames: readonly string[]): Element | null {
    for (const child of Array.from(parent.children)) {
        const tag = child.tagName.toLowerCase();
        if (tagNames.includes(tag)) return child;
    }

    return null;
}

type Escaper = (s: string | null | undefined) => string;

/**
 * Pulls rich content nodes out as serialised html strings.
 * escFn is only here to keep the old shape, not actually used.
 * @param {ParentNode} root
 * @param {string} selector
 * @param {Escaper} escFn
 * @returns {string[]}
 */
function mapRich(root: ParentNode, selector: string, escFn: Escaper): string[] {
    void escFn;

    return Array.from(root.querySelectorAll(selector))
        .map((n) => serialiseMixedContent(n))
        .filter(Boolean);
}

/**
 * React bit for a parsed email signature.
 * @param {{ logo: string; company: string; lines: string[]; disclaimers: string[] }} props
 * @returns {ReactElement}
 */
function Sig(props: {
    logo: string;
    company: string;
    lines: string[];
    disclaimers: string[];
}): ReactElement {
    return (
        <>
            <hr className="email-signature-sep" />
            <div className="email-signature">
                {props.logo && (
                    <div className="email-signature-logo">
                        <img
                            src={props.logo}
                            alt={props.company || "Company logo"}
                            className="email-signature-logo-img"
                        />
                    </div>
                )}

                <div className="email-signature-text">
                    <div dangerouslySetInnerHTML={html(props.lines.join("<br/>"))} />
                    {props.disclaimers.length > 0 && (
                        <div className="email-signature-disclaimer">
                            {props.disclaimers.map((d, i) => (
                                <div
                                    key={`disc-${i}`}
                                    className="email-signature-disclaimer-line"
                                    dangerouslySetInnerHTML={html(d)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

/**
 * Turns a <signature> node into rendered html.
 * if the thing is basically empty, returns an empty string and moves on.
 * @param {Element} sig
 * @param {Escaper} escFn
 * @returns {string}
 */
function parseSig(sig: Element, escFn: Escaper): string {
    const t = (q: string): string => (sig.querySelector(q)?.textContent || "").trim();

    const name = t("name");
    const company = t("company");
    const address = t("address");
    const telephone = t("telephone");
    const emailAddress = t("emailAddress");
    const logo = (t("logo") || "").trim();

    const positions = mapRich(sig, "position", escFn);
    const disclaimers = mapRich(sig, "disclaimer", escFn);

    const hasAny =
        name ||
        positions.length ||
        company ||
        address ||
        telephone ||
        emailAddress ||
        logo ||
        disclaimers.length;

    if (!hasAny) return "";

    const lines = [
        name && `<strong class="email-signature-name">${helpers.escapeHtml(name)}</strong>`,
        ...positions.map((p) => `<span class="email-signature-position">${p}</span>`),
        company && `<span class="email-signature-company">${helpers.escapeHtml(company)}</span>`,
        address && `<span class="email-signature-address">${helpers.escapeHtml(address)}</span>`,
        telephone && `<span class="email-signature-telephone">Tel: ${helpers.escapeHtml(telephone)}</span>`,
        emailAddress && `<span class="email-signature-email">Email: ${helpers.escapeHtml(emailAddress)}</span>`
    ].filter(Boolean) as string[];

    return render2Mkup(
        <Sig
            logo={logo}
            company={company}
            lines={lines}
            disclaimers={disclaimers}
        />
    );
}

type ReplSms = (htmlContent: string, cssHref?: string) => string;
type ReplEmails = (htmlContent: string, cssHref?: string) => Promise<string>;
type ReplSvgs = (root?: Document | Element | string) => Promise<void>;
type ReplTips = (htmlContent: string) => Promise<string>;
type BindMailActs = () => void;

type Impls = Readonly<{
    replaceSmsMessages: ReplSms;
    replaceEmails: ReplEmails;
    replaceSVGs: ReplSvgs;
    replaceImageTags: (htmlContent: string) => Promise<string>;
    replaceTooltips: ReplTips;
    bindEmailActions: BindMailActs;
}>;

type ImplOverrides = Partial<{
    replaceSmsMessages: ReplSms;
    replaceEmails: ReplEmails;
    replaceSVGs: ReplSvgs;
    replaceImageTags: (htmlContent: string) => Promise<string>;
    replaceTooltips: ReplTips;
    bindEmailActions: BindMailActs;
}>;

/**
 * React bit for one sms bubble.
 * @param {{ type: "in" | "out"; nickname: string; contentHtml: string; timestamp: string }} props
 * @returns {ReactElement}
 */
function Sms(props: {
    type: "in" | "out";
    nickname: string;
    contentHtml: string;
    timestamp: string;
}): ReactElement {
    return (
        <div className={`message-wrapper ${props.type} show`}>
            <div className={`message ${props.type}`}>
                <div className="nickname-strip">{props.nickname}</div>
                <div className="message-text" dangerouslySetInnerHTML={html(props.contentHtml)} />
                <div className={`timestamp ${props.type}`}>{props.timestamp}</div>
            </div>
        </div>
    );
}

/**
 * Replaces custom <message> blocks with the sms markup.
 * also makes sure the sms stylesheet exists first.
 * @param {string} htmlContent
 * @param {string} cssHref
 * @returns {string}
 */
function replSms(htmlContent: string, cssHref: string = "../styles/modules/sms.css"): string {
    if (!hasCss(cssHref)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssHref;
        document.head.appendChild(link);
    }

    const re = /<message\b[^>]*\btype=["'](in|out)["'][^>]*>[\s\S]*?<\/message>/gi;

    return htmlContent.replace(re, (block: string, typeRaw: string) => {
        const type = (typeRaw || "").trim().toLowerCase();
        if (type !== "in" && type !== "out") return block;

        const doc = new DOMParser().parseFromString(`<root>${block}</root>`, "application/xml");
        const msg = doc.querySelector("message");
        if (!msg) return block;

        const nickname = txt(msg, "nickname");
        const contentNode = getKidByTag(msg, ["content"]);
        const contentHtml = contentNode ? serialiseMixedContent(contentNode) : "";
        const timestamp = txt(msg, "timestamp");

        return render2Mkup(
            <Sms
                type={type}
                nickname={nickname}
                contentHtml={contentHtml}
                timestamp={timestamp}
            />
        );
    });
}

/**
 * React bit for one rendered email card.
 * @param {{ themeClass: string; recipientIp: string; fromNameHtml: string; fromAddr: string; toNameHtml: string; toAddr: string; subject: string; timestamp: string; contentHtml: string }} props
 * @returns {ReactElement}
 */
function Mail(props: {
    themeClass: string;
    recipientIp: string;
    fromNameHtml: string;
    fromAddr: string;
    toNameHtml: string;
    toAddr: string;
    subject: string;
    timestamp: string;
    contentHtml: string;
}): ReactElement {
    const className = props.themeClass ? `email-card ${props.themeClass}` : "email-card";

    return (
        <div className="email-wrapper show">
            <div className={className} data-recipient-ip={props.recipientIp}>
                <div className="email-header">
                    <div className="email-meta">
                        <div className="email-row">
                            <span className="email-label">From</span>
                            <span className="email-value">
                                <span className="email-name" dangerouslySetInnerHTML={html(props.fromNameHtml)} />
                                <span className="email-address">({props.fromAddr})</span>
                            </span>
                        </div>

                        <div className="email-row">
                            <span className="email-label">To</span>
                            <span className="email-value">
                                <span className="email-name" dangerouslySetInnerHTML={html(props.toNameHtml)} />
                                <span className="email-address">({props.toAddr})</span>
                            </span>
                        </div>

                        <div className="email-row email-subject-row">
                            <span className="email-label">Subject</span>
                            <span className="email-subject-text">{props.subject}</span>
                            <span className="email-timestamp">{props.timestamp}</span>
                        </div>
                    </div>

                    <div className="email-actions-bar" role="toolbar">
                        <div className="email-actions">
                            <button className="email-action" data-email-action="reply">↩️</button>
                            <button className="email-action" data-email-action="forward">➡️</button>
                            <button className="email-action" data-email-action="flag">🚩</button>
                            <button className="email-action" data-email-action="archive">🗄️</button>
                            <button className="email-action" data-email-action="delete">🗑️</button>
                        </div>
                    </div>
                </div>

                <div className="email-content" dangerouslySetInnerHTML={html(props.contentHtml)} />
            </div>
        </div>
    );
}

/**
 * Replaces custom <email> blocks with the styled email card html.
 * loads themes on first go if they are not already there.
 * @param {string} htmlContent
 * @param {string} cssHref
 * @returns {Promise<string>}
 */
async function replEmails(htmlContent: string, cssHref: string = "../styles/modules/email.css"): Promise<string> {
    if (!hasCss(cssHref)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = cssHref;
        document.head.appendChild(link);
    }

    if (Object.keys(thms).length === 0) {
        try {
            await loadThms();
        } catch (err: unknown) {
            console.error("Failed to load themes:", err);
        }
    }

    /**
     * Builds the email body html from just the email's own content block.
     * signatures get the special treatment, the rest mostly passes through.
     * @param {Element} emailNode
     * @returns {string}
     */
    const buildContentHtml = (emailNode: Element): string => {
        const contentEl = getKidByTag(emailNode, ["content"]);
        if (!contentEl) return "";

        return Array.from(contentEl.childNodes)
            .map((n) => {
                switch (n.nodeType) {
                    case 1: {
                        const el = n as Element;
                        const tag = el.tagName.toLowerCase();
                        return tag === "signature" ? parseSig(el, helpers.escapeHtml) : el.outerHTML;
                    }
                    case 3:
                        return helpers.escapeHtml(n.textContent || "");
                    default:
                        return "";
                }
            })
            .join("");
    };

    const re = /<email\b[^>]*>[\s\S]*?<\/email>/gi;

    return htmlContent.replace(re, (block: string) => {
        const doc = new DOMParser().parseFromString(`<root>${block}</root>`, "application/xml");
        const email = doc.querySelector("email");
        if (!email) return block;

        const from = email.querySelector("from");
        const to = email.querySelector("to");

        const fromNameEl = from?.querySelector("name");
        const toNameEl = to?.querySelector("name");

        const fromNameHtml = fromNameEl
            ? serialiseMixedContent(fromNameEl)
            : helpers.escapeHtml(from ? txt(from, "name") : "");

        const fromAddr = from ? txt(from, "addr") : "";

        const toNameHtml = toNameEl
            ? serialiseMixedContent(toNameEl)
            : helpers.escapeHtml(to ? txt(to, "name") : "");

        const toAddr = to ? txt(to, "addr") : "";
        const themeClass = getThm(toAddr);
        const recipientIp = txt(email, "toIp") || "";
        const timestamp = txt(email, "timestamp");
        const subject = txt(email, "subject");
        const contentHtml = buildContentHtml(email);

        return render2Mkup(
            <Mail
                themeClass={themeClass}
                recipientIp={recipientIp}
                fromNameHtml={fromNameHtml}
                fromAddr={fromAddr}
                toNameHtml={toNameHtml}
                toAddr={toAddr}
                subject={subject}
                timestamp={timestamp}
                contentHtml={contentHtml}
            />
        );
    });
}

/**
 * Inlines svg <img> tags by fetching the svg text and swapping the node.
 * string input gets wrapped in a temp div first.
 * @param {Document | Element | string} root
 * @returns {Promise<void>}
 */
async function replSvgs(root: Document | Element | string = document): Promise<void> {
    let doneRoot: Document | Element | null = null;

    if (typeof root === "string") {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = root;
        doneRoot = wrapper;
    }

    if (root instanceof Document || root instanceof Element) {
        doneRoot = root;
    }

    if (!doneRoot) return;

    const images = Array.from(doneRoot.querySelectorAll("img"));

    for (const img of images) {
        const src = img.getAttribute("src");
        if (!src || !src.endsWith(".svg")) continue;

        try {
            const res = await fetch(src);
            if (!res.ok) continue;

            const svgText = await res.text();
            const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
            const svg = doc.querySelector("svg");
            if (!svg) continue;

            if (img.className) svg.classList.add(...img.classList);

            const style = img.getAttribute("style");
            if (style) svg.setAttribute("style", style);

            const width = img.getAttribute("width");
            if (width) svg.setAttribute("width", width);

            const height = img.getAttribute("height");
            if (height) svg.setAttribute("height", height);

            img.replaceWith(svg);
        } catch (err: unknown) {
            console.warn("inlineSvgs failed:", src, err);
        }
    }
}

const CH_IMG_FALLBACK_SRC = "/images/fallback-image.png";
const CH_IMG_FALLBACK_ALT = "Image not found";
const CH_IMG_FALLBACK_SIZE = 256;

let chImgFallbackOn = false;

/**
 * Swaps a broken chapter image over to the fallback.
 * only does it once per image.
 * @param {HTMLImageElement} image
 * @returns {void}
 */
function setChImgFallback(image: HTMLImageElement): void {
    if (image.dataset.fallbackApplied === "true") return;

    const currentSrc = image.getAttribute("src") || image.currentSrc || "";
    if (currentSrc.includes(CH_IMG_FALLBACK_SRC)) return;

    image.dataset.fallbackApplied = "true";
    image.src = CH_IMG_FALLBACK_SRC;
    image.alt = CH_IMG_FALLBACK_ALT;
    image.width = CH_IMG_FALLBACK_SIZE;
    image.setAttribute("width", `${CH_IMG_FALLBACK_SIZE}`);
    image.style.width = `${CH_IMG_FALLBACK_SIZE}px`;
}

/**
 * Installs the global broken-image handler for chapter images.
 * @returns {void}
 */
function ensureChImgFallback(): void {
    if (chImgFallbackOn) return;
    chImgFallbackOn = true;

    document.addEventListener("error", (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;
        if (!target.classList.contains("chapter-image")) return;

        setChImgFallback(target);
    }, true);
}

/**
 * React bit for one chapter image block.
 * @param {{ src: string; alt: string; }} props
 * @returns {ReactElement}
 */
function ChImg(props: { src: string; alt: string }): ReactElement {
    return (
        <div className="chapter-image-container">
            <img
                src={props.src.trim()}
                alt={props.alt.trim()}
                className="chapter-image"
                loading="lazy"
            />
        </div>
    );
}

/**
 * Replaces custom <chapter-image> tags with regular image markup.
 * also makes sure the fallback handling exists first.
 * @param {string} htmlContent
 * @returns {Promise<string>}
 */
async function replImgs(htmlContent: string): Promise<string> {
    ensureChImgFallback();

    const re = /<chapter-image\b[^>]*?(?:\/>|>[\s\S]*?<\/chapter-image>)/gi;

    return htmlContent.replace(re, (block: string) => {
        const doc = new DOMParser().parseFromString(`<root>${block}</root>`, "application/xml");
        const imageEl = doc.querySelector("chapter-image");
        if (!imageEl) return block;

        const url = (imageEl.getAttribute("url") || imageEl.getAttribute("src") || "").trim();
        if (!url) return block;

        const altAttr = (imageEl.getAttribute("alt") || "").trim();
        const altFromText = (imageEl.textContent || "").trim();
        const alt = altAttr || altFromText || "Chapter Image";

        return render2Mkup(<ChImg src={url} alt={alt} />);
    });
}

const TIP_PORTAL_ID = "tooltip-portal";

let tipOn = false;
let tipState: TipState | null = null;

/**
 * Gets or creates the tooltip portal host in the body.
 * @returns {HTMLDivElement}
 */
function needTipHost(): HTMLDivElement {
    const existing = document.getElementById(TIP_PORTAL_ID);
    if (existing instanceof HTMLDivElement) return existing;

    const host = document.createElement("div");
    host.id = TIP_PORTAL_ID;
    host.style.position = "fixed";
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = "0";
    host.style.height = "0";
    host.style.pointerEvents = "none";
    host.style.overflow = "visible";
    host.style.zIndex = "9999";
    document.body.appendChild(host);
    return host;
}

/**
 * Parses a css time string into milliseconds.
 * @param {string} raw
 * @returns {number}
 */
function cssMs(raw: string): number {
    const s = raw.trim();
    if (!s) return 0;
    if (s.endsWith("ms")) return Number.parseFloat(s);
    if (s.endsWith("s")) return Number.parseFloat(s) * 1000;
    return Number.parseFloat(s);
}

/**
 * Tries to work out the tooltip fade duration in ms.
 * falls back to a small default if css gives nothing useful.
 * @param {HTMLElement} el
 * @returns {number}
 */
function getTipFadeMs(el: HTMLElement): number {
    const cssVar = getComputedStyle(el).getPropertyValue("--tooltip-fade-duration");
    const fromVar = cssMs(cssVar);
    if (Number.isFinite(fromVar) && fromVar > 0) return fromVar;

    const first = (getComputedStyle(el).transitionDuration.split(",")[0] || "").trim();
    const fromTransition = cssMs(first);
    return Number.isFinite(fromTransition) && fromTransition > 0 ? fromTransition : 160;
}

/**
 * Positions the open tooltip portal near its trigger.
 * flips below if there is no room above.
 * @param {HTMLElement} triggerEl
 * @param {HTMLElement} portalEl
 * @returns {void}
 */
function posTip(triggerEl: HTMLElement, portalEl: HTMLElement): void {
    const gap = 8;
    const pad = 8;
    const maxWidth = Math.max(0, window.innerWidth - (pad * 2));

    const triggerRect = triggerEl.getBoundingClientRect();

    portalEl.classList.remove("below");
    portalEl.style.position = "fixed";
    portalEl.style.left = "0px";
    portalEl.style.top = "0px";
    portalEl.style.maxWidth = `${maxWidth}px`;
    portalEl.style.boxSizing = "border-box";
    portalEl.style.pointerEvents = "auto";
    portalEl.style.overflowWrap = "anywhere";
    portalEl.style.wordBreak = "break-word";
    portalEl.style.whiteSpace = "normal";

    const portalRect = portalEl.getBoundingClientRect();

    let left = triggerRect.left + (triggerRect.width / 2) - (portalRect.width / 2);
    const maxLeft = Math.max(pad, window.innerWidth - portalRect.width - pad);
    left = Math.max(pad, Math.min(left, maxLeft));

    let top = triggerRect.top - portalRect.height - gap;
    const flip = top < pad;

    if (flip) top = triggerRect.bottom + gap;

    portalEl.style.left = `${Math.round(left)}px`;
    portalEl.style.top = `${Math.round(top)}px`;

    if (flip) portalEl.classList.add("below");
}

/**
 * Closes the tooltip portal.
 * can do it instantly or wait for the fade if we have one.
 * @param {{ immediate?: boolean }} opts
 * @returns {void}
 */
function closeTip(opts: { immediate?: boolean } = {}): void {
    const state = tipState;
    if (!state) return;

    const { immediate = false } = opts;
    const portalEl = state.portalEl;
    const portalContent = portalEl.querySelector(".tooltip-content");
    const contentEl = portalContent instanceof HTMLElement ? portalContent : null;

    const cleanup = (): void => {
        if (tipState !== state) return;
        state.wrapperEl.classList.remove("portal-active");
        portalEl.remove();
        tipState = null;
    };

    if (immediate || !contentEl) {
        cleanup();
        return;
    }

    portalEl.classList.remove("show");

    let cleaned = false;

    const finish = (): void => {
        if (cleaned) return;
        cleaned = true;
        portalEl.removeEventListener("transitionend", onEnd);
        cleanup();
    };

    const onEnd = (ev: TransitionEvent): void => {
        if (ev.propertyName !== "opacity") return;
        finish();
    };

    portalEl.addEventListener("transitionend", onEnd);

    window.setTimeout(finish, getTipFadeMs(contentEl) + 50);
}

/**
 * Opens the tooltip content in the portal near the trigger.
 * @param {HTMLElement} triggerEl
 * @returns {void}
 */
function openTip(triggerEl: HTMLElement): void {
    if (!triggerEl.isConnected) return;

    const wrapper = triggerEl.closest(".tooltip");
    if (!(wrapper instanceof HTMLElement)) return;

    const content = wrapper.querySelector(".tooltip-content");
    if (!(content instanceof HTMLElement)) return;

    const existing = tipState;
    if (existing?.triggerEl === triggerEl) return;

    closeTip({ immediate: true });

    const portalHost = needTipHost();

    const portalWrapper = document.createElement("span");
    portalWrapper.className = "tooltip portal";
    portalWrapper.style.position = "fixed";
    portalWrapper.style.display = "block";
    portalWrapper.style.maxWidth = `${Math.max(0, window.innerWidth - 16)}px`;
    portalWrapper.style.boxSizing = "border-box";
    portalWrapper.style.pointerEvents = "auto";

    const portalContent = content.cloneNode(true) as HTMLElement;
    portalContent.style.maxWidth = "100%";
    portalContent.style.boxSizing = "border-box";
    portalContent.style.whiteSpace = "normal";
    portalContent.style.overflowWrap = "anywhere";
    portalContent.style.wordBreak = "break-word";

    portalWrapper.appendChild(portalContent);

    wrapper.classList.add("portal-active");
    portalHost.appendChild(portalWrapper);

    posTip(triggerEl, portalWrapper);

    const viewport = window.visualViewport;
    if (viewport) {
        portalWrapper.style.maxWidth = `${Math.max(0, viewport.width - 16)}px`;
        posTip(triggerEl, portalWrapper);
    }

    tipState = {
        wrapperEl: wrapper,
        triggerEl,
        portalEl: portalWrapper
    };

    requestAnimationFrame(() => {
        if (tipState?.portalEl !== portalWrapper) return;
        portalWrapper.classList.add("show");
    });
}

/**
 * Installs the global tooltip portal handlers once.
 * @returns {void}
 */
function ensureTip(): void {
    if (tipOn) return;
    tipOn = true;

    const findTrigger = (t: EventTarget | null): HTMLElement | null => {
        if (!(t instanceof Element)) return null;
        const el = t.closest(".tooltip-trigger");
        return el instanceof HTMLElement ? el : null;
    };

    const isInsideOpenTip = (t: EventTarget | null): boolean => {
        const state = tipState;
        if (!state) return false;
        if (!(t instanceof Node)) return false;
        return state.triggerEl.contains(t) || state.portalEl.contains(t);
    };

    const hideOnViewportChange = (): void => {
        if (!tipState) return;
        closeTip();
    };

    document.addEventListener("mouseover", (ev: MouseEvent) => {
        const trigger = findTrigger(ev.target);
        if (!trigger) return;
        openTip(trigger);
    });

    document.addEventListener("focusin", (ev: FocusEvent) => {
        const trigger = findTrigger(ev.target);
        if (!trigger) return;
        openTip(trigger);
    });

    document.addEventListener("mouseout", (ev: MouseEvent) => {
        if (!tipState) return;

        const from = ev.target;
        const to = ev.relatedTarget;

        if (!isInsideOpenTip(from)) return;
        if (isInsideOpenTip(to)) return;

        closeTip();
    });

    document.addEventListener("focusout", (ev: FocusEvent) => {
        if (!tipState) return;

        const from = ev.target;
        const to = ev.relatedTarget;

        if (!isInsideOpenTip(from)) return;
        if (isInsideOpenTip(to)) return;

        closeTip();
    });

    document.addEventListener("keydown", (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        closeTip();
    });

    document.addEventListener("scroll", hideOnViewportChange, true);
    window.addEventListener("resize", hideOnViewportChange);

    if (window.visualViewport) {
        window.visualViewport.addEventListener("scroll", hideOnViewportChange);
        window.visualViewport.addEventListener("resize", hideOnViewportChange);
    }
}

/**
 * React bit for the tooltip markup.
 * @param {{ triggerHtml: string; contentHtml: string; isTranslation: boolean }} props
 * @returns {ReactElement}
 */
function Tip(props: {
    triggerHtml: string;
    contentHtml: string;
    isTranslation: boolean;
}): ReactElement {
    const contentClass = `tooltip-content${props.isTranslation ? " translation" : ""}`;

    return (
        <span className="tooltip">
            <span className="tooltip-trigger" dangerouslySetInnerHTML={html(props.triggerHtml)} />
            <span className={contentClass} dangerouslySetInnerHTML={html(props.contentHtml)} />
        </span>
    );
}

/**
 * Replaces custom <tooltip> blocks with the rendered tooltip html.
 * also boots the shared portal wiring.
 * @param {string} htmlContent
 * @returns {Promise<string>}
 */
async function replTips(htmlContent: string): Promise<string> {
    ensureTip();

    const re = /<tooltip\b[^>]*>[\s\S]*?<\/tooltip>/gi;

    /**
     * Serialises one node for the tooltip parser.
     * text is escaped, elements get serialised as xml.
     * @param {Node} n
     * @returns {string}
     */
    const serialise = (n: Node): string => {
        switch (n.nodeType) {
            case 3:
                return helpers.escapeHtml(n.textContent || "");
            case 1:
                return new XMLSerializer().serializeToString(n);
            default:
                return "";
        }
    };

    return htmlContent.replace(re, (block: string) => {
        const doc = new DOMParser().parseFromString(`<root>${block}</root>`, "application/xml");
        const tooltip = doc.querySelector("tooltip");
        if (!tooltip) return block;

        const contentEl = Array.from(tooltip.children).find((n) => n.tagName.toLowerCase() === "content");
        if (!contentEl) return block;

        const isHtml = contentEl.hasAttribute("html");
        const translationAttr = (contentEl.getAttribute("translation") || "").trim().toLowerCase();
        const isTranslation = translationAttr === "true";

        const triggerHtml = Array.from(tooltip.childNodes)
            .filter((n) => n !== contentEl)
            .map(serialise)
            .join("")
            .trim();

        if (!triggerHtml) return block;

        const contentHtml = isHtml
            ? Array.from(contentEl.childNodes)
                .map((n) => new XMLSerializer().serializeToString(n))
                .join("")
            : helpers.escapeHtml(contentEl.textContent || "");

        return render2Mkup(
            <Tip
                triggerHtml={triggerHtml}
                contentHtml={contentHtml}
                isTranslation={isTranslation}
            />
        );
    });
}

declare global {
    interface Window {
        ipAdress?: string;
    }
}

/**
 * Hooks the fake email action buttons.
 * if the ip does not match, it yells instead.
 * @returns {void}
 */
function bindMailActs(): void {
    document.addEventListener("click", (e: MouseEvent) => {
        const target = e.target;
        if (!(target instanceof Element)) return;

        const button = target.closest(".email-action");
        if (!button) return;

        const currentIP = window.ipAdress;
        const emailCard = button.closest(".email-card") as HTMLElement | null;
        const expectedIP = emailCard?.dataset.recipientIp || "";

        if (!currentIP || !expectedIP || currentIP !== expectedIP) {
            const toName =
                emailCard?.querySelector(".email-row:nth-child(2) .email-name")?.textContent?.trim() ||
                "Unknown";

            const toAddr =
                emailCard?.querySelector(".email-row:nth-child(2) .email-address")?.textContent
                    ?.replace(/[()]/g, "")
                    ?.trim() ||
                "unknown";

            alert(`Authentication error: Invalid credentials for ${toName} (${toAddr})`);
            return;
        }

        console.log(`WTH! Who are you?! You performed the email action: ${(button as HTMLElement).dataset.emailAction}`);
    });
}

class MediaStyler {
    private readonly impls: Impls;

    /**
     * Lets you swap internal implementations for tests or odd cases.
     * normal usage probably leaves this alone.
     * @param {ImplOverrides} implOverrides
     * @returns {MediaStyler}
     */
    constructor(implOverrides: ImplOverrides = {}) {
        this.impls = {
            replaceSmsMessages: implOverrides.replaceSmsMessages ?? replSms,
            replaceEmails: implOverrides.replaceEmails ?? replEmails,
            replaceSVGs: implOverrides.replaceSVGs ?? replSvgs,
            replaceImageTags: implOverrides.replaceImageTags ?? replImgs,
            replaceTooltips: implOverrides.replaceTooltips ?? replTips,
            bindEmailActions: implOverrides.bindEmailActions ?? bindMailActs
        };
    }

    /**
     * Replaces sms message tags with styled html.
     * physics decorator still does its little bounce thing.
     * @param {string} htmlContent
     * @param {string} cssHref
     * @returns {string}
     */
    @smsEnterBounce({
        durationMs: 520,
        strength: 1,
        viscosity: 0.7,
        cssHref: "../styles/modules/physics.css",
    })
    replaceSmsMessages(htmlContent: string, cssHref: string = "../styles/modules/sms.css"): string {
        return this.impls.replaceSmsMessages(htmlContent, cssHref);
    }

    /**
     * Replaces email tags with styled email cards.
     * @param {string} htmlContent
     * @param {string} cssHref
     * @returns {Promise<string>}
     */
    replaceEmails(htmlContent: string, cssHref: string = "../styles/modules/email.css"): Promise<string> {
        return this.impls.replaceEmails(htmlContent, cssHref);
    }

    /**
     * Inlines svg images under the given root.
     * @param {Document | Element | string} root
     * @returns {Promise<void>}
     */
    replaceSVGs(root: Document | Element | string = document): Promise<void> {
        return this.impls.replaceSVGs(root);
    }

    /**
     * Replaces <chapter-image> tags with proper image markup.
     * @param {string} htmlContent
     * @returns {Promise<string>}
     */
    replaceImageTags(htmlContent: string): Promise<string> {
        return this.impls.replaceImageTags(htmlContent);
    }

    /**
     * Replaces tooltip tags with the styled tooltip markup.
     * @param {string} htmlContent
     * @returns {Promise<string>}
     */
    replaceTooltips(htmlContent: string): Promise<string> {
        return this.impls.replaceTooltips(htmlContent);
    }

    /**
     * Hooks the email action click handling.
     * @returns {void}
     */
    bindEmailActions(): void {
        this.impls.bindEmailActions();
    }
}

export default MediaStyler;