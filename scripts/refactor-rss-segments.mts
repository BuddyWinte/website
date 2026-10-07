import { readFile, writeFile } from "node:fs/promises";

const path = "src/rss.tsx";
let source = await readFile(path, "utf8");

function insertAfter(anchor: string, addition: string): void {
    if (!source.includes(anchor)) {
        throw new Error("RSS segment anchor missing: " + anchor);
    }

    source = source.replace(anchor, anchor + addition);
}

function replaceRange(
    startMarker: string,
    endMarker: string
): void {
    const start = source.indexOf(startMarker);

    if (start < 0) {
        throw new Error(
            "RSS segment start marker missing: " +
            startMarker
        );
    }

    const end = source.indexOf(endMarker, start);

    if (end < 0) {
        throw new Error(
            "RSS segment end marker missing: " +
            endMarker
        );
    }

    source =
        source.slice(0, start) +
        source.slice(end);
}

insertAfter(
    'import { wireExternalCodeBlocks } from "./rss/externalCode.ts";\n',
    `import {
    applSegShares,
    moveCodeSegShareToFrame
} from "./rss/segments.ts";
`
);

source = source.replace(
    'const RSS_SEG_ID_PREFIX = "rss-s-";\n',
    ""
);

replaceRange(
    "/**\n * Hashes a segment fingerprint into a short stable id suffix.",
    "/**\n * Prepares and renders RSS markdown."
);

await writeFile(path, source, "utf8");
console.log("[refactor-rss] extracted segment markup.");
