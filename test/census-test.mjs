// The census's pure parts in Node, then a real page in Chromium (when Playwright is installed).
// Usage: npm test (builds first).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const C = await import("../dist/census.mjs");
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };

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
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
