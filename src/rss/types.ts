export type HljsApi = Readonly<{
    highlightElement: (el: HTMLElement) => void;
}>;

export type WrapRs = Readonly<{
    scr: HTMLDivElement | null;
    box: HTMLDivElement;
    cal: HTMLDivElement | null;
}>;

export type FiltRs = Readonly<{
    shell: HTMLDivElement;
    body: HTMLDivElement;
    btn: HTMLButtonElement;
    hdr: HTMLElement;
}>;

export type AthMenuRs = Readonly<{
    root: HTMLElement;
    body: HTMLDivElement;
    btn: HTMLButtonElement;
    hdr: HTMLElement;
}>;

export type RssItm = Readonly<{
    title: string;
    description: string;
    content: string;
    pubDate: string;
    author: string;
    guid: string;
    postId: string;
}>;

export type Pst = Readonly<{
    ttl: string;
    dsc: string;
    cnt: string;
    pub: string;
    ath: string;
    gid: string;
    pid: string;
    dt: Date;
    yr: number;
    mo: number;
    dy: number;
    res: boolean;
}>;

export type AthOpt = Readonly<{
    ath: string;
    cnt: number;
    on: boolean;
}>;

export type AthFilterCfg = Readonly<{
    defaultUnselect: ReadonlySet<string>;
}>;

export type FiltSumKnd = "date" | "author";

export type FiltSumPill = Readonly<{
    key: string;
    kind: FiltSumKnd;
    label: string;
    lvl?: "yr" | "mo" | "dy";
    val?: number;
    author?: string;
}>;

export type PillSnap = Readonly<{
    key: string;
    rect: DOMRect;
    el: HTMLElement;
}>;

export type CodeVariant = Readonly<{
    pre: HTMLPreElement;
    code: HTMLElement;
    lang: string;
    langKey: string;
    label: string;
}>;

export type CodeGroupActiveOptions = Readonly<{
    savePreference?: boolean;
    syncPeers?: boolean;
}>;

export type CodeTranspileLang = "js" | "jsx" | "ts" | "tsx";

export type ExternalCodeDirective = Readonly<{
    id: string;
    lang: string;
    sourceUrl: string;
    transFrom: CodeTranspileLang | null;
    placeholder: string;
}>;

export type ExternalCodeSpec = Readonly<{
    lang: string;
    transFrom: CodeTranspileLang | null;
}>;

export type SegPoint = Readonly<{
    clientX: number;
    clientY: number;
}>;

export type SegTapSnap = Readonly<{
    id: string;
    at: number;
}>;

export type SegRevealReq = Readonly<{
    seg: HTMLElement;
    point: SegPoint;
}>;
