import type { ReactElement } from 'react';
import * as soundEffects from './soundEffects.ts';
import * as plot from './plot.ts';
import { factory, onModalEvent, type Modal } from './modals.ts';
import { render2Mkup } from './reactHelpers.tsx';
import * as helpers from './helpers.ts';
import { ensureCfg, getCfg } from "./crtUi/config.ts";
import {
    BASE_FREQ_NOTCH_HZ,
    DEF_WIN_H,
    DEF_WIN_W,
    GAIN_NOTCH,
    LD_CONTENT_ID,
    LD_NOTICE_ID,
    LD_STAGE_ID,
    MOD_ID,
    WIN_STORE_KEY
} from "./crtUi/constants.ts";
import {
    clrLdSize,
    ensureLdCss,
    setFrameMinH,
    setLdReady,
    setLdSize
} from "./crtUi/loading.ts";
import type { Cfg, Ctx, Els, PlotKind, Rt } from "./crtUi/types.ts";

let mod: Modal | null = null;

const rtByEl = new WeakMap<HTMLDivElement, Rt>();

/**
 * Number formatter for the little readouts and whatnot.
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
function fmtNum(value: number, decimals = 2): string {
    return value.toFixed(decimals);
}

/**
 * Snaps a value to the nearest preset when it is close enough.
 * @param {number} value
 * @param {number[]} presetValues
 * @param {number} threshold
 * @returns {number}
 */
function snapTo(
    value: number,
    presetValues: number[],
    threshold: number
): number {
    let nearestValue = value;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const presetValue of presetValues) {
        const distance = Math.abs(value - presetValue);

        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestValue = presetValue;
        }
    }

    if (nearestDistance <= threshold) {
        return nearestValue;
    }

    return value;
}

/**
 * Snaps the base freq slider onto the classic mains values if close enough.
 * @param {number} value
 * @returns {number}
 */
function snapBase(value: number): number {
    const snappedValue = snapTo(
        value,
        [50, 60],
        BASE_FREQ_NOTCH_HZ
    );

    return Number(snappedValue.toFixed(2));
}

/**
 * Same idea as the freq snap, but for gain sliders around 1.
 * @param {number} value
 * @returns {number}
 */
function snapGain(value: number): number {
    const snappedValue = snapTo(
        value,
        [1],
        GAIN_NOTCH
    );

    return Number(snappedValue.toFixed(2));
}

/**
 * Builds the start/stop label for a layer toggle.
 * @param {string} label
 * @param {boolean} isEnabled
 * @returns {string}
 */
function getLayerBtn(label: string, isEnabled: boolean): string {
    const text = getCfg().modal;

    return isEnabled
        ? `${text.stopPrefix} ${label}`
        : `${text.startPrefix} ${label}`;
}

/**
 * Label for the plot type swap button.
 * @param {PlotKind} plotType
 * @returns {string}
 */
function getPlotBtn(plotType: PlotKind): string {
    const text = getCfg().modal;

    return plotType === 'spectrogram'
        ? text.plotSpectrogram
        : text.plotWaveform;
}

/**
 * Label for the main power button.
 * @returns {string}
 */
function getPowerBtn(): string {
    const text = getCfg().modal;

    return soundEffects.getCrtNoiseState().running
        ? text.stopPrefix
        : text.startPrefix;
}

/**
 * Query selector but rude about missing nodes.
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {T}
 */
function needEl<T extends Element>(
    root: ParentNode,
    selector: string
): T {
    const element = root.querySelector<T>(selector);

    if (element === null) {
        throw new Error(`Missing UI element: ${selector}`);
    }

    return element;
}

/**
 * Caches all the interesting DOM bits for the modal.
 * @param {HTMLDivElement} modalEl
 * @returns {Els}
 */
