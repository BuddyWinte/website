import { transpileCodeSource } from "../transpiler.ts";
import {
    getCodeLang,
    normCodeLangKey
} from "./codeLanguage.ts";
import {
    CODE_DIRECTIVE_COMMENT_PREFIX,
    getExternalCodeDirective
} from "./markdown.ts";
import type { ExternalCodeDirective } from "./types.ts";

export type ExternalCodeHooks = Readonly<{
    getPreCode: (pre: HTMLPreElement) => HTMLElement | null;
    highlightCode: (code: HTMLElement) => void;
    updateCodeBar: (
        frame: HTMLDivElement,
        code: HTMLElement
    ) => void;
    queueCodeGroupLayout: (frame: HTMLDivElement) => void;
    queuePostHeight: (post: HTMLElement) => void;
}>;

const sourceCache = new Map<string, Promise<string>>();

function fetchExternalCodeSource(
    sourceUrl: string
): Promise<string> {
    const cached = sourceCache.get(sourceUrl);
    if (cached) return cached;

    const request = fetch(sourceUrl).then(async (response) => {
        if (!response.ok) {
            throw new Error(
                "External code fetch failed: " +
                String(response.status) +
                " " +
                response.statusText
            );
        }

        return response.text();
    });

    sourceCache.set(sourceUrl, request);
    return request;
}

function resetCodeHighlight(code: HTMLElement): void {
    delete code.dataset.rssHighlighted;
    code.removeAttribute("data-highlighted");
}

function syncExternalCodeLayout(
    post: HTMLElement,
    code: HTMLElement,
    hooks: ExternalCodeHooks
): void {
    const frame = code.closest(".rss-code-frame");

    if (!(frame instanceof HTMLDivElement)) {
        hooks.queuePostHeight(post);
        return;
    }

    hooks.updateCodeBar(frame, code);

    const groupedActive =
        frame.dataset.rssCodeGroup === "1" &&
        code.closest(".rss-code-variant.is-active") !== null;

    if (groupedActive) {
        const lang = getCodeLang(code);
        frame.dataset.language = lang;
        frame.dataset.rssCodeActiveLang =
            normCodeLangKey(lang);
        hooks.queueCodeGroupLayout(frame);
    }

    hooks.queuePostHeight(post);
}

function setExternalCodeText(
    post: HTMLElement,
    code: HTMLElement,
    text: string,
    hooks: ExternalCodeHooks
): void {
    code.textContent = text;
    resetCodeHighlight(code);
    hooks.highlightCode(code);
    syncExternalCodeLayout(post, code, hooks);
}

function setExternalCodeError(
    post: HTMLElement,
    code: HTMLElement,
    directive: ExternalCodeDirective,
    error: unknown,
    hooks: ExternalCodeHooks
): void {
    const message = error instanceof Error
        ? error.message
        : String(error);

    setExternalCodeText(
        post,
        code,
        [
            "// Could not load external code from: " +
                directive.sourceUrl,
            "",
            "// " + message
        ].join("\n"),
        hooks
    );
}

async function resolveExternalCodeText(
    directive: ExternalCodeDirective
): Promise<string> {
    const source = await fetchExternalCodeSource(
        directive.sourceUrl
    );

    if (!directive.transFrom) return source;

    return transpileCodeSource(
        source,
        directive.transFrom
    );
}

function nextElementAfterComment(
    comment: Comment
): Element | null {
    let node: ChildNode | null = comment.nextSibling;

    while (node) {
        if (node instanceof Element) return node;

        const meaningfulText =
            node.nodeType === Node.TEXT_NODE &&
            (node.textContent ?? "").trim().length > 0;

        if (meaningfulText) return null;
        node = node.nextSibling;
    }

    return null;
}

function getDirectivePre(
    comment: Comment
): HTMLPreElement | null {
    const element = nextElementAfterComment(comment);

    if (element instanceof HTMLPreElement) {
        return element;
    }

    const pre = element?.querySelector("pre");
    return pre instanceof HTMLPreElement ? pre : null;
}

function wireExternalCodeComment(
    post: HTMLElement,
    comment: Comment,
    hooks: ExternalCodeHooks
): void {
    const raw = comment.data.trim();

    if (!raw.startsWith(CODE_DIRECTIVE_COMMENT_PREFIX)) {
        return;
    }

    const id = raw
        .slice(CODE_DIRECTIVE_COMMENT_PREFIX.length)
        .trim();

    const directive = getExternalCodeDirective(id);
    const pre = getDirectivePre(comment);
    const code = pre ? hooks.getPreCode(pre) : null;

    if (!directive || !code) return;
    if (code.dataset.rssExternalCodeWired === "1") return;

    code.dataset.rssExternalCodeWired = "1";
    code.dataset.rssExternalCodeId = directive.id;
    code.dataset.rssExternalCodeSrc = directive.sourceUrl;

    void resolveExternalCodeText(directive)
        .then((text) => {
            setExternalCodeText(
                post,
                code,
                text,
                hooks
            );
        })
        .catch((error: unknown) => {
            console.warn(
                "External RSS code source failed:",
                error
            );

            setExternalCodeError(
                post,
                code,
                directive,
                error,
                hooks
            );
        });
}

export function wireExternalCodeBlocks(
    post: HTMLElement,
    hooks: ExternalCodeHooks
): void {
    const walker = document.createTreeWalker(
        post,
        NodeFilter.SHOW_COMMENT
    );

    let node = walker.nextNode();

    while (node) {
        if (node instanceof Comment) {
            wireExternalCodeComment(post, node, hooks);
        }

        node = walker.nextNode();
    }
}
