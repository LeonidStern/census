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

// ---------- Findings: levels, lines, merge, diff ----------
{
  const s = C.checkSetting;
  check(s({}, "contrast").level === null && s({ extends: "recommended@1" }, "contrast").level === "accessibility" && s({}, "off").level === "rule"
    && JSON.stringify(s({ checks: { contrast: ["rule", 3.8] } }, "contrast")) === '{"level":"rule","n":3.8}' && s({ extends: "recommended@1", checks: { focus: "off" } }, "focus").level === null
    && JSON.stringify(s({ checks: { target: 28 } }, "target")) === '{"level":"accessibility","n":28}' && s({ extends: "recommended@2" }, "target").level === null,
  "checks: values off rules.json always, accessibility only when asked, a level and a number from rules.checks");
  const F = (id, level, key, more = {}) => ({ id, check: id.split("|")[0], level, key, n: 1, at: [`div 0,0 ${id.length}x1`], ...more });
  const page = (findings) => ({ head, groups: [], report: true, findings: findings.map((f) => ({ ...f, at: [...f.at] })) });
  const fs = [F("off|fill|#123456", "rule", "fill #123456 OFF"), F("off|text|#222222", "rule", "text #222222 OFF"),
    F("contrast|#777777 on #ffffff|", "accessibility", "contrast 4.48:1 muted on paper below 4.5"), F("contrast|#999999 on #ffffff|", "accessibility", "contrast 2.85:1 gray on paper below 4.5", { unsure: true }),
    F("target|IconButton|20x20", "accessibility", "target 20x20 under 24px", { n: 2, values: ['button "Bold"'] })];
  const lines = C.censusLines(page(fs));
  check(lines.join("\n") === `${head}\naccessibility (3, WCAG 2.2 AA; unsure: computed styles can't decide)\n  target 20x20 under 24px ×2: div 0,0 23x1\n  contrast 4.48:1 muted on paper below 4.5: div 0,0 28x1\n  contrast 2.85:1 gray on paper below 4.5 (unsure): div 0,0 28x1`,
    "findings as lines: accessibility only (values off the rules are said OFF in their groups), unsure last") || console.log(lines.join("\n"));
  const m = C.mergeCensus({ home: page(fs.slice(0, 3)), cart: page([{ ...fs[2], n: 2 }, fs[4]]) });
  const cm = m.findings.find((f) => f.id === "contrast|#777777 on #ffffff|");
  check(cm.n === 3 && cm.note === " (all)" && cm.at[0] === "[home] div 0,0 28x1" && cm.at[1] === "[cart] div 0,0 28x1" && m.findings.find((f) => f.id === "target|IconButton|20x20").note === " (cart)", "findings merged by id: counts added, a place from each page, the pages said");
  const d = C.diffFindings(page([fs[0], fs[2], fs[4]]), page([fs[1], { ...fs[4], values: ['button "Bold"', 'button "Pin"'] }]));
  check(d.lines.join("\n") === 'accessibility new (1)\n  target 20x20 under 24px (now also button "Pin") ×2: div 0,0 23x1\naccessibility fixed (1)\n  contrast 4.48:1 muted on paper below 4.5: div 0,0 28x1'
    && d.newRules.length === 1 && d.newRules[0].id === "off|text|#222222" && d.newAccessibility.length === 1, "diff of findings: accessibility new and fixed by id, a finding that now covers another element; new values off the rules returned for --fail-on") || console.log(d.lines.join("\n"));
}

