import * as winApi from "../window.ts";
import * as helpers from "../helpers.ts";
import type { ModalFactory } from "./modal.ts";
import type {
    BubbleGeometry,
    Dec,
    DecCtx,
    ModalMode,
    ModalPlacement,
    ModalPosition,
    PositionCandidate
} from "./types.ts";
import {
    MOD_CLS,
    OVR_CLS,
    RM_BAD_CLS,
    WIN_FRAME_SFX,
    WIN_STATE_ID_PREF,
    bx,
    by,
    ensNbHost,
    oh,
    openByKey,
    px,
    syncScrl,
    winTitle,
    zRm,
    zTop
} from "./runtime.ts";

type SessSpec = Readonly<{
    factory: ModalFactory;
    id: string;
    mode: ModalMode;

    readerModeCompatible: boolean;
    windowed: boolean;

    modalClassName: string;
    overlayClassName: string;

    closeOnEscape: boolean;
    closeOnOutsideClick: boolean;

    position: ModalPosition | null;
    asTextBubble: boolean;

    decorators: readonly Dec[];
    html: string;
}>;

type WinMx = Readonly<{
    mw: number;
    mh: number;
    fw: number;
    fh: number;
}>;

export class ModalSession {
    readonly #fac: ModalFactory;
    readonly #key: string;

    readonly #id: string;
    readonly #mode: ModalMode;

    readonly #rmOk: boolean;
    readonly #win: boolean;

    readonly #esc: boolean;
    readonly #out: boolean;

    readonly #pos: ModalPosition | null;
    readonly #txtBubble: boolean;

    readonly #decs: readonly Dec[];

    readonly #mEl: HTMLDivElement;
    readonly #fEl: HTMLDivElement | null;
    readonly #sEl: HTMLDivElement;
    readonly #oEl: HTMLDivElement | null;

    readonly #lnEl: HTMLDivElement | null;

    #wh: winApi.WindowHandle | null;
    #sty: HTMLStyleElement | null;
    #raf: number | null;
    #mCln: Array<() => void>;
    #wCln: Array<() => void>;
    #pCln: Array<() => void>;
    #pRaf: number | null;
    #bubbleSvg: SVGSVGElement | null;
    #bubblePath: SVGPathElement | null;
    #bubbleGeometrySignature: string;
    #wOn: boolean;

    constructor(spec: SessSpec) {
        this.#fac = spec.factory;
        this.#id = spec.id;
        this.#mode = spec.mode;

        this.#rmOk = spec.readerModeCompatible;
        this.#win = spec.windowed;

        this.#esc = spec.closeOnEscape;
        this.#out = spec.closeOnOutsideClick;

        this.#pos = spec.position;
        this.#txtBubble = spec.asTextBubble;

        this.#decs = spec.decorators;

        this.#key = this.#fac._keyFor(this.#id);
        this.#wh = null;
        this.#sty = null;
        this.#raf = null;
        this.#mCln = [];
        this.#wCln = [];
        this.#pCln = [];
        this.#pRaf = null;
        this.#bubbleSvg = null;
        this.#bubblePath = null;
        this.#bubbleGeometrySignature = "";
        this.#wOn = false;

        this.#mEl = document.createElement("div");
        this.#mEl.id = this.#id;
        this.#mEl.className = [MOD_CLS, spec.modalClassName].filter(Boolean).join(" ");

        if (this.#mode === "non-blocking" && !this.#win) {
            this.#mEl.classList.add("non-blocking");
        }

        if (this.#pos) {
            this.#mEl.classList.add("modal-positioned");
        }

        if (this.#txtBubble) {
            this.#mEl.classList.add("modal-text-bubble");
        }

        if (this.#win) {
            this.#fEl = document.createElement("div");
            this.#fEl.id = `${this.#id}${WIN_FRAME_SFX}`;
            this.#fEl.dataset.modalWindowFrame = "true";
            this.#fEl.appendChild(this.#mEl);
            this.#sEl = this.#fEl;

            this.#lnEl = document.createElement("div");
            this.#lnEl.hidden = true;
            this.#lnEl.setAttribute("aria-hidden", "true");
        } else {
            this.#fEl = null;
            this.#sEl = this.#mEl;
            this.#lnEl = null;
        }

        this.#oEl = this.#mode === "blocking"
            ? document.createElement("div")
            : null;

        if (this.#oEl) {
            this.#oEl.id = `modal-overlay-${this.#id}`;
            this.#oEl.className = [OVR_CLS, spec.overlayClassName].filter(Boolean).join(" ");
            this.#oEl.appendChild(this.#sEl);
        }

        if (!this.#rmOk) {
            this.#mEl.classList.add(RM_BAD_CLS);
            this.#fEl?.classList.add(RM_BAD_CLS);
            this.#oEl?.classList.add(RM_BAD_CLS);
        }

        this.setHtml(spec.html);
    }

