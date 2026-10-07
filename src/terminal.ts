import * as config from "./config.ts";
import * as helpers from "./helpers.ts";
import { THEME_CHANGED_EVENT } from "./themeChanger.ts";

type MobileDetectInstance = Readonly<{
    mobile: () => unknown;
}>;

type MobileDetectCtor = new (userAgent: string) => MobileDetectInstance;

type XtermResizeEvent = Readonly<{
    cols: number;
    rows: number;
}>;

type XtermTerminal = Readonly<{
    element?: HTMLElement | null;
    cols: number;
    rows: number;

    loadAddon: (addon: unknown) => void;
    open: (parent: HTMLElement) => void;

    write: (data: string, callback?: () => void) => void;
    writeln: (data: string, callback?: () => void) => void;

    scrollToBottom: () => void;

    onData: (handler: (data: string) => void) => unknown;
    onResize: (handler: (e: XtermResizeEvent) => void) => unknown;

    onRender?: (handler: () => void) => unknown;

    dispose: () => void;
}>;

type XtermTerminalCtor = new (options: Record<string, unknown>) => XtermTerminal;

type XtermFitAddon = Readonly<{
    fit: () => void;
}>;

type XtermFitAddonCtor = new () => XtermFitAddon;

declare global {
    interface Window {
        MobileDetect?: MobileDetectCtor;

        Terminal?: XtermTerminalCtor;

        FitAddon?: Readonly<{
            FitAddon: XtermFitAddonCtor;
        }>;
    }
}

type FollowState = {
    value: boolean;
};

type ScrollTrackingController = Readonly<{
    scrollToBottom: () => void;
    maybeScroll: () => void;
    forceFollowAndScroll: () => void;
}>;

type SessionTokenResult = Readonly<{
    token: string;
    isNew: boolean;
}>;

type WebSocketTransportOptions = Readonly<{
    onOpen?: (socket: WebSocket) => void;
    connectRef?: () => void;
    onConnectivityIssue?: (trigger: string) => void;
}>;

type WebUiTheme = "dark" | "light";

export const TERMINAL_READY_EVENT = "kc:terminal-ready";

const sessionTokenKey = "kc-session-token";
const terminalInteractionKey = "kc-terminal-interacted-token";
const pendingInteractionValue = "__pending__";

export type TerminalReadyDetail = Readonly<{
    textarea: HTMLTextAreaElement;
}>;

export type TerminalModule = Readonly<{
    term: XtermTerminal;
    fitAddon: XtermFitAddon;
    sendSeq: (seq: string) => void;
    setWebUiTheme?: (theme: WebUiTheme) => void;
    events: EventTarget;
    isReady: () => boolean;
    dispose: () => void;
}>;

/**
 * Reads one session-storage value without letting storage failures break the terminal.
 * @param {string} key Storage key.
 * @returns {string | null} Stored value when available.
 */
