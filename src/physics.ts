type CssVarMap = Readonly<Record<string, string>>;

type HtmlMethodArgs = readonly unknown[];

export interface HtmlPhysicsEffect<Args extends HtmlMethodArgs> {
  cssHref: string;
  init?: () => void;
  patch: (html: string, args: Args) => string;
}

/**
 * Wraps a method that returns HTML and lets an effect patch that HTML afterwards.
 *
 * @param {HtmlPhysicsEffect<Args>} effect - Effect definition.
 * @returns {(original: (this: This, ...args: Args) => string, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => string>) => (this: This, ...args: Args) => string} Decorator.
 */
export function decorateHtmlReturn<This, Args extends HtmlMethodArgs>(effect: HtmlPhysicsEffect<Args>) {
  return (
    original: (this: This, ...args: Args) => string,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => string>,
  ) => {
    context.addInitializer(() => {
      ensureCss(effect.cssHref);
      effect.init?.();
    });

    return function decoratedHtmlReturn(this: This, ...args: Args): string {
      const html = original.call(this, ...args);
      return effect.patch(html, args);
    };
  };
}

export interface SmsEnterBounceConfig {
  durationMs?: number;
  strength?: number;
  viscosity?: number;
  cssHref?: string;
}

type SmsDirection = "in" | "out";

const PHYSICS_LINK_REL = "stylesheet";
const PHYSICS_RUNTIME_FLAG = "__mediaStylerPhysicsRuntimeInstalled";

/**
 * Keeps a number inside the given range.
 *
 * @param {number} value - Number to clamp.
 * @param {number} min - Minimum.
 * @param {number} max - Maximum.
 * @returns {number} Clamped number.
 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Checks whether a stylesheet is already present.
 *
 * @param {string} cssHref - Stylesheet href.
 * @returns {boolean} True when a matching stylesheet is already in the document.
 */
function hasCss(cssHref: string): boolean {
  const sheets = Array.from(document.styleSheets);

  for (const sheet of sheets) {
    const href = sheet.href;
    if (!href) continue;
    if (href.endsWith(cssHref)) return true;
  }

  const links = Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']"));
  return links.some((link) => link.getAttribute("href") === cssHref);
}

/**
 * Ensures a stylesheet link exists in the document head.
 *
 * @param {string} cssHref - Stylesheet href.
 * @returns {void}
 */
function ensureCss(cssHref: string): void {
  if (hasCss(cssHref)) return;

  const link = document.createElement("link");
  link.rel = PHYSICS_LINK_REL;
  link.href = cssHref;
  document.head.appendChild(link);
}

/**
 * Activates physics-marked elements once they enter view, and watches for new ones.
 *
 * @returns {void}
 */
export function ensurePhysicsRuntime(): void {
  const runtimeFlags = window as unknown as Record<string, unknown>;
  if (runtimeFlags[PHYSICS_RUNTIME_FLAG]) return;

  runtimeFlags[PHYSICS_RUNTIME_FLAG] = true;

  const activate = (el: Element): void => {
    if (!(el instanceof HTMLElement)) return;
    if (el.classList.contains("phys-play")) return;
    el.classList.add("phys-play");
  };

  const observeRoot = (root: ParentNode, observer: IntersectionObserver | null): void => {
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".phys-observe"));

    for (const target of targets) {
      if (target.classList.contains("phys-play")) continue;

      if (!observer) {
        activate(target);
        continue;
      }

      observer.observe(target);
    }
  };

  const observer = "IntersectionObserver" in window
    ? new IntersectionObserver((entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        activate(entry.target);
        obs.unobserve(entry.target);
      }
    }, { threshold: 0.15 })
    : null;

  observeRoot(document, observer);

  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const addedNodes = Array.from(mutation.addedNodes);

      for (const node of addedNodes) {
        if (!(node instanceof Element)) continue;

        const shouldObserve = node.matches(".phys-observe");

        if (shouldObserve && observer) observer.observe(node);
        if (shouldObserve && !observer) activate(node);

        observeRoot(node, observer);
      }
    }
  });

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

/**
 * Builds the CSS variables for the SMS enter-bounce effect.
 *
 * @param {SmsDirection} dir - Message direction.
 * @param {Required<SmsEnterBounceConfig>} cfg - Normalised config.
 * @returns {CssVarMap} CSS variables for this message.
 */
