"use client";

// Route-level error boundary — a transient render/runtime error shows a
// friendly recovery screen instead of a blank, unrecoverable page.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center" style={{ alignItems: "center" }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">✕◯</span> Sunday<b>TicTacToe</b>
        </div>
        <div style={{ fontSize: 40 }}>✕◯</div>
        <h2 style={{ fontSize: 24 }}>Noe gikk galt</h2>
        <p className="muted">Prøv på nytt – framgangen din er trygt lagret på serveren.</p>
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn btn-primary btn-lg" onClick={() => reset()}>
            Prøv igjen
          </button>
          <button
            className="btn btn-lg"
            onClick={() => {
              window.location.href = "/play";
            }}
          >
            Til innlogging
          </button>
        </div>
      </div>
    </main>
  );
}
