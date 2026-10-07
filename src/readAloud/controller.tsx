import type { ReactElement } from "react";
import { forceBookmark } from "../reader.tsx";
import { factory, type Modal } from "../modals.ts";
import * as loader from "../loader.ts";
import { render2Mkup } from "../reactHelpers.tsx";
import * as helpers from "../helpers.ts";
import { showToggleVisual } from "../toggleIcons.ts";
import type {
  ReadAloudBuffer,
  ReadAloudButtons,
  ReadAloudParagraphSpeech,
  ReadAloudReq,
  ReadAloudSsmlToken,
  ReadAloudState,
  RegionProbeResult,
  RegionResolveReason,
  RegionResolveResult,
  SpeechConfig,
  SpeechResource,
  SpeechSdkNamespace,
  SpeechSynthesizer,
  SynthesisResult,
  VoiceOption
} from "./types.ts";
import {
  RaHelp,
  RaMenu,
  RegionProbe
} from "./views.tsx";

const READ_ALOUD_TOGGLE_ICON_SPEC = {
  size: 32,
  wrapperClass: "theme-toggle-button__icon",
  svgClass: "theme-toggle-button__svg"
} as const;

function queryEl(selector: string): HTMLElement | null {
  const el = document.querySelector(selector);
  return el instanceof HTMLElement ? el : null;
}

