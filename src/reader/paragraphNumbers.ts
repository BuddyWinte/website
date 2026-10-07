const READER_PARA_NUMS_COOKIE = "showParagraphNumbers";
const READER_PARA_NUMS_CLASS = "reader-show-paragraph-numbers";
const PNUM_TOGGLE_SELECTOR = ".btn-toggle-paragraph-numbers";

export function setRCookie(
    name: string,
    value: string,
    days = 365,
    root: Document = document
): void {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    root.cookie =
        "reader_" +
        name +
        "=" +
        value +
        "; expires=" +
        expires +
        "; path=/";
}

export function getRCookie(
    name: string,
    root: Document = document
): string | null {
    const cookies = root.cookie.split("; ");
    const cookie = cookies.find(
        (row) => row.startsWith("reader_" + name + "=")
    );

    return cookie ? cookie.split("=")[1] ?? null : null;
}

function shouldNumberBookmark(bookmark: Element): boolean {
    const contentEl = bookmark.firstElementChild;
    if (!contentEl) return false;

    const clone = contentEl.cloneNode(true) as Element;

    clone
        .querySelectorAll(".reader-paragraph-num, .bookmark-emoji")
        .forEach((node) => node.remove());

    if (clone.querySelector("email, sms, tooltip, signature, content, logo")) {
        return false;
    }

    if (clone.querySelector("img, svg, video, audio, iframe")) {
        return false;
    }

    const text = (clone.textContent || "")
        .replace(/\s+/g, "")
        .trim();

    return text.length > 0;
}

function numberedBookmarks(reader: HTMLElement): Element[] {
    return Array.from(
        reader.querySelectorAll(".reader-bookmark")
    ).filter(
        (element) =>
            typeof element.id === "string" &&
            /-ch\d+-\d+$/.test(element.id)
    );
}

export function renderPNum(root: Document = document): void {
    void root;

    const reader = window.readerRoot;
    if (!reader) return;

    const bookmarks = numberedBookmarks(reader);
    if (bookmarks.length === 0) return;

    const maxOrdinal = Math.max(
        ...bookmarks.map((element) => {
            const match = element.id.match(/-(\d+)$/);
            return match ? Number(match[1]) : 0;
        })
    );

    const digits = String(maxOrdinal).length;

    reader.style.setProperty(
        "--reader-para-num-col-width",
        String(digits) + "ch"
    );
    reader.style.setProperty("--reader-para-num-gap", "0.9em");

    for (const element of bookmarks) {
        const match = element.id.match(/-(\d+)$/);
        if (!match) continue;

        const ordinal = Number(match[1]);
        const label = String(ordinal).padStart(digits, "0");
        const shouldRender = shouldNumberBookmark(element);
        let number = element.querySelector(
            ":scope > .reader-paragraph-num"
        ) as HTMLSpanElement | null;

        if (!shouldRender && number) number.remove();
        if (!shouldRender) continue;

        if (!number) {
            number = document.createElement("span");
            number.className = "reader-paragraph-num";
            number.setAttribute("aria-hidden", "true");
            element.insertAdjacentElement("afterbegin", number);
        }

        if (number.textContent !== label) number.textContent = label;
    }
}

function syncPNumBtns(
    enabled: boolean,
    root: Document = document
): void {
    root.querySelectorAll<HTMLElement>(PNUM_TOGGLE_SELECTOR)
        .forEach((button) => {
            button.classList.toggle("menu-crossed", enabled);
        });
}

function clearPNums(reader: HTMLElement): void {
    reader
        .querySelectorAll(".reader-paragraph-num")
        .forEach((node) => node.remove());

    reader.style.removeProperty("--reader-para-num-col-width");
    reader.style.removeProperty("--reader-para-num-gap");
}

export function enablePNum(enabled: boolean): void {
    const reader = window.readerRoot;
    if (!reader) return;

    reader.classList.toggle(READER_PARA_NUMS_CLASS, enabled);
    setRCookie(
        READER_PARA_NUMS_COOKIE,
        enabled ? "true" : "false"
    );
    syncPNumBtns(enabled, document);

    if (!enabled) clearPNums(reader);
    if (enabled) renderPNum(document);
}

export function refreshPNum(root: Document = document): void {
    const reader = window.readerRoot;
    if (!reader) return;
    if (!reader.classList.contains(READER_PARA_NUMS_CLASS)) return;

    renderPNum(root);
}

function getMidBkm(
    root: Document = document
): HTMLElement | null {
    const bookmarks = Array.from(
        root.querySelectorAll<HTMLElement>(".reader-bookmark")
    );

    if (!bookmarks.length) return null;

    const midY = window.innerHeight / 2;
    let best: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const bookmark of bookmarks) {
        const rect = bookmark.getBoundingClientRect();
        const bookmarkMid = rect.top + rect.height / 2;
        const distance = Math.abs(bookmarkMid - midY);

        if (distance >= bestDistance) continue;

        best = bookmark;
        bestDistance = distance;
    }

    return best;
}

function recentreBkm(
    bookmarkId: string,
    root: Document = document
): void {
    const bookmark = root.getElementById(bookmarkId) as HTMLElement | null;
    if (!bookmark) return;

    const rect = bookmark.getBoundingClientRect();
    const top =
        window.scrollY +
        rect.top -
        window.innerHeight / 2 +
        rect.height / 2;

    window.scrollTo({
        top: Math.max(0, top),
        behavior: "auto"
    });
}

export function togglePNum(): void {
    const reader = window.readerRoot;
    if (!reader) return;

    const middleBookmark = getMidBkm(document);
    const middleBookmarkId = middleBookmark?.id || null;
    const next = !reader.classList.contains(READER_PARA_NUMS_CLASS);

    enablePNum(next);
    if (!middleBookmarkId) return;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            recentreBkm(middleBookmarkId, document);
        });
    });
}

export function initPNumCookie(): void {
    const value = getRCookie(READER_PARA_NUMS_COOKIE);
    enablePNum(value === "true");
}
