import * as helpers from "../helpers.ts";
import type {
    ContentLayout,
    FramePadding,
    FrameStyle,
    MutableWindowState,
    WindowApiOptions,
    WindowButtonRole,
    WindowHandle
} from "./types.ts";

/**
 * Manages a DOM element as a draggable desktop-style window with persisted state,
 * launcher integration, floating and maximised modes, nested-window support,
 * and cleanup support.
 */
export class WindowMaker {
    private static zIndexCounter = 1000;
    private static readonly launcherSize = 48;

    private readonly options: WindowApiOptions;
    private readonly windowId: string;
    private readonly storageKey: string;

    private state: MutableWindowState;

    private frameEl: HTMLElement | null = null;
    private headerEl: HTMLDivElement | null = null;
    private bodyEl: HTMLDivElement | null = null;
    private contentRootEl: HTMLDivElement | null = null;

    private closeButtonEl: HTMLButtonElement | null = null;
    private minimiseButtonEl: HTMLButtonElement | null = null;
    private floatButtonEl: HTMLButtonElement | null = null;
    private titleEl: HTMLSpanElement | null = null;

    private launcherEl: HTMLElement | null = null;
    private ownsLauncher = false;
    private launcherOriginalParent: HTMLElement | null = null;
    private launcherOriginalNextSibling: ChildNode | null = null;

    private ogParent: HTMLElement | null = null;
    private ogNxtSibling: ChildNode | null = null;
    private originalContentNodes: ChildNode[] = [];
    private frameStyle: FrameStyle | null = null;
    private framePadding: FramePadding | null = null;
    private contentLayout: ContentLayout | null = null;

    private dockedPlaceholderEl: Comment | null = null;
    private isMountedInFloatingHost = false;

    private resizeObserver: ResizeObserver | null = null;
    private cleanupFns: Array<() => void> = [];
    private layoutQueued = false;
    private hadStoredState = false;

    /**
     * Creates a new window controller instance and loads any previously persisted state.
     *
     * @param {WindowApiOptions} [options={}] Runtime configuration for window behaviour, mounting, launcher handling, floating host handling, button visibility, floating spawn position, and initial state.
     * @returns {void}
     */
    public constructor(options: WindowApiOptions = {}) {
        this.options = options;
        this.windowId = this.resolveWindowId(options.id);
        this.storageKey = `window-api:${this.windowId}:state`;
        this.state = this.readState();
    }

    /**
     * @param {unknown} target Raw mount target from JSON.
     * @returns {HTMLElement | null} Resolved target element, or null when not found.
     */
    public static resolveMountTarget(target: unknown): HTMLElement | null {
        if (typeof target !== "string") {
            return null;
        }

        const selector = target.trim();

        if (!selector) {
            return null;
        }

        if (selector === "body") {
            return document.body;
        }

        if (selector === "html") {
            return document.documentElement;
        }

        const element = document.querySelector(selector);
        return element instanceof HTMLElement ? element : null;
    }

