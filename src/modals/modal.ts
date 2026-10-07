import type {
    Dec,
    DecInfo,
    ModalMode,
    ModalPosition,
    Spec
} from "./types.ts";
import {
    ensEsc,
    mkId,
    patchHtml,
    runInit
} from "./runtime.ts";
import { ModalSession } from "./session.ts";

export class ModalFactory {
    readonly #tok: string;
    readonly #byId: Map<string, ModalSession>;

    constructor() {
        this.#tok = mkId("factory");
        this.#byId = new Map<string, ModalSession>();
    }

    /**
     * makes a modal blueprint from a spec.
     * not open yet, just ready to be used.
     *
     * @param {Spec} spec
     * @returns {Modal}
     */
    create(spec: Spec): Modal {
        return new Modal(this, spec);
    }

    /**
     * gets the open session for a modal id, if there is one.
     *
     * @param {string} id
     * @returns {ModalSession | null}
     */
    getOpenSession(id: string): ModalSession | null {
        return this.#byId.get(id) ?? null;
    }

    /**
     * open sessions from this factory, all of them.
     *
     * @returns {readonly ModalSession[]}
     */
    listOpenSessions(): readonly ModalSession[] {
        return Array.from(this.#byId.values());
    }

    /** @internal */
    _keyFor(id: string): string {
        return `${this.#tok}::${id}`;
    }

    /** @internal */
    _registerSession(id: string, session: ModalSession): void {
        this.#byId.set(id, session);
    }

    /** @internal */
    _unregisterSession(id: string): void {
        this.#byId.delete(id);
    }
}

export class Modal {
    readonly #fac: ModalFactory;

    readonly #id: string;
    #mode: ModalMode;

    readonly #rmOk: boolean;
    readonly #win: boolean;

    #cnt: string | (() => string);

    #mCls: string;
    #oCls: string;

    #esc: boolean;
    #out: boolean;

    readonly #pos: ModalPosition | null;
    readonly #txtBubble: boolean;

    #decs: Dec[];

    constructor(factory: ModalFactory, spec: Spec) {
        this.#fac = factory;

        this.#id = mkId(spec.id);
        this.#mode = spec.mode ?? "blocking";

        this.#rmOk = spec.readerModeCompatible ?? true;
        this.#win = spec.window ?? false;

        this.#cnt = spec.content;

        this.#mCls = spec.modalClassName ?? "";
        this.#oCls = spec.overlayClassName ?? "";

        this.#esc = spec.closeOnEscape ?? true;
        this.#out = spec.closeOnOutsideClick ?? (this.#mode === "blocking");

        this.#pos = spec.position ?? null;
        this.#txtBubble = spec.asTextBubble ?? false;

        this.#decs = Array.from(spec.decorators ?? []);
    }

    /**
     * modal id getter.
     *
     * @returns {string}
     */
    get id(): string {
        return this.#id;
    }

    /**
     * current mode getter.
     *
     * @returns {ModalMode}
     */
    get mode(): ModalMode {
        return this.#mode;
    }

    /**
     * changes the mode on the blueprint.
     * useful before opening it.
     *
     * @param {ModalMode} mode
     * @returns {this}
     */
    setMode(mode: ModalMode): this {
        this.#mode = mode;
        return this;
    }

    /**
     * swaps the content html or content producer.
     * if the modal is already open it gets refreshed too.
     *
     * @param {string | (() => string)} content
     * @returns {this}
     */
    setContent(content: string | (() => string)): this {
        this.#cnt = content;

        const sess = this.#fac.getOpenSession(this.#id);
        if (!sess) return this;

        sess.setHtml(this.renderHtml());
        return this;
    }

    /**
     * adds a decorator to the modal.
     * open modal gets refreshed right away.
     *
     * @param {Dec} decorator
     * @returns {this}
     */
    decorate(decorator: Dec): this {
        this.#decs.push(decorator);

        const sess = this.#fac.getOpenSession(this.#id);
        if (!sess) return this;

        sess.setHtml(this.renderHtml());
        return this;
    }

    /**
     * renders the current html after decorator patch passes.
     *
     * @returns {string}
     */
    renderHtml(): string {
        const info: DecInfo = {
            id: this.#id,
            mode: this.#mode,
            readerModeCompatible: this.#rmOk,
            windowed: this.#win
        };

        const base = typeof this.#cnt === "function" ? this.#cnt() : this.#cnt;

        runInit(this.#decs);
        return patchHtml(base, this.#decs, info);
    }

    /**
     * opens the modal.
     * if it is already open, it just refreshes and comes to the front.
     *
     * @returns {ModalSession}
     */
    open(): ModalSession {
        ensEsc();

        const ex = this.#fac.getOpenSession(this.#id);
        if (ex) {
            ex.setHtml(this.renderHtml());
            ex.bringToFront();
            return ex;
        }

        const sess = new ModalSession({
            factory: this.#fac,
            id: this.#id,
            mode: this.#mode,
            readerModeCompatible: this.#rmOk,
            windowed: this.#win,
            modalClassName: this.#mCls,
            overlayClassName: this.#oCls,
            closeOnEscape: this.#esc,
            closeOnOutsideClick: this.#out,
            position: this.#pos,
            asTextBubble: this.#txtBubble,
            decorators: this.#decs,
            html: this.renderHtml()
        });

        this.#fac._registerSession(this.#id, sess);
        sess.open();
        return sess;
    }

    /**
     * tells you if this modal is open right now.
     *
     * @returns {boolean}
     */
    isOpen(): boolean {
        return this.#fac.getOpenSession(this.#id) !== null;
    }

    /**
     * closes it if open.
     *
     * @returns {boolean}
     */
    close(): boolean {
        const sess = this.#fac.getOpenSession(this.#id);
        if (!sess) return false;

        sess.close();
        return true;
    }
}

