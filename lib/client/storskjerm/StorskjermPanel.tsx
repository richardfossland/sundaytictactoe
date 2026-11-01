"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isApple, isChromium, isIOSLike } from "./detect";
import { openTavleVindu } from "./openTavleVindu";
import { settPresentasjon } from "./usePresentasjon";
import { tekst } from "./tekst";
import "./storskjerm.css";

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

type Melding = { slag: "ok" | "feil"; tekst: string } | null;

/** Veiviser for å vise tavla på storskjerm. Selvstendig dialog (Esc lukker,
 * aria-modal, enkel Tab-felle, fokus tilbake ved lukking) uten avhengigheter
 * utenom React. Rekkefølgen på kortene følger enheten: Chromecast først i
 * Chromium, Apple TV først på Apple-enheter. */
export function StorskjermPanel({ onClose }: { onClose: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [melding, setMelding] = useState<Melding>(null);
  // Siste onClose i en ref: kalleren sender en ny funksjon ved hver render
  // (tavla poller hvert 5. s), og fokus-effekten under skal bare kjøre én gang
  // — ellers hopper fokuset tilbake til første knapp ved hver oppdatering.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  // Enhet leses etter mount (navigator finnes ikke på serveren).
  const [enhet, setEnhet] = useState({ apple: false, ios: false, chromium: false });

  useEffect(() => {
    const ua = navigator.userAgent;
    const hints = { maxTouchPoints: navigator.maxTouchPoints };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnhet({
      apple: isApple(ua, hints),
      ios: isIOSLike(ua, hints),
      chromium: isChromium(ua, hints),
    });
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    card?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const list = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (list.length === 0) return;
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? list[i <= 0 ? list.length - 1 : i - 1]
        : list[i === -1 || i === list.length - 1 ? 0 : i + 1];
      e.preventDefault();
      next.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  const fullskjermHer = () => {
    settPresentasjon(true);
    // Kallet må skje i selve klikket (brukerbevegelse).
    document.documentElement.requestFullscreen?.().catch(() => {});
    onClose();
  };

  const eget = async () => {
    setMelding(null);
    const r = await openTavleVindu();
    if (!r.ok) setMelding({ slag: "feil", tekst: tekst.eget.blokkert });
    else
      setMelding({
        slag: "ok",
        tekst: r.placedOnOtherScreen ? tekst.eget.flyttet : tekst.eget.flyttHint,
      });
  };

  const alleKort = {
    fullskjerm: (
      <section key="full" className="storskjerm-kort">
        <h4>{tekst.fullskjerm.tittel}</h4>
        <p className="muted">{tekst.fullskjerm.hjelp}</p>
        <button type="button" className="btn btn-primary" onClick={fullskjermHer}>
          {tekst.fullskjerm.knapp}
        </button>
      </section>
    ),
    eget: (
      <section key="eget" className="storskjerm-kort">
        <h4>{tekst.eget.tittel}</h4>
        <p className="muted">{tekst.eget.hjelp}</p>
        <button type="button" className="btn btn-primary" onClick={eget}>
          {tekst.eget.knapp}
        </button>
        {melding && (
          <p
            className={`storskjerm-melding storskjerm-melding-${melding.slag}`}
            role="status"
          >
            {melding.tekst}
          </p>
        )}
      </section>
    ),
    chromecast: (
      <section
        key="cast"
        className={`storskjerm-kort${enhet.chromium ? " storskjerm-anbefalt" : ""}`}
      >
        <h4>
          {tekst.chromecast.tittel}
          {enhet.chromium && <span className="storskjerm-merke">{tekst.anbefalt}</span>}
        </h4>
        <ol>
          <li>{tekst.chromecast.steg1}</li>
          <li>{tekst.chromecast.steg2}</li>
          <li>{tekst.chromecast.steg3}</li>
        </ol>
        {!enhet.chromium && <p className="muted">{tekst.chromecast.ikkeChromium}</p>}
      </section>
    ),
    apple: (
      <section
        key="apple"
        className={`storskjerm-kort${enhet.apple ? " storskjerm-anbefalt" : ""}`}
      >
        <h4>
          {tekst.apple.tittel}
          {enhet.apple && <span className="storskjerm-merke">{tekst.anbefalt}</span>}
        </h4>
        {!enhet.ios && (
          <ol>
            <li>{tekst.apple.mac1}</li>
            <li>{tekst.apple.mac2}</li>
            <li>{tekst.apple.mac3}</li>
          </ol>
        )}
        {(enhet.ios || !enhet.apple) && (
          <ol>
            <li>{tekst.apple.ios1}</li>
            <li>{tekst.apple.ios2}</li>
          </ol>
        )}
      </section>
    ),
  };

  const rekkefolge = enhet.apple
    ? [alleKort.apple, alleKort.fullskjerm, alleKort.eget, alleKort.chromecast]
    : enhet.chromium
      ? [alleKort.chromecast, alleKort.eget, alleKort.fullskjerm, alleKort.apple]
      : [alleKort.fullskjerm, alleKort.eget, alleKort.chromecast, alleKort.apple];

  return (
    <div className="storskjerm-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        className="card stack storskjerm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId}>{tekst.tittel}</h3>
        <p className="muted">{tekst.intro}</p>
        {rekkefolge}
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {tekst.lukk}
        </button>
      </div>
    </div>
  );
}
