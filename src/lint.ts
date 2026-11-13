// The census as lint findings: each place that needs a fix, at the file and line where its part was used (a capture
// with --sources), one line a finding, the way a linter writes them. Pure: runs in Node or the page.
import { looksOf, type Census, type CensusLook, type CensusRow } from "./census";

export type LintRule = "off-system" | "near-value" | "set-where-used" | "two-looks" | "no-ds-part" | "layout";
export type LintFinding = { file?: string; line?: number; rule: LintRule; message: string; pages: string[] };

// " @ src/app/Footer.tsx:73" at the end of a place; an unmapped bundle frame ("@ {url:line:col …}") has no file
const AT = / @ ([^\s{}][^\s]*?):(\d+)$/;
const RULE_TEXT: Record<LintRule, string> = {
  "off-system": "a value off the design system",
  "near-value": "a value next to another one",
  "set-where-used": "the use site changes the part's look",
  "two-looks": "one part and variant in more than one look",
  "no-ds-part": "a control no design-system part drew",
  layout: "a layout problem",
};
export const lintRuleText = (r: LintRule) => RULE_TEXT[r];

/** The places of a census row that need a fix, each with what to say about it. */
function rowFindings(group: string, r: CensusRow): { rule: LintRule; message: string; at: string }[] {
  const what = `${r.key}${r.note ?? ""}`;
  if (group === "layout problems") return [{ rule: "layout", message: r.key, at: "" }];
  if (group === "set where used") return r.at.map((at) => ({ rule: "set-where-used", message: `set where used: ${r.key}`, at }));
  if (group === "parts" && r.looks) {
    const looks = r.looks, stray = / \(no DS part\)$/.test(r.key);
    const say = (l: CensusLook) => `${l.state ? `${l.state}: ` : ""}${l.say.replace("h=content", "h by content")}`;
    if (stray) return looks.flatMap((l) => l.at.map((at) => ({ rule: "no-ds-part" as LintRule, message: `${r.key}: ${say(l)}`, at })));
    if (looksOf(r) < 2) return [];
    // the odd ones out: a look less used than another of its state, or a shape (height, corner) less used than another
    const top = (ls: CensusLook[]) => ls.reduce((a, b) => (b.n > a.n ? b : a));
    const shapes = new Map<string, number>();
    for (const l of looks) shapes.set(l.shape, (shapes.get(l.shape) ?? 0) + l.n);
    const most = Math.max(...shapes.values());
    return looks.flatMap((l) => {
      const peers = looks.filter((o) => o.state === l.state && o.skin !== l.skin), usual = peers.length ? top(peers) : null;
      const oddSkin = usual && usual.n > l.n, oddShape = shapes.get(l.shape)! < most;
      // a tie: neither is the usual one, so both are said
      const tie = usual && usual.n === l.n;
      if (!oddSkin && !oddShape && !tie) return [];
      const other = oddSkin || tie ? usual! : top(looks.filter((o) => o.shape !== l.shape));
      return l.at.map((at) => ({ rule: "two-looks" as LintRule, message: `${r.key} in two looks: this one ${say(l)}; elsewhere ${say(other)}`, at }));
    });
  }
  if (group === "closed" || group === "left out" || group === "parts") return [];
  const off = / OFF\b/.test(what), near = / near /.test(what);
  if (!off && !near) return [];
  return r.at.map((at) => ({ rule: off ? "off-system" : "near-value", message: `${group} ${what.trim()}`, at }));
}

/**
 * Lint findings from the census of each page (census.json): one per file, line, rule and message, with the pages it
 * is on. Places with no file (no --sources, or an unmapped frame) keep the element's words in the message instead.
 */
export function lintFindings(pages: Record<string, Census>): LintFinding[] {
  const out = new Map<string, LintFinding>();
  for (const [page, c] of Object.entries(pages)) {
    for (const g of c.groups ?? []) for (const r of g.rows) for (const f of rowFindings(g.name, r)) {
      const m = f.at.match(AT);
      const file = m?.[1], line = m ? Number(m[2]) : undefined;
      const message = file || !f.at ? f.message : `${f.message} (at ${f.at.replace(/ @ .*$/, "")})`;
      // a place on another page may name its other look differently: "elsewhere" doesn't make it another finding
      const key = `${file}:${line}:${f.rule}:${message.replace(/; elsewhere .*$/, "")}`;
      const had = out.get(key);
      if (had) { if (!had.pages.includes(page)) had.pages.push(page); }
      else out.set(key, { file, line, rule: f.rule, message, pages: [page] });
    }
  }
  return [...out.values()].sort((a, b) => Number(!a.file) - Number(!b.file) || (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule));
}

/** The findings as text: "file:line: warning: message [census/rule] (pages)", or GitHub annotations ("::warning file=…"). */
export function lintLines(findings: LintFinding[], format: "text" | "github" = "text"): string[] {
  const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const prop = (s: string) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  return findings.map((f) => {
    const on = ` (${f.pages.join(", ")})`;
    if (format === "github") return `::warning ${f.file ? `file=${prop(f.file)},line=${f.line},` : ""}title=${prop(`census/${f.rule}`)}::${esc(`${f.message}${on}`)}`;
    return `${f.file ? `${f.file}:${f.line}: ` : ""}warning: ${f.message} [census/${f.rule}]${on}`;
  });
}