    /**
     * modal id again, but on the live session.
     *
     * @returns {string}
     */
    get id(): string {
        return this.#id;
    }

    /**
     * session mode getter.
     *
     * @returns {ModalMode}
     */
    get mode(): ModalMode {
        return this.#mode;
    }

    /**
     * raw modal element.
     *
     * @returns {HTMLDivElement}
     */
    get modalEl(): HTMLDivElement {
        return this.#mEl;
    }

    /**
     * overlay if this one has one.
     *
     * @returns {HTMLDivElement | null}
     */
    get overlayEl(): HTMLDivElement | null {
        return this.#oEl;
    }

    /**
     * mounts the session into the dom.
     * if already open it just comes forward.
     *
     * @returns {void}
     */
    open(): void {
        if (openByKey.has(this.#key)) {
            this.bringToFront();
            return;
        }

        const onOverlayClick = (ev: MouseEvent): void => {
            if (ev.target !== this.#oEl) return;
            this.close();
        };

        if (this.#oEl) document.body.appendChild(this.#oEl);
        if (this.#oEl && this.#out) {
            this.#oEl.addEventListener("click", onOverlayClick);
        }
        if (!this.#oEl) ensNbHost().appendChild(this.#sEl);

        openByKey.set(this.#key, {
            key: this.#key,
            id: this.#id,
            mode: this.#mode,
            readerModeCompatible: this.#rmOk,
            closeOnEscape: this.#esc,
            close: () => this.close(),
            overlayEl: this.#oEl,
            stackEl: this.#sEl
        });

        if (this.#win) {
            this.#ensWin();
        }

        zTop(this.#key);
        syncScrl();
        this.#mnt();
        this.#bindPos();
        this.#qSty();
        this.#qPos();
    }

    /**
     * Renders ordinary modal content without a speech-bubble shell.
     *
     * @param {string} html
     * @returns {void}
     */
    #renderPlainContent(html: string): void {
        this.#mEl.innerHTML = html;
        this.#bubbleSvg = null;
        this.#bubblePath = null;
    }

    /**
     * Renders text-bubble content over one SVG shape. The SVG path itself
     * contains both the rounded body and its target-facing tail, so fill and
     * stroke are continuous through the join.
     *
     * @param {string} html
     * @returns {void}
     */
    #renderBubbleContent(html: string): void {
        const svgNs = "http://www.w3.org/2000/svg";

        const svg = document.createElementNS(svgNs, "svg");
        const path = document.createElementNS(svgNs, "path");
        const body = document.createElement("div");

        svg.classList.add("modal-text-bubble__shape");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");

        path.classList.add("modal-text-bubble__path");

        body.className = "modal-text-bubble__body";
        body.innerHTML = html;

        svg.appendChild(path);
        this.#mEl.replaceChildren(svg, body);

        this.#bubbleSvg = svg;
        this.#bubblePath = path;
    }

    /**
     * @param {string} html
     * @returns {void}
     */
    #renderContent(html: string): void {
        if (!this.#txtBubble) {
            this.#renderPlainContent(html);
            return;
        }

        this.#renderBubbleContent(html);
    }

    /**
     * swaps the inner html and remounts decorator hooks.
     *
     * @param {string} html
     * @returns {void}
     */
    setHtml(html: string): void {
        this.#renderContent(html);
        this.#reMnt();
        this.#qSty();
        this.#qPos();
    }

    /**
     * bumps this session to the top.
     *
     * @returns {void}
     */
    bringToFront(): void {
        zTop(this.#key);
    }

    /**
     * closes the session and clears its bits up.
     *
     * @returns {void}
     */
    close(): void {
        const rec = openByKey.get(this.#key);
        if (!rec) return;

        this.#runM();
        this.#runW();
        this.#runPos();

        if (this.#pRaf !== null) {
            globalThis.cancelAnimationFrame(this.#pRaf);
            this.#pRaf = null;
        }

        if (this.#raf !== null) {
            globalThis.cancelAnimationFrame(this.#raf);
            this.#raf = null;
        }

        this.#wh?.dispose();
        this.#wh = null;

        this.#rmSty();

        this.#oEl?.remove();
        if (!this.#oEl) this.#sEl.remove();

        openByKey.delete(this.#key);
        zRm(this.#key);
        syncScrl();

        this.#fac._unregisterSession(this.#id);
    }

    /**
     * re-mount pass after html changes.
     *
     * @returns {void}
     */
    #reMnt(): void {
        if (!openByKey.has(this.#key)) return;
        this.#mnt(true);
    }

    /**
     * runs modal cleanup fns.
     *
     * @returns {void}
     */
    #runM(): void {
        for (const fn of this.#mCln) {
            try {
                fn();
            } catch {
                /* ignore */
            }
        }

        this.#mCln = [];
    }

    /**
     * runs window cleanup fns.
     *
     * @returns {void}
     */
    #runW(): void {
        for (const fn of this.#wCln) {
            try {
                fn();
            } catch {
                /* ignore */
            }
        }

        this.#wCln = [];
    }

    /**
     * mount pass for decorators.
     * when clr is true, old mounts get cleaned first.
     *
     * @param {boolean} clr
     * @returns {void}
     */
    #mnt(clr: boolean = false): void {
        if (clr) this.#runM();

        const ctx: DecCtx = {
            id: this.#id,
            mode: this.#mode,
            readerModeCompatible: this.#rmOk,
            windowed: this.#win,
            modalEl: this.#mEl,
            overlayEl: this.#oEl,
            close: () => this.close(),
            setHtml: (html: string) => this.setHtml(html)
        };

        for (const dec of this.#decs) {
            if (!dec.mount) continue;

            const cln = dec.mount(ctx);
            if (typeof cln !== "function") continue;

            this.#mCln.push(cln);
        }
    }


    /**
     * Resolves the optional anchor target for a positioned modal.
     *
     * @returns {Element | null}
     */
    #posTarget(): Element | null {
        if (!this.#pos) return null;

        const target = this.#pos.target;

        if (typeof target === "string") {
            return document.querySelector(target);
        }

        return target.isConnected
            ? target
            : null;
    }

    /**
     * Cancels listeners and observers used by target-following modals.
     *
     * @returns {void}
     */
    #runPos(): void {
        for (const fn of this.#pCln) {
            try {
                fn();
            } catch {
                /* ignore */
            }
        }

        this.#pCln = [];
    }

    /**
     * Queues one viewport-position sync.
     *
     * @returns {void}
     */
    #qPos(): void {
        if (!this.#pos) return;
        if (!this.#mEl.isConnected) return;
        if (this.#pRaf !== null) return;

        this.#pRaf = globalThis.requestAnimationFrame(() => {
            this.#pRaf = null;
            this.#syncPos();
        });
    }

    /**
     * Returns the current visible viewport bounds.
     *
     * VisualViewport is used when available so zooming and mobile browser
     * chrome do not leave an anchored callout off-screen.
     *
     * @returns {{ left: number; top: number; right: number; bottom: number }}
     */
    #viewportBounds(): {
        left: number;
        top: number;
        right: number;
        bottom: number;
    } {
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft ?? 0;
        const top = viewport?.offsetTop ?? 0;
        const width = viewport?.width ?? window.innerWidth;
        const height = viewport?.height ?? window.innerHeight;

        return {
            left,
            top,
            right: left + width,
            bottom: top + height
        };
    }

    /**
     * Chooses whichever side gives the callout the healthiest fit in the
     * current viewport. No direction is preferred or hard-coded.
     *
     * @param {DOMRect} targetRect
     * @param {DOMRect} modalRect
     * @param {{ left: number; top: number; right: number; bottom: number }} viewport
     * @param {number} gap
     * @returns {ModalPlacement}
     */
    #bestPlacement(
        targetRect: DOMRect,
        modalRect: DOMRect,
        viewport: {
            left: number;
            top: number;
            right: number;
            bottom: number;
        },
        gap: number
    ): ModalPlacement {
        const candidates: PositionCandidate[] = [
            {
                placement: "left",
                space: targetRect.left - viewport.left,
                required: modalRect.width + gap
            },
            {
                placement: "right",
                space: viewport.right - targetRect.right,
                required: modalRect.width + gap
            },
            {
                placement: "top",
                space: targetRect.top - viewport.top,
                required: modalRect.height + gap
            },
            {
                placement: "bottom",
                space: viewport.bottom - targetRect.bottom,
                required: modalRect.height + gap
            }
        ];

        candidates.sort(
            (a, b) =>
                (b.space - b.required) -
                (a.space - a.required)
        );

        return candidates[0]?.placement ?? "bottom";
    }

    /**
     * Calculates the natural modal origin for one target-facing side.
     *
     * @param {ModalPlacement} placement
     * @param {DOMRect} targetRect
     * @param {DOMRect} modalRect
     * @param {number} gap
     * @returns {{ left: number; top: number }}
     */
    #placementOrigin(
        placement: ModalPlacement,
        targetRect: DOMRect,
        modalRect: DOMRect,
        gap: number
    ): {
        left: number;
        top: number;
    } {
        const targetX =
            targetRect.left +
            targetRect.width / 2;

        const targetY =
            targetRect.top +
            targetRect.height / 2;

        const origins: Record<ModalPlacement, {
            left: number;
            top: number;
        }> = {
            left: {
                left: targetRect.left - modalRect.width - gap,
                top: targetY - modalRect.height / 2
            },
            right: {
                left: targetRect.right + gap,
                top: targetY - modalRect.height / 2
            },
            top: {
                left: targetX - modalRect.width / 2,
                top: targetRect.top - modalRect.height - gap
            },
            bottom: {
                left: targetX - modalRect.width / 2,
                top: targetRect.bottom + gap
            }
        };

        return origins[placement];
    }

    /**
     * @param {number} value
     * @param {number} min
     * @param {number} max
     * @returns {number}
     */
    #clampPos(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(value, max));
    }

    /**
     * Reads a numeric CSS custom property from the live bubble.
     *
     * @param {string} name
     * @param {number} fallback
     * @returns {number}
     */
    #bubbleCssNumber(name: string, fallback: number): number {
        const raw = globalThis
            .getComputedStyle(this.#mEl)
            .getPropertyValue(name);

        const parsed = Number.parseFloat(raw);

        return Number.isFinite(parsed)
            ? parsed
            : fallback;
    }

    /**
     * Reads the rendered bubble geometry. Radius comes from the actual
     * computed border radius so themes can keep controlling corner shape.
     *
     * @returns {BubbleGeometry}
     */
    #bubbleGeometry(): BubbleGeometry {
        const style = globalThis.getComputedStyle(this.#mEl);
        const radius = Number.parseFloat(style.borderTopLeftRadius);

        return {
            radius: Number.isFinite(radius) ? radius : 12,
            tailLength: this.#bubbleCssNumber(
                "--modal-text-bubble-tail-length",
                13
            ),
            tailHalfWidth: this.#bubbleCssNumber(
                "--modal-text-bubble-tail-half-width",
                12
            ),
            strokeWidth: this.#bubbleCssNumber(
                "--modal-text-bubble-stroke-width",
                1
            ),
            tailANeck: this.#clampPos(
                this.#bubbleCssNumber(
                    "--modal-text-bubble-tail-a-neck",
                    -0.42
                ),
                -1,
                1
            ),
            tailATip: this.#clampPos(
                this.#bubbleCssNumber(
                    "--modal-text-bubble-tail-a-tip",
                    0.1
                ),
                -1,
                1
            ),
            tailBNeck: this.#clampPos(
                this.#bubbleCssNumber(
                    "--modal-text-bubble-tail-b-neck",
                    0.1
                ),
                -1,
                1
            ),
            tailBTip: this.#clampPos(
                this.#bubbleCssNumber(
                    "--modal-text-bubble-tail-b-tip",
                    0.42
                ),
                -1,
                1
            )
        };
    }

    /**
     * Builds one continuous path for the rounded bubble body and its tail.
     * The tail uses cubic curves so it leaves the body tangentially rather
     * than looking like a separate hard-edged triangle.
     *
     * @param {number} width
     * @param {number} height
     * @param {ModalPlacement} placement
     * @param {number} pointerX
     * @param {number} pointerY
     * @returns {string}
     */
    #bubblePathD(
        width: number,
        height: number,
        placement: ModalPlacement,
        pointerX: number,
        pointerY: number
    ): string {
        const geometry = this.#bubbleGeometry();
        const inset = Math.max(0.5, geometry.strokeWidth / 2);

        const left = inset;
        const top = inset;
        const right = Math.max(left, width - inset);
        const bottom = Math.max(top, height - inset);

        const radius = Math.max(
            0,
            Math.min(
                geometry.radius,
                (right - left) / 2,
                (bottom - top) / 2
            )
        );

        const maxVerticalHalf = Math.max(
            4,
            (bottom - top - radius * 2 - 12) / 2
        );

        const maxHorizontalHalf = Math.max(
            4,
            (right - left - radius * 2 - 12) / 2
        );

        const verticalHalf = Math.min(
            geometry.tailHalfWidth,
            maxVerticalHalf
        );

        const horizontalHalf = Math.min(
            geometry.tailHalfWidth,
            maxHorizontalHalf
        );

        const minPointerX =
            left +
            radius +
            horizontalHalf +
            6;

        const maxPointerX = Math.max(
            minPointerX,
            right -
            radius -
            horizontalHalf -
            6
        );

        const minPointerY =
            top +
            radius +
            verticalHalf +
            6;

        const maxPointerY = Math.max(
            minPointerY,
            bottom -
            radius -
            verticalHalf -
            6
        );

        const px = this.#clampPos(
            pointerX,
            minPointerX,
            maxPointerX
        );

        const py = this.#clampPos(
            pointerY,
            minPointerY,
            maxPointerY
        );

        const tail = geometry.tailLength;

        /*
         * Neck values control how far the interior control point reaches
         * toward the tip. They never move the first/last control point off
         * the frame tangent, so arbitrary signed values cannot detach the
         * tail from the bubble outline.
         */
        const tailANeckReach =
            tail *
            ((geometry.tailANeck + 1) / 2);

        const tailBNeckReach =
            tail *
            ((geometry.tailBNeck + 1) / 2);

        const tailATip =
            geometry.tailATip;

        const tailBTip =
            geometry.tailBTip;

        /*
         * These handles lie on the frame itself. That makes the derivative
         * at every tail/frame join collinear with the frame edge.
         */
        const verticalTangent =
            Math.max(1, verticalHalf * 0.45);

        const horizontalTangent =
            Math.max(1, horizontalHalf * 0.45);

        const paths: Record<ModalPlacement, string> = {
            left: [
                `M ${left + radius} ${top}`,
                `H ${right - radius}`,
                `Q ${right} ${top} ${right} ${top + radius}`,
                `V ${py - verticalHalf}`,
                `C ${right} ${py - verticalHalf + verticalTangent}`,
                `${right + tailANeckReach} ${py - verticalHalf * tailATip}`,
                `${right + tail} ${py}`,
                `C ${right + tailBNeckReach} ${py + verticalHalf * tailBTip}`,
                `${right} ${py + verticalHalf - verticalTangent}`,
                `${right} ${py + verticalHalf}`,
                `V ${bottom - radius}`,
                `Q ${right} ${bottom} ${right - radius} ${bottom}`,
                `H ${left + radius}`,
                `Q ${left} ${bottom} ${left} ${bottom - radius}`,
                `V ${top + radius}`,
                `Q ${left} ${top} ${left + radius} ${top}`,
                "Z"
            ].join(" "),

            right: [
                `M ${left + radius} ${top}`,
                `H ${right - radius}`,
                `Q ${right} ${top} ${right} ${top + radius}`,
                `V ${bottom - radius}`,
                `Q ${right} ${bottom} ${right - radius} ${bottom}`,
                `H ${left + radius}`,
                `Q ${left} ${bottom} ${left} ${bottom - radius}`,
                `V ${py + verticalHalf}`,
                `C ${left} ${py + verticalHalf - verticalTangent}`,
                `${left - tailANeckReach} ${py + verticalHalf * tailATip}`,
                `${left - tail} ${py}`,
                `C ${left - tailBNeckReach} ${py - verticalHalf * tailBTip}`,
                `${left} ${py - verticalHalf + verticalTangent}`,
                `${left} ${py - verticalHalf}`,
                `V ${top + radius}`,
                `Q ${left} ${top} ${left + radius} ${top}`,
                "Z"
            ].join(" "),

            top: [
                `M ${left + radius} ${top}`,
                `H ${right - radius}`,
                `Q ${right} ${top} ${right} ${top + radius}`,
                `V ${bottom - radius}`,
                `Q ${right} ${bottom} ${right - radius} ${bottom}`,
                `H ${px + horizontalHalf}`,
                `C ${px + horizontalHalf - horizontalTangent} ${bottom}`,
                `${px + horizontalHalf * tailATip} ${bottom + tailANeckReach}`,
                `${px} ${bottom + tail}`,
                `C ${px - horizontalHalf * tailBTip} ${bottom + tailBNeckReach}`,
                `${px - horizontalHalf + horizontalTangent} ${bottom}`,
                `${px - horizontalHalf} ${bottom}`,
                `H ${left + radius}`,
                `Q ${left} ${bottom} ${left} ${bottom - radius}`,
                `V ${top + radius}`,
                `Q ${left} ${top} ${left + radius} ${top}`,
                "Z"
            ].join(" "),

            bottom: [
                `M ${left + radius} ${top}`,
                `H ${px - horizontalHalf}`,
                `C ${px - horizontalHalf + horizontalTangent} ${top}`,
                `${px - horizontalHalf * tailATip} ${top - tailANeckReach}`,
                `${px} ${top - tail}`,
                `C ${px + horizontalHalf * tailBTip} ${top - tailBNeckReach}`,
                `${px + horizontalHalf - horizontalTangent} ${top}`,
                `${px + horizontalHalf} ${top}`,
                `H ${right - radius}`,
                `Q ${right} ${top} ${right} ${top + radius}`,
                `V ${bottom - radius}`,
                `Q ${right} ${bottom} ${right - radius} ${bottom}`,
                `H ${left + radius}`,
                `Q ${left} ${bottom} ${left} ${bottom - radius}`,
                `V ${top + radius}`,
                `Q ${left} ${top} ${left + radius} ${top}`,
                "Z"
            ].join(" ")
        };

        return paths[placement];
    }

    /**
     * Syncs the SVG shell to the current rendered bubble rectangle.
     *
     * @param {ModalPlacement} placement
     * @param {number} pointerX
     * @param {number} pointerY
     * @returns {void}
     */
    #syncBubbleShape(
        placement: ModalPlacement,
        pointerX: number,
        pointerY: number
    ): void {
        if (!this.#txtBubble) return;
        if (!this.#bubbleSvg) return;
        if (!this.#bubblePath) return;

        const rect = this.#mEl.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));

        this.#bubbleSvg.setAttribute(
            "viewBox",
            `0 0 ${width} ${height}`
        );

        this.#bubbleSvg.setAttribute(
            "width",
            String(width)
        );

        this.#bubbleSvg.setAttribute(
            "height",
            String(height)
        );

        this.#bubblePath.setAttribute(
            "d",
            this.#bubblePathD(
                width,
                height,
                placement,
                pointerX,
                pointerY
            )
        );
    }

    /**
     * Places an anchored modal on the best available side of its target,
     * clamps the modal to the viewport, then derives the speech-bubble tail
     * position from the target's real viewport coordinates.
     *
     * @returns {void}
     */
    #syncPos(): void {
        const target = this.#posTarget();
        if (!target) return;
        if (!this.#mEl.isConnected) return;

        const targetRect = target.getBoundingClientRect();
        const modalRect = this.#mEl.getBoundingClientRect();
        const viewport = this.#viewportBounds();

        const gap = Math.max(0, this.#pos?.gap ?? 14);
        const viewportPad = 12;
        const pointerPad = 18;

        const placement = this.#bestPlacement(
            targetRect,
            modalRect,
            viewport,
            gap
        );

        const origin = this.#placementOrigin(
            placement,
            targetRect,
            modalRect,
            gap
        );

        const minLeft = viewport.left + viewportPad;
        const maxLeft = Math.max(
            minLeft,
            viewport.right - modalRect.width - viewportPad
        );

        const minTop = viewport.top + viewportPad;
        const maxTop = Math.max(
            minTop,
            viewport.bottom - modalRect.height - viewportPad
        );

        const left = this.#clampPos(
            origin.left,
            minLeft,
            maxLeft
        );

        const top = this.#clampPos(
            origin.top,
            minTop,
            maxTop
        );

        const targetX =
            targetRect.left +
            targetRect.width / 2;

        const targetY =
            targetRect.top +
            targetRect.height / 2;

        const pointerX = this.#clampPos(
            targetX - left,
            pointerPad,
            Math.max(pointerPad, modalRect.width - pointerPad)
        );

        const pointerY = this.#clampPos(
            targetY - top,
            pointerPad,
            Math.max(pointerPad, modalRect.height - pointerPad)
        );

        this.#mEl.dataset.modalPlacement = placement;

        this.#mEl.style.left = `${Math.round(left)}px`;
        this.#mEl.style.top = `${Math.round(top)}px`;
        this.#mEl.style.right = "auto";
        this.#mEl.style.bottom = "auto";

        this.#mEl.style.setProperty(
            "--modal-text-bubble-pointer-x",
            `${Math.round(pointerX)}px`
        );

        this.#mEl.style.setProperty(
            "--modal-text-bubble-pointer-y",
            `${Math.round(pointerY)}px`
        );

        this.#syncBubbleShape(
            placement,
            pointerX,
            pointerY
        );
    }

    /**
     * Produces a compact signature of the CSS-driven bubble geometry.
     *
     * The SVG path itself is generated in JavaScript, so a CSS custom
     * property edit does not naturally invalidate the path. Comparing this
     * signature lets live CSS tuning redraw only when a geometry value
     * actually changes.
     *
     * @returns {string}
     */
    #bubbleGeometrySig(): string {
        if (!this.#txtBubble) return "";

        const geometry = this.#bubbleGeometry();

        return [
            geometry.radius,
            geometry.tailLength,
            geometry.tailHalfWidth,
            geometry.strokeWidth,
            geometry.tailANeck,
            geometry.tailATip,
            geometry.tailBNeck,
            geometry.tailBTip
        ].join("|");
    }

    /**
     * Watches CSS-driven bubble geometry while the bubble is open.
     *
     * This is intentionally low-frequency and only runs for text bubbles.
     * It makes DevTools/theme CSS edits immediately visible without forcing
     * a resize or scroll just to regenerate the SVG path.
     *
     * @returns {void}
     */
    #bindBubbleGeometry(): void {
        if (!this.#txtBubble) return;

        this.#bubbleGeometrySignature =
            this.#bubbleGeometrySig();

        const timer = globalThis.setInterval(() => {
            if (!this.#mEl.isConnected) return;

            const next =
                this.#bubbleGeometrySig();

            if (next === this.#bubbleGeometrySignature) return;

            this.#bubbleGeometrySignature = next;
            this.#qPos();
        }, 100);

        this.#pCln.push(() => {
            globalThis.clearInterval(timer);
            this.#bubbleGeometrySignature = "";
        });
    }

    /**
     * Watches the anchor and viewport so a positioned modal follows its
     * target through scrolling, resizing and layout changes.
     *
     * @returns {void}
     */
    #bindPos(): void {
        this.#runPos();

        const target = this.#posTarget();
        if (!target) return;

        this.#bindBubbleGeometry();

        const queue = (): void => this.#qPos();

        globalThis.addEventListener("resize", queue);
        globalThis.addEventListener("scroll", queue, true);

        this.#pCln.push(() => {
            globalThis.removeEventListener("resize", queue);
            globalThis.removeEventListener("scroll", queue, true);
        });

        if (typeof ResizeObserver === "undefined") {
            this.#qPos();
            return;
        }

        const observer = new ResizeObserver(queue);

        observer.observe(target);
        observer.observe(this.#mEl);

        this.#pCln.push(() => observer.disconnect());

        const viewport = window.visualViewport;

        viewport?.addEventListener("resize", queue);
        viewport?.addEventListener("scroll", queue);

        this.#pCln.push(() => {
            viewport?.removeEventListener("resize", queue);
            viewport?.removeEventListener("scroll", queue);
        });

        this.#qPos();
    }

    /**
     * picks the element the window api should mount into.
     *
     * @returns {HTMLElement}
     */
    #host(): HTMLElement {
        return this.#oEl ?? ensNbHost();
    }

    /**
     * builds the window api options for this session.
     *
     * @returns {winApi.WindowApiOptions}
     */
    #mkWinOpts(): winApi.WindowApiOptions {
        const host = this.#host();

        return {
            id: `${WIN_STATE_ID_PREF}${this.#id}`,
            title: winTitle(this.#id),
            launcher: this.#lnEl,
            closedLnchrDis: "none",
            showCloseBttn: true,
            showMiniBttn: false,
            showFloatBttn: false,
            mountTarget: host,
            floatMntTrgt: host,
            initClosed: false,
            initFloat: true
        };
    }

    /**
     * mounts the window wrapper when this modal is windowed.
     *
     * @returns {void}
     */
    #ensWin(): void {
        if (this.#wOn) return;
        if (!this.#fEl || !this.#lnEl) return;

        this.#wOn = true;

        try {
            this.#wh = winApi.mountWindow(this.#fEl, this.#mkWinOpts());
            this.#qSty();
        } catch (err: unknown) {
            console.warn("Modal window mounting failed:", this.#id, err);
            this.#rmSty();
            return;
        }

        if (!openByKey.has(this.#key)) return;
        if (!this.#fEl.isConnected) return;

        this.#bndCls();
    }

    /**
     * queues a style sync on a couple of frames.
     * a bit belt-and-braces but helps after layout settles.
     *
     * @returns {void}
     */
    #qSty(): void {
        if (!this.#win) return;
        if (!this.#mEl.isConnected) return;

        if (this.#raf !== null) {
            globalThis.cancelAnimationFrame(this.#raf);
        }

        this.#raf = globalThis.requestAnimationFrame(() => {
            this.#raf = globalThis.requestAnimationFrame(() => {
                this.#raf = null;
                this.#syncSty();
            });
        });
    }

    /**
     * updates the window sizing style tag.
     *
     * @returns {void}
     */
    #syncSty(): void {
        if (!this.#win) return;
        if (!this.#mEl.isConnected) return;

        const sz = this.#calcMx();
        const ms = `#${helpers.escapeCssIdentifier(this.#id)}`;
        const fs = this.#fEl ? `#${helpers.escapeCssIdentifier(this.#fEl.id)}` : "";
        const bs = fs ? `${fs} .window-body` : "";
        const rs = fs ? `${fs} [data-window-content-root='true']` : "";

        let css = `${ms} {
  border-radius: 0 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  min-height: 0 !important;
  max-height: 100% !important;
}`;

        if (fs) {
            css += `
${bs} {
  min-height: 0 !important;
}

${rs} {
  min-height: 0 !important;
  height: 100% !important;
  max-height: 100% !important;
}`;
        }

        if (sz && fs) {
            css = `${ms} {
  border-radius: 0 !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  min-height: 0 !important;
  max-width: ${sz.mw}px !important;
  max-height: 100% !important;
}

${fs} {
  max-width: ${sz.fw}px !important;
  max-height: ${sz.fh}px !important;
}

${bs} {
  min-height: 0 !important;
}

${rs} {
  min-height: 0 !important;
  height: 100% !important;
  max-height: 100% !important;
}`;
        }

        if (!this.#sty) {
            this.#sty = document.createElement("style");
            this.#sty.setAttribute("data-modal-window-style-for", this.#id);
            document.head.appendChild(this.#sty);
        }

        this.#sty.textContent = css;
    }

    /**
     * works out modal and frame max sizes from the live dom.
     *
     * @returns {WinMx | null}
     */
    #calcMx(): WinMx | null {
        if (!this.#mEl.isConnected) return null;

        const mcs = globalThis.getComputedStyle(this.#mEl);

        const mw = Math.ceil(
            this.#mEl.scrollWidth +
            px(mcs.borderLeftWidth) +
            px(mcs.borderRightWidth)
        );

        const mh = Math.ceil(
            this.#mEl.scrollHeight +
            px(mcs.borderTopWidth) +
            px(mcs.borderBottomWidth)
        );

        if (mw <= 0 || mh <= 0) return null;

        let fw = mw;
        let fh = mh;

        if (this.#fEl?.isConnected) {
            const hdr = this.#fEl.querySelector(".window-header");
            const bod = this.#fEl.querySelector(".window-body");
            const root = this.#fEl.querySelector("[data-window-content-root='true']");

            const fcs = globalThis.getComputedStyle(this.#fEl);
            const bcs = bod instanceof HTMLElement ? globalThis.getComputedStyle(bod) : null;
            const rcs = root instanceof HTMLElement ? globalThis.getComputedStyle(root) : null;

            fw = Math.ceil(mw + bx(fcs) + bx(bcs) + bx(rcs));
            fh = Math.ceil(mh + by(fcs) + by(bcs) + by(rcs) + oh(hdr));
        }

        return { mw, mh, fw, fh };
    }

    /**
     * removes the temp style tag if it exists.
     *
     * @returns {void}
     */
    #rmSty(): void {
        this.#sty?.remove();
        this.#sty = null;
    }

    /**
     * steals the window close button click so it closes this session properly.
     *
     * @returns {void}
     */
    #bndCls(): void {
        if (!this.#fEl) return;

        this.#runW();

        const btn = this.#fEl.querySelector<HTMLButtonElement>("[data-window-role='close']");
        if (!btn) return;

        const onClick = (ev: MouseEvent): void => {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            this.close();
        };

        btn.addEventListener("click", onClick, true);

        this.#wCln.push(() => {
            btn.removeEventListener("click", onClick, true);
        });
    }
}

