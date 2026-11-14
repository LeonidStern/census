// Findings: what the census says is wrong, each with an id that stays the same between captures, so diff and exit
// codes can tell one finding from another. Three levels:
//  - rule: a value off the team's rules.json (said OFF in its group), or a control none of rules.parts drew.
//  - accessibility: a WCAG 2.2 AA criterion, with its exceptions; "unsure" where computed styles can't decide.
//  - max: more distinct values in a group than best practice asks for. Needs no rules.json, so it is what a first
//    run says: a team that has never written its design system down still gets a verdict.
// Pure: runs in Node or the page.
import type { Census, CensusGroup } from "./census";

export type Level = "rule" | "accessibility" | "max";
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

/** Every check, the level it reports at, and the preset that turns it on (none: on whenever rules.json feeds it). */
export const CHECKS: Record<string, { level: Level; preset?: string; what: string }> = {
  off: { level: "rule", what: "a value off rules.json (colors, type, radii, shadows)" },
  "no-part": { level: "rule", what: "a control none of rules.parts drew" },
  contrast: { level: "accessibility", preset: "recommended@1", what: "text contrast, WCAG 1.4.3" },
  focus: { level: "accessibility", preset: "recommended@1", what: "focus visible, WCAG 2.4.7" },
  target: { level: "accessibility", preset: "recommended@1", what: "target size, WCAG 2.5.8" },
  max: { level: "max", preset: "best-practice@1", what: "more distinct values in a group than best practice" },
};

export const PRESETS = ["recommended@1", "best-practice@1"];

/**
 * How many distinct values a group may hold before the max check says so. Flat: a design system is finite whether it
 * draws a login box or a trading terminal, and a cap that grows with the page excuses the pages that need it most.
 * Not every group gets one — states, used and field count occurrences of something that is already a finding, so a
 * cap there would say the same thing twice.
 */
export const MAX_DEFAULTS: Record<string, number> = {
  font: 2, type: 8, text: 6, fill: 12, line: 4, radius: 4, shadow: 5, height: 6, layer: 3,
};

/** The groups whose values a design system's colors field has to cover: its palette is held to the sum of their caps. */
const COLOR_GROUPS = ["fill", "text", "line"];

/** What rules.json can say about checks. The whole StyleRules is accepted; only these fields are read. */
type CheckRules = { extends?: string | string[]; checks?: Record<string, CheckSetting>; max?: Record<string, number | "off"> }
  & Partial<Record<"colors" | "type" | "radii" | "shadows" | "parts", unknown>>;

/** The presets rules.json extends, unknown names dropped. */
const presetsOf = (rules: CheckRules) => (typeof rules.extends === "string" ? [rules.extends] : rules.extends ?? []).filter((e) => PRESETS.includes(e));

/** Whether rules.json gives any values to check a page against: without them there is nothing for the other checks to say. */
const hasValues = (rules: CheckRules) => !!(rules.colors || rules.type || rules.radii || rules.shadows || rules.parts);

/**
 * The level a check reports at (null: off) and its number. The rule checks are on whenever rules.json gives what they
 * compare against; the accessibility checks with `extends: "recommended@1"` or when rules.checks names them. The max
 * check is on with `extends: "best-practice@1"`, with a `max` of your own, and by default when rules.json gives no
 * values at all — a first run with no file still says something, which is the whole point of it.
 */
export function checkSetting(rules: CheckRules, check: string): { level: Level | null; n?: number } {
  const c = CHECKS[check];
  if (!c) return { level: null };
  const s = rules.checks?.[check];
  const byPreset = !!c.preset && presetsOf(rules).includes(c.preset);
  const byDefault = check === "max" && (!!rules.max || !hasValues(rules));
  const base: Level | null = c.level === "rule" || byPreset || byDefault ? c.level : null;
  if (s === undefined) return { level: base };
  if (s === "off") return { level: null };
  if (s === "rule") return { level: "rule" };
  if (typeof s === "number") return { level: base ?? c.level, n: s };
  if (Array.isArray(s)) return { level: "rule", n: s[1] };
  return { level: base };
}

/** Whether rules ask for the accessibility or max checks (a preset, a check by name, or no values to check against). */
export const asksChecks = (rules: CheckRules) => !!(rules.extends || (rules.checks && Object.values(rules.checks).some((v) => v !== "off")) || checkSetting(rules, "max").level);

/**
 * The groups holding more distinct values than their max, rarest values first — those are both the easiest to drop
 * and the likeliest to be accidents. One finding per group, so a diff says a group went over or came back under
 * instead of churning an id every time the tail moves. `groups` are counted whole, trimmed rows included.
 */
