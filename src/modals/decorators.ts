import type { Dec, DecCtx } from "./types.ts";

/**
 * handy decorator helper.
 * binds one event to all matching bits inside the modal.
 *
 * @param {string} selector
 * @param {K} eventName
 * @param {(ev: HTMLElementEventMap[K], ctx: DecCtx) => void} fn
 * @returns {Dec}
 */
export function onModalEvent<K extends keyof HTMLElementEventMap>(
    selector: string,
    eventName: K,
    fn: (ev: HTMLElementEventMap[K], ctx: DecCtx) => void
): Dec {
    return {
        mount: (ctx) => {
            const nodes = Array.from(ctx.modalEl.querySelectorAll(selector));
            const els = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement);

            if (!els.length) return;

            const onEvt = (ev: Event): void => {
                fn(ev as HTMLElementEventMap[K], ctx);
            };

            for (const el of els) {
                el.addEventListener(eventName, onEvt);
            }

            return () => {
                for (const el of els) {
                    el.removeEventListener(eventName, onEvt);
                }
            };
        }
    };
}

/**
 * tiny close helper.
 * click matching thing, modal goes away.
 *
 * @param {string} selector
 * @returns {Dec}
 */
export function closeOnClick(selector: string): Dec {
    return onModalEvent(selector, "click", (_ev, ctx) => ctx.close());
}

