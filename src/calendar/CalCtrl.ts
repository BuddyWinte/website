import * as helpers from "../helpers.ts";
import {
    anySel,
    dyCnt,
    fstWk,
    mos,
    moTtl,
    ordNums,
    ordYrs,
    ro,
    selOf,
    setOf,
    wk
} from "./model.ts";
import {
    renderCalendarView,
    renderTglIco
} from "./view.tsx";
import type {
    CalCfg,
    CalCtx,
    CalHasArg,
    CalHasFn,
    CalLvl,
    CalSct,
    CalSel,
    CalVw,
    DyCalVw,
    DyCell,
    DyGridVw,
    SelInp
} from "./types.ts";

export class CalCtrl {
    private readonly host: HTMLElement;
    private readonly ttl: string;
    private readonly now: Date;
    private readonly hnd: (ev: Event) => void;
    private readonly keyHnd: (ev: KeyboardEvent) => void;
    private readonly allYrs: number[];
    private readonly allMos: number[];
    private readonly alwDys: Set<number> | null;
    private selYrs: Set<number>;
    private selMos: Set<number>;
    private selDys: Set<number>;
    private hasFn: CalHasFn;
    private onChg: ((sel: CalSel) => void) | null;
    private opn: Record<CalSct, boolean>;
    private rootOpen: boolean;
    private isOn: boolean;

    /**
     * Sets the controller up and wires the event handlers.
     * @param {CalCfg} cfg
     */
    constructor(cfg: CalCfg) {
        const now = cfg.now ?? new Date();

        this.host = cfg.host;
        this.ttl = cfg.ttl ?? "Browse by date";
        this.now = now;

        this.allYrs = ordYrs(cfg.yrs);
        this.allMos = ordNums(cfg.mos ?? mos());
        this.alwDys = cfg.dys ? setOf(cfg.dys) : null;

        this.selYrs = setOf([]);
        this.selMos = setOf([]);
        this.selDys = setOf([]);

        this.hasFn = cfg.has ?? (() => false);
        this.onChg = cfg.onChg ?? null;

        this.opn = {
            yrs: true,
            mos: true,
            dys: false
        };

        this.rootOpen = false;
        this.isOn = false;

        this.seedSel();

        /**
         * Main click handler. Looks for whatever data attr got clicked and routes it.
         * @param {Event} ev
         * @returns {void}
         */
        this.hnd = (ev: Event): void => {
            const trg = ev.target;
            if (!(trg instanceof Element)) return;

            if (trg.closest<HTMLElement>("[data-cal-act='rst']")) {
                ev.preventDefault();
                ev.stopPropagation();
                this.rst();
                return;
            }

            if (trg.closest<HTMLElement>("[data-cal-act='clr']")) {
                ev.preventDefault();
                ev.stopPropagation();
                this.clr();
                return;
            }

            if (trg.closest<HTMLElement>("[data-cal-root-toggle]")) {
                ev.preventDefault();
                ev.stopPropagation();
                this.tglRoot();
                return;
            }

            const sctBtn = trg.closest<HTMLElement>("[data-cal-sct]");
            const sctKey = sctBtn?.dataset.calSct as CalSct | undefined;

            if (sctBtn && !sctKey) return;

            if (sctBtn && sctKey) {
                ev.preventDefault();
                ev.stopPropagation();
                this.tglSct(sctKey);
                return;
            }

            const itm = trg.closest<HTMLElement>("[data-cal-lvl][data-cal-val]");
            const lvl = itm?.dataset.calLvl as CalLvl | undefined;
            const raw = itm?.dataset.calVal ?? "";
            const val = Number(raw);

            if (itm && (!lvl || Number.isNaN(val))) return;

            if (itm && lvl) {
                ev.preventDefault();
                ev.stopPropagation();
                this.tglVal(lvl, val);
                return;
            }

            const rootHdr = trg.closest<HTMLElement>("[data-cal-root-header]");
            if (rootHdr && helpers.eventHasBlockedControl(ev)) return;

            if (rootHdr) {
                this.tglRoot();
                return;
            }

            const sctHdr = trg.closest<HTMLElement>("[data-cal-sct-header]");
            const headerKey =
                sctHdr?.dataset.calSctHeader as CalSct | undefined;

            if (sctHdr && helpers.eventHasBlockedControl(ev)) return;
            if (sctHdr && !headerKey) return;
            if (sctHdr && headerKey) this.tglSct(headerKey);
        };

        /**
         * Keyboard handler for row headers only.
         * @param {KeyboardEvent} ev
         * @returns {void}
         */
        this.keyHnd = (ev: KeyboardEvent): void => {
            const trg = ev.target;
            if (!(trg instanceof HTMLElement)) return;
            if (ev.key !== "Enter" && ev.key !== " ") return;

            if (trg.matches("[data-cal-root-header]")) {
                ev.preventDefault();
                this.tglRoot();
                return;
            }

            if (!trg.matches("[data-cal-sct-header]")) return;

            const key = trg.dataset.calSctHeader as CalSct | undefined;
            if (!key) return;

            ev.preventDefault();
            this.tglSct(key);
        };
    }

