export { Modal, ModalFactory } from "./modal.ts";
export { ModalSession } from "./session.ts";
export { closeOnClick, onModalEvent } from "./decorators.ts";
export type {
    Dec,
    DecCtx,
    DecInfo,
    ModalMode,
    ModalPlacement,
    ModalPosition,
    Spec
} from "./types.ts";

import { ModalFactory } from "./modal.ts";

export const factory = new ModalFactory();
