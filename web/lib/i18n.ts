import type { Text } from "./types";

// Interface strings. Country content (names, seasons, layers, advisories)
// comes from the country profile; these are only the app's own words.
// Add a language by adding a block; missing keys fall back to English.
const UI: Record<string, Record<string, string>> = {
  en: {
    chooseCountry: "Choose a country",
    noForecast: "No forecast published yet",
    firstRun: "The outlook appears here after the first monthly forecast run for this country.",
    issued: "Issued",
    covers: "Covers",
    members: "ensemble members",
    layers: "Map layers",
    showBy: "Show by",
    grid: "Grid",
    language: "Language",
    forecastRun: "Forecast",
    clickHint: "Select a place on the map to see its outlook.",
    atLocation: "At this location",
    areaAverage: "Area average",
    outside: "No forecast for this location.",
    loading: "Loading…",
    close: "Close",
    memberSpread: "Rainfall in each ensemble member",
    belowNormal: "Below normal",
    nearNormal: "Near normal",
    aboveNormal: "Above normal",
    mm: "mm",
    loadFailed: "Couldn't load the forecast. Check the connection and reload the page.",
    countryMissing: "This country isn't set up.",
    allCountries: "All countries",
    sources: "Sources",
    daysAfter: "days after the start",
    around: "around",
    noOnset: "No onset expected",
    share: "of the area",
    unknownArea: "Area",
  },
  sw: {
    chooseCountry: "Chagua nchi",
    noForecast: "Hakuna utabiri uliochapishwa bado",
    firstRun: "Utabiri utaonekana hapa baada ya utabiri wa kwanza wa kila mwezi wa nchi hii.",
    issued: "Imetolewa",
    covers: "Kipindi",
    members: "wanachama wa utabiri",
    layers: "Tabaka za ramani",
    showBy: "Onyesha kwa",
    grid: "Gridi",
    language: "Lugha",
    forecastRun: "Utabiri",
    clickHint: "Chagua mahali kwenye ramani kuona utabiri wake.",
    atLocation: "Mahali hapa",
    areaAverage: "Wastani wa eneo",
    outside: "Hakuna utabiri kwa mahali hapa.",
    loading: "Inapakia…",
    close: "Funga",
    memberSpread: "Mvua katika kila mwanachama wa utabiri",
    belowNormal: "Chini ya kawaida",
    nearNormal: "Karibu na kawaida",
    aboveNormal: "Juu ya kawaida",
    mm: "mm",
    loadFailed: "Imeshindwa kupakia utabiri. Angalia muunganisho kisha pakia ukurasa upya.",
    countryMissing: "Nchi hii haijawekwa.",
    allCountries: "Nchi zote",
    sources: "Vyanzo",
    daysAfter: "siku baada ya kuanza",
    around: "karibu",
    noOnset: "Mvua hazitarajiwi kuanza",
    share: "ya eneo",
    unknownArea: "Eneo",
  },
};

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", sw: "Kiswahili", fr: "Français", pt: "Português", am: "አማርኛ", rw: "Ikinyarwanda",
  ar: "العربية", so: "Soomaali", ha: "Hausa",
};

export function t(lang: string, key: string): string {
  return UI[lang]?.[key] ?? UI.en[key] ?? key;
}

export function tx(value: Text | null | undefined, lang: string): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[lang] ?? value.en ?? Object.values(value)[0] ?? "";
}
