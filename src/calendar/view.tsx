import { render2Frag } from "../reactHelpers.tsx";
import * as icons from "../icons.tsx";
import { moLbl } from "./model.ts";
import type {
    CalSel,
    CalVw,
    DyCalVw,
    DyCell,
    DyGridVw
} from "./types.ts";

function TglIco({ open }: Readonly<{ open: boolean }>): JSX.Element {
    return open ? icons.MakeDecreaseFontIcon() : icons.MakeIncreaseFontIcon();
}

/**
 * Render helper for shared collapse wiring.
 * @param {boolean} open
 * @returns {DocumentFragment}
 */
export function renderTglIco(open: boolean): DocumentFragment {
    return render2Frag(<TglIco open={open} />);
}

/**
 * Single selectable item button.
 * @param {Readonly<{ lvl: CalLvl; val: number; sel: boolean; has: boolean; txt: string; }>} props
 * @returns {JSX.Element}
 */
function Itm({
    lvl,
    val,
    sel,
    has,
    txt
}: Readonly<{
    lvl: CalLvl;
    val: number;
    sel: boolean;
    has: boolean;
    txt: string;
}>): JSX.Element {
    return (
        <button
            type="button"
            className="cal__itm"
            data-cal-lvl={lvl}
            data-cal-val={String(val)}
            data-sel={sel ? "1" : "0"}
            data-has={has ? "1" : "0"}
            aria-pressed={sel ? "true" : "false"}
            aria-label={`${txt}, ${has ? "has content" : "empty"}`}
            title={has ? `${txt} has content` : `${txt} is empty`}
        >
            <span className="cal__itmTxt">{txt}</span>
            <span className="cal__itmStat" aria-hidden="true">
                {has ? "•" : "0"}
            </span>
        </button>
    );
}

/**
 * One day cell, or a pad cell if needed for the grid.
 * @param {Readonly<{ cell: DyCell }>} props
 * @returns {JSX.Element}
 */
function DyCellView({ cell }: Readonly<{ cell: DyCell }>): JSX.Element {
    if (cell.kind === "pad") {
        return <span className="cal__dyPad" aria-hidden="true" />;
    }

    const dtLbl = `${cell.dy} ${moLbl(cell.mo)} ${cell.yr}`;

    return (
        <button
            type="button"
            className="cal__itm cal__itm--dy"
            data-cal-lvl="dy"
            data-cal-val={String(cell.dy)}
            data-cal-yr={String(cell.yr)}
            data-cal-mo={String(cell.mo)}
            data-sel={cell.sel ? "1" : "0"}
            data-has={cell.has ? "1" : "0"}
            aria-pressed={cell.sel ? "true" : "false"}
            aria-label={`${dtLbl}, ${cell.has ? "has content" : "empty"}`}
            title={cell.has ? `${dtLbl} has content` : `${dtLbl} is empty`}
        >
            <span className="cal__itmTxt">{cell.dy}</span>
            <span className="cal__itmStat" aria-hidden="true">
                {cell.has ? "•" : "0"}
            </span>
        </button>
    );
}

/**
 * Month calendar view for a single selected year+month.
 * @param {Readonly<{ vw: DyCalVw }>} props
 * @returns {JSX.Element}
 */
function DyCal({ vw }: Readonly<{ vw: DyCalVw }>): JSX.Element {
    return (
        <section className="cal__mo" aria-label={vw.ttl}>
            <header className="cal__moHdr">
                <h3 className="cal__moTtl">{vw.ttl}</h3>
            </header>

            <div className="cal__wkRow" aria-hidden="true">
                {vw.wk.map((lbl) => (
                    <span key={`${vw.key}-${lbl}`} className="cal__wkItm">
                        {lbl}
                    </span>
                ))}
            </div>

            <div className="cal__dyGrid">
                {vw.cells.map((cell) => (
                    <DyCellView key={cell.key} cell={cell} />
                ))}
            </div>
        </section>
    );
}

/**
 * Bulk days grid when there are many year/month pairs selected.
 * @param {Readonly<{ vw: DyGridVw }>} props
 * @returns {JSX.Element}
 */
