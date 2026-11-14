// What a capture does in a page, for any driver: the CLI's own DevTools client and the Playwright helper. A `page`
// here has evaluate(fn, arg), and for forced states nodes(selector) → protocol node ids, force(nodeIds, classes) and
// style(css) → a function that takes the style off again.
import { mapSources, sourceMapper } from "./sourcemap.mjs";

const STILL = "*,*::before,*::after{transition:none!important;animation-play-state:paused!important}";

// Chrome forces each state on each control in view (hover and press on everything above it too, as a real pointer
// would), with transitions off, and the census reads the control's colors in that state. Controls alike are forced
// once (census.forceMark). Each step replaces the last forcing, so a control takes 4 reads and 3 forcings. Returns how
// many controls were forced.
//
// Transitions go off through the driver's style(), an inspector stylesheet. A <style> element would be checked against
// the page's Content-Security-Policy: a strict style-src blocks it, so transitions keep running while states are read,
// and the browser reports the violation to the site's own security address on every capture.
export async function forceStates(page) {
  const unstill = await page.style(STILL);
  const step = (i, read, next) => page.evaluate(([j, r, n]) => window.census.forceRead(j, r, n), [i, read, next]);
  try {
    const n = await page.evaluate(() => window.census.forceMark());
    for (let i = 0; i < n; i++) {
      const [el] = await page.nodes(`[data-census-f="${i}"]`);
      if (!el) continue;
      const up = await page.nodes(`[data-census-up~="${i}"]`);
      await step(i, null, "hover");
      await page.force([el, ...up], ["hover"]);
      await step(i, "hover", "pressed");
      await page.force([el, ...up], ["hover", "active"]);
      await step(i, "pressed", "focus");
      await page.force(up, []);
      await page.force([el], ["focus", "focus-visible"]);
      await step(i, "focus", null);
      await page.force([el], []);
    }
    return n;
  } finally {
    await page.evaluate(() => window.census.forceDone());
    await unstill();
  }
}

/** An inspector stylesheet through a DevTools session: what style(css) is, for a driver that has the session. */
export async function inspectorStyle(send, css) {
  const { frameTree } = await send("Page.getFrameTree");
  const frameId = frameTree.frame.id;
  const { styleSheetId } = await send("CSS.createStyleSheet", { frameId, force: true }).catch(() => send("CSS.createStyleSheet", { frameId }));
  await send("CSS.setStyleSheetText", { styleSheetId, text: css });
  return () => send("CSS.setStyleSheetText", { styleSheetId, text: "" }).catch(() => {});
}

/**
 * A source mapper that fetches maps through the page (its cookies, its cache), only from `origins` (a page's stack
 * frames could name any address), with no redirects and at most 64 MB a file.
 */
export function pageMapper(page, origins, root = process.cwd()) {
  return sourceMapper(async (u) => {
    let url;
    try { url = new URL(u); } catch { return null; }
    if (!origins.has(url.origin)) return null;
    return page.evaluate(async (h) => {
      try {
        const r = await fetch(h, { redirect: "error", credentials: "same-origin" });
        if (!r.ok || Number(r.headers.get("content-length") ?? 0) > 64e6) return null;
        const t = await r.text();
        return t.length > 64e6 ? null : t;
      } catch { return null; }
    }, url.href).catch(() => null);
  }, root);
}

/** Every " @ {bundle frames}" place in a census (or a map of them) mapped to its file and line. */
export async function mapPlaces(v, map) {
  return typeof v === "string" ? (v.includes(" @ ") ? mapSources(v, map) : v)
    : Array.isArray(v) ? Promise.all(v.map((x) => mapPlaces(x, map)))
    : v && typeof v === "object" ? Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await mapPlaces(x, map)]))) : v;
}
