import * as cfg from "./config.ts";
import * as Comments from "./comments.ts";

type RssPostRef = Readonly<{
    gid: string;
    pub: string;
    ttl: string;
}>;

type CommentLocationApi = Awaited<ReturnType<typeof Comments.initCommentLocationPicker>>;

const POST_URL = `${cfg.rssCommentPostURL}`;
const LOAD_URL = `${cfg.rssCommentLoadURL}`;

let commentSession: Comments.CommentSession | null = null;
let commentSessionPromise: Promise<Comments.CommentSession> | null = null;

const locationApis = new WeakMap<HTMLElement, CommentLocationApi | null>();
const locationApiPromises = new WeakMap<HTMLElement, Promise<CommentLocationApi | null>>();

/**
 * slug-ish key for rss comments
 * @param {RssPostRef} post
 * @returns {string}
 */
export function mkRssCommentSlug(post: RssPostRef): string {
    const guid = post.gid.trim();
    const stableBase = guid.length > 0 ? guid : `${post.pub}::${post.ttl}`;

    return `${stableBase}::${post.ttl}`;
}

/**
 * shared comment setup, once hopefully
 * @returns {Promise<Comments.CommentSession>}
 */
export async function initRssComments(): Promise<Comments.CommentSession> {
    if (commentSession) return commentSession;

    if (!commentSessionPromise) {
        commentSessionPromise = Comments.initCommentSession();
    }

    commentSession = await commentSessionPromise;
    return commentSession;
}

/**
 * wires the comment stuff in a post
 * @param {HTMLElement} pstDiv
 * @returns {void}
 */
export function atchRssComments(pstDiv: HTMLElement): void {
    const slot = pstDiv.querySelector<HTMLElement>(".rss-comments");
    if (!slot) return;

    Comments.stopCommentEventPropagation(slot);

    if (slot.dataset.rssCommentDisabled === "1") return;
    if (slot.dataset.rssCommentWired === "1") return;

    slot.dataset.rssCommentWired = "1";

    rstNick(slot);

    const tgl = pstDiv.querySelector(".rss-post-toggle");

    /**
     * only load when open, kinda lazy
     * @returns {void}
     */
    const mayLoad = (): void => {
        const cnt = pstDiv.querySelector(".rss-post-content");
        if (!(cnt instanceof HTMLElement)) return;
        if (!cnt.classList.contains("content-expanded")) return;

        void ensRdy(slot).then(() => rndCmts(slot));
    };

    const onToggleKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        window.setTimeout(mayLoad, 360);
    };

    if (tgl instanceof HTMLElement) {
        tgl.addEventListener("click", () => {
            window.setTimeout(mayLoad, 360);
        });

        tgl.addEventListener("keydown", onToggleKeyDown);
    }

    const postButton = slot.querySelector<HTMLElement>("[data-rss-comment-post]");
    postButton?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        void onPst(slot);
    });

    mayLoad();
}

/**
 * get slug from slot
 * @param {HTMLElement} slot
 * @returns {string}
 */
function getSlg(slot: HTMLElement): string {
    return slot.dataset.rssCommentSlug ?? "";
}

/**
 * small status txt setter
 * @param {HTMLElement} slot
 * @param {string} message
 * @returns {void}
 */
function setSts(slot: HTMLElement, message: string): void {
    const status = slot.querySelector<HTMLElement>("[data-rss-comments-status]");
    if (!status) return;

    status.textContent = message;
}

/**
 * form bits, if present
 * @param {HTMLElement} slot
 * @returns {Comments.CommentFormControls | null}
 */
function getCtrls(slot: HTMLElement): Comments.CommentFormControls | null {
    const nickInput = slot.querySelector<HTMLInputElement>("[data-rss-comment-nick]");
    const textarea = slot.querySelector<HTMLTextAreaElement>("[data-rss-comment-msg]");
    const websiteInput = slot.querySelector<HTMLInputElement>("[data-rss-comment-website]");
    const locationCandidate = slot.querySelector("[data-rss-comment-location]");

    const locationSelect = locationCandidate instanceof HTMLSelectElement
        ? locationCandidate
        : null;

    if (!nickInput || !textarea) return null;

    return {
        nickInput,
        textarea,
        websiteInput,
        locationSelect
    };
}

