import type {
    Prefs,
    StoredPrefs
} from "./config.ts";
import {
    DEF_SCAN_SPD,
    PHOS_OP_MAX,
    PHOS_OP_MIN,
    SCAN_OP_MAX,
    SCAN_OP_MIN,
    SCAN_SPD_MAX,
    SCAN_SPD_MIN,
    STORAGE_KEY,
    TEXT_SHADOW_DEFAULT_PERCENT,
    TEXT_SHADOW_MAX,
    TEXT_SHADOW_MIN
} from "./config.ts";
import {
    clamp,
    cssNum,
    ms,
    msToSpd,
    num,
    spdToMs
} from "./math.ts";
import { applyTextShadowScale } from "./textDistortion.ts";

let defPrefs: Prefs | null = null;

function readCss(): Prefs {
    const rootStyle = window.getComputedStyle(document.documentElement);
    const body = document.body;

    return {
        phosphorEnabled: !body.classList.contains("effect-disable-phosphor"),
        phosphorOpacity: clamp(
            num(rootStyle.getPropertyValue("--effect-crt-phosphor-opacity"), 0.048),
            PHOS_OP_MIN,
            PHOS_OP_MAX
        ),
        scanlinesEnabled: !body.classList.contains("effect-disable-scanlines"),
        scanlineOpacity: clamp(
            num(rootStyle.getPropertyValue("--effect-crt-scanline-opacity"), 0.09),
            SCAN_OP_MIN,
            SCAN_OP_MAX
        ),
        scanlineSpeed: DEF_SCAN_SPD,
        textShadowEnabled: !body.classList.contains("effect-disable-text-shadow"),
        textShadowIntensity: clamp(
            num(
                rootStyle.getPropertyValue("--effect-crt-text-shadow-intensity"),
                TEXT_SHADOW_DEFAULT_PERCENT
            ),
            TEXT_SHADOW_MIN,
            TEXT_SHADOW_MAX
        )
    };
}

/**
 * Memoised defaults getter.
 * @returns {Prefs}
 */
export function defs(): Prefs {
    if (defPrefs) return defPrefs;
    defPrefs = readCss();
    return defPrefs;
}

/**
 * Reads saved prefs from storage if they look sane enough.
 * @returns {StoredPrefs | null}
 */
function stored(): StoredPrefs | null {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

        const record = parsed as Record<string, unknown>;

        return {
            phosphorEnabled:
                typeof record.phosphorEnabled === "boolean" ? record.phosphorEnabled : undefined,
            phosphorOpacity:
                typeof record.phosphorOpacity === "number" ? record.phosphorOpacity : undefined,
            scanlinesEnabled:
                typeof record.scanlinesEnabled === "boolean" ? record.scanlinesEnabled : undefined,
            scanlineOpacity:
                typeof record.scanlineOpacity === "number" ? record.scanlineOpacity : undefined,
            scanlineSpeed:
                typeof record.scanlineSpeed === "number" ? record.scanlineSpeed : undefined,
            textShadowEnabled:
                typeof record.textShadowEnabled === "boolean" ? record.textShadowEnabled : undefined,
            textShadowIntensity:
                typeof record.textShadowIntensity === "number"
                    ? record.textShadowIntensity
                    : undefined
        };
    } catch {
        return null;
    }
}

/**
 * Merges stored prefs over base prefs, with clamping and the enable/opacity coupling.
 * bit fiddly but its fine.
 * @param {Prefs} base
 * @param {StoredPrefs | null} fromStore
 * @returns {Prefs}
 */
function merge(base: Prefs, fromStore: StoredPrefs | null): Prefs {
    if (!fromStore) return base;

    const phosphorOpacity = clamp(
        fromStore.phosphorOpacity ?? base.phosphorOpacity,
        PHOS_OP_MIN,
        PHOS_OP_MAX
    );
    const scanlineOpacity = clamp(
        fromStore.scanlineOpacity ?? base.scanlineOpacity,
        SCAN_OP_MIN,
        SCAN_OP_MAX
    );
    const scanlineSpeed = clamp(
        fromStore.scanlineSpeed ?? base.scanlineSpeed,
        SCAN_SPD_MIN,
        SCAN_SPD_MAX
    );
    const textShadowIntensity = clamp(
        fromStore.textShadowIntensity ?? base.textShadowIntensity,
        TEXT_SHADOW_MIN,
        TEXT_SHADOW_MAX
    );
    const textShadowEnabled =
        textShadowIntensity > 0 &&
        (fromStore.textShadowEnabled ?? base.textShadowEnabled);

    return {
        phosphorEnabled: phosphorOpacity > 0 && (fromStore.phosphorEnabled ?? base.phosphorEnabled),
        phosphorOpacity,
        scanlinesEnabled: scanlineOpacity > 0 && (fromStore.scanlinesEnabled ?? base.scanlinesEnabled),
        scanlineOpacity,
        scanlineSpeed,
        textShadowEnabled,
        textShadowIntensity
    };
}

