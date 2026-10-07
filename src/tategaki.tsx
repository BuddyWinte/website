import { serialiseMixedContent as serialiseMxCnt } from "./mediaStyler.tsx";
import * as helpers from "./helpers.ts";

/**
 * @param {Node} node
 * @returns {node is Text}
 */
function isTextNode(node: Node): node is Text {
    return node.nodeType === Node.TEXT_NODE;
}

/**
 * @param {Node} node
 * @returns {node is Element}
 */
function isElementNode(node: Node): node is Element {
    return node.nodeType === Node.ELEMENT_NODE;
}

/**
 * @param {Element} element
 * @returns {boolean}
 */
function isPEl(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    return tagName === "paragraph" || tagName === "p";
}

/**
 * @param {string} html
 * @returns {string[]}
 */
function appendTextTokens(text: string, tokens: string[]): void {
    for (const ch of Array.from(text)) {
        if (!ch.trim()) continue;
        tokens.push(ch);
    }
}

function tokeniseLine(html: string): string[] {
    const container = document.createElement("div");
    container.innerHTML = html;

    const tokens: string[] = [];

    container.childNodes.forEach((node) => {
        if (isTextNode(node)) {
            const text = node.textContent || "";

            appendTextTokens(text, tokens);

            return;
        }

        if (isElementNode(node)) {
            tokens.push(node.outerHTML);
        }
    });

    return tokens;
}

/**
 * @param {Document} doc
 * @returns {boolean}
 */
function hasXmlParseError(doc: Document): boolean {
    return doc.getElementsByTagName("parsererror").length > 0;
}

/**
 * @param {Element} paragraph
 * @returns {string}
 */
function getPXmlTag(paragraph: Element): string {
    return paragraph.tagName.toLowerCase() === "p" ? "p" : "paragraph";
}

/**
 * @param {Element} paragraph
 * @returns {string}
 */
function buildParagraphXml(paragraph: Element): string {
    const tagName = getPXmlTag(paragraph);
    const content = serialiseMxCnt(paragraph);

    return `<${tagName}>${content}</${tagName}>`;
}

/**
 * @param {readonly Element[]} paragraphs
 * @returns {string | null}
 */
function bldLegacyTgXml(paragraphs: readonly Element[]): string | null {
    const xmlLines = paragraphs
        .map((paragraph, index) => {
            const tagName = getPXmlTag(paragraph);

            let content = serialiseMxCnt(paragraph);

            if (index === 0) {
                content = content.replace("::tg::", "").trim();
            }

            if (index === paragraphs.length - 1) {
                content = content.replace("::/tg::", "").trim();
            }

            if (!content) return "";

            return `<${tagName}>${content}</${tagName}>`;
        })
        .filter(Boolean)
        .join("");

    if (!xmlLines) return null;

    return `<tategaki>${xmlLines}</tategaki>`;
}

/**
 * @param {Element} tategaki
 * @returns {string | null}
 */
function bldModernTgXml(tategaki: Element): string | null {
    const xmlLines = Array.from(tategaki.children)
        .filter(isPEl)
        .map((paragraph) => buildParagraphXml(paragraph))
        .join("");

    if (!xmlLines) return null;

    return `<tategaki>${xmlLines}</tategaki>`;
}

/**
 * @param {Node} node
 * @returns {string}
 */
function serialiseXmlNd(node: Node): string {
    if (isTextNode(node)) {
        return helpers.escapeHtml(node.textContent || "");
    }

    if (isElementNode(node)) {
        return new XMLSerializer().serializeToString(node);
    }

    return "";
}

/**
 * @param {string} xmlSource
 * @returns {string[][] | null}
 */
function parseTategakiLines(xmlSource: string): string[][] | null {
    const doc = new DOMParser().parseFromString(`<root>${xmlSource}</root>`, "application/xml");

    if (hasXmlParseError(doc)) return null;

    const tategaki = doc.querySelector("tategaki");
    if (!tategaki) return null;

    const rawLines = Array.from(tategaki.children)
        .filter(isPEl)
        .map((paragraph) =>
            Array.from(paragraph.childNodes)
                .map((node) => serialiseXmlNd(node))
                .join("")
                .trim()
        )
        .filter(Boolean)
        .reverse();

    return rawLines.map(tokeniseLine);
}

/**
 * @returns {HTMLElement}
 */
function getReaderRoot(): HTMLElement {
    const readerRoot = document.querySelector(".jp-about");
    return readerRoot instanceof HTMLElement ? readerRoot : document.body;
}

/**
 * @param {readonly string[][]} tokenLines
 * @returns {string}
 */
