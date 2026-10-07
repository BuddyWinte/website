type KanjiLayout = "vertical" | "horizontal";

type RenderedWithStyles = Readonly<{
    html: string;
    css: string;
}>;

type KanjiGlyph = string | ComposedKanji;

class Tategaki {
    /**
     * @param {string} content - Inner HTML for the tategaki wrapper.
     * @returns {string} Wrapped HTML string.
     */
    static wrap(content: string): string {
        return `<div class="tategaki">${content}</div>`;
    }

    /**
     * @returns {string} CSS text for tategaki rendering.
     */
    static getCSS(): string {
        return `
            .tategaki {
                writing-mode: vertical-rl;
                text-orientation: mixed;
                line-height: 1.8;
            }

            ruby {
                ruby-position: side;
            }

            rt {
                font-size: 0.5em;
                line-height: 1;
            }

            .manual-ruby {
                display: inline-flex;
                flex-direction: row-reverse;
                align-items: center;
                justify-content: flex-start;
                writing-mode: vertical-rl;
                vertical-align: top;
            }

            .manual-base {
                display: inline-block;
                width: 1em;
                height: 1em;
                line-height: 1;
                text-align: center;
                position: relative;
            }

            .manual-rt-column {
                display: flex;
                flex-direction: column;
                justify-content: center;
                font-size: 0.5em;
                line-height: 1;
                margin-left: 0.1em;
            }

            .manual-rt {
                writing-mode: horizontal-tb;
                white-space: nowrap;
                text-align: left;
            }

            #output {
                display: flex;
                flex-direction: row-reverse;
                gap: 1em;
            }
        `;
    }
}

class Furigana {
    /**
     * @param {string} base - Base text (kanji).
     * @param {string} reading - Furigana reading.
     * @param {number | null} maxEm - Optional max width in em before nesting ruby.
     * @returns {string} Ruby HTML.
     */
    static render(base: string, reading: string, maxEm: number | null = null): string {
        if (maxEm === null) {
            return `<ruby>${base}<rt>${reading}</rt></ruby>`;
        }

        const widthEm = Furigana.#estimateEmWidth(reading);

        if (widthEm <= maxEm) {
            return `<ruby>${base}<rt>${reading}</rt></ruby>`;
        }

        const blocksNeeded = Math.ceil(widthEm / maxEm) - 1;
        const slices = Furigana.#splitReading(reading, blocksNeeded);

        let html = base;
        for (const slice of slices) {
            html = `<ruby>${html}<rt>${slice}</rt></ruby>`;
        }

        return html;
    }

    /**
     * @param {string} text - Reading text.
     * @returns {number} Estimated width in ems.
     */
    static #estimateEmWidth(text: string): number {
        let w = 0;

        for (const ch of [...text]) {
            const cp = ch.codePointAt(0) ?? 0;

            if (
                (cp >= 0x3040 && cp <= 0x30ff) ||
                cp < 0x2e80
            ) {
                w += 0.5;
                continue;
            }

            w += 1;
        }

        return w;
    }

    /**
     * @param {string} text - Reading text.
     * @param {number} parts - Number of parts to split into.
     * @returns {string[]} Parts of the reading.
     */
    static #splitReading(text: string, parts: number): string[] {
        const chars = [...text];
        const safeParts = Math.max(1, Math.floor(parts));

        const base = Math.floor(chars.length / safeParts);
        const rem = chars.length % safeParts;

        const sizes: number[] = Array.from({ length: safeParts }, (_v, i) => base + (i < rem ? 1 : 0));

        const out: string[] = [];
        let idx = 0;

        for (const n of sizes) {
            out.push(chars.slice(idx, idx + n).join(""));
            idx += n;
        }

        return out;
    }
}

class ComposedKanji {
    static counter = 0;

    readonly g1: KanjiGlyph;
    readonly g2: KanjiGlyph;
    readonly layout: KanjiLayout;
    readonly uid: string;
    readonly xC: number;
    readonly yC: number;

