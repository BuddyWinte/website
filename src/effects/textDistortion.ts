import {
    TEXT_SHADOW_FRAME_STEP,
    TEXT_SHADOW_KEYFRAMES_STYLE_ID,
    TEXT_SHADOW_RANDOM_SEED
} from "./config.ts";
import {
    cssNum,
    textShadowScale
} from "./math.ts";

let textShadowObserver: MutationObserver | null = null;
let windowBorderThemeObserver: MutationObserver | null = null;

export function applyTextShadowScale(intensity: number): void {
    const multiplier =
        document.documentElement.classList.contains("dark-mode")
            ? 2.13
            : 1;

    const scale =
        textShadowScale(intensity) *
        multiplier;

    document.documentElement.style.setProperty(
        "--effect-crt-text-shadow-scale",
        cssNum(scale)
    );
}


function createRandomGenerator(initialSeed: number): () => number {
    let state = initialSeed >>> 0;

    return (): number => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;

        return (state >>> 0) / 4294967296;
    };
}

/**
 * Rounds a number to one decimal place.
 *
 * @param {number} value
 * @returns {number}
 */
function oneDecimal(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Builds the deterministic CRT text-shadow animation.
 *
 * The frame cadence stays at 5%, but the jitter values are generated rather
 * than hand-written. Each multiplier is rounded to one decimal place.
 *
 * The generated frames use the stylesheet's base distance, blur and RGB alpha
 * variables, multiplied by the live intensity scale written by apply().
 *
 * @returns {string}
 */
function buildTextShadowKeyframes(): string {
    const random = createRandomGenerator(TEXT_SHADOW_RANDOM_SEED);
    const frames: string[] = [];

    for (
        let percent = 0;
        percent <= 100;
        percent += TEXT_SHADOW_FRAME_STEP
    ) {
        const jitter = oneDecimal(random());
        const jitterText = jitter.toFixed(1);

        frames.push(`
${String(percent)}% {
  text-shadow:
    calc(
      var(--effect-crt-text-shadow-distance) *
      var(--effect-crt-text-shadow-scale, 1) *
      ${jitterText}
    )
    0
    1px
    rgb(
      0 30 255 /
      calc(
        var(--effect-crt-text-shadow-blue-alpha) *
        var(--effect-crt-text-shadow-scale, 1)
      )
    ),

    calc(
      var(--effect-crt-text-shadow-distance) *
      var(--effect-crt-text-shadow-scale, 1) *
      -${jitterText}
    )
    0
    1px
    rgb(
      255 0 80 /
      calc(
        var(--effect-crt-text-shadow-red-alpha) *
        var(--effect-crt-text-shadow-scale, 1)
      )
    ),

    0
    0
    calc(
      var(--effect-crt-text-shadow-blur) *
      var(--effect-crt-text-shadow-scale, 1)
    );
}`);
    }

    return `
@keyframes effect-crt-text-shadow {
${frames.join("\n\n")}
}
`.trim();
}

/**
 * Builds the deterministic CRT chromatic-aberration animation for SVGs.
 *
 * SVG geometry does not respond to `text-shadow`, so this mirrors the text
 * effect using CSS `filter: drop-shadow()`.
 *
 * The frame cadence and pseudo-random jitter sequence intentionally match
 * `buildTextShadowKeyframes()` so text and SVG graphics distort in sync.
 *
 * The generated frames use the same stylesheet distance and RGB alpha
 * variables, multiplied by the live intensity scale written by apply().
 *
 * @returns {string}
 */
function buildSvgShadowKeyframes(): string {
    const random = createRandomGenerator(TEXT_SHADOW_RANDOM_SEED);
    const frames: string[] = [];

    for (
        let percent = 0;
        percent <= 100;
        percent += TEXT_SHADOW_FRAME_STEP
    ) {
        const jitter = oneDecimal(random());
        const jitterText = jitter.toFixed(1);

        frames.push(`
${String(percent)}% {
  filter:
    drop-shadow(
      calc(
        var(--effect-crt-text-shadow-distance) *
        var(--effect-crt-text-shadow-scale, 1) *
        ${jitterText}
      )
      0
      1px
      rgb(
        0 30 255 /
        calc(
          var(--effect-crt-text-shadow-blue-alpha) *
          var(--effect-crt-text-shadow-scale, 1)
        )
      )
    )

    drop-shadow(
      calc(
        var(--effect-crt-text-shadow-distance) *
        var(--effect-crt-text-shadow-scale, 1) *
        -${jitterText}
      )
      0
      1px
      rgb(
        255 0 80 /
        calc(
          var(--effect-crt-text-shadow-red-alpha) *
          var(--effect-crt-text-shadow-scale, 1)
        )
      )
    );
}`);
    }

    return `
@keyframes effect-crt-svg-shadow {
${frames.join("\n\n")}
}
`.trim();
}

/**
 * Builds the matching CRT animation for window border boxes.
 *
 * Unlike the SVG/image effect this animates box-shadow, so only the window's
 * outer frame is distorted. Child content keeps its existing text/object CRT
 * treatment and is not filtered again.
 *
 * @returns {string}
 */
function buildWindowBorderShadowKeyframes(): string {
    const random = createRandomGenerator(TEXT_SHADOW_RANDOM_SEED);
    const frames: string[] = [];

    for (
        let percent = 0;
        percent <= 100;
        percent += TEXT_SHADOW_FRAME_STEP
    ) {
        const jitter = oneDecimal(random());
        const jitterText = jitter.toFixed(1);

        frames.push(`
${String(percent)}% {
  box-shadow:
    var(
      --effect-crt-window-base-shadow,
      0 0 0 0 transparent
    ),

    calc(
      var(--effect-crt-text-shadow-distance) *
      var(--effect-crt-text-shadow-scale, 1) *
      ${jitterText}
    )
    0
    1px
    rgb(
      0 30 255 /
      calc(
        var(--effect-crt-text-shadow-blue-alpha) *
        var(--effect-crt-text-shadow-scale, 1)
      )
    ),

    calc(
      var(--effect-crt-text-shadow-distance) *
      var(--effect-crt-text-shadow-scale, 1) *
      -${jitterText}
    )
    0
    1px
    rgb(
      255 0 80 /
      calc(
        var(--effect-crt-text-shadow-red-alpha) *
        var(--effect-crt-text-shadow-scale, 1)
      )
    );
}`);
    }

    return `
@keyframes effect-crt-window-border-shadow {
${frames.join("\n\n")}
}
`.trim();
}


/**
 * Elements whose contents are not ordinary rendered page text.
 */
const TEXT_SHADOW_SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE"
]);

