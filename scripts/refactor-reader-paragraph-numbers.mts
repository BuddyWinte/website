import { readFile, writeFile } from "node:fs/promises";

const path = "src/reader/controller.tsx";
let source = await readFile(path, "utf8");

const viewImport = `import {
    ImgNav,
    InfoModal,
    LangTipModal,
    MissingCh,
    ReaderCtrls,
    ReaderModeTipModal,
    setButtonIcon
} from "./views.tsx";
`;

if (!source.includes(viewImport)) {
    throw new Error("Reader view import anchor missing.");
}

source = source.replace(
    viewImport,
    viewImport +
    `import {
    getRCookie,
    initPNumCookie,
    refreshPNum,
    setRCookie,
    togglePNum
} from "./paragraphNumbers.ts";
`
);

for (const line of [
    'const READER_PARA_NUMS_COOKIE = "showParagraphNumbers";\n',
    'const READER_PARA_NUMS_CLASS = "reader-show-paragraph-numbers";\n',
    'const PNUM_TOGGLE_SELECTOR = ".btn-toggle-paragraph-numbers";\n'
]) {
    source = source.replace(line, "");
}

const startMarker = "// Reader-specific cookie helpers to avoid collision with main.js";
const endMarker = "/**\n * @param {Document} doc\n * @param {readonly string[]} aliases";

const start = source.indexOf(startMarker);
if (start < 0) {
    throw new Error("Reader paragraph-numbering start marker missing.");
}

const end = source.indexOf(endMarker, start);
if (end < 0) {
    throw new Error("Reader paragraph-numbering end marker missing.");
}

source = source.slice(0, start) + source.slice(end);

await writeFile(path, source, "utf8");
console.log("[refactor-reader] extracted paragraph numbering and reader cookies.");