function mkEls(modalEl: HTMLDivElement): Els {
    return {
        root: modalEl,
        loadingStage: needEl(modalEl, `#${LD_STAGE_ID}`),
        contentLayer: needEl(modalEl, `#${LD_CONTENT_ID}`),
        powerToggleButton: needEl(modalEl, '#power-toggle-button'),
        degaussButton: needEl(modalEl, '#degauss-button'),
        plotToggleButton: needEl(modalEl, '#plot-toggle-button'),
        standardSelect: needEl(modalEl, '#standard-select'),
        standardValue: needEl(modalEl, '#standard-value'),
        baseFrequencySlider: needEl(modalEl, '#base-frequency-slider'),
        baseFrequencyValue: needEl(modalEl, '#base-frequency-value'),
        masterGainSlider: needEl(modalEl, '#master-gain-slider'),
        masterGainValue: needEl(modalEl, '#master-gain-value'),
        scanlineGainSlider: needEl(modalEl, '#scanline-gain-slider'),
        scanlineGainValue: needEl(modalEl, '#scanline-gain-value'),
        humGainSlider: needEl(modalEl, '#hum-gain-slider'),
        humGainValue: needEl(modalEl, '#hum-gain-value'),
        rectifierGainSlider: needEl(modalEl, '#rectifier-gain-slider'),
        rectifierGainValue: needEl(modalEl, '#rectifier-gain-value'),
        degaussGainSlider: needEl(modalEl, '#degauss-gain-slider'),
        degaussGainValue: needEl(modalEl, '#degauss-gain-value'),
        collapseGainSlider: needEl(modalEl, '#collapse-gain-slider'),
        collapseGainValue: needEl(modalEl, '#collapse-gain-value'),
        dischargeGainSlider: needEl(modalEl, '#discharge-gain-slider'),
        dischargeGainValue: needEl(modalEl, '#discharge-gain-value'),
        scanlineToggleButton: needEl(modalEl, '#scanline-toggle-button'),
        humToggleButton: needEl(modalEl, '#hum-toggle-button'),
        rectifierToggleButton: needEl(modalEl, '#rectifier-toggle-button'),
        statusText: needEl(modalEl, '#status-text'),
        standardReadout: needEl(modalEl, '#standard-readout'),
        baseReadout: needEl(modalEl, '#base-readout'),
        lineReadout: needEl(modalEl, '#line-readout'),
        plotCanvas: needEl(modalEl, '#plot-canvas')
    };
}

/**
 * Finds the mounted runtime for a modal node.
 * @param {HTMLDivElement} modalEl
 * @returns {Rt}
 */
function getRt(modalEl: HTMLDivElement): Rt {
    const runtime = rtByEl.get(modalEl);

    if (!runtime) {
        throw new Error('CRT UI runtime is not mounted.');
    }

    return runtime;
}

/**
 * Pushes sound state into the controls/readouts.
 * @param {Els} elements
 * @param {plot.AudioSignalPlot} audioPlot
 * @returns {void}
 */
function sync(elements: Els, audioPlot: plot.AudioSignalPlot): void {
    const state = soundEffects.getCrtNoiseState();
    const text = getCfg().modal;

    elements.powerToggleButton.textContent = getPowerBtn();
    elements.degaussButton.disabled = !state.running;
    elements.plotToggleButton.textContent = getPlotBtn(audioPlot.getPlotType());

    elements.scanlineToggleButton.textContent = getLayerBtn(
        text.scanlineLabel,
        state.scanlineEnabled
    );

    elements.humToggleButton.textContent = getLayerBtn(
        text.humLabel,
        state.humEnabled
    );

    elements.rectifierToggleButton.textContent = getLayerBtn(
        text.rectifierLabel,
        state.rectifierEnabled
    );

    elements.standardSelect.value = state.timingStandard;

    elements.standardValue.textContent = state.displayStandard === 'NONE'
        ? text.none
        : state.displayStandard;

    elements.baseFrequencySlider.value = String(state.baseFrequencyHz);
    elements.baseFrequencyValue.textContent = `${fmtNum(state.baseFrequencyHz)} Hz`;

    elements.masterGainSlider.value = String(state.masterGain);
    elements.masterGainValue.textContent = fmtNum(state.masterGain);

    elements.scanlineGainSlider.value = String(state.scanlineGain);
    elements.scanlineGainValue.textContent = fmtNum(state.scanlineGain);

    elements.humGainSlider.value = String(state.humGain);
    elements.humGainValue.textContent = fmtNum(state.humGain);

    elements.rectifierGainSlider.value = String(state.rectifierGain);
    elements.rectifierGainValue.textContent = fmtNum(state.rectifierGain);

    elements.degaussGainSlider.value = String(state.degaussGain);
    elements.degaussGainValue.textContent = fmtNum(state.degaussGain);

    elements.collapseGainSlider.value = String(state.collapseGain);
    elements.collapseGainValue.textContent = fmtNum(state.collapseGain);

    elements.dischargeGainSlider.value = String(state.dischargeGain);
    elements.dischargeGainValue.textContent = fmtNum(state.dischargeGain);

    elements.statusText.textContent = state.running
        ? text.runningStatus
        : text.idleStatus;

    elements.standardReadout.textContent = state.displayStandard === 'NONE'
        ? text.none
        : state.displayStandard;

    elements.baseReadout.textContent = `${fmtNum(state.baseFrequencyHz)} Hz`;
    elements.lineReadout.textContent = `${fmtNum(state.lineFrequencyHz)} Hz`;

    audioPlot.setAnalyserNode(soundEffects.getCrtAnalyserNode());
}