    /**
     * Mounts the thing and emits initial sel.
     * @returns {void}
     */
    init(): void {
        if (!this.isOn) {
            this.host.addEventListener("click", this.hnd);
            this.host.addEventListener("keydown", this.keyHnd);
            this.isOn = true;
        }

        this.host.classList.add("cal-mnt");
        this.rnd();
        this.emit();
    }

    /**
     * Current selection snapshot.
     * @returns {CalSel}
     */
    getSel(): CalSel {
        return {
            yrs: ro(this.selYrs),
            mos: ro(this.selMos),
            dys: ro(this.selDys)
        };
    }

    /**
     * Replaces the has-content fn and refreshes the ui.
     * @param {CalHasFn} has
     * @returns {void}
     */
    setHas(has: CalHasFn): void {
        this.hasFn = has;
        this.sanSel();
        this.rnd();
        this.emit();
    }

    /**
     * Sets parts of the selection directly.
     * @param {SelInp} nxt
     * @returns {void}
     */
    setSel(nxt: SelInp): void {
        if (nxt.yrs) this.selYrs = setOf(nxt.yrs);
        if (nxt.mos) this.selMos = setOf(nxt.mos);
        if (nxt.dys) this.selDys = setOf(this.fltDys(nxt.dys));

        this.sanSel();
        this.rnd();
        this.emit();
    }

    /**
     * Raw delegated has() call with explicit sel + ctx.
     * @param {CalLvl} lvl
     * @param {number} val
     * @param {CalSel} sel
     * @param {CalCtx} ctx
     * @returns {boolean}
     */
    private rawHas(lvl: CalLvl, val: number, sel: CalSel, ctx: CalCtx): boolean {
        return this.hasFn({
            lvl,
            val,
            sel,
            ctx
        });
    }

    /**
     * Convenience has() using the current selection.
     * @param {CalLvl} lvl
     * @param {number} val
     * @param {CalCtx} ctx
     * @returns {boolean}
     */
    has(lvl: CalLvl, val: number, ctx: CalCtx = {}): boolean {
        return this.rawHas(lvl, val, this.getSel(), ctx);
    }

    /**
     * Reset back to the seeded selection.
     * @returns {void}
     */
    rst(): void {
        this.seedSel();
        this.rnd();
        this.emit();
    }

    /**
     * Clears everything.
     * @returns {void}
     */
    clr(): void {
        this.selYrs.clear();
        this.selMos.clear();
        this.selDys.clear();
        this.sanSel();
        this.rnd();
        this.emit();
    }

    /**
     * Re-sanitise and redraw without emitting.
     * @returns {void}
     */
    refresh(): void {
        this.sanSel();
        this.rnd();
    }

    /**
     * Unhooks listeners and wipes the host.
     * @returns {void}
     */
    destroy(): void {
        if (this.isOn) {
            this.host.removeEventListener("click", this.hnd);
            this.host.removeEventListener("keydown", this.keyHnd);
            this.isOn = false;
        }

        this.host.classList.remove("cal-mnt");
        this.host.replaceChildren();
    }