    /**
     * @param {string} windowId Window id to normalise for storage keys.
     * @returns {string} Sanitised window id.
     */
    public static sanitiseWindowId(windowId: string): string {
        return windowId
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    /**
     * Turns the supplied element into a managed window by building its header,
     * wrapping its original content into a generic content root, wiring controls and events,
     * and applying the current state.
     *
     * Calling this more than once on the same instance is a no-op.
     *
     * @param {HTMLElement} element The DOM element to manage as a window frame.
     * @returns {this} The current instance for chaining.
     * @throws {Error} Thrown when the element is already mounted by another window instance.
     */
    public makeWindow(element: HTMLElement): this {
        if (this.frameEl) return this;

        if (element.dataset.windowApiMounted === "true") {
            throw new Error(`Element is already mounted as a window: ${element.id || this.windowId}`);
        }

        this.frameEl = element;
        this.ogParent = element.parentElement;
        this.ogNxtSibling = element.nextSibling;
        this.frameStyle = this.captureFrStl(element);
        this.framePadding = this.captureFrPaddStl(element);
        this.contentLayout = this.captureContLaytStl(element);

        this.ensureLauncher();
        this.extractLauncher();
        this.mntFrame();
        this.buildWindow();
        this.seedPos();
        this.wireControls();
        this.wireFrameDrag();
        this.wireLauncher();
        this.wireFrameFocus();
        this.wireViewportRzs();
        this.observeFloatRzs();

        element.dataset.windowApiMounted = "true";
        element.dataset.windowId = this.windowId;

        this.applyState();
        this.qLaytChng();

        return this;
    }

    /**
     * Opens the window and ensures it is not minimised.
     *
     * @returns {void}
     */
    public open(): void {
        this.state.closed = false;
        this.state.mini = false;
        this.persistState();
        this.applyState();
    }

    /**
     * Closes the window and clears any minimised state.
     *
     * @returns {void}
     */
    public close(): void {
        this.captureLaunchrPos();
        this.state.closed = true;
        this.state.mini = false;
        this.persistState();
        this.applyState();
    }

    /**
     * Minimises the window.
     *
     * If the window is maximised, its saved bounds are restored first.
     * If the window is floating, it is docked before being minimised.
     *
     * @returns {void}
     */
    public minimise(): void {
        if (this.state.mini) return;

        if (this.state.maxi) {
            this.restoreBnds();
            this.state.maxi = false;
        }

        if (this.state.float) {
            this.state.float = false;
        }

        this.state.mini = true;
        this.persistState();
        this.applyState();
    }

    /**
     * Restores a minimised window back to its visible state.
     *
     * @returns {void}
     */
    public restore(): void {
        if (!this.state.mini) return;

        this.state.mini = false;
        this.persistState();
        this.applyState();
    }

    /**
     * Toggles the window between docked and floating modes.
     *
     * If floating is being turned off while maximised, the previous bounds are restored first.
     * On the first transition into floating mode without stored state, the current bounds are captured.
     *
     * @returns {void}
     */
    public toggleFloating(): void {
        if (!this.frameEl) return;
        if (this.state.mini) return;

        if (this.state.float && this.state.maxi) {
            this.restoreBnds();
            this.state.maxi = false;
        }

        if (this.state.float) {
            this.state.float = false;
            this.persistState();
            this.applyState();
            return;
        }

        if (!this.hadStoredState) {
            this.captureBounds();
        }

        this.state.float = true;
        this.persistState();
        this.applyState();
    }

    /**
     * Toggles maximised mode for the window.
     *
     * Entering maximised mode forces the window into floating mode and stores a restore snapshot.
     * Toggling again restores the previous bounds.
     *
     * @returns {void}
     */
    public toggleMaximised(): void {
        if (!this.frameEl) return;
        if (this.state.mini) return;

        if (this.state.float && this.state.maxi) {
            this.restoreBnds();
            this.state.maxi = false;
            this.persistState();
            this.applyState();
            return;
        }

        this.saveBndsSnp();
        this.state.float = true;
        this.state.maxi = true;
        this.persistState();
        this.applyState();
    }

    /**
     * Reports whether the window is currently closed.
     *
     * @returns {boolean} True when the window is closed.
     */
    public isClosed(): boolean {
        return this.state.closed;
    }

    /**
     * Reports whether the window is currently minimised.
     *
     * @returns {boolean} True when the window is minimised.
     */
    public isMinimised(): boolean {
        return this.state.mini;
    }

    /**
     * Reports whether the window is currently floating.
     *
     * @returns {boolean} True when the window is floating.
     */
    public isFloating(): boolean {
        return this.state.float;
    }

    /**
     * Returns the managed frame element, if the window has been mounted.
     *
     * @returns {HTMLElement | null} The managed frame element, or null if not mounted.
     */
    public getFrameElement(): HTMLElement | null {
        return this.frameEl;
    }

    /**
     * Returns the resolved window identifier used for storage and element IDs.
     *
     * @returns {string} The stable window identifier.
     */
    public getWindowId(): string {
        return this.windowId;
    }

    /**
     * Removes all event listeners, disconnects observers, restores DOM structure
     * and inline styles, and releases internal element references.
     *
     * @returns {void}
     */
    public dispose(): void {
        for (const cleanup of this.cleanupFns) {
            cleanup();
        }

        this.cleanupFns = [];

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        this.restoreFrame();

        if (this.frameEl && this.contentRootEl) {
            while (this.contentRootEl.firstChild) {
                this.frameEl.appendChild(this.contentRootEl.firstChild);
            }
        }

        this.headerEl?.remove();
        this.bodyEl?.remove();
        this.dockedPlaceholderEl?.remove();

        if (this.frameEl) {
            this.frameEl.removeAttribute("data-window-api-mounted");
            this.frameEl.removeAttribute("data-window-id");
            this.frameEl.removeAttribute("data-window-floating");
            this.frameEl.removeAttribute("data-window-maximised");
            this.frameEl.removeAttribute("data-window-minimised");
            this.frameEl.removeAttribute("data-window-closed");

            this.frameEl.classList.remove("window-frame", "floating", "maximised", "minimised", "closed");

            this.clearMiniFr();
            this.clearMiniBod();
            this.clearMntFr();
            this.clearMntBod();
            this.restoreFrameStl();
        }

        const launcher = this.launcherEl;
        const launcherParent = this.launcherOriginalParent;
        const launcherNext = this.launcherOriginalNextSibling;
        const canRestoreBefore =
            !this.ownsLauncher &&
            launcher !== null &&
            launcherParent !== null &&
            launcherNext !== null &&
            launcherNext.parentNode === launcherParent;

        if (this.ownsLauncher) launcher?.remove();
        if (canRestoreBefore) launcherParent.insertBefore(launcher, launcherNext);
        if (!this.ownsLauncher && launcher && launcherParent && !canRestoreBefore) {
            launcherParent.appendChild(launcher);
        }

        if (!this.ownsLauncher && launcher) {
            launcher.classList.remove("window-launcher", "is-dragging");
            launcher.removeAttribute("data-window-launcher-visible");
            launcher.style.removeProperty("--window-launcher-left");
            launcher.style.removeProperty("--window-launcher-top");
            launcher.style.removeProperty("--window-launcher-display");
            launcher.style.width = "";
            launcher.style.height = "";
            launcher.style.left = "";
            launcher.style.top = "";
        }

        this.frameEl = null;
        this.headerEl = null;
        this.bodyEl = null;
        this.contentRootEl = null;
        this.closeButtonEl = null;
        this.minimiseButtonEl = null;
        this.floatButtonEl = null;
        this.titleEl = null;
        this.launcherEl = null;
        this.launcherOriginalParent = null;
        this.launcherOriginalNextSibling = null;
        this.dockedPlaceholderEl = null;
        this.isMountedInFloatingHost = false;
    }

    /**
     * Generates a unique identifier for a window instance.
     *
     * Uses crypto.randomUUID when available, otherwise falls back to a timestamp
     * and random suffix.
     *
     * @returns {string} A generated unique identifier.
     */
    private static nextId(): string {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }

        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * Resolves a stable window ID from an optional input string.
     *
     * The ID is trimmed, lowercased, and sanitised to contain only letters,
     * digits, underscores, and hyphens. If the result is empty, a generated ID is used.
     *
     * @param {string | undefined} id The requested window ID.
     * @returns {string} The resolved and sanitised window ID.
     */
    private resolveWindowId(id: string | undefined): string {
        if (!id || id.trim().length === 0) {
            return `window-${WindowMaker.nextId()}`;
        }

        const sanitised = id
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^-+|-+$/g, "");

        return sanitised.length > 0 ? sanitised : `window-${WindowMaker.nextId()}`;
    }

    /**
     * Resolves whether the initial default state should be floating when no persisted state exists.
     *
     * Passing an explicit floating spawn position makes the initial default floating unless
     * initialFloating was explicitly provided.
     *
     * @returns {boolean} True when the default state should start floating.
     */
    private resolveFloating(): boolean {
        if (typeof this.options.initFloat === "boolean") {
            return this.options.initFloat;
        }

        return this.options.initFloatPos !== undefined;
    }

    /**
     * Resolves the initial x position used when no persisted state exists.
     *
     * @returns {string} The default x position.
     */
    private resolveInitialX(): string {
        return this.options.initFloatPos?.x ?? "10px";
    }

    /**
     * Resolves the initial y position used when no persisted state exists.
     *
     * @returns {string} The default y position.
     */
    private resolveInitialY(): string {
        return this.options.initFloatPos?.y ?? "10px";
    }

    /**
     * Creates the default window state used when no persisted state is available.
     *
     * @returns {MutableWindowState} A fresh default state object.
     */
    private createInitState(): MutableWindowState {
        const initialX = this.resolveInitialX();
        const initialY = this.resolveInitialY();

        return {
            float: this.resolveFloating(),
            mini: this.options.initMini ?? false,
            closed: this.options.initClosed ?? false,
            maxi: false,
            x: initialX,
            y: initialY,
            width: "50%",
            height: "",
            launcherX: initialX,
            launcherY: initialY,
            restoreX: "",
            restoreY: "",
            restrWidth: "",
            restrHeight: "",
            restrFloat: false
        };
    }

    /**
     * Reads persisted window state from localStorage and merges it with defaults.
     *
     * If the stored value is missing, invalid, or unreadable, the default state is returned.
     *
     * @returns {MutableWindowState} The restored or default window state.
     */
    private readState(): MutableWindowState {
        const fallback = this.createInitState();

        let parsedUnknown: unknown = null;

        try {
            const raw = window.localStorage.getItem(this.storageKey);
            if (!raw) return fallback;
            parsedUnknown = JSON.parse(raw);
            this.hadStoredState = true;
        } catch {
            return fallback;
        }

        if (!helpers.isRecord(parsedUnknown)) return fallback;

        const parsed = parsedUnknown;

        return {
            float: this.readBoolean(parsed.floating, fallback.float),
            mini: this.readBoolean(parsed.minimised, fallback.mini),
            closed: this.readBoolean(parsed.closed, fallback.closed),
            maxi: this.readBoolean(parsed.maximised, fallback.maxi),
            x: this.readString(parsed.x, fallback.x),
            y: this.readString(parsed.y, fallback.y),
            width: this.readString(parsed.width, fallback.width),
            height: this.readString(parsed.height, fallback.height),
            launcherX: this.readString(parsed.launcherX, fallback.launcherX),
            launcherY: this.readString(parsed.launcherY, fallback.launcherY),
            restoreX: this.readString(parsed.restoreX, fallback.restoreX),
            restoreY: this.readString(parsed.restoreY, fallback.restoreY),
            restrWidth: this.readString(parsed.restoreWidth, fallback.restrWidth),
            restrHeight: this.readString(parsed.restoreHeight, fallback.restrHeight),
            restrFloat: this.readBoolean(parsed.restoreFloating, fallback.restrFloat)
        };
    }

