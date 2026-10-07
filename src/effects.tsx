import type { ReactElement } from "react";
import type { fxUIconf } from "./uiFetch.ts";
import * as modals from "./modals.ts";
import { THEME_MODE_CHANGED_EVENT } from "./themeChanger.ts";
import { render2Mkup } from "./reactHelpers.tsx";
import { installMenuToggle } from "./menues.tsx";
import type { Prefs } from "./effects/config.ts";
import {
    PHOS_OP_MAX,
    SCAN_OP_MAX,
    SCAN_SPD_MAX,
    SCAN_SPD_MIN,
    SLIDER_MAX,
    SLIDER_MIN,
    SLIDER_STEP,
    STORAGE_KEY,
    TEXT_SHADOW_MAX,
    TEXT_SHADOW_MIN
} from "./effects/config.ts";
import {
    clamp,
    opToPct,
    pct,
    pctToOp
} from "./effects/math.ts";
import {
    apply,
    commit,
    defs,
    live,
    resolved
} from "./effects/preferences.ts";
import {
    applyTextShadowScale,
    ensureTextShadowKeyframes,
    ensureTextShadowTargets
} from "./effects/textDistortion.ts";

type Props = Readonly<{
    prefs: Prefs;
    ui: fxUIconf;
}>;

type Ctx = Readonly<{
    modalEl: HTMLDivElement;
}>;

type ModalDecorator = ReturnType<typeof modals.closeOnClick>;
type ModalCtx = Parameters<NonNullable<ModalDecorator["mount"]>>[0];

const BTN_ID = "effects-toggle";
const MOD_ID = "screen-effects";
const BTN_BOTTOM = "80px";
const EFFECTS_TIP_MODAL_ID = "kc-effects-help-modal";
const EFFECTS_TIP_HIDE_KEY = "effectsHelpModalHide";

let mod: modals.Modal | null = null;
let syncOn = false;
let uiCfg: fxUIconf | null = null;
let effectsTipShown = false;
let effectsTipObs: IntersectionObserver | null = null;

/**
 * Current ui config getter. Throws if init got skipped somewhere.
 * @returns {fxUIconf}
 */
function ui(): fxUIconf {
    if (!uiCfg) {
        throw new Error("Effects UI config has not been initialised.");
    }

    return uiCfg;
}

/**
 * Syncs a checkbox in the modal.
 * @param {HTMLDivElement} modalEl
 * @param {string} selector
 * @param {boolean} checked
 * @returns {void}
 */
function syncChk(modalEl: HTMLDivElement, selector: string, checked: boolean): void {
    const el = modalEl.querySelector(selector);
    if (!(el instanceof HTMLInputElement)) return;
    el.checked = checked;
}

/**
 * Syncs a range input.
 * @param {HTMLDivElement} modalEl
 * @param {string} selector
 * @param {number} value
 * @returns {void}
 */
function syncRng(modalEl: HTMLDivElement, selector: string, value: number): void {
    const el = modalEl.querySelector(selector);
    if (!(el instanceof HTMLInputElement)) return;
    el.value = String(Math.round(clamp(value, 0, 100)));
}

/**
 * Syncs one little output label.
 * @param {HTMLDivElement} modalEl
 * @param {string} selector
 * @param {number} value
 * @returns {void}
 */
function syncOut(modalEl: HTMLDivElement, selector: string, value: number): void {
    const el = modalEl.querySelector(selector);
    if (!(el instanceof HTMLOutputElement) && !(el instanceof HTMLElement)) return;
    el.textContent = pct(value);
}

/**
 * Reflects prefs into the currently open modal controls.
 * @param {HTMLDivElement} modalEl
 * @param {Prefs} prefs
 * @returns {void}
 */