/**
 * Reads whats currently live in the DOM right now.
 * @returns {Prefs}
 */
export function live(): Prefs {
    const rootStyle = window.getComputedStyle(document.documentElement);
    const body = document.body;
    const base = defs();

    const phosphorOpacity = clamp(
        num(
            rootStyle.getPropertyValue("--effect-crt-phosphor-opacity"),
            base.phosphorOpacity
        ),
        PHOS_OP_MIN,
        PHOS_OP_MAX
    );

    const scanlineOpacity = clamp(
        num(
            rootStyle.getPropertyValue("--effect-crt-scanline-opacity"),
            base.scanlineOpacity
        ),
        SCAN_OP_MIN,
        SCAN_OP_MAX
    );

    const scanlineSpeed = body.classList.contains("effect-static-scanlines")
        ? 0
        : msToSpd(
            num(
                rootStyle.getPropertyValue("--effect-crt-scanline-travel-duration"),
                spdToMs(base.scanlineSpeed)
            )
        );

    const textShadowIntensity = clamp(
        num(
            rootStyle.getPropertyValue("--effect-crt-text-shadow-intensity"),
            base.textShadowIntensity
        ),
        TEXT_SHADOW_MIN,
        TEXT_SHADOW_MAX
    );
    const textShadowEnabled =
        textShadowIntensity > 0 &&
        !body.classList.contains("effect-disable-text-shadow");

    return {
        phosphorEnabled: phosphorOpacity > 0 && !body.classList.contains("effect-disable-phosphor"),
        scanlinesEnabled: scanlineOpacity > 0 && !body.classList.contains("effect-disable-scanlines"),
        phosphorOpacity,
        scanlineOpacity,
        scanlineSpeed,
        textShadowEnabled,
        textShadowIntensity
    };
}

/**
 * Defaults + stored prefs.
 * @returns {Prefs}
 */
export function resolved(): Prefs {
    return merge(defs(), stored());
}

/**
 * Saves prefs to localStorage.
 * @param {Prefs} prefs
 * @returns {void}
 */
function save(prefs: Prefs): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

/**
 * Applies prefs into css vars and body classes and the whole lot.
 * @param {Prefs} prefs
 * @returns {void}
 */
export function apply(prefs: Prefs): void {
    document.documentElement.style.setProperty(
        "--effect-crt-phosphor-opacity",
        cssNum(prefs.phosphorOpacity)
    );
    document.documentElement.style.setProperty(
        "--effect-crt-scanline-opacity",
        cssNum(prefs.scanlineOpacity)
    );
    document.documentElement.style.setProperty(
        "--effect-crt-scanline-travel-duration",
        ms(spdToMs(prefs.scanlineSpeed))
    );

    const textShadowIntensity = clamp(
        prefs.textShadowIntensity,
        TEXT_SHADOW_MIN,
        TEXT_SHADOW_MAX
    );

    document.documentElement.style.setProperty(
        "--effect-crt-text-shadow-intensity",
        cssNum(textShadowIntensity)
    );
    applyTextShadowScale(textShadowIntensity);

    document.body.classList.toggle(
        "effect-disable-phosphor",
        !prefs.phosphorEnabled || prefs.phosphorOpacity <= 0
    );
    document.body.classList.toggle(
        "effect-disable-scanlines",
        !prefs.scanlinesEnabled || prefs.scanlineOpacity <= 0
    );
    document.body.classList.toggle("effect-static-scanlines", prefs.scanlineSpeed <= 0);
    document.body.classList.toggle(
        "effect-disable-text-shadow",
        !prefs.textShadowEnabled || textShadowIntensity <= 0
    );
}

/**
 * Save then apply. tiny wrapper but keeps the call sites nicer.
 * @param {Prefs} prefs
 * @returns {void}
 */
export function commit(prefs: Prefs): void {
    save(prefs);
    apply(prefs);
}


