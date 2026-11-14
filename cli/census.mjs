#!/usr/bin/env node
// census capture: open pages in Chrome (through the DevTools Protocol, no other dependency), take each page's census, write it as text.
// census diff: what changed between two captures.
// Run with no arguments for the usage.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser } from "./cdp.mjs";
import { mapSources } from "./sourcemap.mjs";
import { forceStates, mapPlaces, pageMapper } from "./read.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const USAGE = `census capture [options] <url | name=url>...
  --rules <file>      the design system's values (JSON, see README): colors, type, radii, parts, shadows, ignore
  --out <dir>         where to write <name>.txt, all.txt (pages merged) and census.json (default: out)
  --size <WxH>        window size (default 1440x900)
  --wait <ms>         the longest to wait for the page to settle after load: no request loading and its controls
                      holding still for 0.6 s (default 15000)
  --once              read each page once (by default it loads each page twice and keeps what differs between the two
                      reads in census.json: it changes on its own, and census diff leaves it out)
  --clock <time>      start the page's clock at this time on every load ("2026-01-01T12:00:00Z"), so a time on screen
                      reads the same in two captures
  --wait-for <css>    wait for this element first
  --connect <port>    use a Chrome that already runs with --remote-debugging-port=<port> (your own, signed in):
                      the capture opens a tab of its own and closes it after
  --chrome <path>     the Chrome to start (default: the installed Chrome or Chromium, or CENSUS_CHROME)
  --storage <file>    a Playwright storage state (cookies, localStorage), for pages behind a sign-in
  --states rules      read hover, pressed and focus colors from the page's CSS rules only, without forcing them
  --hide <css>        hide these elements before reading (a dev overlay, a cookie banner)
  --tour              also open each pop-up once (a click on what has aria-haspopup or aria-expanded=false,
                      a hover on a few labeled buttons; never a submit) and add what it showed
  --closed            also say what pop-ups not opened yet will look like (React pages)
  --sources           add where each part was used in the code ("@ src/ui/Header.tsx:42") to the places
                      that matter (set where used, values off the system, a part in two looks). Needs a dev
                      build; React 19's places are mapped through the page's source maps
  --root <dir>        the project folder, to write source paths relative to it (default: the current one)
  --extends <preset>  turn on the accessibility checks (recommended@1); rules.json can say it too
  --fail-on <levels>  exit 1 when a finding not accepted is at these levels: rules, accessibility (comma-separated;
                      unsure accessibility findings never fail). Without it a capture exits 0 whatever it finds

census diff [--live <before2/census.json>] <before/census.json> <after/census.json>
  What changed between two captures of the same pages, page by page: elements whose look changed (before→after),
  elements that came or went, new and lost values, parts with a new look, layout problems new and gone.
  Places that only moved are counted, not listed. --live: a second capture taken before the change; elements
  that differ between the two before captures change on their own (prices, charts) and are left out.
  Then findings: rule breaks and accessibility, new and fixed.
  --fail-on new-rules,new-accessibility: exit 1 when the after capture has findings at those levels that the
  before capture didn't (what CI wants: a PR is judged only on what it added)

census init [capture options] [--tokens <file>] [--out <file>] [--force] <url | name=url>...
census init --from <census.json> [--tokens <file>] [--out <file>] [--force]
  A first rules.json (default rules.draft.json) from the tokens the pages declare (custom properties on :root and
  theme scopes, or a tokens file: W3C design tokens or a flat map). What the screen shows that no token declares goes
  under "observed": still off the system until you move it into the scale. Prints what to review. Won't overwrite
  without --force.

