const FLOAT_BTN_SELS = [
    "#theme-toggle",
    "#effects-toggle",
    "#crt-ui-toggle",
    "#reader-toggle",
    "#read-aloud-toggle"
] as const;

let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let installed = false;
let queued = false;

function px(raw: string, fallback: number = 0): number {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isFloatBtn(button: HTMLButtonElement): boolean {
    if (!button.isConnected) return false;
    if (button.hidden) return false;

    const computed = window.getComputedStyle(button);
    if (computed.display === "none") return false;
    if (computed.visibility === "hidden") return false;
    return true;
}

function getFloatBtns(): readonly HTMLButtonElement[] {
    return FLOAT_BTN_SELS
        .map((selector) => document.querySelector(selector))
        .filter(
            (node): node is HTMLButtonElement =>
                node instanceof HTMLButtonElement
        )
        .filter(isFloatBtn);
}

function getHeight(el: HTMLElement): number {
    const rect = el.getBoundingClientRect();
    if (rect.height > 0) return rect.height;

    const computed = window.getComputedStyle(el);
    const cssHeight = px(computed.height, 0);
    if (cssHeight > 0) return cssHeight;

    return el.offsetHeight;
}

function stackFloatBtns(): void {
    const buttons = getFloatBtns();
    if (buttons.length === 0) return;

    const rootFontSize = px(
        window.getComputedStyle(document.documentElement).fontSize,
        16
    );
    const gapPx = rootFontSize;

    const items = buttons
        .map((button) => {
            const computed = window.getComputedStyle(button);

            return {
                button,
                bottom: px(computed.bottom, 0),
                right: computed.right,
                zIndex: px(computed.zIndex, 0),
                height: getHeight(button)
            };
        })
        .sort((left, right) => left.bottom - right.bottom);

    const sharedRight = items[0]?.right || "0px";
    const sharedZ = String(
        Math.max(...items.map((item) => item.zIndex))
    );

    let nextBottom = items[0]?.bottom || 0;

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const previous = items[index - 1];

        if (previous) nextBottom += previous.height + gapPx;

        item.button.style.right = sharedRight;
        item.button.style.bottom = String(nextBottom) + "px";
        item.button.style.zIndex = sharedZ;
    }
}

function watchFloatBtns(): void {
    resizeObserver?.disconnect();

    if (typeof ResizeObserver === "undefined") return;

    const buttons = getFloatBtns();
    if (buttons.length === 0) return;

    resizeObserver = new ResizeObserver(queueFloatBtns);

    for (const button of buttons) {
        resizeObserver.observe(button);
    }
}

function queueFloatBtns(): void {
    if (queued) return;
    queued = true;

    requestAnimationFrame(() => {
        queued = false;
        stackFloatBtns();
        watchFloatBtns();
    });
}

function observeBody(): void {
    const body = document.body;
    if (!body) return;

    mutationObserver?.observe(body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden"]
    });
}

function installObservers(): void {
    if (installed) return;
    installed = true;

    window.addEventListener("resize", queueFloatBtns);
    mutationObserver = new MutationObserver(queueFloatBtns);
    observeBody();
}

export function ensureFloatBtns(): void {
    installObservers();
    queueFloatBtns();
}
