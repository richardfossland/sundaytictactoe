"use client";

import { useEffect } from "react";
import { no } from "@/lib/locale/no";

/** Themed yes/no dialog — a touch-friendly, on-brand replacement for the
 * browser's window.confirm (which renders as a tiny OS popup, easy to miss on a
 * projector / Chromebook). Enter = confirm, Esc / backdrop = cancel. The confirm
 * button is autofocused. */
export function ConfirmDialog({
  message,
  confirmLabel = no.common.confirm,
  cancelLabel = no.common.cancel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm, onCancel]);

  return (
    <div
      className="promo-overlay"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div className="confirm-card" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-msg">{message}</p>
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
      </div>
    </div>
  );
}