function smsEnterBounceVars(dir: SmsDirection, cfg: Required<SmsEnterBounceConfig>): CssVarMap {
  const strength = clamp(cfg.strength, 0.05, 3);
  const viscosity = clamp(cfg.viscosity, 0, 1);
  const durationMs = clamp(cfg.durationMs, 80, 4000);

  const sign = dir === "in" ? 1 : -1;

  const baseEnterPx = 14;
  const enterPx = baseEnterPx * strength;
  const overshootPx = -3.2 * strength;
  const settlePx = 1.8 * strength;

  const deform = (0.09 + 0.09 * viscosity) * strength;
  const x0 = 1 - deform * 0.75;
  const y0 = 1 + deform * 0.35;
  const x1 = 1 + deform * 1.35;
  const y1 = 1 - deform * 0.65;
  const x2 = 1 - deform * 0.25;
  const y2 = 1 + deform * 0.18;

  const textDelayMs = durationMs * (0.22 + 0.18 * viscosity);
  const textX0 = sign * (enterPx * (0.16 + 0.12 * viscosity));
  const textX1 = -sign * (enterPx * (0.06 + 0.05 * viscosity));

  const ease = viscosity >= 0.7
    ? "cubic-bezier(0.16, 0.98, 0.24, 1.22)"
    : viscosity >= 0.35
      ? "cubic-bezier(0.18, 0.9, 0.22, 1.15)"
      : "cubic-bezier(0.2, 0.85, 0.25, 1.08)";

  return {
    "--phys-duration": `${durationMs}ms`,
    "--phys-ease": ease,
    "--phys-enter-x": `${sign * enterPx}px`,
    "--phys-overshoot-x": `${-sign * Math.abs(overshootPx)}px`,
    "--phys-settle-x": `${sign * settlePx}px`,
    "--phys-scale-x0": x0.toFixed(4),
    "--phys-scale-y0": y0.toFixed(4),
    "--phys-scale-x1": x1.toFixed(4),
    "--phys-scale-y1": y1.toFixed(4),
    "--phys-scale-x2": x2.toFixed(4),
    "--phys-scale-y2": y2.toFixed(4),
    "--phys-text-delay": `${Math.round(textDelayMs)}ms`,
    "--phys-text-x0": `${textX0.toFixed(2)}px`,
    "--phys-text-x1": `${textX1.toFixed(2)}px`,
  };
}

/**
 * Applies a map of CSS variables to an element.
 *
 * @param {HTMLElement} el - Element to patch.
 * @param {CssVarMap} vars - CSS variables.
 * @returns {void}
 */
function applyVars(el: HTMLElement, vars: CssVarMap): void {
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(key, value);
  }
}

/**
 * Reads a numeric attribute from an element.
 *
 * @param {HTMLElement} el - Element.
 * @param {string} attr - Attribute name.
 * @returns {number | null} Parsed number when present and valid.
 */
function readNumberAttr(el: HTMLElement, attr: string): number | null {
  const raw = el.getAttribute(attr);
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Adds physics classes and CSS variables to SMS message wrappers in a blob of HTML.
 *
 * @param {string} html - HTML to patch.
 * @param {SmsEnterBounceConfig} config - Effect config.
 * @returns {string} Patched HTML.
 */
export function patchSmsEnterBounceHtml(html: string, config: SmsEnterBounceConfig = {}): string {
  const cfg: Required<SmsEnterBounceConfig> = {
    durationMs: config.durationMs ?? 520,
    strength: config.strength ?? 1,
    viscosity: config.viscosity ?? 0.7,
    cssHref: config.cssHref ?? "../styles/modules/physics.css",
  };

  ensureCss(cfg.cssHref);
  ensurePhysicsRuntime();

  const template = document.createElement("template");
  template.innerHTML = html;

  const wrappers = Array.from(template.content.querySelectorAll<HTMLElement>(".message-wrapper"));

  for (const wrapper of wrappers) {
    wrapper.classList.add("phys", "phys-observe", "phys-sms-enter");

    const dir: SmsDirection | null = wrapper.classList.contains("in")
      ? "in"
      : wrapper.classList.contains("out")
        ? "out"
        : null;

    if (!dir) continue;

    const durationMs = readNumberAttr(wrapper, "data-phys-duration-ms") ?? cfg.durationMs;
    const strength = readNumberAttr(wrapper, "data-phys-strength") ?? cfg.strength;
    const viscosity = readNumberAttr(wrapper, "data-phys-viscosity") ?? cfg.viscosity;

    applyVars(wrapper, smsEnterBounceVars(dir, {
      ...cfg,
      durationMs,
      strength,
      viscosity
    }));
  }

  return template.innerHTML;
}

type HtmlSyncTransform = (htmlContent: string, cssHref?: string) => string;

/**
 * Decorates a method that returns SMS HTML so the bounce effect is applied afterwards.
 *
 * @param {SmsEnterBounceConfig} config - Effect config.
 * @returns {<T extends HtmlSyncTransform>(value: T, context: ClassMethodDecoratorContext) => T} Decorator.
 */
export function smsEnterBounce(config: SmsEnterBounceConfig = {}) {
  const cssHref = config.cssHref ?? "../styles/modules/physics.css";

  const effect: HtmlPhysicsEffect<Parameters<HtmlSyncTransform>> = {
    cssHref,
    init: ensurePhysicsRuntime,
    patch: (html) => patchSmsEnterBounceHtml(html, { ...config, cssHref }),
  };

  return decorateHtmlReturn(effect);
}