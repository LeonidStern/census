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
  }
}

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
