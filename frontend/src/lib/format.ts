/** Locale-free helpers. Text and number formatting live in src/i18n (they depend on language). */

/** Digitraffic names look like "vt4_Oulu_Kempele": road code first, then the place. */
export function splitName(name: string): { place: string; road: string } {
  const parts = name.split("_");
  const road = /^(vt|kt|st|mt|e)\d+/i.test(parts[0] ?? "") ? parts.shift()!.toUpperCase() : "";
  return { place: parts.join(" ") || name, road };
}

/** The first configured task in ``tasks`` (config order = priority) and its colour. */
export function taskStyle(
  tasks: string[],
  styles: Record<string, { color: string }>,
): { key: string; color: string } | null {
  const key = Object.keys(styles).find((k) => tasks.includes(k));
  return key ? { key, color: styles[key].color } : null;
}
