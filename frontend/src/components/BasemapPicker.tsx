import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/core";

interface Props {
  ids: string[]; // basemap ids in menu order; "auto" first
  value: string;
  onChange: (id: string) => void;
}

/** Toolbar menu for the map style. Free, no-key styles only (see config.json basemaps). */
export function BasemapPicker({ ids, value, onChange }: Props) {
  const { t, tk } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="picker" ref={root}>
      <button className="chip glass" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={t("basemap.title")}>
        🗺 {tk(`basemap.${value}`)} ▾
      </button>
      {open && (
        <ul className="menu glass" role="menu" aria-label={t("basemap.title")}>
          {ids.map((id) => (
            <li key={id}>
              <button
                role="menuitemradio"
                aria-checked={id === value}
                className={id === value ? "on" : ""}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                {tk(`basemap.${id}`)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