function readSessionValue(key: string): string | null {
    try {
        return window.sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * Writes one session-storage value without letting storage failures break the terminal.
 * @param {string} key Storage key.
 * @param {string} value Value to persist.
 * @returns {void} Nothing.
 */
function writeSessionValue(key: string, value: string): void {
    try {
        window.sessionStorage.setItem(key, value);
    } catch {
        // Ignore storage failures.
    }
}

/**
 * Removes one session-storage value without letting storage failures break the terminal.
 * @param {string} key Storage key.
 * @returns {void} Nothing.
 */
function dropSessionValue(key: string): void {
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // Ignore storage failures.
    }
}

/**
 * Marks the current terminal session as user-interacted.
 * A pending marker covers the tiny interval before a new shell token exists.
 * @returns {void} Nothing.
 */
function markTerminalInteracted(): void {
    const token = readSessionValue(sessionTokenKey);
    writeSessionValue(terminalInteractionKey, token || pendingInteractionValue);
}

/**
 * Binds a pending interaction marker to a newly-created shell token and drops stale markers.
 * @param {string} token Current terminal session token.
 * @returns {void} Nothing.
 */
function bindInteractionToSession(token: string): void {
    const marker = readSessionValue(terminalInteractionKey);

    if (marker === pendingInteractionValue) {
        writeSessionValue(terminalInteractionKey, token);
        return;
    }

    if (marker && marker !== token) {
        dropSessionValue(terminalInteractionKey);
    }
}

/**
 * Reports whether the user has sent any input to the current shell session.
 * @returns {boolean} True after the first user input byte/sequence.
 */
function hasTerminalInteracted(): boolean {
    const marker = readSessionValue(terminalInteractionKey);
    if (!marker) return false;

    const token = readSessionValue(sessionTokenKey);

    if (marker === pendingInteractionValue && token) {
        writeSessionValue(terminalInteractionKey, token);
    }

    if (marker === pendingInteractionValue) return true;

    return !!token && marker === token;
}

/**
 * @param {XtermTerminal} term - Xterm terminal instance.
 * @returns {Promise<HTMLTextAreaElement>} Resolves when the helper textarea exists.
 */
async function waitForTerminalTextarea(term: XtermTerminal): Promise<HTMLTextAreaElement> {
    const root = term.element;
    if (!(root instanceof HTMLElement)) {
        throw new Error("Terminal root element is not available");
    }

    const findTextarea = (): HTMLTextAreaElement | null => {
        return root.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea")
            || root.querySelector<HTMLTextAreaElement>("textarea")
            || null;
    };

    const existing = findTextarea();
    existing?.setAttribute("id", "terminal-helper-textarea");
    if (existing) return existing;

    return await new Promise<HTMLTextAreaElement>((resolve) => {
        const observer = new MutationObserver(() => {
            const textarea = findTextarea();
            if (!(textarea instanceof HTMLTextAreaElement)) return;

            observer.disconnect();
            resolve(textarea);
        });

        observer.observe(root, { childList: true, subtree: true });
    });
}

/**
 * @returns {Promise<boolean>} True if MobileDetect considers the UA mobile, else false.
 */
async function loadMobileDetect(): Promise<void> {
    const sources = [
        "https://kittycrow.dev/external?src=https://cdn.jsdelivr.net/npm/mobile-detect@1.4.5/mobile-detect.js",
        "https://cdn.jsdelivr.net/npm/mobile-detect@1.4.5/mobile-detect.js"
    ];

    for (const src of sources) {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        document.body.appendChild(script);

        await new Promise<void>((resolve) => {
            script.onload = () => resolve();
            script.onerror = () => resolve();
        });

        if (window.MobileDetect) return;
        script.remove();
    }
}

async function checkMobile(): Promise<boolean> {
    while (document.readyState === "loading") {
        await helpers.nextFrame();
    }

    if (!window.MobileDetect) await loadMobileDetect();

    const Ctor = window.MobileDetect;
    if (!Ctor) return false;

    const md = new Ctor(window.navigator.userAgent);
    const mobileValue = md.mobile();
    return !!mobileValue;
}

/**
 * @param {string} src - Script URL.
 * @returns {Promise<void>} Resolves when the script is present and loaded.
 */
function injectScript(src: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
        if (existing) {
            resolve();
            return;
        }

        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(s);
    });
}

/**
 * @param {string} href - Stylesheet URL.
 * @returns {void} Nothing.
 */
function injectCssLink(href: string): void {
    const existing = document.querySelector<HTMLLinkElement>(`link[href="${href}"]`);
    if (existing) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
}

/**
 * @returns {Promise<void>} Resolves when xterm.js and fit addon are available on window.
 */
async function ensureXtermLoaded(): Promise<void> {
    const hasTerminal = typeof window.Terminal !== "undefined";
    const hasFit = typeof window.FitAddon !== "undefined";

    injectCssLink("https://cdn.jsdelivr.net/npm/xterm/css/xterm.css");

    if (!hasTerminal) {
        await injectScript("https://cdn.jsdelivr.net/npm/xterm/lib/xterm.js");
    }

    if (!hasFit) {
        await injectScript("https://cdn.jsdelivr.net/npm/xterm-addon-fit/lib/xterm-addon-fit.js");
    }
}

/**
 * @param {() => void} fn - Callback to run after two frames.
 * @returns {void} Nothing.
 */
function raf2(fn: () => void): void {
    window.requestAnimationFrame(() => window.requestAnimationFrame(fn));
}

/**
 * @param {readonly string[]} ids - Candidate element ids.
 * @returns {HTMLElement | null} First matching HTMLElement.
 */
