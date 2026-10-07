import type * as plot from "../plot.ts";

export type PlotKind = plot.PlotType;
export type Ctx = Readonly<{
    modalEl: HTMLDivElement;
}>;

export interface Els {
    root: HTMLDivElement;
    loadingStage: HTMLDivElement;
    contentLayer: HTMLDivElement;
    powerToggleButton: HTMLButtonElement;
    degaussButton: HTMLButtonElement;
    plotToggleButton: HTMLButtonElement;
    standardSelect: HTMLSelectElement;
    standardValue: HTMLElement;
    baseFrequencySlider: HTMLInputElement;
    baseFrequencyValue: HTMLElement;
    masterGainSlider: HTMLInputElement;
    masterGainValue: HTMLElement;
    scanlineGainSlider: HTMLInputElement;
    scanlineGainValue: HTMLElement;
    humGainSlider: HTMLInputElement;
    humGainValue: HTMLElement;
    rectifierGainSlider: HTMLInputElement;
    rectifierGainValue: HTMLElement;
    degaussGainSlider: HTMLInputElement;
    degaussGainValue: HTMLElement;
    collapseGainSlider: HTMLInputElement;
    collapseGainValue: HTMLElement;
    dischargeGainSlider: HTMLInputElement;
    dischargeGainValue: HTMLElement;
    scanlineToggleButton: HTMLButtonElement;
    humToggleButton: HTMLButtonElement;
    rectifierToggleButton: HTMLButtonElement;
    statusText: HTMLElement;
    standardReadout: HTMLElement;
    baseReadout: HTMLElement;
    lineReadout: HTMLElement;
    plotCanvas: HTMLCanvasElement;
}

export type Rt = Readonly<{
    elements: Els;
    audioPlot: plot.AudioSignalPlot;
    destroy: () => void;
    refresh: () => void;
}>;

export type ModText = Readonly<{
    title: string;
    lead: string;
    closeTitle: string;
    transportTitle: string;
    presetAndFrequencyTitle: string;
    layerTogglesTitle: string;
    levelsTitle: string;
    statusTitle: string;
    presetFamilyLabel: string;
    presetPalLabel: string;
    presetNtscLabel: string;
    baseFrequencyLabel: string;
    masterLabel: string;
    scanlineLabel: string;
    humLabel: string;
    rectifierLabel: string;
    degaussLabel: string;
    collapseLabel: string;
    dischargeLabel: string;
    runningLabel: string;
    standardLabel: string;
    baseLabel: string;
    lineFrequencyLabel: string;
    retriggerDegauss: string;
    restore: string;
    none: string;
    startPrefix: string;
    stopPrefix: string;
    plotSpectrogram: string;
    plotWaveform: string;
    idleStatus: string;
    runningStatus: string;
}>;

export type Cfg = Readonly<{
    modal: ModText;
}>;

export type WinSize = Readonly<{
    width: string;
    height: string;
}>;