/**
 * Resizes the plot and re-syncs the modal bits.
 * @param {HTMLDivElement} modalEl
 * @returns {void}
 */
function syncMod(modalEl: HTMLDivElement): void {
    const runtime = getRt(modalEl);
    runtime.audioPlot.resize();
    sync(runtime.elements, runtime.audioPlot);
}

/**
 * Mounts the modal runtime, listeners and plot stuff.
 * @param {HTMLDivElement} modalEl
 * @returns {Rt}
 */
function mountRt(modalEl: HTMLDivElement): Rt {
    setFrameMinH();
    ensureLdCss();

    modalEl.style.position = 'relative';
    modalEl.style.overflow = 'hidden';
    modalEl.style.minHeight = '0';

    const elements = mkEls(modalEl);

    setLdSize(elements.loadingStage, elements.contentLayer);
    setLdReady(elements.loadingStage, false);

    const audioPlot = plot.createAudioSignalPlot({
        canvas: elements.plotCanvas,
        initialPlotType: 'spectrogram'
    });

    let resizeObserver: ResizeObserver | null = null;
    const cleanup: Array<() => void> = [];

    if (typeof ResizeObserver !== 'undefined') {
        /**
         * Resizes the plot when the modal box changes.
         * @returns {void}
         */
        const onObs = (): void => {
            audioPlot.resize();
        };

        resizeObserver = new ResizeObserver(onObs);
        resizeObserver.observe(modalEl);
    } else {
        /**
         * Fallback resize hook for older browsers and such.
         * @returns {void}
         */
        const onWinResize = (): void => {
            audioPlot.resize();
        };

        /**
         * Removes the window resize hook.
         * @returns {void}
         */
        const offWinResize = (): void => {
            window.removeEventListener('resize', onWinResize);
        };

        window.addEventListener('resize', onWinResize);
        cleanup.push(offWinResize);
    }

    /**
     * Tears the runtime down.
     * @returns {void}
     */
    const destroy = (): void => {
        audioPlot.stop();
        resizeObserver?.disconnect();

        for (const off of cleanup) {
            off();
        }

        rtByEl.delete(modalEl);
    };

    /**
     * Refreshes the visible UI bits from current sound state.
     * @returns {void}
     */
    const refresh = (): void => {
        syncMod(modalEl);
    };

    const runtime: Rt = {
        elements,
        audioPlot,
        destroy,
        refresh
    };

    rtByEl.set(modalEl, runtime);

    audioPlot.start();
    sync(elements, audioPlot);

    /**
     * Queues the actual refresh on the next frame after the next frame.
     * yes, slightly silly, but it helps the layout settle.
     * @returns {void}
     */
    const qRef = (): void => {
        requestAnimationFrame(doRef);
    };

    /**
     * Finalises the first refresh and fades out the loader.
     * @returns {void}
     */
    const doRef = (): void => {
        if (!rtByEl.has(modalEl)) {
            return;
        }

        runtime.refresh();
        setLdReady(elements.loadingStage, true);

        requestAnimationFrame(() => {
            if (!rtByEl.has(modalEl)) {
                return;
            }

            clrLdSize(elements.loadingStage, elements.contentLayer);
            runtime.refresh();
        });
    };

    requestAnimationFrame(qRef);

    return runtime;
}

/**
 * React view for the modal body.
 * @param {Cfg} ui
 * @returns {ReactElement}
 */
