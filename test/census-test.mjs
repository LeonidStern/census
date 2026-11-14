// The census's pure parts in Node, then a real page in Chromium (when Playwright is installed).
// Usage: npm test (builds first).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const C = await import("../dist/census.mjs");
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; return ok; };

// ---------- Pure parts ----------
check(C.specificity("#nav a:hover") === 1001001 && C.specificity(".btn.primary:hover") === 3000 && C.specificity(":where(.a, #b) .c") === 1000 && C.specificity(":is(.a, #b) > li::before") === 1000002
  && C.specificity(".hover\\:bg-red:hover") === 2000 && C.specificity("button:not(.x, [disabled]):nth-child(2n+1)") === 2001, "specificity: ids, classes and types; :where() nothing, :is() its most specific branch");
const sh = C.shadowLayers("rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(255, 255, 255) 0px 0px 0px 2px, rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.8) 8px 16px 60px 0px inset");
check(JSON.stringify(sh) === '{"rings":["#ffffff 2px (ring)"],"rest":["0 4px 6px -1px #0000001a","8px 16px 60px 0 #000000cc inset"]}', `shadow layers: empty ones dropped, a ring apart: ${JSON.stringify(sh)}`);
check(C.shadowLayers("8px 16px 60px 0 rgba(0, 0, 0, 0.8)").rest[0] === "8px 16px 60px 0 #000000cc" && !C.shadowLayers("none").rest.length, "a shadow as a rule writes it (color last) reads like a computed one");
const ctl = (attrs, disabled = false) => ({ disabled, getAttribute: (k) => attrs[k] ?? null });
check(C.stateOf(ctl({})) === "" && C.stateOf(ctl({ "aria-selected": "true" })) === "selected" && C.stateOf(ctl({ "aria-pressed": "false", "aria-expanded": "true" })) === "open"
  && C.stateOf(ctl({ "aria-checked": "true" }, true)) === "disabled selected" && C.stateOf(ctl({ "data-state": "open", "aria-disabled": "true" })) === "disabled open", "a control's state from ARIA, data-state and disabled");
check(C.fontDiff("SF Pro Display, -apple-system, Inter, system-ui, sans-serif", "-apple-system, Inter, Ubuntu, sans-serif") === "the first stack plus SF Pro Display (in front), system-ui minus Ubuntu", "a font stack against the first");
check(C.fontDiff("Source Code Pro, Menlo, monospace", "Inter, system-ui, sans-serif") === "Source Code Pro, Menlo, monospace", "a stack with little in common is said whole");
const look = (state, shape, fill, n) => ({ state, shape, skin: `${shape} fill ${fill}`, say: `${shape} fill ${fill} text white-100`, n, at: ["button 1,2 3x4"] });
const head = "styles on screen, window 100x100";
const pageA = { head, groups: [{ name: "fill", rows: [{ key: "surface-1", n: 3, at: ["div 0,0 9x9"] }, { key: "#123456", n: 1, note: " OFF", at: ["span 1,1 2x2"] }] },
  { name: "parts", what: "by part", rows: [{ key: "Button size=xs", n: 3, at: [], flag: true, looks: [look("", "h34 r6", "surface-2", 2), look("selected", "h34 r6", "white-5", 1)] }] }] };
const pageB = { head, groups: [{ name: "fill", rows: [{ key: "surface-1", n: 2, at: ["div 0,0 9x9", "p 5,5 1x1"] }], more: 2 },
  { name: "parts", what: "by part", rows: [{ key: "Button size=xs", n: 1, at: [], flag: true, looks: [look("", "h32 r6", "surface-2", 1)] }] }] };
const one = C.censusLines(pageA);
check(one[1] === "fill (2 values)" && one[2] === "  surface-1 ×3: div 0,0 9x9" && one[3] === "  #123456 ×1 OFF: span 1,1 2x2" && one[4] === "parts (1, by part)"
  && one[5] === "  Button size=xs: h34 r6 fill surface-2 text white-100 ×2 (button 1,2 3x4) ; selected: h34 r6 fill white-5 text white-100 ×1 (button 1,2 3x4)", "a census as lines; a selected look is not a second look");
