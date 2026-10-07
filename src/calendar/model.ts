import type { CalSel } from "./types.ts";

/**
 * Just the month nums, nice and boring.
 * @returns {readonly number[]}
 */
export function mos(): readonly number[] {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

/**
 * Weekday labels for the cal grid.
 * @returns {readonly string[]}
 */
export function wk(): readonly string[] {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
}

/**
 * Small Set helper so i stop typing the generic every time.
 * @param {Iterable<number>} src
 * @returns {Set<number>}
 */
export function setOf(src: Iterable<number>): Set<number> {
    return new Set<number>(src);
}

/**
 * Makes the selection object from plain iterables and stuff.
 * @param {Iterable<number>} yrs
 * @param {Iterable<number>} mos
 * @param {Iterable<number>} dys
 * @returns {CalSel}
 */
export function selOf(
    yrs: Iterable<number>,
    mos: Iterable<number>,
    dys: Iterable<number>
): CalSel {
    return {
        yrs: new Set<number>(yrs),
        mos: new Set<number>(mos),
        dys: new Set<number>(dys)
    };
}

/**
 * Unique years, newest first.
 * @param {readonly number[]} src
 * @returns {number[]}
 */
export function ordYrs(src: readonly number[]): number[] {
    return Array.from(new Set<number>(src)).sort((a, b) => b - a);
}

/**
 * Unique nums, low to high.
 * @param {readonly number[]} src
 * @returns {number[]}
 */
export function ordNums(src: readonly number[]): number[] {
    return Array.from(new Set<number>(src)).sort((a, b) => a - b);
}

/**
 * Short month label.
 * @param {number} mo
 * @returns {string}
 */
export function moLbl(mo: number): string {
    return new Date(2000, mo - 1, 1).toLocaleString("en-GB", { month: "short" });
}

/**
 * Full month title with year.
 * @param {number} yr
 * @param {number} mo
 * @returns {string}
 */
export function moTtl(yr: number, mo: number): string {
    return new Date(yr, mo - 1, 1).toLocaleString("en-GB", {
        month: "long",
        year: "numeric"
    });
}

/**
 * Days in the month.
 * @param {number} yr
 * @param {number} mo
 * @returns {number}
 */
export function dyCnt(yr: number, mo: number): number {
    return new Date(yr, mo, 0).getDate();
}

/**
 * Weekday index of the first day.
 * @param {number} yr
 * @param {number} mo
 * @returns {number}
 */
export function fstWk(yr: number, mo: number): number {
    return new Date(yr, mo - 1, 1).getDay();
}

/**
 * Readonly-ish copy of a Set.
 * @param {Set<number>} src
 * @returns {ReadonlySet<number>}
 */
export function ro(src: Set<number>): ReadonlySet<number> {
    return new Set<number>(src);
}

/**
 * Any active sel at all.
 * @param {CalSel} sel
 * @returns {boolean}
 */
export function anySel(sel: CalSel): boolean {
    return sel.yrs.size > 0 || sel.mos.size > 0 || sel.dys.size > 0;
}

/**
 * The wee icon in the roundy buttons.
 * @param {Readonly<{ open: boolean }>} props
 * @returns {JSX.Element}
 */