/**
 * @param {Element} node
 * @returns {boolean}
 */
function isWindowFrame(node: Element): boolean {
    if (node.classList.contains("window-frame")) return true;

    return (
        node instanceof HTMLDivElement &&
        node.classList.contains("window")
    );
}

/**
 * Captures the window's real theme shadow before the CRT animation takes
 * ownership of box-shadow.
 *
 * @param {HTMLElement} frame
 * @returns {void}
 */
function syncBoxBaseShadow(box: HTMLElement): void {
    const hadWindowClass =
        box.classList.contains("crt-window-border");

    const hadMenuClass =
        box.classList.contains("crt-menu-button-border");

    box.classList.remove(
        "crt-window-border",
        "crt-menu-button-border"
    );

    const computed =
        globalThis.getComputedStyle(box).boxShadow;

    box.style.setProperty(
        "--effect-crt-window-base-shadow",
        computed === "none"
            ? "0 0 0 0 transparent"
            : computed
    );

    if (hadWindowClass) {
        box.classList.add("crt-window-border");
    }

    if (hadMenuClass) {
        box.classList.add("crt-menu-button-border");
    }
}

/**
 * Marks a window border without applying the filter to its contents.
 *
 * @param {Element} node
 * @returns {void}
 */
function markWindowBorder(node: Element): void {
    if (!isWindowFrame(node)) return;
    if (!(node instanceof HTMLElement)) return;
    if (node.classList.contains("crt-window-border")) return;

    syncBoxBaseShadow(node);
    node.classList.add("crt-window-border");
}

/**
 * Marks main-menu anchor buttons for border-box CRT distortion without
 * filtering their already-distorted text or SVG icon contents.
 *
 * @param {Element} node
 * @returns {void}
 */
function markMenuButtonBorder(node: Element): void {
    if (!(node instanceof HTMLAnchorElement)) return;
    if (!node.matches("#main-menu-links > a")) return;
    if (node.classList.contains("crt-menu-button-border")) return;

    syncBoxBaseShadow(node);
    node.classList.add("crt-menu-button-border");
}

