"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/client/api";
import { no } from "@/lib/locale/no";
import { Modal } from "@/lib/client/Modal";

// Kept in sync with app/api/tournament/[id]/config/route.ts's own MAX_NOTES.
const MAX_NOTES = 280;

/** Small modal for the teacher's private note-to-self (config.notes) — opened
 * from the ✎ button in the host board header (LobbyView/LeagueView). Never
 * shown to students: lib/dto.ts's toBoardTournament strips `notes` from the
 * public board DTO, which is the SAME endpoint this component's caller polls
 * for its board state — so the current value is never available as a prop
 * and this modal fetches it itself (a body with no patch fields is a read;
 * see the config route's header comment) before showing the textarea. */
export function NotesModal({
  tournamentId,
  hostCode,
  onClose,
  onSaved,
}: {
  tournamentId: string;
  hostCode: string;
  onClose: () => void;
  /** Called with the SAVED (trimmed/capped) value after a successful save,
   * so the caller can update its local copy without waiting for the next
   * board refetch. */
  onSaved: (notes: string) => void;
}) {
  const [value, setValue] = useState<string | null>(null); // null = still loading
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    api
      .getTournamentConfig(tournamentId, hostCode)
      .then((r) => {
        if (!cancelled) setValue(r.notes ?? "");
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tournamentId, hostCode]);

  async function save() {
    if (value === null) return;
    setBusy(true);
    setSaveError(false);
    const trimmed = value.trim().slice(0, MAX_NOTES);
    try {
      await api.updateTournamentConfig(tournamentId, hostCode, { notes: trimmed });
      onSaved(trimmed);
      onClose();
    } catch {
      setSaveError(true);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      cardClassName="card stack scale-in"
      cardStyle={{ width: "100%", maxWidth: 420 }}
    >
      <h3 id={titleId} style={{ fontSize: 20 }}>
        {no.host.notesModalTitle}
      </h3>
      {loadError ? (
        <div className="banner banner-error">{no.common.error}</div>
      ) : value === null ? (
        <span className="spin" />
      ) : (
        <>
          <textarea
            className="input"
            rows={3}
            maxLength={MAX_NOTES}
            autoFocus
            placeholder={no.host.notesPlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ resize: "vertical", minHeight: 80 }}
          />
          <span className="faint" style={{ fontSize: 12, alignSelf: "flex-end" }}>
            {value.length} / {MAX_NOTES}
          </span>
        </>
      )}
      {saveError && <div className="banner banner-error">{no.host.notesSaveError}</div>}
      <div className="row">
        <button
          className="btn btn-primary grow"
          disabled={busy || value === null || loadError}
          onClick={save}
        >
          {busy ? <span className="spin" /> : no.host.notesSave}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
          {no.common.cancel}
        </button>
      </div>
    </Modal>
  );
}