    /**
     * Persists the current window state to localStorage.
     *
     * Storage failures are ignored so the window can still function in restricted environments.
     *
     * @returns {void}
     */
    private persistState(): void {
        try {
            window.localStorage.setItem(this.storageKey, JSON.stringify(this.state));
            this.hadStoredState = true;
        } catch {
            // Ignore storage failures.
        }
    }

    /**
     * Normalises an unknown value into a boolean with fallback support.
     *
     * @param {unknown} value The candidate value.
     * @param {boolean} fallback The fallback value when the candidate is not a boolean.
     * @returns {boolean} The boolean value or the fallback.
     */
    private readBoolean(value: unknown, fallback: boolean): boolean {
        return typeof value === "boolean" ? value : fallback;
    }

    /**
     * Normalises an unknown value into a string with fallback support.
     *
     * @param {unknown} value The candidate value.
     * @param {string} fallback The fallback value when the candidate is not a string.
     * @returns {string} The string value or the fallback.
     */
    private readString(value: unknown, fallback: string): string {
        return typeof value === "string" ? value : fallback;
    }

    /**
     * Resolves whether a given header control button should be rendered.
     *
     * All buttons are shown by default and only hidden when explicitly disabled.
     *
     * @param {WindowButtonRole} role The semantic role of the button.
     * @returns {boolean} True when the button should be shown.
     */
    private shouldShowBttn(role: WindowButtonRole): boolean {
        if (role === "close") {
            return this.options.showCloseBttn ?? true;
        }

        if (role === "minimise") {
            return this.options.showMiniBttn ?? true;
        }

        return this.options.showFloatBttn ?? true;
    }

    /**
     * Captures the current inline frame styles that this class may later overwrite.
     *
     * @param {HTMLElement} element The frame element whose inline styles should be captured.
     * @returns {FrameStyle} A snapshot of restorable inline style values.
     */
    private captureFrStl(element: HTMLElement): FrameStyle {
        return {
            display: element.style.display,
            position: element.style.position,
            left: element.style.left,
            top: element.style.top,
            width: element.style.width,
            height: element.style.height,
            maxWidth: element.style.maxWidth,
            maxHeight: element.style.maxHeight,
            resize: (element.style as CSSStyleDeclaration & { resize?: string }).resize ?? "",
            zIndex: element.style.zIndex,
            paddingTop: element.style.paddingTop,
            paddingRight: element.style.paddingRight,
            paddingBottom: element.style.paddingBottom,
            paddingLeft: element.style.paddingLeft
        };
    }

    /**
     * Captures the frame's computed padding values so they can be moved into the generated content root.
     *
     * @param {HTMLElement} element The frame element whose computed padding should be captured.
     * @returns {FramePadding} A snapshot of computed padding values.
     */
    private captureFrPaddStl(element: HTMLElement): FramePadding {
        const computed = window.getComputedStyle(element);

        return {
            top: computed.paddingTop,
            right: computed.paddingRight,
            bottom: computed.paddingBottom,
            left: computed.paddingLeft
        };
    }

    /**
     * Captures the layout model of the original frame so the generated content root can mimic it.
     *
     * This lets the outer frame become a generic window shell while the inner generated wrapper
     * preserves the element's original flex or grid behaviour for its original children.
     *
     * @param {HTMLElement} element The original frame element.
     * @returns {ContentLayout} The captured layout values.
     */
    private captureContLaytStl(element: HTMLElement): ContentLayout {
        const computed = window.getComputedStyle(element);

        return {
            display: computed.display,
            flexDirection: computed.flexDirection,
            flexWrap: computed.flexWrap,
            justifyContent: computed.justifyContent,
            alignItems: computed.alignItems,
            alignContent: computed.alignContent,
            justifyItems: computed.justifyItems,
            justifySelf: computed.justifySelf,
            placeItems: computed.placeItems,
            placeContent: computed.placeContent,
            placeSelf: computed.placeSelf,
            gap: computed.gap,
            rowGap: computed.rowGap,
            columnGap: computed.columnGap,
            gridTemplateColumns: computed.gridTemplateColumns,
            gridTemplateRows: computed.gridTemplateRows,
            gridAutoFlow: computed.gridAutoFlow,
            gridAutoColumns: computed.gridAutoColumns,
            gridAutoRows: computed.gridAutoRows,
            overflow: computed.overflow,
            overflowX: computed.overflowX,
            overflowY: computed.overflowY
        };
    }

    /**
     * Restores the frame's previously captured inline styles and clears custom CSS variables
     * used while the frame is floating.
     *
     * @returns {void}
     */
    private restoreFrameStl(): void {
        if (!this.frameEl || !this.frameStyle) return;

        this.frameEl.style.display = this.frameStyle.display;
        this.frameEl.style.position = this.frameStyle.position;
        this.frameEl.style.left = this.frameStyle.left;
        this.frameEl.style.top = this.frameStyle.top;
        this.frameEl.style.width = this.frameStyle.width;
        this.frameEl.style.height = this.frameStyle.height;
        this.frameEl.style.maxWidth = this.frameStyle.maxWidth;
        this.frameEl.style.maxHeight = this.frameStyle.maxHeight;
        (this.frameEl.style as CSSStyleDeclaration & { resize?: string }).resize =
            this.frameStyle.resize;
        this.frameEl.style.zIndex = this.frameStyle.zIndex;
        this.frameEl.style.paddingTop = this.frameStyle.paddingTop;
        this.frameEl.style.paddingRight = this.frameStyle.paddingRight;
        this.frameEl.style.paddingBottom = this.frameStyle.paddingBottom;
        this.frameEl.style.paddingLeft = this.frameStyle.paddingLeft;

        this.frameEl.style.removeProperty("--window-left");
        this.frameEl.style.removeProperty("--window-top");
        this.frameEl.style.removeProperty("--window-width");
        this.frameEl.style.removeProperty("--window-height");
        this.frameEl.style.removeProperty("--window-z-index");
    }

    /**
     * Resolves the launcher element for this window.
     *
     * If a launcher was supplied in the options it is reused. Otherwise a default
     * launcher image is created and appended to the document body.
     *
     * @returns {void}
     */
    private ensureLauncher(): void {
        if (this.options.launcher) {
            this.launcherEl = this.options.launcher;
            this.ownsLauncher = false;
            return;
        }

        const launcher = document.createElement("img");
        launcher.src = this.options.launcherSrc ?? "/images/file.svg";
        launcher.alt = `${this.options.title ?? this.windowId} icon`;
        launcher.title = `Double-click to open ${this.options.title ?? this.windowId}`;
        launcher.draggable = false;

        document.body.appendChild(launcher);

        this.launcherEl = launcher;
        this.ownsLauncher = true;
    }

