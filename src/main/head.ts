function needHeadAnchor(
    doc: Document,
    id: string
): HTMLMetaElement {
    const existing = doc.getElementById(id);
    if (existing instanceof HTMLMetaElement) return existing;
    if (existing) existing.remove();

    const meta = doc.createElement("meta");
    meta.id = id;
    meta.name = id;
    meta.content = "";
    doc.head.appendChild(meta);
    return meta;
}

function clearBetween(start: Node, end: Node): void {
    let node = start.nextSibling;

    while (node && node !== end) {
        const next = node.nextSibling;
        node.parentNode?.removeChild(node);
        node = next;
    }
}

function cloneHeadNode(doc: Document, node: Node): Node {
    if (node.nodeType === Node.TEXT_NODE) {
        return doc.createTextNode(node.textContent ?? "");
    }

    if (node.nodeType === Node.COMMENT_NODE) {
        return doc.createComment(node.textContent ?? "");
    }

    if (node instanceof HTMLScriptElement) {
        const script = doc.createElement("script");

        for (const attr of Array.from(node.attributes)) {
            script.setAttribute(attr.name, attr.value);
        }

        script.textContent = node.textContent ?? "";
        return script;
    }

    if (node instanceof HTMLElement) {
        const el = doc.createElement(node.tagName.toLowerCase());

        for (const attr of Array.from(node.attributes)) {
            el.setAttribute(attr.name, attr.value);
        }

        for (const child of Array.from(node.childNodes)) {
            el.appendChild(cloneHeadNode(doc, child));
        }

        return el;
    }

    return node.cloneNode(true);
}

export function applyHeadBits(
    doc: Document,
    injections: readonly string[]
): void {
    const start = needHeadAnchor(doc, "kc-header-injections_start");
    const end = needHeadAnchor(doc, "kc-header-injections_end");

    if (start.parentNode !== doc.head) doc.head.appendChild(start);
    if (end.parentNode !== doc.head) doc.head.appendChild(end);

    if (
        start.compareDocumentPosition(end) &
        Node.DOCUMENT_POSITION_PRECEDING
    ) doc.head.appendChild(end);

    clearBetween(start, end);

    const frag = doc.createDocumentFragment();

    for (const raw of injections) {
        const html = String(raw ?? "").trim();
        if (!html) continue;

        const tpl = doc.createElement("template");
        tpl.innerHTML = html;

        for (const node of Array.from(tpl.content.childNodes)) {
            frag.appendChild(cloneHeadNode(doc, node));
        }

        frag.appendChild(doc.createTextNode("\n"));
    }

    doc.head.insertBefore(frag, end);
}
