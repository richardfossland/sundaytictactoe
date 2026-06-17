# Legg SundayTicTacToe til på sundaysuite.app

Klar drop-in-oppføring. Selve nettside-kilden (`sundaysuite-website`: `build.py`
+ `site.css`, deploy via `wrangler`, ingen git-remote) lå **ikke** på maskinen da
appen ble bygget/deployet 2026-06-17, så dette steget gjenstår å wire inn der
kilden finnes.

## Hvor

Spillene (SundayChess m.fl.) ligger i **verktøykassa / Toolbox**
(`/toolbox.html` + `/no/verktoykasse.html`), IKKE i 8-produkts-hovedgriden.
Legg SundayTicTacToe **ved siden av SundayChess** i samme verktøykasse-liste/data.

## Innhold

| Felt | Verdi |
|---|---|
| Navn | **SundayTicTacToe** |
| URL | `https://tictactoe.sundaysuite.app` |
| Tagline (NO) | Bondesjakk-turnering for hele gruppa |
| Tagline (EN) | Tic-tac-toe tournament |
| Glyf/ikon | ✕◯ (samme som i appen; gull-X / blå-O) |
| Bullets (NO) | Liga + cup · 3×3 / 4×4 / 5×5 · Bli med med PIN · Spill mot datamaskinen |
| Bullets (EN) | League + cup · 3×3 / 4×4 / 5×5 · Join with a PIN · Play the computer |
| Foreslått kortfarge | dyp jewel-tone som skiller seg fra de andre (f.eks. teal/indigo) |

## Hvis verktøykassa bygges fra en data-liste i build.py

Speil SundayChess-oppføringens struktur og legg til en analog post, f.eks.:

```python
{
    "name": "SundayTicTacToe",
    "url": "https://tictactoe.sundaysuite.app",
    "glyph": "✕◯",
    "tagline": {"no": "Bondesjakk-turnering for hele gruppa",
                "en": "Tic-tac-toe tournament"},
    # ev. samme felt-sett som SundayChess-oppføringen ellers bruker
}
```

## Hvis det er rå HTML-kort

Kopier SundayChess-kortet, bytt navn/url/tagline/glyf til verdiene over.

## Deploy

Fra nettside-repoet: kjør bygget (`python build.py` el.l.) og deploy med
`wrangler` (samme kommando som brukes for resten av siden — sjekk repoets
README/scripts; den har ingen git-remote, så deploy er manuelt via wrangler).

## Verifisering

Etter deploy: åpne sundaysuite.app → verktøykassa/Toolbox (EN + /no) → bekreft at
SundayTicTacToe-kortet vises og lenker til `tictactoe.sundaysuite.app` (200).
