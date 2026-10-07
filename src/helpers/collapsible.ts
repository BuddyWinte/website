export type CollCfg = Readonly<{
    tgl: HTMLElement;
    cnt: HTMLElement;
    arr?: HTMLElement | null;
}>;

export type CollapseIconRenderer = (open: boolean) => Node;

export type RoundToggleSyncCfg = Readonly<{
    btn: HTMLElement;
    open: boolean;
    renderIcon?: CollapseIconRenderer;
    controlsId?: string;
    collapseLabel?: string;
    expandLabel?: string;
    collapseTitle?: string;
    expandTitle?: string;
    applyUtilityClass?: boolean;
}>;

export type CollapsibleSetCfg = Readonly<{
    root: HTMLElement;
    body: HTMLElement;
    open: boolean;
    header?: HTMLElement | null;
    toggle?: HTMLElement | null;
    iconHost?: HTMLElement | null;
    renderIcon?: CollapseIconRenderer;
    rootDatasetKey?: string;
    openValue?: string;
    closedValue?: string;
    collapseLabel?: string;
    expandLabel?: string;
    collapseTitle?: string;
    expandTitle?: string;
    onLayout?: (() => void) | null;
}>;

export type CollapsibleHeaderWireCfg = Readonly<{
    header: HTMLElement;
    toggle: HTMLElement;
    getOpen: () => boolean;
    setOpen: (open: boolean) => void;
    wiredKey?: string;
}>;

type CollapsibleAncestorSnap = Readonly<{
    body: HTMLElement;
    startHeight: number;
}>;

type HeightAnimState = Readonly<{
    token: number;
    frameIds: readonly number[];
    onEnd: (ev: TransitionEvent) => void;
}>;

const COLLAPSIBLE_BODY_SELECTOR = [
    ".rss-filters__body",
    ".rss-author-filter__body",
    ".cal__rootBody",
    ".cal__sctBody"
].join(",");

const heightAnimStates = new WeakMap<HTMLElement, HeightAnimState>();

let nextHeightAnimToken = 0;

/**
 * Checks if some random node from the event path is a control we should leave alone.
 * mostly so clicks on links/buttons inside the header do not start toggling stuff.
 * @param {unknown} nd
 * @returns {boolean}
 */
function isCtl(nd: unknown): boolean {
    return nd instanceof HTMLAnchorElement ||
        nd instanceof HTMLButtonElement ||
        nd instanceof HTMLInputElement ||
        nd instanceof HTMLTextAreaElement ||
        nd instanceof HTMLSelectElement ||
        nd instanceof HTMLLabelElement;
}

/**
 * Checks whether an element is one of the known collapsible bodies.
 * @param {Element} el
 * @returns {boolean}
 */
function isCollapsibleBody(el: Element): boolean {
    return el.matches(COLLAPSIBLE_BODY_SELECTOR);
}

/**
 * Cancels pending frame work and stale transition handlers for one collapsible body.
 * @param {HTMLElement} body
 * @returns {void}
 */
function cancelHeightAnim(body: HTMLElement): void {
    const state = heightAnimStates.get(body);
    if (!state) return;

    state.frameIds.forEach((frameId) => {
        window.cancelAnimationFrame(frameId);
    });

    body.removeEventListener("transitionend", state.onEnd);
    heightAnimStates.delete(body);
}

/**
 * Current rendered block height.
 * @param {HTMLElement} body
 * @returns {number}
 */
function getRenderedHeight(body: HTMLElement): number {
    return body.getBoundingClientRect().height;
}

/**
 * Locks a body at whatever height it is visually using right now.
 * @param {HTMLElement} body
 * @returns {number}
 */
function lockRenderedHeight(body: HTMLElement): number {
    cancelHeightAnim(body);

    const height = getRenderedHeight(body);

    body.style.maxHeight = `${height}px`;
    void body.offsetHeight;

    return height;
}

/**
 * Runs a max-height animation from an already locked height.
 * @param {HTMLElement} body
 * @param {number} startHeight
 * @param {number} targetHeight
 * @param {boolean} freeOnEnd
 * @returns {void}
 */
