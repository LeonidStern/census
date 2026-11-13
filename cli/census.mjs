#!/usr/bin/env node
// census capture: open pages in Chromium, take each page's census, write it as text.
// census prompt: the reader prompt for an AI, with your design system's rules and the census in it.
// Run with no arguments for the usage.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const USAGE = `census capture [options] <url | name=url>...
  --rules <file>      the design system's values (JSON, see README): colors, type, radii, parts, shadows, ignore
  --out <dir>         where to write <name>.txt, all.txt (pages merged) and census.json (default: out)
  --size <WxH>        window size (default 1440x900)
  --wait <ms>         wait after load before reading (default 3000)
  --wait-for <css>    wait for this element first
  --storage <file>    a Playwright storage state, for pages behind a sign-in
  --hide <css>        hide these elements before reading (a dev overlay, a cookie banner)
  --tour              also open each pop-up once (a click on what has aria-haspopup or aria-expanded=false,
                      a hover on a few labeled buttons; never a submit) and add what it showed
  --closed            also say what pop-ups not opened yet will look like (React pages)

census prompt [options] <census.txt>...
  --docs <file>       your design system's rules in words (colors, type, corners, shadows, parts)
  --app <words>       what the app is ("a recipe site", "the checkout of a shop")
  Prints the reader prompt: send it to a model with no tools.`;

const args = process.argv.slice(2);
const cmd = args.shift();
const opt = {}, rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--tour" || a === "--closed") opt[a.slice(2)] = true;
  else if (a.startsWith("--")) opt[a.slice(2)] = args[++i];
  else rest.push(a);
}
if (cmd === "capture" && rest.length) await capture();
else if (cmd === "prompt" && rest.length) console.log(prompt());
else { console.log(USAGE); process.exit(cmd ? 1 : 0); }

async function capture() {
  let chromium;
  try { ({ chromium } = createRequire(join(process.cwd(), "x.js"))("playwright")); }
  catch { ({ chromium } = createRequire(import.meta.url)("playwright")); }
  const rules = opt.rules ? JSON.parse(readFileSync(opt.rules, "utf8")) : {};
  if (opt.closed) rules.closed = true;
  const [width, height] = (opt.size ?? "1440x900").split("x").map(Number);
  const out = opt.out ?? "out";
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height }, ...(opt.storage ? { storageState: opt.storage } : {}) });
  await ctx.addInitScript({ content: readFileSync(join(here, "../dist/census.js"), "utf8") });
  const page = await ctx.newPage();
  const pages = {};
  for (const [i, spec] of rest.entries()) {
    const m = spec.match(/^([\w-]+)=(.+)$/);
    const name = m ? m[1] : rest.length > 1 ? `page${i + 1}` : "page", url = m ? m[2] : spec;
    await page.goto(url, { timeout: 120000 });
    if (opt["wait-for"]) await page.waitForSelector(opt["wait-for"], { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(Number(opt.wait ?? 3000));
    if (opt.hide) await page.addStyleTag({ content: `${opt.hide}{display:none!important}` });
    await page.mouse.move(width - 10, height - 10);
    await page.waitForTimeout(500);
    const t = Date.now();
    const data = await page.evaluate((r) => window.census.data(r), rules);
    const ms = Date.now() - t;
    if (opt.tour) await tour(page, rules, data, width, height, url);
    pages[name] = data;
    writeFileSync(join(out, `${name}.txt`), (await page.evaluate((d) => window.census.lines(d), data)).join("\n") + "\n");
    console.log(`${name} ${url} read in ${ms} ms`);
  }
  if (rest.length > 1) writeFileSync(join(out, "all.txt"), (await page.evaluate((p) => window.census.lines(window.census.merge(p)), pages)).join("\n") + "\n");
  writeFileSync(join(out, "census.json"), JSON.stringify(pages));
  await browser.close();
}

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
      const el = page.locator(`[data-census-open="${m.i}"]`).first();
      if (!(await el.isVisible().catch(() => false))) continue;
      await page.evaluate((L) => document.querySelectorAll(L).forEach((e) => e.setAttribute("data-census-old", "")), LAYER);
      if (m.how === "click") await el.click({ timeout: 2000 }); else await el.hover({ timeout: 2000 });
      await page.waitForTimeout(m.how === "click" ? 500 : 900);
      const d = await page.evaluate(({ L, r }) => {
        const e = [...document.querySelectorAll(L)].find((x) => !x.hasAttribute("data-census-old") && x.checkVisibility());
        if (!e) return null;
        e.setAttribute("data-census-new", "");
        try { return window.census.data(r, "[data-census-new]"); } finally { e.removeAttribute("data-census-new"); }
      }, { L: LAYER, r: rules });
      await page.keyboard.press("Escape"); await page.mouse.move(width - 10, height - 10); await page.waitForTimeout(350);
      if (page.url() !== url) { await page.goto(url); await page.waitForTimeout(3000); }
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

function prompt() {
  const files = rest.map((f) => [f.replace(/^.*\//, "").replace(/\.txt$/, ""), readFileSync(f, "utf8").trim()]);
  const merged = files.length === 1 && /; pages: /.test(files[0][1].split("\n")[0]);
  const shape = merged ? "the pages merged into one census" : files.length > 1 ? "one census per page" : "one page";
  const data = files.map(([n, t]) => `<${n}>\n${t}\n</${n}>`).join("\n");
  const docs = opt.docs ? readFileSync(opt.docs, "utf8").trim() : "(none given: judge only consistency, not values)";
  return readFileSync(join(here, "../prompt/read.md"), "utf8")
    .replaceAll("{{APP}}", opt.app ?? "a web app")
    .replaceAll("{{SHAPE}}", shape)
    .replaceAll("{{DOCS}}", docs)
    .replaceAll("{{CENSUS}}", data)
    .trim();
}
