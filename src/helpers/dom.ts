export async function waitForDomReady(): Promise<void> {
    if (
        document.readyState === "interactive" ||
        document.readyState === "complete"
    ) return;

    await new Promise<void>((resolve) => {
        const done = (): void => resolve();
        document.addEventListener("DOMContentLoaded", done, { once: true });
    });
}

export function getEl(id: string): HTMLElement | null {
    const el = document.getElementById(id);
    return el instanceof HTMLElement ? el : null;
}
