import { isRecord } from "../helpers.ts";
import {
    DEF_WIN_H,
    DEF_WIN_W,
    FRAME_ID,
    LD_CONTENT_ID,
    LD_NOTICE_ID,
    LD_STAGE_ID,
    LD_STYLE_ID,
    WIN_STORE_KEY
} from "./constants.ts";
import type { WinSize } from "./types.ts";

export function setFrameMinH(): void {
    const frameEl = document.getElementById(FRAME_ID);
    if (!(frameEl instanceof HTMLDivElement)) return;

    frameEl.style.minHeight = `${DEF_WIN_H}px`;
}

export function readWinSize(): WinSize {
    const fallback: WinSize = {
        width: `${DEF_WIN_W}px`,
        height: `${DEF_WIN_H}px`
    };

    try {
        const raw = window.localStorage.getItem(WIN_STORE_KEY);
        if (raw === null) return fallback;

        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed)) return fallback;

        const width =
            typeof parsed.width === "string" &&
            parsed.width.trim() !== ""
                ? parsed.width
                : fallback.width;

        const height =
            typeof parsed.height === "string" &&
            parsed.height.trim() !== ""
                ? parsed.height
                : fallback.height;

        return { width, height };
    } catch {
        return fallback;
    }
}

export function setLdSize(
    stageEl: HTMLDivElement,
    contentLayerEl: HTMLDivElement
): void {
    const size = readWinSize();

    stageEl.style.width = size.width;
    stageEl.style.height = size.height;
    stageEl.style.minWidth = size.width;
    stageEl.style.minHeight = size.height;

    contentLayerEl.style.minWidth = size.width;
    contentLayerEl.style.minHeight = size.height;
}

export function clrLdSize(
    stageEl: HTMLDivElement,
    contentLayerEl: HTMLDivElement
): void {
    stageEl.style.width = "";
    stageEl.style.height = "";
    stageEl.style.minWidth = "";
    stageEl.style.minHeight = "";

    contentLayerEl.style.minWidth = "";
    contentLayerEl.style.minHeight = "";
}

export function ensureLdCss(): void {
    if (document.getElementById(LD_STYLE_ID)) return;

    const styleEl = document.createElement("style");
    styleEl.id = LD_STYLE_ID;
    styleEl.textContent = `
#${LD_STAGE_ID} {
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

#${LD_NOTICE_ID},
#${LD_CONTENT_ID} {
  grid-area: 1 / 1;
  min-width: 0;
  min-height: 0;
}

#${LD_NOTICE_ID} {
  z-index: 2;
  display: grid;
  place-items: center;
  pointer-events: none;
  visibility: visible;
  opacity: 1;
  transition:
    opacity 180ms ease,
    visibility 0s linear 0s;
}

#${LD_STAGE_ID}[data-ready="true"] #${LD_NOTICE_ID} {
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 180ms ease,
    visibility 0s linear 180ms;
}

#${LD_CONTENT_ID} {
  z-index: 1;
  width: 100%;
  height: 100%;
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
}

#${LD_STAGE_ID}[data-ready="true"] #${LD_CONTENT_ID} {
  opacity: 1;
  pointer-events: auto;
}

#${LD_CONTENT_ID} > .crt-ui__layout {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

#${LD_NOTICE_ID} .crt-ui__loadingInner {
  display: inline-flex;
  align-items: flex-end;
  justify-content: center;
  gap: 0.04em;
  padding: 0.7rem 1rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--frame-bg-colour, #111) 82%, transparent);
  border: 1px solid color-mix(in srgb, var(--nav-border-colour, #444) 70%, transparent);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22);
  color: var(--body-text-colour, #fff);
  font: inherit;
  font-size: 0.95rem;
  line-height: 1;
  white-space: nowrap;
}

#${LD_NOTICE_ID} .crt-ui__loadingDots {
  display: inline-flex;
  align-items: flex-end;
}

#${LD_NOTICE_ID} .crt-ui__loadingDot {
  display: inline-block;
  min-width: 0.3em;
  text-align: center;
  animation: crt-ui-loading-dot 0.9s infinite ease-in-out;
  opacity: 0.45;
}

#${LD_NOTICE_ID} .crt-ui__loadingDot:nth-child(1) {
  animation-delay: 0s;
}

#${LD_NOTICE_ID} .crt-ui__loadingDot:nth-child(2) {
  animation-delay: 0.12s;
}

#${LD_NOTICE_ID} .crt-ui__loadingDot:nth-child(3) {
  animation-delay: 0.24s;
}

@keyframes crt-ui-loading-dot {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.45;
  }

  30% {
    transform: translateY(-0.24em);
    opacity: 1;
  }
}
`.trim();

    document.head.appendChild(styleEl);
}

export function setLdReady(
    stageEl: HTMLDivElement,
    isReady: boolean
): void {
    stageEl.dataset.ready = isReady ? "true" : "false";
}
