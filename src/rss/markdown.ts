import type {
    CodeTranspileLang,
    ExternalCodeDirective,
    ExternalCodeSpec
} from "./types.ts";
import { normTranspileLang } from "./codeLanguage.ts";

const CODE_DIRECTIVE_RE =
    /^[ \t]*@code\[([^\]\r\n]+)\]\(([^)\r\n]+)\)[ \t]*$/gm;
export const CODE_DIRECTIVE_COMMENT_PREFIX = "rss-code-source:";
const BLOCKQUOTE_ACCENT_RE =
    /^([ \t]{0,3})(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))>[ \t]?/;
const BLOCKQUOTE_ACCENT_COMMENT_PREFIX = "rss-blockquote-accent:";
const MARKDOWN_FENCE_RE = /^[ \t]{0,3}(?:```|~~~)/;

let directiveIndex = 0;
const directives = new Map<string, ExternalCodeDirective>();

function cleanDirectiveLang(raw: string): string {
    const clean = raw.trim();
    return /^[a-z0-9_#+.-]+$/i.test(clean) ? clean : "text";
}

function parseExternalCodeSpec(
    rawSpec: string
): ExternalCodeSpec | null {
    const parts = rawSpec
        .trim()
        .split(/\s+/)
        .filter((part) => part.length > 0);

    const rawLang = parts[0];
    if (!rawLang) return null;

    let transFrom: CodeTranspileLang | null = null;

    for (const part of parts.slice(1)) {
        const [rawKey, rawValue] = part.split("=");
        const key = rawKey?.trim().toLowerCase() ?? "";
        const value = rawValue?.trim() ?? "";

        if (key !== "trans" || value.length === 0) continue;
        transFrom = normTranspileLang(value);
    }

    return {
        lang: cleanDirectiveLang(rawLang),
        transFrom
    };
}

function normExternalCodeUrl(raw: string): string | null {
    try {
        const url = new URL(raw.trim(), window.location.href);

        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }

        return url.toString();
    } catch {
        return null;
    }
}

function mkExternalCodePlaceholder(spec: ExternalCodeSpec): string {
    return spec.transFrom
        ? `//transpiling from ${spec.transFrom} source`
        : "// loading external code";
}

function registerExternalCodeDirective(
    spec: ExternalCodeSpec,
    sourceUrl: string
): ExternalCodeDirective {
    directiveIndex += 1;

    const directive: ExternalCodeDirective = {
        id: `rss-code-${directiveIndex}`,
        lang: spec.lang,
        sourceUrl,
        transFrom: spec.transFrom,
        placeholder: mkExternalCodePlaceholder(spec)
    };

    directives.set(directive.id, directive);
    return directive;
}

function mkExternalCodeFence(
    directive: ExternalCodeDirective
): string {
    return [
        `<!--${CODE_DIRECTIVE_COMMENT_PREFIX}${directive.id}-->`,
        ````${directive.lang}`,
        directive.placeholder,
        "```"
    ].join("\n");
}

function prepareExternalCodeDirectives(markdown: string): string {
    return markdown.replace(
        CODE_DIRECTIVE_RE,
        (
            match: string,
            rawSpec: string,
            rawUrl: string
        ): string => {
            const spec = parseExternalCodeSpec(rawSpec);
            const sourceUrl = normExternalCodeUrl(rawUrl);

            if (!spec || !sourceUrl) return match;

            return mkExternalCodeFence(
                registerExternalCodeDirective(spec, sourceUrl)
            );
        }
    );
}

function normaliseBlockquoteAccent(raw: string): string | null {
    const clean = raw.trim();

    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(clean)
        ? clean.toUpperCase()
        : null;
}

function isMarkdownFenceLine(line: string): boolean {
    return MARKDOWN_FENCE_RE.test(line);
}

function prepareBlockquoteAccents(markdown: string): string {
    let inFence = false;

    return markdown
        .split(/(\r?\n)/)
        .map((line) => {
            if (line === "\n" || line === "\r\n") return line;

            if (isMarkdownFenceLine(line)) {
                inFence = !inFence;
                return line;
            }

            if (inFence) return line;

            return line.replace(
                BLOCKQUOTE_ACCENT_RE,
                (
                    match: string,
                    indent: string,
                    rawColour: string
                ): string => {
                    const colour =
                        normaliseBlockquoteAccent(rawColour);

                    if (!colour) return match;

                    return (
                        indent +
                        "> <!--" +
                        BLOCKQUOTE_ACCENT_COMMENT_PREFIX +
                        colour +
                        "--> "
                    );
                }
            );
        })
        .join("");
}

function readBlockquoteAccent(
    blockquote: HTMLQuoteElement
): string | null {
    const walker = document.createTreeWalker(
        blockquote,
        NodeFilter.SHOW_COMMENT
    );

    let node = walker.nextNode();

    while (node) {
        if (!(node instanceof Comment)) {
            node = walker.nextNode();
            continue;
        }

        const raw = node.data.trim();
        if (!raw.startsWith(BLOCKQUOTE_ACCENT_COMMENT_PREFIX)) {
            node = walker.nextNode();
            continue;
        }

        const colour = normaliseBlockquoteAccent(
            raw.slice(BLOCKQUOTE_ACCENT_COMMENT_PREFIX.length)
        );

        node.remove();
        return colour;
    }

    return null;
}

export function prepareRssMarkdown(markdown: string): string {
    return prepareExternalCodeDirectives(
        prepareBlockquoteAccents(markdown)
    );
}

export function applyBlockquoteAccents(html: string): string {
    const template = document.createElement("template");
    template.innerHTML = html;

    for (
        const blockquote of Array.from(
            template.content.querySelectorAll<HTMLQuoteElement>(
                "blockquote"
            )
        )
    ) {
        const colour = readBlockquoteAccent(blockquote);
        if (!colour) continue;

        blockquote.style.setProperty(
            "--rss-blockquote-brd",
            colour
        );

        blockquote.style.setProperty(
            "--rss-blockquote-shadow",
            "inset 0.65rem 0 1.2rem color-mix(in srgb, " +
            colour +
            " 14%, transparent)"
        );
    }

    return template.innerHTML;
}

export function getExternalCodeDirective(
    id: string
): ExternalCodeDirective | null {
    return directives.get(id) ?? null;
}
