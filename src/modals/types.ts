export type ModalMode = "blocking" | "non-blocking";
export type ModalPlacement = "left" | "right" | "top" | "bottom";

export type ModalPosition = Readonly<{
    target: string | Element;
    gap?: number;
}>;

export type PositionCandidate = Readonly<{
    placement: ModalPlacement;
    space: number;
    required: number;
}>;

export type BubbleGeometry = Readonly<{
    radius: number;
    tailLength: number;
    tailHalfWidth: number;
    strokeWidth: number;
    tailANeck: number;
    tailATip: number;
    tailBNeck: number;
    tailBTip: number;
}>;

export type DecInfo = Readonly<{
    id: string;
    mode: ModalMode;
    readerModeCompatible: boolean;
    windowed: boolean;
}>;

export type DecCtx = Readonly<{
    id: string;
    mode: ModalMode;
    readerModeCompatible: boolean;
    windowed: boolean;
    modalEl: HTMLDivElement;
    overlayEl: HTMLDivElement | null;
    close: () => void;
    setHtml: (html: string) => void;
}>;

export type Dec = Readonly<{
    cssHref?: string;
    init?: () => void;
    patchHtml?: (html: string, info: DecInfo) => string;
    mount?: (ctx: DecCtx) => void | (() => void);
}>;

export type Spec = Readonly<{
    id?: string;
    mode?: ModalMode;

    // default true
    readerModeCompatible?: boolean;

    // default false
    window?: boolean;

    content: string | (() => string);

    modalClassName?: string;
    overlayClassName?: string;

    closeOnEscape?: boolean;
    closeOnOutsideClick?: boolean;

    position?: ModalPosition;
    asTextBubble?: boolean;

    decorators?: readonly Dec[];
}>;

export type OpenRec = Readonly<{
    key: string;
    id: string;
    mode: ModalMode;
    readerModeCompatible: boolean;
    closeOnEscape: boolean;
    close: () => void;
    overlayEl: HTMLDivElement | null;
    stackEl: HTMLDivElement;
}>;