function DyGrid({ vw }: Readonly<{ vw: DyGridVw }>): JSX.Element {
    return (
        <section className="cal__dyBulk" aria-label={vw.ttl}>
            <header className="cal__moHdr">
                <h3 className="cal__moTtl">{vw.ttl}</h3>
            </header>

            <div className="cal__itmGrid cal__itmGrid--dys">
                {vw.items.map((itm) => (
                    <Itm
                        key={itm.key}
                        lvl="dy"
                        val={itm.dy}
                        sel={itm.sel}
                        has={itm.has}
                        txt={String(itm.dy)}
                    />
                ))}
            </div>
        </section>
    );
}

/**
 * One expandable section block.
 * @param {Readonly<{ ttl: string; sct: CalSct; open: boolean; cnt: number; body: JSX.Element | null; }>} props
 * @returns {JSX.Element}
 */
function SctBlk({
    ttl,
    sct,
    open,
    cnt,
    body
}: Readonly<{
    ttl: string;
    sct: CalSct;
    open: boolean;
    cnt: number;
    body: JSX.Element | null;
}>): JSX.Element {
    return (
        <section className="cal__sct" data-cal-sct-root={sct} data-open={open ? "1" : "0"}>
            <header
                className="cal__sctHdr kc-click-header"
                data-cal-sct-header={sct}
                role="button"
                tabIndex={0}
                aria-expanded={open ? "true" : "false"}
                title={open ? `Collapse ${ttl}` : `Expand ${ttl}`}
            >
                <span className="cal__sctTtl">{ttl}</span>

                <span className="cal__sctMeta">
                    <span className="cal__sctCnt">{cnt}</span>

                    <button
                        type="button"
                        className="cal__sctTgl kc-round-icon-btn kc-round-icon-btn--sm kc-click-header__control"
                        data-cal-sct={sct}
                        aria-expanded={open ? "true" : "false"}
                        aria-label={open ? `Collapse ${ttl}` : `Expand ${ttl}`}
                        title={open ? `Collapse ${ttl}` : `Expand ${ttl}`}
                    >
                        <TglIco open={open} />
                    </button>
                </span>
            </header>

            <div className="cal__sctBody" aria-hidden={open ? "false" : "true"}>
                <div className="cal__sctBodyInner">{body}</div>
            </div>
        </section>
    );
}

/**
 * Selected pills.
 * @param {Readonly<{ sel: CalSel; }>} props
 * @returns {JSX.Element}
 */
