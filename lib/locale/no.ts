// All user-facing strings, Bokmål. Keep this the single source so an English
// pass is a one-file copy later.

export const no = {
  appName: "SundayTicTacToe",
  tagline: "Tre-på-rad-turnering for hele gruppa",
  metaTitle: "SundayTicTacToe — tre-på-rad-turnering for hele gruppa",
  metaDescription:
    "Tre-på-rad-turnering på storskjerm med liga, sluttspill og lag. Arrangøren styrer tavla, spillerne blir med med en PIN.",

  common: {
    next: "Neste",
    back: "Tilbake",
    create: "Opprett",
    cancel: "Avbryt",
    close: "Lukk",
    confirm: "Bekreft",
    loading: "Laster …",
    copy: "Kopier",
    copied: "Kopiert!",
    error: "Noe gikk galt",
    retry: "Prøv igjen",
    notFoundTitle: "Fant ikke siden",
    notFoundBody: "Lenken kan være utdatert, eller turneringen er avsluttet.",
    notFoundHome: "Til forsiden",
    notFoundJoin: "Bli med i et spill",
    moveListLabel: "Trekkliste",
    soundOn: "Slå på lyd",
    soundOff: "Slå av lyd",
    fullscreenEnter: "Fullskjerm",
    fullscreenExit: "Avslutt fullskjerm",
  },

  landing: {
    lede: "En tre-på-rad-turnering for hele gruppa. Arrangøren styrer tavla, spillerne blir med med en PIN — stort på storskjerm, med X og O.",
    teacher: "Jeg arrangerer",
    teacherSub: "Lag en turnering og vis tavla",
    student: "Jeg spiller",
    studentSub: "Bli med med en PIN",
    versus: "Spill mot hverandre",
    // "Slik funker det" 3-step strip + reassurance line on the landing page.
    howTitle: "Slik funker det",
    step1: "Lag turnering",
    step2: "Elevene skanner QR eller taster PIN",
    step3: "Følg tavla",
    reassurance:
      "Gratis · ingen elevkontoer · funker på Chromebook og mobil · ~20 min",
  },

  // OPTIONAL Sunday Account host login + "mine turneringer"-dashboard. Helt
  // adskilt fra den kodebaserte arrangør-flyten (som fortsatt er anonym).
  hostAuth: {
    landingLink: "Arrangør med Sunday-konto →",
    loginTitle: "Logg inn som arrangør",
    loginLede:
      "Valgfritt: logg inn med Sunday-kontoen din for å samle turneringene dine på ett sted. Du kan også arrangere helt anonymt fra forsiden.",
    emailLabel: "E-post",
    emailPlaceholder: "deg@skolen.no",
    sendMagicLink: "Send innloggingslenke",
    sending: "Sender …",
    magicLinkSent: "Sjekk innboksen din — vi har sendt en innloggingslenke til",
    google: "Logg inn med Sunday-konto",
    loginError: "Klarte ikke å sende lenken — sjekk adressen og prøv igjen.",
    backToAnon: "← Arranger anonymt i stedet",
    dashboardTitle: "Mine turneringer",
    dashboardLede: "Turneringene du har laget mens du var innlogget.",
    signedInAs: "Innlogget som",
    signOut: "Logg ut",
    createNew: "+ Ny turnering",
    empty: "Du har ingen turneringer ennå. Lag din første!",
    openManage: "Åpne",
    delete: "Slett",
    deleteConfirmTitle: "Slette turneringen?",
    deleteConfirmBody:
      "Dette sletter turneringen og alle spillere, runder og partier permanent. Kan ikke angres.",
    deleteConfirm: "Slett turnering",
    deleteCancel: "Avbryt",
    deleteFailed: "Klarte ikke å slette. Prøv igjen.",
    loadFailed: "Klarte ikke å hente turneringene dine.",
    statusLobby: "Lobby",
    statusLeague: "Liga pågår",
    statusPlayoff: "Sluttspill",
    statusFinished: "Ferdig",
    untitled: "Uten tittel",
    players: "spillere",
    // Teacher's private note-to-self (config.notes), shown under the title
    // on each dashboard card — this page is host-only (getHost() gates it).
    notesLabel: "Notat",
  },

  versus: {
    title: "Spill mot hverandre",
    subtitle: "To spillere – uten en hel turnering",
    sameScreen: "Samme skjerm",
    sameScreenSub: "Del én enhet, bytt på å trekke",
    online: "Hver sin enhet",
    onlineSub: "Del en kode, spill fra hver sin telefon",
    create: "Lag et parti",
    join: "Bli med med kode",
    yourName: "Navnet ditt",
    namePlaceholder: "F.eks. Ada",
    opponentCode: "Kode fra motspilleren",
    shareCode: "Del denne koden med motspilleren",
    waiting: "Venter på at motspilleren blir med …",
    whiteTurn: "X sin tur",
    blackTurn: "O sin tur",
    whiteWon: "X vant!",
    blackWon: "O vant!",
    draw: "Uavgjort",
    newGame: "Nytt parti",
    newGameConfirm: "Starte nytt parti? Det pågående partiet blir borte.",
    rematch: "⚔︎ Omkamp",
    start: "Start",
    back: "Tilbake",
    create2: "Lag parti",
    joinGame: "Bli med",
    invalidCode: "Fant ingen kamp med den koden",
    full: "Kampen er allerede full",
    connecting: "Kobler til …",
    done: "Partiet er ferdig",
  },

  host: {
    createTitle: "Ny turnering",
    quickStart: "Rask start",
    customize: "Tilpass turnering …",
    // Auto-title for "Rask start" — becomes "Turnering DD.MM" (see
    // app/arranger/page.tsx). Kept as a plain prefix so the date formatting
    // (which isn't language content) stays out of the locale file.
    quickStartTitlePrefix: "Turnering",
    enterTitle: "Åpne turnering",
    enterPrompt: "Skriv vertskoden for å åpne tavla igjen",
    hostCodeLabel: "Vertskode",
    missingHostCode:
      "Vertskoden mangler på denne enheten. Gå til forsiden og åpne turneringen på nytt med vertskoden din.",
    open: "Åpne",
    pinLabel: "Bli-med-PIN",
    joinUrlLabel: "Eller gå til",
    players: "Spillere",
    noPlayers: "Ingen har blitt med ennå …",
    startLeague: "Start liga",
    startCup: "Start cup",
    standings: "Stilling",
    rank: "#",
    name: "Navn",
    score: "Poeng",
    tiebreak: "Buchholz",
    tiebreakHelp:
      "Summen av motstandernes poeng — skiller spillere med like mange poeng.",
    round: "Runde",
    games: "Partier",
    nextRound: "Neste runde",
    replay: "Omspill",
    bracketRecap: "Slik gikk det",
    roundOver: "Runden er ferdig!",
    backToArranging: "Tilbake til arrangering",
    // LiveGamesView caps the projector grid at 8 boards by default (more than
    // that per screen becomes unreadable) — this expands/collapses the rest.
    showAllGames: (n: number) => `Vis alle (${n})`,
    showFewerGames: "Vis færre",
    playRematch: "Spill omkamp",
    advanceBySeed: "Send høyest rangert videre",
    drawChoiceHint:
      "Uavgjort i runden — spill omkamp, eller send den høyest rangerte videre.",
    rematchStarted: "Omkamp startet — spilles nå.",
    forceResolve: "Tving fullføring",
    forceResolveConfirm:
      "Sette alle uferdige partier til uavgjort? Dette kan ikke angres.",
    inProgress: "Pågår",
    finished: "Ferdig",
    bye: "Frirunde",
    overrideTitle: "Overstyr resultat",
    setResult: "Sett resultat",
    draw: "Uavgjort",
    // Button label only (OverrideModal) — the imperative "cancel the game".
    // The PAST-TENSE status shown in the games grid uses `aborted` below;
    // reusing this one there read as an instruction, not a state.
    abort: "Annuller partiet",
    // Status label for an aborted game (LeagueView.resultLabel).
    aborted: "Avbrutt",
    overrideResultConfirm: (name: string) => `Sette resultatet til at ${name} vinner?`,
    overrideDrawConfirm: "Sette resultatet til uavgjort?",
    overrideAbortConfirm:
      "Annullere partiet? Ingen av spillerne får poeng for det, og dette kan ikke angres.",
    overrideAbsentConfirm: (name: string, scope: "round" | "tournament") =>
      scope === "tournament"
        ? `Sette ${name} som borte for resten av turneringen? Motstanderen vinner dette partiet.`
        : `Sette ${name} som borte denne runden? Motstanderen vinner dette partiet.`,
    absentTitle: "Spiller borte → motstander vinner",
    absentRound: "Denne runden",
    absentTournament: "Ute av turneringen",
    absentSuffix: "er borte",
    showCodes: "Spillerkoder",
    codesTitle: "Spillerkoder",
    codesHint: "Les koden til en spiller som har mistet sin.",
    // CodesModal: masked-by-default roster (UX-3).
    codesWarning: "Koder gir tilgang til elevens økt — ikke vis på storskjerm",
    tapToReveal: "Trykk for å vise",
    tapToHide: "Trykk for å skjule",
    // LobbyView: the host code is never shown by default (UX-2).
    revealHostCode: "Vis vertskode",
    hostCodeWarning: "Ikke vis på storskjerm",
    join: "Bli med",
    liveToggle: "Live",
    boardToggle: "Tavle",
    // SpectateGame's own back button — distinct from `liveToggle` above (that
    // one SWITCHES a mode; this one LEAVES the single-game view for the grid),
    // even though they used to share the same copy.
    backToGames: "Alle partier",
    spectateWon: "vant!",
    spectateDraw: "Uavgjort",
    kick: "Kast ut",
    kickConfirm: (name: string) => `Kaste ut ${name}?`,
    online: "Tilkoblet",
    offline: "Frakoblet",
    // LeagueView: the collapsed roster of players marked absent/left, with a
    // way back in for the NEXT round (pairings for the current round are
    // already set — see app/api/game/reinstate/route.ts).
    outOfTournamentSection: (n: number) => `Ute av turneringen (${n})`,
    reinstate: "Ta inn igjen",
    reinstateConfirm: (name: string) =>
      `Fra neste runde blir ${name} paret igjen.`,
    // Finish-early escape hatch (LeagueView, next to "Neste runde") — lowers
    // config.leagueRounds to the round in progress, so the existing
    // "Fullfør"/finish path fires as soon as it's done.
    finishEarly: "Avslutt etter denne runden",
    finishEarlyConfirm: (round: number) =>
      `Turneringen avsluttes når runde ${round} er ferdig. Sluttspill (hvis valgt) starter som normalt.`,
    finishEarlyError: "Klarte ikke å korte ned turneringen. Prøv igjen.",
    // Teacher's private note-to-self (config.notes) — editable from the host
    // board header; never shown to students.
    editNotes: "Rediger notat",
    notesModalTitle: "Notat til deg selv",
    notesPlaceholder: "F.eks. klasse, time …",
    notesSave: "Lagre",
    notesSaveError: "Klarte ikke å lagre notatet. Prøv igjen.",
    podium: "Vinnere",
    champion: "Mester",
    newTournament: "Ny turnering",
    bracket: "Sluttspill",
    timer: "Rundetid",
    timeUp: "Tiden er ute",
    // Screen-reader-only announcement (RoundTimer) — the visible countdown
    // itself is aria-live="off" (it ticks every second; announcing every
    // tick would be unusable), so this fires once, at the 60s mark.
    timerOneMinuteLeft: "Ett minutt igjen",
    addMinute: "+1 min",
    timeUpSuggestion: "Tiden er ute – vil du avslutte runden?",
    endRound: "Avslutt runden",
    arrangerEyebrow: "Arrangør",
    goTo: "Gå til",
    needTwoPlayers: "Minst 2 spillere må bli med.",
    finishRound: "Fullfør",
    allGamesMustFinish: "Alle partier må være ferdige før neste runde.",
    crownChampion: "Kår mester",
    allRoundGamesMustFinish: "Alle partier i runden må være ferdige.",
    noLiveGames: "Ingen partier pågår akkurat nå.",

    // Finished-screen print / save-as-PDF (window.print()).
    printResults: "Skriv ut / lagre som PDF",

    // Fair-play readout — a game whose `result_source` isn't plain "play".
    // Short marker shown next to the result badge in the results grid, plus
    // its hover title. Keyed by ResultSource (see lib/types.ts); `resultSourceLabel`
    // in lib/dto.ts looks these up so the mapping can't drift from the enum.
    resultSourceLabel: {
      walkover: "W.O.",
      opponent_absent: "Fraværende",
      teacher_override: "Overstyrt",
      timeout_draw: "Tid ute",
      bye: "Frirunde",
    } as Record<string, string>,
    resultSourceTitle: {
      walkover: "Walkover — registrert av arrangøren uten at partiet ble spilt",
      opponent_absent: "Motstanderen var borte — automatisk seier",
      teacher_override: "Resultatet er satt manuelt av arrangøren",
      timeout_draw: "Tiden løp ut i partiet — satt til remis",
      bye: "Frirunde denne runden",
    } as Record<string, string>,
    // Compact legend on the finished screen: how many games were decided
    // without play (walkover / fraværende / overstyrt) — a fair-play readout,
    // not a comment on ordinary byes or time-forced draws.
    resultSourceLegend: (n: number) =>
      `${n} ${n === 1 ? "parti" : "partier"} avgjort uten spill (walkover/fravær/overstyring).`,
  },

  // Lærerens avlesning av klient-telemetrien (T5, port av sundaychess#87). Se
  // docs/TELEMETRY.md.
  diag: {
    open: "Diagnostikk",
    title: "Diagnostikk",
    hint: "Hva som faktisk skjedde med elevene i denne turneringen. Ingen navn, ingen IP-adresser – bare hendelsestyper og koder. Slettes automatisk etter 14 dager.",
    empty: "Ingen hendelser registrert. Det er et godt tegn.",
    unavailable:
      "Telemetri-tabellen er ikke opprettet ennå – kjør migrasjon 0012 i Supabase-dashbordet.",
    countsTitle: "Hendelser etter type",
    eventsTitle: "Siste hendelser",
    time: "Tid",
    who: "Spiller",
    what: "Hva",
    detail: "Detaljer",
    unknownPlayer: "Ukjent",
    // Hendelsestypene, i klartekst. Nøklene MÅ matche `kind` i migrasjon 0012.
    kinds: {
      kick: "Kastet ut av økten",
      watchdog: "Brettet låste seg (vakthund)",
      channel_error: "Sanntidskanalen falt ut",
      api_timeout: "Tidsavbrudd mot serveren",
      api_network: "Nettverksfeil",
      api_5xx: "Serverfeil",
      move_rollback: "Trekk rullet tilbake",
      game_vanished: "Partiet forsvant",
      tab_passive: "Fanen ble passiv (spiller i en annen fane)",
      js_error: "Feil i nettleseren",
    } as Record<string, string>,
  },

  wizard: {
    step: "Steg",
    of: "av",
    titleStep: "Tittel",
    titleHint: "Valgfritt — f.eks. «7A vårturnering»",
    titlePlaceholder: "Turneringstittel",
    // Private note-to-self, entered on the same step as the title. Never
    // shown to students (see lib/dto.ts's toBoardTournament).
    notesLabel: "Notat til deg selv — klasse, time …",
    notesPlaceholder: "Valgfritt, bare synlig for deg",
    reviewNotes: "Notat",
    formatStep: "Turneringsform",
    formatLeague: "Liga",
    formatLeagueSub: "Alle spiller flere runder (sveitsisk) — ev. sluttspill til slutt",
    formatCup: "Cup",
    formatCupSub: "Rett på utslagsrunder — vinn eller ryk 🏆",
    reviewFormat: "Form",
    roundsStep: "Antall ligarunder",
    roundsHint: "Sveitsisk system — anbefalt 5",
    roundsRuleOfThumb: "Tommelfingerregel: færre runder enn spillere",
    roundsFewer: "Færre runder",
    roundsMore: "Flere runder",
    // Player-count-aware warning for lib/tournament/roundsAdvice.ts — not
    // wired into any screen yet (the wizard runs before anyone has joined,
    // so it has no roster to check against; see that file's doc comment).
    roundsWarningRematch: (rounds: number, players: number) =>
      `Med ${rounds} runder og ${players} spillere vil noen møtes to ganger.`,
    playoffStep: "Sluttspill?",
    playoffOn: "Med sluttspill",
    playoffOff: "Bare liga",
    playoffSizeStep: "Antall i sluttspill",
    playoffSizeHint: "Topp N går videre til utslagsrunder",
    timerStep: "Rundetimer",
    timerHint: "Nedtellingen vises på tavla og på elevenes skjermer.",
    timerOff: "Av",
    min: "min",
    reactionsStep: "Emoji-reaksjoner?",
    reactionsHint:
      "Spillerne kan sende emojis til hverandre under partiet. Skru av hvis det blir for mye fnising.",
    reactionsOn: "På",
    reactionsOff: "Av",
    teamsStep: "Lagturnering?",
    teamsHint:
      "Spillerne fordeles automatisk jevnt på lagene når de blir med. Lagets poeng = summen av spillernes poeng.",
    teamsOff: "Individuelt",
    reviewTeams: "Lag",
    variantStep: "Variant",
    variantHint:
      "Antall på rad for å vinne øker med brettstørrelsen — store brett gir sjeldnere uavgjort og holder turneringen spennende.",
    variants: {
      "3x3": "Klassisk – tre på rad på 3×3",
      "4x4": "Større brett – fire på rad på 4×4",
      "5x5": "Stort brett – fire på rad på 5×5, sjelden uavgjort",
    } as Record<string, string>,
    reviewStep: "Se over",
    edit: "Endre",
    reviewRounds: "Ligarunder",
    reviewPlayoff: "Sluttspill",
    reviewTimer: "Rundetimer",
    reviewReactions: "Reaksjoner",
    reviewVariant: "Variant",
    none: "Ingen",
  },

  awards: {
    title: "Utmerkelser",
    fastest_win: "Lynseieren",
    longest_game: "Maratonpartiet",
    centre_opener: "Midtåpneren",
    comeback: "Snuoperasjonen",
    blocker: "Muren",
    draw_king: "Uavgjortkongen",
    movesUnit: "trekk",
    openingsUnit: (n: number) => `${n} ${n === 1 ? "åpning" : "åpninger"} i midten`,
    comebackUnit: (n: number) => `${n} ${n === 1 ? "snuoperasjon" : "snuoperasjoner"}`,
    blocksUnit: (n: number) => `${n} ${n === 1 ? "redning" : "redninger"}`,
    drawsUnit: (n: number) => `${n} uavgjort`,
  },

  puzzle: {
    title: "Tre på rad mens du venter",
    promptWin: (glyph: string) => `Hvor må ${glyph} sette seg for å vinne?`,
    promptBlock: (glyph: string) => `Blokker ${glyph}!`,
    oneMove: "ett trekk",
    solved: "Riktig! ✓",
    wrong: "Ikke helt – prøv en gang til ✗",
    next: "Neste",
    counter: "løst",
  },

  teams: {
    standings: "Lagstilling",
    members: "spillere",
    yourTeam: "Du er på lag",
    winner: "Vinnerlag",
  },

  predict: {
    title: "Tipp resultatene",
    hint: "Hvem vinner de andre partiene? 1 poeng per riktig svar.",
    white: "X",
    draw: "Uavgjort",
    black: "O",
    leaderboard: "Tippeliga",
    points: "poeng",
    myPoints: "Dine tippepoeng",
  },

  player: {
    joinTitle: "Bli med",
    pinPlaceholder: "6-sifret PIN",
    join: "Bli med",
    nameTitle: "Hva heter du?",
    namePlaceholder: "Visningsnavn",
    nameHint: "Bruk gjerne bare fornavn",
    resumeTitle: "Koden din",
    resumeHint: "Skriv den ned! Du trenger den hvis fanen lukkes.",
    resumeAck: "Jeg har skrevet ned koden",
    haveCode: "Har du en kode?",
    resumePlaceholder: "f.eks. KOLE-7F",
    resume: "Gjenoppta",
    waitingStart: "Venter på at arrangøren starter …",
    waitingNext: "Venter på neste motstander …",
    waitingBye:
      "Du har frirunde denne runden og får 1 poeng gratis 🎉 Slapp av til neste runde.",
    outOfTournament:
      "Du er ute av turneringen 🏁 — godt spilt! Si fra til læreren hvis dette er feil, så kan hun ta deg inn igjen fra tavla.",
    cupProgress: "Cup-stigen",
    yourTurn: "DIN TUR",
    opponentTurn: "Venter på motstander",
    // Background "your turn" cue for a hidden/backgrounded tab — see
    // lib/client/turnCue.ts. Same wording as the in-page `yourTurn` banner
    // above (this is the browser tab title / notification title version of
    // the same cue, not a separate message).
    turnTitle: "DIN TUR",
    notifyOptIn: "🔔 Varsle meg når det er min tur",
    notifyBody: "Motstanderen din har trukket – bli med igjen for å spille.",
    boardLabel: "Brettet",
    otherTabTitle: "Du spiller i en annen fane",
    otherTabBody: "Spillet er åpent i en annen fane på denne enheten. For å unngå trøbbel spiller bare én fane om gangen.",
    otherTabResume: "Spill her",
    youAre: "Du er",
    white: "X",
    black: "O",
    vs: "mot",
    offerDraw: "Tilby uavgjort",
    resign: "Gi opp",
    resignConfirm: "Gi opp partiet?",
    drawOffered: "Uavgjort tilbudt",
    drawSent: "Forespørsel om uavgjort sendt til motstander – venter på svar",
    drawDeclined: "Motstander avslo uavgjort",
    drawOfferedByOpponent: "Motstander tilbyr uavgjort",
    accept: "Godta",
    decline: "Avslå",
    lineComplete: "Tre på rad",
    // Ghost button in the notice slot while an incoming draw offer's dialog
    // was dismissed (Esc/backdrop) without an answer — the offer is still
    // pending, so this reopens the same dialog.
    answerDrawOffer: "Svar på tilbudet om uavgjort",
    // aria-describedby text on that dialog: Esc/backdrop only closes it
    // (the offer stays pending) — declining is a separate, explicit button.
    drawOfferDismissHint: "Esc eller klikk utenfor lukker uten å svare — tilbudet står fortsatt til du trykker Avslå eller Godta.",
    youWon: "Du vant! 🎉",
    youLost: "Du tapte",
    gameDraw: "Uavgjort",
    drawResult: "Uavgjort",
    wonSub: "Sterkt spilt!",
    lostSub: "Bedre lykke neste runde.",
    drawSub: "Godt spilt av begge.",
    invalidPin: "Fant ingen turnering med den PIN-en",
    tournamentFinished: "Turneringen er ferdig 🏆",
    showMyCode: "Vis koden min",
    invalidCode: "Ugyldig kode",
    illegalMove: "Ulovlig trekk",
    notYourTurn: "Det er ikke din tur",
    connection: "Tilkobling ustabil – synkroniserer …",
    // The small persistent "reconnecting" badge (R7) — distinct copy from
    // `connection` above, which is a one-shot toast on a failed move.
    reconnecting: "Kobler til igjen …",
    refreshNow: "Oppdater",
    logOut: "Logg ut",
    // Resume trouble that is NOT "wrong code" — the session is kept, so every
    // one of these ends by saying the student can just try again.
    resumeTimeout: "Serveren svarte ikke i tide. Økten din er trygg – prøv igjen.",
    resumeOffline: "Ingen forbindelse. Sjekk nettet, og prøv igjen – økten din er trygg.",
    resumeBusy: "Mange kobler til samtidig. Vent noen sekunder og prøv igjen.",
    resumeServer: "Serveren svarer ikke akkurat nå. Økten din er trygg – prøv igjen.",
    tournamentGone: "Turneringen finnes ikke lenger",
    tournamentGoneBody:
      "Arrangøren har avsluttet eller slettet den. Logg ut, så kan du bli med i en ny.",
    gameLoadFailed: "Fant ikke partiet. Prøv igjen eller gå tilbake.",
    sessionExpired: "Den forrige økten din er utløpt. Bli med på nytt.",
    // Removed from the lobby (usually the ghost-sweep after a locked phone).
    // Never silence: say it happened, and give them the one button that fixes it.
    removedLobbyTitle: "Fjernet fra lobbyen",
    removedLobbyBody:
      "Du ble borte en stund, så arrangøren tok deg ut av lobbyen. Trykk under, så er du med igjen.",
    rejoinLobby: "Bli med igjen",
    rejoinFailed: "Klarte ikke å bli med igjen. Prøv en gang til.",
    // Removed after the tournament started — the pairings are set, so a silent
    // slip-back-in isn't possible. Say the truth instead of pointing at a PIN
    // screen that just dead-ends in `alreadyStarted` below: the teacher is the
    // one who can actually undo this (app/api/game/reinstate/route.ts).
    removedTitle: "Du ble fjernet fra turneringen",
    removedBody:
      "Arrangøren har tatt deg ut av denne turneringen. Si fra til læreren — hun kan ta deg inn igjen fra tavla.",
    // The button stays: it's the right move for joining a DIFFERENT, still-open
    // tournament — just not a way back into this one.
    rejoinNew: "Bli med i en annen turnering",
    // /api/join's 409 already_started, once pairings exist. Late-join stays
    // blocked (see the reinstate route's doc comment) — but the old copy
    // ("Turneringen har allerede startet.") was a dead end with no next step.
    alreadyStarted:
      "Turneringen er i gang — si fra til læreren, så kan hun ta deg inn fra tavla.",
    oppOutOfTime: "Motstanderens tid er ute!",
    claimWin: "Krev seier på tid",
    myTimeOut: "Tiden din er ute",
    finalTitle: "Sluttresultat",
    youPlaced: "Du ble nr.",
    of: "av",
    // Waiting-room card for a player who's eliminated (playoff), has a bye, or
    // finished their game early while others are still playing — links to
    // /solo in a NEW tab, so opening it never loses the tournament screen.
    soloWhileWaitingTitle: "Venter du?",
    soloWhileWaitingBody: "Spill mot datamaskinen mens du venter.",
    soloWhileWaitingCta: "♟️ Spill solo (åpner i ny fane)",
  },

  solo: {
    cta: "Solo-spill",
    title: "Solo-spill",
    subtitle: "Øv deg når som helst – ingen PIN nødvendig",
    chooseColor: "Velg merke",
    white: "X (først)",
    black: "O (andre)",
    random: "Tilfeldig",
    variant: "Brett",
    difficulty: "Nivå",
    adaptive: "Tilpasset",
    adaptiveNote: "Nivået følger deg – vinner du, blir maskinen litt bedre.",
    levelChip: (n: number) => `Nivå ≈ ${n}`,
    easy: "Lett",
    medium: "Middels",
    hard: "Vanskelig",
    impossible: "Uslåelig",
    unbeatable3x3Note:
      "På 3×3 spiller Uslåelig perfekt — det beste du kan få er uavgjort.",
    start: "Start parti",
    thinking: "Datamaskinen tenker …",
    yourTurn: "Din tur",
    waiting: "Datamaskinen sin tur",
    computer: "Datamaskinen",
    you: "Du",
    newGame: "Nytt parti",
    newGameConfirm: "Starte nytt parti? Det pågående partiet blir borte.",
    undo: "Angre",
    back: "Tilbake",
    youWon: "Du vant!",
    youLost: "Datamaskinen vant",
    draw: "Uavgjort",
    wonSub: "Sterkt spilt mot maskinen!",
    lostSub: "Prøv igjen – du klarer det!",
    drawSub: "Jevnt parti.",
  },
} as const;

export type Locale = typeof no;