/**
 * Re-samples window shadows after a theme/root class change.
 *
 * @returns {void}
 */
function syncWindowBorderShadows(): void {
    const frames = document.querySelectorAll<HTMLElement>(
        ".crt-window-border, .crt-menu-button-border"
    );

    frames.forEach(syncBoxBaseShadow);
}

/**
 * Watches the theme-bearing root/body classes so animated window borders keep
 * the correct base shadow after a live theme or light/dark-mode change.
 *
 * @returns {void}
 */
function ensureWindowBorderThemeObserver(): void {
    if (windowBorderThemeObserver) return;

    windowBorderThemeObserver =
        new MutationObserver(syncWindowBorderShadows);

    windowBorderThemeObserver.observe(
        document.documentElement,
        {
            attributes: true,
            attributeFilter: ["class"]
        }
    );

    windowBorderThemeObserver.observe(
        document.body,
        {
            attributes: true,
            attributeFilter: ["class"]
        }
    );
}

/**
 * Resolves the element that should carry the CRT text-shadow animation
 * for one text node.
 *
 * Animated emoticons use their wrapper so the CRT animation does not
 * overwrite their own blink animation.
 *
 * @param {Node} node
 * @returns {HTMLElement | null}
 */
function textShadowTarget(node: Node): HTMLElement | null {
    if (node.nodeType !== Node.TEXT_NODE) return null;
    if (!(node.nodeValue?.trim())) return null;

    const parent = node.parentElement;
    if (!parent) return null;

    const counterShell = parent.closest(".clicker-counter__face-shell");

    if (counterShell instanceof HTMLElement) {
        return counterShell;
    }

    if (parent.closest("svg")) return null;
    if (TEXT_SHADOW_SKIP_TAGS.has(parent.tagName)) return null;

    const blink = parent.closest(".emoticon-blink");

    return blink instanceof HTMLElement
        ? blink
        : parent;
}

/**
 * Marks one text node for the CRT text-shadow effect.
 *
 * @param {Node} node
 * @returns {void}
 */
function markTextShadowNode(node: Node): void {
    if (node instanceof Element) {
        markWindowBorder(node);
        markMenuButtonBorder(node);
    }

    if (
        node instanceof SVGSVGElement ||
        node instanceof HTMLImageElement
    ) {
        node.classList.add("text-shadow");
        return;
    }

    const target = textShadowTarget(node);
    if (!target) return;

    target.classList.add("text-shadow");
}

/**
 * Marks all text below one DOM node.
 *
 * @param {Node} root
 * @returns {void}
 */
function markTextShadowTargets(root: Node): void {
    markTextShadowNode(root);

    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT |
        NodeFilter.SHOW_ELEMENT
    );

    for (
        let node = walker.nextNode();
        node;
        node = walker.nextNode()
    ) {
        markTextShadowNode(node);
    }
}

/**
 * Handles one DOM mutation.
 *
 * @param {MutationRecord} mutation
 * @returns {void}
 */
function handleTextShadowMutation(mutation: MutationRecord): void {
    if (mutation.type === "characterData") {
        markTextShadowNode(mutation.target);
        return;
    }

    mutation.addedNodes.forEach(markTextShadowTargets);
}

/**
 * Marks existing text and watches for text added later.
 *
 * @returns {void}
 */
export function ensureTextShadowTargets(): void {
    markTextShadowTargets(document.body);
    ensureWindowBorderThemeObserver();

    if (textShadowObserver) return;

    textShadowObserver = new MutationObserver((mutations) => {
        mutations.forEach(handleTextShadowMutation);
    });

    textShadowObserver.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
    });
}

/**
 * Installs the generated CRT text-shadow keyframes once.
 *
 * @returns {void}
 */
export function ensureTextShadowKeyframes(): void {
    if (document.getElementById(TEXT_SHADOW_KEYFRAMES_STYLE_ID)) {
        return;
    }

    const styleElement = document.createElement("style");

    styleElement.id = TEXT_SHADOW_KEYFRAMES_STYLE_ID;
    styleElement.textContent = [
        buildTextShadowKeyframes(),
        buildSvgShadowKeyframes(),
        buildWindowBorderShadowKeyframes()
    ].join("\n\n");

    document.head.appendChild(styleElement);
}