    /**
     * Picks the underlying bag for a level.
     * @param {CalLvl} lvl
     * @returns {Set<number>}
     */
    private bag(lvl: CalLvl): Set<number> {
        if (lvl === "yr") return this.selYrs;
        if (lvl === "mo") return this.selMos;
        return this.selDys;
    }

    /**
     * Filters day values against allowed-day cfg when needed.
     * @param {Iterable<number>} src
     * @returns {readonly number[]}
     */
    private fltDys(src: Iterable<number>): readonly number[] {
        const vals = Array.from(src);
        if (!this.alwDys) return vals;

        return vals.filter((dy) => this.alwDys?.has(dy) ?? false);
    }

    /**
     * Visible years that actually have content under the current has fn.
     * @returns {readonly number[]}
     */
    private visYrs(): readonly number[] {
        return this.allYrs.filter((yr) =>
            this.rawHas("yr", yr, selOf([yr], [], []), { yr })
        );
    }

    /**
     * Visible months for the given year set.
     * @param {Iterable<number>} yrs
     * @returns {readonly number[]}
     */
    private visMos(yrs: Iterable<number>): readonly number[] {
        const yrBag = new Set<number>(yrs);
        if (yrBag.size === 0) return [];

        const yrSel = Array.from(yrBag);

        return this.allMos.filter((mo) =>
            this.rawHas("mo", mo, selOf(yrSel, [mo], []), { mo })
        );
    }

    /**
     * Cartesian pairs of years x months, in display order.
     * @param {Iterable<number>} yrs
     * @param {Iterable<number>} mos
     * @returns {readonly Readonly<{ yr: number; mo: number }>[]}
     */
    private pairs(
        yrs: Iterable<number>,
        mos: Iterable<number>
    ): readonly Readonly<{ yr: number; mo: number }>[] {
        const yrVals = Array.from(yrs).sort((a, b) => b - a);
        const moVals = Array.from(mos).sort((a, b) => a - b);
        const out: Array<Readonly<{ yr: number; mo: number }>> = [];

        for (const yr of yrVals) {
            for (const mo of moVals) {
                out.push({ yr, mo });
            }
        }

        return out;
    }

    /**
     * Largest valid day count across the selected year/month pairs.
     * @param {Iterable<number>} yrs
     * @param {Iterable<number>} mos
     * @returns {number}
     */
    private maxDy(yrs: Iterable<number>, mos: Iterable<number>): number {
        const pairs = this.pairs(yrs, mos);
        let max = 0;

        for (const pair of pairs) {
            const cnt = dyCnt(pair.yr, pair.mo);
            if (cnt > max) max = cnt;
        }

        return max;
    }

    /**
     * Seeds the initial selection from now if possible, else the first visible slots.
     * @returns {void}
     */
    private seedSel(): void {
        const visYrs = this.visYrs();
        const nowYr = this.now.getFullYear();
        const nowMo = this.now.getMonth() + 1;

        this.selYrs.clear();
        this.selMos.clear();
        this.selDys.clear();

        if (visYrs.length === 0) return;

        const defYr = visYrs.includes(nowYr) ? nowYr : visYrs[0];
        this.selYrs.add(defYr);

        const visMos = this.visMos([defYr]);
        if (visMos.length === 0) return;

        const defMo = visMos.includes(nowMo) ? nowMo : visMos[0];
        this.selMos.add(defMo);
    }

    /**
     * Cleans selection so it only contains values that still make sense.
     * @returns {void}
     */
    private sanSel(): void {
        const visYrs = new Set<number>(this.visYrs());

        for (const yr of Array.from(this.selYrs)) {
            if (!visYrs.has(yr)) this.selYrs.delete(yr);
        }

        if (this.selYrs.size === 0) {
            this.selMos.clear();
            this.selDys.clear();
            return;
        }

        const visMos = new Set<number>(this.visMos(this.selYrs));

        for (const mo of Array.from(this.selMos)) {
            if (!visMos.has(mo)) this.selMos.delete(mo);
        }

        if (this.selMos.size === 0) {
            this.selDys.clear();
            return;
        }

        const maxDy = this.maxDy(this.selYrs, this.selMos);

        for (const dy of Array.from(this.selDys)) {
            const badByCnt = dy < 1 || dy > maxDy;
            const badByCfg = this.alwDys ? !this.alwDys.has(dy) : false;

            if (badByCnt || badByCfg) this.selDys.delete(dy);
        }
    }