Exit codes: 0 done, 1 findings at a --fail-on level, 2 usage or a capture that failed.
`;

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = {}, rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--tour" || a === "--closed" || a === "--sources" || a === "--once" || a === "--force") opt[a.slice(2)] = true;
  else if (a.startsWith("--")) opt[a.slice(2)] = args[++i];
  else rest.push(a);
}

async function capture() {
  const C = await import(join(here, "../dist/census.mjs"));
  const rules = opt.rules ? JSON.parse(readFileSync(opt.rules, "utf8")) : {};
  if (opt.extends) rules.extends = opt.extends;
  if (rules.extends && !C.PRESETS.includes(rules.extends)) throw new Usage(`unknown preset ${rules.extends} (known: ${C.PRESETS.join(", ")})`);
  for (const e of rules.accept ?? []) if (!e.why?.trim()) console.log(`accept entry without "why" left out: ${JSON.stringify(e)}`);
  if (opt.closed) rules.closed = true;
  if (opt.sources) rules.sources = true;
  rules.items = true; // census.json keeps each element's look, for census diff
  const [width, height] = (opt.size ?? "1440x900").split("x").map(Number);
  const out = opt.out ?? "out";
  mkdirSync(out, { recursive: true });
  const browser = await openBrowser({ connect: opt.connect, chrome: opt.chrome, width, height });
  const page = await browser.newPage();
  await page.init({ script: readFileSync(join(here, "../dist/census.js"), "utf8"), storage: opt.storage ? JSON.parse(readFileSync(opt.storage, "utf8")) : null, clock: opt.clock });
  // source maps come only from the captured pages' own origins (a page's stack frames could name any address)
  const origins = new Set(rest.map((x) => { try { return new URL(x.replace(/^[\w-]+=/, "")).origin; } catch { return ""; } }).filter((o) => /^https?:/.test(o)));
  const map = pageMapper(page, origins, opt.root ?? process.cwd());
  const say = async (lines) => { const t = lines.join("\n") + "\n"; return opt.sources ? mapSources(t, map) : t; };
  const pages = {}, unused = new Map();
  try {
    for (const [i, spec] of rest.entries()) {
      const m = spec.match(/^([\w-]+)=(.+)$/);
      const name = m ? m[1] : rest.length > 1 ? `page${i + 1}` : "page", url = m ? m[2] : spec;
      const t0 = Date.now();
      await page.goto(url);
      if (opt["wait-for"]) await page.waitFor(opt["wait-for"]);
      if (opt.hide) await page.addStyle(`${opt.hide}{display:none!important}`);
      await page.move(width - 10, height - 10);
      const settled = await page.settle(Number(opt.wait ?? 15000));
      const t = Date.now();
      const n = opt.states === "rules" ? 0 : await forceStates(page);
      const data = await page.evaluate((r) => window.census.data(r), rules);
      const ms = Date.now() - t;
      // a second read, of the page loaded again: what differs changes on its own (a price, a clock, data made up per
      // load), and census diff leaves it out
      if (!opt.once) {
        await page.goto(url);
        if (opt["wait-for"]) await page.waitFor(opt["wait-for"]);
        if (opt.hide) await page.addStyle(`${opt.hide}{display:none!important}`);
        await page.move(width - 10, height - 10);
        await page.settle(Number(opt.wait ?? 15000));
        // no forcing: this read only finds what changes on its own, and diff doesn't compare its states
        data.again = { items: (await page.evaluate((r) => window.census.data(r), rules)).items };
      }
      if (opt.tour) await tour(page, rules, data, width, height, url);
      pages[name] = data;
      // the team's accepted findings, with this page's name (an entry can be for one page)
      if (data.findings) unused.set(name, C.acceptFindings(data, rules.accept, name).unused);
      writeFileSync(join(out, `${name}.txt`), await say(C.censusLines(data)));
      const live = data.again ? (await import("../dist/census.mjs")).changesOnItsOwn(data.items, data.again.items).filter((x) => data.items.includes(x)).length : 0;
      console.log(`${name} ${url}: ${settled === null ? `didn't settle in ${opt.wait ?? 15000} ms (requests still loading or the page still moving)` : `loaded and settled in ${t - t0} ms`}; read in ${ms} ms (${n} controls hovered, pressed and focused)${data.again ? `; ${live} elements change on their own` : ""}`);
    }
    // an accept entry that matched nothing on any page it could apply to: said only where every such page was captured
    const names = Object.keys(pages), stale = (rules.accept ?? []).filter((e) => e.why?.trim() && (e.page ? names.includes(e.page) : names.length > 1)
      && [...unused].filter(([p]) => !e.page || p === e.page).every(([, list]) => list.includes(e)));
    const staleLines = stale.map((e) => `  stale accept: ${JSON.stringify(e)} matched nothing on ${e.page ?? "these pages"}`);
    if (staleLines.length) console.log(staleLines.join("\n"));
    if (rest.length > 1) writeFileSync(join(out, "all.txt"), await say([...C.censusLines(C.mergeCensus(pages)), ...staleLines].join("\n").split("\n")));
    else if (staleLines.length) writeFileSync(join(out, `${names[0]}.txt`), `${readFileSync(join(out, `${names[0]}.txt`), "utf8")}${staleLines.join("\n")}\n`);
    // census.json gets the same file:line places as the text, for census diff
    writeFileSync(join(out, "census.json"), JSON.stringify(opt.sources ? await mapPlaces(pages, map) : pages));
  } finally {
    await page.close();
    await browser.close();
  }
  if (opt["fail-on"]) {
    const levels = failLevels(opt["fail-on"], ["rules", "accessibility"]);
    const bad = Object.values(pages).flatMap((d) => d.findings ?? []).filter((f) => !f.accepted && ((f.level === "rule" && levels.has("rules")) || (f.level === "accessibility" && !f.unsure && levels.has("accessibility"))));
    if (bad.length) { console.log(`${bad.length} findings at --fail-on ${opt["fail-on"]}`); process.exitCode = 1; }
  }
  return pages;
}

class Usage extends Error {}
const failLevels = (v, known) => {
  const s = new Set(String(v).split(",").map((x) => x.trim()).filter(Boolean));
  for (const x of s) if (!known.includes(x)) throw new Usage(`--fail-on ${x}: expected ${known.join(", ")}`);
  return s;
};

const LAYER = "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip]";
// of a pop-up's own census: its layer, parts, states and use-site changes, and any value off the system
const KEEP = /^(layer|parts|states|set where used|field|layout problems)$/;

async function tour(page, rules, data, width, height, url) {
  const marks = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 3 && r.height > 3 && r.top >= 0 && r.bottom <= innerHeight && e.checkVisibility(); };
    const out = []; let i = 0, j = 0;
    for (const e of document.querySelectorAll("[aria-haspopup],[aria-expanded=false]")) {
      if (!vis(e) || e.disabled || e.getAttribute("aria-disabled") === "true" || e.type === "submit") continue;
      e.setAttribute("data-census-open", String(i)); out.push({ i, how: "click", name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30) });
      if (++i >= 40) break;
    }
    for (const e of document.querySelectorAll("button[aria-label],[aria-describedby]")) {
      if (!vis(e) || e.hasAttribute("data-census-open")) continue;
      e.setAttribute("data-census-open", String(i)); out.push({ i, how: "hover", name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30) }); i++;
      if (++j >= 6) break;
    }
    return out;
  });
  const rows = new Map();
  const base = new Set(data.groups.flatMap((g) => g.rows.map((r) => `${g.name}\n${r.key}${r.note ?? ""}`)));
  for (const m of marks) {
    try {
      const sel = `[data-census-open="${m.i}"]`;
      await page.evaluate((L) => document.querySelectorAll(L).forEach((e) => e.setAttribute("data-census-old", "")), LAYER);
      if (!(m.how === "click" ? await page.click(sel) : await page.hover(sel))) continue;
      await page.sleep(m.how === "click" ? 500 : 900);
      const d = await page.evaluate(({ L, r }) => {
        const e = [...document.querySelectorAll(L)].find((x) => !x.hasAttribute("data-census-old") && x.checkVisibility());
        if (!e) return null;
        e.setAttribute("data-census-new", "");
        try { return window.census.data(r, "[data-census-new]"); } finally { e.removeAttribute("data-census-new"); }
      }, { L: LAYER, r: rules });
      await page.escape(); await page.move(width - 10, height - 10); await page.sleep(350);
      if ((await page.url()) !== url) { await page.goto(url); await page.sleep(3000); }
      if (!d) continue;
      const by = `${m.how} ${JSON.stringify(m.name)}`;
      // each kind of layer once, what is inside merged by row; a value the page already shows isn't said again
      for (const g of d.groups) for (const r of g.rows) {
        if (base.has(`${g.name}\n${r.key}${r.note ?? ""}`) && !r.looks) continue;
        if (!KEEP.test(g.name) && !/ OFF| near /.test(`${r.key}${r.note ?? ""}`)) continue;
        const name = g.name === "layer" ? "layers opened" : `in layers: ${g.name}`, k = `${name}\n${r.key}${r.note ?? ""}`;
        const had = rows.get(k);
        if (!had) { rows.set(k, { g: name, row: { ...r, at: r.at.slice(0, 1).map((p) => `${p}, opened by ${by}`), looks: r.looks?.map((l) => ({ ...l })) } }); continue; }
        had.row.n += r.n;
        if (r.flag) had.row.flag = true;
        for (const l of r.looks ?? []) {
          const x = had.row.looks?.find((y) => y.state === l.state && y.say === l.say);
          if (!x) (had.row.looks ??= []).push({ ...l });
          else { x.n += l.n; x.lo = Math.min(x.lo ?? 1e9, l.lo ?? 1e9); x.hi = Math.max(x.hi ?? 0, l.hi ?? 0); }
        }
      }
    } catch (e) { console.log("skipped", m.name, String(e).slice(0, 80)); }
  }
  for (const { g, row } of [...rows.values()].sort((a, b) => (b.g === "layers opened") - (a.g === "layers opened"))) {
    let to = data.groups.find((x) => x.name === g);
    if (!to) data.groups.push((to = { name: g, what: g === "layers opened" ? "by the capture, one at a time: a click on each control that opens something, a hover on a few labeled buttons" : "", rows: [] }));
    to.rows.push(row);
  }
}

async function diff() {
  const { diffCensus, diffFindings } = await import(join(here, "../dist/census.mjs"));
  const levels = opt["fail-on"] ? failLevels(opt["fail-on"], ["new-rules", "new-accessibility"]) : new Set();
  let failing = 0;
  const [a, b] = rest.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const live = opt.live ? JSON.parse(readFileSync(opt.live, "utf8")) : null;
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const out = [];
  for (const n of names) {
    if (!a[n] || !b[n]) { out.push(`${n}: only in the ${a[n] ? "before" : "after"} capture`, ""); continue; }
    out.push(`<${n}>`, ...diffCensus(a[n], b[n], 40, live?.[n]), `</${n}>`, "");
    const d = diffFindings(a[n], b[n]);
    if (levels.has("new-rules")) failing += d.newRules.length;
    if (levels.has("new-accessibility")) failing += d.newAccessibility.filter((f) => !f.unsure).length;
  }
  console.log(out.join("\n").trim());
  if (failing) { console.log(`${failing} new findings at --fail-on ${opt["fail-on"]}`); process.exitCode = 1; }
}

async function init() {
  const { draftRules, flattenTokens } = await import(join(here, "../dist/census.mjs"));
  const file = opt.out ?? "rules.draft.json";
  if (existsSync(file) && !opt.force) throw new Usage(`${file} exists: pass --force to replace it`);
  let pages;
  if (opt.from) pages = JSON.parse(readFileSync(opt.from, "utf8"));
  else {
    // a capture of its own, once per page, into a folder of its own; the draft goes where --out says
    opt.out = mkdtempSync(join(tmpdir(), "census-init-"));
    opt.once = true;
    delete opt.rules;
    pages = await capture();
  }
  const extra = opt.tokens ? flattenTokens(JSON.parse(readFileSync(opt.tokens, "utf8"))) : [];
  const { rules, report } = draftRules(pages, extra);
  writeFileSync(file, `${JSON.stringify(rules, null, 2)}\n`);
  console.log([`wrote ${file}`, ...report].join("\n"));
}

// run last: the functions above use constants defined after them
try {
  if (cmd === "capture" && rest.length) await capture();
  else if (cmd === "diff" && rest.length === 2) await diff();
  else if (cmd === "init" && (rest.length || opt.from)) await init();
  else { console.log(USAGE); process.exit(cmd ? 2 : 0); }
} catch (e) {
  console.error(e instanceof Usage ? `census: ${e.message}` : e);
  process.exit(2);
}
