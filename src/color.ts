// Colors as the browser computes them, read as numbers: [r, g, b, a] in 0-255 and 0-1.
// Any CSS color works: rgb(), hex, and lab(), oklch(), display-p3 or names through the browser itself.

/** A CSS color as computed ("rgb(1, 2, 3)", "rgba(1, 2, 3, 0.5)", "color(srgb 0.1 0.2 0.3 / 0.5)") as [r, g, b, a] in 0-255 and 0-1; null when it can't be read. */
export function parseColor(css: string): [number, number, number, number] | null {
  let m = css.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4]];
  m = css.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
  if (m) return [+m[1] * 255, +m[2] * 255, +m[3] * 255, m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4]];
  m = css.match(/^#([0-9a-f]{3,8})$/i);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    const h = m[1].length <= 4 ? [...m[1]].map((x) => x + x).join("") : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  return painted(css);
}
/**
 * Any other CSS color (lab(), oklch(), color(display-p3 …), a named color):
 * the browser paints one pixel of it off screen and we read it back. Kept per
 * string. Without a document (a test in Node) there is nothing to paint on.
 */
const paints = new Map<string, [number, number, number, number] | null>();
let probeHost: Element | null = null, kept: HTMLElement | null = null;
/** A read that asks for many colors hands over its own hidden element: the probe stays in it (one append) until the read hands back null. */
export function colorProbe(host: Element | null): void { probeHost = host; kept = null; }
let paintCtx: CanvasRenderingContext2D | null | undefined;
function painted(css: string): [number, number, number, number] | null {
  if (!/^[a-z(]/i.test(css) || css.length > 240) return null;
  const had = paints.get(css);
  if (had !== undefined) return had;
  if (paintCtx === undefined) {
    try {
      const c = typeof document === "undefined" ? null : document.createElement("canvas");
      if (c) { c.width = c.height = 1; }
      paintCtx = c?.getContext("2d", { willReadFrequently: true }) ?? null;
    } catch { paintCtx = null; }
  }
  let out: [number, number, number, number] | null = null;
  // First ask CSS to say it in sRGB (color-mix gives "color(srgb r g b / a)" at full precision);
  // a painted pixel loses precision at low alpha (a 10% red reads back as another red).
  try {
    if (typeof document !== "undefined" && document.body) {
      const probe = kept ?? document.createElement("i");
      probe.style.color = "";
      probe.style.color = `color-mix(in srgb, ${css} 100%, transparent)`;
      if (probe.style.color) {
        if (!probeHost) { probe.style.display = "none"; document.body.append(probe); }
        else if (!kept) { probeHost.append(probe); kept = probe; }
        const said = getComputedStyle(probe).color;
        if (!probeHost) probe.remove();
        const m = said.match(/^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.e]+))?\s*\)$/);
        if (m) out = [Math.min(255, Math.max(0, +m[1] * 255)), Math.min(255, Math.max(0, +m[2] * 255)), Math.min(255, Math.max(0, +m[3] * 255)), m[4] === undefined ? 1 : +m[4]];
      }
    }
  } catch { out = null; }
  try {
    if (!out && paintCtx) {
      paintCtx.clearRect(0, 0, 1, 1);
      paintCtx.fillStyle = "#000";
      paintCtx.fillStyle = css;
      // an unknown color leaves fillStyle as it was, so it paints nothing new
      if (paintCtx.fillStyle !== "#000000" || /^(#0{3,8}|black|rgba?\(0[,\s]+0[,\s]+0\)?)/i.test(css)) {
        paintCtx.fillRect(0, 0, 1, 1);
        const d = paintCtx.getImageData(0, 0, 1, 1).data;
        out = [d[0], d[1], d[2], d[3] / 255];
      }
    }
  } catch { out = null; }
  if (paints.size < 200) paints.set(css, out);
  return out;
}
/** `top` drawn over `under` (opaque): what shows. */
export function over(top: [number, number, number, number], under: [number, number, number, number]): [number, number, number, number] {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}
const lum = (c: [number, number, number, number]) => {
  const ch = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
};
/** WCAG contrast ratio of two opaque colors, 1 (none) to 21. */
export function contrast(a: [number, number, number, number], b: [number, number, number, number]): number {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** A color as #rrggbb, or #rrggbbaa when see-through. */
