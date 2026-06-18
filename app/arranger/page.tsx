"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { no } from "@/lib/locale/no";
import { api, ApiError } from "@/lib/client/api";
import { Wizard } from "./Wizard";

export default function HostEntry() {
  const router = useRouter();
  // Chooser-first: the create/open choice is its own screen, so once you're in
  // the wizard there is no "Åpne turnering" button to accidentally hit (which
  // would reset your progress). A back button returns to the chooser.
  const [mode, setMode] = useState<"choose" | "create" | "open">("choose");
  const [hostCode, setHostCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.openHost(hostCode);
      router.push(`/arranger/${r.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "not_found"
          ? no.player.invalidCode
          : no.common.error,
      );
      setBusy(false);
    }
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack scale-in">
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </div>

        {mode === "choose" && (
          <div className="stack" style={{ gap: 12 }}>
            <p className="eyebrow text-center">Arrangør</p>
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={() => setMode("create")}
            >
              {no.host.createTitle}
            </button>
            <button
              className="btn btn-block btn-lg"
              onClick={() => {
                setError(null);
                setMode("open");
              }}
            >
              {no.host.enterTitle}
            </button>
            <Link href="/" className="btn btn-ghost btn-block">
              ← {no.common.back}
            </Link>
          </div>
        )}

        {mode === "create" && <Wizard onExit={() => setMode("choose")} />}

        {mode === "open" && (
          <>
            <p className="eyebrow text-center">{no.host.enterTitle}</p>
            <div className="field">
              <label htmlFor="hc">{no.host.hostCodeLabel}</label>
              <input
                id="hc"
                className="input"
                placeholder="f.eks. ABCD-7F"
                value={hostCode}
                autoFocus
                autoCapitalize="characters"
                onChange={(e) => setHostCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && hostCode.trim() && open()}
              />
            </div>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busy || !hostCode.trim()}
              onClick={open}
            >
              {busy ? <span className="spin" /> : no.host.open}
            </button>
            {error && <div className="banner banner-error">{error}</div>}
            <button
              className="btn btn-ghost btn-block"
              onClick={() => setMode("choose")}
            >
              ← {no.common.back}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
