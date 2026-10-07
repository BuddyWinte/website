import * as config from "./config.ts";
import { removeExistingById, recreateSingleton } from "./domSingletons.ts";
import * as Terminal from "./terminal.ts";
import { keyboardEmu } from "./keyboard.ts";
import * as loader from "./loader.ts";
import { createMenu } from "./menu.tsx";
import { createHeader } from "./header.ts";
import { createFooter } from "./footer.ts";
import { fetchUiData } from "./uiFetch.ts";
import { initEffectsControls } from "./effects.tsx";
import * as helpers from "./helpers.ts";
import { installMenuToggle } from "./menues.tsx";
import { initNtcs } from "./notices.tsx";
import { initNoticeBoard } from "./noticeBoard.tsx";
import { bindToggleVisuals, showToggleVisual } from "./toggleIcons.ts";
import * as themeChanger from "./themeChanger.ts";
import { initBadgeCopy } from "./main/badge.ts";
import { getCookie, setCookie } from "./main/cookies.ts";
import { getIsMobile, setMobileScale } from "./main/device.ts";
import { ensureFloatBtns } from "./main/floatingControls.ts";
import { applyHeadBits } from "./main/head.ts";
import { loadCrtUi } from "./main/crtRoute.ts";
import { loadReaderRuntime } from "./main/readerRoute.ts";
import { fetchStatus } from "./main/status.ts";

// import { mkCurTheme } from "./cursors/cursorTheme.tsx";

// const cur = mkCurTheme("/data/cursors/macOS9");

type TermMod = Readonly<{
    term: Readonly<{
        element: HTMLElement | null;
    }>;
    sendSeq: (seq: string) => void;
    dispose: () => void;
    setWebUiTheme?: (theme: "dark" | "light") => void;
}>;

type KbInst = Readonly<{
    destroy: () => void;
}>;

type KbCtor = new (
    isMobile: boolean,
    htmlUrl?: string,
    cssUrl?: string
) => Readonly<{
    install: (
        transport: Readonly<{ send: (payload: Readonly<{ seq: string }>) => void }>,
        inputEl: HTMLTextAreaElement
    ) => Promise<KbInst>;
}>;

const params = new URLSearchParams(window.location.search);

let termMod: TermMod | null = null;
let nextTheme: "dark" | "light" | null = null;
let curTheme: "dark" | "light" | null = null;

const FLOAT_TOGGLE_ICON_SPEC = {
    size: 32,
    wrapperClass: "theme-toggle-button__icon",
    svgClass: "theme-toggle-button__svg"
} as const;

/**
 * Boots the terminal side of the page.
 * Also wires the mobile keyboard if we ended up on mobile and found the textarea.
 * @returns {Promise<void>}
 */
async function bootTerm(): Promise<void> {
    const onMobile = await getIsMobile();

    setMobileScale(onMobile);

    const status = await fetchStatus(2000);

    const terminal = await Terminal.setupTerminalModule()
        .then((mod) => {
            document.getElementById("terminal-loading")?.style.setProperty("display", "none");
            return mod as TermMod;
        })
        .catch((err: unknown) => {
            console.error("Terminal initialisation failed:", err);
            throw err;
        });

    await helpers.nextFrame();

    const xtermTextarea =
        terminal.term.element?.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea") ||
        terminal.term.element?.querySelector<HTMLTextAreaElement>("textarea") ||
        null;

    const Kb = keyboardEmu as KbCtor;

    const keyboard: KbInst | null =
        onMobile && xtermTextarea
            ? await new Kb(onMobile).install(
                { send: ({ seq }) => terminal.sendSeq(seq) },
                xtermTextarea
            )
            : null;

    const dispose = terminal.dispose;
    (terminal as { dispose: () => void }).dispose = () => {
        if (keyboard) keyboard.destroy();
        dispose();
    };

    termMod = terminal;

    if (nextTheme && typeof termMod.setWebUiTheme === "function") {
        termMod.setWebUiTheme(nextTheme);
        nextTheme = null;
    }

    void status;
}