    /**
     * Moves an externally supplied launcher out of the frame if it is nested inside it,
     * while remembering its original DOM position for later restoration.
     *
     * @returns {void}
     */
    private extractLauncher(): void {
        if (!this.frameEl || !this.launcherEl) return;
        if (!this.frameEl.contains(this.launcherEl)) return;
        if (this.ownsLauncher) return;

        this.launcherOriginalParent = this.launcherEl.parentElement;
        this.launcherOriginalNextSibling = this.launcherEl.nextSibling;
        document.body.appendChild(this.launcherEl);
    }

    /**
     * Mounts the frame into the configured docked mount target when it is not already attached.
     *
     * @returns {void}
     */
    private mntFrame(): void {
        if (!this.frameEl) return;
        if (this.frameEl.parentElement) return;

        const target = this.options.mountTarget ?? document.body;

        if (this.options.insertAtStart && target.firstChild) {
            target.insertBefore(this.frameEl, target.firstChild);
            return;
        }

        target.appendChild(this.frameEl);
    }

    /**
     * Returns the mount target used while the frame is floating.
     *
     * @returns {HTMLElement} The floating mount target.
     */
    private getFloatMntTrgt(): HTMLElement {
        return this.options.floatMntTrgt ?? document.body;
    }

    /**
     * Moves the frame into the floating mount target while leaving a placeholder behind
     * so it can later return to its exact docked position.
     *
     * @returns {void}
     */
    private moveFr2FloatHost(): void {
        if (!this.frameEl) return;

        const floatingHost = this.getFloatMntTrgt();
        const currentParent = this.frameEl.parentElement;

        if (currentParent === floatingHost) {
            this.isMountedInFloatingHost = true;
            return;
        }

        if (!this.dockedPlaceholderEl) {
            this.dockedPlaceholderEl = document.createComment(`window-api:${this.windowId}:dock`);
        }

        if (currentParent) {
            currentParent.insertBefore(this.dockedPlaceholderEl, this.frameEl);
        }

        floatingHost.appendChild(this.frameEl);
        this.isMountedInFloatingHost = true;
    }

    /**
     * Restores the frame to its previous docked DOM position.
     *
     * When a placeholder exists it is used as the source of truth. Otherwise the original
     * parent and sibling are used as a fallback.
     *
     * @returns {void}
     */
    private restoreFrame(): void {
        if (!this.frameEl) return;

        if (this.dockedPlaceholderEl?.parentNode) {
            this.dockedPlaceholderEl.parentNode.insertBefore(this.frameEl, this.dockedPlaceholderEl);
            this.dockedPlaceholderEl.remove();
            this.dockedPlaceholderEl = null;
            this.isMountedInFloatingHost = false;
            return;
        }

        const dockedParent = this.ogParent ?? this.options.mountTarget ?? null;
        if (!dockedParent) return;

        if (this.frameEl.parentElement === dockedParent) {
            this.isMountedInFloatingHost = false;
            return;
        }

        if (this.ogNxtSibling && this.ogNxtSibling.parentNode === dockedParent) {
            dockedParent.insertBefore(this.frameEl, this.ogNxtSibling);
        } else {
            dockedParent.appendChild(this.frameEl);
        }

        this.isMountedInFloatingHost = false;
    }

    /**
     * Builds the runtime window structure by creating a header, controls, title,
     * a generated content root, and a body wrapper, then moving the frame's original
     * child nodes into that content root.
     *
     * @returns {void}
     * @throws {Error} Thrown when called without a frame element.
     */
    private buildWindow(): void {
        if (!this.frameEl) {
            throw new Error("Cannot build window without a content element");
        }

        this.originalContentNodes = Array.from(this.frameEl.childNodes);

        const header = document.createElement("div");
        header.id = `${this.windowId}-header`;
        header.className = "window-header";

        const controls = document.createElement("div");
        controls.className = "window-controls";

        const closeButton = this.shouldShowBttn("close")
            ? this.createCtrlBttn("close", "Close")
            : null;
        const minimiseButton = this.shouldShowBttn("minimise")
            ? this.createCtrlBttn("minimise", "Minimise / restore")
            : null;
        const floatButton = this.shouldShowBttn("float")
            ? this.createCtrlBttn("float", "Float / dock")
            : null;

        const title = document.createElement("span");
        title.id = `${this.windowId}-title`;
        title.className = "window-title";
        title.textContent = this.options.title ?? this.frameEl.getAttribute("data-window-title") ?? "Window";

        const body = document.createElement("div");
        body.id = `${this.windowId}-body`;
        body.className = "window-body";

        const contentRoot = document.createElement("div");
        contentRoot.className = "window-content-root";
        contentRoot.dataset.windowContentRoot = "true";

        for (const node of this.originalContentNodes) {
            contentRoot.appendChild(node);
        }

        if (closeButton) {
            controls.appendChild(closeButton);
        }

        if (minimiseButton) {
            controls.appendChild(minimiseButton);
        }

        if (floatButton) {
            controls.appendChild(floatButton);
        }

        header.appendChild(controls);
        header.appendChild(title);
        body.appendChild(contentRoot);

        this.frameEl.appendChild(header);
        this.frameEl.appendChild(body);

        this.headerEl = header;
        this.bodyEl = body;
        this.contentRootEl = contentRoot;
        this.closeButtonEl = closeButton;
        this.minimiseButtonEl = minimiseButton;
        this.floatButtonEl = floatButton;
        this.titleEl = title;

        this.applyCntRootLayt();
    }

    /**
     * Applies the original frame's layout model to the generated content root so it
     * behaves like the original container used to behave for its children.
     *
     * @returns {void}
     */
    private applyCntRootLayt(): void {
        if (!this.contentRootEl || !this.contentLayout) return;

        this.contentRootEl.style.display = this.contentLayout.display;
        this.contentRootEl.style.flexDirection = this.contentLayout.flexDirection;
        this.contentRootEl.style.flexWrap = this.contentLayout.flexWrap;
        this.contentRootEl.style.justifyContent = this.contentLayout.justifyContent;
        this.contentRootEl.style.alignItems = this.contentLayout.alignItems;
        this.contentRootEl.style.alignContent = this.contentLayout.alignContent;
        this.contentRootEl.style.justifyItems = this.contentLayout.justifyItems;
        this.contentRootEl.style.justifySelf = this.contentLayout.justifySelf;
        this.contentRootEl.style.placeItems = this.contentLayout.placeItems;
        this.contentRootEl.style.placeContent = this.contentLayout.placeContent;
        this.contentRootEl.style.placeSelf = this.contentLayout.placeSelf;
        this.contentRootEl.style.gap = this.contentLayout.gap;
        this.contentRootEl.style.rowGap = this.contentLayout.rowGap;
        this.contentRootEl.style.columnGap = this.contentLayout.columnGap;
        this.contentRootEl.style.gridTemplateColumns = this.contentLayout.gridTemplateColumns;
        this.contentRootEl.style.gridTemplateRows = this.contentLayout.gridTemplateRows;
        this.contentRootEl.style.gridAutoFlow = this.contentLayout.gridAutoFlow;
        this.contentRootEl.style.gridAutoColumns = this.contentLayout.gridAutoColumns;
        this.contentRootEl.style.gridAutoRows = this.contentLayout.gridAutoRows;
        this.contentRootEl.style.overflow = this.contentLayout.overflow;
        this.contentRootEl.style.overflowX = this.contentLayout.overflowX;
        this.contentRootEl.style.overflowY = this.contentLayout.overflowY;
    }

