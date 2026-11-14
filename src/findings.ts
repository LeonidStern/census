// Findings: what the census says is wrong or worth a look, each with an id that stays the same between captures, so
// accept, diff and exit codes can tell one finding from another. Three levels, kept apart for the reader:
//  - rule: breaks the team's own rules (rules.json): a value off the system, a legacy part, a text color or pair not allowed.
//  - accessibility: a WCAG 2.2 AA criterion, with its exceptions; "unsure" where computed styles can't decide.
//  - observation: evidence of drift (near-duplicates, values used once, hover done two ways). Never an order.
// Pure: runs in Node or the page.
import type { Census } from "./census";

export type Level = "rule" | "accessibility" | "observation";
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
  /** the units diff compares inside one finding (values used once, the heights a part shows) */
  values?: string[];
  /** what accept matches on */
  value?: string;
  part?: string;
  /** computed styles can't decide (a gradient behind words, a ring set by a script): never fails a build */
  unsure?: boolean;
  /** why the team keeps it (from rules.accept) */
  accepted?: string;
  /** an accept entry that no longer covers it, and why */
  lapsed?: string;
};

/** A check's level and its number, from rules.checks: "off", "rule", "advice" (its own level), a number, or [level, number]. */
export type CheckSetting = "off" | "rule" | "advice" | number | [("rule" | "advice"), number];
export type AcceptEntry = { rule: string; value?: string; part?: string; page?: string; max?: number; until?: string; why?: string };

/** Every check, the level it reports at, and whether the recommended preset turns it on. */
export const CHECKS: Record<string, { level: Level; preset: boolean; what: string }> = {
  off: { level: "rule", preset: false, what: "a value off the system (rules.colors, type, radii, shadows)" },
  "no-part": { level: "rule", preset: false, what: "a control none of rules.parts drew" },
  legacy: { level: "rule", preset: false, what: "a part in system.legacyParts on screen" },
  "text-color": { level: "rule", preset: false, what: "text in a color not in system.textColors" },
  pair: { level: "rule", preset: false, what: "a fill and text pair not in system.pairs" },
  contrast: { level: "accessibility", preset: true, what: "text contrast, WCAG 1.4.3" },
  focus: { level: "accessibility", preset: true, what: "focus visible, WCAG 2.4.7" },
  target: { level: "accessibility", preset: true, what: "target size, WCAG 2.5.8" },
  near: { level: "observation", preset: true, what: "a value one step from a more used one" },
  once: { level: "observation", preset: true, what: "values seen on one element only" },
  hover: { level: "observation", preset: true, what: "one part's hover done two ways (wash and step)" },
  quiet: { level: "observation", preset: true, what: "a hover that changes nothing where the part's others change" },
  "small-text": { level: "observation", preset: true, what: "text under 10px (desktop) or 11px (phone), Apple's minimums" },
  "light-text": { level: "observation", preset: true, what: "small text lighter than weight 400" },
  matrix: { level: "observation", preset: true, what: "a part drawn at more heights than its variants" },
  adoption: { level: "observation", preset: true, what: "the share of controls drawn by DS parts" },
};

export const PRESETS = ["recommended@1"];

/**
 * The level a check reports at (null: off) and its number. The team's own rule checks are on whenever their rules are
 * given; the preset's are on with `extends: "recommended@1"` or when rules.checks names them.
 */
export function checkSetting(rules: { extends?: string; checks?: Record<string, CheckSetting> }, check: string): { level: Level | null; n?: number } {
  const c = CHECKS[check];
  if (!c) return { level: null };
  const s = rules.checks?.[check];
  const preset = !!rules.extends && PRESETS.includes(rules.extends);
  const base: Level | null = c.level === "rule" || (c.preset && preset) ? c.level : null;
  if (s === undefined) return { level: base };
  if (s === "off") return { level: null };
  if (s === "rule") return { level: "rule" };
  if (s === "advice") return { level: c.level === "rule" ? "rule" : c.level };
  if (typeof s === "number") return { level: base ?? c.level, n: s };
  if (Array.isArray(s)) return { level: s[0] === "rule" ? "rule" : c.level === "rule" ? "rule" : c.level, n: s[1] };
  return { level: base };
}