export function maxFindings(groups: CensusGroup[], rules: CheckRules, name = 3): Finding[] {
  const want = checkSetting(rules, "max");
  if (!want.level) return [];
  const level = want.level;
  const capOf = (group: string) => rules.max?.[group] ?? MAX_DEFAULTS[group];
  const out: Finding[] = [];
  for (const g of groups) {
    const cap = capOf(g.name);
    if (cap === undefined || cap === "off") continue;
    const n = g.rows.length + (g.more ?? 0);
    if (n <= cap) continue;
    const over = n - cap;
    const tail = [...g.rows].sort((a, b) => a.n - b.n).slice(0, Math.min(name, over))
      .map((r) => `${r.key}${(r.note ?? "").replace(/ \((from|via) .*$/, "")}${r.n ? ` ×${r.n}` : ""}${r.at[0] ? `: ${r.at[0]}` : ""}`);
    out.push({ id: `max|${g.name}`, check: "max", level, key: `${g.name} ${n} values, ${cap} the max: drop ${over}, rarest first`, n, at: [...tail, ...(over > tail.length ? [`... ${over - tail.length} more`] : [])] });
  }
  // the design system itself: a page can only use what its palette offers, so the palette is the thing that should be small
  const palette = Object.keys((rules as { colors?: Record<string, string> }).colors ?? {}).length;
  const paletteCap = COLOR_GROUPS.reduce((sum, g) => { const c = capOf(g); return typeof c === "number" ? sum + c : sum; }, 0);
  if (palette && paletteCap && palette > paletteCap) out.push({ id: "max|rules.json|colors", check: "max", level, key: `rules.json lists ${palette} colors, ${paletteCap} the max`, n: palette, at: [] });
  return out;
}

/**
 * The accessibility findings as lines, unsure ones last, then the max findings, each with the values to drop under it.
 * Rule findings are already said OFF in their own groups.
 */
export function findingLines(c: Census, max = 12): string[] {
  const out: string[] = [];
  const fs = (c.findings ?? []).filter((f) => f.level === "accessibility");
  if (fs.length) {
    const lines = [...fs].sort((a, b) => Number(!!a.unsure) - Number(!!b.unsure) || b.n - a.n).slice(0, max)
      .map((f) => `  ${f.key}${f.n > 1 ? ` ×${f.n}` : ""}${f.unsure ? " (unsure)" : ""}${f.note ?? ""}${f.at.length ? `: ${f.at.join("; ")}` : ""}`);
    out.push(`accessibility (${fs.length}, WCAG 2.2 AA; unsure: computed styles can't decide)`, ...lines, ...(fs.length > max ? [`  ... ${fs.length - max} more`] : []));
  }
  const ms = (c.findings ?? []).filter((f) => f.level === "max");
  if (ms.length) {
    out.push(`max (${ms.length} over, best practice)`);
    for (const f of ms) { out.push(`  ${f.key}${f.note ?? ""}`); for (const a of f.at) out.push(`    ${a}`); }
  }
  return out;
}

/**
 * Findings of several pages as one: the same id is one finding, counts added, a place from each page. Max findings
 * are left out — adding two pages' counts says nothing, since the same color on both is one value. mergeCensus
 * counts them again off the merged groups, which is the number that was meant: the system across all the pages.
 */
export function mergeFindings(pages: Record<string, Census>): Finding[] | undefined {
  const names = Object.keys(pages);
  if (!names.some((p) => pages[p].findings)) return undefined;
  const by = new Map<string, { f: Finding; pages: string[] }>();
  for (const p of names) for (const f of pages[p].findings ?? []) {
    if (f.level === "max") continue;
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
export function diffFindings(before: Census, after: Census, max = 40): { lines: string[]; newRules: Finding[]; newAccessibility: Finding[]; maxWorse: Finding[] } {
  const a = new Map((before.findings ?? []).map((f) => [f.id, f])), b = new Map((after.findings ?? []).map((f) => [f.id, f]));
  const line = (f: Finding, extra = "") => `  ${f.key}${extra}${f.n > 1 ? ` ×${f.n}` : ""}${f.unsure ? " (unsure)" : ""}${f.at[0] ? `: ${f.at[0]}` : ""}`;
  const capped = (l: string[]) => (l.length > max ? [...l.slice(0, max), `  ... ${l.length - max} more`] : l);
  const newRules: Finding[] = [], newAccessibility: Finding[] = [], maxWorse: Finding[] = [], nw: string[] = [], fixed: string[] = [], worse: string[] = [], better: string[] = [];
  for (const [id, f] of b) {
    const was = a.get(id);
    // a group with more distinct values than before: what a repo already over its max can still hold itself to
    if (f.level === "max") {
      if (!was) { maxWorse.push(f); worse.push(`  ${f.key}`); }
      else if (f.n > was.n) { maxWorse.push(f); worse.push(`  ${f.key} (was ${was.n})`); }
      else if (f.n < was.n) better.push(`  ${f.key} (was ${was.n})`);
      continue;
    }
    // the same finding covering elements it didn't (a second small button next to the first) is new too
    const more = was ? (f.values ?? []).filter((v) => !(was.values ?? []).includes(v)) : [];
    if (was && !more.length) continue;
    (f.level === "rule" ? newRules : newAccessibility).push(f);
    if (f.level === "accessibility") nw.push(line(f, more.length ? ` (now also ${more.slice(0, 6).join(", ")})` : ""));
  }
  for (const [id, f] of a) {
    if (b.has(id)) continue;
    if (f.level === "accessibility") fixed.push(line(f));
    else if (f.level === "max") better.push(`  ${f.key.replace(/:.*$/, "")} — now under`);
  }
  const lines = [...(nw.length ? [`accessibility new (${nw.length})`, ...capped(nw)] : []), ...(fixed.length ? [`accessibility fixed (${fixed.length})`, ...capped(fixed)] : []),
    ...(worse.length ? [`max worse (${worse.length})`, ...capped(worse)] : []), ...(better.length ? [`max better (${better.length})`, ...capped(better)] : [])];
  return { lines, newRules, newAccessibility, maxWorse };
}
