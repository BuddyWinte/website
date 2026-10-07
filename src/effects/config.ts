export type Prefs = Readonly<{
    phosphorEnabled: boolean;
    phosphorOpacity: number;
    scanlinesEnabled: boolean;
    scanlineOpacity: number;
    scanlineSpeed: number;
    textShadowEnabled: boolean;
    textShadowIntensity: number;
}>;

export type StoredPrefs = Readonly<Partial<Prefs>>;

export const STORAGE_KEY = "kcEffectsPrefs";

export const PHOS_OP_MIN = 0;
export const PHOS_OP_MAX = 0.12;

export const SCAN_OP_MIN = 0;
export const SCAN_OP_MAX = 0.3;

export const SCAN_SPD_MIN = 0;
export const SCAN_SPD_MAX = 100;
export const DEF_SCAN_SPD = 90;

export const SCAN_MS_MIN = 1;
export const SCAN_MS_MAX = 22000;

export const TEXT_SHADOW_MIN = 0;
export const TEXT_SHADOW_MAX = 100;
export const TEXT_SHADOW_DEFAULT_PERCENT = 15;
export const TEXT_SHADOW_BASE_PERCENT = 20;
export const TEXT_SHADOW_CURVE_EXPONENT = 1.55;
export const TEXT_SHADOW_KEYFRAMES_STYLE_ID =
    "effect-crt-text-shadow-keyframes";
export const TEXT_SHADOW_FRAME_STEP = 5;
export const TEXT_SHADOW_RANDOM_SEED = 0x435254;

export const SLIDER_MIN = 0;
export const SLIDER_MAX = 100;
export const SLIDER_STEP = 1;