    /**
     * Forces the mounted frame into a generic shell layout so original container-level
     * display and spacing rules do not interfere with the window header and body.
     *
     * @returns {void}
     */
    private applyMntFrLayt(): void {
        if (!this.frameEl) return;

        this.frameEl.style.setProperty("display", "flex", "important");
        this.frameEl.style.setProperty("flex-direction", "column", "important");
        this.frameEl.style.setProperty("align-items", "stretch", "important");
        this.frameEl.style.setProperty("justify-content", "flex-start", "important");
        this.frameEl.style.setProperty("gap", "0px", "important");
    }

    /**
     * Clears the forced mounted frame layout rules.
     *
     * @returns {void}
     */
    private clearMntFr(): void {
        if (!this.frameEl) return;

        this.frameEl.style.removeProperty("display");
        this.frameEl.style.removeProperty("flex-direction");
        this.frameEl.style.removeProperty("align-items");
        this.frameEl.style.removeProperty("justify-content");
        this.frameEl.style.removeProperty("gap");
    }

    /**
     * Moves the original frame padding into the generated content root so the window
     * header sits flush while the content keeps its spacing.
     *
     * @returns {void}
     */
    private applyMntCntLayt(): void {
        if (!this.frameEl || !this.bodyEl || !this.contentRootEl || !this.framePadding) return;

        this.frameEl.style.setProperty("padding-top", "0px", "important");
        this.frameEl.style.setProperty("padding-right", "0px", "important");
        this.frameEl.style.setProperty("padding-bottom", "0px", "important");
        this.frameEl.style.setProperty("padding-left", "0px", "important");

        this.bodyEl.style.paddingTop = "0px";
        this.bodyEl.style.paddingRight = "0px";
        this.bodyEl.style.paddingBottom = "0px";
        this.bodyEl.style.paddingLeft = "0px";

        this.contentRootEl.style.paddingTop = this.framePadding.top;
        this.contentRootEl.style.paddingRight = this.framePadding.right;
        this.contentRootEl.style.paddingBottom = this.framePadding.bottom;
        this.contentRootEl.style.paddingLeft = this.framePadding.left;
    }

    /**
     * Clears the generated content padding layout rules.
     *
     * @returns {void}
     */
    private clearMntBod(): void {
        if (!this.contentRootEl || !this.bodyEl || !this.frameEl) return;

        this.frameEl.style.removeProperty("padding-top");
        this.frameEl.style.removeProperty("padding-right");
        this.frameEl.style.removeProperty("padding-bottom");
        this.frameEl.style.removeProperty("padding-left");

        this.bodyEl.style.paddingTop = "";
        this.bodyEl.style.paddingRight = "";
        this.bodyEl.style.paddingBottom = "";
        this.bodyEl.style.paddingLeft = "";

        this.contentRootEl.style.paddingTop = "";
        this.contentRootEl.style.paddingRight = "";
        this.contentRootEl.style.paddingBottom = "";
        this.contentRootEl.style.paddingLeft = "";
    }

    /**
     * Measures the current visible height of the header area.
     *
     * The value is based on the real rendered height at the moment the window is minimised.
     *
     * @returns {number} The measured header height in pixels.
     */
    private getHdrH(): number {
        if (!this.headerEl) return 0;

        const headerHeight = this.headerEl.getBoundingClientRect().height;
        return Math.max(0, Math.ceil(headerHeight));
    }

    /**
     * Forces the window frame itself to the measured header height so only the title bar remains visible.
     *
     * These inline declarations are applied with !important so they win over any authored CSS.
     *
     * @returns {void}
     */
    private applyMiniFrLayt(): void {
        if (!this.frameEl) return;

        const headerHeight = this.getHdrH();
        const minimisedHeight = `${headerHeight}px`;

        this.frameEl.style.setProperty("height", minimisedHeight, "important");
        this.frameEl.style.setProperty("min-height", minimisedHeight, "important");
        this.frameEl.style.setProperty("max-height", minimisedHeight, "important");
        this.frameEl.style.setProperty("block-size", minimisedHeight, "important");
        this.frameEl.style.setProperty("min-block-size", minimisedHeight, "important");
        this.frameEl.style.setProperty("max-block-size", minimisedHeight, "important");
        this.frameEl.style.setProperty("overflow", "hidden", "important");
    }

    /**
     * Removes the forced minimised frame rules so the window can size normally again.
     *
     * @returns {void}
     */
    private clearMiniFr(): void {
        if (!this.frameEl) return;

        this.frameEl.style.removeProperty("height");
        this.frameEl.style.removeProperty("min-height");
        this.frameEl.style.removeProperty("max-height");
        this.frameEl.style.removeProperty("block-size");
        this.frameEl.style.removeProperty("min-block-size");
        this.frameEl.style.removeProperty("max-block-size");
        this.frameEl.style.removeProperty("overflow");
    }

    /**
     * Forces the window body into a fully collapsed state so only the header remains visible.
     *
     * These inline declarations are applied with !important so they win over any authored CSS.
     *
     * @returns {void}
     */
    private applyMiniBodLayt(): void {
        if (!this.bodyEl) return;

        this.bodyEl.style.setProperty("display", "block", "important");
        this.bodyEl.style.setProperty("height", "0px", "important");
        this.bodyEl.style.setProperty("min-height", "0px", "important");
        this.bodyEl.style.setProperty("max-height", "0px", "important");
        this.bodyEl.style.setProperty("block-size", "0px", "important");
        this.bodyEl.style.setProperty("min-block-size", "0px", "important");
        this.bodyEl.style.setProperty("max-block-size", "0px", "important");
        this.bodyEl.style.setProperty("flex", "0 0 0px", "important");
        this.bodyEl.style.setProperty("overflow", "hidden", "important");
        this.bodyEl.style.setProperty("padding-top", "0px", "important");
        this.bodyEl.style.setProperty("padding-bottom", "0px", "important");
    }

    /**
     * Removes the forced minimised body rules so the window content can size normally again.
     *
     * @returns {void}
     */
    private clearMiniBod(): void {
        if (!this.bodyEl) return;

        this.bodyEl.style.removeProperty("display");
        this.bodyEl.style.removeProperty("height");
        this.bodyEl.style.removeProperty("min-height");
        this.bodyEl.style.removeProperty("max-height");
        this.bodyEl.style.removeProperty("block-size");
        this.bodyEl.style.removeProperty("min-block-size");
        this.bodyEl.style.removeProperty("max-block-size");
        this.bodyEl.style.removeProperty("flex");
        this.bodyEl.style.removeProperty("overflow");
        this.bodyEl.style.removeProperty("padding-top");
        this.bodyEl.style.removeProperty("padding-bottom");
    }