function Panel(ui: Cfg): ReactElement {
    const text = ui.modal;

    return (
        <div id={LD_STAGE_ID} data-ready="false">
            <div
                id={LD_NOTICE_ID}
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >
                <div className="crt-ui__loadingInner">
                    <span className="crt-ui__loadingLabel">Loading</span>

                    <span className="crt-ui__loadingDots" aria-hidden="true">
                        <span className="crt-ui__loadingDot">.</span>
                        <span className="crt-ui__loadingDot">.</span>
                        <span className="crt-ui__loadingDot">.</span>
                    </span>
                </div>
            </div>

            <div id={LD_CONTENT_ID}>
                <div className="crt-ui__layout">
                    <section className="crt-ui__panel crt-ui__controls">
                        <div className="crt-ui__title">
                            <h2>{text.title}</h2>
                            <p>{text.lead}</p>
                        </div>

                        <div className="crt-ui__group">
                            <h3>{text.transportTitle}</h3>

                            <div className="crt-ui__buttonRow crt-ui__buttonRow--two">
                                <button id="power-toggle-button" type="button">
                                    {text.startPrefix}
                                </button>

                                <button id="degauss-button" type="button">
                                    {text.retriggerDegauss}
                                </button>
                            </div>

                            <div className="crt-ui__buttonRow">
                                <button id="plot-toggle-button" type="button">
                                    {text.plotSpectrogram}
                                </button>
                            </div>
                        </div>

                        <div className="crt-ui__group">
                            <h3>{text.presetAndFrequencyTitle}</h3>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.presetFamilyLabel}</span>
                                    <span id="standard-value">PAL</span>
                                </span>

                                <select id="standard-select" defaultValue="PAL">
                                    <option value="PAL">{text.presetPalLabel}</option>
                                    <option value="NTSC">{text.presetNtscLabel}</option>
                                </select>
                            </label>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.baseFrequencyLabel}</span>
                                    <span id="base-frequency-value">50.00 Hz</span>
                                </span>

                                <input
                                    id="base-frequency-slider"
                                    type="range"
                                    min="45"
                                    max="65"
                                    step="0.01"
                                    defaultValue="50"
                                />
                            </label>
                        </div>

                        <div className="crt-ui__group">
                            <h3>{text.layerTogglesTitle}</h3>

                            <div className="crt-ui__buttonRow crt-ui__buttonRow--two">
                                <button id="scanline-toggle-button" type="button">
                                    {getLayerBtn(text.scanlineLabel, true)}
                                </button>

                                <button id="hum-toggle-button" type="button">
                                    {getLayerBtn(text.humLabel, true)}
                                </button>
                            </div>

                            <div className="crt-ui__buttonRow">
                                <button id="rectifier-toggle-button" type="button">
                                    {getLayerBtn(text.rectifierLabel, true)}
                                </button>
                            </div>
                        </div>

                        <div className="crt-ui__group">
                            <h3>{text.levelsTitle}</h3>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.masterLabel}</span>
                                    <span id="master-gain-value">1.00</span>
                                </span>

                                <input
                                    id="master-gain-slider"
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.01"
                                    defaultValue="1"
                                />
                            </label>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.scanlineLabel}</span>
                                    <span id="scanline-gain-value">1.00</span>
                                </span>

                                <input
                                    id="scanline-gain-slider"
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.01"
                                    defaultValue="1"
                                />
                            </label>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.humLabel}</span>
                                    <span id="hum-gain-value">0.10</span>
                                </span>

                                <input
                                    id="hum-gain-slider"
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.01"
                                    defaultValue="0.1"
                                />
                            </label>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.rectifierLabel}</span>
                                    <span id="rectifier-gain-value">0.10</span>
                                </span>

                                <input
                                    id="rectifier-gain-slider"
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.01"
                                    defaultValue="0.1"
                                />
                            </label>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.degaussLabel}</span>
                                    <span id="degauss-gain-value">0.50</span>
                                </span>

                                <input
                                    id="degauss-gain-slider"
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.01"
                                    defaultValue="0.5"
                                />
                            </label>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.collapseLabel}</span>
                                    <span id="collapse-gain-value">0.35</span>
                                </span>

                                <input
                                    id="collapse-gain-slider"
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.01"
                                    defaultValue="0.35"
                                />
                            </label>

                            <label className="crt-ui__field">
                                <span className="crt-ui__fieldLabel">
                                    <span>{text.dischargeLabel}</span>
                                    <span id="discharge-gain-value">0.60</span>
                                </span>

                                <input
                                    id="discharge-gain-slider"
                                    type="range"
                                    min="0"
                                    max="2"
                                    step="0.01"
                                    defaultValue="0.6"
                                />
                            </label>
                        </div>

                        <div className="crt-ui__status">
                            <strong>{text.statusTitle}</strong>

                            <div className="crt-ui__statusGrid">
                                <span>{text.standardLabel}</span>
                                <span id="standard-readout">PAL</span>

                                <span>{text.baseLabel}</span>
                                <span id="base-readout">50.00 Hz</span>

                                <span>{text.lineFrequencyLabel}</span>
                                <span id="line-readout">15625.00 Hz</span>
                            </div>

                            <strong id="status-text">{text.idleStatus}</strong>
                        </div>

                        <div className="crt-ui__footer">
                            <button
                                type="button"
                                data-crt-ui-restore=""
                                title={text.restore}
                                aria-label={text.restore}
                                data-intent="primary"
                            >
                                {text.restore}
                            </button>
                        </div>
                    </section>

                    <section className="crt-ui__panel crt-ui__plotPanel">
                        <canvas id="plot-canvas" className="crt-ui__plotCanvas" />
                    </section>
                </div>
            </div>
        </div>
    );
}

