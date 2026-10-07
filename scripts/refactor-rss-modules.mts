import { readFile, writeFile } from "node:fs/promises";

const path = "src/rss.tsx";
let source = await readFile(path, "utf8");

function insertAfter(anchor: string, addition: string): void {
    if (!source.includes(anchor)) {
        throw new Error("RSS migration anchor missing: " + anchor);
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
        throw new Error("RSS migration start marker missing: " + startMarker);
    }

    const end = source.indexOf(endMarker, start);
    if (end < 0) {
        throw new Error("RSS migration end marker missing: " + endMarker);
    }

    source =
        source.slice(0, start) +
        replacement +
        source.slice(end);
}

insertAfter(
    'import { transpileCodeSource } from "./transpiler.ts";\n',
    `import {
    findByPstRef,
    fmtDt,
    getReqJumpId,
    getReqPstRef,
    mkPstDomRef,
    mkPstSegShareUrl,
    mkPstShareUrl,
    mkPstShortId,
    mkPstSlug,
    mkPsts,
    mkPstsRefs,
    mkPstsSel,
    prsRss
} from "./rss/postModel.ts";
import {
    isBlogPth,
    isDirectRssPth,
    isResourcePth,
    pstsForCurPage
} from "./rss/routing.ts";
`
);

replaceRange(
    "type HljsApi = Readonly<{",
    'const RSS_SEG_ID_PREFIX = "rss-s-";',
    `import type {
    AthFilterCfg,
    AthMenuRs,
    AthOpt,
    CodeGroupActiveOptions,
    CodeTranspileLang,
    CodeVariant,
    ExternalCodeDirective,
    ExternalCodeSpec,
    FiltRs,
    FiltSumKnd,
    FiltSumPill,
    HljsApi,
    PillSnap,
    Pst,
    RssItm,
    SegPoint,
    SegRevealReq,
    SegTapSnap,
    WrapRs
} from "./rss/types.ts";

declare const hljs: HljsApi | undefined;

`
);

replaceRange(
    "/**\n * blog page maybe.",
    "/**\n * Existing selected date state.",
    ""
);

replaceRange(
    "/**\n * Pulls txt from an rss child.",
    "/**\n * Waits for the next layout frame.",
    ""
);

await writeFile(path, source, "utf8");
console.log("[refactor-rss] extracted types, routing and post model.");