const both = C.censusLines(C.mergeCensus({ a: pageA, b: pageB }));
check(both[0] === `${head}; pages: a, b` && both[1] === "fill (4 values)" && both[2] === "  surface-1 ×5 (all): [a] div 0,0 9x9; [b] p 5,5 1x1" && both[3] === "  #123456 ×1 OFF (a): [a] span 1,1 2x2" && both[4] === "  ... 2 more",
  "pages merged: a value said once, with its pages and a place from each");
check(both[6] === "  Button size=xs IN 2 LOOKS (all): h34 r6 fill surface-2 text white-100 ×2 ([a] button 1,2 3x4) | h32 r6 fill surface-2 text white-100 ×1 ([b] button 1,2 3x4) ; selected: h34 r6 fill white-5 text white-100 ×1 ([a] button 1,2 3x4)",
  "merged, one part in two heights is two looks");
const white = C.parseColor("rgb(255, 255, 255)"), black = C.parseColor("rgba(0, 0, 0, 1)");
check(Math.round(C.contrast(white, black)) === 21 && JSON.stringify(C.parseColor("#ff000080")) === "[255,0,0,0.5019607843137255]" && JSON.stringify(C.parseColor("color(srgb 1 0 0 / 0.5)")) === "[255,0,0,0.5]", "colors read and compared");

