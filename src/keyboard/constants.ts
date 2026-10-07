import type { DeskPreset } from "./types.ts";

export const SHIFT_MAP: Readonly<Record<string, string>> = {
    "1": "!",
    "2": "@",
    "3": "#",
    "4": "$",
    "5": "%",
    "6": "^",
    "7": "&",
    "8": "*",
    "9": "(",
    "0": ")",
    "-": "_",
    "=": "+",
    "[": "{",
    "]": "}",
    "\\": "|",
    ";": ":",
    "'": "\"",
    ",": "<",
    ".": ">",
    "/": "?",
    "`": "~"
};

export const DESKTOP_PRESETS: readonly DeskPreset[] = [
    { keyW: 44, keyH: 40, btnGap: 8, padX: 12, innerGap: 6, font: 13, icon: 15, radius: 10 },
    { keyW: 42, keyH: 38, btnGap: 7, padX: 11, innerGap: 6, font: 12.5, icon: 14.5, radius: 10 },
    { keyW: 40, keyH: 36, btnGap: 6, padX: 10, innerGap: 5, font: 12, icon: 14, radius: 9 },
    { keyW: 38, keyH: 34, btnGap: 5, padX: 9, innerGap: 5, font: 11.5, icon: 13.5, radius: 9 }
];