function firstExistingEl(ids: readonly string[]): HTMLElement | null {
    for (const id of ids) {
        const el = helpers.getEl(id);
        if (el) return el;
    }
    return null;
}

/**
 * @param {() => void} fitNow - Fit callback.
 * @returns {() => void} Detach function.
 */
function attachSafeResizeFitting(fitNow: () => void): () => void {
    const onResize = (): void => raf2(fitNow);
    window.addEventListener("resize", onResize);

    const vv = window.visualViewport ?? null;
    const onVVResize = vv ? (): void => raf2(fitNow) : null;

    if (vv && onVVResize) vv.addEventListener("resize", onVVResize);

    return (): void => {
        window.removeEventListener("resize", onResize);
        if (vv && onVVResize) vv.removeEventListener("resize", onVVResize);
    };
}

/**
 * @param {HTMLElement} observedEl - Element whose size changes should trigger a fit.
 * @param {() => void} fitNow - Fit callback.
 * @returns {() => void} Detach function.
 */
function attachTerminalResizeObserver(observedEl: HTMLElement, fitNow: () => void): () => void {
    if (typeof ResizeObserver === "undefined") {
        return (): void => {
            // Nothing to detach.
        };
    }

    const observer = new ResizeObserver(() => {
        raf2(fitNow);
    });

    observer.observe(observedEl);

    return (): void => {
        observer.disconnect();
    };
}

/**
 * @param {XtermTerminal} term - Xterm terminal instance.
 * @param {FollowState} followState - Follow state reference.
 * @returns {ScrollTrackingController} Scroll tracking controller.
 */
function attachScrollTracking(term: XtermTerminal, followState: FollowState): ScrollTrackingController {
    type InternalController = {
        _viewport: HTMLElement | null;
        _programmatic: boolean;

        _resolveViewport: () => HTMLElement | null;
        _atBottom: (vp: HTMLElement) => boolean;

        scrollToBottom: () => void;
        maybeScroll: () => void;
        forceFollowAndScroll: () => void;

        wire: () => boolean;
    };

    const ctl: InternalController = {
        _viewport: null,
        _programmatic: false,

        _resolveViewport(): HTMLElement | null {
            const root = term.element ?? null;
            if (!root) return null;

            const vp = root.querySelector(".xterm-viewport");
            if (vp instanceof HTMLElement) {
                this._viewport = vp;
                return vp;
            }

            return this._viewport;
        },

        _atBottom(vp: HTMLElement): boolean {
            return vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 2;
        },

        scrollToBottom(): void {
            this._programmatic = true;
            term.scrollToBottom();
            window.requestAnimationFrame(() => {
                this._programmatic = false;
            });
        },

        maybeScroll(): void {
            if (!followState.value) return;
            this.scrollToBottom();
        },

        forceFollowAndScroll(): void {
            followState.value = true;
            this.scrollToBottom();
        },

        wire(): boolean {
            const vp = this._resolveViewport();
            if (!vp) return false;

            if (vp.dataset.scrollWired === "true") return true;
            vp.dataset.scrollWired = "true";

            vp.addEventListener("scroll", () => {
                if (this._programmatic) return;
                followState.value = this._atBottom(vp);
            });

            return true;
        }
    };

    if (!ctl.wire()) {
        raf2(() => {
            ctl.wire();
        });
    }

    return {
        scrollToBottom: () => ctl.scrollToBottom(),
        maybeScroll: () => ctl.maybeScroll(),
        forceFollowAndScroll: () => ctl.forceFollowAndScroll()
    };
}

/**
 * @returns {Promise<SessionTokenResult>} Session token and whether it was newly created.
 */
async function getOrCreateSessionToken(): Promise<SessionTokenResult> {
    const existing = readSessionValue(sessionTokenKey);
    if (existing && existing.length > 0) {
        bindInteractionToSession(existing);
        return { token: existing, isNew: false };
    }

    const res = await fetch(`${config.sessionTokenURL}`, {
        method: "GET",
        cache: "no-store",
        credentials: "omit"
    });

    if (!res.ok) {
        throw new Error(`Failed to obtain session token (status=${res.status})`);
    }

    const bodyUnknown: unknown = await res.json();
    const token =
        helpers.isRecord(bodyUnknown) &&
            typeof bodyUnknown.sessionToken === "string" &&
            bodyUnknown.sessionToken.length > 0
            ? bodyUnknown.sessionToken
            : "";

    if (!token) {
        throw new Error("Session endpoint returned no sessionToken");
    }

    writeSessionValue(sessionTokenKey, token);
    bindInteractionToSession(token);
    return { token, isNew: true };
}

