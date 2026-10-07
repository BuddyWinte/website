export function nextFrame(): Promise<void> {
    return new Promise<void>((resolve) => {
        const done = (): void => resolve();
        window.requestAnimationFrame(done);
    });
}

export function wait(delayMS: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const done = (): void => resolve();
        window.setTimeout(done, delayMS);
    });
}
