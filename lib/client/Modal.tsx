"use client";

import { useEffect, useId, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Pure cyclic-neighbour lookup for a keyboard focus trap: given the DOM order
 * of a dialog's focusable elements and which one (if any) currently has
 * focus, returns which one Tab — or Shift+Tab, wrapping the other way —
 * should move to next, wrapping from the last back to the first (and vice
 * versa). `current` not being in `list` (nothing focused yet, or focus is
 * outside the trap) lands on the first element for Tab and the last for
 * Shift+Tab, same as a browser landing on a fresh tab-stop.
 *
 * Generic over `T` and framework/DOM-agnostic on purpose: `Modal`'s keydown
 * handler is the only piece of this that ever touches a real DOM node, so the
 * cycling rule itself is unit-testable with plain arrays (test/modal.test.ts)
 * instead of needing jsdom.
 */
export function nextFocusable<T>(
  list: readonly T[],
  current: T | null,
  shift: boolean,
): T | null {
  if (list.length === 0) return null;
  const idx = current === null ? -1 : list.indexOf(current);
  if (idx === -1) return shift ? list[list.length - 1] : list[0];
  const delta = shift ? -1 : 1;
  return list[(idx + delta + list.length) % list.length];
}

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Renders as the dialog's own heading (an `<h3>`) when given, and becomes
   * the target of `aria-labelledby` automatically. Omit it — and pass
   * `labelledBy` instead, pointing at an id already inside `children` — when
   * the caller renders its own heading and just wants Modal to point at it,
   * rather than getting a second one. */
  title?: string;
  labelledBy?: string;
  describedBy?: string;
  footer?: React.ReactNode;
  /** Only affects the DEFAULT card class (below) — ignored when
   * `cardClassName` is given, which is how every current call site keeps its
   * existing exact card look. */
  size?: ModalSize;
  /** Where to send focus on open; defaults to the first focusable element
   * inside the card (falling back to the card itself if it has none). */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Backdrop element class — default is the shared `.modal-overlay` look;
   * pass e.g. "promo-overlay" to reuse an existing overlay's exact styling
   * (z-index / background / animation) instead. */
  overlayClassName?: string;
  /** Card element class(es) — default is the app's generic `.card` panel at
   * `size`; pass e.g. "confirm-card" to keep an existing card's exact look. */
  cardClassName?: string;
  cardStyle?: React.CSSProperties;
  testId?: string;
}

/**
 * Shared dialog shell: `role="dialog"` + `aria-modal`, a Tab/Shift+Tab focus
 * trap, initial focus moved into the dialog on open and RETURNED to whatever
 * had it before once it closes, Escape → `onClose`, backdrop click →
 * `onClose`, and a body scroll lock while open. Deliberately no global Enter
 * handling — a dialog's autofocused primary button already gets Enter for
 * free from the platform, so a second binding only doubles it up.
 *
 * Multiple Modals can be open at once (e.g. a confirm dialog raised from
 * inside a host modal) without fighting over Escape/Tab: each instance only
 * acts on a keypress when the CURRENTLY FOCUSED element sits inside its own
 * card — and because opening a Modal moves focus into it, that is always the
 * most-recently-opened one. An outer Modal's handler simply no-ops while an
 * inner one has focus.
 */
export function Modal({
  open,
  onClose,
  children,
  title,
  labelledBy,
  describedBy,
  footer,
  size = "md",
  initialFocusRef,
  overlayClassName = "modal-overlay",
  cardClassName,
  cardStyle,
  testId,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const resolvedLabelledBy = labelledBy ?? (title ? titleId : undefined);
  const resolvedCardClassName = cardClassName ?? `card stack modal-${size}`;

  // Move focus in on open; give it back to whatever had it once this closes
  // (unmounts, or `open` flips false while still mounted).
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    openerRef.current = opener instanceof HTMLElement ? opener : null;
    const card = cardRef.current;
    const toFocus =
      initialFocusRef?.current ??
      card?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      card;
    toFocus?.focus();
    return () => {
      openerRef.current?.focus();
    };
    // `initialFocusRef` is a ref: deliberately excluded so this only re-runs
    // when `open` itself changes, not on every render of the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Body scroll lock while open — a background list must not scroll behind a
  // dialog that itself scrolls internally (several of these cards do).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape, and the Tab/Shift+Tab focus trap. Bound on `document` rather than
  // the card so Escape still works if focus ever ends up outside it — but see
  // the containment check below for why this is safe with more than one
  // Modal mounted at once.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;
      const active = document.activeElement;
      // Focus isn't inside THIS card → a different, more-recently-opened
      // Modal owns it instead. Let its own listener handle the keypress.
      if (!(active instanceof HTMLElement) || !card.contains(active)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(
        card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      const next = nextFocusable(focusables, active, e.shiftKey);
      if (next) {
        e.preventDefault();
        next.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={overlayClassName} onClick={onClose} data-testid={testId}>
      <div
        ref={cardRef}
        className={resolvedCardClassName}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby={resolvedLabelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <h3 id={titleId} style={{ fontSize: 20 }}>
            {title}
          </h3>
        )}
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
