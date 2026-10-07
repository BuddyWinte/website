export type Mods = {
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
    shift: boolean;
    fn: boolean;
};

export type ModKey = keyof Mods;

export type DeskPreset = Readonly<{
    keyW: number;
    keyH: number;
    btnGap: number;
    padX: number;
    innerGap: number;
    font: number;
    icon: number;
    radius: number;
}>;

export type SendMsg = Readonly<{
    key: string;
    seq: string;
    mods: Mods;
}>;

export type SendCb = (p: SendMsg) => void;

export type CssRes = Readonly<{
    link: HTMLLinkElement;
    injected: boolean;
}>;

