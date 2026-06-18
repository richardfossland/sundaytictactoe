import Link from "next/link";

// 404 boundary — a friendly, on-brand "side finnes ikke" screen instead of the
// default unstyled Next.js page. Matches the tone of error.tsx.
export default function NotFound() {
  return (
    <main className="center-screen">
      <div
        className="card card-narrow stack text-center"
        style={{ alignItems: "center" }}
      >
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </div>
        <div style={{ fontSize: 40 }} aria-hidden="true">
          ✕◯
        </div>
        <h2 style={{ fontSize: 24 }}>Fant ikke siden</h2>
        <p className="muted">
          Lenken kan være utdatert, eller turneringen er avsluttet.
        </p>
        <div className="row" style={{ marginTop: 6 }}>
          <Link href="/" className="btn btn-primary btn-lg">
            Til forsiden
          </Link>
          <Link href="/play" className="btn btn-lg">
            Bli med i et spill
          </Link>
        </div>
      </div>
    </main>
  );
}
