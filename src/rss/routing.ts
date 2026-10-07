import type { Pst } from "./types.ts";

const RSS_RESOURCE_TITLE_PREFIX = "${resource}";

export function isBlogPth(): boolean {
    return window.location.pathname.toLowerCase().includes("blog");
}

export function isResourcePth(): boolean {
    return window.location.pathname.toLowerCase().includes("resources");
}

export function isDirectRssPth(): boolean {
    return isBlogPth() || isResourcePth();
}

export function isResourceTitle(title: string): boolean {
    return title.trimStart().startsWith(RSS_RESOURCE_TITLE_PREFIX);
}

export function stripResourceTitle(title: string): string {
    const clean = title.trimStart();

    if (!clean.startsWith(RSS_RESOURCE_TITLE_PREFIX)) return title;

    return clean.slice(RSS_RESOURCE_TITLE_PREFIX.length).trimStart();
}

export function pstsForCurPage(psts: readonly Pst[]): readonly Pst[] {
    if (isResourcePth()) return psts.filter((pst) => pst.res);

    return psts.filter((pst) => !pst.res);
}