function syncMod(modalEl: HTMLDivElement, prefs: Prefs): void {
    const phosphorPercent = opToPct(prefs.phosphorOpacity, PHOS_OP_MAX);
    const scanlinePercent = opToPct(prefs.scanlineOpacity, SCAN_OP_MAX);
    const scanlineSpeed = clamp(prefs.scanlineSpeed, SCAN_SPD_MIN, SCAN_SPD_MAX);
    const textShadowIntensity = clamp(
        prefs.textShadowIntensity,
        TEXT_SHADOW_MIN,
        TEXT_SHADOW_MAX
    );

    syncChk(modalEl, "#effects-text-shadow-enabled", !prefs.textShadowEnabled || textShadowIntensity === 0);
    syncChk(modalEl, "#effects-phosphor-enabled", !prefs.phosphorEnabled || phosphorPercent === 0);
    syncChk(modalEl, "#effects-scanlines-enabled", !prefs.scanlinesEnabled || scanlinePercent === 0);

    syncRng(modalEl, "#effects-phosphor-opacity", phosphorPercent);
    syncRng(modalEl, "#effects-scanline-opacity", scanlinePercent);
    syncRng(modalEl, "#effects-scanline-speed", scanlineSpeed);
    syncRng(modalEl, "#effects-text-shadow-intensity", textShadowIntensity);

    syncOut(modalEl, "#effects-phosphor-opacity-value", phosphorPercent);
    syncOut(modalEl, "#effects-scanline-opacity-value", scanlinePercent);
    syncOut(modalEl, "#effects-scanline-speed-value", scanlineSpeed);
    syncOut(modalEl, "#effects-text-shadow-intensity-value", textShadowIntensity);
}

/**
 * If the modal is open, updates it from the live prefs.
 * @returns {void}
 */
function syncOpen(): void {
    const session = modals.factory.getOpenSession(MOD_ID);
    if (!session) return;
    syncMod(session.modalEl, live());
}

/**
 * Little react panel for the modal.
 * @param {Props} props
 * @returns {ReactElement}
 */
function Panel(props: Props): ReactElement {
    const text = props.ui.modal;
    const phosphorPercent = opToPct(props.prefs.phosphorOpacity, PHOS_OP_MAX);
    const scanlinePercent = opToPct(props.prefs.scanlineOpacity, SCAN_OP_MAX);
    const scanlineSpeed = clamp(props.prefs.scanlineSpeed, SCAN_SPD_MIN, SCAN_SPD_MAX);
    const textShadowIntensity = clamp(
        props.prefs.textShadowIntensity,
        TEXT_SHADOW_MIN,
        TEXT_SHADOW_MAX
    );

    return (
        <>
            <div className="effects-modal__header">
                <div>
                    <h2 className="effects-modal__title">{text.title}</h2>
                    <p className="effects-modal__lead">{text.lead}</p>
                </div>

                {/* <button
          type="button"
          className="effects-modal__close"
          data-effects-close=""
          title={text.closeTitle}
          aria-label={text.closeTitle}
        >
          ✕
        </button> */}
            </div>

            <div className="effects-modal__grid">
                <section className="effects-modal__section">
                    <div className="effects-modal__section-heading">
                        <h3>Text distortion</h3>
                        <p>Controls the animated RGB separation applied to text and SVG graphics.</p>
                    </div>

                    <label className="effects-modal__toggle" htmlFor="effects-text-shadow-enabled">
                        <input
                            id="effects-text-shadow-enabled"
                            type="checkbox"
                            defaultChecked={!props.prefs.textShadowEnabled || textShadowIntensity === 0}
                        />
                        <span>Disable text distortion</span>
                    </label>

                    <div className="effects-modal__control">
                        <div className="effects-modal__control-meta">
                            <label htmlFor="effects-text-shadow-intensity">{text.intensityLabel}</label>
                            <output id="effects-text-shadow-intensity-value">
                                <span>&nbsp;</span>{pct(textShadowIntensity)}
                            </output>
                        </div>

                        <input
                            id="effects-text-shadow-intensity"
                            type="range"
                            min={String(TEXT_SHADOW_MIN)}
                            max={String(TEXT_SHADOW_MAX)}
                            step={String(SLIDER_STEP)}
                            defaultValue={String(Math.round(textShadowIntensity))}
                        />

                        <p className="effects-modal__hint">
                            15% is the default strength. 20% is the original base CRT strength. The upper range ramps aggressively, with 100% deliberately excessive.
                        </p>
                    </div>
                </section>

                <section className="effects-modal__section">
                    <div className="effects-modal__section-heading">
                        <h3>{text.phosphorTitle}</h3>
                        <p>{text.phosphorDescription}</p>
                    </div>

                    <label className="effects-modal__toggle" htmlFor="effects-phosphor-enabled">
                        <input
                            id="effects-phosphor-enabled"
                            type="checkbox"
                            defaultChecked={!props.prefs.phosphorEnabled || phosphorPercent === 0}
                        />
                        <span>{text.phosphorToggle}</span>
                    </label>

                    <div className="effects-modal__control">
                        <div className="effects-modal__control-meta">
                            <label htmlFor="effects-phosphor-opacity">{text.intensityLabel}</label>
                            <output id="effects-phosphor-opacity-value"><span>&nbsp;</span>{pct(phosphorPercent)}</output>
                        </div>

                        <input
                            id="effects-phosphor-opacity"
                            type="range"
                            min={String(SLIDER_MIN)}
                            max={String(SLIDER_MAX)}
                            step={String(SLIDER_STEP)}
                            defaultValue={String(Math.round(phosphorPercent))}
                        />

                        <p className="effects-modal__hint">{text.phosphorHint}</p>
                    </div>
                </section>

                <section className="effects-modal__section">
                    <div className="effects-modal__section-heading">
                        <h3>{text.scanlinesTitle}</h3>
                        <p>{text.scanlinesDescription}</p>
                    </div>

                    <label className="effects-modal__toggle" htmlFor="effects-scanlines-enabled">
                        <input
                            id="effects-scanlines-enabled"
                            type="checkbox"
                            defaultChecked={!props.prefs.scanlinesEnabled || scanlinePercent === 0}
                        />
                        <span>{text.scanlinesToggle}</span>
                    </label>

                    <div className="effects-modal__control">
                        <div className="effects-modal__control-meta">
                            <label htmlFor="effects-scanline-opacity">{text.intensityLabel}</label>
                            <output id="effects-scanline-opacity-value"><span>&nbsp;</span>{pct(scanlinePercent)}</output>
                        </div>

                        <input
                            id="effects-scanline-opacity"
                            type="range"
                            min={String(SLIDER_MIN)}
                            max={String(SLIDER_MAX)}
                            step={String(SLIDER_STEP)}
                            defaultValue={String(Math.round(scanlinePercent))}
                        />

                        <p className="effects-modal__hint">{text.scanlinesHint}</p>
                    </div>

                    <div className="effects-modal__control">
                        <div className="effects-modal__control-meta">
                            <label htmlFor="effects-scanline-speed">{text.scanlineSpeedLabel}</label>
                            <output id="effects-scanline-speed-value"><span>&nbsp;</span>{pct(scanlineSpeed)}</output>
                        </div>

                        <input
                            id="effects-scanline-speed"
                            type="range"
                            min={String(SCAN_SPD_MIN)}
                            max={String(SCAN_SPD_MAX)}
                            step={String(SLIDER_STEP)}
                            defaultValue={String(Math.round(scanlineSpeed))}
                        />

                        <p className="effects-modal__hint">{text.scanlineSpeedHint}</p>
                    </div>
                </section>
            </div>

            <div className="effects-modal__footer">
                <button type="button" id="effects-reset">
                    {text.reset}
                </button>

                <button type="button" data-effects-close="" data-intent="primary">
                    {text.done}
                </button>
            </div>
        </>
    );
}

