// One-shot validated CRT UI extraction for the refactor branch.
import { readFile, writeFile } from "node:fs/promises";

const path = "src/crtUi.tsx";
let source = await readFile(path, "utf8");

function insertAfter(anchor: string, addition: string): void {
    if (!source.includes(anchor)) {
        throw new Error("CRT UI migration anchor missing: " + anchor);
    }

    source = source.replace(anchor, anchor + addition);
}

function replaceRange(
    startMarker: string,
    endMarker: string,
    replacement: string
): void {
    const start = source.indexOf(startMarker);
    if (start < 0) {
        throw new Error("CRT UI start marker missing: " + startMarker);
    }

    const end = source.indexOf(endMarker, start);
    if (end < 0) {
        throw new Error("CRT UI end marker missing: " + endMarker);
    }

    source =
        source.slice(0, start) +
        replacement +
        source.slice(end);
}

source = source
    .replace('import type { MainJson } from "./uiFetch.ts";\n', "")
    .replace('import type { MainJson } from \'./uiFetch.ts\';\n', "")
    .replace('import { fetchUiData } from "./uiFetch.ts";\n', "")
    .replace('import { fetchUiData } from \'./uiFetch.ts\';\n', "");

insertAfter(
    "import * as helpers from './helpers.ts';\n",
    `import { ensureCfg, getCfg } from "./crtUi/config.ts";
import {
    BASE_FREQ_NOTCH_HZ,
    DEF_WIN_H,
    DEF_WIN_W,
    GAIN_NOTCH,
    LD_CONTENT_ID,
    LD_NOTICE_ID,
    LD_STAGE_ID,
    MOD_ID,
    WIN_STORE_KEY
} from "./crtUi/constants.ts";
import {
    clrLdSize,
    ensureLdCss,
    setFrameMinH,
    setLdReady,
    setLdSize
} from "./crtUi/loading.ts";
import type { Cfg, Ctx, Els, PlotKind, Rt } from "./crtUi/types.ts";
`
);

replaceRange(
    "type PlotKind = plot.PlotType;",
    "let mod: Modal | null = null;",
    ""
);

source = source
    .replace("let cfg: Cfg | null = null;\n", "")
    .replace("let cfgP: Promise<Cfg> | null = null;\n", "");

replaceRange(
    "/**\n * Tiny object check so config parsing does not fall over later.",
    "/**\n * Number formatter for the little readouts and whatnot.",
    ""
);

await writeFile(path, source, "utf8");
console.log("[refactor-crt-ui] extracted config, constants, loading and types.");
