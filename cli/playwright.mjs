// The census inside your own Playwright tests: after your sign-in, setup and steps, read the page you are on.
//
//   import { census, lines, save } from "census/playwright";
//   const home = await census(page, { rules, sources: true });
//   console.log(lines(home));
//   save("census-out", { home });   // home.txt and census.json, for census diff
//
// Playwright isn't a dependency: you pass your own page. Forced hover, pressed and focus colors need Chromium (they
// go through Chrome's DevTools Protocol); in Firefox and WebKit the census reads them from the CSS rules.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { forceStates, inspectorStyle, mapPlaces, pageMapper } from "./read.mjs";
import { censusLines, mergeCensus } from "../dist/census.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let script;

/**
 * The census of the page as it is now (a Census: groups and, for census diff, each element's look).
 * - rules: your design system's values (rules.json's shape)
 * - states: "force" (default; Chromium only, else "rules") or "rules"
 * - sources: true adds "@ file:line" where each part that needs a fix was used (a dev build), mapped through the
 *   page's source maps; root: the project folder, to write the paths relative to it (default: the current one)
 * - hide: a selector of elements to hide first (a dev overlay, a cookie banner)
 * - selector: read only this element and what is inside it
 */
export async function census(page, { rules = {}, states = "force", sources = false, root, hide, selector } = {}) {
  script ??= readFileSync(join(here, "../dist/census.js"), "utf8");
  // an evaluate runs in the page's own world, past its Content-Security-Policy's script-src, and changes nothing but
  // window.census. A <style> it adds is still checked against style-src, so styles go in through DevTools (below).
  if (!(await page.evaluate(() => !!window.census))) await page.evaluate(script);
  const cdp = states === "force" || hide ? await page.context().newCDPSession(page).catch(() => null) : null;
  if (cdp) { await cdp.send("DOM.enable"); await cdp.send("CSS.enable"); }
  const send = (m, p) => cdp.send(m, p);
  let unhide = null;
  if (hide && cdp) unhide = await inspectorStyle(send, `${hide}{display:none!important}`);
  // Firefox and WebKit have no DevTools session: a <style> element, which a strict style-src will refuse
  else if (hide) await page.evaluate((h) => { const s = document.createElement("style"); s.id = "census-hide"; s.textContent = `${h}{display:none!important}`; document.head.append(s); }, hide);
  try {
    if (cdp && states === "force") {
      let doc;
      await forceStates({
        evaluate: (fn, arg) => page.evaluate(fn, arg),
        async nodes(sel) { doc ??= (await cdp.send("DOM.getDocument", { depth: 0 })).root.nodeId; return (await cdp.send("DOM.querySelectorAll", { nodeId: doc, selector: sel })).nodeIds; },
        force: (ids, classes) => Promise.all(ids.map((nodeId) => cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: classes }))),
        style: (css) => inspectorStyle(send, css),
      });
    }
    const data = await page.evaluate(([r, sel]) => window.census.data(r, sel), [{ ...rules, sources, items: true }, selector]);
    if (!sources) return data;
    const origin = new URL(page.url()).origin;
    return mapPlaces(data, pageMapper(page, new Set(/^https?:/.test(origin) ? [origin] : []), root ?? process.cwd()));
  } finally {
    if (unhide) await unhide();
    else if (hide) await page.evaluate(() => document.getElementById("census-hide")?.remove()).catch(() => {});
    await cdp?.detach().catch(() => {});
  }
}

/** A census as text, the way the CLI writes it. */
export const lines = (data) => censusLines(data).join("\n");

/** Writes <name>.txt for each page, all.txt (the pages merged) when there are several, and census.json, as the CLI does. */
export function save(dir, pages) {
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(pages)) writeFileSync(join(dir, `${name}.txt`), `${lines(data)}\n`);
  if (Object.keys(pages).length > 1) writeFileSync(join(dir, "all.txt"), `${lines(mergeCensus(pages))}\n`);
  writeFileSync(join(dir, "census.json"), JSON.stringify(pages));
}