/**
 * Tiny wrapper so render shape matches the effects modal pattern.
 * @returns {ReactElement}
 */
function ModView(): ReactElement {
    return <Panel {...getCfg()} />;
}

/**
 * Renders the modal html string from the React bit.
 * @returns {string}
 */
function rndrMod(): string {
    return render2Mkup(<ModView />);
}

/**
 * Mount hook for the CSS decorator thing.
 * @param {Ctx} ctx
 * @returns {() => void}
 */
const mnt = (ctx: Ctx): (() => void) => {
    const runtime = mountRt(ctx.modalEl);

    /**
     * Unmount cleanup.
     * @returns {void}
     */
    const off = (): void => {
        runtime.destroy();
    };

    return off;
};

/**
 * Power button click handler.
 * @param {Event} _ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onPw = (_ev: Event, ctx: Ctx): void => {
    void soundEffects.toggleCrtPower().then(() => {
        syncMod(ctx.modalEl);
    });
};

/**
 * Degauss button handler.
 * @param {Event} _ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onDeg = (_ev: Event, ctx: Ctx): void => {
    soundEffects.triggerCrtDegauss();
    syncMod(ctx.modalEl);
};

/**
 * Swaps the plot mode back and forth.
 * @param {Event} _ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onPlot = (_ev: Event, ctx: Ctx): void => {
    const runtime = getRt(ctx.modalEl);
    const nextPlotType: PlotKind = runtime.audioPlot.getPlotType() === 'spectrogram'
        ? 'waveform'
        : 'spectrogram';

    runtime.audioPlot.setPlotType(nextPlotType);
    syncMod(ctx.modalEl);
};

/**
 * Preset family change. Ignores weird values.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onStd = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLSelectElement)) {
        return;
    }

    if (target.value !== 'PAL' && target.value !== 'NTSC') {
        return;
    }

    soundEffects.setCrtVideoStandard(target.value);
    syncMod(ctx.modalEl);
};

/**
 * Base freq slider handler.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onBase = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const snappedValue = snapBase(Number(target.value));
    soundEffects.setCrtBaseFrequencyHz(snappedValue);
    syncMod(ctx.modalEl);
};

/**
 * Master gain slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onMaster = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const snappedValue = snapGain(Number(target.value));
    soundEffects.setCrtMasterGain(snappedValue);
    syncMod(ctx.modalEl);
};

/**
 * Scanline gain slider thing.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onScanGain = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const snappedValue = snapGain(Number(target.value));
    soundEffects.setCrtScanlineGain(snappedValue);
    syncMod(ctx.modalEl);
};

/**
 * Hum gain slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onHumGain = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const snappedValue = snapGain(Number(target.value));
    soundEffects.setCrtHumGain(snappedValue);
    syncMod(ctx.modalEl);
};

/**
 * Rectifier gain slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onRectGain = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const snappedValue = snapGain(Number(target.value));
    soundEffects.setCrtRectifierGain(snappedValue);
    syncMod(ctx.modalEl);
};

/**
 * Degauss gain slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onDegGain = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const snappedValue = snapGain(Number(target.value));
    soundEffects.setCrtDegaussGain(snappedValue);
    syncMod(ctx.modalEl);
};

/**
 * Collapse gain slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onCollGain = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const snappedValue = snapGain(Number(target.value));
    soundEffects.setCrtCollapseGain(snappedValue);
    syncMod(ctx.modalEl);
};

/**
 * Discharge gain slider.
 * @param {Event} ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onDisGain = (ev: Event, ctx: Ctx): void => {
    const target = ev.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    const snappedValue = snapGain(Number(target.value));
    soundEffects.setCrtDischargeGain(snappedValue);
    syncMod(ctx.modalEl);
};

/**
 * Scanline layer toggle.
 * @param {Event} _ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onScanTgl = (_ev: Event, ctx: Ctx): void => {
    const nextEnabledState = !soundEffects.getCrtNoiseState().scanlineEnabled;
    soundEffects.setCrtScanlineEnabled(nextEnabledState);
    syncMod(ctx.modalEl);
};

/**
 * Hum layer toggle.
 * @param {Event} _ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onHumTgl = (_ev: Event, ctx: Ctx): void => {
    const nextEnabledState = !soundEffects.getCrtNoiseState().humEnabled;
    soundEffects.setCrtHumEnabled(nextEnabledState);
    syncMod(ctx.modalEl);
};

/**
 * Rectifier layer toggle.
 * @param {Event} _ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onRectTgl = (_ev: Event, ctx: Ctx): void => {
    const nextEnabledState = !soundEffects.getCrtNoiseState().rectifierEnabled;
    soundEffects.setCrtRectifierEnabled(nextEnabledState);
    syncMod(ctx.modalEl);
};

/**
 * Restore defaults button.
 * @param {Event} _ev
 * @param {Ctx} ctx
 * @returns {void}
 */