function buildTategakiSvg(tokenLines: readonly string[][]): string {
    const maxRows =
        tokenLines.length > 0 ? Math.max(...tokenLines.map((line) => line.length)) : 0;

    const readerStyles = getComputedStyle(getReaderRoot());

    const fontSize = parseFloat(readerStyles.fontSize) || 16;
    const charWidth = fontSize + 4;
    const lineHeight = fontSize + 4;
    const lineSpacing = 4;
    const padding = 5;

    const width = (charWidth + lineSpacing) * tokenLines.length + padding * 2;
    const height = lineHeight * maxRows + padding * 2;

    let svgContent = `
        <svg
        xmlns="http://www.w3.org/2000/svg"
        width="${width}"
        height="${height}"
        viewBox="0 0 ${width} ${height}">
    `;

    tokenLines.forEach((tokens, column) => {
        tokens.forEach((token, row) => {
            svgContent += `
            <foreignObject
            x="${column * (charWidth + lineSpacing) + padding}"
            y="${row * lineHeight + padding}"
            width="${charWidth}"
            height="${lineHeight}">
            <div class="tg-token">
                ${token}
            </div>
            </foreignObject>
    `;
        });
    });

    svgContent += `</svg>`;

    return `<div class="tategaki-container">${svgContent}</div>`;
}

/**
 * @param {string} xmlSource
 * @returns {string | null}
 */
function renderTategakiXml(xmlSource: string): string | null {
    const tokenLines = parseTategakiLines(xmlSource);
    if (!tokenLines) return null;

    return buildTategakiSvg(tokenLines);
}

/**
 * @param {string} html
 * @returns {Element | null}
 */
function htmlToElement(html: string): Element | null {
    const template = document.createElement("template");
    template.innerHTML = html.trim();

    const firstChild = template.content.firstElementChild;
    return firstChild instanceof Element ? firstChild : null;
}

/**
 * @param {ParentNode} root
 * @returns {void}
 */
function replaceBlks(root: ParentNode): void {
    const tategakiBlocks = Array.from(root.querySelectorAll("tategaki"));

    tategakiBlocks.forEach((tategaki) => {
        const xmlSource = bldModernTgXml(tategaki);
        if (!xmlSource) return;

        const rendered = renderTategakiXml(xmlSource);
        if (!rendered) return;

        const replacement = htmlToElement(rendered);
        if (!replacement) return;

        tategaki.replaceWith(replacement);
    });
}

/**
 * @param {ParentNode} root
 * @returns {void}
 */
function replaceBlks_legacy(root: ParentNode): void {
    const paragraphs = Array.from(root.querySelectorAll("paragraph, p"));
    let index = 0;

    while (index < paragraphs.length) {
        const startParagraph = paragraphs[index];
        const startContent = serialiseMxCnt(startParagraph);

        if (!startContent.includes("::tg::")) {
            index += 1;
            continue;
        }

        let endIndex = index;

        while (endIndex < paragraphs.length) {
            const currentContent = serialiseMxCnt(paragraphs[endIndex]);
            if (currentContent.includes("::/tg::")) break;
            endIndex += 1;
        }

        if (endIndex >= paragraphs.length) {
            index += 1;
            continue;
        }

        const blockParagraphs = paragraphs.slice(index, endIndex + 1);
        const xmlSource = bldLegacyTgXml(blockParagraphs);

        if (!xmlSource) {
            index = endIndex + 1;
            continue;
        }

        const rendered = renderTategakiXml(xmlSource);
        if (!rendered) {
            index = endIndex + 1;
            continue;
        }

        const replacement = htmlToElement(rendered);
        if (!replacement) {
            index = endIndex + 1;
            continue;
        }

        blockParagraphs[0].replaceWith(replacement);

        for (let removeIndex = 1; removeIndex < blockParagraphs.length; removeIndex += 1) {
            blockParagraphs[removeIndex].remove();
        }

        index = endIndex + 1;
    }
}

/**
 * @param {string} htmlContent
 * @returns {string}
 */
export function replaceTategaki(htmlContent: string): string {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = htmlContent;

    replaceBlks(wrapper);
    replaceBlks_legacy(wrapper);

    return wrapper.innerHTML;
}

/**
 * @param {Element} element
 * @returns {boolean}
 */
function isXmlPEl(element: Element): boolean {
    const tagName = element.tagName.toLowerCase();
    return tagName === "paragraph" || tagName === "w:p";
}

/**
 * @param {Element} element
 * @param {string} ancestorTagName
 * @returns {boolean}
 */
function hasAncestorTag(element: Element, ancestorTagName: string): boolean {
    let current = element.parentElement;

    while (current) {
        if (current.tagName.toLowerCase() === ancestorTagName) return true;
        current = current.parentElement;
    }

    return false;
}

/**
 * @param {Element} element
 * @returns {boolean}
 */
function isTgXmlEl(element: Element): boolean {
    return element.tagName.toLowerCase() === "tategaki";
}

/**
 * @param {Document} xmlDoc
 * @returns {Element[]}
 */
export function getReaderNds(xmlDoc: Document): Element[] {
    return Array.from(xmlDoc.getElementsByTagName("*")).filter((element) => {
        if (isTgXmlEl(element)) return true;

        if (isXmlPEl(element)) {
            return !hasAncestorTag(element, "tategaki");
        }

        return false;
    });
}

/**
 * @param {Element} element
 * @returns {string | null}
 */
export function serialisNde(element: Element): string | null {
    if (!isTgXmlEl(element)) return null;
    return new XMLSerializer().serializeToString(element);
}

// document.addEventListener("DOMContentLoaded", () => {
//     const container = document.querySelector(".jp-about");
//     if (!(container instanceof HTMLElement)) return;

//     container.innerHTML = replaceTategaki(container.innerHTML);
// });