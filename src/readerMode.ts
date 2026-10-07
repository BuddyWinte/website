import {
	activateImageNavigation,
	getParams,
	injectBookmarksIntoHTML,
	readerIsFullyLoaded
} from "./reader.tsx";

import * as helpers from "./helpers.ts";

import { showToggleVisual } from "./toggleIcons.ts";

type ChapterImageInfo = Readonly<{
	src: string;
	alt: string;
	hasContainer: boolean;
}>;

type ReadabilityParseResult = Readonly<{
	content?: string;
}> | null;

type ReadabilityInstance = Readonly<{
	parse: () => ReadabilityParseResult;
}>;

type ReadabilityConstructor = new (doc: Document) => ReadabilityInstance;

type ReaderModeKeepTarget = string | Element | null | undefined;
type ReaderModeCssSheetTarget = string | HTMLLinkElement | HTMLStyleElement | null | undefined;
type ReaderModeCssVarName = `--${string}`;
type ReaderModeCssVarOverrides = Readonly<Record<ReaderModeCssVarName, string>>;

type PurgedDomSheetEntry = Readonly<{
	kind: "dom";
	sheet: HTMLLinkElement | HTMLStyleElement;
	disabled: boolean;
}>;

type PurgedImportSheetEntry = Readonly<{
	kind: "import";
	ownerSheet: CSSStyleSheet;
	index: number;
	cssText: string;
}>;

type PurgedSheetEntry = PurgedDomSheetEntry | PurgedImportSheetEntry;

export type ReaderModeOptions = Readonly<{
	keep?: readonly ReaderModeKeepTarget[];
	focus?: ReaderModeKeepTarget;
	sheetPurge?: readonly ReaderModeCssSheetTarget[];
	varOverrides?: ReaderModeCssVarOverrides;
}>;

declare global {
	interface Window {
		Readability?: ReadabilityConstructor;
	}

	interface HTMLElement {
		__readerListener?: boolean;
	}
}

const READER_TOGGLE_ICON_SPEC = {
	size: 32,
	wrapperClass: "theme-toggle-button__icon",
	svgClass: "theme-toggle-button__svg"
} as const;