class ReadAloudModule {
  #SDK_CDN: string;
  #buttons: ReadAloudButtons;
  #EYE_OPEN_SVG: string;
  #EYE_CLOSED_SVG: string;
  #svgCache: Map<string, string>;
  #VOICES: readonly VoiceOption[];
  #REGIONS: readonly string[];
  #MENU_HTML: string;
  #HELP_MODAL: string;
  #JUMP_VIS_KEY = "readAloudJumpVisible";
  #SPEECH_RESOURCE_KEY = "readAloudSpeechResource";
  #READALOUD_META_ATTR = "data-readaloud";
  #regionResolvePromise: Promise<RegionResolveResult> | null = null;
  #customModalsById = new Map<string, Modal>();
  #activeSynths = new Set<SpeechSynthesizer>();
  #reqs = new Map<string, ReadAloudReq>();
  #bufs = new Map<string, ReadAloudBuffer>();
  #bufCap = 4;
  #reqSig: string | null = null;
  #elemsToIgnore = [
    ".reader-paragraph-num",
    ".bookmark-emoji",
    ".tooltip-content",
    "tooltip > content"
  ];
  #boundShowMenu: () => void;
  #boundReload: () => Promise<void>;
  #boundCloseMenu: () => void;
  #boundMenuVis: () => void;
  #menuResizeObserver: ResizeObserver | null = null;
  #onControlsDetach: ((e: Event) => void) | null = null;

  constructor() {
    this.#SDK_CDN =
      "https://kittycrow.dev/external?src=https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.44.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle.js";

    this.#buttons = {
      play: { icon: "▶️", action: "Start Read Aloud" },
      pause: { icon: "⏸️", action: "Pause Read Aloud" },
      stop: { icon: "⏹️", action: "Stop Read Aloud" },
      next: { icon: "⏩", action: "Next Paragraph" },
      prev: { icon: "⏪", action: "Previous Paragraph" },
      restart: { icon: "⏮️", action: "Restart" },
      config: { icon: "⚙️", action: "Configure Read Aloud" },
      hide: { icon: "👁️", action: "Hides Read Aloud menu" },
      info: { icon: "ℹ️", action: "Show Info" },
      jump: { icon: "🧭", action: "Show or hide jump to paragraph" },
      help: { icon: "❓", action: "Help" }
    };

    this.#EYE_OPEN_SVG = "../images/eyeopen.svg";
    this.#EYE_CLOSED_SVG = "../images/eyeclosed.svg";
    this.#svgCache = new Map<string, string>();

    this.#VOICES = [
      { name: "en-US-JennyNeural", locale: "en-US", description: "American English (US), Female, Jenny (default)" },
      { name: "en-US-AriaNeural", locale: "en-US", description: "American English (US), Female, Aria" },
      { name: "en-GB-SoniaNeural", locale: "en-GB", description: "British English (UK), Female, Sonia" },
      { name: "en-GB-LibbyNeural", locale: "en-GB", description: "British English (UK), Female, Libby" },
      { name: "en-AU-NatashaNeural", locale: "en-AU", description: "Australian English (AU), Female, Natasha" },
      { name: "en-CA-ClaraNeural", locale: "en-CA", description: "Canadian English (CA), Female, Clara" },
      { name: "en-IN-NeerjaNeural", locale: "en-IN", description: "Indian English (IN), Female, Neerja" },
      { name: "en-NZ-MollyNeural", locale: "en-NZ", description: "New Zealand English (NZ), Female, Molly" },
      { name: "en-IE-EmilyNeural", locale: "en-IE", description: "Irish English (IE), Female, Emily" },
      { name: "en-ZA-LeahNeural", locale: "en-ZA", description: "South African English (ZA), Female, Leah" }
    ] as const;

    this.#REGIONS = [
      "eastus", "eastus2", "southcentralus", "westus2", "westus3",
      "australiaeast", "southeastasia", "northeurope", "swedencentral",
      "uksouth", "westeurope", "centralus", "northcentralus",
      "westus", "southafricanorth", "centralindia", "eastasia",
      "japaneast", "japanwest", "koreacentral", "canadacentral",
      "francecentral", "germanywestcentral", "norwayeast", "switzerlandnorth",
      "uaenorth", "brazilsouth"
    ] as const;

    this.#MENU_HTML = render2Mkup(
      <RaMenu buttons={this.#buttons} voices={this.#VOICES} regions={this.#REGIONS} />
    );

    this.#HELP_MODAL = render2Mkup(<RaHelp />);

    this.#boundShowMenu = () => this.showMenu();
    this.#boundReload = async () => this.reloadReadAloud();
    this.#boundCloseMenu = () => {
      void this.__closeMenu();
    };
    this.#boundMenuVis = () => this.__toggleVis();

    window.readAloudState = {
      paused: true,
      pressed: false,
      currentPIdx: 0,
      currentPid: null,
      paragraphs: [],
      synthesiser: null,
      lastSpokenText: "",
      voiceName: this.#VOICES[0].name,
      speechKey: "",
      serviceRegion: "",
      speechRate: 1.0,
      configVisible: false,
      menuVisible: true,
      jumpVisible: true,
      buffer: null,
      currentAudio: null,
      currentAudioUrl: null,
      apiKeyVisible: false,
      regionUiVisible: false,
      MSTimer: null,
      MStoken: 0,
      playbackToken: 0,
      originalMenuDisplay: undefined
    };

    this.#onControlsDetach = (e: Event) => {
      const ev = e as CustomEvent<{ detached: boolean }>;
      const detached = !!ev.detail?.detached;
      this.__positionMenu(detached);
    };

    window.addEventListener("reader:controls-detached", this.#onControlsDetach);
  }

  /**
   * @returns {() => void} Handler that shows the menu.
   */
  getMenuHndlr(): () => void {
    return this.#boundShowMenu;
  }

  /**
   * @returns {() => Promise<void>} Handler that refreshes paragraph list.
   */
  getReloadHndlr(): () => Promise<void> {
    return this.#boundReload;
  }

  /**
   * @returns {Promise<SpeechSdkNamespace>} Speech SDK namespace.
   */
  async __sdkReady(): Promise<SpeechSdkNamespace> {
    if (window.SpeechSDK) return window.SpeechSDK;
    if (window._speechSDKReadyPromise) return window._speechSDKReadyPromise;

    window._speechSDKReadyPromise = (async () => {
      await loader.loadScript(this.#SDK_CDN);

      if (!window.SpeechSDK) {
        throw new Error("SpeechSDK loaded but not available on window");
      }

      return window.SpeechSDK;
    })().catch((err: unknown) => {
      window._speechSDKReadyPromise = null;
      throw err;
    });

    return window._speechSDKReadyPromise;
  }

  /**
   * @param {string} path - SVG file path.
   * @returns {Promise<string>} Raw SVG markup.
   */
  async __getSvgMarkup(path: string): Promise<string> {
    const cached = this.#svgCache.get(path);
    if (cached) return cached;

    const res = await fetch(path, { cache: "force-cache" });
    if (!res.ok) throw new Error(`Failed to load SVG: ${path}`);

    const svg = await res.text();
    this.#svgCache.set(path, svg);
    return svg;
  }

  /**
   * @param {HTMLInputElement | null} apikeyInput - API key input.
   * @param {HTMLElement | null} apikeyEye - Eye button container.
   * @param {boolean} visible - Whether to show the key.
   * @returns {Promise<void>} Resolves once UI is updated.
   */
  async __applyApiKeyVisibility(
    apikeyInput: HTMLInputElement | null,
    apikeyEye: HTMLElement | null,
    visible: boolean
  ): Promise<void> {
    if (!apikeyInput || !apikeyEye) return;

    apikeyInput.type = visible ? "text" : "password";
    window.readAloudState.apiKeyVisible = visible;

    const willShow = !visible;

    apikeyEye.setAttribute("aria-label", willShow ? "Show API key" : "Hide API key");
    apikeyEye.setAttribute("title", willShow ? "Show API key" : "Hide API key");

    apikeyEye.replaceChildren();

    const src = willShow ? this.#EYE_OPEN_SVG : this.#EYE_CLOSED_SVG;

    try {
      const raw = await this.__getSvgMarkup(src);
      const doc = new DOMParser().parseFromString(raw, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) throw new Error("Invalid SVG");

      svg.querySelectorAll("foreignObject").forEach((n) => n.remove());
      apikeyEye.appendChild(document.importNode(svg, true));
    } catch {
      apikeyEye.textContent = willShow ? "🙊" : "🙈";
    }
  }

  /**
   * @param {string} unsafe - Text to escape.
   * @returns {string} Escaped XML.
   */
  __escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'\"]/g, (c) => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      "\"": "&quot;"
    }[c] ?? c));
  }

  /**
   * @param {number} ms - Sleep duration.
   * @returns {Promise<void>} Resolves after timeout.
   */
  __sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  }

  /**
   * @returns {SpeechResource | null} Stored speech resource or null.
   */
  __readSpeechResource(): SpeechResource | null {
    const raw = localStorage.getItem(this.#SPEECH_RESOURCE_KEY);
    if (!raw) return null;

    try {
      const parsedUnknown: unknown = JSON.parse(raw);
      if (!helpers.isRecord(parsedUnknown)) return null;

      const speechKey = typeof parsedUnknown.speechKey === "string" ? parsedUnknown.speechKey : "";
      const region = typeof parsedUnknown.region === "string" ? parsedUnknown.region : "";
      const regionLocked = typeof parsedUnknown.regionLocked === "boolean" ? parsedUnknown.regionLocked : false;

      return { speechKey, region, regionLocked };
    } catch {
      return null;
    }
  }

  /**
   * @param {Partial<SpeechResource> | null | undefined} next - Next values.
   * @returns {void} Nothing.
   */
  __writeSpeechResource(next: Partial<SpeechResource> | null | undefined): void {
    const safe = {
      speechKey: String(next?.speechKey || ""),
      region: String(next?.region || ""),
      regionLocked: Boolean(next?.regionLocked),
      updatedAt: Date.now()
    };

    localStorage.setItem(this.#SPEECH_RESOURCE_KEY, JSON.stringify(safe));
  }

  /**
   * @returns {void} Nothing.
   */
  __migrateResource(): void {
    const already = this.__readSpeechResource();
    if (already) return;

    const legacyKey = localStorage.getItem("readAloudSpeechApiKey") || "";
    const legacyRegion = localStorage.getItem("readAloudSpeechRegion") || "";

    if (!legacyKey && !legacyRegion) return;

    this.__writeSpeechResource({
      speechKey: legacyKey,
      region: legacyRegion,
      regionLocked: legacyRegion !== ""
    });

    localStorage.removeItem("readAloudSpeechApiKey");
    localStorage.removeItem("readAloudSpeechRegion");
  }

  /**
   * @param {string} speechKey - Azure subscription key.
   * @param {string} region - Candidate region.
   * @returns {Promise<RegionProbeResult>} Probe result.
   */
  async __probeRegionForKey(speechKey: string, region: string): Promise<RegionProbeResult> {
    if (!speechKey || !region) return { ok: false, status: 0 };

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3500);

    try {
      const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
      const res = await fetch(url, {
        method: "GET",
        headers: { "Ocp-Apim-Subscription-Key": speechKey },
        signal: controller.signal
      });

      return { ok: res.ok, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  /**
   * @param {string} speechKey - Azure subscription key.
   * @param {string} preferredRegion - Preferred region.
   * @returns {Promise<RegionResolveResult>} Resolved region or failure reason.
   */
  async __resolveRegionForKey(speechKey: string, preferredRegion: string): Promise<RegionResolveResult> {
    const regions = this.#REGIONS.slice();
    const ordered = preferredRegion
      ? [preferredRegion, ...regions.filter((r) => r !== preferredRegion)]
      : regions;

    for (const region of ordered) {
      const probe = await this.__probeRegionForKey(speechKey, region);

      if (probe.status === 429) {
        return { region: null, reason: "rate_limited" };
      }

      if (probe.ok) {
        return { region, reason: "ok" };
      }

      await this.__sleep(140);
    }

    return { region: null, reason: "not_found" };
  }

  /**
   * @param {string} speechKey - Azure subscription key.
   * @param {string} preferredRegion - Cached preferred region.
   * @returns {Promise<RegionResolveResult>} Resolved region or failure reason.
   */
  async __ensureRegionForKey(speechKey: string, preferredRegion: string): Promise<RegionResolveResult> {
    if (!speechKey) return { region: null, reason: "no_key" };
    if (this.#regionResolvePromise) return this.#regionResolvePromise;

    this.#regionResolvePromise = (async () => {
      const result = await this.__resolveRegionForKey(speechKey, preferredRegion);
      return result;
    })().finally(() => {
      this.#regionResolvePromise = null;
    });

    return this.#regionResolvePromise;
  }

  /**
   * @param {string} raw - Raw JSON or plain text.
   * @returns {unknown | null} Parsed JSON or null.
   */
  __safeJsonParse(raw: string): unknown | null {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} raw - Raw text.
   * @returns {string} Text with collapsed whitespace.
   */
  __normSpace(raw: string): string {
    return raw.replace(/\s+/g, " ").trim();
  }

  /**
   * @param {string} ssml - Inline SSML fragment.
   * @returns {boolean} True if fragment should be rejected.
   */
  __isUnsafeInlineSsml(ssml: string): boolean {
    const lower = ssml.toLowerCase();
    const blocked = [
      "<speak", "</speak",
      "<voice", "</voice",
      "<prosody", "</prosody",
      "<audio", "</audio"
    ];

    return blocked.some((t) => lower.includes(t));
  }

  /**
   * @param {string} raw - Attribute value from data-readaloud.
   * @returns {string} Text that should be spoken.
   */
  __tTextFromAttr(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "";

    const parsed = this.__safeJsonParse(trimmed);
    if (parsed === null) return trimmed;
    if (typeof parsed === "string") return parsed.trim();

    if (!helpers.isRecord(parsed)) return trimmed;

    const textRaw = parsed["text"];
    const text = typeof textRaw === "string" ? textRaw.trim() : "";
    if (text) return text;

    const speakRaw = parsed["speak"];
    const speak = typeof speakRaw === "string" ? speakRaw.trim() : "";
    if (speak) return speak;

    return trimmed;
  }

  /**
   * @param {string} raw - Attribute value from data-readaloud.
   * @returns {Readonly<{ kind: "text" | "ssml"; value: string }> | null} Override payload.
   */
  __readOverrideFromAttr(
    raw: string
  ): Readonly<{ kind: "text" | "ssml"; value: string }> | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const parsed = this.__safeJsonParse(trimmed);

    if (parsed === null) return { kind: "text", value: trimmed };
    if (typeof parsed === "string") return { kind: "text", value: parsed.trim() };
    if (!helpers.isRecord(parsed)) return { kind: "text", value: trimmed };

    const ssmlRaw = parsed["ssml"];
    const ssml = typeof ssmlRaw === "string" ? ssmlRaw.trim() : "";

    if (ssml && this.__isUnsafeInlineSsml(ssml)) {
      return { kind: "text", value: trimmed };
    }

    if (ssml) return { kind: "ssml", value: ssml };

    const textRaw = parsed["text"];
    const text = typeof textRaw === "string" ? textRaw.trim() : "";
    if (text) return { kind: "text", value: text };

    const speakRaw = parsed["speak"];
    const speak = typeof speakRaw === "string" ? speakRaw.trim() : "";
    if (speak) return { kind: "text", value: speak };

    return { kind: "text", value: trimmed };
  }

  /**
   * Adds read-aloud metadata to tooltips so speech prefers translations when available.
   * @param {HTMLElement} root - Root to scan.
   * @returns {void} Nothing.
   */
  __hydrateTTMeta(root: HTMLElement): void {
    const attr = this.#READALOUD_META_ATTR;

    const renderedTooltips = Array.from(root.querySelectorAll<HTMLElement>(".tooltip"));
    for (const tooltip of renderedTooltips) {
      const translationEl = tooltip.querySelector<HTMLElement>(".tooltip-content.translation");
      const translationText = (translationEl?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!translationText) continue;

      tooltip.setAttribute(attr, JSON.stringify({ text: translationText, kind: "tooltip_translation" }));
    }

    const rawTooltips = Array.from(root.getElementsByTagName("tooltip"));
    for (const tooltip of rawTooltips) {
      const contentEl = Array.from(tooltip.children).find((n) => n.tagName.toLowerCase() === "content") ?? null;
      if (!contentEl) continue;

      const translationAttr = (contentEl.getAttribute("translation") ?? "").trim().toLowerCase();
      if (translationAttr !== "true") continue;

      const translationText = (contentEl.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!translationText) continue;

      tooltip.setAttribute(attr, JSON.stringify({ text: translationText, kind: "tooltip_translation" }));
    }
  }

  /**
   * Applies read-aloud metadata. Text overrides become textContent, SSML overrides become tokens.
   * @param {HTMLElement} root - Root to scan.
   * @returns {Map<string, ReadAloudSsmlToken>} Token map for SSML substitutions.
   */
  __applyMeta(root: HTMLElement): Map<string, ReadAloudSsmlToken> {
    const attr = this.#READALOUD_META_ATTR;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`)).reverse();

    const tokens = new Map<string, ReadAloudSsmlToken>();
    let tokenIdx = 0;

    for (const el of nodes) {
      const raw = el.getAttribute(attr) ?? "";
      const override = this.__readOverrideFromAttr(raw);
      if (!override) continue;

      if (override.kind === "ssml") {
        const fallbackText = this.__normSpace(el.textContent ?? "");
        const token = `__RA_SSML_${tokenIdx}__`;
        tokenIdx += 1;

        tokens.set(token, { ssml: override.value, fallbackText });
        el.textContent = token;
        continue;
      }

      el.textContent = override.value;
    }

    return tokens;
  }

  /**
   * @param {HTMLElement | null} paragraph - Paragraph wrapper.
   * @param {string[] | null} elemsToIgnore - Optional extra ignore selectors.
   * @returns {ReadAloudParagraphSpeech} Plain text and optional SSML body.
   */
  __paragSpeech(
    paragraph: HTMLElement | null,
    elemsToIgnore: string[] | null = null
  ): ReadAloudParagraphSpeech {
    if (!paragraph) return { plainText: "", ssmlBody: null };

    const ignoreList = elemsToIgnore ?? this.#elemsToIgnore;
    const clone = paragraph.cloneNode(true) as HTMLElement;

    this.__hydrateTTMeta(clone);
    const ssmlTokens = this.__applyMeta(clone);

    if (ignoreList.length) {
      const ignoreStr = ignoreList.join(", ");
      clone.querySelectorAll(ignoreStr).forEach((n) => n.remove());
    }

    const withTokens = this.__normSpace(clone.textContent ?? "");
    if (!withTokens) return { plainText: "", ssmlBody: null };

    if (!ssmlTokens.size) return { plainText: withTokens, ssmlBody: null };

    let plainText = withTokens;
    let ssmlBody = this.__escapeXml(withTokens);

    for (const [token, meta] of ssmlTokens) {
      const fallback = meta.fallbackText || "";
      plainText = plainText.split(token).join(fallback);
      ssmlBody = ssmlBody.split(token).join(meta.ssml);
    }

    plainText = this.__normSpace(plainText);

    return { plainText, ssmlBody };
  }

  /**
   * @param {HTMLElement | null} paragraph - Paragraph wrapper.
   * @param {string[] | null} elemsToIgnore - Optional extra ignore selectors.
   * @returns {string} Plain text for speech.
   */
  __paragPlain(
    paragraph: HTMLElement | null,
    elemsToIgnore: string[] | null = null
  ): string {
    return this.__paragSpeech(paragraph, elemsToIgnore).plainText;
  }

  /**
   * @param {ReadAloudParagraphSpeech} speech - Speech content.
   * @param {string} voiceName - Voice name.
   * @param {number} rate - Rate multiplier.
   * @returns {string} SSML markup.
   */
  __buildSSML(speech: ReadAloudParagraphSpeech, voiceName: string, rate: number): string {
    const rateMap: Record<string, string> = {
      "0.5": "-50%",
      "0.75": "-25%",
      "1": "0%",
      "1.25": "25%",
      "1.5": "50%",
      "1.75": "75%",
      "2": "100%"
    };

    const prosodyRate = rateMap[String(rate)] || "95%";

    return `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
        xmlns:mstts="http://www.w3.org/2001/mstts"
        xml:lang="en-US">
        <voice name="${voiceName}">
          <prosody rate="${prosodyRate}">
            ${speech.ssmlBody ?? this.__escapeXml(speech.plainText)}
          </prosody>
        </voice>
      </speak>
    `;
  }

  /**
   * @param {boolean} visible - Whether to show region input.
   * @returns {void} Nothing.
   */
  __setRegionUiVisible(visible: boolean): void {
    const wrap = helpers.getEl("read-aloud-region-wrap");
    const btn = helpers.getEl("read-aloud-region-toggle");
    const fields = queryEl("#read-aloud-menu .read-aloud-fields");
    const apikeyWrap = queryEl("#read-aloud-menu .read-aloud-apikey-wrap");
    const regionInput = document.getElementById("read-aloud-region-input");

    if (!wrap || !btn || !fields || !apikeyWrap) return;
    if (!(regionInput instanceof HTMLInputElement)) return;

    if (visible) {
      wrap.style.display = "flex";
      wrap.appendChild(btn);
      btn.classList.add("read-aloud-apikey-eye");
      btn.setAttribute("title", "Hide region input");
      window.readAloudState.regionUiVisible = true;
      regionInput.focus();
      return;
    }

    wrap.style.display = "none";
    btn.classList.remove("read-aloud-apikey-eye");
    btn.setAttribute("title", "Set region manually");
    fields.insertBefore(btn, apikeyWrap);
    window.readAloudState.regionUiVisible = false;
  }

  /**
   * @returns {Promise<boolean>} True if handled and user was guided, else false.
   */
  async __handleRuntimeSpeakFailure(): Promise<boolean> {
    const state = window.readAloudState;
    if (!state.speechKey || !state.serviceRegion) return false;

    const stored = this.__readSpeechResource();
    if (!stored?.regionLocked) return false;

    const probe = await this.__probeRegionForKey(state.speechKey, state.serviceRegion);

    if (probe.status === 0) return false;

    if (probe.status === 429) {
      window.alert("Azure region check was rate limited. Please try again in a moment.");
      return true;
    }

    if (probe.ok) return false;

    window.alert(
      "Your Azure Speech region does not work with this API key. Check what you entered. " +
      "If you clear the region and press Play, the app will try to detect it automatically."
    );

    this.__toggleCnfg(true);
    this.__setRegionUiVisible(true);
    return true;
  }

  /**
   * @param {boolean} detached - Whether reader controls are detached.
   * @returns {void} Nothing.
   */
  __positionMenu(detached: boolean): void {
    const menu = helpers.getEl("read-aloud-menu");
    if (!menu) return;

    if (!detached) {
      menu.style.top = "0";
      menu.style.bottom = "";
      menu.style.transform = "translateX(-50%)";
      return;
    }

    const updateBottomAnchor = (): void => {
      const h = menu.offsetHeight;
      menu.style.top = `calc(100vh - ${h}px)`;
      menu.style.bottom = "";
      menu.style.transform = "translateX(-50%)";
    };

    updateBottomAnchor();

    if (!this.#menuResizeObserver) {
      this.#menuResizeObserver = new ResizeObserver(updateBottomAnchor);
      this.#menuResizeObserver.observe(menu);
    }
  }

  /**
   * @param {boolean} isPlaying - Whether playback is active.
   * @returns {void} Nothing.
   */
  __setPlayPauseButton(isPlaying: boolean): void {
    const btn = helpers.getEl("read-aloud-toggle-playpause");
    if (!btn) return;

    btn.textContent = isPlaying ? this.#buttons.pause.icon : this.#buttons.play.icon;
    btn.title = isPlaying ? this.#buttons.pause.action : this.#buttons.play.action;
  }

  /**
   * @returns {void} Nothing.
   */
  showMenu(): void {
    window.readAloudState.pressed = true;

    const toggleBtn = helpers.getEl("read-aloud-toggle");

    if (toggleBtn instanceof HTMLButtonElement) {
      void showToggleVisual(
        toggleBtn,
        "disable",
        READ_ALOUD_TOGGLE_ICON_SPEC
      );
    }

    if (toggleBtn) {
      toggleBtn.classList.add("active");
      toggleBtn.removeEventListener("click", this.#boundShowMenu);
      toggleBtn.addEventListener("click", this.#boundCloseMenu);
    }

    const menu = helpers.getEl("read-aloud-menu");
    if (!menu) {
      console.error("Read Aloud menu element not found in DOM");
      return;
    }

    if (menu.style.display === "flex") return;

    menu.innerHTML = this.#MENU_HTML;
    menu.style.display = "flex";

    this.__migrateResource();

    const apikeyInputEl = document.getElementById("read-aloud-apikey");
    const apikeyEyeEl = document.querySelector("#read-aloud-menu .read-aloud-apikey-eye");
    const regionToggleBtnEl = document.getElementById("read-aloud-region-toggle");
    const regionWrapEl = document.getElementById("read-aloud-region-wrap");
    const regionInputEl = document.getElementById("read-aloud-region-input");
    const fieldsWrapEl = document.querySelector("#read-aloud-menu .read-aloud-fields");
    const apikeyWrapEl = document.querySelector("#read-aloud-menu .read-aloud-apikey-wrap");
    const voiceDropdownEl = document.getElementById("read-aloud-voice");
    const rateDropdownEl = document.getElementById("read-aloud-rate");
    const playPauseBtnEl = document.getElementById("read-aloud-toggle-playpause");
    const stopBtnEl = document.getElementById("read-aloud-stop");
    const prevBtnEl = document.getElementById("read-aloud-prev");
    const nextBtnEl = document.getElementById("read-aloud-next");
    const restartBtnEl = document.getElementById("read-aloud-restart");
    const configBtnEl = document.getElementById("read-aloud-config");
    const hideBtnEl = document.getElementById("read-aloud-hide");
    const infoBtnEl = document.getElementById("read-aloud-info");
    const helpBtnEl = document.getElementById("read-aloud-help");
    const jumpToggleBtnEl = document.getElementById("read-aloud-jump-toggle");
    const jumpWrapEl = document.querySelector(".read-aloud-jump");
    const jumpInputEl = document.getElementById("read-aloud-jump-input");
    const jumpGoBtnEl = document.getElementById("read-aloud-jump-go");

    if (!(apikeyInputEl instanceof HTMLInputElement)) return;
    if (!(apikeyEyeEl instanceof HTMLElement)) return;
    if (!(regionToggleBtnEl instanceof HTMLElement)) return;
    if (!(regionWrapEl instanceof HTMLElement)) return;
    if (!(regionInputEl instanceof HTMLInputElement)) return;
    if (!(fieldsWrapEl instanceof HTMLElement)) return;
    if (!(apikeyWrapEl instanceof HTMLElement)) return;
    if (!(voiceDropdownEl instanceof HTMLSelectElement)) return;
    if (!(rateDropdownEl instanceof HTMLSelectElement)) return;
    if (!(playPauseBtnEl instanceof HTMLButtonElement)) return;
    if (!(stopBtnEl instanceof HTMLButtonElement)) return;
    if (!(prevBtnEl instanceof HTMLButtonElement)) return;
    if (!(nextBtnEl instanceof HTMLButtonElement)) return;
    if (!(restartBtnEl instanceof HTMLButtonElement)) return;
    if (!(configBtnEl instanceof HTMLButtonElement)) return;
    if (!(hideBtnEl instanceof HTMLButtonElement)) return;
    if (!(infoBtnEl instanceof HTMLButtonElement)) return;
    if (!(helpBtnEl instanceof HTMLButtonElement)) return;
    if (!(jumpToggleBtnEl instanceof HTMLButtonElement)) return;
    if (!(jumpWrapEl instanceof HTMLElement)) return;
    if (!(jumpInputEl instanceof HTMLInputElement)) return;
    if (!(jumpGoBtnEl instanceof HTMLButtonElement)) return;

    const menuElements = {
      apikeyInput: apikeyInputEl,
      apikeyEye: apikeyEyeEl,
      regionToggleBtn: regionToggleBtnEl,
      regionWrap: regionWrapEl,
      regionInput: regionInputEl,
      fieldsWrap: fieldsWrapEl,
      apikeyWrap: apikeyWrapEl,
      voiceDropdown: voiceDropdownEl,
      rateDropdown: rateDropdownEl,
      playPauseBtn: playPauseBtnEl,
      stopBtn: stopBtnEl,
      prevBtn: prevBtnEl,
      nextBtn: nextBtnEl,
      restartBtn: restartBtnEl,
      configBtn: configBtnEl,
      hideBtn: hideBtnEl,
      infoBtn: infoBtnEl,
      helpBtn: helpBtnEl,
      jumpToggleBtn: jumpToggleBtnEl,
      jumpWrap: jumpWrapEl,
      jumpInput: jumpInputEl,
      jumpGoBtn: jumpGoBtnEl
    };

    const stored = this.__readSpeechResource();
    menuElements.apikeyInput.value = stored?.speechKey || "";
    menuElements.regionInput.value = stored?.region || "";
    menuElements.regionInput.style.paddingRight = "44px";

    const savedJumpVis = localStorage.getItem(this.#JUMP_VIS_KEY);
    const jumpVisible = savedJumpVis == null ? true : savedJumpVis === "true";
    this.__toggleJump(jumpVisible);

    void this.__applyApiKeyVisibility(
      menuElements.apikeyInput,
      menuElements.apikeyEye,
      !!window.readAloudState.apiKeyVisible
    );

    /**
     * @returns {void} Nothing.
     */
    const toggleApiKeyVisibility = (): void => {
      const visibleNow = menuElements.apikeyInput.type === "text";
      void this.__applyApiKeyVisibility(
        menuElements.apikeyInput,
        menuElements.apikeyEye,
        !visibleNow
      );
    };

    menuElements.apikeyEye.addEventListener("click", toggleApiKeyVisibility);

    menuElements.apikeyEye.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleApiKeyVisibility();
    });

    this.__toggleCnfg(
      !localStorage.getItem("readAloudConfigMenuHidden") ||
        localStorage.getItem("readAloudConfigMenuHidden") === "false"
        ? true
        : window.readAloudState.configVisible
    );

    this.__setRegionUiVisible(!!window.readAloudState.regionUiVisible);

    menuElements.regionToggleBtn.addEventListener("click", () => {
      const next = !window.readAloudState.regionUiVisible;
      this.__setRegionUiVisible(next);
    });

    menuElements.regionInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const raw = menuElements.regionInput.value.trim().toLowerCase();
      this.__saveRegion(raw);
      this.__setRegionUiVisible(false);
    });

    menuElements.voiceDropdown.value =
      localStorage.getItem("readAloudPreferredVoice") || this.#VOICES[0].name;

    menuElements.rateDropdown.value = this.__getSpeechRate().toString();

    menuElements.apikeyInput.addEventListener("input", (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      this.__saveApiKey(t.value.trim());
    });

    menuElements.playPauseBtn.addEventListener("click", async () => {
      const state = window.readAloudState;

      if (!state.paused) {
        this.__setPlayPauseButton(false);
        await this.__pause();
        return;
      }

      const speechKey = menuElements.apikeyInput.value.trim();
      const voiceName = menuElements.voiceDropdown.value;

      state.speechKey = speechKey;
      state.voiceName = voiceName;

      if (!speechKey) {
        this.__setPlayPauseButton(false);
        window.alert("Please enter your Azure Speech API key.");
        return;
      }

      const storedBefore = this.__readSpeechResource();
      const storedKey = storedBefore?.speechKey || "";
      let storedRegion = storedBefore?.region || "";
      let storedRegionLocked = !!storedBefore?.regionLocked;

      if (storedKey !== speechKey) {
        this.__writeSpeechResource({
          speechKey,
          region: storedRegion,
          regionLocked: storedRegionLocked
        });
      }

      const typedRegion = menuElements.regionInput.value.trim().toLowerCase();
      const userEditingRegion = !!state.regionUiVisible;

      if (userEditingRegion && typedRegion === "") {
        storedRegion = "";
        storedRegionLocked = false;
        this.__writeSpeechResource({ speechKey, region: "", regionLocked: false });
      }

      const typedOverride = userEditingRegion && typedRegion !== "" && typedRegion !== storedRegion;
      const hasLockedRegion = typedOverride || (storedRegionLocked && storedRegion !== "");
      const lockedRegion = typedOverride ? typedRegion : storedRegion;
      const canReuseCached = !hasLockedRegion && storedKey === speechKey && storedRegion !== "";
      const regionDetectModalId = "readaloud-region-detect-modal";
      const regionDetectHtml = render2Mkup(<RegionProbe />);
      const shouldDetect = !hasLockedRegion && !canReuseCached;

      let resolved: RegionResolveResult;

      try {
        if (shouldDetect) {
          this.__openCustomModal(regionDetectHtml, regionDetectModalId);
          document.documentElement.classList.add("cursor-wait");
        }

        resolved = hasLockedRegion
          ? { region: lockedRegion, reason: "locked" }
          : canReuseCached
            ? { region: storedRegion, reason: "cached" }
            : await this.__ensureRegionForKey(speechKey, storedRegion);
      } finally {
        if (shouldDetect) {
          this.__closeCustomModal(regionDetectModalId);
          document.documentElement.classList.remove("cursor-wait");
        }
      }

      if (!resolved.region) {
        this.__setPlayPauseButton(false);

        window.alert(
          resolved.reason === "rate_limited"
            ? "Region check was rate limited. Please use the 🌍 button and enter your region manually, then try again."
            : "Could not find a working region for this key. Please use the 🌍 button and enter your region manually."
        );

        this.__toggleCnfg(true);
        this.__setRegionUiVisible(true);
        return;
      }

      state.serviceRegion = resolved.region;
      menuElements.regionInput.value = resolved.region;

      this.__writeSpeechResource({
        speechKey,
        region: resolved.region,
        regionLocked: hasLockedRegion
      });

      this.__setPlayPauseButton(true);

      if (!state.paragraphs.length) {
        await this.__readAloud(speechKey, state.serviceRegion, voiceName);
        return;
      }

      await this.__resume();
    });

    menuElements.stopBtn.addEventListener("click", async () => {
      this.__setPlayPauseButton(false);
      await this.__clear();
    });

    menuElements.infoBtn.addEventListener("click", () => {
      const info = Object.entries(this.#buttons)
        .map(([, val]) => `${val.icon} - ${val.action}`)
        .join("\n");
      window.alert(`Read Aloud Menu Buttons:\n\n${info}`);
    });

    menuElements.helpBtn.addEventListener("click", () => {
      this.__openCustomModal(this.#HELP_MODAL, "readaloud-help-modal");
    });

    menuElements.prevBtn.addEventListener("click", async () => {
      await this.__prevParagraph();
    });

    menuElements.nextBtn.addEventListener("click", async () => {
      await this.__nextParagraph();
    });

    menuElements.restartBtn.addEventListener("click", async () => {
      await this.__restartAll();
    });

    menuElements.configBtn.addEventListener("click", () => {
      this.__toggleCnfg();
    });

    menuElements.hideBtn.addEventListener("click", () => {
      this.__toggleVis();
    });

    menuElements.jumpToggleBtn.addEventListener("click", () => {
      this.__toggleJump();
    });

    /**
     * @returns {Promise<void>} Resolves after jump attempt.
     */
    const doJump = async (): Promise<void> => {
      const raw = menuElements.jumpInput.value.trim();
      if (!raw) return;

      const paragraphNumber = Number.parseInt(raw, 10);
      if (!Number.isFinite(paragraphNumber) || paragraphNumber <= 0) return;

      await this.__jumpToParagraphNumber(paragraphNumber);
    };

    menuElements.jumpGoBtn.addEventListener("click", async () => {
      await doJump();
    });

    menuElements.jumpInput.addEventListener("keydown", async (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      await doJump();
    });

    menuElements.rateDropdown.addEventListener("change", async (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLSelectElement)) return;

      const rate = Number.parseFloat(t.value);
      if (!Number.isFinite(rate)) return;

      window.readAloudState.speechRate = rate;
      this.__saveSpeechRate(rate);

      const state = window.readAloudState;
      const idx = state.currentPIdx;

      await this.__clearBuffer(state, idx).catch((err: unknown) => {
        console.error("[Change Rate] Error clearing Read Aloud buffer:", err);
      });
    });

    menuElements.voiceDropdown.addEventListener("change", async (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLSelectElement)) return;

      this.__savePreferredVoice(t.value);

      const voiceName = t.value;
      window.readAloudState.voiceName = voiceName;

      const state = window.readAloudState;
      const idx = state.currentPIdx;

      await this.__clearBuffer(state, idx).catch((err: unknown) => {
        console.error("[Change Voice] Error clearing Read Aloud buffer:", err);
      });
    });

    window.readAloudState.speechRate = this.__getSpeechRate();

    this.__enableNav();

    helpers.getEl("read-aloud-close")?.addEventListener("click", () => {
      this.#boundCloseMenu();
    });

    const fields = queryEl(".read-aloud-fields");
    if (fields) fields.style.display = window.readAloudState.configVisible ? "flex" : "none";

    const controls = queryEl(".reader-controls-top");
    this.__positionMenu(!!controls && controls.classList.contains("is-detached"));
  }

  /**
   * @returns {void} Nothing.
   */
  __enableNav(): void {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", async () => {
      await this.__resume();
    });

    navigator.mediaSession.setActionHandler("pause", async () => {
      await this.__pause();
    });

    navigator.mediaSession.setActionHandler("previoustrack", async () => {
      await this.__prevParagraph();
    });

    navigator.mediaSession.setActionHandler("nexttrack", async () => {
      await this.__nextParagraph();
    });
  }

  /**
   * @param {boolean | null} forceValue - Forced value or null to toggle.
   * @returns {boolean} New config visibility.
   */
  __toggleCnfg(forceValue: boolean | null = null): boolean {
    const fields = queryEl(".read-aloud-fields");
    const configBtn = helpers.getEl("read-aloud-config");
    if (!fields) return false;

    const newValue = forceValue !== null
      ? !!forceValue
      : !window.readAloudState.configVisible;

    fields.style.display = newValue ? "flex" : "none";
    if (configBtn) configBtn.classList.toggle("menu-crossed", newValue);

    window.readAloudState.configVisible = newValue;
    localStorage.setItem("readAloudConfigVisible", String(newValue));
    localStorage.setItem("readAloudConfigMenuHidden", String(!newValue));

    return newValue;
  }

  /**
   * @param {boolean | null} forceValue - Forced value or null to toggle.
   * @returns {boolean} New jump visibility.
   */
  __toggleJump(forceValue: boolean | null = null): boolean {
    const jumpWrap = queryEl(".read-aloud-jump");
    const btn = helpers.getEl("read-aloud-jump-toggle");
    if (!jumpWrap || !btn) return false;

    const current = window.readAloudState.jumpVisible;
    const newValue = forceValue !== null ? !!forceValue : !current;

    jumpWrap.style.display = newValue ? "flex" : "none";
    btn.classList.toggle("menu-crossed", newValue);

    window.readAloudState.jumpVisible = newValue;
    localStorage.setItem(this.#JUMP_VIS_KEY, String(newValue));

    return newValue;
  }

  /**
   * @returns {void} Nothing.
   */
  __toggleVis(): void {
    const menu = helpers.getEl("read-aloud-menu");
    const toggleBtn = helpers.getEl("read-aloud-toggle");
    if (!menu || !toggleBtn) return;

    if (!window.readAloudState.originalMenuDisplay) {
      const computed = window.getComputedStyle(menu).display;
      window.readAloudState.originalMenuDisplay = menu.style.display || computed || "flex";
    }

    const hidingMenu = window.readAloudState.menuVisible;

    if (hidingMenu && toggleBtn instanceof HTMLButtonElement) {
      void showToggleVisual(
        toggleBtn,
        "enable",
        READ_ALOUD_TOGGLE_ICON_SPEC
      );
    }

    if (hidingMenu) {
      menu.style.display = "none";
      window.readAloudState.menuVisible = false;

      toggleBtn.classList.remove("active");
      toggleBtn.classList.add("menu-eye");
      toggleBtn.removeEventListener("click", this.#boundCloseMenu);
      toggleBtn.addEventListener("click", this.#boundMenuVis);
      return;
    }

    menu.style.display = window.readAloudState.originalMenuDisplay || "flex";
    window.readAloudState.menuVisible = true;

    toggleBtn.classList.add("active");
    toggleBtn.classList.remove("menu-eye");

    if (toggleBtn instanceof HTMLButtonElement) {
      void showToggleVisual(toggleBtn, "disable", READ_ALOUD_TOGGLE_ICON_SPEC);
    }

    toggleBtn.removeEventListener("click", this.#boundMenuVis);
    toggleBtn.addEventListener("click", this.#boundCloseMenu);
  }

  /**
   * @returns {Promise<void>} Resolves after restart attempt.
   */
  async __restartAll(): Promise<void> {
    const state = window.readAloudState;
    state.paused = true;

    await this.__stopAllPlayback();

    if (!state.paragraphs.length) return;

    state.currentPIdx = 0;
    state.currentPid = state.paragraphs[0] ? state.paragraphs[0].id : null;
    state.paused = false;

    this.__setPlayPauseButton(true);
    await this.__speakP(0);
  }

  /**
   * @returns {Promise<void>} Resolves when menu is closed and speech paused.
   */
  async __closeMenu(): Promise<void> {
    const menu = helpers.getEl("read-aloud-menu");
    if (!menu) return;

    const toggleBtn = helpers.getEl("read-aloud-toggle");

    if (toggleBtn instanceof HTMLButtonElement) {
      void showToggleVisual(
        toggleBtn,
        "enable",
        READ_ALOUD_TOGGLE_ICON_SPEC
      );
    }

    if (toggleBtn) {
      toggleBtn.classList.remove("active");
      toggleBtn.removeEventListener("click", this.#boundCloseMenu);
      toggleBtn.addEventListener("click", this.#boundShowMenu);
    }

    menu.style.display = "none";

    this.__setPlayPauseButton(false);

    window.readAloudState.pressed = false;

    menu.style.left = "50%";
    menu.style.top = "0";
    menu.style.transform = "translateX(-50%)";

    await this.__pause();
  }

  /**
   * @param {string} speechKey - Azure subscription key.
   * @param {string} serviceRegion - Azure region.
   * @param {string} voiceName - Voice name.
   * @param {string} tag - Container tag name.
   * @param {string} id - Container id.
   * @param {string} className - Container class.
   * @param {string | null} startFromId - Optional paragraph id to start from.
   * @returns {Promise<void>} Resolves after starting speech.
   */
  async __readAloud(
    speechKey: string,
    serviceRegion: string,
    voiceName: string = this.#VOICES[0].name,
    tag: string = "article",
    id: string = "reader",
    className: string = "reader-container",
    startFromId: string | null = null
  ): Promise<void> {
    await this.__sdkReady();

    let selector = tag;
    if (id) selector += `#${id}`;
    if (className) selector += `.${className}`;

    const container = document.querySelector(selector);
    if (!(container instanceof HTMLElement)) {
      console.error(`Element not found: ${selector}`);
      return;
    }

    const paragraphs = Array.from(container.querySelectorAll<HTMLElement>(".reader-bookmark"));
    if (!paragraphs.length) {
      console.error("No paragraphs found for read aloud.");
      return;
    }

    const startIdx = this.__startIndex(paragraphs, startFromId);

    window.readAloudState.paused = false;
    window.readAloudState.currentPIdx = startIdx;
    window.readAloudState.currentPid = paragraphs[startIdx] ? paragraphs[startIdx].id : null;
    window.readAloudState.paragraphs = paragraphs;
    window.readAloudState.voiceName = voiceName;
    window.readAloudState.speechKey = speechKey;
    window.readAloudState.serviceRegion = serviceRegion;

    await this.__syncReqs();
    await this.__speakP(startIdx);
  }

  /**
   * @param {readonly HTMLElement[]} paragraphs - Paragraph elements.
   * @param {string | null} startFromId - Optional paragraph id.
   * @returns {number} Starting index.
   */
  __startIndex(paragraphs: readonly HTMLElement[], startFromId: string | null): number {
    const requestedIndex = startFromId
      ? paragraphs.findIndex((p) => p.id === startFromId)
      : -1;

    if (requestedIndex >= 0) return requestedIndex;

    const saved = localStorage.getItem("readAloudAudioPosition");
    if (!saved) return 0;

    let savedObjUnknown: unknown;
    try {
      savedObjUnknown = JSON.parse(saved);
    } catch {
      return 0;
    }

    if (!helpers.isRecord(savedObjUnknown)) return 0;

    const paragraphId =
      typeof savedObjUnknown.paragraphId === "string"
        ? savedObjUnknown.paragraphId
        : null;

    const savedIndex = paragraphId
      ? paragraphs.findIndex((p) => p.id === paragraphId)
      : -1;

    if (savedIndex >= 0) return savedIndex;

    const paragraphIndex = typeof savedObjUnknown.paragraphIndex === "number" ? savedObjUnknown.paragraphIndex : -1;
    if (paragraphIndex >= 0 && paragraphIndex < paragraphs.length) return paragraphIndex;

    return 0;
  }

  /**
   * @param {number} idx - Paragraph index.
   * @returns {Promise<void>} Resolves after the paragraph pipeline completes.
   */
  async __speakP(idx: number): Promise<void> {
    const state = window.readAloudState;
    if (state.paused || idx >= state.paragraphs.length) return;

    const playbackToken = state.playbackToken;

    if (
      state.currentPIdx !== undefined &&
      state.currentPIdx !== idx &&
      state.paragraphs[state.currentPIdx]
    ) {
      this.__FOHighlight(state.paragraphs[state.currentPIdx]);
    }

    const paragraph = state.paragraphs[idx] ?? null;
    this.__highlightP(paragraph);
    this.__scrollToP(paragraph);

    const plainText = this.__paragPlain(paragraph);
    const playbackChanged =
      state.playbackToken !== playbackToken ||
      state.paused;

    if (!plainText && playbackChanged) return;

    if (!plainText) {
      await this.__speakP(idx + 1);
      return;
    }

    if (!state.speechKey || !state.serviceRegion) {
      window.alert("Please enter your Azure Speech API key. The region will be detected automatically, or you can set it with 🌍.");
      return;
    }

    try {
      await this.__sdkReady();
      await this.__syncReqs();
    } catch {
      window.alert("Speech SDK could not be loaded. Please check your connection or script includes.");
      return;
    }

    if (state.playbackToken !== playbackToken || state.paused) return;

    state.currentPIdx = idx;
    state.currentPid = paragraph ? paragraph.id : null;
    state.lastSpokenText = plainText;

    localStorage.setItem("readAloudAudioPosition", JSON.stringify({
      paragraphId: state.currentPid,
      paragraphIndex: state.currentPIdx
    }));

    if (state.currentPid) forceBookmark(state.currentPid);

    try {
      const chunk = await this.__buf(idx);

      if (state.playbackToken !== playbackToken || state.paused) return;

      if (!chunk) {
        await this.__speakP(idx + 1);
        return;
      }

      await this.__updateMediaSession(plainText, chunk.timing.wordsPerSecond);

      if (state.playbackToken !== playbackToken || state.paused) return;

      this.__warm(idx + 1);

      await this.__playAudioBlob(chunk.audioData, playbackToken);

      if (state.playbackToken !== playbackToken || state.paused) return;
      await this.__speakP(idx + 1);
    } catch {
      if (state.playbackToken !== playbackToken) return;

      const handled = await this.__handleRuntimeSpeakFailure();
      if (!handled) {
        window.alert("Read Aloud stopped due to a connection issue.");
      }
      await this.__pause();
    }
  }

  /**
   * @param {string} plainText - Spoken paragraph text.
   * @param {number} wordsPerSecond - Measured words per second for this audio chunk.
   * @returns {Promise<void>} Nothing.
   */
  async __updateMediaSession(plainText: string, wordsPerSecond: number): Promise<void> {
    if (!("mediaSession" in navigator)) return;

    const titleChunks = this.__buildMSTitle(plainText, 60);
    await this.__startMSloop(titleChunks, wordsPerSecond);
  }

  /**
   * @param {string} plainText - Paragraph text.
   * @param {number} maxChars - Maximum characters per title chunk.
   * @returns {readonly string[]} Title chunks.
   */
  __buildMSTitle(plainText: string, maxChars: number = 60): readonly string[] {
    const words = plainText.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [""];

    const chunks: string[] = [];
    let currentChunk = "";

    for (const word of words) {
      if (!currentChunk) {
        currentChunk = word;
        continue;
      }

      const nextChunk = `${currentChunk} ${word}`;
      if (nextChunk.length <= maxChars) {
        currentChunk = nextChunk;
        continue;
      }

      chunks.push(currentChunk);
      currentChunk = word;
    }

    if (currentChunk) chunks.push(currentChunk);

    return chunks;
  }

  /**
   * @param {string} title - Media session title.
   * @returns {Promise<void>} Nothing.
   */
  async __setMSmeta(title: string): Promise<void> {
    if (!("mediaSession" in navigator)) return;

    const params = new URLSearchParams(window.location.search);
    const rawStory = params.get("story") || "";
    const chapter = params.get("chapter") || "";

    const storyName = decodeURIComponent(rawStory).split("/").pop() || "Unknown Story";
    const chapterName = `Chapter ${chapter}`;
    const artist = window.location.origin;

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: storyName,
      // @ts-ignore
      track: chapterName,
      artwork: []
    });
  }

  /**
   * @returns {Promise<void>} Nothing.
   */
  async __stopMSloop(): Promise<void> {
    const state = window.readAloudState;

    if (state.MSTimer !== null) {
      window.clearTimeout(state.MSTimer);
      state.MSTimer = null;
    }

    state.MStoken += 1;
  }

  /**
   * @param {string} text - Text to count words in.
   * @returns {number} Word count.
   */
  __countWords(text: string): number {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length;
  }

  /**
   * @returns {number} Estimated read speed in words per second.
   */
  __getEstimatedWordsPerSecond(): number {
    const state = window.readAloudState;

    const baseWordsPerSecondAt1x = 2.6;
    const effective = baseWordsPerSecondAt1x * state.speechRate;

    return effective > 0 ? effective : baseWordsPerSecondAt1x;
  }

  /**
   * @param {ArrayBuffer} audioData - MP3 data.
   * @returns {Promise<number>} Audio duration in seconds.
   */
  async __audioLength(audioData: ArrayBuffer): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const audioBlob = new Blob([audioData], { type: "audio/mp3" });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio();

      let settled = false;

      /**
       * @returns {void} Nothing.
       */
      const cleanup = (): void => {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        audio.src = "";
        URL.revokeObjectURL(audioUrl);
      };

      audio.preload = "metadata";

      audio.onloadedmetadata = () => {
        if (settled) return;
        settled = true;

        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        cleanup();

        if (duration > 0) {
          resolve(duration);
          return;
        }

        reject(new Error("Invalid audio duration"));
      };

      audio.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Could not read audio duration"));
      };

      audio.src = audioUrl;
      audio.load();
    });
  }

  /**
   * @param {string} plainText - Plain text used for synthesis.
   * @param {ArrayBuffer} audioData - Generated MP3 data.
   * @returns {Promise<ReadAloudAudioTiming>} Measured timing information.
   */
  async __audioTime(plainText: string, audioData: ArrayBuffer): Promise<ReadAloudAudioTiming> {
    const wordCount = this.__countWords(plainText);
    const fallbackWordsPerSecond = this.__getEstimatedWordsPerSecond();

    if (wordCount <= 0) {
      return {
        wordCount: 0,
        durationSeconds: 0,
        wordsPerSecond: fallbackWordsPerSecond
      };
    }

    let durationSeconds = wordCount / fallbackWordsPerSecond;

    try {
      const measuredDuration = await this.__audioLength(audioData);
      if (Number.isFinite(measuredDuration) && measuredDuration > 0) {
        durationSeconds = measuredDuration;
      }
    } catch {
      // Fall back to the rate-based estimate.
    }

    const wordsPerSecond = durationSeconds > 0
      ? wordCount / durationSeconds
      : fallbackWordsPerSecond;

    return {
      wordCount,
      durationSeconds,
      wordsPerSecond: wordsPerSecond > 0 ? wordsPerSecond : fallbackWordsPerSecond
    };
  }

  /**
   * @param {string} titleChunk - Title chunk currently being shown.
   * @param {number} wordsPerSecond - Measured words per second for the paragraph audio.
   * @returns {number} Delay in milliseconds before the next chunk.
   */
  __getMSChunkDelay(titleChunk: string, wordsPerSecond: number): number {
    const words = this.__countWords(titleChunk);
    const safeWordsPerSecond = wordsPerSecond > 0 ? wordsPerSecond : this.__getEstimatedWordsPerSecond();
    const delayMs = Math.round((Math.max(words, 1) / safeWordsPerSecond) * 1000);

    return Math.max(120, delayMs);
  }

  /**
   * @param {readonly string[]} titleChunks - Title chunks.
   * @param {number} wordsPerSecond - Measured words per second for the paragraph audio.
   * @returns {Promise<void>} Nothing.
   */
  async __startMSloop(titleChunks: readonly string[], wordsPerSecond: number): Promise<void> {
    if (!("mediaSession" in navigator)) return;

    await this.__stopMSloop();

    const state = window.readAloudState;
    const loopToken = state.MStoken;

    if (!titleChunks.length) {
      await this.__setMSmeta("");
      return;
    }

    let chunkIndex = 0;

    const tick = async (): Promise<void> => {
      if (state.MStoken !== loopToken) return;
      if (state.paused) return;

      const title = titleChunks[chunkIndex] || "";
      await this.__setMSmeta(title);

      chunkIndex += 1;
      if (chunkIndex >= titleChunks.length) return;

      const stepDelayMs = this.__getMSChunkDelay(title, wordsPerSecond);

      state.MSTimer = window.setTimeout(() => {
        void tick();
      }, stepDelayMs);
    };

    await tick();
  }

  /**
   * @returns {string} Current synthesis config signature.
   */
  __cfgSig(): string {
    const state = window.readAloudState;

    return JSON.stringify({
      speechKey: state.speechKey,
      serviceRegion: state.serviceRegion,
      voiceName: state.voiceName,
      speechRate: state.speechRate
    });
  }

  /**
   * @param {number} idx - Paragraph index.
   * @returns {string | null} Cache key for this paragraph and config.
   */
  __mkKey(idx: number): string | null {
    const state = window.readAloudState;
    if (idx < 0 || idx >= state.paragraphs.length) return null;

    const paragraph = state.paragraphs[idx] ?? null;
    const speech = this.__paragSpeech(paragraph);
    if (!speech.plainText && !speech.ssmlBody) return null;

    return JSON.stringify({
      idx,
      speechKey: state.speechKey,
      serviceRegion: state.serviceRegion,
      voiceName: state.voiceName,
      speechRate: state.speechRate,
      plainText: speech.plainText,
      ssmlBody: speech.ssmlBody ?? ""
    });
  }

  /**
   * @param {number} idx - Paragraph index.
   * @returns {ReadAloudBuffer | null} Cached buffer if available.
   */
  __getBuf(idx: number): ReadAloudBuffer | null {
    const key = this.__mkKey(idx);
    if (!key) return null;

    const hit = this.#bufs.get(key) ?? null;
    if (!hit) return null;

    this.#bufs.delete(key);
    this.#bufs.set(key, hit);
    window.readAloudState.buffer = hit;

    return hit;
  }

  /**
   * @param {string} key - Cache key.
   * @param {ReadAloudBuffer} chunk - Buffered audio chunk.
   * @returns {void} Nothing.
   */
  __setBuf(key: string, chunk: ReadAloudBuffer): void {
    this.#bufs.delete(key);
    this.#bufs.set(key, chunk);
    window.readAloudState.buffer = chunk;

    while (this.#bufs.size > this.#bufCap) {
      const first = this.#bufs.keys().next();
      if (first.done) break;
      this.#bufs.delete(first.value);
    }
  }

  /**
   * @returns {void} Nothing.
   */
  __dropBufs(): void {
    this.#bufs.clear();
    window.readAloudState.buffer = null;
  }

  /**
   * @returns {void} Nothing.
   */
  __dropReqs(): void {
    const reqs = Array.from(this.#reqs.values());
    this.#reqs.clear();

    for (const req of reqs) {
      req.okAud(null);
      req.okTim(null);
    }
  }

  /**
   * @returns {Promise<void>} Resolves after request state matches the current config.
   */
  async __syncReqs(): Promise<void> {
    const sig = this.__cfgSig();
    if (this.#reqSig === sig) return;

    await this.__stopReqs();
    this.__dropReqs();
    this.__dropBufs();
    this.#reqSig = sig;
  }

  /**
   * @param {number} idx - Paragraph index.
   * @returns {ReadAloudReq | null} Shared request record.
   */
  __req(idx: number): ReadAloudReq | null {
    const state = window.readAloudState;
    if (idx < 0 || idx >= state.paragraphs.length) return null;

    const key = this.__mkKey(idx);
    if (!key) return null;
    if (this.#bufs.has(key)) return null;

    const live = this.#reqs.get(key);
    if (live) return live;

    const paragraph = state.paragraphs[idx] ?? null;
    const speech = this.__paragSpeech(paragraph);
    if (!speech.plainText && !speech.ssmlBody) return null;

    let audRes: ((audioData: ArrayBuffer | null) => void) | null = null;
    let audRej: ((error: unknown) => void) | null = null;
    let timRes: ((chunk: ReadAloudBuffer | null) => void) | null = null;
    let timRej: ((error: unknown) => void) | null = null;

    const audP = new Promise<ArrayBuffer | null>((resolve, reject) => {
      audRes = resolve;
      audRej = reject;
    });

    const timP = new Promise<ReadAloudBuffer | null>((resolve, reject) => {
      timRes = resolve;
      timRej = reject;
    });

    const req: ReadAloudReq = {
      key,
      idx,
      speech,
      aud: null,
      buf: null,
      synth: null,
      doneAud: false,
      doneTim: false,
      okAud: (audioData: ArrayBuffer | null): void => {
        if (req.doneAud) return;
        req.doneAud = true;
        req.aud = audioData;
        audRes?.(audioData);
      },
      noAud: (error: unknown): void => {
        if (req.doneAud) return;
        req.doneAud = true;
        audRej?.(error);
      },
      okTim: (chunk: ReadAloudBuffer | null): void => {
        if (req.doneTim) return;
        req.doneTim = true;
        req.buf = chunk;
        timRes?.(chunk);
      },
      noTim: (error: unknown): void => {
        if (req.doneTim) return;
        req.doneTim = true;
        timRej?.(error);
      },
      audP,
      timP
    };

    this.#reqs.set(key, req);

    void (async (): Promise<void> => {
      const sdk = await this.__sdkReady();
      const ssml = this.__buildSSML(speech, state.voiceName, state.speechRate);

      const speechConfig = sdk.SpeechConfig.fromSubscription(state.speechKey, state.serviceRegion);
      speechConfig.speechSynthesisVoiceName = state.voiceName;
      speechConfig.setProperty(
        sdk.PropertyId.SpeechSynthesisOutputFormat,
        sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3
      );

      const synth = new sdk.SpeechSynthesizer(speechConfig, null);
      req.synth = synth;
      state.synthesiser = synth;
      this.#activeSynths.add(synth);

      /**
       * @returns {void} Nothing.
       */
      const done = (): void => {
        this.#activeSynths.delete(synth);
        if (state.synthesiser === synth) {
          state.synthesiser = null;
        }
        synth.close();
      };

      /**
       * @returns {boolean} True if the request is still live.
       */
      const isLive = (): boolean => this.#reqs.get(key) === req;

      synth.speakSsmlAsync(
        ssml,
        (result) => {
          void (async (): Promise<void> => {
            if (!isLive()) {
              done();
              return;
            }

            if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) {
              req.noAud(new Error(result.errorDetails || "Speech synthesis failed"));
              req.noTim(new Error(result.errorDetails || "Speech synthesis failed"));
              this.#reqs.delete(key);
              done();
              return;
            }

            req.okAud(result.audioData);

            if (!isLive()) {
              this.#reqs.delete(key);
              done();
              return;
            }

            const timing = await this.__audioTime(speech.plainText, result.audioData);

            if (!isLive()) {
              this.#reqs.delete(key);
              done();
              return;
            }

            const chunk: ReadAloudBuffer = {
              idx,
              audioData: result.audioData,
              timing
            };

            this.__setBuf(key, chunk);
            req.okTim(chunk);
            this.#reqs.delete(key);
            done();
          })().catch((error: unknown) => {
            if (isLive()) {
              req.noAud(error);
              req.noTim(error);
              this.#reqs.delete(key);
            }
            done();
          });
        },
        (error) => {
          if (isLive()) {
            req.noAud(error);
            req.noTim(error);
            this.#reqs.delete(key);
          }
          done();
        }
      );
    })().catch((error: unknown) => {
      if (this.#reqs.get(key) === req) {
        req.noAud(error);
        req.noTim(error);
        this.#reqs.delete(key);
      }
    });

    return req;
  }

  /**
   * @param {number} idx - Paragraph index.
   * @returns {Promise<ReadAloudBuffer | null>} Buffered audio chunk.
   */
  async __buf(idx: number): Promise<ReadAloudBuffer | null> {
    const hit = this.__getBuf(idx);
    if (hit) return hit;

    const req = this.__req(idx);
    if (!req) return this.__getBuf(idx);

    return req.timP;
  }

  /**
   * @param {number} idx - Paragraph index.
   * @returns {void} Nothing.
   */
  __warm(idx: number): void {
    if (idx < 0) return;
    if (this.__getBuf(idx)) return;

    const req = this.__req(idx);
    if (!req) return;

    void req.audP.catch(() => {
      // Ignore background prefetch errors here.
    });
  }

  /**
   * @param {number} idx - Paragraph index.
   * @param {boolean} blocking - If true, return buffered audio. Unused now but kept for compatibility.
   * @param {number | null} playbackToken - Playback invalidation token. Unused now but kept for compatibility.
   * @returns {Promise<ReadAloudBuffer | null>} Audio chunk or null if skipped.
   */
  async __bufferPAudio(
    idx: number,
    blocking: boolean = false,
    playbackToken: number | null = null
  ): Promise<ReadAloudBuffer | null> {
    void blocking;
    void playbackToken;
    return this.__buf(idx);
  }

  /**
   * @param {ArrayBuffer} audioData - MP3 data.

   * @param {number} playbackToken - Playback invalidation token.
   * @returns {Promise<void>} Resolves when playback ends.
   */
  async __playAudioBlob(audioData: ArrayBuffer, playbackToken: number): Promise<void> {
    const state = window.readAloudState;
    if (state.playbackToken !== playbackToken || state.paused) return;

    return new Promise<void>((resolve, reject) => {
      if (state.playbackToken !== playbackToken || state.paused) {
        resolve();
        return;
      }

      const audioBlob = new Blob([audioData], { type: "audio/mp3" });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      state.currentAudio = audio;
      state.currentAudioUrl = audioUrl;

      let settled = false;

      /**
       * @returns {void} Nothing.
       */
      const cleanup = (): void => {
        audio.onpause = null;
        audio.onended = null;
        audio.onerror = null;

        if (state.currentAudio === audio) state.currentAudio = null;

        if (state.currentAudioUrl === audioUrl) {
          URL.revokeObjectURL(audioUrl);
          state.currentAudioUrl = null;
          return;
        }

        URL.revokeObjectURL(audioUrl);
      };

      audio.onpause = () => {
        const isCurrentAudio = state.currentAudio === audio;
        const samePlayback = state.playbackToken === playbackToken;
        if (!isCurrentAudio || !samePlayback) return;

        const wasInterrupted = !audio.ended && !state.paused;
        if (wasInterrupted) void this.__pause();
      };

      audio.onended = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      audio.onerror = (e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      };

      audio.play().catch((err: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * @param {boolean} hard - If true, also clear cache and shared requests.
   * @returns {Promise<void>} Resolves after invalidating and stopping all read aloud playback.
   */
  async __stopAllPlayback(hard: boolean = false): Promise<void> {
    const state = window.readAloudState;
    state.paused = true;
    state.playbackToken += 1;
    state.buffer = null;

    await this.__stopAud();
    await this.__stopMSloop();

    if (!hard) return;

    await this.__stopReqs();
    this.__dropReqs();
    this.__dropBufs();
    this.#reqSig = null;
  }

  /**
   * @returns {Promise<void>} Resolves when paused and state saved.

   */
  async __pause(): Promise<void> {
    const state = window.readAloudState;
    state.paused = true;

    this.__FOHighlight(state.paragraphs[state.currentPIdx]);

    await this.__stopAllPlayback();

    localStorage.setItem("readAloudAudioPosition", JSON.stringify({
      paragraphId: state.currentPid,
      paragraphIndex: state.currentPIdx
    }));

    this.__setPlayPauseButton(false);
  }

  /**
   * @returns {Promise<void>} Resolves after resuming speech.
   */
  async __resume(): Promise<void> {
    const state = window.readAloudState;
    state.paused = false;

    await this.__syncReqs();

    const idx = state.currentPIdx || 0;
    await this.__speakP(idx);
  }

  /**
   * @returns {Promise<void>} Resolves after clearing session state.
   */
  async __clear(): Promise<void> {
    const state = window.readAloudState;

    this.__FOHighlight(state.paragraphs[state.currentPIdx]);

    state.currentPIdx = 0;
    state.currentPid = state.paragraphs[0] ? state.paragraphs[0].id : null;
    state.paused = true;

    await this.__stopAllPlayback();
    localStorage.removeItem("readAloudAudioPosition");
  }

  /**
   * @returns {Promise<void>} Resolves after stopping active audio playback.
   */
  async __stopAud(): Promise<void> {
    const state = window.readAloudState;

    if (state.currentAudio) {
      state.currentAudio.onpause = null;
      state.currentAudio.onended = null;
      state.currentAudio.onerror = null;
      state.currentAudio.pause();
      state.currentAudio.currentTime = 0;
      state.currentAudio = null;
    }

    if (state.currentAudioUrl) {
      URL.revokeObjectURL(state.currentAudioUrl);
      state.currentAudioUrl = null;
    }
  }

  /**
   * @returns {Promise<void>} Resolves after stopping any active synthesiser.
   */
  async __stopReqs(): Promise<void> {
    const state = window.readAloudState;
    const activeSynths = Array.from(this.#activeSynths);
    this.#activeSynths.clear();

    if (!activeSynths.length) {
      state.synthesiser = null;
      return;
    }

    await Promise.all(activeSynths.map(async (synth) => {
      await new Promise<void>((resolve) => {
        /**
         * @returns {void} Nothing.
         */
        const done = (): void => {
          if (state.synthesiser === synth) {
            state.synthesiser = null;
          }
          synth.close();
          resolve();
        };

        if (synth.stopSpeakingAsync) {
          synth.stopSpeakingAsync(done);
          return;
        }

        done();
      });
    }));
  }

  /**
   * @param {number} idx - Paragraph index to switch to.

   * @returns {Promise<void>} Resolves after switching paragraph.
   */
  async __changeParagraph(idx: number): Promise<void> {
    const state = window.readAloudState;
    if (!state.paragraphs.length) return;
    if (idx < 0 || idx >= state.paragraphs.length) return;

    const wasPaused = state.paused;

    this.__FOHighlight(state.paragraphs[state.currentPIdx]);

    await this.__stopAllPlayback();

    state.currentPIdx = idx;
    state.currentPid = state.paragraphs[idx].id;

    localStorage.setItem("readAloudAudioPosition", JSON.stringify({
      paragraphId: state.currentPid,
      paragraphIndex: state.currentPIdx
    }));

    this.__highlightP(state.paragraphs[idx]);
    this.__scrollToP(state.paragraphs[idx]);

    if (state.currentPid) forceBookmark(state.currentPid);

    if (wasPaused) {
      this.__setPlayPauseButton(false);
      return;
    }

    state.paused = false;
    this.__setPlayPauseButton(true);
    await this.__speakP(idx);
  }

  /**
   * @param {HTMLElement | null} paragraph - Paragraph to highlight.
   * @returns {void} Nothing.
   */
  __highlightP(paragraph: HTMLElement | null): void {
    window.readAloudState.paragraphs.forEach((p) => {
      p.classList.remove("read-aloud-active", "read-aloud-fadeout");
    });

    if (!paragraph) return;

    paragraph.classList.add("read-aloud-active");
    paragraph.classList.remove("read-aloud-fadeout");
  }

  /**
   * @param {HTMLElement | null} paragraph - Paragraph to fade out.
   * @returns {void} Nothing.
   */
  __FOHighlight(paragraph: HTMLElement | null): void {
    if (!paragraph) return;

    paragraph.classList.add("read-aloud-fadeout");
    window.setTimeout(() => {
      paragraph.classList.remove("read-aloud-active", "read-aloud-fadeout");
    }, 600);
  }

  /**
   * @param {HTMLElement | null} paragraph - Paragraph to scroll into view.
   * @returns {void} Nothing.
   */
  __scrollToP(paragraph: HTMLElement | null): void {
    if (!paragraph) return;

    paragraph.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  /**
   * @returns {Promise<void>} Resolves after moving to next paragraph.
   */
  async __nextParagraph(): Promise<void> {
    const state = window.readAloudState;
    if (!state.paragraphs.length) return;

    const idx = state.currentPIdx < state.paragraphs.length - 1
      ? state.currentPIdx + 1
      : 0;

    await this.__changeParagraph(idx);
  }

  /**
   * @returns {Promise<void>} Resolves after moving to previous paragraph.
   */
  async __prevParagraph(): Promise<void> {
    const state = window.readAloudState;
    if (!state.paragraphs.length) return;

    const idx = state.currentPIdx > 0
      ? state.currentPIdx - 1
      : state.paragraphs.length - 1;

    await this.__changeParagraph(idx);
  }

  /**
   * @param {number} paragraphNumber - Paragraph number.
   * @returns {Promise<void>} Resolves after jump attempt.
   */
  async __jumpToParagraphNumber(paragraphNumber: number): Promise<void> {
    await this.reloadReadAloud();
    const state = window.readAloudState;

    if (!state.paragraphs || state.paragraphs.length === 0) return;

    const idx = paragraphNumber;
    if (idx < 0 || idx >= state.paragraphs.length) return;

    await this.__changeParagraph(idx);
  }

  /**
   * @param {ReadAloudState} state - Read aloud state.
   * @param {number | null | undefined} idx - Optional index to speak from.
   * @returns {Promise<void>} Resolves after buffer is cleared and playback continues if needed.
   */
  async __clearBuffer(state: ReadAloudState, idx: number | null | undefined): Promise<void> {
    const pausedState = state.paused;
    await this.__stopAllPlayback(true);
    state.paused = pausedState;

    if (state.paused) return;

    const nextIdx = idx == null ? (state.currentPIdx ?? 0) : idx;
    this.__setPlayPauseButton(true);
    await this.__speakP(nextIdx);
  }

  /**
   * @param {string} voiceName - Voice name.
   * @returns {void} Nothing.
   */
  __savePreferredVoice(voiceName: string): void {
    localStorage.setItem("readAloudPreferredVoice", voiceName);
  }

  /**
   * @param {string} apiKey - API key.
   * @returns {void} Nothing.
   */
  __saveApiKey(apiKey: string): void {
    const stored = this.__readSpeechResource();
    const region = stored?.region || "";
    const regionLocked = !!stored?.regionLocked;

    this.__writeSpeechResource({ speechKey: apiKey, region, regionLocked });
    localStorage.setItem("readAloudConfigMenuHidden", String(apiKey !== ""));
  }

  /**
   * @param {string} region - Region string.
   * @returns {void} Nothing.
   */
  __saveRegion(region: string): void {
    const stored = this.__readSpeechResource();
    const speechKey = stored?.speechKey || "";
    const regionLocked = region !== "";

    this.__writeSpeechResource({ speechKey, region, regionLocked });
  }

  /**
   * @param {number} rate - Rate multiplier.
   * @returns {void} Nothing.
   */
  __saveSpeechRate(rate: number): void {
    localStorage.setItem("readAloudSpeechRate", String(rate));
  }

  /**
   * @returns {number} Speech rate.
   */
  __getSpeechRate(): number {
    return Number.parseFloat(localStorage.getItem("readAloudSpeechRate") || "") || 1.0;
  }

  /**
   * @param {string} html - Modal HTML.
   * @param {string} modalId - Modal id.
   * @returns {void} Nothing.
   */
  __openCustomModal(html: string, modalId: string): void {
    const existing = this.#customModalsById.get(modalId);
    if (existing) {
      existing.setContent(html).open();
      return;
    }

    const modal = factory.create({
      id: modalId,
      mode: "blocking",
      content: html
    });

    this.#customModalsById.set(modalId, modal);
    modal.open();
  }

  /**
   * @param {string} modalId - Modal id.
   * @returns {void} Nothing.
   */
  __closeCustomModal(modalId: string): void {
    const cached = this.#customModalsById.get(modalId);
    if (cached) {
      cached.close();
      return;
    }

    factory.getOpenSession(modalId)?.close();
  }

  /**
   * @returns {Promise<void>} Resolves after refreshing paragraph list.
   */
  async reloadReadAloud(): Promise<void> {
    const container = document.querySelector("article#reader, main, article");
    if (!(container instanceof HTMLElement)) return;

    const paragraphs = Array.from(container.querySelectorAll<HTMLElement>(".reader-bookmark"));
    if (paragraphs.length <= 0) return;

    await this.__stopReqs();
    this.__dropReqs();
    this.__dropBufs();
    this.#reqSig = null;

    window.readAloudState.paragraphs = paragraphs;
    window.readAloudState.currentPIdx = 0;
    window.readAloudState.currentPid = paragraphs[0]?.id || null;
  }
}

const RAM = new ReadAloudModule();

export const showMenu = RAM.getMenuHndlr();
export const reload = RAM.getReloadHndlr();