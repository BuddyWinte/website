export type CtrWinStateArg = Readonly<{
    storeKey: string;
    width: number;
    height: number;
    force?: boolean;
}>;

export function ensCtrWinState(arg: CtrWinStateArg): void {
    const { storeKey, width, height, force = false } = arg;

    try {
        const existing = force
            ? null
            : window.localStorage.getItem(storeKey);

        if (existing !== null) return;

        const left = Math.max(
            0,
            Math.round((window.innerWidth - width) / 2)
        );
        const top = Math.max(
            0,
            Math.round((window.innerHeight - height) / 2)
        );

        const x = String(left) + "px";
        const y = String(top) + "px";
        const w = String(width) + "px";
        const h = String(height) + "px";

        window.localStorage.setItem(
            storeKey,
            JSON.stringify({
                floating: true,
                minimised: false,
                closed: false,
                maximised: false,
                x,
                y,
                width: w,
                height: h,
                launcherX: x,
                launcherY: y,
                restoreX: "",
                restoreY: "",
                restoreWidth: "",
                restoreHeight: "",
                restoreFloating: false
            })
        );
    } catch {
        // Storage can be unavailable or blocked.
    }
}
