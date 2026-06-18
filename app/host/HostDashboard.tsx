"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { no } from "@/lib/locale/no";
import type { TournamentStatus } from "@/lib/types";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { createAuthClient } from "@/lib/supabase/auth-browser";

interface Summary {
  id: string;
  title: string | null;
  status: TournamentStatus;
  join_pin: string;
  created_at: string;
  playerCount: number;
}

type Strings = (typeof no)["hostAuth"];

const STATUS_KEY: Record<TournamentStatus, keyof Strings> = {
  lobby: "statusLobby",
  league: "statusLeague",
  playoff: "statusPlayoff",
  finished: "statusFinished",
};

export function HostDashboard({
  email,
  initial,
  strings: t,
}: {
  email: string;
  initial: Summary[];
  strings: Strings;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Summary[]>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    try {
      await createAuthClient().auth.signOut();
    } catch {
      // even if the network call fails, the cookie clears client-side; push on.
    }
    router.push("/host/login");
    router.refresh();
  }

  async function doDelete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/host/tournaments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setRows((r) => r.filter((x) => x.id !== id));
    } catch {
      setError(t.deleteFailed);
    } finally {
      setBusyId(null);
      setPending(null);
    }
  }

  return (
    <main className="center-screen" style={{ alignItems: "flex-start", paddingTop: "8vh" }}>
      <div className="stack" style={{ width: "100%", maxWidth: 640, gap: 18 }}>
        <div className="spread">
          <div className="brandmark">
            <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
          </div>
          <button className="btn btn-ghost" onClick={signOut}>
            {t.signOut}
          </button>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 30, margin: 0 }}>{t.dashboardTitle}</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            {t.dashboardLede}
          </p>
          <p className="faint" style={{ fontSize: 12 }}>
            {t.signedInAs} <b>{email}</b>
          </p>
        </div>

        <Link href="/arranger" className="btn btn-primary btn-lg btn-block">
          {t.createNew}
        </Link>

        {error && <div className="banner banner-error">{error}</div>}

        {rows.length === 0 ? (
          <div className="card text-center muted" style={{ padding: 24 }}>
            {t.empty}
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {rows.map((row) => (
              <div
                key={row.id}
                className="card spread"
                style={{ padding: 16, alignItems: "center", gap: 12 }}
              >
                <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                  <b style={{ fontSize: 17 }}>{row.title?.trim() || t.untitled}</b>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {t[STATUS_KEY[row.status]]} · {row.playerCount} {t.players} · PIN{" "}
                    {row.join_pin}
                  </span>
                </div>
                <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                  <Link href={`/arranger/${row.id}`} className="btn">
                    {t.openManage}
                  </Link>
                  <button
                    className="btn btn-danger"
                    disabled={busyId === row.id}
                    onClick={() => setPending(row.id)}
                  >
                    {busyId === row.id ? <span className="spin" /> : t.delete}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          message={`${t.deleteConfirmTitle} ${t.deleteConfirmBody}`}
          confirmLabel={t.deleteConfirm}
          cancelLabel={t.deleteCancel}
          danger
          onConfirm={() => doDelete(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </main>
  );
}
