"use client";

import { useState } from "react";
import { StorskjermPanel } from "./StorskjermPanel";
import { tekst } from "./tekst";
import "./storskjerm.css";

/** «Vis på storskjerm» — liten knapp som åpner veiviseren (panelet). Skal bare
 * vises utenfor tavlevisning; kalleren avgjør det. */
export function StorskjermButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost storskjerm-knapp"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">▶︎</span> {tekst.knapp}
      </button>
      {open && <StorskjermPanel onClose={() => setOpen(false)} />}
    </>
  );
}
