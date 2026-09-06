"use client";

import { useId } from "react";
import { no } from "@/lib/locale/no";
import { Modal } from "@/lib/client/Modal";

/** Themed yes/no dialog — a touch-friendly, on-brand replacement for the
 * browser's window.confirm (which renders as a tiny OS popup, easy to miss on a
 * projector / Chromebook). The confirm button is autofocused, so Enter already
 * confirms via the button — no separate global binding. Esc / backdrop click
 * dismiss (see `onDismiss` below). */
export function ConfirmDialog({
  message,
  confirmLabel = no.common.confirm,
  cancelLabel = no.common.cancel,
  dismissLabel,
  danger = false,
  onConfirm,
  onCancel,
  onDismiss,
}: {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Extra `aria-describedby` text for when Escape/backdrop does something
   * DIFFERENT from the visible cancel/decline button — e.g. GameView's draw
   * offer, where Escape leaves the offer pending instead of declining it.
   * Purely descriptive; renders visually hidden. */
  dismissLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Escape / backdrop-click handler. Defaults to `onCancel` so existing
   * callers (resign, host overrides) keep "dismiss == cancel". Pass a
   * distinct handler when dismissing must NOT be the same as the explicit
   * cancel/decline button. */
  onDismiss?: () => void;
}) {
  const dismiss = onDismiss ?? onCancel;
  const msgId = useId();
  const hintId = useId();

  return (
    <Modal
      open
      onClose={dismiss}
      labelledBy={msgId}
      describedBy={dismissLabel ? hintId : undefined}
      overlayClassName="promo-overlay"
      cardClassName="confirm-card"
    >
      <p id={msgId} className="confirm-msg">
        {message}
      </p>
      {dismissLabel && (
        <p id={hintId} className="visually-hidden">
          {dismissLabel}
        </p>
      )}
      <div className="row" style={{ justifyContent: "center" }}>
        <button
          className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
          autoFocus
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </Modal>
  );
}
