// Two censuses of one page, before and after a change, as the lines that differ: what a blind reader needs to tell a
// regression from an intended change. Elements are matched by their name, part and region (their words too when they
// stayed the same); one that only moved is counted, not listed. Pure: runs in Node or the page.
import type { Census, CensusItem } from "./census";

const BOX = /-?\d+,-?\d+ \d+x\d+/g;
const LOOK_ORDER = ["state", "height", "field", "radius", "fill", "line", "text", "type", "font", "shadow", "states", "set where used", "layer"];

/** "button 32px" → "button 36px" says "button 32px→36px": the words both share are said once. */
function one(a: string, b: string): string {
  const x = a.split(" "), y = b.split(" ");
  let i = 0;
  while (i < x.length - 1 && i < y.length - 1 && x[i] === y[i]) i++;
  return `${x.slice(0, i).join(" ")}${i ? " " : ""}${x.slice(i).join(" ")}→${y.slice(i).join(" ")}`;
}

/** A list ("hover fill a; pressed fill b") changes entry by entry: an entry whose words but the last match is said as one change, the rest as -gone and +new. */
function change(a: string | undefined, b: string | undefined): string {
  if (a === undefined) return `+${b}`;
  if (b === undefined) return `-${a}`;
  const x = a.split("; "), y = b.split("; ");
  if (x.length === 1 && y.length === 1) return one(a, b);
  const come = y.filter((v) => !x.includes(v)), out: string[] = [];
  const head = (v: string) => v.split(" ").slice(0, -1).join(" ");
  for (const g of x.filter((v) => !y.includes(v))) {
    const j = come.findIndex((c) => head(c) === head(g) && head(g) !== "");
    if (j < 0) { out.push(`-${g}`); continue; }
    out.push(one(g, come[j]));
    come.splice(j, 1);
  }
  return [...out, ...come.map((c) => `+${c}`)].join(", ");
}

