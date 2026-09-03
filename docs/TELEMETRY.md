# Telemetri (klient-beacon) — T5

> Port av sundaychess#87.

Denne appen har én, liten telemetri-mekanisme. Den finnes for å svare på ett
spørsmål læreren ikke kunne få svar på før: **hvorfor ble eleven kastet ut, og
hvorfor låste brettet seg?**

Alt annet er utenfor formålet. Det er ingen analyse, ingen sporing av bruk, ingen
måling av «engasjement».

## Hva som samles inn

Hver hendelse er én rad i `tictactoe.client_events`:

| Felt            | Innhold                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `at`            | tidspunkt                                                               |
| `tournament_id` | turneringens UUID (appens egen, ugjennomsiktige id)                     |
| `player_id`     | spillerens UUID (samme)                                                  |
| `game_id`       | partiets UUID (samme)                                                    |
| `kind`          | én av ti faste verdier (se under)                                       |
| `detail`        | en flat samling koder/tall, maks 2 KB                                    |
| `sid`           | tilfeldig token per sidelast — knytter hendelser fra samme fane sammen  |
| `ua_class`      | bokstavelig talt strengen `mobile` eller `desktop`                       |

`detail` er alltid flat og inneholder bare tall, boolske verdier og korte
strenger (maks 200 tegn). Nøstede objekter og lister blir forkastet — både i
nettleseren og på serveren — så det er ikke mulig å få med seg et helt
tilstandsobjekt ved et uhell.

### Hendelsestypene

| `kind`          | Betyr                                                             |
| --------------- | ------------------------------------------------------------------ |
| `kick`          | økten ble slettet (`reason`: `resume`, `removed`, `logout`, `tournament_gone`) |
| `watchdog`      | trekk-låsen overlevde tidsavbruddet og ble tvangsfrigjort         |
| `channel_error` | sanntidskanalen falt ut (`CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`) |
| `api_timeout`   | tre bakgrunnssynkroniseringer på rad tidsavbrutt                  |
| `api_network`   | tre bakgrunnssynkroniseringer på rad falt på nettverket           |
| `api_5xx`       | tre bakgrunnssynkroniseringer på rad fikk serverfeil              |
| `move_rollback` | et trekk ble rullet tilbake (`code` + `status` fra API-et)         |
| `game_vanished` | partiet eleven satt i fantes ikke lenger i turneringstilstanden   |
| `tab_passive`   | fanen ble passiv (eleven spiller i en annen fane)                 |
| `js_error`      | ubehandlet feil eller avvist løfte i nettleseren                   |

## Hva som IKKE samles inn

- **Ingen navn.** Verken visningsnavn, klassenavn eller turneringstittel.
- **Ingen IP-adresser.** IP-en brukes bare flyktig til rate-limiting i minnet og
  lagres aldri.
- **Ingen user-agent-streng.** Bare `mobile`/`desktop`, avledet av
  `(pointer: coarse)` / `maxTouchPoints`.
- **Ingen koder.** Ikke gjenopptakskoder, ikke vertskoder, ikke PIN-er.
- **Ingen URL-er eller fritekst** eleven har skrevet. `js_error` tar med en
  feilmelding (maks 200 tegn) og *øverste* stack-ramme som `sti:linje` — uten
  vert og uten spørrestreng.
- **Ingen informasjonskapsler**, ingen tredjepart. Dataene forlater aldri appens
  egen database.

## Oppbevaring

**14 dager.** En pg_cron-jobb (`cleanup-client-events-ttt`, 04:20 UTC) sletter
alt eldre. Jobbnavnet har `-ttt`-suffikset alle nattjobbene i denne appen bruker
(se 0004/0010), slik at det aldri kolliderer med sundaychess sin egen
`cleanup-client-events`-jobb i det delte Supabase-prosjektet. Sletting av en
turnering fjerner ikke radene automatisk — de dør på klokka, uansett.

## Hvordan det virker

1. `lib/client/telemetry.ts` — `report(kind, detail?)`. Sender med
   `navigator.sendBeacon` (som overlever at fanen lukkes), ellers `fetch` med
   `keepalive`. Maks 30 hendelser per minutt per fane, og identiske hendelser
   innenfor 5 sekunder telles som én. Kaster aldri, gjør ingenting på serveren,
   og rapporterer aldri sine egne feil (det ville gått i ring).
2. `app/api/telemetry/route.ts` — svarer **alltid** 204. Validerer `kind` mot
   lista, kaster alt som ikke er en UUID, klipper `detail` til 2 KB, og setter
   inn med service-rollen. En manglende tabell er en normal tilstand, ikke en
   feil.
3. `app/api/tournament/[id]/diagnostics/route.ts` — lærerens avlesning, låst av
   samme vertskode og samme rate-limit som spillerkode-ruta.

## Slik leser du det

Åpne turneringstavla på maskinen som opprettet turneringen (vertskoden ligger i
dens `localStorage`) og trykk **🩺 Diagnostikk** øverst til høyre.

Modalen viser først antall per hendelsestype — det er der mønsteret ligger: ti
`channel_error` fra samme `sid` er ett skoletrådløst nett som sliter, mens ti
`kick` med `reason=resume` spredt over mange spillere er noe annet. Deretter
kommer de siste 200 hendelsene med klokkeslett, type, spillernavn (koblet på
lokalt fra tavla — navnet ligger ikke i loggen) og de kompakte detaljene.

## 👤 Eiersteg: kjør migrasjonen

Tabellen opprettes **ikke** automatisk. Til den er kjørt, svarer beacon-en 204
og modalen sier «Telemetri-tabellen er ikke opprettet ennå». Ingenting går i
stykker.

Kjør `supabase/migrations/0012_client_events.sql` i SQL-editoren i
Supabase-dashbordet. `pg_cron` må være tilgjengelig (den er det allerede — 0004
bruker den).