/** Whether rules ask for anything beyond the team's own rules (the preset, or a check by name). */
export const asksChecks = (rules: { extends?: string; checks?: Record<string, CheckSetting> }) => !!(rules.extends || (rules.checks && Object.values(rules.checks).some((v) => v !== "off")));

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ").replace(/(\d)px\b/g, "$1");
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Marks the findings the team keeps (rules.accept), from scratch each time: an entry needs `why`; `max` lets it lapse
 * when the finding grows past that count, `until` after that date; `page` limits it to one page (given here as `page`).
 * Returns the entries that matched nothing, and the ones left out for having no why.
 */
export function acceptFindings(c: Census, accept: AcceptEntry[] | undefined, page?: string, now = today()): { unused: AcceptEntry[]; noWhy: AcceptEntry[] } {
  const list = accept ?? [], used = new Set<AcceptEntry>(), noWhy = list.filter((e) => !e.why?.trim());
  for (const f of c.findings ?? []) {
    delete f.accepted; delete f.lapsed;
    for (const e of list) {
      if (!e.why?.trim() || e.rule !== f.check) continue;
      if (e.page !== undefined && e.page !== page) continue;
      if (e.value !== undefined && norm(e.value) !== norm(f.value ?? "") && !norm(f.key).includes(norm(e.value))) continue;
      if (e.part !== undefined && !(f.part ?? "").split(" ").includes(e.part) && f.part !== e.part) continue;
      used.add(e);
      if (e.max !== undefined && f.n > e.max) { f.lapsed = `accepted up to ${e.max}, now ${f.n}`; continue; }
      if (e.until && e.until < now) { f.lapsed = `accept ran out ${e.until}`; continue; }
      f.accepted = e.why!.trim(); delete f.lapsed;
      break;
    }
  }
  return { unused: list.filter((e) => e.why?.trim() && !used.has(e)), noWhy };
}

const HEAD: Record<Level, string> = { rule: "rules broken", accessibility: "accessibility", observation: "observations" };
const WHAT: Record<Level, string> = { rule: "the team's rules", accessibility: "WCAG 2.2 AA; unsure: computed styles can't decide", observation: "evidence, not orders: a reason to look, never alone a reason to change code" };

/** The findings as lines: one group a level, accepted ones counted at its end. Value-off-the-system findings are said in their own groups, so here they are summed. */
export function findingLines(c: Census, max = 12): string[] {
  const all = c.findings;
  if (!all) return [];
  const out: string[] = [];
  for (const level of ["rule", "accessibility", "observation"] as Level[]) {
    const fs = all.filter((f) => f.level === level), shown = fs.filter((f) => !f.accepted), kept = fs.length - shown.length;
    if (!fs.length) continue;
    const off = shown.filter((f) => f.check === "off"), own = shown.filter((f) => f.check !== "off");
    const lines: string[] = [];
    if (off.length) {
      const by = new Map<string, number>();
      for (const f of off) { const g = f.id.split("|")[1]; by.set(g, (by.get(g) ?? 0) + 1); }
      lines.push(`  off the system: ${[...by].map(([g, n]) => `${g} ${n}`).join(", ")} (said OFF in their groups)`);
    }
    const order = (f: Finding) => (f.unsure ? 1 : 0);
    for (const f of [...own].sort((a, b) => order(a) - order(b) || b.n - a.n).slice(0, max)) lines.push(`  ${f.key}${f.n > 1 ? ` ×${f.n}` : ""}${f.unsure ? " (unsure)" : ""}${f.note ?? ""}${f.lapsed ? ` (${f.lapsed})` : ""}${f.at.length ? `: ${f.at.join("; ")}` : ""}`);
    if (own.length > max) lines.push(`  ... ${own.length - max} more`);
    if (kept) lines.push(`  accepted ×${kept}`);
    out.push(`${HEAD[level]} (${shown.length}${level === "rule" ? "" : `, ${WHAT[level]}`})`, ...lines);
  }
  return out;
}