// ---------- Max: best practice with no design system ----------
{
  const s = C.checkSetting;
  check(s({}, "max").level === "max" && s({ colors: { a: "#fff" } }, "max").level === null && s({ colors: { a: "#fff" }, extends: "best-practice@1" }, "max").level === "max"
    && s({ colors: { a: "#fff" }, max: { fill: 16 } }, "max").level === "max" && s({ checks: { max: "off" } }, "max").level === null
    && s({ extends: "best-practice@1" }, "contrast").level === null && s({ extends: ["recommended@1", "best-practice@1"] }, "contrast").level === "accessibility",
  "max: on with no values to check against, with its preset or its own numbers; its preset doesn't turn on the accessibility ones");
  // a group of n values, used less and less: the last is the rarest, and must not be named for it
  const group = (name, n, more) => ({ name, rows: Array.from({ length: n }, (_, i) => ({ key: `#${String(i).padStart(6, "0")}`, n: n - i, at: [`div ${i},0 1x1`] })), ...(more ? { more } : {}) });
  const one = C.maxFindings([group("radius", 7)], {});
  check(one.length === 1 && one[0].id === "max|radius" && one[0].level === "max" && one[0].n === 7
    && one[0].key === "radius 7 values, 4 the max: 3 over; none is a hair off another" && one[0].at.length === 0,
  "a group over its max: the count and the max, and no value named for being rare (a page's one h1 is rare on purpose)") || console.log(JSON.stringify(one));
  check(C.maxFindings([group("radius", 4)], {}).length === 0 && C.maxFindings([group("radius", 7)], { max: { radius: "off" } }).length === 0
    && C.maxFindings([group("radius", 7)], { max: { radius: 6 } })[0].key === "radius 7 values, 6 the max: 1 over; none is a hair off another"
    && C.maxFindings([group("radius", 2, 6)], {})[0].n === 8, "under the max says nothing; \"off\" turns a group off; a number of your own wins; trimmed rows still count");
  // a value a hair off another in use is named, rarest of those first, three at most
  const near = (name, keys) => ({ name, rows: keys.map(([key, n, note], i) => ({ key, n, note, at: [`div ${i},0 1x1`] })) });
  const fills = C.maxFindings([near("fill", [["surface-1", 9], ["surface-2", 8], ["#1e1e21", 1, " near surface-2 (from .panel, written out)"], ["#151516", 2, " near surface-1"],
    ["a", 7], ["b", 6], ["c", 5], ["d", 5], ["e", 4], ["f", 4], ["g", 3], ["h", 3], ["#1f1f23", 3, " near surface-2"], ["#161617", 4, " near surface-1"]])], {})[0];
  check(fills.key === "fill 14 values, 12 the max: 2 over; a hair off one in use:" && fills.at[0] === "#1e1e21 near surface-2 ×1: div 2,0 1x1" && fills.at[2] === "#1f1f23 near surface-2 ×3: div 12,0 1x1" && fills.at[3] === "... 1 more",
    "the values named are the ones a hair off another, rarest of them first, where they come from left out, three at most") || console.log(JSON.stringify(fills));
  // an icon's color isn't a text color the system has to list
  const text = near("text", [["#0b0c0c", 26], ["#1a65a6", 12], ["#ffffff", 11], ["#1d70b8", 1], ["#ffffff (icon)", 6], ["#00ffe0 (icon)", 3], ["#d2e2f1 (icon)", 3], ["#000000 (icon)", 3], ["#1d70b8 (icon)", 1]]);
  check(!C.maxFindings([text], {}).length, "icons aren't counted: 4 text colors and 5 icon colors are under a max of 6");
  // a type scale is sizes: line height and weight don't make a new one
  const scale = near("type", [["19/400/19", 9], ["19/400/25", 7], ["19/700/25", 2], ["24/700/30", 5], ["16/400/20.5", 4], ["16/700/normal", 3], ["16/400/23.2", 1], ["48/700/50", 2], ["64/700/68.5", 1], ["36/700/40", 1], ["13.3/400/normal", 1], ["tracking at 16px: +0.5 ×2, -0.2 ×1", 0]]);
  check(!C.maxFindings([scale], {}).length, "type counts sizes: 11 size/weight/line-height rows are 7 sizes, under a max of 8 (a letter-spacing note isn't one)");
  const sizes = C.maxFindings([near("type", [["16/400/24", 9], ["15/400/22", 2], ["12/400/16", 5], ["14/500/20", 4], ["20/600/28", 3], ["24/600/30", 2], ["32/700/40", 1], ["40/700/48", 1], ["48/700/56", 1]])], {})[0];
  check(sizes.key === "type 9 sizes, 8 the max: 1 over; a hair off one in use:" && sizes.at[0] === "15px near 16px ×2: div 1,0 1x1" && sizes.at.length === 1,
    "a size within 1px of one used more is named, by size") || console.log(JSON.stringify(sizes));
  check(C.maxFindings([group("fill", 16)], {})[0].at.length === 0 && C.maxFindings([group("states", 40)], {}).length === 0,
    "no value is named when none is a hair off another; a group with no max is left alone");
  const palette = C.maxFindings([], { colors: Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`c${i}`, "#000000"])), extends: "best-practice@1" });
  check(palette.length === 1 && palette[0].id === "max|rules.json|colors" && palette[0].key === "rules.json lists 23 colors, 22 the max",
    "the design system itself: a palette bigger than the groups it has to cover") || console.log(JSON.stringify(palette));
  const lines = C.censusLines({ head: "h", groups: [], report: true, findings: C.maxFindings([near("radius", [["6px", 9], ["8px", 4], ["4px", 2], ["12px", 2], ["7px", 1, " near 6px"]]), group("font", 3)], {}) });
  check(lines.join("\n") === "h\nmax (2 over, best practice)\n  radius 5 values, 4 the max: 1 over; a hair off one in use:\n    7px near 6px ×1: div 4,0 1x1\n  font 3 values, 2 the max: 1 over; none is a hair off another",
    "max findings as lines: a group a line, and under it the values a hair off another") || console.log(lines.join("\n"));
  // merged: the same value on two pages is one value, so the maxes are counted again off the merged groups
  const page = (keys) => ({ head: "h", groups: [{ name: "radius", rows: keys.map((k) => ({ key: k, n: 1, at: ["div 0,0 1x1"] })) }], findings: C.maxFindings([{ name: "radius", rows: keys.map((k) => ({ key: k, n: 1, at: [] })) }], {}) });
  const m = C.mergeCensus({ home: page(["1px", "2px", "3px", "4px", "5px"]), cart: page(["1px", "2px", "3px", "4px", "6px"]) }, {});
  const mf = (m.findings ?? []).filter((f) => f.level === "max");
  check(mf.length === 1 && mf[0].n === 6, "merged pages: a value on both is counted once, and the max is judged on that") || console.log(JSON.stringify(mf));
  check(!C.mergeCensus({ home: page(["1px"]), cart: page(["2px"]) }, {}).findings?.some((f) => f.level === "max"), "merged pages under the max say nothing");
  // a repo already over its max can still hold the line: only a group that grew fails
  const cen = (n) => ({ head: "h", groups: [], findings: C.maxFindings([group("radius", n)], {}) });
  const worse = C.diffFindings(cen(7), cen(9)), same = C.diffFindings(cen(7), cen(7)), better = C.diffFindings(cen(9), cen(7));
  check(worse.maxWorse.length === 1 && worse.lines.join("\n") === "max worse (1)\n  radius 9 values, 4 the max: 5 over; none is a hair off another (was 7)"
    && same.maxWorse.length === 0 && !same.lines.length && better.maxWorse.length === 0 && better.lines[0] === "max better (1)",
  "diff: a group with more values than before is worse, the same count is not, fewer is better") || console.log(worse.lines.join("\n"));
  check(C.diffFindings(cen(7), cen(4)).lines.join("\n") === "max better (1)\n  radius 7 values, 4 the max — now under", "a group back under its max is said once and drops out");
}