const onRst = (_ev: Event, ctx: Ctx): void => {
    soundEffects.restoreCrtDefaults();
    syncMod(ctx.modalEl);
};

/**
 * Makes the modal singleton if it does not exist yet.
 * @returns {Modal}
 */
function ensureMod(): Modal {
    if (mod) {
        return mod;
    }

    helpers.ensCtrWinState({
        storeKey: WIN_STORE_KEY,
        width: DEF_WIN_W,
        height: DEF_WIN_H
    });

    mod = factory.create({
        id: MOD_ID,
        mode: 'blocking',
        window: true,
        modalClassName: 'crt-ui-modal',
        content: rndrMod,
        decorators: [
            {
                cssHref: '/styles/modules/crt-ui.css',
                mount: mnt
            },
            onModalEvent('#power-toggle-button', 'click', onPw),
            onModalEvent('#degauss-button', 'click', onDeg),
            onModalEvent('#plot-toggle-button', 'click', onPlot),
            onModalEvent('#standard-select', 'change', onStd),
            onModalEvent('#base-frequency-slider', 'input', onBase),
            onModalEvent('#master-gain-slider', 'input', onMaster),
            onModalEvent('#scanline-gain-slider', 'input', onScanGain),
            onModalEvent('#hum-gain-slider', 'input', onHumGain),
            onModalEvent('#rectifier-gain-slider', 'input', onRectGain),
            onModalEvent('#degauss-gain-slider', 'input', onDegGain),
            onModalEvent('#collapse-gain-slider', 'input', onCollGain),
            onModalEvent('#discharge-gain-slider', 'input', onDisGain),
            onModalEvent('#scanline-toggle-button', 'click', onScanTgl),
            onModalEvent('#hum-toggle-button', 'click', onHumTgl),
            onModalEvent('#rectifier-toggle-button', 'click', onRectTgl),
            onModalEvent('[data-crt-ui-restore]', 'click', onRst)
        ]
    });

    return mod;
}

/**
 * Preloads config and builds the modal singleton.
 * @returns {Promise<void>}
 */
export async function initModal(): Promise<void> {
    await ensureCfg();
    ensureMod();
}

/**
 * Opens the CRT controls modal.
 * @returns {Promise<void>}
 */
export async function openModal(): Promise<void> {
    await ensureCfg();
    helpers.ensCtrWinState({
        storeKey: WIN_STORE_KEY,
        width: DEF_WIN_W,
        height: DEF_WIN_H
    });

    const modal = ensureMod();
    modal.setContent(rndrMod());
    modal.open();
}

/**
 * Closes the modal if it's open.
 * @returns {void}
 */
export function closeModal(): void {
    mod?.close();
}

/**
 * Tells you whether the modal is open right now.
 * @returns {boolean}
 */
export function modalIsOpen(): boolean {
    return mod?.isOpen() ?? false;
}