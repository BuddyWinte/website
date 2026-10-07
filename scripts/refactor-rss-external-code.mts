import { readFile, writeFile } from "node:fs/promises";

const path = "src/rss.tsx";
let source = await readFile(path, "utf8");

function insertAfter(anchor: string, addition: string): void {
    if (!source.includes(anchor)) {
        throw new Error("RSS external-code anchor missing: " + anchor);
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
        throw new Error(
            "RSS external-code start marker missing: " +
            startMarker
        );
    }

    const end = source.indexOf(endMarker, start);

    if (end < 0) {
        throw new Error(
            "RSS external-code end marker missing: " +
            endMarker
        );
    }

    source =
        source.slice(0, start) +
        replacement +
        source.slice(end);
}

source = source.replace(
    'import { transpileCodeSource } from "./transpiler.ts";\n',
    ""
);

insertAfter(
    `} from "./rss/markdown.ts";\n`,
    `import { wireExternalCodeBlocks } from "./rss/externalCode.ts";
`
);

for (const line of [
    '    ExternalCodeDirective,\n',
    'let rssCodeSourceCache = new Map<string, Promise<string>>();\n'
]) {
    source = source.replace(line, "");
}

replaceRange(
    "/**\n * Fetches source code with a tiny in-page cache.",
    "/**\n * Checks a parsed value is a simple string map.",
    ""
);

source = source.replace(
    "    wireExternalCodeBlocks(pstDiv);",
    `    wireExternalCodeBlocks(pstDiv, {
        getPreCode,
        highlightCode: hglCode,
        updateCodeBar: updCodeBar,
        queueCodeGroupLayout: qCodeGroupLayout,
        queuePostHeight: qPstHgt
    });`
);

await writeFile(path, source, "utf8");
console.log("[refactor-rss] extracted external-code loading and wiring.");
