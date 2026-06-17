import Link from "next/link";
import type { CSSProperties } from "react";
import { no } from "@/lib/locale/no";

// helper: stagger index as a CSS custom property
const r = (i: number, extra: CSSProperties = {}): CSSProperties =>
  ({ "--i": i, ...extra }) as CSSProperties;

export default function Landing() {
  return (
    <main className="center-screen">
      <div className="stack text-center" style={{ alignItems: "center", maxWidth: 620, gap: 22 }}>
        <div className="reveal float" style={r(0, { fontSize: 64, lineHeight: 1 })}>
          <span style={{ color: "var(--gold)", filter: "drop-shadow(0 8px 26px rgba(235,184,75,.4))" }}>
            ✕◯
          </span>
        </div>
        <p className="eyebrow reveal" style={r(1)}>
          {no.tagline}
        </p>
        <h1 className="reveal" style={r(2, { fontSize: "clamp(48px, 10vw, 96px)", letterSpacing: "-0.03em" })}>
          Sunday<span style={{ color: "var(--gold)" }}>TicTacToe</span>
        </h1>
        <hr className="thread reveal" style={r(3, { width: 120 })} />
        <p className="muted reveal" style={r(4, { maxWidth: 440, fontSize: 17 })}>
          En bondesjakk-turnering for hele gruppa. Arrangøren styrer tavla,
          spillerne blir med med en PIN — akkurat som Kahoot, men med X og O.
        </p>

        {/* two entrances */}
        <div
          className="reveal"
          style={r(5, {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
            width: "100%",
            marginTop: 8,
          })}
        >
          <Link href="/host" className="card stack entrance" style={{ padding: 26, alignItems: "center", gap: 8, textAlign: "center" }}>
            <span className="entrance-glyph">🖥️</span>
            <b style={{ fontSize: 19 }}>{no.landing.teacher}</b>
            <span className="faint" style={{ fontSize: 13 }}>{no.landing.teacherSub}</span>
          </Link>
          <Link href="/play" className="card stack entrance" style={{ padding: 26, alignItems: "center", gap: 8, textAlign: "center" }}>
            <span className="entrance-glyph">✕</span>
            <b style={{ fontSize: 19 }}>{no.landing.student}</b>
            <span className="faint" style={{ fontSize: 13 }}>{no.landing.studentSub}</span>
          </Link>
        </div>

        <div
          className="row reveal"
          style={r(6, { marginTop: 2, gap: 10, flexWrap: "wrap", justifyContent: "center" })}
        >
          <Link href="/versus" className="btn btn-ghost">
            ⚔︎ {no.landing.versus}
          </Link>
          <Link href="/solo" className="btn btn-ghost">
            ✕ {no.solo.cta}
          </Link>
        </div>
      </div>
    </main>
  );
}
