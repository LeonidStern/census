// Two censuses of one page, before and after a change, as the lines that differ: what a blind reader needs to tell a
// regression from an intended change. Elements are matched by their name, part and region (their words too when they
// stayed the same); one that only moved is counted, not listed. Pure: runs in Node or the page.
import type { Census, CensusItem } from "./census";

const BOX = /-?\d+,-?\d+ \d+x\d+/g;
const LOOK_ORDER = ["state", "height", "field", "radius", "fill", "line", "text", "type", "font", "shadow", "states", "set where used", "layer"];

/** "button 32px" → "button 36px" says "button 32px→36px": the words both share are said once. */
function change(a: string | undefined, b: string | undefined): string {
  if (a === undefined) return `+${b}`;
  if (b === undefined) return `-${a}`;
  const x = a.split(" "), y = b.split(" ");
  let i = 0;
  while (i < x.length - 1 && i < y.length - 1 && x[i] === y[i]) i++;
  return `${x.slice(0, i).join(" ")}${i ? " " : ""}${x.slice(i).join(" ")}→${y.slice(i).join(" ")}`;
}

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
 */
export function diffCensus(before: Census, after: Census, max = 40): string[] {
  const out: string[] = [];
  const a = before.items ?? [], b = after.items ?? [];
  const { pairs, gone, added } = pairUp(a, b);
  const changed: string[] = [];
  let moved = 0;
  for (const [x, y] of pairs) {
    const keys = LOOK_ORDER.filter((k) => x.look[k] !== y.look[k]);
    // a size change only for a control or words of their own (a box grows with what's in it), and not again after a height
    const sized = x.id === y.id && !!(y.look.height || y.look.text) && !keys.includes("height") && (Math.abs(x.box[2] - y.box[2]) > 2 || Math.abs(x.box[3] - y.box[3]) > 2);
    if (keys.length || sized) changed.push(`  ${y.at}: ${[...keys.map((k) => `${k} ${change(x.look[k], y.look[k])}`), ...(sized ? [`size ${x.box[2]}x${x.box[3]}→${y.box[2]}x${y.box[3]}`] : [])].join("; ")}`);
    else if (Math.abs(x.box[0] - y.box[0]) > 2 || Math.abs(x.box[1] - y.box[1]) > 2) moved++;
  }
  if (!before.items || !after.items) out.push("(a census without items: take both with the capture, or rules.items, to compare elements)");
  out.push(`census diff: ${changed.length} changed, ${added.length} new, ${gone.length} gone; ${moved} only moved (not listed)`);
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
