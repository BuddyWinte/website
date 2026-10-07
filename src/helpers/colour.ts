export function getHSL(
    hue: number,
    sat: number = 80,
    light: number = 60
): string {
    return "hsl(" +
        String(hue % 360) +
        ", " +
        String(sat) +
        "%, " +
        String(light) +
        "%)";
}
