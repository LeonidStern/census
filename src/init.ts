// census init: a first rules.json from the tokens a product declares, not from what it happens to show. What is on
// screen but not declared goes under `observed`, where it is still off the system until a person moves it into a
// scale, so the draft never makes today's mistakes the rules. Pure: runs in Node.
import type { Census, DeclaredToken } from "./census";
import { parseColor } from "./color";

type Draft = { extends: string; colors?: Record<string, string>; radii?: number[]; shadows?: Record<string, string>; parts?: string[]; observed?: Record<string, string[]> };
const hexOf = (v: string) => { const c = parseColor(v); return c ? `#${c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")}${c[3] < 0.995 ? Math.round(c[3] * 255).toString(16).padStart(2, "0") : ""}` : null; };
const bare = (n: string) => n.replace(/^--/, "");

/** A tokens file as flat name → value: W3C design tokens ({ "$value": … } nested in groups) or a flat map. */
export function flattenTokens(v: unknown, path: string[] = [], out: DeclaredToken[] = []): DeclaredToken[] {
  if (!v || typeof v !== "object") return out;
  const o = v as Record<string, unknown>;
  if ("$value" in o || "value" in o) {
    const raw = String(o.$value ?? o.value);
    const ref = raw.match(/^\{(.+)\}$/);
    out.push({ name: `--${path.join("-")}`, raw: ref ? `var(--${ref[1].replace(/\./g, "-")})` : raw, value: raw, used: true, ...(hexOf(raw) ? { color: hexOf(raw)! } : {}) });
    return out;
  }
  for (const [k, x] of Object.entries(o)) {
    if (k.startsWith("$")) continue;
    if (typeof x === "string" || typeof x === "number") out.push({ name: `--${[...path, k].join("-")}`, raw: String(x), value: String(x), used: true, ...(hexOf(String(x)) ? { color: hexOf(String(x))! } : {}) });
    else flattenTokens(x, [...path, k], out);
  }
  return out;
}

/**
 * The draft and what a person should review: colors named by the deepest custom property that holds the value (the
 * primitive; aliases are listed), radii and shadows by their names, parts as seen; then what the screen shows that no
 * token declares, under `observed`, and values one step from a more used one.
 */