function runHeightAnim(
    body: HTMLElement,
    startHeight: number,
    targetHeight: number,
    freeOnEnd: boolean
): void {
    const token = nextHeightAnimToken + 1;
    const frameIds: number[] = [];

    nextHeightAnimToken = token;

    /**
     * Finishes the animation only if this is still the current animation
     * and the element has actually reached its current target.
     * @param {TransitionEvent} ev
     * @returns {void}
     */
    const onEnd = (ev: TransitionEvent): void => {
        if (ev.target !== body || ev.propertyName !== "max-height") return;

        const state = heightAnimStates.get(body);
        if (!state || state.token !== token) return;

        const curHeight = getRenderedHeight(body);
        const reachedTarget = Math.abs(curHeight - targetHeight) <= 1;

        if (!reachedTarget) return;

        body.removeEventListener("transitionend", onEnd);
        heightAnimStates.delete(body);

        if (freeOnEnd) {
            body.style.maxHeight = "none";
        }
    };

    heightAnimStates.set(body, {
        token,
        frameIds,
        onEnd
    });

    if (Math.abs(startHeight - targetHeight) <= 1) {
        body.style.maxHeight = freeOnEnd ? "none" : `${targetHeight}px`;
        heightAnimStates.delete(body);
        return;
    }

    body.addEventListener("transitionend", onEnd);

    const frameId = window.requestAnimationFrame(() => {
        const state = heightAnimStates.get(body);
        if (!state || state.token !== token) return;

        body.style.maxHeight = `${targetHeight}px`;
    });

    frameIds.push(frameId);
}

/**
 * Gets open collapsible ancestors for nested height animation.
 * @param {HTMLElement} body
 * @returns {HTMLElement[]}
 */
function getOpenCollapsibleAncestors(body: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    let cur = body.parentElement;

    while (cur) {
        if (
            cur !== body &&
            isCollapsibleBody(cur) &&
            cur.getAttribute("aria-hidden") !== "true"
        ) {
            out.push(cur);
        }

        cur = cur.parentElement;
    }

    return out;
}

/**
 * Locks currently-open ancestor bodies to their present height before a nested body changes.
 * This lets parent drawers animate with the nested drawer instead of jumping.
 * @param {HTMLElement} body
 * @returns {CollapsibleAncestorSnap[]}
 */
function primeCollapsibleAncestors(body: HTMLElement): CollapsibleAncestorSnap[] {
    return getOpenCollapsibleAncestors(body).map((ancestor) => ({
        body: ancestor,
        startHeight: lockRenderedHeight(ancestor)
    }));
}

/**
 * Moves any locked open ancestors to their new height.
 * @param {readonly CollapsibleAncestorSnap[]} snaps
 * @returns {void}
 */
function animateCollapsibleAncestors(snaps: readonly CollapsibleAncestorSnap[]): void {
    snaps.forEach((snap) => {
        const nextHeight = snap.body.scrollHeight;

        runHeightAnim(snap.body, snap.startHeight, nextHeight, true);
    });
}

/**
 * Checks if the event path includes a specific element.
 * @param {Event} ev
 * @param {EventTarget} el
 * @returns {boolean}
 */
export function eventPathIncludes(ev: Event, el: EventTarget): boolean {
    return ev.composedPath().includes(el);
}

/**
 * Checks if the event came from a real control, except controls explicitly allowed.
 * @param {Event} ev
 * @param {readonly EventTarget[]} allowed
 * @returns {boolean}
 */
export function eventHasBlockedControl(
    ev: Event,
    allowed: readonly EventTarget[] = []
): boolean {
    return ev.composedPath().some((nd) => isCtl(nd) && !allowed.includes(nd as EventTarget));
}

/**
 * Syncs a round collapse/expand button with an open state.
 * @param {RoundToggleSyncCfg} cfg
 * @returns {void}
 */
export function syncRoundToggleButton(cfg: RoundToggleSyncCfg): void {
    const {
        btn,
        open,
        renderIcon,
        controlsId,
        collapseLabel = "Collapse",
        expandLabel = "Expand",
        collapseTitle = collapseLabel,
        expandTitle = expandLabel,
        applyUtilityClass = true
    } = cfg;

    if (applyUtilityClass) {
        btn.classList.add("kc-round-icon-btn");
    }

    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.setAttribute("aria-label", open ? collapseLabel : expandLabel);
    btn.setAttribute("title", open ? collapseTitle : expandTitle);

    if (controlsId) {
        btn.setAttribute("aria-controls", controlsId);
    }

    if (!renderIcon) return;

    btn.replaceChildren(renderIcon(open));
}

/**
 * Applies non-animated collapsible state to a root/body/header/toggle group.
 * @param {CollapsibleSetCfg} cfg
 * @returns {void}
 */
export function setCollapsibleOpen(cfg: CollapsibleSetCfg): void {
    const {
        root,
        body,
        open,
        header = null,
        toggle = null,
        iconHost = null,
        renderIcon,
        rootDatasetKey = "open",
        openValue = "1",
        closedValue = "0",
        collapseLabel = "Collapse",
        expandLabel = "Expand",
        collapseTitle = collapseLabel,
        expandTitle = expandLabel,
        onLayout = null
    } = cfg;

    root.dataset[rootDatasetKey] = open ? openValue : closedValue;
    body.setAttribute("aria-hidden", open ? "false" : "true");

    if (header) {
        header.setAttribute("aria-expanded", open ? "true" : "false");
        header.setAttribute("title", open ? collapseTitle : expandTitle);
    }

    if (toggle) {
        syncRoundToggleButton({
            btn: toggle,
            open,
            renderIcon,
            collapseLabel,
            expandLabel,
            collapseTitle,
            expandTitle,
            applyUtilityClass: false
        });
    }

    if (iconHost && renderIcon) {
        iconHost.replaceChildren(renderIcon(open));
    }

    if (!onLayout) return;

    window.requestAnimationFrame(() => {
        onLayout();
    });
}

