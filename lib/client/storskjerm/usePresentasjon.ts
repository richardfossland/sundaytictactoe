"use client";

import { useSyncExternalStore } from "react";

const PARAM = "visning";
const VALUE = "tavle";
const EVENT = "sunday:urlchange";

/** Legger `visning=tavle` på en URL og beholder øvrige parametre og hash.
 * Absolutt URL inn → absolutt ut; relativ sti inn → relativ ut. */
export function tavleUrl(href: string): string {
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const url = new URL(href, "http://localhost");
  url.searchParams.set(PARAM, VALUE);
  return absolute ? url.toString() : url.pathname + url.search + url.hash;
}

/** Er URL-en i tavlevisning? (`?visning=tavle`) */
export function erTavleSok(search: string): boolean {
  return new URLSearchParams(search).get(PARAM) === VALUE;
}

/** Tavlevisning skal aldri gi vertskontroller — uansett hva localStorage har.
 * Delt beslutning så den kan testes uten å montere BoardClient. */
export function effectiveHostCode(
  hostCode: string | null,
  presentasjon: boolean,
): string | null {
  return presentasjon ? null : hostCode;
}

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

/** Slå tavlevisning av/på i dette vinduet uten å laste siden på nytt (en
 * navigasjon ville avsluttet fullskjerm og brutt brukerbevegelsen). */
export function settPresentasjon(on: boolean) {
  const url = new URL(window.location.href);
  if (on) url.searchParams.set(PARAM, VALUE);
  else url.searchParams.delete(PARAM);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(EVENT));
}

/** True når siden vises som storskjerm-tavle (`?visning=tavle`). Server- og
 * første klient-render er alltid false (ingen hydreringsfeil). */
export function usePresentasjon(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => erTavleSok(window.location.search),
    () => false,
  );
}
