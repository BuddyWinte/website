import type { MainJson } from "../uiFetch.ts";
import { fetchUiData } from "../uiFetch.ts";
import type { Cfg } from "./types.ts";

let cfg: Cfg | null = null;
let cfgP: Promise<Cfg> | null = null;

function isObj(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value);
}

function needStr(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error("Missing CRT UI config string: " + fieldName);
    }

    return value;
}

function normCfg(candidate: unknown): Cfg {
    if (!isObj(candidate)) {
        throw new Error("Missing crtUi config in main.json");
    }

    const modalCandidate = candidate.modal;

    if (!isObj(modalCandidate)) {
        throw new Error("Missing crtUi.modal config in main.json");
    }

    return {
        modal: {
            title: needStr(modalCandidate.title, "crtUi.modal.title"),
            lead: needStr(modalCandidate.lead, "crtUi.modal.lead"),
            closeTitle: needStr(modalCandidate.closeTitle, "crtUi.modal.closeTitle"),
            transportTitle: needStr(modalCandidate.transportTitle, "crtUi.modal.transportTitle"),
            presetAndFrequencyTitle: needStr(
                modalCandidate.presetAndFrequencyTitle,
                "crtUi.modal.presetAndFrequencyTitle"
            ),
            layerTogglesTitle: needStr(
                modalCandidate.layerTogglesTitle,
                "crtUi.modal.layerTogglesTitle"
            ),
            levelsTitle: needStr(modalCandidate.levelsTitle, "crtUi.modal.levelsTitle"),
            statusTitle: needStr(modalCandidate.statusTitle, "crtUi.modal.statusTitle"),
            presetFamilyLabel: needStr(
                modalCandidate.presetFamilyLabel,
                "crtUi.modal.presetFamilyLabel"
            ),
            presetPalLabel: needStr(modalCandidate.presetPalLabel, "crtUi.modal.presetPalLabel"),
            presetNtscLabel: needStr(
                modalCandidate.presetNtscLabel,
                "crtUi.modal.presetNtscLabel"
            ),
            baseFrequencyLabel: needStr(
                modalCandidate.baseFrequencyLabel,
                "crtUi.modal.baseFrequencyLabel"
            ),
            masterLabel: needStr(modalCandidate.masterLabel, "crtUi.modal.masterLabel"),
            scanlineLabel: needStr(modalCandidate.scanlineLabel, "crtUi.modal.scanlineLabel"),
            humLabel: needStr(modalCandidate.humLabel, "crtUi.modal.humLabel"),
            rectifierLabel: needStr(modalCandidate.rectifierLabel, "crtUi.modal.rectifierLabel"),
            degaussLabel: needStr(modalCandidate.degaussLabel, "crtUi.modal.degaussLabel"),
            collapseLabel: needStr(modalCandidate.collapseLabel, "crtUi.modal.collapseLabel"),
            dischargeLabel: needStr(modalCandidate.dischargeLabel, "crtUi.modal.dischargeLabel"),
            runningLabel: needStr(modalCandidate.runningLabel, "crtUi.modal.runningLabel"),
            standardLabel: needStr(modalCandidate.standardLabel, "crtUi.modal.standardLabel"),
            baseLabel: needStr(modalCandidate.baseLabel, "crtUi.modal.baseLabel"),
            lineFrequencyLabel: needStr(
                modalCandidate.lineFrequencyLabel,
                "crtUi.modal.lineFrequencyLabel"
            ),
            retriggerDegauss: needStr(
                modalCandidate.retriggerDegauss,
                "crtUi.modal.retriggerDegauss"
            ),
            restore: needStr(modalCandidate.restore, "crtUi.modal.restore"),
            none: needStr(modalCandidate.none, "crtUi.modal.none"),
            startPrefix: needStr(modalCandidate.startPrefix, "crtUi.modal.startPrefix"),
            stopPrefix: needStr(modalCandidate.stopPrefix, "crtUi.modal.stopPrefix"),
            plotSpectrogram: needStr(
                modalCandidate.plotSpectrogram,
                "crtUi.modal.plotSpectrogram"
            ),
            plotWaveform: needStr(modalCandidate.plotWaveform, "crtUi.modal.plotWaveform"),
            idleStatus: needStr(modalCandidate.idleStatus, "crtUi.modal.idleStatus"),
            runningStatus: needStr(modalCandidate.runningStatus, "crtUi.modal.runningStatus")
        }
    };
}

export async function ensureCfg(): Promise<Cfg> {
    if (cfg) return cfg;
    if (cfgP) return cfgP;

    const load = async (): Promise<Cfg> => {
        const data = await fetchUiData();
        const candidate = (data as MainJson & { crtUi?: unknown }).crtUi;
        const resolved = normCfg(candidate);
        cfg = resolved;
        return resolved;
    };

    cfgP = load();

    try {
        return await cfgP;
    } finally {
        cfgP = null;
    }
}

export function getCfg(): Cfg {
    if (!cfg) {
        throw new Error("CRT UI config has not been initialised.");
    }

    return cfg;
}