{
  // where a value comes from is left out of a diff's value lines, its own parentheses too
  const c = (key, note) => ({ head, groups: [{ name: "text", rows: [{ key, n: 1, note, at: ["p 16,30 100x20"] }] }] });
  const d = C.diffCensus(c("muted", undefined), c("#555555", " OFF (nearest muted, 59 away) (from .low, via var(--muted))")).join("\n");
  check(d.includes("  text #555555 OFF (nearest muted, 59 away) ×1: p 16,30 100x20"), "a diff's value line drops where it comes from, even a var() in it") || console.log(d);
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
  check(/^census diff: 2 changed, 1 new, 1 gone \(1 of them controls, marked !\), [1-9]\d* only moved/.test(d) && /button "Share" in header .*: height button 36px→40px/.test(d) && /header 0,0 \d+x\d+: layout row gap 8 pad 8→8 8 8 20/.test(d) && /new \(1\)\n  button "Delete".*fill #ff0000 OFF/.test(d)
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
  // the checks: accessibility with WCAG's exceptions
  {
    const p4 = await b.newPage({ viewport: { width: 1000, height: 500 } });
    await p4.goto(`file://${fileURLToPath(new URL("checks.html", import.meta.url))}`);
    const sys = { colors: { ink: "#111111", muted: "#777777", paper: "#ffffff", "gray-300": "#999999" } };
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
    check(!fs.some((x) => x.level !== "rule" && x.level !== "accessibility"), "no observations: only the team's rules and accessibility");
    const plainData = await pwCensus(p4, { rules: { colors: sys.colors } });
    check(!plainData.findings.some((x) => x.level !== "rule") && plainData.findings.some((x) => x.check === "off") && !/^(rules broken|accessibility|observations) \(/m.test(pwLines(plainData)) && !plainData.report,
      "without extends or checks: the findings are data only (for diff and --fail-on); the text is as it always was");
    const team = await pwCensus(p4, { rules: { ...sys, checks: { contrast: ["rule", 3.8] } } });
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
  {
    // layout: the gaps between children as drawn (from gap or from margins), padding, how children sit; text set to the end
    const t = await read(async (page) => {
      await page.evaluate(() => {
        document.body.innerHTML = '<nav id="tabs" style="display:flex;gap:4px;padding:8px 16px;align-items:center"><button class="btn">One</button><button class="btn">Two</button><button class="btn">Three</button></nav>'
          + '<div id="bar" style="display:flex;justify-content:space-between"><button class="btn" style="margin-right:12px">Left</button><button class="btn">Right</button></div>'
          + '<div id="rows" style="display:grid;grid-template-columns:1fr 120px;column-gap:16px"><span>BTC</span><span style="text-align:right">+1.2%</span></div>'
          + '<div id="card" style="background:#1d1d1d;padding:16px"><h2 style="margin:0">Card</h2></div>';
      });
    });
    const lay = t.split(/\n(?=\S)/).find((x) => x.startsWith("layout (")) ?? "", al = t.split(/\n(?=\S)/).find((x) => x.startsWith("align (")) ?? "";
    const ok = /row gap 4 pad 8 16 items center ×1: #tabs [^\n]* holding 3: button "One", button "Two", button "Three"/.test(lay) && /row gap \d+ \(margins and free space\) justify between ×1: #bar/.test(lay)
      && /grid 2 cols gap 0\/16 ×1: #rows/.test(lay) && /box pad 16 ×1: #card [^\n]* holding 1: h2 "Card"/.test(lay) && /text end ×1: span [^\n]*in #rows/.test(al) && /\n {2}every other text at the start of its box$/.test(al) && !/text center/.test(al);
    check(ok, `layout: gaps as drawn (and from margins), padding, alignment, grids and filled boxes; text set to the end, not a button's centred label${ok ? "" : `\n${lay}\n${al}`}`);
  }
  {
    // the rules file's own rules: roles, text colors, states, pairs, legacy parts and a contrast floor
    const colors = { "surface-0": "#000", "surface-1": "#131313", "surface-2": "#1d1d1d", "surface-3": "#282828", "white-100": "#fff", "white-30": "#ffffff4d", "white-5": "#ffffff0d", "red-700": "#3d1a1a", "red-300": "#f0a0a0", grey: "#666" };
    const page = async (page) => page.evaluate(() => {
      document.head.insertAdjacentHTML("beforeend", "<style>.wash:hover{background:#282828}.step:hover{background:#333}.gold{background:#e0b000}.gold:hover{background:#f0c010}</style>");
      document.body.innerHTML = '<main><button class="btn wash">Wash</button><button class="btn step">Step</button><button class="btn gold">Gold</button><p style="color:rgba(255,255,255,.3)">Quiet words</p>'
        + '<div style="background:#3d1a1a;padding:8px"><span style="color:#fff">Error</span></div><p style="color:#666">Grey words</p>'
        + '<legacy-tabs><button class="btn">Old tab</button></legacy-tabs></main>'
        + '<div role="dialog" style="position:fixed;left:300px;top:40px;width:200px;height:120px;background:#131313;border-radius:8px">Dialog</div>';
      class LegacyTabsComponent {}
      const made = new Map([...document.querySelectorAll("legacy-tabs")].map((h) => [h, new LegacyTabsComponent()]));
      window.ng = { getComponent: (el) => made.get(el) ?? null };
    });
    const rules = { colors, shadows: { popover: "0 8px 24px 0 rgba(0,0,0,0.5)" }, roles: { dialog: { fill: "surface-2", shadow: "popover", radius: 12 } },
      text: ["white-100", "red-300", "grey"], states: { hover: "wash white-5" }, pairs: { "red-700": ["red-300"] }, legacy: ["LegacyTabs"], contrast: 4.5 };
    const t = await read(page, rules), broken = t.split(/\n(?=\S)/).find((x) => x.startsWith("rules broken")) ?? "";
    const want = (re, what) => check(re.test(broken), `${what}${re.test(broken) ? "" : `\n${broken || t}`}`);
    want(/dialog fill surface-1: its role takes surface-2/, "rules: a dialog's fill against its role");
    want(/dialog shadow none: its role takes popover/, "rules: a dialog's shadow against its role");
    want(/dialog corner 8px: its role takes 12px/, "rules: a dialog's corner against its role");
    want(/text white-30 is not a text color/, "rules: text in a color text may not use");
    want(/text white-100 on red-700: that fill takes text red-300/, "rules: text on a fill that pairs with another text color");
    want(/hover fill #333333[^\n]* is not a white-5 wash over surface-2/, "rules: a hover that steps to another grey is not the wash");
    check(!/#282828[^\n]*is not/.test(broken), "rules: a hover that is the wash passes");
    check(!/Gold/.test(broken), "rules: a colored fill keeps its own hover (a wash is for neutral fills)");
    want(/legacy part LegacyTabs on screen/, "rules: a legacy part still on screen");
    check(/faint p .*contrast 3\.7:1/.test(t), `rules: the contrast floor comes from the rules file${/contrast 3\.7:1/.test(t) ? "" : `\n${t}`}`);
    const plain = await read(page, { colors });
    check(!/rules broken/.test(plain) && !/contrast 3\.7:1/.test(plain), "no rules of its own, no rules broken (and the default contrast floor)");
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
    const crules = `${dir}/checks-rules.json`;
    wf(crules, JSON.stringify({ colors: { ink: "#111111", muted: "#777777", paper: "#ffffff" } }));
    const page = `p=${new URL("checks.html", import.meta.url).href}`, base = [cli, "capture", "--rules", crules, "--wait", "200", "--once", "--extends", "recommended@1"];
    const exit = (args) => { try { execFileSync("node", args, { stdio: "pipe", timeout: 60000 }); return 0; } catch (e) { return e.status; } };
    const okRun = exit([...base, "--out", `${dir}/c1`, page]), failRun = exit([...base, "--fail-on", "accessibility", "--out", `${dir}/c2`, page]), badRun = exit([...base, "--fail-on", "everything", "--out", `${dir}/c3`, page]);
    const ct = readFileSync(`${dir}/c1/p.txt`, "utf8");
    check(okRun === 0 && failRun === 1 && badRun === 2 && /^accessibility \(\d+/m.test(ct) && /focus not visible \(2\.4\.7\)[^\n]*"No ring"/.test(ct) && !/^(observations|rules broken|accepted)/m.test(ct),
      `capture with --extends: the checks in the text; --fail-on exits 1 on findings, 2 on a bad level (${okRun}, ${failRun}, ${badRun})${/focus not visible/.test(ct) ? "" : `\n${ct.slice(-1500)}`}`);
    // a change: the muted text darker (a contrast fixed, a new value off the system) and a second small button by the first
    const html = readFileSync(new URL("checks.html", import.meta.url), "utf8").replace("--muted: #777777", "--muted: #555555").replace('aria-label="Close"></button>', 'aria-label="Close"></button><button class="alone" style="left:618px" aria-label="Pin"></button>');
    wf(`${dir}/after.html`, html);
    exit([...base, "--out", `${dir}/d2`, `p=file://${dir}/after.html`]);
    let dout = "", dexit = 0;
    try { dout = execFileSync("node", [cli, "diff", "--fail-on", "new-accessibility", `${dir}/c1/census.json`, `${dir}/d2/census.json`], { stdio: "pipe", timeout: 60000 }).toString(); } catch (e) { dexit = e.status; dout = e.stdout.toString(); }
    check(dexit === 1 && /accessibility new \(1\)\n {2}target 16x16 [^\n]*\(now also button "Close", button "Pin"\)/.test(dout) && /accessibility fixed \(1\)\n {2}contrast 4\.48:1 muted on paper/.test(dout) && /values new on the page[^\n]*\n {2}text #555555 OFF/.test(dout),
      "diff: findings new and fixed by id (a finding that now covers more elements says which), and --fail-on new-accessibility exits 1") || console.log(dout);
  }
}

// ---------- A page with a strict Content-Security-Policy ----------
{
  const { execFile } = await import("node:child_process");
  const { createServer } = await import("node:http");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { findChrome } = await import("../cli/cdp.mjs");
  const chrome = await findChrome().catch(() => null);
  if (!chrome) console.log("skip the CSP test: no Chrome found");
  else {
    // style-src 'self' refuses any <style> a script adds, and report-uri has the browser report each one
    let reports = 0;
    const css = ".btn{background:#111111;color:#ffffff;height:32px;border:0;transition:background-color 4s linear}.btn:hover{background:#ff0000}.banner{background:#00ff00;height:40px}";
    const html = '<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div class="banner"><button class="btn">Accept</button></div><button class="btn">Save</button></body></html>';
    const server = createServer((req, res) => {
      if (req.url === "/csp") { reports++; req.resume(); res.writeHead(204).end(); return; }
      if (req.url === "/app.css") { res.writeHead(200, { "content-type": "text/css" }).end(css); return; }
      res.writeHead(200, { "content-type": "text/html", "content-security-policy": "default-src 'self'; style-src 'self'; report-uri /csp" }).end(html);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}/`, dir = mkdtempSync(`${tmpdir()}/census-csp-`), cli = fileURLToPath(new URL("../cli/census.mjs", import.meta.url));
    // execFile, not execFileSync: the server answers on this process's event loop
    const out = await new Promise((ok, no) => execFile("node", [cli, "capture", "--out", dir, "--wait", "3000", "--hide", ".banner", `p=${url}`], { timeout: 60000 }, (e) => (e ? no(e) : ok(readFileSync(`${dir}/p.txt`, "utf8")))));
    await new Promise((r) => setTimeout(r, 300)); // a report the browser sends late
    server.close();
    const states = out.split(/\n(?=\S)/).find((x) => x.startsWith("states (")) ?? "";
    check(reports === 0, `CSP: a capture sends the site no violation reports (${reports} sent)`);
    check(/hover fill #ff0000/.test(states), `CSP: transitions are off while states are read, so hover reads its own color, not one partway there${/hover fill #ff0000/.test(states) ? "" : `\n${states || out}`}`);
    check(!/#00ff00|"Accept"/.test(out), "CSP: --hide hides");
  }
}

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
