import { readFile, writeFile } from "node:fs/promises";

const path = "src/rss.tsx";
let source = await readFile(path, "utf8");

function insertAfter(anchor: string, addition: string): void {
    if (!source.includes(anchor)) {
        throw new Error("RSS markdown migration anchor missing: " + anchor);
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
        throw new Error("RSS markdown start marker missing: " + startMarker);
    }

    const end = source.indexOf(endMarker, start);
    if (end < 0) {
        throw new Error("RSS markdown end marker missing: " + endMarker);
    }

    source =
        source.slice(0, start) +
        replacement +
        source.slice(end);
}

insertAfter(
    `} from "./rss/routing.ts";\n`,
    `import {
    fmtCodeLang,
    getCodeLang,
    normCodeLangKey
} from "./rss/codeLanguage.ts";
import {
    applyBlockquoteAccents,
    CODE_DIRECTIVE_COMMENT_PREFIX as RSS_CODE_DIRECTIVE_COMMENT_PREFIX,
    getExternalCodeDirective,
    prepareRssMarkdown
} from "./rss/markdown.ts";
`
);

for (const line of [
    '    CodeTranspileLang,\n',
    '    ExternalCodeSpec,\n',
    'const RSS_CODE_DIRECTIVE_RE = /^[ \\t]*@code\\[([^\\]\\r\\n]+)\\]\\(([^)\\r\\n]+)\\)[ \\t]*$/gm;\n',
    'const RSS_CODE_DIRECTIVE_COMMENT_PREFIX = "rss-code-source:";\n',
    'const RSS_BLOCKQUOTE_ACCENT_RE = /^([ \\t]{0,3})(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))>[ \\t]?/;\n',
    'const RSS_BLOCKQUOTE_ACCENT_COMMENT_PREFIX = "rss-blockquote-accent:";\n',
    'const RSS_MARKDOWN_FENCE_RE = /^[ \\t]{0,3}(?:```|~~~)/;\n',
    'let rssCodeDirectiveIx = 0;\n',
    'let rssCodeDirectives = new Map<string, ExternalCodeDirective>();\n'
]) {
    source = source.replace(line, "");
}

replaceRange(
    "/**\n * Normalises equivalent markdown language ids for preference matching.",
    "/**\n * Hashes a segment fingerprint into a short stable id suffix.",
    ""
);

source = source.replace(
    `function rndrRssMD(markdown: string, seed: string): string {
    const prepared = prepExternalCodeDirectives(prepBlQAcc(markdown));
    const html = applBQAcc(marked.parse(prepared));

    return applSegShares(html, seed);
}`,
    `function rndrRssMD(markdown: string, seed: string): string {
    const prepared = prepareRssMarkdown(markdown);
    const html = applyBlockquoteAccents(marked.parse(prepared));

    return applSegShares(html, seed);
}`
);

source = source.replace(
    "const directive = rssCodeDirectives.get(id);",
    "const directive = getExternalCodeDirective(id);"
);

await writeFile(path, source, "utf8");
console.log("[refactor-rss] extracted code-language and markdown preprocessing.");

// retry after markdown module syntax fix