/**
 * Forces a repaint.
 * Cheap little nudge for the theme swap.
 * @returns {void}
 */
const repaint = (): void => {
    void document.body.offsetHeight;
};

/**
 * Builds the rest of the page UI.
 * menu, header, footer, theme bits, reader bits, all that lot.
 * @returns {Promise<void>}
 */
async function initUi(): Promise<void> {
    try {
        const data = await fetchUiData();

        await Promise.all([
            createMenu(data, document),
            createHeader(data, document),
            createFooter(data, document)
        ]);

        if (data.headerInjections && data.headerInjections.length > 0) {
            applyHeadBits(document, data.headerInjections);
        }

        if (data.headScripts) {
            data.headScripts.forEach((scriptSrc) => {
                const scriptId = helpers.makeStableId("kc-head-script_", scriptSrc);

                removeExistingById(scriptId, document);

                const script = document.createElement("script");
                script.id = scriptId;
                script.src = scriptSrc;
                script.defer = true;
                document.head.appendChild(script);
            });
        }

        if (data.windows) {
            const windowAPI = await import("./window.ts");
            await windowAPI.instantiateWindows(data.windows);
        }

        const themeToggle = recreateSingleton("theme-toggle", () => document.createElement("button"), document);
        themeToggle.classList.add("theme-toggle-button");
        document.body.appendChild(themeToggle);

        bindToggleVisuals(themeToggle, {
            light: {
                emoji: data.themeToggle.light,
                iconPath: data.themeToggle.lightIconPath,
                title: data.themeToggle.title || "Theme"
            },
            dark: {
                emoji: data.themeToggle.dark,
                iconPath: data.themeToggle.darkIconPath,
                title: data.themeToggle.title || "Theme"
            }
        });

        /**
         * Applies the chosen theme and optionally persists it.
         * @param {"dark" | "light"} theme
         * @param {boolean} persist
         * @returns {void}
         */
        const applyTheme = (theme: "dark" | "light", persist: boolean = false): void => {
            document.documentElement.classList.toggle("dark-mode", theme === "dark");
            document.documentElement.classList.toggle("light-mode", theme === "light");

            // Keep theme details
            document.dispatchEvent(
                new CustomEvent<themeChanger.ThemeModeChangedDetail>(
                    themeChanger.THEME_MODE_CHANGED_EVENT,
                    { detail: { current: theme } }
                )
            );

            void showToggleVisual(
                themeToggle,
                theme === "dark" ? "dark" : "light",
                FLOAT_TOGGLE_ICON_SPEC
            );

            curTheme = theme;

            if (persist) {
                setCookie("darkMode", theme === "dark" ? "true" : "false");
            }

            repaint();

            if (termMod && typeof termMod.setWebUiTheme === "function") {
                termMod.setWebUiTheme(theme);
                return;
            }

            nextTheme = theme;
        };

        /**
         * Applies the `darkmode` query param when present.
         * Keeps the old behaviour, just without the nested mess.
         * @returns {void}
         */
        const applyDarkModeParam = (): void => {
            if (!params.has("darkmode")) {
                return;
            }

            const raw = params.get("darkmode");
            const v = (raw ?? "").toLowerCase();

            if (v === "true") applyTheme("dark", true);
            if (v === "false") applyTheme("light", true);
        };

        const cookieDark = getCookie("darkMode");
        const osDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

        if (cookieDark !== null) {
            applyTheme(cookieDark === "true" ? "dark" : "light");
        } else {
            applyTheme(osDark ? "dark" : "light");
        }

        themeToggle.addEventListener("click", () => {
            applyTheme(curTheme === "dark" ? "light" : "dark", true);
        });

        themeToggle.title = data.themeToggle.title || "Theme";

        initEffectsControls(data.effects);

        ensureFloatBtns();

        await initNtcs();
        await initNoticeBoard();

        if (window.matchMedia) {
            const mq = window.matchMedia("(prefers-color-scheme: dark)");

            mq.addEventListener("change", (e) => {
                const osTheme: "dark" | "light" = e.matches ? "dark" : "light";
                if (curTheme === osTheme) return;

                applyTheme(osTheme, false);
            });
        }

        if (data.crtUi) {
            const crtNoise = await loadCrtUi();
            await crtNoise.initModal();

            installMenuToggle({
                id: "crt-ui-toggle",
                bottom: "140px",
                cfg: data.crtUi,
                icon: {
                    size: 32,
                    wrapperClass: "effects-toggle-button__icon",
                    svgClass: "effects-toggle-button__svg"
                },
                openModal: () => crtNoise.openModal()
            });
        }

        const isReaderRoute =
            window.location.pathname === "/reader" ||
            window.location.pathname.startsWith("/reader/");

        if (!isReaderRoute) {
            applyDarkModeParam();
            return;
        }

        const {
            setupReaderToggle,
            initReaderModeTip,
            readerModeFocus,
            readerModeKeep,
            showReadAloudMenu
        } = await loadReaderRuntime();

        const readerToggle = recreateSingleton("reader-toggle", () => document.createElement("button"), document);
        readerToggle.classList.add("theme-toggle-button");
        readerToggle.style.bottom = "140px";

        bindToggleVisuals(readerToggle, {
            enable: {
                emoji: data.readerModeToggle.enable,
                iconPath: data.readerModeToggle.enableIconPath,
                title: data.readerModeToggle.title || "Reader Mode"
            },
            disable: {
                emoji: data.readerModeToggle.disable,
                iconPath: data.readerModeToggle.disableIconPath,
                title: data.readerModeToggle.title || "Reader Mode"
            }
        });

        void showToggleVisual(readerToggle, "enable", FLOAT_TOGGLE_ICON_SPEC);
        document.body.appendChild(readerToggle);
        initReaderModeTip(readerToggle);

        await setupReaderToggle({
            focus: readerModeFocus,
            keep: [
                ...readerModeKeep,
                "#theme-toggle",
                "#reader-toggle",
                "#read-aloud-toggle",
                "#main-menu",
                "#main-header",
                "#main-footer"
            ],
            sheetPurge: [
                "effects.css"
            ]
        });

        const readAloudToggle = recreateSingleton("read-aloud-toggle", () => document.createElement("button"), document);
        readAloudToggle.classList.add("theme-toggle-button");
        readAloudToggle.style.bottom = "200px";

        bindToggleVisuals(readAloudToggle, {
            enable: {
                emoji: data.readAloudToggle.enable,
                iconPath: data.readAloudToggle.enableIconPath ?? data.readAloudToggle.iconPath,
                title: data.readAloudToggle.title || "Enable Read Aloud"
            },
            disable: {
                emoji: data.readAloudToggle.disable,
                iconPath: data.readAloudToggle.disableIconPath ?? data.readAloudToggle.iconPath,
                title: data.readAloudToggle.title || "Disable Read Aloud"
            }
        });

        void showToggleVisual(readAloudToggle, "enable", FLOAT_TOGGLE_ICON_SPEC);
        document.body.appendChild(readAloudToggle);

        readAloudToggle.addEventListener("click", showReadAloudMenu);

        ensureFloatBtns();
        applyDarkModeParam();
    } catch (error: unknown) {
        console.error("Error loading JSON or updating DOM:", error);
    }
}

/**
 * DOM ready handler for this module.
 * Kicks off terminal boot, UI init, and the badge copy button.
 * @returns {void}
 */
const onReady = (): void => {
    document.body.style.visibility = "visible";
    document.body.style.opacity = "1";

    void bootTerm();
    initBadgeCopy();
    void initUi();
};

document.addEventListener("DOMContentLoaded", onReady);
