// Tekster for storskjerm-mappa (bokmål). Lokal i mappa så den kan kopieres
// til andre Sunday-apper uten å dra med seg appens locale-fil.
export const tekst = {
  knapp: "Vis på storskjerm",
  tittel: "Vis på storskjerm",
  intro: "Velg hvordan tavla skal vises på projektor eller TV. Tavla har ingen knapper for vert.",
  lukk: "Lukk",
  anbefalt: "Anbefalt for din enhet",
  fullskjerm: {
    tittel: "Fullskjerm her",
    hjelp: "Bruk denne med HDMI-kabel, eller når skjermen speiles (for eksempel fra iPad). Vertskontrollene skjules i dette vinduet.",
    knapp: "Fullskjerm her",
  },
  eget: {
    tittel: "Åpne tavla i eget vindu",
    hjelp: "Du beholder kontrollene i dette vinduet. Tavla-vinduet kan flyttes til projektoren eller castes.",
    knapp: "Åpne tavla i eget vindu",
    flyttet: "Tavla ble flyttet til den andre skjermen. Trykk F for fullskjerm.",
    flyttHint: "Dra vinduet til prosjektoren og trykk F for fullskjerm.",
    blokkert: "Nettleseren blokkerte det nye vinduet. Tillat popup-vinduer for denne siden og prøv igjen.",
  },
  chromecast: {
    tittel: "Chromecast / Google TV",
    steg1: "Åpne tavla i eget vindu (knappen over).",
    steg2: "I Chrome-menyen ⋮ velger du «Cast …» (Lagre og del → Cast), og velger «Cast fane».",
    steg3: "Velg TV-en i listen. Trykk F i tavla-vinduet for fullskjerm.",
    ikkeChromium: "Dette krever Chrome eller Edge på PC eller Chromebook. Åpne siden i en av dem for å caste.",
  },
  apple: {
    tittel: "Apple TV (AirPlay)",
    mac1: "Mac: åpne Kontrollsenter → Skjermspeiling og velg Apple TV.",
    mac2: "Velg «Bruk som separat skjerm».",
    mac3: "Åpne tavla i eget vindu (knappen over) og dra den over til Apple TV-en. Trykk F for fullskjerm.",
    ios1: "iPad/iPhone: åpne Kontrollsenter → Skjermspeiling og velg Apple TV.",
    ios2: "Trykk deretter «Fullskjerm her» (knappen over).",
  },
  tavle: {
    avslutt: "Avslutt tavlevisning",
    tilkobling: "Mistet kontakten – prøver på nytt …",
  },
} as const;