/**
 * @param {XtermTerminal} term - Xterm terminal.
 * @param {ScrollTrackingController} scrollCtl - Scroll controller.
 * @param {WebSocketTransportOptions} opts - Transport options.
 * @returns {Promise<WebSocket>} Connected websocket.
 */
async function attachWebSocketTransport(
    term: XtermTerminal,
    scrollCtl: ScrollTrackingController,
    opts: WebSocketTransportOptions = {}
): Promise<WebSocket> {
    const { token: sessionToken, isNew } = await getOrCreateSessionToken();
    const wsUrl = `wss://bash.kittycrow.dev/?sessionToken=${encodeURIComponent(sessionToken)}`;

    const onOpen = typeof opts.onOpen === "function" ? opts.onOpen : null;
    const connectRef = typeof opts.connectRef === "function" ? opts.connectRef : null;
    const onConnectivityIssue =
        typeof opts.onConnectivityIssue === "function" ? opts.onConnectivityIssue : null;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    let openTimer: number | null = null;
    const openTimeoutMs = 3500;

    let connectivityIssueEmitted = false;

    /**
     * @param {string} trigger - Issue trigger label.
     * @returns {void} Nothing.
     */
    const emitConnectivityIssue = (trigger: string): void => {
        if (!onConnectivityIssue) return;
        if (connectivityIssueEmitted) return;
        connectivityIssueEmitted = true;
        onConnectivityIssue(trigger);
    };

    /**
     * @returns {void} Nothing.
     */
    const clearOpenTimer = (): void => {
        if (openTimer === null) return;
        window.clearTimeout(openTimer);
        openTimer = null;
    };

    openTimer = window.setTimeout(() => {
        openTimer = null;

        const notOpenYet = ws.readyState !== WebSocket.OPEN;
        if (!notOpenYet) return;

        const terminalState = ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED;
        if (terminalState) return;

        term.writeln("\r\n[connection timeout]");
        scrollCtl.forceFollowAndScroll();
        emitConnectivityIssue("ws-open-timeout");
    }, openTimeoutMs);

    ws.addEventListener("open", () => {
        clearOpenTimer();
        scrollCtl.forceFollowAndScroll();

        if (onOpen) onOpen(ws);

        if (!isNew) return;

        window.setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            ws.send("nekofetch\r");
        }, 50);
    });

    ws.addEventListener("message", (ev: MessageEvent) => {
        if (typeof ev.data === "string") {
            term.write(ev.data);
            scrollCtl.maybeScroll();
            return;
        }

        if (ev.data instanceof ArrayBuffer) {
            const text = new TextDecoder().decode(ev.data);
            term.write(text);
            scrollCtl.maybeScroll();
            return;
        }

        if (ev.data instanceof Blob) {
            void ev.data.arrayBuffer().then((buf) => {
                const text = new TextDecoder().decode(buf);
                term.write(text);
                scrollCtl.maybeScroll();
            });
            return;
        }

        // Unknown payload shape, ignore.
    });

    ws.addEventListener("close", (ev: CloseEvent) => {
        clearOpenTimer();

        const sessionEnded = ev.code === 4001;

        if (sessionEnded) {
            dropSessionValue(sessionTokenKey);
            dropSessionValue(terminalInteractionKey);
            term.writeln("\r\n[session ended, reconnecting with a new token…]");
            scrollCtl.forceFollowAndScroll();
        }

        if (sessionEnded && connectRef) {
            window.setTimeout(connectRef, 0);
        }

        if (sessionEnded) return;

        const normalClosure = ev.code === 1000;
        if (normalClosure) {
            term.writeln("\r\n[disconnected]");
            scrollCtl.forceFollowAndScroll();
            return;
        }

        term.writeln("\r\n[disconnected]");
        scrollCtl.forceFollowAndScroll();
        emitConnectivityIssue(`ws-close-${ev.code}`);
    });

    ws.addEventListener("error", () => {
        clearOpenTimer();

        term.writeln("\r\n[connection error]");
        scrollCtl.forceFollowAndScroll();
        emitConnectivityIssue("ws-error");
    });

    return ws;
}