    /**
     * Creates a header control button for a specific window action.
     *
     * @param {WindowButtonRole} role The semantic role of the button.
     * @param {string} label The accessible label and tooltip text.
     * @returns {HTMLButtonElement} The created control button.
     */
    private createCtrlBttn(role: WindowButtonRole, label: string): HTMLButtonElement {
        const button = document.createElement("button");
        const classes = ["btn", role];

        if (role === "minimise") {
            classes.push("toggle-view");
        }

        button.type = "button";
        button.id = `${this.windowId}-btn-${role}`;
        button.className = classes.join(" ");
        button.dataset.windowRole = role;
        button.title = label;
        button.setAttribute("aria-label", label);

        const icon = this.createCtrlBttnIco(role);
        button.appendChild(icon);

        return button;
    }

    /**
     * Creates the circular SVG icon used inside a window control button.
     *
     * @param {WindowButtonRole} role The semantic role of the button.
     * @returns {SVGSVGElement} The SVG icon element.
     */
    private createCtrlBttnIco(role: WindowButtonRole): SVGSVGElement {
        const svgNamespace = "http://www.w3.org/2000/svg";

        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("viewBox", "0 0 12 12");
        svg.setAttribute("width", "1em");
        svg.setAttribute("height", "1em");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");

        const circle = document.createElementNS(svgNamespace, "circle");
        circle.setAttribute("cx", "6");
        circle.setAttribute("cy", "6");
        circle.setAttribute("r", "5");
        circle.style.fill = `var(--window-btn-${role}-fill)`;

        svg.appendChild(circle);

        return svg;
    }

    /**
     * Seeds the initial frame and launcher positions from the element's current layout
     * when no stored state exists yet.
     *
     * A configured floating spawn position is preserved and only width and height are
     * taken from the current layout in that case.
     *
     * @returns {void}
     */
    private seedPos(): void {
        if (!this.frameEl) return;
        if (this.hadStoredState) return;

        const rect = this.frameEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const shouldPreserveConfiguredFloatingPosition =
            this.state.float && this.options.initFloatPos !== undefined;

        this.state.width = `${rect.width}px`;
        this.state.height = `${rect.height}px`;

        if (shouldPreserveConfiguredFloatingPosition) {
            return;
        }

        this.state.x = `${rect.left}px`;
        this.state.y = `${rect.top}px`;
        this.state.launcherX = `${rect.left}px`;
        this.state.launcherY = `${rect.top}px`;
    }

    /**
     * Captures the frame's current bounds into the active state.
     *
     * This is used when switching into floating mode before any previous layout
     * has been stored.
     *
     * @returns {void}
     */
    private captureBounds(): void {
        if (!this.frameEl) return;

        const rect = this.frameEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        this.state.x = `${rect.left}px`;
        this.state.y = `${rect.top}px`;
        this.state.width = `${rect.width}px`;
        this.state.height = `${rect.height}px`;
    }

    /**
     * Captures the launcher position from the close control, falling back to the frame origin.
     *
     * @returns {void}
     */
    private captureLaunchrPos(): void {
        const anchor = this.getClseAnchorPos();

        this.state.launcherX = `${anchor.left}px`;
        this.state.launcherY = `${anchor.top}px`;
    }

    /**
     * Resolves the screen position that should be used for the closed launcher.
     *
     * The close button's top-left corner is preferred so the icon appears where the user
     * last interacted. If that cannot be measured, the frame's top-left corner is used,
     * followed by the previously stored launcher position.
     *
     * @returns {{ left: number; top: number }} The clamped launcher anchor position.
     */
    private getClseAnchorPos(): { left: number; top: number } {
        const closeButtonRect = this.closeButtonEl?.getBoundingClientRect();

        if (closeButtonRect && closeButtonRect.width > 0 && closeButtonRect.height > 0) {
            return this.clampLnchrPos(closeButtonRect.left, closeButtonRect.top);
        }

        const frameRect = this.frameEl?.getBoundingClientRect();

        if (frameRect && frameRect.width > 0 && frameRect.height > 0) {
            return this.clampLnchrPos(frameRect.left, frameRect.top);
        }

        return this.clampLnchrPos(
            this.parsePxVal(this.state.launcherX, 10),
            this.parsePxVal(this.state.launcherY, 10)
        );
    }

    /**
     * Wires the header control buttons and header double-click behaviour.
     *
     * @returns {void}
     */
    private wireControls(): void {
        if (!this.headerEl) return;

        const onClose = (event: MouseEvent): void => {
            event.stopPropagation();
            this.close();
        };

        const onMinimise = (event: MouseEvent): void => {
            event.stopPropagation();

            if (this.state.mini) {
                this.restore();
                return;
            }

            this.minimise();
        };

        const onFloat = (event: MouseEvent): void => {
            event.stopPropagation();
            this.toggleFloating();
        };

        const onHeaderDoubleClick = (event: MouseEvent): void => {
            const target = event.target;
            if (target instanceof HTMLElement && target.closest("button")) return;

            event.stopPropagation();
            this.toggleMaximised();
        };

        this.closeButtonEl?.addEventListener("click", onClose);
        this.minimiseButtonEl?.addEventListener("click", onMinimise);
        this.floatButtonEl?.addEventListener("click", onFloat);
        this.headerEl.addEventListener("dblclick", onHeaderDoubleClick);

        this.cleanupFns.push(() => {
            this.closeButtonEl?.removeEventListener("click", onClose);
            this.minimiseButtonEl?.removeEventListener("click", onMinimise);
            this.floatButtonEl?.removeEventListener("click", onFloat);
            this.headerEl?.removeEventListener("dblclick", onHeaderDoubleClick);
        });
    }

    /**
     * Enables dragging for the frame while it is floating and not maximised.
     *
     * @returns {void}
     */
    private wireFrameDrag(): void {
        if (!this.headerEl || !this.frameEl) return;

        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        const onPointerDown = (event: PointerEvent): void => {
            if (event.button !== 0) return;
            if (!this.frameEl) return;
            if (!this.state.float) return;
            if (this.state.maxi) return;

            const target = event.target;
            if (target instanceof HTMLElement && target.closest("button")) return;

            const rect = this.frameEl.getBoundingClientRect();

            dragging = true;
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            this.headerEl?.classList.add("is-dragging");
            this.bring2Front();
            event.preventDefault();
            event.stopPropagation();
        };

        const onPointerMove = (event: PointerEvent): void => {
            if (!dragging || !this.frameEl) return;

            const unclampedLeft = event.clientX - offsetX;
            const unclampedTop = event.clientY - offsetY;
            const next = this.clampPos(unclampedLeft, unclampedTop);

            this.state.x = `${next.left}px`;
            this.state.y = `${next.top}px`;

            this.applyFloatGeo();
            this.syncLnchr2Fr();
        };

        const onPointerUp = (): void => {
            if (!dragging) return;

            dragging = false;
            this.headerEl?.classList.remove("is-dragging");
            this.persistState();
            this.qLaytChng();
        };

        this.headerEl.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);