/**
 * nick back into the input
 * @param {HTMLElement} slot
 * @returns {void}
 */
function rstNick(slot: HTMLElement): void {
    if (slot.dataset.rssCommentNickRestored === "1") return;

    const controls = getCtrls(slot);
    if (!controls) return;

    Comments.restoreNick(controls.nickInput);
    slot.dataset.rssCommentNickRestored = "1";
}

/**
 * location dropdown setup, when it exists
 * @param {HTMLElement} slot
 * @returns {Promise<CommentLocationApi | null>}
 */
async function initLoc(slot: HTMLElement): Promise<CommentLocationApi | null> {
    if (locationApis.has(slot)) {
        return locationApis.get(slot) ?? null;
    }

    const currentPromise = locationApiPromises.get(slot);
    if (currentPromise) return currentPromise;

    const locationCandidate = slot.querySelector("[data-rss-comment-location]");
    const flagCandidate = slot.querySelector("[data-rss-comment-location-flag]");

    if (!(locationCandidate instanceof HTMLSelectElement) || !(flagCandidate instanceof HTMLElement)) {
        locationApis.set(slot, null);
        return null;
    }

    const nextPromise = Comments.initCommentLocationPicker({
        selectElement: locationCandidate,
        flagElement: flagCandidate,
        emptyFlagLabel: "🌎"
    })
        .then((api) => {
            locationApis.set(slot, api);
            locationApiPromises.delete(slot);
            return api;
        })
        .catch((error: unknown) => {
            console.error("❌ Error initialising RSS comment location picker:", error);

            locationApis.set(slot, null);
            locationApiPromises.delete(slot);

            return null;
        });

    locationApiPromises.set(slot, nextPromise);
    return nextPromise;
}

/**
 * makes slot ready enough
 * @param {HTMLElement} slot
 * @returns {Promise<CommentLocationApi | null>}
 */
async function ensRdy(slot: HTMLElement): Promise<CommentLocationApi | null> {
    await initRssComments();
    rstNick(slot);

    return initLoc(slot);
}

/**
 * load and paint comments
 * @param {HTMLElement} slot
 * @returns {Promise<void>}
 */
async function rndCmts(slot: HTMLElement): Promise<void> {
    const slug = getSlg(slot);
    if (!slug) return;

    const box = slot.querySelector<HTMLElement>("[data-rss-comments-box]");
    if (!box) return;

    if (slot.dataset.rssCommentsLoading === "1") return;

    slot.dataset.rssCommentsLoading = "1";
    setSts(slot, "Loading comments…");

    try {
        const locationApi = await ensRdy(slot);

        const comments = await Comments.loadCommentRecords({
            url: LOAD_URL,
            scopeParam: "slug",
            scopeValue: slug
        });

        await Comments.renderCommentRecords({
            comments,
            box,
            locationApi
        });

        setSts(slot, comments.length === 0 ? "No comments yet." : "");
        slot.dataset.rssCommentsLoaded = "1";
    } catch (error: unknown) {
        console.error("❌ Error rendering RSS comments:", error);
        setSts(slot, "Comments could not be loaded.");
    } finally {
        slot.dataset.rssCommentsLoading = "0";
    }
}

/**
 * post a comment from this slot
 * @param {HTMLElement} slot
 * @returns {Promise<void>}
 */
async function onPst(slot: HTMLElement): Promise<void> {
    const slug = getSlg(slot);
    const controls = getCtrls(slot);

    if (!slug || !controls) return;

    const session = await initRssComments();
    await initLoc(slot);

    const values = Comments.readCommentForm(controls);
    if (!values) return;

    const result = await Comments.postComment({
        url: POST_URL,
        scope: { slug },
        nick: values.nick,
        msg: values.msg,
        ip: session.userIp,
        sessionToken: session.sessionToken,
        website: values.website,
        location: values.location,
        emptyCredentialsAsString: true
    });

    if (!result.success) {
        alert("Error posting comment: " + result.error);
        return;
    }

    Comments.persistCommentFormValues(controls, values);
    await rndCmts(slot);
}