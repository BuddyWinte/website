import { isRecord } from "../helpers.ts";
import { waitForDomPaint } from "../reactHelpers.tsx";
import { WindowMaker } from "./WindowMaker.ts";
import type { WindowApiOptions } from "./types.ts";

/**
 * @param {unknown} windowDefinitions Raw window definitions from configuration.
 * @returns {Promise<void>} Resolves after all eligible windows have been processed.
 */
export async function instantiateWindows(windowDefinitions: unknown): Promise<void> {
    await waitForDomPaint();

    if (!isRecord(windowDefinitions)) return;

    const defs = Object.values(windowDefinitions);

    for (const definitionUnknown of defs) {
        if (!isRecord(definitionUnknown)) {
            continue;
        }

        const selector = typeof definitionUnknown.selector === "string"
            ? definitionUnknown.selector
            : "";

        if (!selector) {
            continue;
        }

        const retry = definitionUnknown.retry === true;
        const rawRetryCount = typeof definitionUnknown.noOfRetries === "number"
            ? definitionUnknown.noOfRetries
            : 0;

        const maxRetries = retry ? rawRetryCount : 0;
        let attempt = 0;
        let element: HTMLElement | null = null;

        element = document.querySelector(selector) as HTMLElement | null;

        if (!(element instanceof HTMLElement)) {
            continue;
        }

        if (element.dataset.windowApiMounted === "true") {
            continue;
        }

        const optionsUnknown = definitionUnknown.options;

        if (!isRecord(optionsUnknown)) {
            console.warn("Window definition missing options, skipping:", selector);
            continue;
        }

        const mountTarget = WindowMaker.resolveMountTarget(optionsUnknown.mountTarget);
        const floatMntTrgt = WindowMaker.resolveMountTarget(optionsUnknown.floatMntTrgt);

        if (optionsUnknown.mountTarget !== undefined && mountTarget === null) {
            console.warn("Mount target not found for window, using WindowMaker default:", optionsUnknown.mountTarget);
        }

        if (optionsUnknown.floatMntTrgt !== undefined && floatMntTrgt === null) {
            console.warn(
                "Floating mount target not found for window, using WindowMaker default:",
                optionsUnknown.floatMntTrgt
            );
        }

        const options: WindowApiOptions = {
            ...(optionsUnknown as WindowApiOptions),
            mountTarget,
            floatMntTrgt
        };

        const shouldClearStoredState =
            definitionUnknown.forceFreshStateOnLoad === true &&
            typeof options.id === "string" &&
            options.id.trim().length > 0;

        const storageId = shouldClearStoredState
            ? WindowMaker.sanitiseWindowId(options.id as string)
            : "";

        if (storageId) {
            try {
                window.localStorage.removeItem(`window-api:${storageId}:state`);
            } catch {
                // Ignore storage failures.
            }
        }

        try {
            new WindowMaker(options).makeWindow(element);
        } catch (error: unknown) {
            console.warn("Window mounting failed, skipping:", selector, error);
        }
    }
}