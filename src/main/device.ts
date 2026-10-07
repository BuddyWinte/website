import * as loader from "../loader.ts";

const params = new URLSearchParams(window.location.search);

async function ensureMobileDetect(): Promise<void> {
    const current =
        (window as unknown as { MobileDetect?: unknown }).MobileDetect;

    if (typeof current !== "undefined") return;

    const sources = [
        "https://kittycrow.dev/external?src=https://cdn.jsdelivr.net/npm/mobile-detect@1.4.5/mobile-detect.js",
        "https://cdn.jsdelivr.net/npm/mobile-detect@1.4.5/mobile-detect.js"
    ];

    for (const src of sources) {
        try {
            await loader.loadScript(src, { asModule: false });
        } catch {
            // Try the next source.
        }

        if (typeof window.MobileDetect !== "undefined") return;
    }
}

async function detectMobile(): Promise<boolean> {
    await ensureMobileDetect();

    const ua = navigator.userAgent;
    const MD = (
        window as unknown as {
            MobileDetect?: new (
                ua: string
            ) => { mobile: () => string | null };
        }
    ).MobileDetect;

    const mdHit = MD ? !!new MD(ua).mobile() : false;
    const touch = navigator.maxTouchPoints > 0;
    const desktop =
        /\b(Windows NT|Macintosh|X11|Linux x86_64)\b/.test(ua) &&
        !touch;

    return mdHit || !desktop;
}

export async function getIsMobile(): Promise<boolean> {
    const override = params.get("isMobile");
    if (override !== null) return override === "true";
    return detectMobile();
}

export function setMobileScale(isMobile: boolean): void {
    const root = document.documentElement;
    root.style.setProperty("--kc-text-scale", isMobile ? "0.65" : "1");
    root.classList.toggle("kc-mobile", isMobile);
}