// ---------- Findings: levels, accept, merge, diff, init ----------
{
  const s = C.checkSetting;
  check(s({}, "contrast").level === null && s({ extends: "recommended@1" }, "contrast").level === "accessibility" && s({}, "off").level === "rule"
    && JSON.stringify(s({ checks: { contrast: ["rule", 3.8] } }, "contrast")) === '{"level":"rule","n":3.8}' && s({ extends: "recommended@1", checks: { hover: "off" } }, "hover").level === null
    && JSON.stringify(s({ checks: { "small-text": 9 } }, "small-text")) === '{"level":"observation","n":9}' && s({ extends: "recommended@2" }, "near").level === null,
  "checks: the team's rules always on, the preset's only when asked, a level and a number from rules.checks");
  const F = (id, level, key, more = {}) => ({ id, check: id.split("|")[0], level, key, n: 1, at: [`div 0,0 ${id.length}x1`], ...more });
  const page = (findings) => ({ head, groups: [], report: true, findings: findings.map((f) => ({ ...f, at: [...f.at] })) });
  const fs = [F("off|fill|#123456", "rule", "fill #123456 OFF"), F("off|text|#222222", "rule", "text #222222 OFF"), F("legacy|Body", "rule", "legacy part Body on screen", { n: 3, part: "Body" }),
    F("contrast|#777777 on #ffffff|", "accessibility", "contrast 4.48:1 muted on paper below 4.5", { value: "muted on paper" }), F("contrast|#999999 on #ffffff|", "accessibility", "contrast 2.85:1 gray on paper below 4.5", { unsure: true }),
    F("once|type", "observation", "type seen on one element only: 9/400/12", { values: ["9/400/12"] }), F("small-text|9", "observation", "text 9px under 10px", { value: "9" })];
  const a = page(fs), lines = C.censusLines(a);
  check(lines.includes("rules broken (3)") && lines.includes("  off the system: fill 1, text 1 (said OFF in their groups)") && lines.includes("  legacy part Body on screen ×3: div 0,0 11x1")
    && lines.some((l) => l.startsWith("accessibility (2,")) && lines.indexOf("  contrast 2.85:1 gray on paper below 4.5 (unsure): div 0,0 28x1") > lines.indexOf("  contrast 4.48:1 muted on paper below 4.5: div 0,0 28x1")
    && lines.some((l) => l.startsWith("observations (2, evidence, not orders")), "findings as lines: a group a level, OFF summed, unsure last") || console.log(lines.join("\n"));
  const acc = [{ rule: "legacy", part: "Body", why: "moving it in Q1" }, { rule: "small-text", value: "9px", page: "book", why: "dense order book" }, { rule: "contrast", value: "muted on paper" }, { rule: "target", why: "none on screen" }];
  const res = C.acceptFindings(a, acc, "home", "2026-11-14");
  const al = C.censusLines(a);
  check(a.findings[2].accepted === "moving it in Q1" && !a.findings[6].accepted && !a.findings[3].accepted && res.noWhy.length === 1 && res.unused.length === 2
    && al.includes("rules broken (2)") && al.includes("  accepted ×1"), "accept: matched by rule and part, needs a why, a page entry only on its page, unused entries returned");
  C.acceptFindings(a, acc, "book", "2026-11-14");
  check(a.findings[6].accepted === "dense order book", "accept: a value matched normalized (9px is 9), on its own page");
  C.acceptFindings(a, [{ rule: "legacy", part: "Body", why: "x", max: 2 }, { rule: "small-text", why: "y", until: "2026-01-01" }], "book", "2026-11-14");
  check(!a.findings[2].accepted && a.findings[2].lapsed === "accepted up to 2, now 3" && a.findings[6].lapsed === "accept ran out 2026-01-01" && C.censusLines(a).includes("  legacy part Body on screen ×3 (accepted up to 2, now 3): div 0,0 11x1"), "accept lapses past max or after until, and says so");
  const m = C.mergeCensus({ home: page(fs.slice(2, 4)), cart: page([{ ...fs[2], n: 2 }, fs[5]]) });
  const legacyM = m.findings.find((f) => f.id === "legacy|Body");
  check(legacyM.n === 5 && legacyM.note === " (all)" && legacyM.at[0] === "[home] div 0,0 11x1" && legacyM.at[1] === "[cart] div 0,0 11x1" && m.findings.find((f) => f.id === "once|type").note === " (cart)", "findings merged by id: counts added, a place from each page, the pages said");
  const before = page([fs[2], fs[3], fs[5]]), after = page([fs[3], fs[1], { ...fs[5], values: ["9/400/12", "11/500/14"] }, F("adoption", "observation", "DS adoption: 81%", { value: "81%" })]);
  const d = C.diffFindings(before, after);
  check(d.lines.join("\n") === "rules broken new (1)\n  text #222222 OFF: div 0,0 16x1\nrules broken fixed (1)\n  legacy part Body on screen ×3: div 0,0 11x1\nobservations new (2)\n  type seen on one element only: 9/400/12 (now also 11/500/14): div 0,0 9x1\n  DS adoption: 81%: div 0,0 8x1"
    && d.newRules.length === 1 && !d.newAccessibility.length, "diff of findings: rules new and fixed by id, observations only new, a finding with new values in it") || console.log(d.lines.join("\n"));
  const tokens = [{ name: "--gray-900", raw: "#1d1d1d", value: "#1d1d1d", used: true, color: "#1d1d1d" }, { name: "--bg-raised", raw: "var(--gray-900)", value: "#1d1d1d", used: true, color: "#1d1d1d" },
    { name: "--white", raw: "#fff", value: "#fff", used: true, color: "#ffffff" }, { name: "--radius-md", raw: "0.5rem", value: "0.5rem", used: true }, { name: "--old", raw: "#f00", value: "#f00", used: false, color: "#ff0000" }];
  const shot = { head, tokens, groups: [{ name: "fill", rows: [{ key: "#1d1d1d", n: 9, at: [] }, { key: "#1e1e1e", n: 1, note: " near #1d1d1d", at: [] }] }, { name: "type", rows: [{ key: "14/400/20", n: 9, at: [] }] }, { name: "radius", rows: [{ key: "8px", n: 3, at: [] }, { key: "13px", n: 1, at: [] }] },
    { name: "parts", rows: [{ key: "Button size=sm", n: 3, at: [] }, { key: "button (no DS part)", n: 1, at: [] }] }] };
  const dr = C.draftRules({ home: shot }, C.flattenTokens({ color: { brand: { $value: "#7a4fd6" }, link: { $value: "{color.brand}" } } }));
  check(JSON.stringify(dr.rules) === '{"extends":"recommended@1","colors":{"gray-900":"#1d1d1d","white":"#ffffff","color-brand":"#7a4fd6"},"radii":[8],"parts":["Button"],"observed":{"colors":["#1e1e1e ×1"],"type":["14/400/20 ×9"],"radii":["13px ×1"]}}'
    && dr.report.some((l) => /aliases .*bg-raised → gray-900.*color-link → color-brand/.test(l)) && dr.report.some((l) => /not seen on these pages: white, color-brand/.test(l)) && dr.report.includes("  [home] fill #1e1e1e ×1 near #1d1d1d"),
  "init: tokens declared and used become the rules (primitives named, aliases listed); the rest of the screen goes under observed") || console.log(JSON.stringify(dr.rules), dr.report.join("\n"));
}

