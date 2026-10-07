export type InitialFloatingPosition = Readonly<{
    x: string;
    y: string;
}>;

export type WindowApiOptions = Readonly<{
    id?: string;
    title?: string;
    launcher?: HTMLElement | null;
    launcherSrc?: string;
    mountTarget?: HTMLElement | null;
    floatMntTrgt?: HTMLElement | null;
    insertAtStart?: boolean;
    onLayoutChange?: (() => void) | null;
    closedLnchrDis?: string;
    initFloat?: boolean;
    initFloatPos?: InitialFloatingPosition;
    initClosed?: boolean;
    initMini?: boolean;
    showCloseBttn?: boolean;
    showMiniBttn?: boolean;
    showFloatBttn?: boolean;
}>;

export type MutableWindowState = {
    float: boolean;
    mini: boolean;
    closed: boolean;
    maxi: boolean;
    x: string;
    y: string;
    width: string;
    height: string;
    launcherX: string;
    launcherY: string;
    restoreX: string;
    restoreY: string;
    restrWidth: string;
    restrHeight: string;
    restrFloat: boolean;
};

export type WindowButtonRole = "close" | "minimise" | "float";

export type FrameStyle = Readonly<{
    display: string;
    position: string;
    left: string;
    top: string;
    width: string;
    height: string;
    maxWidth: string;
    maxHeight: string;
    resize: string;
    zIndex: string;
    paddingTop: string;
    paddingRight: string;
    paddingBottom: string;
    paddingLeft: string;
}>;

export type FramePadding = Readonly<{
    top: string;
    right: string;
    bottom: string;
    left: string;
}>;

export type ContentLayout = Readonly<{
    display: string;
    flexDirection: string;
    flexWrap: string;
    justifyContent: string;
    alignItems: string;
    alignContent: string;
    justifyItems: string;
    justifySelf: string;
    placeItems: string;
    placeContent: string;
    placeSelf: string;
    gap: string;
    rowGap: string;
    columnGap: string;
    gridTemplateColumns: string;
    gridTemplateRows: string;
    gridAutoFlow: string;
    gridAutoColumns: string;
    gridAutoRows: string;
    overflow: string;
    overflowX: string;
    overflowY: string;
}>;

export type WindowHandle = Readonly<{
    open: () => void;
    close: () => void;
    minimise: () => void;
    restore: () => void;
    toggleFloating: () => void;
    toggleMaximised: () => void;
    isClosed: () => boolean;
    isMinimised: () => boolean;
    isFloating: () => boolean;
    getFrameElement: () => HTMLElement | null;
    getWindowId: () => string;
    dispose: () => void;
}>;

