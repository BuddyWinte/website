import { SHIFT_MAP } from "./constants.ts";
import type { Mods } from "./types.ts";

export function xtermModifier(mods: Mods): number {
    return (
        1 +
        (mods.shift ? 1 : 0) +
        (mods.alt ? 2 : 0) +
        (mods.ctrl ? 4 : 0) +
        (mods.meta ? 8 : 0)
    );
}

export function controlCharacter(ch: string): string {
    if (ch === " ") return "\x00";

    const code = ch.length ? ch.charCodeAt(0) : 0;

    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        const upper = code >= 97 ? code - 32 : code;
        return String.fromCharCode(upper - 64);
    }

    if (ch === "@") return "\x00";
    if (ch === "[") return "\x1b";
    if (ch === "\\") return "\x1c";
    if (ch === "]") return "\x1d";
    if (ch === "^") return "\x1e";
    if (ch === "_") return "\x1f";
    if (ch === "?") return "\x7f";

    return "";
}

export function shiftCharacter(ch: string): string {
    if (ch.length !== 1) return ch;

    const code = ch.charCodeAt(0);
    if (code >= 97 && code <= 122) {
        return String.fromCharCode(code - 32);
    }

    return SHIFT_MAP[ch] || ch;
}

function withMetaPrefixes(sequence: string, mods: Mods): string {
    const altPrefix = mods.alt ? "\x1b" : "";
    const metaPrefix = mods.meta ? "\x1b" : "";
    return metaPrefix + altPrefix + sequence;
}

function functionKeySequence(key: string, mods: Mods): string {
    const number = Number.parseInt(key.slice(1), 10);
    const modifier = xtermModifier(mods);
    const plain = modifier === 1;

    const shortCode =
        number >= 1 && number <= 4
            ? ["P", "Q", "R", "S"][number - 1] ?? ""
            : "";

    if (shortCode) {
        return plain
            ? "\x1bO" + shortCode
            : "\x1b[1;" + String(modifier) + shortCode;
    }

    const baseMap: Readonly<Record<number, number>> = {
        5: 15,
        6: 17,
        7: 18,
        8: 19,
        9: 20,
        10: 21,
        11: 23,
        12: 24
    };

    const base = baseMap[number];
    if (!base) return "";

    return plain
        ? "\x1b[" + String(base) + "~"
        : "\x1b[" + String(base) + ";" + String(modifier) + "~";
}

function characterSequence(key: string, mods: Mods): string {
    const shifted =
        mods.shift && !mods.ctrl
            ? shiftCharacter(key)
            : key;

    const controlled =
        mods.ctrl
            ? controlCharacter(shifted)
            : shifted;

    if (mods.ctrl && !controlled) return "";

    return withMetaPrefixes(controlled, mods);
}

export function buildKeySequence(key: string, mods: Mods): string {
    const resolvedKey =
        mods.fn && key === "Backspace"
            ? "Delete"
            : key;

    if (resolvedKey === "Escape") return "\x1b";
    if (resolvedKey === "Enter") {
        return withMetaPrefixes("\r", mods);
    }
    if (resolvedKey === "Backspace") return "\x7f";

    if (resolvedKey === "Delete") {
        const modifier = xtermModifier(mods);
        return modifier === 1
            ? "\x1b[3~"
            : "\x1b[3;" + String(modifier) + "~";
    }

    if (resolvedKey === "Tab" && mods.ctrl) return "";
    if (resolvedKey === "Tab") {
        const base = mods.shift ? "\x1b[Z" : "\t";
        return withMetaPrefixes(base, mods);
    }

    const isFunctionKey = /^F(1[0-2]|[1-9])$/.test(resolvedKey);
    if (isFunctionKey) return functionKeySequence(resolvedKey, mods);

    const modifier = xtermModifier(mods);
    const plain = modifier === 1;

    if (resolvedKey === "ArrowUp") {
        return plain ? "\x1b[A" : "\x1b[1;" + String(modifier) + "A";
    }
    if (resolvedKey === "ArrowDown") {
        return plain ? "\x1b[B" : "\x1b[1;" + String(modifier) + "B";
    }
    if (resolvedKey === "ArrowRight") {
        return plain ? "\x1b[C" : "\x1b[1;" + String(modifier) + "C";
    }
    if (resolvedKey === "ArrowLeft") {
        return plain ? "\x1b[D" : "\x1b[1;" + String(modifier) + "D";
    }

    if (resolvedKey.length === 1) {
        return characterSequence(resolvedKey, mods);
    }

    return "";
}