function SelBar({ sel }: Readonly<{ sel: CalSel }>): JSX.Element {
    const yrs = Array.from(sel.yrs).sort((a, b) => b - a);
    const mos = Array.from(sel.mos).sort((a, b) => a - b);
    const dys = Array.from(sel.dys).sort((a, b) => a - b);

    return (
        <div
            className="cal__selBar"
            data-cal-sel-bar="1"
            aria-label="Selected date filters"
        >
            <div className="cal__selGrp">
                {yrs.map((yr) => (
                    <button
                        key={`yr-${yr}`}
                        type="button"
                        className="cal__selPill"
                        data-cal-lvl="yr"
                        data-cal-val={String(yr)}
                        title={`Remove year ${yr}`}
                    >
                        <span className="cal__selV">{yr}</span>
                    </button>
                ))}

                {mos.map((mo) => (
                    <button
                        key={`mo-${mo}`}
                        type="button"
                        className="cal__selPill"
                        data-cal-lvl="mo"
                        data-cal-val={String(mo)}
                        title={`Remove month ${moLbl(mo)}`}
                    >
                        <span className="cal__selV">{moLbl(mo)}</span>
                    </button>
                ))}

                {dys.map((dy) => (
                    <button
                        key={`dy-${dy}`}
                        type="button"
                        className="cal__selPill"
                        data-cal-lvl="dy"
                        data-cal-val={String(dy)}
                        title={`Remove day ${dy}`}
                    >
                        <span className="cal__selV">{dy}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

/**
 * Root-level header controls.
 * @param {Readonly<{ rootOpen: boolean; hasSel: boolean; }>} props
 * @returns {JSX.Element}
 */
function RootActions({
    rootOpen,
    hasSel
}: Readonly<{
    rootOpen: boolean;
    hasSel: boolean;
}>): JSX.Element {
    return (
        <div className="cal__hdrActions kc-click-header__actions">
            <button
                type="button"
                className="cal__rst kc-click-header__control"
                data-cal-act="rst"
            >
                Reset
            </button>

            {hasSel ? (
                <button
                    type="button"
                    className="cal__clr kc-click-header__control"
                    data-cal-act="clr"
                >
                    Clear all
                </button>
            ) : null}

            <button
                type="button"
                className="cal__rootTgl kc-round-icon-btn kc-click-header__control"
                data-cal-root-toggle="1"
                aria-expanded={rootOpen ? "true" : "false"}
                aria-label={rootOpen ? "Collapse filter" : "Expand filter"}
                title={rootOpen ? "Collapse filter" : "Expand filter"}
            >
                <TglIco open={rootOpen} />
            </button>
        </div>
    );
}

/**
 * Whole calendar filter root view.
 * @param {Readonly<{ vw: CalVw }>} props
 * @returns {JSX.Element}
 */
function Root({ vw }: Readonly<{ vw: CalVw }>): JSX.Element {
    const yrCnt = vw.sel.yrs.size;
    const moCnt = vw.sel.mos.size;
    const dyCnt = vw.sel.dys.size;

    const moBody = vw.canMos ? (
        <div className="cal__itmGrid cal__itmGrid--mos">
            {vw.mos.map((mo) => (
                <Itm
                    key={`mo-${mo}`}
                    lvl="mo"
                    val={mo}
                    sel={vw.sel.mos.has(mo)}
                    has={true}
                    txt={moLbl(mo)}
                />
            ))}
        </div>
    ) : null;

    const dyBody = !vw.canDys || !vw.dyVw
        ? null
        : vw.dyVw.kind === "cal"
            ? <DyCal vw={vw.dyVw} />
            : <DyGrid vw={vw.dyVw} />;

    return (
        <section
            className="cal"
            aria-label="Calendar filters"
            data-open={vw.rootOpen ? "1" : "0"}
        >
            <header
                className="cal__hdr kc-click-header"
                data-cal-root-header="1"
                role="button"
                tabIndex={0}
                aria-expanded={vw.rootOpen ? "true" : "false"}
                title={vw.rootOpen ? "Collapse filter" : "Expand filter"}
            >
                <div className="cal__ttlWrap">
                    <span className="cal__eyebrow"></span>
                    <h2 className="cal__ttl">{vw.ttl}</h2>
                </div>

                {vw.hasSel ? <SelBar sel={vw.sel} /> : null}

                <RootActions rootOpen={vw.rootOpen} hasSel={vw.hasSel} />
            </header>

            <div className="cal__rootBody" aria-hidden={vw.rootOpen ? "false" : "true"}>
                <div className="cal__rootBodyInner">
                    <div className="cal__grid">
                        <SctBlk
                            ttl="Years"
                            sct="yrs"
                            open={vw.open.yrs}
                            cnt={yrCnt}
                            body={
                                <div className="cal__itmGrid cal__itmGrid--yrs">
                                    {vw.yrs.map((yr) => (
                                        <Itm
                                            key={`yr-${yr}`}
                                            lvl="yr"
                                            val={yr}
                                            sel={vw.sel.yrs.has(yr)}
                                            has={true}
                                            txt={String(yr)}
                                        />
                                    ))}
                                </div>
                            }
                        />

                        <SctBlk
                            ttl="Months"
                            sct="mos"
                            open={vw.open.mos}
                            cnt={moCnt}
                            body={moBody}
                        />

                        <SctBlk
                            ttl="Days"
                            sct="dys"
                            open={vw.open.dys}
                            cnt={dyCnt}
                            body={dyBody}
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}


export function renderCalendarView(vw: CalVw): DocumentFragment {
    return render2Frag(<Root vw={vw} />);
}