async function waitForReaderToggle(
    current: HTMLElement | null
): Promise<HTMLButtonElement | null> {
    if (current instanceof HTMLButtonElement) return current;

    return new Promise<HTMLButtonElement>((resolve) => {
        const observer = new MutationObserver(() => {
            const element = document.getElementById("reader-toggle");
            if (!(element instanceof HTMLButtonElement)) return;

            observer.disconnect();
            resolve(element);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}

class ReaderToggle {
	readerActive: boolean = false;
	originalNodeClone: Node | null = null;
	readerToggle: HTMLButtonElement;
	options: ReaderModeOptions;
	purgedSheets: PurgedSheetEntry[] = [];
	overrideSheetEl: HTMLStyleElement | null = null;

	/**
	 * @param {HTMLButtonElement} readerToggle - The toggle element used to enable/disable reader mode.
	 * @param {ReaderModeOptions} [options={}] - Reader mode keep/focus configuration.
	 * @returns {void}
	 */
	constructor(readerToggle: HTMLButtonElement, options: ReaderModeOptions = {}) {
		this.readerToggle = readerToggle;
		this.options = options;
		this.handleToggleClick = this.handleToggleClick.bind(this);
	}

	/**
	 * @param {ReaderModeOptions} [options={}] - Reader mode keep/focus configuration.
	 * @returns {Promise<boolean>} True when the toggle was found and initialised.
	 */
	static async setup(options: ReaderModeOptions = {}): Promise<boolean> {
		if (document.readyState === "loading") {
			await helpers.waitForDomReady();
		}

		const readerToggle = await waitForReaderToggle(
			document.getElementById("reader-toggle")
		);

		if (!(readerToggle instanceof HTMLButtonElement)) return false;

		const instance = new ReaderToggle(readerToggle, options);
		instance.syncButtonState();

		if (!readerToggle.__readerListener) {
			readerToggle.addEventListener("click", instance.handleToggleClick);
			readerToggle.__readerListener = true;
		}

		if (window.location.search.includes("reader=true")) {
			await readerIsFullyLoaded();

			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => {
					void instance.enableReaderMode();
				});
			});
		}

		return true;
	}

	/**
	 * @returns {void}
	 */
	syncButtonState(): void {
		if (document.body.classList.contains("reader-mode")) {
			this.readerToggle.classList.add("active");
			void showToggleVisual(this.readerToggle, "disable", READER_TOGGLE_ICON_SPEC);
			return;
		}

		this.readerToggle.classList.remove("active");
		void showToggleVisual(this.readerToggle, "enable", READER_TOGGLE_ICON_SPEC);
	}

	/**
	 * @param {ReaderModeKeepTarget} target - Selector or element to resolve.
	 * @param {ParentNode} [root=document] - Root used for selector lookup.
	 * @returns {Element[]} Resolved elements.
	 */
	resolveTarget(target: ReaderModeKeepTarget, root: ParentNode = document): Element[] {
		if (!target) return [];

		if (typeof target === "string") {
			return Array.from(root.querySelectorAll(target));
		}

		if (target instanceof Element) {
			return [target];
		}

		return [];
	}

	/**
	 * @param {string} raw - Href fragment to look for in nested @import rules.
	 * @returns {PurgedImportSheetEntry[]} Matching import-rule entries.
	 */
	resolveImportedSheets(raw: string): PurgedImportSheetEntry[] {
		const matches: PurgedImportSheetEntry[] = [];
		const seen = new Set<string>();

		/**
		 * @param {CSSStyleSheet | null | undefined} sheet - Current sheet to scan.
		 * @returns {void}
		 */
		const visit = (sheet: CSSStyleSheet | null | undefined): void => {
			if (!sheet) return;

			let rules: CSSRuleList;
			try {
				rules = sheet.cssRules;
			} catch {
				return;
			}

			for (let i = 0; i < rules.length; i += 1) {
				const rule = rules[i];
				if (!(rule instanceof CSSImportRule)) continue;

				const href = rule.href || rule.styleSheet?.href || "";
				const key = `${sheet.href || "inline"}::${i}::${href}`;

				if (href.includes(raw) && !seen.has(key)) {
					seen.add(key);
					matches.push({
						kind: "import",
						ownerSheet: sheet,
						index: i,
						cssText: rule.cssText
					});
				}

				visit(rule.styleSheet);
			}
		};

		for (const sheet of Array.from(document.styleSheets)) {
			if (!(sheet instanceof CSSStyleSheet)) continue;
			visit(sheet);
		}

		return matches;
	}

	/**
	 * @param {ReaderModeCssSheetTarget} target - Sheet identifier, selector, or element.
	 * @returns {PurgedSheetEntry[]} Matching stylesheet entries.
	 */
	resolveSheetTarget(target: ReaderModeCssSheetTarget): PurgedSheetEntry[] {
		if (!target) return [];

		if (target instanceof HTMLLinkElement || target instanceof HTMLStyleElement) {
			return [{
				kind: "dom",
				sheet: target,
				disabled: !!target.disabled
			}];
		}

		if (typeof target !== "string") return [];

		const raw = target.trim();
		if (!raw) return [];

		if (raw.startsWith("#") || raw.startsWith(".")) {
			return Array.from(document.querySelectorAll(raw))
				.filter(
					(el): el is HTMLLinkElement | HTMLStyleElement =>
						el instanceof HTMLLinkElement || el instanceof HTMLStyleElement
				)
				.map((sheet) => ({
					kind: "dom" as const,
					sheet,
					disabled: !!sheet.disabled
				}));
		}

		const links = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']"))
			.filter((link) => (link.getAttribute("href") || "").includes(raw))
			.map((sheet) => ({
				kind: "dom" as const,
				sheet,
				disabled: !!sheet.disabled
			}));

		const styles = Array.from(document.querySelectorAll<HTMLStyleElement>("style"))
			.filter((style) => (style.id || "").includes(raw))
			.map((sheet) => ({
				kind: "dom" as const,
				sheet,
				disabled: !!sheet.disabled
			}));

		const imports = this.resolveImportedSheets(raw);

		return [...links, ...styles, ...imports];
	}

	/**
	 * @param {HTMLElement} fallback - Fallback focus root.
	 * @returns {Element} Focus root for reader mode.
	 */
	resolveFocusRoot(fallback: HTMLElement): Element {
		const resolved = this.resolveTarget(this.options.focus);
		return resolved[0] ?? fallback;
	}

	/**
	 * @param {Element} focusRoot - Main reading surface.
	 * @returns {Element[]} Elements whose subtrees should remain visible.
	 */
	collectKeepRoots(focusRoot: Element): Element[] {
		const collected = new Set<Element>();

		collected.add(this.readerToggle);
		collected.add(focusRoot);

		const extraKeeps = this.options.keep ?? [];
		for (const keepTarget of extraKeeps) {
			for (const el of this.resolveTarget(keepTarget)) {
				collected.add(el);
			}
		}

		return Array.from(collected).filter((el) => el.isConnected);
	}

	/**
	 * @param {Element} el - Element to hide.
	 * @returns {void}
	 */
	hideElement(el: Element): void {
		if (!(el instanceof HTMLElement)) return;

		el.dataset.readerModeHidden = "true";
		el.style.setProperty("display", "none", "important");
	}

	/**
	 * @returns {void}
	 */
	purgeSheets(): void {
		if (this.purgedSheets.length > 0) return;

		const domSeen = new Set<HTMLLinkElement | HTMLStyleElement>();
		const importSeen = new Set<string>();
		const collected: PurgedSheetEntry[] = [];
		const targets = this.options.sheetPurge ?? [];

		for (const target of targets) {
			for (const entry of this.resolveSheetTarget(target)) {
				const isDomSheet = entry.kind === "dom";

				if (isDomSheet && domSeen.has(entry.sheet)) continue;
				if (isDomSheet) domSeen.add(entry.sheet);
				if (isDomSheet) collected.push(entry);
				if (isDomSheet) continue;

				const importKey = `${entry.ownerSheet.href || "inline"}::${entry.index}::${entry.cssText}`;
				if (importSeen.has(importKey)) continue;
				importSeen.add(importKey);
				collected.push(entry);
			}
		}

		this.purgedSheets = collected;

		const domEntries = collected.filter(
			(entry): entry is PurgedDomSheetEntry => entry.kind === "dom"
		);
		const importEntries = collected
			.filter((entry): entry is PurgedImportSheetEntry => entry.kind === "import")
			.sort((a, b) => b.index - a.index);

		for (const entry of domEntries) {
			entry.sheet.disabled = true;
		}

		for (const entry of importEntries) {
			try {
				entry.ownerSheet.deleteRule(entry.index);
			} catch {
				// Ignore sheets that cannot be modified.
			}
		}
	}

	/**
	 * @returns {void}
	 */
	applyVarOverrides(): void {
		if (this.overrideSheetEl) return;

		const entries = Object.entries(this.options.varOverrides ?? {});
		if (entries.length === 0) return;

		const cssBody = entries
			.map(([name, value]) => `  ${name}: ${value};`)
			.join("\n");

		const style = document.createElement("style");
		style.id = "reader-mode-var-overrides";
		style.textContent = `:root {\n${cssBody}\n}`;

		const footer = document.getElementById("main-footer");
		if (footer) {
			footer.appendChild(style);
		} else {
			document.body.appendChild(style);
		}

		this.overrideSheetEl = style;
	}

	/**
	 * @returns {void}
	 */
	restorePurgedSheets(): void {
		const domEntries = this.purgedSheets.filter(
			(entry): entry is PurgedDomSheetEntry => entry.kind === "dom"
		);
		const importEntries = this.purgedSheets
			.filter((entry): entry is PurgedImportSheetEntry => entry.kind === "import")
			.sort((a, b) => a.index - b.index);

		for (const entry of domEntries) {
			entry.sheet.disabled = entry.disabled;
		}

		for (const entry of importEntries) {
			try {
				entry.ownerSheet.insertRule(entry.cssText, entry.index);
			} catch {
				// Ignore sheets that cannot be restored cleanly.
			}
		}

		this.purgedSheets = [];
	}

	/**
	 * @returns {void}
	 */
	removeVarOverrides(): void {
		this.overrideSheetEl?.remove();
		this.overrideSheetEl = null;
	}

	/**
	 * @returns {Promise<void>}
	 */
	async waitForDomFlush(): Promise<void> {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => resolve());
			});
		});
	}

	/**
	 * @param {Element} focusRoot - Root content element that should lose its window chrome.
	 * @returns {void}
	 */
	unframeManagedWindow(focusRoot: Element): void {
		const frame = focusRoot.closest<HTMLElement>(
			".window-frame, [data-window-id], [data-window-api-mounted='true']"
		);

		if (!frame) return;

		const header = frame.querySelector<HTMLElement>(":scope > .window-header");
		const body = frame.querySelector<HTMLElement>(":scope > .window-body");

		if (header) {
			header.dataset.readerModeHidden = "true";
			header.style.setProperty("display", "none", "important");
		}

		frame.dataset.readerModeUnframed = "true";
		frame.style.setProperty("display", "contents", "important");
		frame.style.setProperty("background", "transparent", "important");
		frame.style.setProperty("border", "0", "important");
		frame.style.setProperty("box-shadow", "none", "important");
		frame.style.setProperty("padding", "0", "important");
		frame.style.setProperty("margin", "0", "important");
		frame.style.setProperty("inline-size", "auto", "important");
		frame.style.setProperty("block-size", "auto", "important");
		frame.style.setProperty("width", "auto", "important");
		frame.style.setProperty("height", "auto", "important");
		frame.style.setProperty("max-width", "none", "important");
		frame.style.setProperty("max-height", "none", "important");
		frame.style.setProperty("min-width", "0", "important");
		frame.style.setProperty("min-height", "0", "important");
		frame.style.setProperty("position", "static", "important");
		frame.style.setProperty("left", "auto", "important");
		frame.style.setProperty("top", "auto", "important");
		frame.style.setProperty("overflow", "visible", "important");
		frame.style.setProperty("resize", "none", "important");
		frame.style.setProperty("z-index", "auto", "important");

		if (body) {
			body.dataset.readerModeUnframed = "true";
			body.style.setProperty("display", "contents", "important");
			body.style.setProperty("padding", "0", "important");
			body.style.setProperty("margin", "0", "important");
			body.style.setProperty("overflow", "visible", "important");
			body.style.setProperty("height", "auto", "important");
			body.style.setProperty("max-height", "none", "important");
			body.style.setProperty("min-height", "0", "important");
			body.style.setProperty("flex", "0 1 auto", "important");
		}
	}

	/**
	 * @param {readonly Element[]} keepRoots - Roots whose full subtrees must stay visible.
	 * @returns {void}
	 */
	hideEverythingExcept(keepRoots: readonly Element[]): void {
		this.purgeSheets();
		this.applyVarOverrides();

		const keepRootSet = new Set<Element>(keepRoots);
		const keepAncestorSet = new Set<Element>();

		for (const keepRoot of keepRoots) {
			let cur: Element | null = keepRoot;
			while (cur && cur !== document.body) {
				keepAncestorSet.add(cur);
				cur = cur.parentElement;
			}
		}

		/**
		 * @param {Element} container - Current container to walk.
		 * @returns {void}
		 */
		const visit = (container: Element): void => {
			for (const child of Array.from(container.children)) {
				if (keepRootSet.has(child)) {
					continue;
				}

				if (keepAncestorSet.has(child)) {
					visit(child);
					continue;
				}

				this.hideElement(child);
			}
		};

		visit(document.body);
	}

	/**
	 * @param {Element} focusRoot - Primary reading root to keep and unframe.
	 * @param {readonly Element[]} keepRoots - Additional keep roots.
	 * @returns {void}
	 */
	applyReaderShell(focusRoot: Element, keepRoots: readonly Element[]): void {
		this.unframeManagedWindow(focusRoot);
		this.hideEverythingExcept(keepRoots);
	}

	/**
	 * @param {unknown} doc - Document clone to sanitise for Readability parsing.
	 * @returns {void} Removes tooltip behaviour for reader mode.
	 * - Normal tooltips: unwrap trigger, drop tooltip content.
	 * - Translation tooltips: unwrap translation content, drop trigger.
	 */
	parseTooltips(doc: unknown): void {
		if (!(doc instanceof Document)) return;

		const renderedTooltips = Array.from(doc.querySelectorAll<HTMLElement>(".tooltip"));
		for (const tooltip of renderedTooltips) {
			const translationContent = tooltip.querySelector<HTMLElement>(".tooltip-content.translation");
			if (translationContent && (translationContent.textContent || "").trim()) {
				const frag = doc.createDocumentFragment();
				for (const n of Array.from(translationContent.childNodes)) {
					frag.appendChild(n.cloneNode(true));
				}
				tooltip.replaceWith(frag);
				continue;
			}

			const trigger = tooltip.querySelector<HTMLElement>(".tooltip-trigger");
			if (!trigger) {
				tooltip.remove();
				continue;
			}

			const frag = doc.createDocumentFragment();
			for (const n of Array.from(trigger.childNodes)) {
				frag.appendChild(n.cloneNode(true));
			}

			tooltip.replaceWith(frag);
		}

		const rawTooltips = Array.from(doc.getElementsByTagName("tooltip"));
		for (const tooltip of rawTooltips) {
			const contentEl = Array.from(tooltip.children).find(
				(n) => n.tagName.toLowerCase() === "content"
			) as Element | undefined;

			if (!contentEl) {
				tooltip.remove();
				continue;
			}

			const translationAttr = (contentEl.getAttribute("translation") || "").trim().toLowerCase();
			const isTranslation = translationAttr === "true";
			const nodes = isTranslation
				? Array.from(contentEl.childNodes)
				: [];
			const emptyTranslation =
				isTranslation &&
				(nodes.length === 0 || (contentEl.textContent || "").trim() === "");

			if (emptyTranslation) {
				tooltip.remove();
				continue;
			}

			if (isTranslation) {
				const frag = doc.createDocumentFragment();

				for (const n of nodes) {
					frag.appendChild(n.cloneNode(true));
				}

				tooltip.replaceWith(frag);
				continue;
			}

			const triggerNodes = Array.from(tooltip.childNodes).filter((n) => n !== contentEl);
			if (triggerNodes.length === 0) {
				tooltip.remove();
				continue;
			}

			const frag = doc.createDocumentFragment();
			for (const n of triggerNodes) {
				frag.appendChild(n.cloneNode(true));
			}

			tooltip.replaceWith(frag);
		}
	}

	/**
	 * @param {Document | Element} root - Root node to scan for chapter images.
	 * @returns {ChapterImageInfo[]}
	 */
	storeChapterImages(root: Document | Element = document): ChapterImageInfo[] {
		return Array.from(root.querySelectorAll<HTMLImageElement>("img.chapter-image")).map((img) => ({
			src: img.currentSrc || img.src,
			alt: img.alt,
			hasContainer: !!img.closest(".chapter-image-container")
		}));
	}

	/**
	 * @returns {Promise<void>}
	 */
	async ensureReadabilityLoaded(): Promise<void> {
		if (window.Readability) return;

		await new Promise<void>((resolve, reject) => {
			const script = document.createElement("script");
			script.src = "https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.min.js";
			script.onload = () => resolve();
			script.onerror = () => reject(new Error("Failed to load Readability"));
			document.head.appendChild(script);
		});
	}

	/**
	 * @param {unknown} list - Stored image metadata list.
	 * @param {Document | Element} root - Root element where images should be restored.
	 * @returns {void}
	 */
	restoreChapterImages(list: unknown, root: Document | Element): void {
		if (!Array.isArray(list) || !root) return;
		const imgs = root.querySelectorAll<HTMLImageElement>("img");

		(list as ReadonlyArray<ChapterImageInfo>).forEach(({ src, alt, hasContainer }) => {
			const img = Array.from(imgs).find((i) => (i.currentSrc || i.src) === src && i.alt === alt);
			if (!img) return;

			img.classList.add("chapter-image");

			if (hasContainer && !img.closest(".chapter-image-container")) {
				const wrapper =
					(root as unknown as { createElement?: (tag: string) => HTMLElement }).createElement?.("div") ||
					document.createElement("div");
				wrapper.className = "chapter-image-container";
				img.replaceWith(wrapper);
				wrapper.appendChild(img);
			}
		});

		activateImageNavigation(document);
	}

	/**
	 * @param {unknown} doc - Document clone to sanitise for Readability parsing.
	 * @returns {void} Keeps only From/To/Subject and the email body (without signature) for reader mode.
	 */
	parseEmails(doc: unknown): void {
		if (!(doc instanceof Document)) return;

		const cards = Array.from(doc.querySelectorAll<HTMLElement>(".email-card"));
		if (cards.length === 0) return;

		const getLabel = (row: Element): string =>
			(row.querySelector(".email-label")?.textContent || "").trim().toLowerCase();

		const getNameFor = (card: Element, labelLower: string): string => {
			const rows = Array.from(card.querySelectorAll<HTMLElement>(".email-row"));
			const row = rows.find((r) => getLabel(r) === labelLower);
			if (!row) return "";

			const nameEl = row.querySelector<HTMLElement>(".email-name")
				|| row.querySelector<HTMLElement>(".email-value");
			return (nameEl?.textContent || "").trim();
		};

		const getSubject = (card: Element): string =>
			(card.querySelector<HTMLElement>(".email-subject-text")?.textContent || "").trim();

		const splitParagraphs = (text: string): string[] => {
			const t = (text || "").replace(/\r\n?/g, "\n");
			return t
				.split(/\n+/g)
				.map((p) => p.replace(/\s+/g, " ").trim())
				.filter(Boolean);
		};

		for (const card of cards) {
			const fromName = getNameFor(card, "from");
			const toName = getNameFor(card, "to");
			const subject = getSubject(card);

			const contentClone = card.querySelector<HTMLElement>(".email-content")?.cloneNode(true) as HTMLElement | null;
			if (contentClone) {
				contentClone.querySelectorAll(".email-signature, .email-signature-sep").forEach((n) => n.remove());
			}

			const bodyRaw = contentClone ? (contentClone.innerText || contentClone.textContent || "") : "";
			const bodyParas = splitParagraphs(bodyRaw);

			const replacement = doc.createElement("div");
			replacement.className = "reader-email";

			const addLine = (label: string, value: string): void => {
				if (!value) return;
				const p = doc.createElement("p");
				p.textContent = `${label}: ${value}`;
				replacement.appendChild(p);
			};

			addLine("From", fromName);
			addLine("To", toName);
			addLine("Subject", subject);

			for (const para of bodyParas) {
				const p = doc.createElement("p");
				p.textContent = para;
				replacement.appendChild(p);
			}

			const wrapper = card.closest<HTMLElement>(".email-wrapper") ?? card;
			wrapper.replaceWith(replacement);
		}

		doc.querySelectorAll(".email-actions-bar").forEach((n) => n.remove());
	}

	/**
	 * @returns {Promise<void>} Enables reader mode by parsing the current document with Readability.
	 */
	async enableReaderMode(): Promise<void> {
		if (this.readerActive) return;

		const imgArray = this.storeChapterImages(document);
		const { storyPath, chapter } = getParams();

		await this.ensureReadabilityLoaded();

		const articleElem = document.querySelector<HTMLElement>("article#reader, main article, article");
		if (!articleElem) {
			alert("No article found for reader mode.");
			return;
		}

		if (!this.originalNodeClone) {
			this.originalNodeClone = articleElem.cloneNode(true);
		}

		const docClone = document.cloneNode(true) as Document;
		this.parseTooltips(docClone);
		this.parseEmails(docClone);

		const ReadabilityCtor = window.Readability;
		if (!ReadabilityCtor) return;

		const reader = new ReadabilityCtor(docClone);
		const parsed = reader.parse();
		if (!(parsed && parsed.content)) return;

		const parser = new DOMParser();
		const parsedDoc = parser.parseFromString(parsed.content, "text/html");

		const htmlContent = storyPath
			? await injectBookmarksIntoHTML(parsedDoc.body.innerHTML, storyPath, chapter)
			: parsedDoc.body.innerHTML;

		articleElem.innerHTML = htmlContent;
		this.restoreChapterImages(imgArray, articleElem);

		const articleObj = document.getElementById("reader");
		if (articleObj) {
			articleObj.classList.add("reader-container");
		}

		const focusRoot = this.resolveFocusRoot(articleElem);
		const keepRoots = this.collectKeepRoots(focusRoot);

		document.body.classList.add("reader-mode");
		this.applyReaderShell(focusRoot, keepRoots);

		const url = new URL(window.location.href);
		if (!url.searchParams.has("reader")) {
			url.searchParams.set("reader", "true");
			window.history.pushState({}, "", url);
		}

		this.readerToggle.classList.add("active");
		void showToggleVisual(this.readerToggle, "disable", READER_TOGGLE_ICON_SPEC);
		this.readerActive = true;
	}

	/**
	 * @returns {Promise<void>}
	 */
	async __hardSoftReload(): Promise<void> {
		const url = new URL(window.location.href);
		url.searchParams.delete("reader");
		url.searchParams.set("_", Date.now().toString());
		window.location.replace(url.toString());
	}

	/**
	 * @returns {Promise<void>}
	 */
	async disableReaderMode(): Promise<void> {
		await this.__hardSoftReload();
	}

	/**
	 * @returns {Promise<void>}
	 */
	async handleToggleClick(): Promise<void> {
		if (this.readerActive) {
			await this.disableReaderMode();
			return;
		}

		await this.enableReaderMode();
	}
}

export const setupReaderToggle = ReaderToggle.setup;