    constructor(
        g1: KanjiGlyph,
        g2: KanjiGlyph,
        layout: KanjiLayout = "vertical",
        { xCompress = 0, yCompress = 0 }: Readonly<{ xCompress?: number; yCompress?: number }> = {}
    ) {
        this.g1 = g1;
        this.g2 = g2;
        this.layout = layout;
        this.uid = `k${++ComposedKanji.counter}`;
        this.xC = Math.max(-2, Math.min(2, xCompress));
        this.yC = Math.max(-2, Math.min(2, yCompress));
    }

    /**
     * @returns {RenderedWithStyles} HTML + CSS for this composed kanji (including nested composed glyphs).
     */
    renderWithStyles(): RenderedWithStyles {
        const isVertical = this.layout === "vertical";
        const compValue = isVertical ? this.yC : this.xC;
        const absShift = Math.abs(compValue) * 50;
        const swap = compValue < 0;

        const g1 = this.g1 instanceof ComposedKanji ? this.g1.renderWithStyles() : { html: this.g1, css: "" };
        const g2 = this.g2 instanceof ComposedKanji ? this.g2.renderWithStyles() : { html: this.g2, css: "" };

        const [A, B] = swap ? [g2.html, g1.html] : [g1.html, g2.html];

        const wrapperClass = `kanji-composed kanji-${this.layout}`;
        const part1Class = `kanji-slot kanji-${this.uid}-${isVertical ? "top" : "left"}`;
        const part2Class = `kanji-slot kanji-${this.uid}-${isVertical ? "bottom" : "right"}`;

        const html = `
            <span class="${wrapperClass}">
                <span class="${part1Class}">${A}</span>
                <span class="${part2Class}">${B}</span>
            </span>
        `;

        const css = isVertical
            ? `
                .kanji-${this.uid}-top {
                transform: scaleY(0.5) translateY(${absShift}%);
                transform-origin: top;
                }
                .kanji-${this.uid}-bottom {
                transform: scaleY(0.5) translateY(-${absShift}%);
                transform-origin: bottom;
                }
            `
            : `
                .kanji-${this.uid}-left {
                transform: scaleX(0.5) translateX(${absShift}%);
                transform-origin: left;
                }
                .kanji-${this.uid}-right {
                transform: scaleX(0.5) translateX(-${absShift}%);
                transform-origin: right;
                }
            `;

        return {
            html,
            css: g1.css + g2.css + css
        };
    }

    /**
     * @returns {string} Base CSS for composed kanji slots.
     */
    static getCSS(): string {
        return `
        .kanji-composed {
        display: inline-block;
        font-size: 1em;
        width: 1em;
        height: 1em;
        line-height: 1;
        position: relative;
      }

      .kanji-slot {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        text-align: center;
        white-space: nowrap;
    }
    `;
    }
}

class JPExtended {
    /**
     * @returns {void} Nothing.
     */
    static injectCSS(): void {
        const style = document.createElement("style");
        style.innerHTML = [
            Tategaki.getCSS(),
            ComposedKanji.getCSS()
        ].join("\n");
        document.head.appendChild(style);
    }

    /**
     * @param {Node} node - Node containing jp-kanji markup or plain text.
     * @returns {KanjiGlyph} Either a string glyph or a composed glyph.
     */
    static buildKanji(node: Node): KanjiGlyph {
        if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").trim();

        if (!(node instanceof Element)) return (node.textContent ?? "").trim();

        if (node.tagName.toLowerCase() !== "jp-kanji") {
            return (node.textContent ?? "").trim();
        }

        const alignRaw = node.getAttribute("alignment") ?? "";
        const layout: KanjiLayout =
            alignRaw === "horizontal" || alignRaw === "vertical" ? alignRaw : "vertical";

        const x = Number.parseFloat(node.getAttribute("xcompress") ?? "0") || 0;
        const y = Number.parseFloat(node.getAttribute("ycompress") ?? "0") || 0;

        const children = Array.from(node.childNodes).filter((n) => {
            if (n.nodeType !== Node.TEXT_NODE) return true;
            return ((n.textContent ?? "").trim() !== "");
        });

        if (children.length === 1 && children[0]?.nodeType === Node.TEXT_NODE) {
            const chars = ((children[0].textContent ?? "").trim()).split("").filter(Boolean);

            return chars.length === 2
                ? new ComposedKanji(
                    chars[0] ?? "",
                    chars[1] ?? "",
                    layout,
                    { xCompress: x, yCompress: y }
                )
                : chars.join("");
        }

        if (children.length === 2) {
            const g1 = JPExtended.buildKanji(children[0] as Node);
            const g2 = JPExtended.buildKanji(children[1] as Node);
            return new ComposedKanji(g1, g2, layout, { xCompress: x, yCompress: y });
        }

        return (node.textContent ?? "").trim();
    }

