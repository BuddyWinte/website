export type CalLvl = "yr" | "mo" | "dy";

export type CalSel = Readonly<{
    yrs: ReadonlySet<number>;
    mos: ReadonlySet<number>;
    dys: ReadonlySet<number>;
}>;

export type CalCtx = Readonly<{
    yr?: number;
    mo?: number;
    dy?: number;
}>;

export type CalHasArg = Readonly<{
    lvl: CalLvl;
    val: number;
    sel: CalSel;
    ctx: CalCtx;
}>;

export type CalHasFn = (arg: CalHasArg) => boolean;

export type CalCfg = Readonly<{
    host: HTMLElement;
    yrs: readonly number[];
    mos?: readonly number[];
    dys?: readonly number[];
    ttl?: string;
    now?: Date;
    has?: CalHasFn;
    onChg?: (sel: CalSel) => void;
}>;

export type CalSct = "yrs" | "mos" | "dys";

export type SelInp = Readonly<{
    yrs?: readonly number[];
    mos?: readonly number[];
    dys?: readonly number[];
}>;

export type DyPad = Readonly<{
    kind: "pad";
    key: string;
}>;

export type DyBtn = Readonly<{
    kind: "dy";
    key: string;
    yr: number;
    mo: number;
    dy: number;
    sel: boolean;
    has: boolean;
}>;

export type DyCell = DyPad | DyBtn;

export type DyCalVw = Readonly<{
    kind: "cal";
    key: string;
    ttl: string;
    wk: readonly string[];
    cells: readonly DyCell[];
}>;

export type DyGridItm = Readonly<{
    key: string;
    dy: number;
    sel: boolean;
    has: boolean;
}>;

export type DyGridVw = Readonly<{
    kind: "grid";
    ttl: string;
    cnt: number;
    items: readonly DyGridItm[];
}>;

export type DyVw = DyCalVw | DyGridVw;

export type CalVw = Readonly<{
    ttl: string;
    rootOpen: boolean;
    hasSel: boolean;
    yrs: readonly number[];
    mos: readonly number[];
    sel: CalSel;
    open: Readonly<Record<CalSct, boolean>>;
    canMos: boolean;
    canDys: boolean;
    dyVw: DyVw | null;
}>;