/** Findings of several pages as one: the same id is one finding, counts added, a place from each page. */
export function mergeFindings(pages: Record<string, Census>): Finding[] | undefined {
  const names = Object.keys(pages);
  if (!names.some((p) => pages[p].findings)) return undefined;
  const by = new Map<string, { f: Finding; pages: string[]; accepted: boolean }>();
  for (const p of names) for (const f of pages[p].findings ?? []) {
    const had = by.get(f.id);
    const at = f.at.slice(0, 1).map((x) => `[${p}] ${x}`);
    if (!had) { by.set(f.id, { f: { ...f, at, values: f.values ? [...f.values] : undefined }, pages: [p], accepted: !!f.accepted }); continue; }
    had.f.n += f.n; had.pages.push(p); had.accepted &&= !!f.accepted;
    if (had.f.at.length < 3) had.f.at.push(...at);
    if (f.values) had.f.values = [...new Set([...(had.f.values ?? []), ...f.values])];
    if (f.lapsed) had.f.lapsed = f.lapsed;
    had.f.unsure = had.f.unsure && f.unsure;
  }
  return [...by.values()].map(({ f, pages: ps, accepted }) => {
    if (!accepted) delete f.accepted;
    // a finding a page counts by its own values (used once, adoption) is said per page when the pages differ
    return { ...f, note: `${f.note ?? ""} (${ps.length === names.length && names.length > 1 ? "all" : ps.join("+")})` };
  });
}

/** What changed in the findings between two captures: new and fixed per level; for observations only what is new. */
export function diffFindings(before: Census, after: Census, max = 40): { lines: string[]; newRules: Finding[]; newAccessibility: Finding[] } {
  const a = new Map((before.findings ?? []).filter((f) => !f.accepted).map((f) => [f.id, f])), b = new Map((after.findings ?? []).filter((f) => !f.accepted).map((f) => [f.id, f]));
  const line = (f: Finding, extra = "") => `  ${f.key}${extra}${f.n > 1 ? ` ×${f.n}` : ""}${f.unsure ? " (unsure)" : ""}${f.at[0] ? `: ${f.at[0]}` : ""}`;
  const lines: string[] = [], newRules: Finding[] = [], newAccessibility: Finding[] = [];
  const capped = (l: string[]) => (l.length > max ? [...l.slice(0, max), `  ... ${l.length - max} more`] : l);
  if (!before.findings && !after.findings) return { lines, newRules, newAccessibility };
  for (const level of ["rule", "accessibility", "observation"] as Level[]) {
    const nw: string[] = [], fixed: string[] = [];
    for (const [id, f] of b) {
      if (f.level !== level) continue;
      const was = a.get(id);
      if (!was) { nw.push(line(f)); if (level === "rule") newRules.push(f); if (level === "accessibility") newAccessibility.push(f); continue; }
      // the same finding with new units in it (a new height of a part, a new value used once)
      const more = (f.values ?? []).filter((v) => !(was.values ?? []).includes(v));
      if (more.length) { nw.push(line(f, ` (now also ${more.slice(0, 6).join(", ")})`)); if (level === "rule") newRules.push(f); if (level === "accessibility") newAccessibility.push(f); }
      else if (f.check === "adoption" && f.value !== was.value) nw.push(`  ${f.key} (was ${was.value})`);
    }
    if (level !== "observation") for (const [id, f] of a) if (f.level === level && !b.has(id)) fixed.push(line(f));
    if (nw.length) lines.push(`${HEAD[level]} new (${nw.length})`, ...capped(nw));
    if (fixed.length) lines.push(`${HEAD[level]} fixed (${fixed.length})`, ...capped(fixed));
  }
  return { lines, newRules, newAccessibility };
}
