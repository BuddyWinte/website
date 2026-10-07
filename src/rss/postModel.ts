import type { CalSel } from "../calendar.tsx";
import * as helpers from "../helpers.ts";
import { mkRssCommentSlug } from "../rssComments.ts";
import { isResourceTitle, stripResourceTitle } from "./routing.ts";
import type { Pst, RssItm } from "./types.ts";

const RSS_POST_PARAM = "post";
const RSS_JUMP_PARAM = "jumpto";
const RSS_POST_SHARE_ID_LENGTH = 16;

function rdItmTxt(root: Element, tagName: string): string {
    const el = root.getElementsByTagName(tagName)[0];
    return (el?.textContent ?? "").trim();
}

function pidFromGuid(guid: string): string {
    const hashIx = guid.lastIndexOf("#");
    if (hashIx < 0) return "";

    return guid.slice(hashIx + 1).trim();
}

function trimPid(postId: string): string {
    return postId.trim().toLowerCase();
}

function truncPid(postId: string): string {
    const clean = trimPid(postId);
    return clean.length > RSS_POST_SHARE_ID_LENGTH
        ? clean.slice(0, RSS_POST_SHARE_ID_LENGTH)
        : clean;
}

function isPidish(value: string): boolean {
    return /^[a-f0-9]{16,64}$/i.test(value.trim());
}

export function prsRss(xml: string): RssItm[] {
    const prs = new DOMParser();
    const doc = prs.parseFromString(xml, "application/xml");

    return Array.from(doc.querySelectorAll("item")).map((itm) => {
        const cntTags = itm.getElementsByTagName("content:encoded");
        const cnt = (cntTags.length ? (cntTags[0]?.textContent ?? "") : "").trim();
        const guid = rdItmTxt(itm, "guid");
        const postId = rdItmTxt(itm, "postId") || pidFromGuid(guid);

        return {
            title: rdItmTxt(itm, "title"),
            description: rdItmTxt(itm, "description"),
            content: cnt,
            pubDate: rdItmTxt(itm, "pubDate"),
            author: rdItmTxt(itm, "author") || "Kitty",
            guid,
            postId
        };
    });
}

function mkDt(pub: string): Date {
    const dt = new Date(pub);
    return Number.isNaN(dt.getTime()) ? new Date(0) : dt;
}

export function mkPsts(itms: RssItm[]): Pst[] {
    return itms
        .map((itm) => {
            const dt = mkDt(itm.pubDate);
            const res = isResourceTitle(itm.title);

            return {
                ttl: res ? stripResourceTitle(itm.title) : itm.title,
                dsc: itm.description,
                cnt: itm.content,
                pub: itm.pubDate,
                ath: itm.author,
                gid: itm.guid,
                pid: itm.postId,
                dt,
                yr: dt.getFullYear(),
                mo: dt.getMonth() + 1,
                dy: dt.getDate(),
                res
            };
        })
        .sort((a, b) => b.dt.getTime() - a.dt.getTime());
}

export function fmtDt(pub: string): string {
    const dt = mkDt(pub);
    if (dt.getTime() === 0) return "";

    const yr = dt.getFullYear();
    const mo = String(dt.getMonth() + 1).padStart(2, "0");
    const dy = String(dt.getDate()).padStart(2, "0");

    return `${yr}.${mo}.${dy}`;
}

export function mkPstSlug(pst: Pst): string {
    return mkRssCommentSlug(pst);
}

function mkPstFullId(pst: Pst): string {
    return trimPid(pst.pid);
}

export function mkPstShortId(pst: Pst): string {
    const postId = mkPstFullId(pst);
    return postId.length > 0 ? truncPid(postId) : mkPstSlug(pst);
}

export function mkPstDomRef(pst: Pst): string {
    return mkPstShortId(pst);
}

export function mkPstShareUrl(postRef: string): string {
    const url = new URL(
        helpers.setUrlParam(RSS_POST_PARAM, postRef),
        window.location.href
    );

    url.searchParams.delete(RSS_JUMP_PARAM);
    return url.toString();
}

export function mkPstSegShareUrl(postRef: string, segId: string): string {
    const url = new URL(mkPstShareUrl(postRef), window.location.href);
    url.searchParams.set(RSS_JUMP_PARAM, segId);
    return url.toString();
}

export function getReqPstRef(): string | null {
    const postRef = helpers.getUrlParam(RSS_POST_PARAM);
    return postRef && postRef.trim().length > 0 ? postRef.trim() : null;
}

export function getReqJumpId(): string | null {
    const jumpId = helpers.getUrlParam(RSS_JUMP_PARAM);
    const clean = jumpId?.trim() ?? "";

    return /^rss-s-[a-f0-9]{8}$/i.test(clean) ? clean : null;
}

function mtchPstRef(pst: Pst, postRef: string): boolean {
    const clean = postRef.trim();
    if (clean.length === 0) return false;

    const fullId = mkPstFullId(pst);
    const shortId = mkPstShortId(pst);
    const slug = mkPstSlug(pst);
    const normalisedIdRef = trimPid(clean);

    if (isPidish(clean)) {
        return normalisedIdRef === fullId || normalisedIdRef === shortId;
    }

    return clean === slug ||
        normalisedIdRef === fullId ||
        normalisedIdRef === shortId;
}

export function findByPstRef(
    psts: readonly Pst[],
    postRef: string | null
): readonly Pst[] {
    if (!postRef) return [];

    return psts.filter((pst) => mtchPstRef(pst, postRef));
}

export function mkPstsSel(psts: readonly Pst[]): CalSel {
    return {
        yrs: new Set<number>(psts.map((pst) => pst.yr)),
        mos: new Set<number>(psts.map((pst) => pst.mo)),
        dys: new Set<number>(psts.map((pst) => pst.dy))
    };
}

export function mkPstsRefs(
    psts: readonly Pst[]
): ReadonlySet<string> {
    return new Set<string>(psts.map((pst) => mkPstDomRef(pst)));
}