/** The element's own words, as its place quotes them. */
const words = (x: CensusItem) => x.at.match(/^[^"[]*"((?:[^"\\]|\\.)*)"/)?.[1];

function pairUp(a: CensusItem[], b: CensusItem[]) {
  const pairs: [CensusItem, CensusItem][] = [];
  let left = [...a], right = [...b];
  for (const key of ["id", "loose"] as const) {
    const byKey = new Map<string, CensusItem[]>();
    for (const x of right) byKey.set(x[key], [...(byKey.get(x[key]) ?? []), x]);
    const rest: CensusItem[] = [];
    for (const x of left) {
      const list = byKey.get(x[key]);
      if (!list?.length) { rest.push(x); continue; }
      // of the candidates, the nearest one
      let best = 0, d = Infinity;
      list.forEach((y, i) => { const e = Math.abs(y.box[0] - x.box[0]) + Math.abs(y.box[1] - x.box[1]); if (e < d) { d = e; best = i; } });
      pairs.push([x, list.splice(best, 1)[0]]);
    }
    left = rest;
    right = [...byKey.values()].flat();
  }
  return { pairs, gone: left, added: right };
}

const lookText = (x: CensusItem) => LOOK_ORDER.filter((k) => x.look[k]).map((k) => `${k} ${x.look[k]}`).join("; ");
const cap = (lines: string[], n: number) => (lines.length > n ? [...lines.slice(0, n), `  ... ${lines.length - n} more`] : lines);

/**
 * What changed between two censuses taken with rules.items. Sections: elements whose look changed (each property
 * before→after), elements that came or went, values the page shows now or no longer (with OFF and near), parts with
 * a new or lost look, and layout problems that appeared or were fixed. Places that only moved are counted.
 * `live`: a second capture taken before the change; what differs between it and `before` changes on its own
 * (live data) and is left out of the element lists.
 */
export function diffCensus(before: Census, after: Census, max = 40, live?: Census): string[] {
  const out: string[] = [];
  const a = before.items ?? [], b = after.items ?? [];
  const all = pairUp(a, b);
  const differs = ([x, y]: [CensusItem, CensusItem]) => words(x) !== words(y) || LOOK_ORDER.some((k) => x.look[k] !== y.look[k]) || Math.abs(x.box[2] - y.box[2]) > 2 || Math.abs(x.box[3] - y.box[3]) > 2;
  // live: what differs between two captures with no change in between (prices, depth bars, clocks) is left out
  const hot: CensusItem[] = [];
  if (live?.items) {
    const q = pairUp(a, live.items);
    hot.push(...q.gone, ...q.added, ...q.pairs.filter(differs).flatMap(([x, y]) => [x, y]));
  }
  const isHot = (x: CensusItem) => hot.some((h) => h.loose === x.loose && Math.abs(h.box[1] - x.box[1]) <= 4 && h.box[0] < x.box[0] + x.box[2] + 4 && x.box[0] < h.box[0] + h.box[2] + 4);
  let skipped = 0;
  const keep = (x: CensusItem) => (hot.length && isHot(x) ? (skipped++, false) : true);
  const pairs = all.pairs.filter((p) => !differs(p) || keep(p[1]));
  const gone = all.gone.filter(keep), added = all.added.filter(keep);
  const changed: string[] = [];
  let moved = 0;
  for (const [x, y] of pairs) {
    const keys = LOOK_ORDER.filter((k) => x.look[k] !== y.look[k]);
    // a size change only for a control or words of their own (a box grows with what's in it), and not again after a height
    const sized = x.id === y.id && !!(y.look.height || y.look.text) && !keys.includes("height") && (Math.abs(x.box[2] - y.box[2]) > 2 || Math.abs(x.box[3] - y.box[3]) > 2);
    const said = words(x) !== words(y) ? [`words "${words(x) ?? ""}"→"${words(y) ?? ""}"`] : [];
    if (said.length || keys.length || sized) changed.push(`  ${y.at}: ${[...said, ...keys.map((k) => `${k} ${change(x.look[k], y.look[k])}`), ...(sized ? [`size ${x.box[2]}x${x.box[3]}→${y.box[2]}x${y.box[3]}`] : [])].join("; ")}`);
    else if (Math.abs(x.box[0] - y.box[0]) > 2 || Math.abs(x.box[1] - y.box[1]) > 2) moved++;
  }
  if (!before.items || !after.items) out.push("(a census without items: take both with the capture, or rules.items, to compare elements)");
  out.push(`census diff: ${changed.length} changed, ${added.length} new, ${gone.length} gone; ${moved} only moved (not listed)${live ? `; ${skipped} live (they change on their own, not listed)` : ""}`);
  if (changed.length) out.push(`changed (${changed.length})`, ...cap(changed, max));
  if (added.length) out.push(`new (${added.length})`, ...cap(added.map((y) => `  ${y.at}: ${lookText(y)}`), max));
  if (gone.length) out.push(`gone (${gone.length})`, ...cap(gone.map((x) => `  ${x.at}: ${lookText(x)}`), max));

  // values: a value on screen now that wasn't (an OFF one first), and one no longer on screen
  const rows = (c: Census) => {
    const m = new Map<string, string>();
    for (const g of c.groups) {
      if (g.name === "parts" || g.name === "layout problems" || g.name === "left out") continue;
      for (const r of g.rows) m.set(`${g.name} ${r.key}`, `${g.name} ${r.key}${r.note ? r.note.replace(/ \((from|via) [^)]*\)/g, "") : ""} ×${r.n}${r.at[0] ? `: ${r.at[0]}` : ""}`);
    }
    return m;
  };
  const ra = rows(before), rb = rows(after);
  const nv = [...rb].filter(([k]) => !ra.has(k)).map(([, v]) => v).sort((p, q) => Number(/ OFF/.test(q)) - Number(/ OFF/.test(p)));
  const gv = [...ra].filter(([k]) => !rb.has(k)).map(([, v]) => v);
  if (nv.length) out.push(`values new on the page (${nv.length})`, ...cap(nv.map((v) => `  ${v}`), max));
  if (gv.length) out.push(`values no longer on the page (${gv.length})`, ...cap(gv.map((v) => `  ${v}`), max));

  // parts: a look a part didn't have, or lost
  const looks = (c: Census) => {
    const m = new Map<string, Set<string>>();
    for (const r of c.groups.find((g) => g.name === "parts")?.rows ?? []) m.set(r.key, new Set((r.looks ?? []).map((l) => `${l.state ? `${l.state}: ` : ""}${l.say}`)));
    return m;
  };
  const la = looks(before), lb = looks(after), pl: string[] = [];
  for (const [k, s] of lb) { const was = la.get(k); for (const l of s) if (was && !was.has(l)) pl.push(`  ${k}: new look ${l}`); }
  for (const [k, s] of la) { const now = lb.get(k); for (const l of s) if (now && !now.has(l)) pl.push(`  ${k}: lost look ${l}`); }
  if (pl.length) out.push(`parts (${pl.length})`, ...cap(pl, max));

  // layout problems, compared without their boxes
  const probs = (c: Census) => new Map((c.groups.find((g) => g.name === "layout problems")?.rows ?? []).map((r) => [r.key.replace(BOX, "#"), r.key]));
  const pa = probs(before), pb = probs(after);
  const np = [...pb].filter(([k]) => !pa.has(k)).map(([, v]) => `  ${v}`), fp = [...pa].filter(([k]) => !pb.has(k)).map(([, v]) => `  ${v}`);
  if (np.length) out.push(`layout problems new (${np.length})`, ...cap(np, max));
  if (fp.length) out.push(`layout problems gone (${fp.length})`, ...cap(fp, max));
  return out;
}