    /**
     * Toggles the whole root open/closed.
     * @returns {void}
     */
    private tglRoot(): void {
        const root = this.host.querySelector<HTMLElement>(".cal");
        const hdr = this.host.querySelector<HTMLElement>(".cal__hdr");
        const body = this.host.querySelector<HTMLElement>(".cal__rootBody");
        const btn = this.host.querySelector<HTMLElement>(".cal__rootTgl");

        if (!root || !hdr || !body || !btn) {
            this.rootOpen = !this.rootOpen;
            this.rnd();
            return;
        }

        const nxtOpen = !this.rootOpen;

        helpers.animateCollapsibleOpen({
            root,
            body,
            header: hdr,
            toggle: btn,
            open: nxtOpen,
            renderIcon: renderTglIco,
            collapseLabel: "Collapse filter",
            expandLabel: "Expand filter",
            collapseTitle: "Collapse filter",
            expandTitle: "Expand filter",
            onLayout: null
        });

        this.rootOpen = nxtOpen;
    }

    /**
     * Toggles one section block.
     * @param {CalSct} sct
     * @returns {void}
     */
    private tglSct(sct: CalSct): void {
        const box = this.host.querySelector<HTMLElement>(`.cal__sct[data-cal-sct-root="${sct}"]`);
        const hdr = box?.querySelector<HTMLElement>(".cal__sctHdr") ?? null;
        const btn = this.host.querySelector<HTMLElement>(`.cal__sctTgl[data-cal-sct="${sct}"]`);
        const body = box?.querySelector<HTMLElement>(".cal__sctBody") ?? null;

        if (!box || !hdr || !btn || !body) {
            this.opn[sct] = !this.opn[sct];
            this.rnd();
            return;
        }

        const nxtOpen = !this.opn[sct];
        const title = hdr.querySelector(".cal__sctTtl")?.textContent ?? "section";

        helpers.animateCollapsibleOpen({
            root: box,
            body,
            header: hdr,
            toggle: btn,
            open: nxtOpen,
            renderIcon: renderTglIco,
            collapseLabel: `Collapse ${title}`,
            expandLabel: `Expand ${title}`,
            collapseTitle: `Collapse ${title}`,
            expandTitle: `Expand ${title}`,
            onLayout: null
        });

        this.opn[sct] = nxtOpen;
    }

    /**
     * Toggles one value in the current selection.
     * @param {CalLvl} lvl
     * @param {number} val
     * @returns {void}
     */
    private tglVal(lvl: CalLvl, val: number): void {
        if (lvl === "dy" && this.alwDys && !this.alwDys.has(val)) return;

        const bag = this.bag(lvl);

        if (bag.has(val)) {
            bag.delete(val);
        } else {
            bag.add(val);
        }

        if (lvl === "yr" && this.selYrs.size === 0) {
            this.selMos.clear();
            this.selDys.clear();
        }

        if (lvl === "mo" && this.selMos.size === 0) {
            this.selDys.clear();
        }

        this.sanSel();
        this.rnd();
        this.emit();
    }

    /**
     * Day view as a real month calendar, only when exactly one year and one month are selected.
     * @returns {DyCalVw | null}
     */
    private mkDyCalVw(): DyCalVw | null {
        if (this.selYrs.size !== 1 || this.selMos.size !== 1) return null;

        const yr = Array.from(this.selYrs)[0];
        const mo = Array.from(this.selMos)[0];
        const fst = fstWk(yr, mo);
        const cnt = dyCnt(yr, mo);
        const cells: DyCell[] = [];

        for (let ix = 0; ix < fst; ix += 1) {
            cells.push({
                kind: "pad",
                key: `pad-${yr}-${mo}-${ix}`
            });
        }

        const sel = selOf(this.selYrs, this.selMos, []);

        for (let dy = 1; dy <= cnt; dy += 1) {
            cells.push({
                kind: "dy",
                key: `dy-${yr}-${mo}-${dy}`,
                yr,
                mo,
                dy,
                sel: this.selDys.has(dy),
                has: this.rawHas("dy", dy, sel, { yr, mo, dy })
            });
        }

        const rem = cells.length % 7;
        const endPad = rem === 0 ? 0 : 7 - rem;

        for (let ix = 0; ix < endPad; ix += 1) {
            cells.push({
                kind: "pad",
                key: `pad-end-${yr}-${mo}-${ix}`
            });
        }

        return {
            kind: "cal",
            key: `${yr}-${mo}`,
            ttl: moTtl(yr, mo),
            wk: wk(),
            cells
        };
    }

