import * as icons from "../icons.tsx";
import { render2Frag } from "../reactHelpers.tsx";

const SEG_ID_PREFIX = "rss-s-";

function hashSegId(value: string): string {
    let hash = 0x811c9dc5;

    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0)
        .toString(16)
        .padStart(8, "0")
        .slice(0, 8);
}

function isTopBlockquote(
    blockquote: HTMLQuoteElement
): boolean {
    const parent = blockquote.parentElement;
    return !parent || parent.closest("blockquote") === null;
}

function collectSegmentElements(
    root: DocumentFragment
): HTMLElement[] {
    return Array.from(
        root.querySelectorAll<HTMLElement>(
            "h1,h2,h3,h4,blockquote"
        )
    ).filter((element) => {
        if (!(element instanceof HTMLQuoteElement)) {
            return true;
        }

        return isTopBlockquote(element);
    });
}

function makeSegmentId(
    seed: string,
    element: HTMLElement,
    index: number,
    used: Set<string>
): string {
    const kind = element.tagName.toLowerCase();
    const text = (element.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ");

    let attempt = 0;

    while (true) {
        const extra = attempt === 0
            ? ""
            : "|" + String(attempt);

        const hash = hashSegId(
            seed +
            "|" +
            kind +
            "|" +
            String(index) +
            "|" +
            text +
            extra
        );

        const id = SEG_ID_PREFIX + hash;

        if (!used.has(id)) {
            used.add(id);
            return id;
        }

        attempt += 1;
    }
}

function makeSegmentShareButton(
    segmentId: string
): HTMLButtonElement {
    const button = document.createElement("button");

    button.type = "button";
    button.className =
        "rss-post-share rss-post-share--segment " +
        "rss-seg-share kc-round-icon-btn";
    button.dataset.rssSegShareBtn = segmentId;
    button.setAttribute(
        "aria-label",
        "Share this section"
    );
    button.title = "Share section";
    button.append(render2Frag(icons.MakeShareIcon()));

    return button;
}

function clearPreSegmentShare(
    pre: HTMLPreElement
): void {
    pre.removeAttribute("id");
    delete pre.dataset.rssSegId;
    delete pre.dataset.rssSegShare;
}

export function moveCodeSegShareToFrame(
    frame: HTMLDivElement,
    pres: readonly HTMLPreElement[]
): void {
    const segmentId = pres
        .find((pre) => pre.dataset.rssSegId)
        ?.dataset.rssSegId;

    for (const pre of pres) {
        clearPreSegmentShare(pre);
    }

    if (!segmentId || frame.dataset.rssSegId) return;

    frame.id = segmentId;
    frame.dataset.rssSegId = segmentId;
    frame.dataset.rssSegShare = "1";
    frame.appendChild(
        makeSegmentShareButton(segmentId)
    );
}

export function applSegShares(
    html: string,
    seed: string
): string {
    const template = document.createElement("template");
    const used = new Set<string>();

    template.innerHTML = html;

    collectSegmentElements(template.content)
        .forEach((element, index) => {
            const id = makeSegmentId(
                seed,
                element,
                index,
                used
            );

            element.id = id;
            element.dataset.rssSegId = id;
            element.dataset.rssSegShare = "1";
            element.appendChild(
                makeSegmentShareButton(id)
            );
        });

    return template.innerHTML;
}
