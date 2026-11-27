import { type ReactNode, useEffect, useMemo, useState } from "react";
import { I18nContext, initialLang, type Lang, makeI18n, STORAGE_KEY } from "./core";

/** Language choice for the whole app; remembered in localStorage. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const value = useMemo(
    () =>
      makeI18n(lang, (l) => {
        localStorage.setItem(STORAGE_KEY, l);
        setLangState(l);
      }),
    [lang],
  );
  useEffect(() => {
    document.documentElement.lang = lang; // screen readers and hyphenation
  }, [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
