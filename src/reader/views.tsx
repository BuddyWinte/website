import type { ReactElement } from "react";
import { render2Frag } from "../reactHelpers.tsx";
import * as icons from "../icons.tsx";
import type { ReaderButtonDef } from "./types.ts";

/**
 * @param {ReaderButtonDef}
 * @returns {ReactElement}
 */
function InfoLine(def: ReaderButtonDef): ReactElement {
    return (
        <li>
            <span className="kc-info-icon">{def.icon}</span>
            <span className="kc-info-text">{def.action}</span>
        </li>
    );
}

/**
 * @param {HTMLButtonElement} button
 * @param {icons.ReaderIcon} icon
 * @returns {void}
 */
export function setButtonIcon(button: HTMLButtonElement, icon: icons.ReaderIcon): void {
    if (typeof icon === "string") {
        button.replaceChildren(document.createTextNode(icon));
        return;
    }

    button.replaceChildren(render2Frag(icon));
}

/**
 * @returns {ReactElement}
 */
export function InfoModal(): ReactElement {
    const b = window.buttons;

    return (
        <>
            <div className="modal-header">
                <h2>Navigation Button Guide</h2>
            </div>

            <div className="modal-content">
                <ul className="kc-info-list">
                    <InfoLine {...b.toggleParagraphNumbers} />
                    <InfoLine {...b.clearBookmark} />
                    <InfoLine {...b.prevChapter} />
                    <InfoLine {...b.jumpToChapter} />
                    <InfoLine {...b.nextChapter} />
                    <InfoLine {...b.scrollDown} />
                    <InfoLine {...b.scrollUp} />
                </ul>

                <h3>Font Controls</h3>

                <ul className="kc-info-list">
                    <InfoLine {...b.decreaseFont} />
                    <InfoLine {...b.resetFont} />
                    <InfoLine {...b.increaseFont} />
                </ul>

                <div className="kc-modal-actions" />

                <p className="modal-note">Click outside or press <kbd>Esc</kbd> to close.</p>
            </div>
        </>
    );
}

/**
 * @returns {ReactElement}
 */
export function LangTipModal(): ReactElement {
    return (
        <>
            <div className="modal-header">
                <h3>Did you know?</h3>
            </div>

            <div className="modal-content">
                <p>
                    Some bits of text in the story are interactive. If you see something in another
                    language, hover your mouse over it to reveal a quick translation. On phones and
                    tablets, just tap the text instead.
                </p>

                <label className="kc-checkbox-row">
                    <input id="kc-language-tooltips-help-hide" type="checkbox" />
                    <span>Do not show this tip again</span>
                </label>

                <div className="kc-modal-actions">
                    <button
                        id="kc-language-tooltips-help-close"
                        type="button"
                        style={{ display: "block", margin: "0 auto" }}
                    >
                        Close
                    </button>
                </div>

                <p className="modal-note">You can close this window with <kbd>Esc</kbd>.</p>
            </div>
        </>
    );
}

/**
 * @returns {ReactElement}
 */
export function ReaderModeTipModal(): ReactElement {
    return (
        <>
            <div className="modal-header">
                <h3>Did you know?</h3>
            </div>

            <div className="modal-content">
                <p>
                    Too many distractions? Try Reader Mode here.
                </p>

                <label className="kc-checkbox-row">
                    <input id="kc-reader-mode-help-hide" type="checkbox" />
                    <span>Do not show this tip again</span>
                </label>

                <div className="kc-modal-actions">
                    <button
                        id="kc-reader-mode-help-close"
                        type="button"
                        style={{ display: "block", margin: "0 auto" }}
                    >
                        Close
                    </button>
                </div>

                <p className="modal-note">You can close this window with <kbd>Esc</kbd>.</p>
            </div>
        </>
    );
}

/**
 * @returns {ReactElement}
 */
export function ReaderCtrls(): ReactElement {
    return (
        <>
            <div className="chapter-navigation">
                <button className="btn-toggle-paragraph-numbers">{window.buttons.toggleParagraphNumbers.icon}</button>
                <button className="btn-clear-bookmark">{window.buttons.clearBookmark.icon}</button>
                <button className="btn-prev">{window.buttons.prevChapter.icon}</button>
                <input
                    className="chapter-display"
                    id="reader-chapter-display-top"
                    type="text"
                    value="1"
                    readOnly
                    style={{
                        width: "2ch",
                        textAlign: "center",
                        border: "none",
                        background: "transparent",
                        fontWeight: "bold"
                    }}
                />
                <input
                    className="chapter-input"
                    id="reader-chapter-input-top"
                    type="number"
                    min="0"
                    style={{ width: "2ch", textAlign: "center" }}
                />
                <button className="btn-jump">{window.buttons.jumpToChapter.icon}</button>
                <button
                    className="chapter-end"
                    disabled
                    style={{ width: "2ch", textAlign: "center", fontWeight: "bold" }}
                />
                <button className="btn-next">{window.buttons.nextChapter.icon}</button>
                <button className="btn-scroll-down">{window.buttons.scrollDown.icon}</button>
                <button className="btn-info">{window.buttons.showInfo.icon}</button>
            </div>

            <div className="font-controls">
                <button className="font-decrease">{window.buttons.decreaseFont.icon}</button>
                <button className="font-reset">{window.buttons.resetFont.icon}</button>
                <button className="font-increase">{window.buttons.increaseFont.icon}</button>
            </div>
        </>
    );
}

/**
 * @returns {ReactElement}
 */
export function ImgNav(): ReactElement {
    return (
        <>
            <button className="btn-up" title="Move image up" aria-label="Move image up">
                {icons.MakeImageNavigationArrowIcon(0)}
            </button>

            <div className="horizontal">
                <button className="btn-left" title="Move image left" aria-label="Move image left">
                    {icons.MakeImageNavigationArrowIcon(270)}
                </button>

                <button className="btn-center" title="Reset image position" aria-label="Reset image position">
                    {window.buttons.jumpToChapter.icon}
                </button>

                <button className="btn-right" title="Move image right" aria-label="Move image right">
                    {icons.MakeImageNavigationArrowIcon(90)}
                </button>
            </div>

            <button className="btn-down" title="Move image down" aria-label="Move image down">
                {icons.MakeImageNavigationArrowIcon(180)}
            </button>
        </>
    );
}

/**
 * @param {{ chapter: number }} props
 * @returns {ReactElement}
 */
export function MissingCh(props: { chapter: number }): ReactElement {
    return (
        <div className="chapter-404">
            <h2>📕 Chapter {props.chapter} Not Found</h2>
            <p>Looks like this XML chapter doesn't exist yet.</p>
        </div>
    );
}