/**
 * Renders the modal html string from the current live prefs.
 * @returns {string}
 */
function rndrMod(): string {
    return render2Mkup(<Panel prefs={live()} ui={ui()} />);
}

/**
 * Handles phosphor toggle checkbox.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onPhosTgl = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;

    const cur = live();
    const nextOpacity = target.checked
        ? 0
        : cur.phosphorOpacity > 0
            ? cur.phosphorOpacity
            : defs().phosphorOpacity;

    const next: Prefs = {
        ...cur,
        phosphorEnabled: !target.checked,
        phosphorOpacity: nextOpacity
    };

    commit(next);
    syncMod(ctx.modalEl, next);
};

/**
 * Handles scanline toggle checkbox.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onScanTgl = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;

    const cur = live();
    const nextOpacity = target.checked
        ? 0
        : cur.scanlineOpacity > 0
            ? cur.scanlineOpacity
            : defs().scanlineOpacity;

    const next: Prefs = {
        ...cur,
        scanlinesEnabled: !target.checked,
        scanlineOpacity: nextOpacity
    };

    commit(next);
    syncMod(ctx.modalEl, next);
};

/**
 * Handles phosphor opacity slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onPhosOp = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;

    const percent = clamp(
        Number.parseFloat(target.value),
        SLIDER_MIN,
        SLIDER_MAX
    );
    const opacity = pctToOp(percent, PHOS_OP_MAX);

    const next: Prefs = {
        ...live(),
        phosphorEnabled: percent > 0,
        phosphorOpacity: opacity
    };

    commit(next);
    syncMod(ctx.modalEl, next);
};

/**
 * Handles scanline opacity slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onScanOp = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;

    const percent = clamp(
        Number.parseFloat(target.value),
        SLIDER_MIN,
        SLIDER_MAX
    );
    const opacity = pctToOp(percent, SCAN_OP_MAX);

    const next: Prefs = {
        ...live(),
        scanlinesEnabled: percent > 0,
        scanlineOpacity: opacity
    };

    commit(next);
    syncMod(ctx.modalEl, next);
};

/**
 * Handles scanline speed slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onScanSpd = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;

    const speed = clamp(
        Number.parseFloat(target.value),
        SCAN_SPD_MIN,
        SCAN_SPD_MAX
    );

    const next: Prefs = {
        ...live(),
        scanlineSpeed: speed
    };

    commit(next);
    syncMod(ctx.modalEl, next);
};

/**
 * Handles the text-distortion disable toggle.
 *
 * Disabling preserves the current slider value so the user's preferred
 * strength is restored when the effect is enabled again.
 *
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onTextShadowTgl = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;

    const cur = live();
    const nextIntensity =
        cur.textShadowIntensity > 0
            ? cur.textShadowIntensity
            : defs().textShadowIntensity;

    const next: Prefs = {
        ...cur,
        textShadowEnabled: !target.checked,
        textShadowIntensity: nextIntensity
    };

    commit(next);
    syncMod(ctx.modalEl, next);
};

/**
 * Handles CRT text-distortion intensity.
 *
 * Controls the shared chromatic-aberration strength applied to rendered
 * text and SVG graphics.
 *
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onTextShadowIntensity = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) return;

    const intensity = clamp(
        Number.parseFloat(target.value),
        TEXT_SHADOW_MIN,
        TEXT_SHADOW_MAX
    );

    const next: Prefs = {
        ...live(),
        textShadowEnabled: intensity > 0,
        textShadowIntensity: intensity
    };

    commit(next);
    syncMod(ctx.modalEl, next);
};

/**
 * Reset button handler. Goes back to the css-ish defaults.
 * @param {Event} _ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onReset = (_ev: Event, ctx: Ctx): void => {
    const base = defs();
    const next: Prefs = {
        phosphorEnabled: true,
        phosphorOpacity: base.phosphorOpacity,
        scanlinesEnabled: true,
        scanlineOpacity: base.scanlineOpacity,
        scanlineSpeed: base.scanlineSpeed,
        textShadowEnabled: true,
        textShadowIntensity: base.textShadowIntensity
    };

    commit(next);
    syncMod(ctx.modalEl, next);
};

/**
 * Creates the modal singleton on first use.
 * @returns {modals.Modal}
 */