    /**
     * Day view as a flat grid across multiple selected months/years.
     * @returns {DyGridVw | null}
     */
    private mkDyGridVw(): DyGridVw | null {
        const pairs = this.pairs(this.selYrs, this.selMos);
        if (pairs.length === 0) return null;

        const maxDy = this.maxDy(this.selYrs, this.selMos);
        if (maxDy === 0) return null;

        const items: DyGridItm[] = [];
        const sel = selOf(this.selYrs, this.selMos, []);

        for (let dy = 1; dy <= maxDy; dy += 1) {
            if (this.alwDys && !this.alwDys.has(dy)) continue;

            const has = pairs.some((pair) => {
                if (dy > dyCnt(pair.yr, pair.mo)) return false;

                return this.rawHas("dy", dy, sel, {
                    yr: pair.yr,
                    mo: pair.mo,
                    dy
                });
            });

            items.push({
                key: `dy-grid-${dy}`,
                dy,
                sel: this.selDys.has(dy),
                has
            });
        }

        return {
            kind: "grid",
            ttl: "Days",
            cnt: items.length,
            items
        };
    }

    /**
     * Picks whichever day view shape fits the current selection.
     * @returns {DyVw | null}
     */
    private mkDyVw(): DyVw | null {
        if (this.selYrs.size === 0 || this.selMos.size === 0) return null;
        if (this.selYrs.size === 1 && this.selMos.size === 1) return this.mkDyCalVw();

        return this.mkDyGridVw();
    }

    /**
     * Builds the full render view model.
     * @returns {CalVw}
     */
    private mkVw(): CalVw {
        const sel = this.getSel();
        const yrs = this.visYrs();
        const mos = this.visMos(this.selYrs);
        const canMos = this.selYrs.size > 0;
        const canDys = this.selYrs.size > 0 && this.selMos.size > 0;

        return {
            ttl: this.ttl,
            rootOpen: this.rootOpen,
            hasSel: anySel(sel),
            yrs,
            mos,
            sel,
            open: {
                yrs: this.opn.yrs,
                mos: this.opn.mos,
                dys: this.opn.dys
            },
            canMos,
            canDys,
            dyVw: canDys ? this.mkDyVw() : null
        };
    }

    /**
     * Resets max-height styles after a full rerender so the sections match open state.
     * @returns {void}
     */
    private primeHeights(): void {
        const rootBody = this.host.querySelector<HTMLElement>(".cal__rootBody");
        if (rootBody) {
            rootBody.style.maxHeight = this.rootOpen ? "none" : "0px";
        }

        const scts = Array.from(this.host.querySelectorAll<HTMLElement>(".cal__sct"));

        /**
         * Syncs one section body's max-height to the current open state.
         * @param {HTMLElement} sct
         * @returns {void}
         */
        const syncSct = (sct: HTMLElement): void => {
            const sctKey = sct.dataset.calSctRoot as CalSct | undefined;
            const body = sct.querySelector<HTMLElement>(".cal__sctBody");
            if (!sctKey || !body) return;

            body.style.maxHeight = this.opn[sctKey] ? "none" : "0px";
        };

        scts.forEach(syncSct);
    }

    /**
     * Renders the current view into the host.
     * @returns {void}
     */
    private rnd(): void {
        const frag = renderCalendarView(this.mkVw());
        this.host.replaceChildren(frag);
        this.primeHeights();
    }

    /**
     * Emits selection change if a callback exists.
     * @returns {void}
     */
    private emit(): void {
        this.onChg?.(this.getSel());
    }
}