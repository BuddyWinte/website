import {
    SCAN_MS_MAX,
    SCAN_MS_MIN,
    SCAN_SPD_MAX,
    SCAN_SPD_MIN,
    TEXT_SHADOW_BASE_PERCENT,
    TEXT_SHADOW_CURVE_EXPONENT,
    TEXT_SHADOW_MAX,
    TEXT_SHADOW_MIN
} from "./config.ts";

export function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/**
 * Pulls a num out of css/storage text.
 * if it cant, just uses fallback and shrugs.
 * @param {string} raw
 * @param {number} fallback
 * @returns {number}
 */
export function num(raw: string, fallback: number): number {
    const parsed = Number.parseFloat(raw.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Makes a readable percent string.
 * @param {number} value
 * @returns {string}
 */
export function pct(value: number): string {
    return `${Math.round(clamp(value, 0, 100))}%`;
}

/**
 * Small css-safe-ish number formatter.
 * trims float gunk a bit.
 * @param {number} value
 * @returns {string}
 */
export function cssNum(value: number): string {
    return String(Number(value.toFixed(3)));
}

/**
 * Maps the 0..100 UI value onto the actual text-shadow multiplier.
 *
 * 20% is deliberately anchored at 1x as the base CRT strength.
 * Above that, the curve ramps increasingly hard so 100% becomes properly
 * obnoxious rather than merely "a bit more RGB".
 *
 * @param {number} intensity
 * @returns {number}
 */
export function textShadowScale(intensity: number): number {
    const clampedIntensity = clamp(
        intensity,
        TEXT_SHADOW_MIN,
        TEXT_SHADOW_MAX
    );

    if (clampedIntensity <= 0) {
        return 0;
    }

    const normalised =
        clampedIntensity /
        TEXT_SHADOW_BASE_PERCENT;

    return Math.pow(
        normalised,
        TEXT_SHADOW_CURVE_EXPONENT
    );
}



export function opToPct(opacity: number, maxOpacity: number): number {
    if (maxOpacity <= 0) return 0;
    return clamp((clamp(opacity, 0, maxOpacity) / maxOpacity) * 100, 0, 100);
}

/**
 * Maps slider percent back to actual opacity.
 * @param {number} percent
 * @param {number} maxOpacity
 * @returns {number}
 */
export function pctToOp(percent: number, maxOpacity: number): number {
    return clamp((clamp(percent, 0, 100) / 100) * maxOpacity, 0, maxOpacity);
}

/**
 * Turns ms into a css duration string.
 * @param {number} value
 * @returns {string}
 */
export function ms(value: number): string {
    return `${Math.round(
        clamp(value, SCAN_MS_MIN, SCAN_MS_MAX)
    )}ms`;
}

/**
 * Speed percent to travel duration. Faster speed means less ms, obv.
 * @param {number} speed
 * @returns {number}
 */
export function spdToMs(speed: number): number {
    const clampedSpeed = clamp(speed, SCAN_SPD_MIN, SCAN_SPD_MAX);
    if (clampedSpeed <= 0) return SCAN_MS_MAX;

    const progress = (clampedSpeed - 1) / 99;

    return (
        SCAN_MS_MAX -
        progress * (SCAN_MS_MAX - SCAN_MS_MIN)
    );
}

/**
 * Duration back into speed percent.
 * @param {number} durationMs
 * @returns {number}
 */
export function msToSpd(durationMs: number): number {
    const clampedDuration = clamp(
        durationMs,
        SCAN_MS_MIN,
        SCAN_MS_MAX
    );

    const progress =
        (SCAN_MS_MAX - clampedDuration) /
        (SCAN_MS_MAX - SCAN_MS_MIN);

    return clamp(1 + progress * 99, SCAN_SPD_MIN, SCAN_SPD_MAX);
}