function ensureMod(): modals.Modal {
    if (mod) return mod;

    mod = modals.factory.create({
        id: MOD_ID,
        mode: "blocking",
        window: true,
        modalClassName: "effects-modal",
        content: rndrMod,
        decorators: [
            modals.closeOnClick("[data-effects-close]"),
            modals.onModalEvent("#effects-text-shadow-enabled", "change", onTextShadowTgl),
            modals.onModalEvent("#effects-phosphor-enabled", "change", onPhosTgl),
            modals.onModalEvent("#effects-scanlines-enabled", "change", onScanTgl),
            modals.onModalEvent("#effects-phosphor-opacity", "input", onPhosOp),
            modals.onModalEvent("#effects-scanline-opacity", "input", onScanOp),
            modals.onModalEvent("#effects-scanline-speed", "input", onScanSpd),
            modals.onModalEvent(
                "#effects-text-shadow-intensity",
                "input",
                onTextShadowIntensity
            ),
            modals.onModalEvent("#effects-reset", "click", onReset)
        ]
    });

    return mod;
}

/**
 * Opens the effects modal and refreshes its content first.
 * @returns {void}
 */
function openMod(): void {
    const modal = ensureMod();
    modal.setContent(rndrMod());
    modal.open();
}

/**
 * Installs the storage event sync once.
 * @returns {void}
 */
function ensureSync(): void {
    if (syncOn) return;
    syncOn = true;

    /**
     * Keeps tabs/windows in sync when storage changes elsewhere.
     * @param {StorageEvent} event
     * @returns {void}
     */
    const onStore = (event: StorageEvent): void => {
        if (event.key !== STORAGE_KEY) return;
        apply(resolved());
        syncOpen();
    };

    const onThemeModeChange = (): void => {
        applyTextShadowScale(live().textShadowIntensity);
    };

    document.addEventListener(
        THEME_MODE_CHANGED_EVENT,
        onThemeModeChange
    );

    window.addEventListener("storage", onStore);
}