/**
 * @param {string} trigger - Connectivity trigger.
 * @returns {string} Friendly notice for WebSocket failures.
 */
function wsUnreachableNoticeText(trigger: string): string {
    const base =
        "Try refreshing to reconnect. If the issue persists email me at kitty@kittycrow.dev";

    return `[notice] ${base} (trigger: ${trigger})`;
}

/**
 * @returns {Promise<TerminalModule>} Terminal module API.
 */
export async function setupTerminalModule(): Promise<TerminalModule> {
    await ensureXtermLoaded();

    const TerminalCtor = window.Terminal;
    if (!TerminalCtor) throw new Error("xterm.js failed to load (window.Terminal missing)");

    const FitAddonNamespace = window.FitAddon;
    const FitAddonCtor = FitAddonNamespace?.FitAddon;
    if (!FitAddonCtor) {
        throw new Error("xterm fit addon failed to load (window.FitAddon.FitAddon missing)");
    }

    const terminalWrapper = helpers.getEl("terminal-wrapper");
    const shellWrapper = firstExistingEl(["shell-wrapper", "banner-wrapper"]);

    if (!terminalWrapper) throw new Error("Missing element: #terminal-wrapper");
    if (!shellWrapper) throw new Error("Missing element: #shell-wrapper or #banner-wrapper");

    let ws: WebSocket | null = null;
    let reconnecting = false;
    let webUiThemePending: WebUiTheme | null = null;
    const events = new EventTarget();
    let ready = false;

    let lastWsNoticeAt = 0;
    let lastWsNoticeKey: string | null = null;

    terminalWrapper.innerHTML = "";

    const scrollArea = document.createElement("div");
    scrollArea.id = "terminal-scroll";

    const termDiv = document.createElement("div");
    termDiv.id = "term";

    scrollArea.appendChild(termDiv);
    terminalWrapper.appendChild(scrollArea);

    const isMobile = await checkMobile();

    const term = new TerminalCtor({
        cursorBlink: true,
        convertEol: true,
        fontSize: isMobile ? 12 : 14
    });

    const fitAddon = new FitAddonCtor();
    term.loadAddon(fitAddon);

    const followState: FollowState = { value: true };

    let scrollCtl: ScrollTrackingController | null = null;
    let fitScheduled = false;

    /**
     * @returns {void} Nothing.
     */
    const fitNow = (): void => {
        if (!scrollCtl) return;
        if (!term.element) return;

        const rect = termDiv.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        fitAddon.fit();
        scrollCtl.maybeScroll();
    };

    /**
     * @returns {void} Nothing.
     */
    const scheduleFit = (): void => {
        if (fitScheduled) return;

        fitScheduled = true;
        raf2(() => {
            fitScheduled = false;
            fitNow();
        });
    };

    term.open(termDiv);

    scrollCtl = attachScrollTracking(term, followState);

    /**
     * @param {string} trigger - What triggered the notice.
     * @returns {void} Nothing.
     */
    const notifyWsUnreachable = (trigger: string): void => {
        const nowMs = Date.now();
        const throttleMs = 4000;
        const key = trigger;

        const tooSoon = nowMs - lastWsNoticeAt < throttleMs;
        if (tooSoon && lastWsNoticeKey === key) return;

        lastWsNoticeAt = nowMs;
        lastWsNoticeKey = key;

        term.writeln(`\r\n${wsUnreachableNoticeText(trigger)}`);
        scrollCtl?.forceFollowAndScroll();
    };

    let pendingResize: string | null = null;
    let lastCols = 0;
    let lastRows = 0;

    /**
     * @param {number} cols - Terminal columns.
     * @param {number} rows - Terminal rows.
     * @returns {void} Nothing.
     */
    function sendResize(cols: number, rows: number): void {
        if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
        if (cols <= 0 || rows <= 0) return;

        if (cols === lastCols && rows === lastRows) return;
        lastCols = cols;
        lastRows = rows;

        const payload = JSON.stringify({ type: "resize", cols, rows });

        if (!ws || ws.readyState !== WebSocket.OPEN) {
            pendingResize = payload;
            return;
        }

        ws.send(payload);
    }

    term.onResize(({ cols, rows }) => {
        sendResize(cols, rows);
    });

    term.onData((data: string) => {
        markTerminalInteracted();
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(data);
    });

    /**
     * @param {WebSocket | null} socket - Optional socket override.
     * @returns {void} Nothing.
     */
    const sendPendingWebUiTheme = (socket: WebSocket | null = null): void => {
        const s = socket || ws;
        if (!webUiThemePending) return;
        if (!s || s.readyState !== WebSocket.OPEN) return;

        webUiThemePending = null;
    };

    /**
     * @param {WebUiTheme} theme - Theme value.
     * @returns {void} Nothing.
     */
    const setWebUiTheme = (theme: WebUiTheme): void => {
        webUiThemePending = theme;
        sendPendingWebUiTheme();
    };

    /**
     * @returns {Promise<void>} Resolves once a connection attempt finishes.
     */
    const connectWs = async (): Promise<void> => {
        if (reconnecting) return;
        if (!scrollCtl) return;

        reconnecting = true;

        try {
            const next = await attachWebSocketTransport(term, scrollCtl, {
                onOpen: (socket: WebSocket) => {
                    sendPendingWebUiTheme(socket);

                    if (pendingResize) {
                        socket.send(pendingResize);
                        pendingResize = null;
                        return;
                    }

                    sendResize(term.cols, term.rows);
                },
                connectRef: () => {
                    void connectWs();
                },
                onConnectivityIssue: (trigger: string) => {
                    notifyWsUnreachable(trigger);
                }
            });

            ws = next;

            ws.addEventListener("open", () => {
                if (!ws) return;

                if (pendingResize) {
                    ws.send(pendingResize);
                    pendingResize = null;
                    return;
                }

                sendResize(term.cols, term.rows);
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "unknown error";
            term.writeln(`\r\n[connection failed: ${msg}]`);
            scrollCtl.forceFollowAndScroll();
            notifyWsUnreachable("ws-setup-failed");
        } finally {
            reconnecting = false;
        }
    };

    await connectWs();

    /**
     * Re-runs the decorative terminal output after a site-theme change only while
     * the current shell session is still untouched by the user.
     * @returns {void} Nothing.
     */
    const refreshUntouchedTerminal = (): void => {
        if (hasTerminalInteracted()) return;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        ws.send("clear\rnekofetch\r");
        scrollCtl?.forceFollowAndScroll();
    };

    document.addEventListener(THEME_CHANGED_EVENT, refreshUntouchedTerminal);

    if (typeof term.onRender === "function") {
        term.onRender(() => {
            scrollCtl?.maybeScroll();
        });
    } else {
        const origWrite = term.write.bind(term);
        const origWriteln = term.writeln.bind(term);

        (term as unknown as { write: (data: string, cb?: () => void) => void }).write = (
            data: string,
            cb?: () => void
        ) => {
            origWrite(data, cb);
            raf2(() => {
                scrollCtl?.maybeScroll();
            });
        };

        (term as unknown as { writeln: (data: string, cb?: () => void) => void }).writeln = (
            data: string,
            cb?: () => void
        ) => {
            origWriteln(data, cb);
            raf2(() => {
                scrollCtl?.maybeScroll();
            });
        };
    }

    const detachResizeHandlers = attachSafeResizeFitting(scheduleFit);
    const detachResizeObserver = attachTerminalResizeObserver(shellWrapper, scheduleFit);

    scheduleFit();

    void (async (): Promise<void> => {
        try {
            const textarea = await waitForTerminalTextarea(term);
            await helpers.nextFrame();

            ready = true;

            events.dispatchEvent(new CustomEvent<TerminalReadyDetail>(TERMINAL_READY_EVENT, {
                detail: { textarea }
            }));
        } catch (error: unknown) {
            console.error("Failed to emit terminal ready event:", error);
        }
    })();

    return {
        term,
        fitAddon,
        sendSeq: (seq: string): void => {
            markTerminalInteracted();
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(seq);
        },
        setWebUiTheme,
        events,
        isReady: (): boolean => ready,
        dispose: (): void => {
            document.removeEventListener(THEME_CHANGED_EVENT, refreshUntouchedTerminal);
            detachResizeHandlers();
            detachResizeObserver();

            try {
                ws?.close();
            } catch {
                // ignore
            }

            term.dispose();
        }
    };
}