        this.cleanupFns.push(() => {
            this.headerEl?.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
        });
    }

    /**
     * Wires launcher open and drag behaviour.
     *
     * @returns {void}
     */
    private wireLauncher(): void {
        const launcher = this.launcherEl;
        if (!launcher) return;

        launcher.classList.add("window-launcher");
        launcher.style.width = `${WindowMaker.launcherSize}px`;
        launcher.style.height = `${WindowMaker.launcherSize}px`;

        if (launcher instanceof HTMLImageElement) {
            launcher.style.objectFit = "contain";
        }

        launcher.style.setProperty(
            "--window-launcher-display",
            this.options.closedLnchrDis ?? "inline-block"
        );

        this.applyLnchrPos();

        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;

        const onDoubleClick = (): void => {
            this.open();
        };

        const onPointerDown = (event: PointerEvent): void => {
            if (event.button !== 0) return;

            const rect = launcher.getBoundingClientRect();

            dragging = true;
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;

            launcher.classList.add("is-dragging");
            event.preventDefault();
            event.stopPropagation();
        };

        const onPointerMove = (event: PointerEvent): void => {
            if (!dragging) return;

            const next = this.clampLnchrPos(event.clientX - offsetX, event.clientY - offsetY);

            this.state.launcherX = `${next.left}px`;
            this.state.launcherY = `${next.top}px`;

            this.applyLnchrPos();
            this.persistState();
        };

        const onPointerUp = (): void => {
            if (!dragging) return;

            dragging = false;
            launcher.classList.remove("is-dragging");
        };

        launcher.addEventListener("dblclick", onDoubleClick);
        launcher.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);

        this.cleanupFns.push(() => {
            launcher.removeEventListener("dblclick", onDoubleClick);
            launcher.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
        });
    }

    /**
     * Wires focus behaviour so a floating frame is brought to the front when interacted with.
     *
     * @returns {void}
     */
    private wireFrameFocus(): void {
        if (!this.frameEl) return;

        const onPointerDown = (): void => {
            if (!this.state.float) return;
            this.bring2Front();
        };

        this.frameEl.addEventListener("pointerdown", onPointerDown);

        this.cleanupFns.push(() => {
            this.frameEl?.removeEventListener("pointerdown", onPointerDown);
        });
    }

    /**
     * Wires viewport resize handling so floating windows remain within the visible area.
     *
     * @returns {void}
     */
    private wireViewportRzs(): void {
        const onResize = (): void => {
            if (!this.frameEl) return;
            if (!this.state.float) return;
            if (this.state.maxi) return;

            const next = this.clampPos(
                this.parsePxVal(this.state.x, 10),
                this.parsePxVal(this.state.y, 10)
            );

            this.state.x = `${next.left}px`;
            this.state.y = `${next.top}px`;

            this.persistState();
            this.applyFloatGeo();
            this.qLaytChng();
        };

        window.addEventListener("resize", onResize);

        this.cleanupFns.push(() => {
            window.removeEventListener("resize", onResize);
        });
    }

    /**
     * Observes frame size changes while floating so width and height can be persisted.
     *
     * @returns {void}
     */
    private observeFloatRzs(): void {
        if (typeof ResizeObserver === "undefined" || !this.frameEl) return;

        this.resizeObserver = new ResizeObserver(() => {
            if (!this.frameEl) return;
            if (!this.state.float) return;
            if (this.state.maxi) return;

            this.state.width = `${this.frameEl.offsetWidth}px`;
            this.state.height = `${this.frameEl.offsetHeight}px`;

            this.persistState();
            this.qLaytChng();
        });

        this.resizeObserver.observe(this.frameEl);
    }

    /**
     * Raises the floating frame above other managed windows by incrementing the shared z-index counter.
     *
     * @returns {void}
     */
    private bring2Front(): void {
        if (!this.frameEl) return;
        if (!this.state.float) return;

        WindowMaker.zIndexCounter += 1;
        this.frameEl.style.zIndex = String(WindowMaker.zIndexCounter);
        this.frameEl.style.setProperty("--window-z-index", String(WindowMaker.zIndexCounter));
    }

    /**
     * Applies the current state to the DOM by updating classes, data attributes,
     * visibility, geometry, launcher state, DOM host placement, and layout notifications.
     *
     * @returns {void}
     */
    private applyState(): void {
        if (!this.frameEl) return;

        if (this.state.maxi) {
            this.state.float = true;
        }

        this.frameEl.classList.add("window-frame");
        this.frameEl.classList.toggle("floating", this.state.float);
        this.frameEl.classList.toggle("maximised", this.state.maxi);
        this.frameEl.classList.toggle("minimised", this.state.mini);
        this.frameEl.classList.toggle("closed", this.state.closed);

        this.frameEl.dataset.windowFloating = String(this.state.float);
        this.frameEl.dataset.windowMaximised = String(this.state.maxi);
        this.frameEl.dataset.windowMinimised = String(this.state.mini);
        this.frameEl.dataset.windowClosed = String(this.state.closed);

        if (this.state.closed) {
            this.frameEl.style.display = "none";
            this.showLnchr();
            this.qLaytChng();
            return;
        }

        this.hideLnchr();
        this.frameEl.style.display = this.frameStyle?.display ?? "";
        this.applyMntFrLayt();
        this.applyMntCntLayt();

        if (this.state.float) {
            this.moveFr2FloatHost();
            this.applyFloatGeo();
            this.bring2Front();
        } else {
            this.restoreFrame();
            this.clearFloatGeo();
        }

        this.applyBodVis();
        this.qLaytChng();
    }

    /**
     * Applies floating or maximised positioning styles to the frame.
     *
     * @returns {void}
     */
    private applyFloatGeo(): void {
        if (!this.frameEl) return;
        if (!this.state.float) return;

        if (this.state.maxi) {
            this.frameEl.style.position = "fixed";
            this.frameEl.style.left = "0px";
            this.frameEl.style.top = "0px";
            this.frameEl.style.width = "100vw";
            this.frameEl.style.height = "100vh";
            this.frameEl.style.maxWidth = "100vw";
            this.frameEl.style.maxHeight = "100vh";
            (this.frameEl.style as CSSStyleDeclaration & { resize?: string }).resize = "none";
            this.frameEl.style.setProperty("--window-left", "0px");
            this.frameEl.style.setProperty("--window-top", "0px");
            this.frameEl.style.setProperty("--window-width", "100vw");
            this.frameEl.style.setProperty("--window-height", "100vh");
            return;
        }

        this.frameEl.style.position = "fixed";
        this.frameEl.style.left = this.state.x;
        this.frameEl.style.top = this.state.y;
        this.frameEl.style.width = this.state.width || "50%";
        this.frameEl.style.height = this.state.height || "";
        this.frameEl.style.maxWidth = "100vw";
        this.frameEl.style.maxHeight = "100vh";
        (this.frameEl.style as CSSStyleDeclaration & { resize?: string }).resize = "both";

        this.frameEl.style.setProperty("--window-left", this.state.x);
        this.frameEl.style.setProperty("--window-top", this.state.y);
        this.frameEl.style.setProperty("--window-width", this.state.width || "50%");
        this.frameEl.style.setProperty("--window-height", this.state.height || "auto");
    }

    /**
     * Restores the frame's original non-floating geometry styles.
     *
     * @returns {void}
     */
    private clearFloatGeo(): void {
        if (!this.frameEl || !this.frameStyle) return;

        this.frameEl.style.position = this.frameStyle.position;
        this.frameEl.style.left = this.frameStyle.left;
        this.frameEl.style.top = this.frameStyle.top;
        this.frameEl.style.width = this.frameStyle.width;
        this.frameEl.style.height = this.frameStyle.height;
        this.frameEl.style.maxWidth = this.frameStyle.maxWidth;
        this.frameEl.style.maxHeight = this.frameStyle.maxHeight;
        (this.frameEl.style as CSSStyleDeclaration & { resize?: string }).resize =
            this.frameStyle.resize;
        this.frameEl.style.zIndex = this.frameStyle.zIndex;
    }

    /**
     * Updates body visibility and control visibility based on the minimised state.
     *
     * @returns {void}
     */
    private applyBodVis(): void {
        if (!this.bodyEl) return;

        if (this.state.mini) {
            this.applyMiniFrLayt();
            this.applyMiniBodLayt();
        }

        if (this.state.mini && this.floatButtonEl) {
            this.floatButtonEl.hidden = true;
        }

        if (this.state.mini) return;

        this.clearMiniFr();
        this.clearMiniBod();

        if (this.floatButtonEl) {
            this.floatButtonEl.hidden = false;
        }
    }

    /**
     * Makes the launcher visible using its already captured position.
     *
     * @returns {void}
     */
    private showLnchr(): void {
        const launcher = this.launcherEl;
        if (!launcher) return;

        launcher.classList.add("window-launcher");
        launcher.setAttribute("data-window-launcher-visible", "true");
        this.applyLnchrPos();
    }

    /**
     * Marks the launcher as hidden.
     *
     * @returns {void}
     */
    private hideLnchr(): void {
        const launcher = this.launcherEl;
        if (!launcher) return;

        launcher.classList.add("window-launcher");
        launcher.setAttribute("data-window-launcher-visible", "false");
    }

    /**
     * Applies the persisted launcher coordinates to the launcher element.
     *
     * @returns {void}
     */
    private applyLnchrPos(): void {
        const launcher = this.launcherEl;
        if (!launcher) return;

        launcher.style.setProperty("--window-launcher-left", this.state.launcherX);
        launcher.style.setProperty("--window-launcher-top", this.state.launcherY);
        launcher.style.left = this.state.launcherX;
        launcher.style.top = this.state.launcherY;
    }

    /**
     * Updates the launcher position to match the frame's current position while floating.
     *
     * @returns {void}
     */
    private syncLnchr2Fr(): void {
        if (!this.frameEl || !this.launcherEl) return;
        if (!this.state.float) return;

        const rect = this.frameEl.getBoundingClientRect();

        this.state.launcherX = `${rect.left}px`;
        this.state.launcherY = `${rect.top}px`;

        this.applyLnchrPos();
        this.persistState();
    }

    /**
     * Saves the current frame bounds so they can be restored after leaving maximised mode.
     *
     * @returns {void}
     */
    private saveBndsSnp(): void {
        if (!this.frameEl) return;

        const rect = this.frameEl.getBoundingClientRect();

        this.state.restoreX = `${rect.left}px`;
        this.state.restoreY = `${rect.top}px`;
        this.state.restrWidth = `${rect.width}px`;
        this.state.restrHeight = `${rect.height}px`;
        this.state.restrFloat = this.state.float;
    }

    /**
     * Restores frame bounds and floating state from the saved maximise snapshot.
     *
     * @returns {void}
     */
    private restoreBnds(): void {
        this.state.x = this.state.restoreX || this.state.x;
        this.state.y = this.state.restoreY || this.state.y;
        this.state.width = this.state.restrWidth || this.state.width;
        this.state.height = this.state.restrHeight || this.state.height;
        this.state.float = this.state.restrFloat;
    }

    /**
     * Clamps a frame position so the floating window remains within the viewport.
     *
     * @param {number} left The requested left position in pixels.
     * @param {number} top The requested top position in pixels.
     * @returns {{ left: number; top: number }} The clamped position.
     */
    private clampPos(left: number, top: number): { left: number; top: number } {
        if (!this.frameEl) {
            return { left, top };
        }

        const frameWidth = Math.max(0, Math.min(this.frameEl.offsetWidth, window.innerWidth));
        const frameHeight = Math.max(0, Math.min(this.frameEl.offsetHeight, window.innerHeight));

        const maxLeft = Math.max(0, window.innerWidth - frameWidth);
        const maxTop = Math.max(0, window.innerHeight - frameHeight);

        return {
            left: Math.min(Math.max(0, left), maxLeft),
            top: Math.min(Math.max(0, top), maxTop)
        };
    }

    /**
     * Clamps a launcher position so the launcher remains within the viewport.
     *
     * @param {number} left The requested left position in pixels.
     * @param {number} top The requested top position in pixels.
     * @returns {{ left: number; top: number }} The clamped position.
     */
    private clampLnchrPos(left: number, top: number): { left: number; top: number } {
        const launcher = this.launcherEl;

        const launcherWidth = Math.max(
            0,
            Math.min(launcher?.offsetWidth || WindowMaker.launcherSize, window.innerWidth)
        );
        const launcherHeight = Math.max(
            0,
            Math.min(launcher?.offsetHeight || WindowMaker.launcherSize, window.innerHeight)
        );

        const maxLeft = Math.max(0, window.innerWidth - launcherWidth);
        const maxTop = Math.max(0, window.innerHeight - launcherHeight);

        return {
            left: Math.min(Math.max(0, left), maxLeft),
            top: Math.min(Math.max(0, top), maxTop)
        };
    }

    /**
     * Parses a CSS pixel-like string into a number.
     *
     * If parsing fails, the provided fallback is returned.
     *
     * @param {string} value The string value to parse.
     * @param {number} fallback The fallback number to use when parsing fails.
     * @returns {number} The parsed numeric value or the fallback.
     */
    private parsePxVal(value: string, fallback: number): number {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    /**
     * Queues the optional layout change callback so it runs after the browser has
     * had time to apply DOM and layout updates.
     *
     * @returns {void}
     */
    private qLaytChng(): void {
        const callback = this.options.onLayoutChange;
        if (!callback) return;
        if (this.layoutQueued) return;

        this.layoutQueued = true;

        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                this.layoutQueued = false;
                callback();
            });
        });
    }
}

/**
 * Mounts a single element as a managed window immediately.
 *
 * This is the runtime API for code-driven windows, unlike instantiateWindows,
 * which is for config-driven batch bootstrapping.
 *
 * @param {HTMLElement} element - Element to convert into a window.
 * @param {WindowApiOptions} [options={}] - Window options.
 * @returns {WindowHandle} Window controller.
 */
export function mountWindow(
    element: HTMLElement,
    options: WindowApiOptions = {}
): WindowHandle {
    const maker = new WindowMaker(options);
    maker.makeWindow(element);
    return maker;
}