/**
 * Small non-blocking helper matching the reader's existing "Did you know?"
 * tip behaviour.
 *
 * @returns {ReactElement}
 */
function EffectsTipModal(): ReactElement {
    return (
        <>
            <div className="modal-header">
                <h3>Did you know?</h3>
            </div>

            <div className="modal-content">
                <p>
                    Effects too distracting? Disable or soften them here.
                </p>

                <label className="kc-checkbox-row">
                    <input id="kc-effects-help-hide" type="checkbox" />
                    <span>Do not show this tip again</span>
                </label>

                <div className="kc-modal-actions">
                    <button
                        id="kc-effects-help-close"
                        type="button"
                        style={{ display: "block", margin: "0 auto" }}
                    >
                        Close
                    </button>
                </div>

                <p className="modal-note">You can close this window with <kbd>Esc</kbd>.</p>
            </div>
        </>
    );
}

/**
 * @returns {boolean}
 */
function showEffectsTip(): boolean {
    if (effectsTipShown) return false;
    if (localStorage.getItem(EFFECTS_TIP_HIDE_KEY) === "true") return false;
    return true;
}

const EFFECTS_TIP_MODAL_HTML = (): string => render2Mkup(<EffectsTipModal />);

const persistEffectsTipHide: ModalDecorator = {
    mount: (ctx: ModalCtx) => {
        const box = ctx.modalEl.querySelector("#kc-effects-help-hide");
        if (!(box instanceof HTMLInputElement)) return;

        box.checked = localStorage.getItem(EFFECTS_TIP_HIDE_KEY) === "true";

        const onChange = (): void => {
            localStorage.setItem(
                EFFECTS_TIP_HIDE_KEY,
                box.checked ? "true" : "false"
            );

            if (box.checked) ctx.close();
        };

        box.addEventListener("change", onChange);
        return () => box.removeEventListener("change", onChange);
    }
};

const effectsTipModal = modals.factory.create({
    id: EFFECTS_TIP_MODAL_ID,
    mode: "non-blocking",
    readerModeCompatible: false,
    modalClassName: "did-you-know-tip",
    position: {
        target: "#effects-toggle"
    },
    asTextBubble: true,
    content: EFFECTS_TIP_MODAL_HTML,
    closeOnOutsideClick: false,
    decorators: [
        modals.closeOnClick("#kc-effects-help-close"),
        persistEffectsTipHide
    ]
});

/**
 * @returns {void}
 */
function openEffectsTip(): void {
    if (!showEffectsTip()) return;
    if (effectsTipModal.isOpen()) return;

    effectsTipModal.open();
    effectsTipShown = true;
}

/**
 * Reuses the reader tip's visibility-trigger pattern for the fixed effects
 * button.
 *
 * @param {HTMLButtonElement} button
 * @returns {void}
 */
function initEffectsTip(button: HTMLButtonElement): void {
    if (!showEffectsTip()) return;

    effectsTipObs?.disconnect();

    effectsTipObs = new IntersectionObserver(
        (entries: IntersectionObserverEntry[]) => {
            const anyVisible = entries.some((entry) => entry.isIntersecting);
            if (!anyVisible) return;

            openEffectsTip();

            effectsTipObs?.disconnect();
            effectsTipObs = null;
        },
        { threshold: 0.15 }
    );

    effectsTipObs.observe(button);
}


/**
 * Creates the floating CRT effects button, applies saved preferences,
 * and wires the effects modal. Button plumbing is delegated to
 * `installMenuToggle` so every floating-modal toggle behaves the same.
 * @param {fxUIconf} nextUi
 * @returns {void}
 */
export function initEffectsControls(nextUi: fxUIconf): void {
    uiCfg = nextUi;

    ensureTextShadowTargets();
    ensureTextShadowKeyframes();

    defs();
    apply(resolved());

    const effectsToggle = installMenuToggle({
        id: BTN_ID,
        bottom: BTN_BOTTOM,
        cfg: nextUi,
        classes: ["theme-toggle-button", "effects-toggle-button"],
        icon: {
            size: 32,
            wrapperClass: "effects-toggle-button__icon",
            svgClass: "effects-toggle-button__svg"
        },
        openModal: openMod
    });

    initEffectsTip(effectsToggle.button);

    if (mod?.isOpen()) {
        mod.setContent(rndrMod());
    }

    ensureSync();
}