    /**
     * @returns {void} Nothing.
     */
    static parseCustomTags(): void {
        // Step 1: jp-tategaki
        document.querySelectorAll("jp-tategaki").forEach((el) => {
            const wrapped = Tategaki.wrap(el.innerHTML);
            const container = document.createElement("div");
            container.innerHTML = wrapped;
            el.replaceWith(container);
        });

        // Step 2: jp-furigana
        document.querySelectorAll("jp-furigana").forEach((el) => {
            const sizeAttr = el.getAttribute("size");
            const size = sizeAttr !== null ? (Number.parseFloat(sizeAttr) || 0) : null;
            const maxEm = sizeAttr !== null && size !== null && Number.isFinite(size) && size > 0 ? size : null;

            const children = Array.from(el.childNodes);

            const hasKanji = children.some((n) => {
                return n instanceof Element && n.tagName.toLowerCase() === "jp-kanji";
            });

            let base = "";
            let reading = "";

            if (!hasKanji) {
                const raw = (el.textContent ?? "").trim();
                const mid = Math.floor(raw.length / 2);
                base = raw.slice(0, mid);
                reading = raw.slice(mid);

                const output = Furigana.render(base, reading, maxEm);
                const container = document.createElement("span");
                container.innerHTML = output;
                el.replaceWith(container);
                return;
            }

            let readingFound = false;

            for (const child of children) {
                const readingText =
                    !readingFound && child.nodeType === Node.TEXT_NODE
                        ? (child.textContent ?? "").trim()
                        : "";

                if (readingText) {
                    reading += readingText;
                    readingFound = true;
                    continue;
                }

                if (child.nodeType === Node.TEXT_NODE) {
                    base += (child.textContent ?? "").trim();
                    continue;
                }

                if (!(child instanceof Element)) continue;
                if (child.tagName.toLowerCase() !== "jp-kanji") continue;

                const composed = JPExtended.buildKanji(child);

                if (typeof composed === "string") {
                    base += composed;
                    continue;
                }

                const { html, css } = composed.renderWithStyles();
                base += html;

                const style = document.createElement("style");
                style.innerHTML = css;
                document.head.appendChild(style);
            }

            const output = Furigana.render(base, reading, maxEm);
            const container = document.createElement("span");
            container.innerHTML = output;
            el.replaceWith(container);
        });

        // Step 3: standalone jp-kanji
        document.querySelectorAll("jp-kanji").forEach((node) => {
            if (!(node instanceof Element)) return;
            if (!node.isConnected) return;

            const composed = JPExtended.buildKanji(node);

            if (typeof composed === "string") {
                const span = document.createElement("span");
                span.textContent = composed;
                node.replaceWith(span);
                return;
            }

            const rendered = composed.renderWithStyles();

            const span = document.createElement("span");
            span.innerHTML = rendered.html;
            node.replaceWith(span);

            const style = document.createElement("style");
            style.innerHTML = rendered.css;
            document.head.appendChild(style);
        });
    }

    /**
     * @returns {void} Nothing.
     */
    static init(): void {
        JPExtended.injectCSS();
        JPExtended.parseCustomTags();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    JPExtended.init();
});

export default JPExtended;