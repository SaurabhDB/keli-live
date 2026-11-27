import { createContext, useContext } from "react";
import { en, type MessageKey, type Messages } from "./en";
import { fi } from "./fi";

export type Lang = "en" | "fi";
export const LANGS: Lang[] = ["en", "fi"];
const CATALOGS: Record<Lang, Messages> = { en, fi };
const LOCALES: Record<Lang, string> = { en: "en-GB", fi: "fi-FI" }; // en-GB: 24 h clock, °C
export const STORAGE_KEY = "keli.lang";

type Vars = Record<string, string | number>;

/** Translation plus locale-aware formatting for the chosen language. */
export interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Text for a fixed key, with {placeholders} filled (numbers use the locale). */
  t: (key: MessageKey, vars?: Vars) => string;
  /** Text for a key built at runtime (e.g. "class." + code); falls back to `fallback`. */
  tk: (key: string, fallback?: string, vars?: Vars) => string;
  /** A hazard reason from its code and values, e.g. grip_reduced {grip: 0.4}. */
  reason: (code: string, params: Record<string, number>) => string;
  num: (v: number | null | undefined, unit?: string, digits?: number) => string;
  clock: (t: string | Date) => string;
  dayClock: (t: Date) => string;
  duration: (sinceIso: string, now?: number) => string;
  ago: (iso: string) => string;
  stationDistance: (m: number | null) => string;
}

/** Initial language: saved choice, else Finnish for Finnish browsers, else English. */
export function initialLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "fi") return saved;
  return navigator.languages.some((l) => l.toLowerCase().startsWith("fi")) ? "fi" : "en";
}

// Decimals for reason values: grip to 2 (as measured), temperatures and rates to 1.
const REASON_DIGITS: Record<string, number> = { grip: 2 };

export function makeI18n(lang: Lang, setLang: (l: Lang) => void): I18n {
  const msgs = CATALOGS[lang];
  const locale = LOCALES[lang];
  const numFmt = (digits: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fill = (text: string, vars?: Vars) =>
    vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

  const t = (key: MessageKey, vars?: Vars) => fill(msgs[key], vars);
  const tk = (key: string, fallback = key, vars?: Vars) =>
    fill((msgs as Record<string, string>)[key] ?? fallback, vars);
  const num = (v: number | null | undefined, unit = "", digits = 1) =>
    v === null || v === undefined ? "—" : `${numFmt(digits).format(v)}${unit}`;
  const clock = (time: string | Date) =>
    new Date(time).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const dayClock = (d: Date) => d.toLocaleString(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const duration = (sinceIso: string, now = Date.now()) => {
    const min = Math.max(0, Math.round((now - new Date(sinceIso).getTime()) / 60000));
    if (min < 60) return t("dur.min", { m: min });
    const h = Math.floor(min / 60);
    return min % 60 ? t("dur.hm", { h, m: min % 60 }) : t("dur.h", { h });
  };
  const ago = (iso: string) => {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return min < 1 ? t("ago.now") : t("ago.text", { d: duration(iso) });
  };

  return {
    lang,
    setLang,
    t,
    tk,
    reason: (code, params) =>
      tk(
        `reason.${code}`,
        code,
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, num(v, "", REASON_DIGITS[k] ?? 1)])),
      ),
    num,
    clock,
    dayClock,
    duration,
    ago,
    stationDistance: (m) => (m === null ? "—" : m < 20 ? t("dist.site") : t("dist.m", { m })),
  };
}

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