/**
 * Applies collapsible state with a max-height transition.
 * Safe to call again before the previous animation has finished.
 * @param {CollapsibleSetCfg} cfg
 * @returns {void}
 */
export function animateCollapsibleOpen(cfg: CollapsibleSetCfg): void {
    const { body, open } = cfg;
    const startHeight = lockRenderedHeight(body);
    const ancestorSnaps = primeCollapsibleAncestors(body);

    setCollapsibleOpen(cfg);

    const targetHeight = open ? body.scrollHeight : 0;

    runHeightAnim(body, startHeight, targetHeight, open);

    window.requestAnimationFrame(() => {
        animateCollapsibleAncestors(ancestorSnaps);
    });
}

/**
 * Wires a header where the whole row toggles, except normal controls inside it.
 * The actual toggle button still toggles.
 * @param {CollapsibleHeaderWireCfg} cfg
 * @returns {void}
 */
export function wireCollapsibleHeader(cfg: CollapsibleHeaderWireCfg): void {
    const {
        header,
        toggle,
        getOpen,
        setOpen,
        wiredKey = "kcCollapsibleHeaderWired"
    } = cfg;

    if (header.dataset[wiredKey] === "1") return;

    header.dataset[wiredKey] = "1";

    header.addEventListener("click", (ev) => {
        if (eventPathIncludes(ev, toggle)) {
            ev.preventDefault();
            ev.stopPropagation();
            setOpen(!getOpen());
            return;
        }

        if (eventHasBlockedControl(ev, [header])) return;

        setOpen(!getOpen());
    });

    header.addEventListener("keydown", (ev) => {
        const trg = ev.target;
        if (trg !== header) return;
        if (ev.key !== "Enter" && ev.key !== " ") return;

        ev.preventDefault();
        setOpen(!getOpen());
    });
}

/**
 * Wires up the little collapse thing.
 * click header, it opens. click again, it shuts. nothing fancy.
 * @param {CollCfg} cfg
 * @returns {void}
 */
export function atchColl(cfg: CollCfg): void {
    const { tgl, cnt, arr = null } = cfg;

    /**
     * Flips the section open/closed state and keeps the arrow in sync.
     * @param {boolean} open
     * @returns {void}
     */
    const setOpen = (open: boolean): void => {
        cnt.classList.toggle("content-expanded", open);
        cnt.classList.toggle("content-collapsed", !open);
        cnt.style.maxHeight = open ? `${cnt.scrollHeight}px` : "0px";
        tgl.setAttribute("aria-expanded", open ? "true" : "false");

        if (arr) {
            arr.textContent = open ? "🔽" : "▶️";
        }

        if (!open) {
            tgl.blur();
        }
    };

    setOpen(cnt.classList.contains("content-expanded"));

    /**
     * Header click handler.
     * skips clicks that came from actual controls inside the header.
     * @param {MouseEvent} ev
     * @returns {void}
     */
    const onClick = (ev: MouseEvent): void => {
        if (eventHasBlockedControl(ev)) return;
        setOpen(!cnt.classList.contains("content-expanded"));
    };

    /**
     * Keyboard toggle handler for Enter/Space.
     * @param {KeyboardEvent} ev
     * @returns {void}
     */
    const onKey = (ev: KeyboardEvent): void => {
        if (ev.key !== "Enter" && ev.key !== " ") return;

        ev.preventDefault();
        setOpen(!cnt.classList.contains("content-expanded"));
    };

    /**
     * Clicking the open content area itself collapses it,
     * unless the click came from a real control in there.
     * @param {MouseEvent} ev
     * @returns {void}
     */
    const onCntClick = (ev: MouseEvent): void => {
        if (!cnt.classList.contains("content-expanded")) return;
        if (eventHasBlockedControl(ev)) return;
        setOpen(false);
    };

    tgl.addEventListener("click", onClick);
    tgl.addEventListener("keydown", onKey);
    cnt.addEventListener("click", onCntClick);
}

/**
 * Small object check helper.
 * arrays only count if you ask nicely.
 * @param {unknown} value
 * @param {boolean} acceptArrays
 * @returns {value is Record<string, unknown>}
 */