export function draftRules(pages: Record<string, Census>, extra: DeclaredToken[] = []): { rules: Draft; report: string[] } {
  const declared = new Map<string, DeclaredToken>();
  for (const t of [...Object.values(pages).flatMap((c) => c.tokens ?? []), ...extra]) if (!declared.has(t.name)) declared.set(t.name, t);
  const report: string[] = [];
  const toks = [...declared.values()].filter((t) => t.used);
  if (!declared.size) report.push("no custom properties declared on :root or a theme scope (or their sheets are another site's): pass a tokens file with --tokens; every value below is only observed");
  // colors: a token whose own text is a color is a primitive; one that is only var(--other) is an alias of it
  const colors: Record<string, string> = {}, aliases: string[] = [];
  for (const t of toks) {
    const alias = t.raw.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (alias) { if (t.color || declared.get(alias[1])?.color) aliases.push(`${bare(t.name)} → ${bare(alias[1])}`); }
    else if (t.color && !Object.values(colors).includes(t.color)) colors[bare(t.name)] = t.color;
  }
  const px = (v: string) => { const m = v.match(/^(-?[\d.]+)(px|rem)$/); return m ? (m[2] === "rem" ? +m[1] * 16 : +m[1]) : null; };
  const radii = [...new Set(toks.filter((t) => /radius|rounded|corner/i.test(t.name)).map((t) => px(t.value)).filter((v): v is number => v !== null && v > 0 && v < 999))].sort((a, b) => a - b);
  const shadows: Record<string, string> = {};
  for (const t of toks) if (/shadow|elevation/i.test(t.name) && /\d/.test(t.value) && !/^var\(/.test(t.raw)) shadows[bare(t.name)] = t.value;
  // what the screen shows
  const seen = new Map<string, Map<string, number>>(), near: string[] = [], parts = new Set<string>();
  for (const [page, c] of Object.entries(pages)) for (const g of c.groups) {
    if (g.name === "parts") { for (const r of g.rows) if (!/no DS part/.test(r.key)) parts.add(r.key.split(" ")[0]); continue; }
    if (!/^(fill|text|line|type|radius|shadow)$/.test(g.name)) continue;
    const m = seen.get(g.name) ?? new Map<string, number>();
    seen.set(g.name, m);
    for (const r of g.rows) {
      const k = g.name === "text" || g.name === "fill" || g.name === "line" ? r.key.split(" ")[0] : r.key;
      if (/\(icon\)/.test(r.key)) continue;
      m.set(k, (m.get(k) ?? 0) + r.n);
      if (/ near /.test(r.note ?? "")) near.push(`[${page}] ${g.name} ${r.key} ×${r.n}${(r.note ?? "").replace(/ \((from|via) .*$/, "")}`);
    }
  }
  const declaredColors = new Set(Object.values(colors).concat(toks.filter((t) => t.color).map((t) => t.color!)));
  const usedColor = new Map<string, number>();
  // a capture taken with rules names colors by their tokens: back to the value, through the draft's names or the page's
  const byName = (k: string) => colors[k.split("/")[0]] ?? declared.get(`--${k.split("/")[0]}`)?.color ?? null;
  for (const g of ["fill", "text", "line"]) for (const [k, n] of seen.get(g) ?? []) { const h = k.startsWith("#") ? k.slice(0, 7) : byName(k); if (h) usedColor.set(h, (usedColor.get(h) ?? 0) + n); }
  const observed: Record<string, string[]> = {};
  const offColors = [...usedColor].filter(([h]) => !declaredColors.has(h)).sort((a, b) => b[1] - a[1]);
  if (offColors.length) observed.colors = offColors.map(([h, n]) => `${h} ×${n}`);
  const type = [...(seen.get("type") ?? [])].sort((a, b) => b[1] - a[1]);
  if (type.length) observed.type = type.map(([k, n]) => `${k} ×${n}`);
  const radiusSeen = [...(seen.get("radius") ?? [])].filter(([k]) => !radii.includes(parseFloat(k)) && k !== "full").sort((a, b) => b[1] - a[1]);
  if (radiusSeen.length) observed.radii = radiusSeen.map(([k, n]) => `${k} ×${n}`);
  const never = Object.entries(colors).filter(([, h]) => !usedColor.has(h)).map(([k]) => k);
  const rules: Draft = { extends: "recommended@1" };
  if (Object.keys(colors).length) rules.colors = colors;
  if (radii.length) rules.radii = radii;
  if (Object.keys(shadows).length) rules.shadows = shadows;
  if (parts.size) rules.parts = [...parts].sort();
  if (Object.keys(observed).length) rules.observed = observed;
  report.push(`declared: ${Object.keys(colors).length} colors, ${radii.length} radii, ${Object.keys(shadows).length} shadows; seen: ${parts.size} parts`);
  if (aliases.length) report.push(`aliases (named by what they point to): ${aliases.slice(0, 20).join(", ")}${aliases.length > 20 ? ", …" : ""}`);
  if (never.length) report.push(`declared colors not seen on these pages: ${never.slice(0, 20).join(", ")}${never.length > 20 ? ", …" : ""}`);
  if (offColors.length) report.push(`colors on screen that no token declares (in observed; still OFF until moved into colors): ${offColors.length}`);
  if (type.length) report.push(`text styles on screen (in observed; add the ones you mean to "type"): ${type.length}`);
  if (near.length) report.push("one step from a more used value (likely mistakes, or keep them on purpose):", ...near.slice(0, 30).map((l) => `  ${l}`));
  return { rules, report };
}
