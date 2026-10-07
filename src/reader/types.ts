export type ReaderButtonKey =
    | "toggleParagraphNumbers"
    | "clearBookmark"
    | "prevChapter"
    | "jumpToChapter"
    | "nextChapter"
    | "scrollDown"
    | "showInfo"
    | "decreaseFont"
    | "resetFont"
    | "increaseFont"
    | "scrollUp";

export interface ReaderButtonDef {
    icon: icons.ReaderIcon;
    action: string;
}

// Type-safe access to the modal decorator ctx without importing non-exported types
export type ModalDecorator = ReturnType<typeof closeOnClick>;
export type ModalCtx = Parameters<NonNullable<ModalDecorator["mount"]>>[0];

export type ReaderButtons = Record<ReaderButtonKey, ReaderButtonDef>;

export interface StoriesIndex {
    [storyName: string]: string[];
}

export interface ChaptersIndexResult {
    chapters: number[];
    urls: string[];
}

export interface RenderXmlDocOpts {
    withBookmarks: boolean;
    storyBase: string | null;
    chapter: number | null;
}

export interface DebugApi {
    pickXml?: () => Promise<void>;
    renderXmlText?: (xmlText: string) => Promise<void>;
    renderXmlFile?: (file: File) => Promise<void>;
    [k: string]: unknown;
}

