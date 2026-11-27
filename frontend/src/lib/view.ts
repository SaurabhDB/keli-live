import type { AppConfig, ClassStyle, Measurements, View } from "../types";

/** What the map colours by in a view: its legend (in order) and each item's value. */
export interface Legend {
  prefix: "hazard" | "class"; // translation key prefix: t(`${prefix}.${value}`)
  styles: Record<string, ClassStyle>;
  order: string[];
  valueOf: (m: Measurements) => string | null;
}

export function legendFor(cfg: AppConfig, view: View): Legend {
  const styles: Record<string, ClassStyle> = view === "hazard" ? cfg.hazards : cfg.classes;
  return {
    prefix: view === "hazard" ? "hazard" : "class",
    styles,
    order: Object.keys(styles),
    valueOf: view === "hazard" ? (m) => m.hazard : (m) => m.road_class,
  };
}
