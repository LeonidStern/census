// Findings: what the census says is wrong, each with an id that stays the same between captures, so diff and exit
// codes can tell one finding from another. Two levels:
//  - rule: a value off the team's rules.json (said OFF in its group), or a control none of rules.parts drew.
//  - accessibility: a WCAG 2.2 AA criterion, with its exceptions; "unsure" where computed styles can't decide.
// Pure: runs in Node or the page.
import type { Census } from "./census";

export type Level = "rule" | "accessibility";
export type Finding = {
  /** check|subject: no counts or boxes, so the same finding has the same id in two captures */
  id: string;
  check: string;
  level: Level;
  /** the line, without places */
  key: string;
  n: number;
  note?: string;
  at: string[];
  /** the elements it covers, so diff can say what it now also covers */
  values?: string[];
  /** computed styles can't decide (a gradient behind words, a ring set by a script): never fails a build */
  unsure?: boolean;
};

/** A check's level and its number, from rules.checks: "off", "rule", a number, or ["rule", number]. */
export type CheckSetting = "off" | "rule" | number | ["rule", number];

/** Every check, the level it reports at, and whether the recommended preset turns it on. */
export const CHECKS: Record<string, { level: Level; preset: boolean; what: string }> = {
  off: { level: "rule", preset: false, what: "a value off rules.json (colors, type, radii, shadows)" },
  "no-part": { level: "rule", preset: false, what: "a control none of rules.parts drew" },
  contrast: { level: "accessibility", preset: true, what: "text contrast, WCAG 1.4.3" },
  focus: { level: "accessibility", preset: true, what: "focus visible, WCAG 2.4.7" },
  target: { level: "accessibility", preset: true, what: "target size, WCAG 2.5.8" },
};

export const PRESETS = ["recommended@1"];

/**
 * The level a check reports at (null: off) and its number. The rule checks are on whenever rules.json gives what they
 * compare against; the accessibility checks with `extends: "recommended@1"` or when rules.checks names them.
 */
export function checkSetting(rules: { extends?: string; checks?: Record<string, CheckSetting> }, check: string): { level: Level | null; n?: number } {
  const c = CHECKS[check];
  if (!c) return { level: null };
  const s = rules.checks?.[check];
  const base: Level | null = c.level === "rule" || (c.preset && !!rules.extends && PRESETS.includes(rules.extends)) ? c.level : null;
  if (s === undefined) return { level: base };
  if (s === "off") return { level: null };
  if (s === "rule") return { level: "rule" };
  if (typeof s === "number") return { level: base ?? c.level, n: s };
  if (Array.isArray(s)) return { level: "rule", n: s[1] };
  return { level: base };
}

/** Whether rules ask for the accessibility checks (the preset, or a check by name): then the text says the findings. */
export const asksChecks = (rules: { extends?: string; checks?: Record<string, CheckSetting> }) => !!(rules.extends || (rules.checks && Object.values(rules.checks).some((v) => v !== "off")));

/** The accessibility findings as lines, unsure ones last. Rule findings are already said OFF in their own groups. */
export function findingLines(c: Census, max = 12): string[] {
  const fs = (c.findings ?? []).filter((f) => f.level === "accessibility");
  if (!fs.length) return [];
  const lines = [...fs].sort((a, b) => Number(!!a.unsure) - Number(!!b.unsure) || b.n - a.n).slice(0, max)
    .map((f) => `  ${f.key}${f.n > 1 ? ` ×${f.n}` : ""}${f.unsure ? " (unsure)" : ""}${f.note ?? ""}${f.at.length ? `: ${f.at.join("; ")}` : ""}`);
  return [`accessibility (${fs.length}, WCAG 2.2 AA; unsure: computed styles can't decide)`, ...lines, ...(fs.length > max ? [`  ... ${fs.length - max} more`] : [])];
}

/** Findings of several pages as one: the same id is one finding, counts added, a place from each page. */
export function mergeFindings(pages: Record<string, Census>): Finding[] | undefined {
  const names = Object.keys(pages);
  if (!names.some((p) => pages[p].findings)) return undefined;
  const by = new Map<string, { f: Finding; pages: string[] }>();
  for (const p of names) for (const f of pages[p].findings ?? []) {
    const had = by.get(f.id), at = f.at.slice(0, 1).map((x) => `[${p}] ${x}`);
    if (!had) { by.set(f.id, { f: { ...f, at, values: f.values ? [...f.values] : undefined }, pages: [p] }); continue; }
    had.f.n += f.n; had.pages.push(p);
    if (had.f.at.length < 3) had.f.at.push(...at);
    if (f.values) had.f.values = [...new Set([...(had.f.values ?? []), ...f.values])];
    had.f.unsure = had.f.unsure && f.unsure;
  }
  return [...by.values()].map(({ f, pages: ps }) => ({ ...f, note: `${f.note ?? ""} (${ps.length === names.length && names.length > 1 ? "all" : ps.join("+")})` }));
}

/**
 * What changed in the findings between two captures. The lines say accessibility findings new and fixed (a value new
 * off the system is already said by diff's values); both levels' new findings are returned, for --fail-on.
 */
export function diffFindings(before: Census, after: Census, max = 40): { lines: string[]; newRules: Finding[]; newAccessibility: Finding[] } {
  const a = new Map((before.findings ?? []).map((f) => [f.id, f])), b = new Map((after.findings ?? []).map((f) => [f.id, f]));
  const line = (f: Finding, extra = "") => `  ${f.key}${extra}${f.n > 1 ? ` ×${f.n}` : ""}${f.unsure ? " (unsure)" : ""}${f.at[0] ? `: ${f.at[0]}` : ""}`;
  const capped = (l: string[]) => (l.length > max ? [...l.slice(0, max), `  ... ${l.length - max} more`] : l);
  const newRules: Finding[] = [], newAccessibility: Finding[] = [], nw: string[] = [], fixed: string[] = [];
  for (const [id, f] of b) {
    const was = a.get(id);
    // the same finding covering elements it didn't (a second small button next to the first) is new too
    const more = was ? (f.values ?? []).filter((v) => !(was.values ?? []).includes(v)) : [];
    if (was && !more.length) continue;
    (f.level === "rule" ? newRules : newAccessibility).push(f);
    if (f.level === "accessibility") nw.push(line(f, more.length ? ` (now also ${more.slice(0, 6).join(", ")})` : ""));
  }
  for (const [id, f] of a) if (f.level === "accessibility" && !b.has(id)) fixed.push(line(f));
  const lines = [...(nw.length ? [`accessibility new (${nw.length})`, ...capped(nw)] : []), ...(fixed.length ? [`accessibility fixed (${fixed.length})`, ...capped(fixed)] : [])];
  return { lines, newRules, newAccessibility };
}
