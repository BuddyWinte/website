import type { ReactElement } from "react";
import type {
  ReadAloudButtons,
  VoiceOption
} from "./types.ts";

type MenuProps = Readonly<{
  buttons: ReadAloudButtons;
  voices: readonly VoiceOption[];
  regions: readonly string[];
}>;

/**
 * @param {MenuProps} props
 * @returns {ReactElement}
 */
export function RaMenu(props: MenuProps): ReactElement {
  return (
    <>
      <span id="read-aloud-close" className="read-aloud-close-button" title="Close menu">❌</span>
      <div className="read-aloud-header">Read Aloud</div>
      <div className="read-aloud-controls">
        <div className="read-aloud-fields">
          <button id="read-aloud-region-toggle" title="Set region manually">🌍</button>
          <div className="read-aloud-apikey-wrap">
            <input
              id="read-aloud-apikey"
              type="password"
              placeholder="Azure Speech API Key"
              className="read-aloud-control"
            />
            <div
              className="read-aloud-apikey-eye"
              role="button"
              tabIndex={0}
              aria-label="Show API key"
              title="Show API key"
            />
          </div>
          <div id="read-aloud-region-wrap" className="read-aloud-apikey-wrap" style={{ display: "none" }}>
            <input
              id="read-aloud-region-input"
              type="text"
              placeholder="Region (e.g. uksouth)"
              className="read-aloud-control"
              list="read-aloud-region-list"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <datalist id="read-aloud-region-list">
            {props.regions.map((region) => <option key={region} value={region} />)}
          </datalist>
          <select id="read-aloud-voice" className="read-aloud-control">
            {props.voices.map((voice) => (
              <option key={voice.name} value={voice.name}>{voice.description}</option>
            ))}
          </select>
          <select id="read-aloud-rate" className="read-aloud-control">
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
              <option key={String(rate)} value={rate}>{rate}x</option>
            ))}
          </select>
        </div>
        <div className="read-aloud-buttons">
          <button id="read-aloud-toggle-playpause" title={props.buttons.play.action}>{props.buttons.play.icon}</button>
          <button id="read-aloud-prev" title={props.buttons.prev.action}>{props.buttons.prev.icon}</button>
          <button id="read-aloud-next" title={props.buttons.next.action}>{props.buttons.next.icon}</button>
          <button id="read-aloud-stop" title={props.buttons.stop.action}>{props.buttons.stop.icon}</button>
          <button id="read-aloud-restart" title={props.buttons.restart.action}>{props.buttons.restart.icon}</button>
          <button id="read-aloud-info" title={props.buttons.info.action}>{props.buttons.info.icon}</button>
          <button id="read-aloud-hide" className="menu-crossed" title={props.buttons.hide.action}>{props.buttons.hide.icon}</button>
          <button id="read-aloud-config" className="menu-crossed" title={props.buttons.config.action}>{props.buttons.config.icon}</button>
          <button id="read-aloud-jump-toggle" className="menu-crossed" title={props.buttons.jump.action}>{props.buttons.jump.icon}</button>
          <button id="read-aloud-help" title={props.buttons.help.action}>{props.buttons.help.icon}</button>
          <div className="read-aloud-jump">
            <input
              id="read-aloud-jump-input"
              className="read-aloud-jump-input"
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min="1"
              step="1"
              placeholder="¶ #"
              title="Paragraph number"
            />
            <button id="read-aloud-jump-go" title="Jump to paragraph">✅</button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * @returns {ReactElement}
 */
export function RaHelp(): ReactElement {
  return (
    <>
      <div className="modal-header">
        <h2>Azure Speech Service Read Aloud Help</h2>
      </div>
      <div className="modal-content">
        <ul>
          <li>To use this feature, you need an Azure Speech API key and region.</li>
          <li>
            Get your API key <a href="https://portal.azure.com/" target="_blank" rel="noopener">here</a>.
          </li>
          <li>Paste your API key in the field.</li>
          <li>Select your region and preferred voice.</li>
          <li>Use the play button to start.</li>
        </ul>
        <p>
          For further help, see the <a href="https://learn.microsoft.com/en-gb/azure/ai-services/speech-service/" target="_blank" rel="noopener">official docs</a>.
        </p>
        <p className="modal-note">
          <b>Note:</b> kittycrow.dev will <u>NOT</u> store your API key or region server-side. It is saved only in your browser&apos;s local storage.
          <br />
          See the full implementation on <a href="https://github.com/kittyCrypto-gg/website/blob/main/src/readAloud.tsx" target="_blank" rel="noopener">GitHub</a>.
        </p>
        <p className="modal-note">
          <b>Note:</b> Click anywhere outside this modal to close it.
          <br />
          You can also press <kbd>Esc</kbd> to close it.
        </p>
      </div>
    </>
  );
}

/**
 * @returns {ReactElement}
 */
export function RegionProbe(): ReactElement {
  return (
    <>
      <div className="modal-header">
        <h2>Detecting Azure region…</h2>
      </div>
      <div className="modal-content">
        <p>Checking regions for your API key. This can take a few seconds.</p>
        <p className="modal-note">Press <kbd>Esc</kbd> to close this message.</p>
      </div>
    </>
  );
}

/**
 * @param {string} selector - CSS selector.
 * @returns {HTMLElement | null} First HTMLElement match.
 */