// ---------- Source maps ----------
{
  const { transform } = await import("esbuild"), { sourceMapper, mapSources } = await import("../cli/sourcemap.mjs");
  const src = "type N = number;\n\nconst a: N = 1;\n\nexport function f(): N {\n  return a + 1;\n}\n";
  const { code } = await transform(src, { loader: "ts", sourcemap: "inline", sourcefile: "src/f.ts", format: "esm" });
  const lines = code.split("\n"), L = lines.findIndex((l) => l.includes("return a")) + 1, C = lines[L - 1].indexOf("return") + 1;
  const map = sourceMapper(async (u) => (u === "http://x/f.js" ? code : null), "/app");
  check((await map(`http://x/f.js:${L}:${C}`)) === "src/f.ts:6", "a bundled place maps back to its file and line");
  const text = await mapSources(`  fill #123 OFF: div 1,1 2x2 @ {http://x/node.js:1:1 http://x/f.js:${L}:${C}}; div 3,3 1x1 @ {http://x/none.js:1:1}`, map);
  check(text === "  fill #123 OFF: div 1,1 2x2 @ src/f.ts:6; div 3,3 1x1", `frames: the first that maps into the app's files, none when nothing maps: ${text}`);
}

// ---------- A real page ----------
let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch { console.log("skip the page test: Playwright is not installed"); }
if (chromium) {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 800, height: 400 } });
  await page.addInitScript({ content: readFileSync(new URL("../dist/census.js", import.meta.url), "utf8") });
  await page.goto(`file://${fileURLToPath(new URL("fixture.html", import.meta.url))}`);
  const rules = { colors: { "surface-0": "#000", "surface-1": "#131313", "surface-2": "#1d1d1d", "surface-3": "#282828", "white-100": "#fff" }, type: ["14/400/18", "20/600/26"], radii: [4, 8, 12] };
  const text = (await page.evaluate((r) => window.census.lines(window.census.data(r)), rules)).join("\n");
  // a diff of two captures: the page before and after a change
  const p2 = await b.newPage({ viewport: { width: 800, height: 400 } });
  await p2.addInitScript({ content: readFileSync(new URL("../dist/census.js", import.meta.url), "utf8") });
  await p2.goto(`file://${fileURLToPath(new URL("fixture.html", import.meta.url))}`);
  const before = await p2.evaluate((r) => window.census.data({ ...r, items: true }), rules);
  await p2.evaluate(() => {
    document.querySelector(".tall").style.height = "40px";
    document.querySelector("[aria-pressed]").remove();
    const x = document.createElement("button"); x.className = "btn"; x.style.background = "#ff0000"; x.textContent = "Delete"; document.querySelector(".card").append(x);
    document.querySelector("header").style.paddingLeft = "20px";
  });
  const after = await p2.evaluate((r) => window.census.data({ ...r, items: true }), rules);
  const d = C.diffCensus(before, after).join("\n");
  check(/^census diff: 1 changed, 1 new, 1 gone \(1 of them controls, marked !\), [1-9]\d* only moved/.test(d) && /button "Share" in header .*: height button 36px→40px/.test(d) && /new \(1\)\n  button "Delete".*fill #ff0000 OFF/.test(d)
    && /gone \(1\)\n  ! button "Bold" \(selected\)/.test(d) && /values new on the page \(\d+\)\n  fill #ff0000 OFF/.test(d)
    && /moved \(\d+, in \d+ groups?\)\n(.*\n)*  in header, \d+ moved \d+px right/.test(d), "a diff: what changed, came and went (a control that went marked !); moves grouped by where and how far") || console.log(d);
  // a second read with a live value in it: census diff leaves out what changes on its own
  const again = await p2.evaluate((r) => { document.querySelector("p").textContent = "changed by itself"; return window.census.data({ ...r, items: true }); }, rules);
  const d2 = C.diffCensus({ ...before, again: { items: (await p2.evaluate((r) => { document.querySelector("p").textContent = "and again"; return window.census.data({ ...r, items: true }); }, rules)).items } }, again).join("\n");
  check(/; \d+ live \(they change on their own/.test(d2) && !/changed by itself|and again/.test(d2.split("values new")[0]), "a diff leaves out what differs between a capture and its own second read") || console.log(d2);
  // the Playwright helper: forced states through the page's own DevTools session, or the CSS rules
  const { census: pwCensus, lines: pwLines } = await import("../cli/playwright.mjs");
  const p3 = await b.newPage({ viewport: { width: 800, height: 400 } });
  await p3.goto(`file://${fileURLToPath(new URL("states.html", import.meta.url))}`);
  const forced = pwLines(await pwCensus(p3, { rules })), byRules = pwLines(await pwCensus(p3, { rules, states: "rules" }));
  check(/hover fill #333333[^\n]*button "Edit"/.test(forced) && !/#333333/.test(byRules) && !(await p3.evaluate(() => document.querySelector("[data-census-f],#census-still"))),
    "Playwright helper: forced states in your own page, rules-only on request, nothing left behind") || console.log(forced);
  // the checks: accessibility with WCAG's exceptions, observations, the team's system rules
  {
    const p4 = await b.newPage({ viewport: { width: 1000, height: 500 } });
    await p4.goto(`file://${fileURLToPath(new URL("checks.html", import.meta.url))}`);
    const sys = { colors: { ink: "#111111", muted: "#777777", paper: "#ffffff", "gray-300": "#999999" }, system: { textColors: ["ink"], legacyParts: ["Body"], pairs: [["paper", "ink"]] } };
    const data = await pwCensus(p4, { rules: { ...sys, extends: "recommended@1" } }), fs = data.findings, t = pwLines(data);
    const f = (re) => fs.filter((x) => re.test(x.key) || re.test(x.at.join("; ")));
    const showAll = `\n${t.split("\n").filter((l) => !/^ {2}/.test(l) || /^ {2}(contrast|target|focus|text|hover|legacy|fill|Btn|DS|type|height|off)/.test(l)).slice(-40).join("\n")}`;
    const show = "", failsBefore = fails;
    check(f(/^contrast 4\.48:1 muted on paper below 4\.5 \(WCAG 1\.4\.3\)$/).length === 1 && !f(/Large heading|Turned off/).some((x) => x.check === "contrast")
      && f(/^contrast 2\.85:1 gray-300 on paper/)[0]?.unsure === true && f(/^contrast 1\.92:1 placeholder #bbbbbb on paper/).length === 1,
    `contrast: compared unrounded (4.48 fails 4.5), large text at 3:1, turned-off controls exempt, a gradient behind is unsure, a field's hint counts${show}`);
    const tg = f(/^target /);
    check(tg.length === 1 && tg[0].n === 2 && /"Bold"/.test(tg[0].at[0]) && !fs.some((x) => x.check === "target" && /"Close"|terms|Turned off/.test(x.at.join(" "))),
      `target size: two small buttons side by side fail, a small one alone passes by spacing, an inline link and a turned-off control are exempt${show}`);
    check(f(/^focus not visible/).length === 1 && /"No ring"/.test(f(/^focus not visible/)[0].at[0]), `focus visible: forced focused, a control that changes nothing (outline: none) is a finding; a default ring is not${show}`);
    check(f(/^text 9px under 10px/).length === 1 && f(/^text 12px at weight 300/).length === 1 && f(/^hover in \[Chip\]: wash ×3, step ×1; the step ones$/).length === 1
      && f(/^Btn: 1 variant used, 2 heights drawn/).length === 1 && f(/^DS adoption: \d+% of controls drawn by DS parts/).length === 1,
    `observations: small and light text, one part's hover two ways, a part at more heights than variants, adoption${show}`);
    check(fs.find((x) => x.id === "legacy|Body")?.level === "rule" && f(/^text muted not a text color/).length === 1 && f(/^fill paper with text muted \(system\.pairs: ink\)$/).length === 1 && !f(/^fill paper with text #cccccc/).length,
      `system rules: a legacy part, a text color, a pair (a turned-off control exempt), each a rule broken${show}`);
    const plainData = await pwCensus(p4, { rules: { colors: sys.colors } });
    check(!plainData.findings.some((x) => x.level !== "rule") && plainData.findings.some((x) => x.check === "off") && !/^(rules broken|accessibility|observations) \(/m.test(pwLines(plainData)) && !plainData.report,
      "without extends, checks, system or accept: the findings are data only (for diff and --fail-on); the text is as it always was");
    const team = await pwCensus(p4, { rules: { ...sys, checks: { contrast: ["rule", 3.8], once: "off" } } });
    const tc = team.findings.filter((x) => x.check === "contrast");
    check(tc.length === 2 && tc.every((x) => x.level === "rule") && /below 3\.8 \(team floor; WCAG 1\.4\.3 asks 4\.5\)/.test(tc[0].key) && !team.findings.some((x) => x.check === "once"),
      "checks: contrast as a rule at the team's floor, which the line says isn't WCAG's");
    if (fails > failsBefore) console.log(showAll);
    await p4.close();
  }
  await b.close();
  const has = (re, what) => check(re.test(text), `${what}${re.test(text) ? "" : `\n${text}`}`);
  has(/^fill .*\n(.*\n)*\s+surface-2 ×\d/m, "fills by token name");
  has(/#1e1e1e ×1 near surface-2/, "a fill a hair off a token says near");
  has(/hover fill #333333 OFF/, "a hover color off the tokens says OFF");
  has(/13px.*OFF \(nearest 12px\)/, "a corner off the scale says OFF with the nearest");
  has(/^states/m, "hover colors from the page's CSS");
  has(/cut-text .*A very long label/, "cut text is a layout problem");
  has(/faint .*contrast/, "faint words are a layout problem");
}
// ---------- Other frameworks: Vue 3 and Svelte 5 dev builds, Angular's dev hook ----------
if (chromium) {
  const req = createRequire(import.meta.url);
  let vue = null, svelte = null;
  try { vue = req.resolve("vue/dist/vue.global.js"); } catch { console.log("skip Vue: not installed"); }
  try {
    const { build } = await import("esbuild"), { compile } = await import("svelte/compiler");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const r = await build({ entryPoints: [fileURLToPath(new URL("svelte/main.js", import.meta.url))], bundle: true, write: false, format: "iife", conditions: ["svelte", "browser", "development"], logLevel: "silent",
      plugins: [{ name: "svelte", setup(b) { b.onLoad({ filter: /\.svelte$/ }, (a) => ({ contents: compile(readFileSync(a.path, "utf8"), { filename: a.path.replace(root, ""), dev: true, generate: "client" }).js.code, loader: "js" })); } }] });
    svelte = r.outputFiles[0].text;
  } catch (e) { console.log(`skip Svelte: ${String(e).slice(0, 80)}`); }
  const b = await chromium.launch();
  const read = async (setup, rules = {}) => {
    const page = await b.newPage({ viewport: { width: 800, height: 400 } });
    await page.setContent("<!doctype html><html><head><style>body{margin:0;background:#000;color:#fff;font:14px/18px sans-serif}.btn{height:32px;border:0;border-radius:8px;background:#1d1d1d;color:#fff}.ghost{background:#282828}</style></head><body></body></html>");
    await page.addScriptTag({ content: readFileSync(new URL("../dist/census.js", import.meta.url), "utf8") });
    await setup(page);
    await page.waitForTimeout(100);
    const t = (await page.evaluate((r) => window.census.lines(window.census.data(r)), rules)).join("\n");
    await page.close();
    return t;
  };
  if (vue) {
    const t = await read(async (page) => {
      await page.addScriptTag({ path: vue });
      await page.evaluate(() => {
        const AppButton = { name: "AppButton", props: { variant: String }, template: '<button :class="[\'btn\', variant]"><slot/></button>' };
        window.Vue.createApp({ components: { AppButton }, template: '<header><AppButton variant="primary">Save</AppButton><AppButton variant="ghost">Share</AppButton></header>' }).mount(document.body);
      });
    });
    check(/\[AppButton variant=primary\]/.test(t) && /\[AppButton variant=ghost\]/.test(t), `Vue 3: a place names its component and variant${/AppButton/.test(t) ? "" : `\n${t}`}`);
  }
  if (svelte) {
    const t = await read(async (page) => { await page.addScriptTag({ content: svelte }); }, { sources: true, colors: { "surface-0": "#000", "surface-2": "#1d1d1d", white: "#fff" } });
    check(/button "Save" \[Button\]/.test(t), `Svelte 5: a place names its component (from the file that wrote it)${/\[Button\]/.test(t) ? "" : `\n${t}`}`);
    check(/#282828 ×1 OFF.*button "Share" \[Button\].* @ test\/svelte\/App\.svelte:7/.test(t), `Svelte 5 with sources: a value off the system says where its part was used${/App\.svelte:7/.test(t) ? "" : `\n${t}`}`);
  }
  {
    // Angular's dev mode answers ng.getComponent(host); this stands in for it
    const t = await read(async (page) => {
      await page.evaluate(() => {
        document.body.innerHTML = '<header><app-button><button class="btn">Save</button></app-button><app-button><button class="btn ghost">Share</button></app-button></header>';
        class AppButtonComponent { constructor(v) { this.variant = v; } }
        const hosts = [...document.querySelectorAll("app-button")], made = new Map(hosts.map((h, i) => [h, new AppButtonComponent(i ? "ghost" : "primary")]));
        window.ng = { getComponent: (el) => made.get(el) ?? null };
      });
    });
    check(/button "Save" \[AppButton variant=primary\]/.test(t) && /button "Share" \[AppButton variant=ghost\]/.test(t), `Angular: a host's component and its inputs${/AppButton/.test(t) ? "" : `\n${t}`}`);
  }
  await b.close();
}

// ---------- The capture command, through Chrome's DevTools Protocol ----------
{
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { findChrome } = await import("../cli/cdp.mjs");
  const chrome = await findChrome().catch(() => null);
  if (!chrome) console.log("skip the capture test: no Chrome found");
  else {
    const dir = mkdtempSync(`${tmpdir()}/census-test-`), cli = fileURLToPath(new URL("../cli/census.mjs", import.meta.url));
    const run = (out, page, ...more) => { execFileSync("node", [cli, "capture", "--rules", fileURLToPath(new URL("rules.json", import.meta.url)), "--out", `${dir}/${out}`, "--wait", "200", ...more, `p=${new URL(page, import.meta.url).href}`], { stdio: "pipe", timeout: 60000 }); return readFileSync(`${dir}/${out}/p.txt`, "utf8"); };
    const group = (t, g) => t.split(/\n(?=\S)/).find((x) => x.startsWith(`${g} (`)) ?? "";
    const forced = run("f", "fixture.html"), rules = run("r", "fixture.html", "--states", "rules");
    check(forced.length > 500 && group(forced, "states") === group(rules, "states"), `capture: forced hover, press and focus give the fixture's states as its rules do${group(forced, "states") === group(rules, "states") ? "" : `\n${group(forced, "states")}\n---\n${group(rules, "states")}`}`);
    const sf = group(run("sf", "states.html"), "states"), sr = group(run("sr", "states.html", "--states", "rules"), "states");
    const ok = /hover fill #333333[^\n]*button "Edit"/.test(sf) && !/#333333/.test(sr) && /hover fill surface-3[^\n]*"More"/.test(sf);
    check(ok, `capture: a hover a row passes down through a variable shows only when forced${ok ? "" : `\n${sf}`}`);
    // the checks through the CLI: --extends, --fail-on and its exit code, then census init from that capture
    const { writeFileSync: wf } = await import("node:fs");
    const crules = `${dir}/checks-rules.json`, accept = [{ rule: "light-text", why: "a thin label on purpose" }, { rule: "legacy", part: "Body", why: "x" }, { rule: "target", part: "Nothing", why: "gone" }];
    wf(crules, JSON.stringify({ colors: { ink: "#111111", muted: "#777777", paper: "#ffffff" }, system: { legacyParts: ["Body"] }, accept }));
    const page = `p=${new URL("checks.html", import.meta.url).href}`, base = [cli, "capture", "--rules", crules, "--wait", "200", "--once", "--extends", "recommended@1"];
    const exit = (args) => { try { execFileSync("node", args, { stdio: "pipe", timeout: 60000 }); return 0; } catch (e) { return e.status; } };
    const okRun = exit([...base, "--out", `${dir}/c1`, page]), failRun = exit([...base, "--fail-on", "accessibility", "--out", `${dir}/c2`, page]), badRun = exit([...base, "--fail-on", "everything", "--out", `${dir}/c3`, page]);
    const ct = readFileSync(`${dir}/c1/p.txt`, "utf8");
    check(okRun === 0 && failRun === 1 && badRun === 2 && /^accessibility \(\d+/m.test(ct) && /focus not visible \(2\.4\.7\)[^\n]*"No ring"/.test(ct) && (ct.match(/^ {2}accepted ×1$/gm) ?? []).length === 2 && !/text 12px at weight 300/.test(ct),
      `capture with --extends: the checks in the text, accepted ones counted; --fail-on exits 1 on findings, 2 on a bad level (${okRun}, ${failRun}, ${badRun})${/focus not visible/.test(ct) ? "" : `\n${ct.slice(-1500)}`}`);
    const draft = `${dir}/draft.json`, i1 = exit([cli, "init", "--from", `${dir}/c1/census.json`, "--out", draft]), i2 = exit([cli, "init", "--from", `${dir}/c1/census.json`, "--out", draft]);
    const dj = JSON.parse(readFileSync(draft, "utf8"));
    check(i1 === 0 && i2 === 2 && dj.extends === "recommended@1" && dj.colors.ink === "#111111" && dj.colors["gray-300"] === "#999999" && !dj.colors["unused-red"] && JSON.stringify(dj.radii) === "[8]" && dj.shadows["shadow-pop"] && dj.observed.type.length >= 4,
      "init: the page's declared and used tokens become the rules, the rest goes under observed; it won't overwrite without --force") || console.log(JSON.stringify(dj));
    // a change: the muted text darker (a contrast fixed, a new value off the system) and a second small button by the first
    const html = readFileSync(new URL("checks.html", import.meta.url), "utf8").replace("--muted: #777777", "--muted: #555555").replace('aria-label="Close"></button>', 'aria-label="Close"></button><button class="alone" style="left:618px" aria-label="Pin"></button>');
    wf(`${dir}/after.html`, html);
    exit([...base, "--out", `${dir}/d2`, `p=file://${dir}/after.html`]);
    let dout = "", dexit = 0;
    try { dout = execFileSync("node", [cli, "diff", "--fail-on", "new-accessibility", `${dir}/c1/census.json`, `${dir}/d2/census.json`], { stdio: "pipe", timeout: 60000 }).toString(); } catch (e) { dexit = e.status; dout = e.stdout.toString(); }
    check(dexit === 1 && /accessibility new \(1\)\n {2}target 16x16 [^\n]*\(now also button "Close", button "Pin"\)/.test(dout) && /accessibility fixed \(1\)\n {2}contrast 4\.48:1 muted on paper/.test(dout) && /rules broken new \(1\)\n {2}text #555555 OFF/.test(dout),
      "diff: findings new and fixed by id (a finding that now covers more elements says which), and --fail-on new-accessibility exits 1") || console.log(dout);
  }
}

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
