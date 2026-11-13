// The census: every style value on screen, counted, named by the design system's own words, with a few places each.
// It reads the live page from inside: computed styles, element boxes, the page's CSS rules (for hover, pressed and
// focus colors), ARIA states and the component tree of a dev build (React, Vue, Svelte, Angular: which part drew each
// place, and with `sources`, where in the code it was used). No pixels.
//
// styleData(rules) -> Census (data), censusLines(census) -> text for a reader, mergeCensus({page: census}) -> one census.
// layoutLines() -> the screen as a wireframe with what looks wrong (cut text, overlaps, faint words, covered controls).
//
// Privacy: words come only from the app's own controls (buttons, menu items, headings), never from what people wrote;
// mark anything else with data-census-private. Mark a control that is dim on purpose with data-census-dim.

import { colorProbe, contrast, over, parseColor } from "./color";

const POPUP = "[role=menu],[role=listbox],[role=dialog],[role=alertdialog]";
const PRESSABLE = "button,a[href],[role=button],[role=tab],[role=option],[role=menuitem],[role=switch],[role=checkbox],[role=radio],[role=treeitem],[role=row],[data-item],[data-section]";
/** An element's own id, unless a library made it up (React's useId, React Aria, Radix, Base UI, Headless UI, MUI): those change between renders and name nothing. */
const MADE = /^(react-aria|_r_|:r|«r|radix-|base-ui-|headlessui-|mui-)/;
export const ownId = (el: Element) => (el.id && !MADE.test(el.id) ? el.id : "");
const PROBLEM = /^(outside|cut-text|overlap|wrapped|no-edge|faint|faded|squeezed|covered|faint-drawn|hidden-drawn) /;
const REGION = "[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=toolbar],[role=tablist],[role=region],header,nav,aside,main";
const box = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
const shown = (el: Element, r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  && (typeof el.checkVisibility !== "function" || el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
/** Its own words: the text nodes directly inside it. */
const ownText = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim().replace(/\s+/g, " ");
/** How a line names an element: #id, else its role and label, else its tag and words. */
/** Words the app wrote on its own controls; anything else (comments, notes, what people typed) shows only as its tag. */
const WORDY = "button,a,label,h1,h2,h3,h4,h5,h6,[role=button],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=tab],[role=heading],[role=switch],[role=checkbox],[role=radio]";
export function nameOf(el: Element): string {
  if (ownId(el)) return `#${el.id}`;
  const role = el.getAttribute("role"), label = el.getAttribute("aria-label");
  const own = el.closest(WORDY) && !el.closest("[data-census-private]") ? ownText(el) : null;
  const words = (label ?? own ?? "").slice(0, 40);
  return `${role ?? el.tagName.toLowerCase()}${words ? ` ${JSON.stringify(words)}` : ""}`;
}
const inside = (el: Element) => { for (let p = el.parentElement; p; p = p.parentElement) if (ownId(p)) return ` in #${p.id}`; return ""; };

/**
 * The screen as lines, for a reader that can't see it: "window 1440x860",
 * one line per region ("#toolbar 0,0 1440x52"), then what looks wrong:
 * "cut-text" (its words don't fit and are clipped), "overlap" (two texts
 * drawn over each other), "outside" (a region past the window's edge),
 * "wrapped" (a row's items dropped onto another line), "no-edge" (a filled
 * button the color of what's behind it), "faint" (words or an icon too close
 * to the color behind them: contrast from computed styles, no pixels),
 * "faded" (a control see-through but not turned off), "squeezed" (a list
 * meant to scroll given almost no height), "covered" (something solid over a
 * control's middle).
 * Drawn things (a canvas) show only as their box; the page's state says
 * what's in them. Words come only from the app's own controls
 * (buttons, menu items, headings), never from what people wrote; mark
 * anything else private with data-census-private. About 50 elements a millisecond; run it once, on Send.
 */
export function layoutLines(root: Element = document.body, cap = 160, skip?: (el: Element) => boolean): string[] {
  const regions: string[] = [], wrong: string[] = [];
  const texts: { el: Element; r: DOMRect; layer: Element | null }[] = [];
  const controls: { el: Element; r: DOMRect }[] = [];
  const seeing = looking();
  const clipOf = new Map<Element, DOMRect | null>();
  /** The part of the window an element can show in: its scrolling and clipping ancestors cut it (null: none of it). */
  const room = (el: Element | null): DOMRect | null => {
    if (!el || el === document.documentElement) return new DOMRect(0, 0, innerWidth, innerHeight);
    if (clipOf.has(el)) return clipOf.get(el)!;
    const up = room(el.parentElement);
    let out = up;
    if (up && el instanceof HTMLElement && !/visible/.test(getComputedStyle(el).overflow)) out = cross(up, el.getBoundingClientRect());
    clipOf.set(el, out);
    return out;
  };
  const all = root.querySelectorAll("*");
  for (let i = 0; i < all.length && i < 8000; i++) {
    const el = all[i];
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    if (skip?.(el)) continue;
    const full = el.getBoundingClientRect();
    // A list meant to scroll that got almost no room (a panel squeezed by its neighbours): its rows can't be reached.
    if (el instanceof HTMLElement && full.width > 0 && full.height < 24 && el.scrollHeight > 40 && el.children.length && wrong.length < 60
      && /auto|scroll/.test(getComputedStyle(el).overflowY) && (typeof el.checkVisibility !== "function" || el.checkVisibility({ visibilityProperty: true }))) {
      wrong.push(`squeezed ${nameOf(el)}${inside(el)} ${box(full)}: shows ${Math.round(full.height)}px of ${el.scrollHeight}px`);
    }
    if (!shown(el, full)) continue;
    const space = room(el.parentElement);
    const r = space && cross(space, full);
    if (!r) continue; // scrolled or clipped out of sight
    if (el instanceof HTMLElement && wrong.length < 60) {
      const cs = getComputedStyle(el);
      if (/flex/.test(cs.display) && cs.flexWrap === "wrap") {
        // A row whose items went onto more than one line: which ones dropped.
        const kids = [...el.children].map((c) => ({ c, r: c.getBoundingClientRect() })).filter((k) => k.r.width > 0 && k.r.height > 0);
        const top = Math.min(...kids.map((k) => k.r.top));
        const down = kids.filter((k) => k.r.top >= top + Math.max(4, kids[0]?.r.height ?? 0) * 0.75 && k.c.matches(`${WORDY},[id],[aria-label]`));
        if (kids.length > 1 && down.length) wrong.push(`wrapped ${nameOf(el)}${inside(el)} ${box(full)}: ${down.slice(0, 3).map((k) => nameOf(k.c)).join(", ")} dropped to the next line`);
      }
      if (el.matches(PRESSABLE) && !el.closest(OFF)) {
        const op = seeing.opacity(el);
        // Faded out but not turned off: it looks off and isn't, or it should look on.
        if (op < 0.35) wrong.push(`faded ${nameOf(el)}${inside(el)} ${box(full)}: opacity ${op.toFixed(2)} but not disabled`);
        else if (r.width >= 4 && r.height >= 4 && (ownId(el) || el.getAttribute("aria-label") || ownText(el))) controls.push({ el, r });
        // A control that is only a drawing (an icon): its lines' color against what's behind it.
        const svg = !el.textContent?.trim() ? el.querySelector("svg") : null;
        if (svg && op >= 0.35) {
          const ratio = seeing.ratio(el, getComputedStyle(svg).color, op);
          if (ratio !== null && ratio < FAINT_ICON) wrong.push(`faint ${nameOf(el)}${inside(el)} ${box(full)}: icon contrast ${ratio.toFixed(1)}:1 ${seeing.say(el, getComputedStyle(svg).color)}`);
        }
      }
      if (el.matches("button,[role=button]")) {
        // A filled button the same color as what's behind it, with no border: its box can't be seen.
        const bg = cs.backgroundColor;
        if (!/^(transparent|rgba\([^)]*, 0\))$/.test(bg) && !(parseFloat(cs.borderTopWidth) > 0 && cs.borderTopColor !== bg)) {
          let up = el.parentElement, under = "";
          while (up && !under) { const b = getComputedStyle(up).backgroundColor; if (!/^(transparent|rgba\([^)]*, 0\))$/.test(b)) under = b; else up = up.parentElement; }
          // an outline or a ring (a shadow with no offset or blur) draws its edge
          if (under === bg && !(cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) && !shadowLayers(cs.boxShadow).rings.length) wrong.push(`no-edge ${nameOf(el)}${inside(el)} ${box(full)}: same color as ${up ? nameOf(up) : "the page"} behind it (${((c) => (c ? `rgb(${c.slice(0, 3).map(Math.round).join(",")})` : bg))(parseColor(bg))})`);
        }
      }
    }
    // A field's hint that doesn't fit: the browser cuts it (with … when the field asks for one). Measured in the hint's own
    // style (::placeholder: its font, letter-spacing and case); a textarea wraps its hint, so there it is cut only past its last line.
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.placeholder && !el.value && wrong.length < 60 && full.width >= 24) {
      const cs = getComputedStyle(el), ps = getComputedStyle(el, "::placeholder");
      const ctx = (measure ??= document.createElement("canvas").getContext("2d"));
      if (ctx) {
        ctx.font = `${ps.fontStyle} ${ps.fontWeight} ${ps.fontSize} ${ps.fontFamily}`;
        const said = ps.textTransform === "uppercase" ? el.placeholder.toUpperCase() : ps.textTransform === "lowercase" ? el.placeholder.toLowerCase() : el.placeholder;
        const need = ctx.measureText(said).width + (parseFloat(ps.letterSpacing) || 0) * said.length;
        const lines = el instanceof HTMLTextAreaElement ? Math.max(1, Math.floor((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / (parseFloat(ps.lineHeight) || parseFloat(ps.fontSize) * 1.2 || 1))) : 1;
        const has = (el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (parseFloat(cs.textIndent) || 0)) * lines;
        if (need > has + 1) wrong.push(`cut-text placeholder of ${nameOf(el)}${inside(el)} ${box(full)} needs ${Math.ceil(need)}px, has ${Math.floor(has)}px${cs.textOverflow === "ellipsis" ? " (ends in …)" : ""}`);
      }
    }
    if ((ownId(el) || el.matches(REGION)) && full.width >= 24 && full.height >= 12) {
      regions.push(`${nameOf(el)} ${box(full)}`);
      // Past the window where no list scrolls to it (a column scrolled out of a list is fine) and nothing clips it first.
      const W = innerWidth, H = innerHeight;
      const scrolls = (axis: "overflowX" | "overflowY") => { for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p)[axis])) return true; return false; };
      if ((((full.top < -1 && space!.top <= 1) || (full.bottom > H + 1 && space!.bottom >= H - 1)) && !scrolls("overflowY"))
        || (((full.left < -1 && space!.left <= 1) || (full.right > W + 1 && space!.right >= W - 1)) && !scrolls("overflowX"))) wrong.push(`outside ${nameOf(el)} ${box(full)} window ${W}x${H}`);
    }
    if (!ownText(el)) continue;
    // The words' own box (not the element's), cut to what shows.
    const range = document.createRange();
    const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent?.trim());
    range.setStartBefore(nodes[0]); range.setEndAfter(nodes[nodes.length - 1]);
    const words = cross(r, range.getBoundingClientRect());
    if (words) texts.push({ el, r: words, layer: el.closest(POPUP) });
    if (el instanceof HTMLElement) {
      const cs = getComputedStyle(el);
      // Words too close to the color behind them to read (turned-off controls are meant to be dim).
      if (words && wrong.length < 60 && !el.closest(OFF)) {
        const ratio = seeing.ratio(el, cs.color, seeing.opacity(el));
        if (ratio !== null && ratio < FAINT_TEXT) wrong.push(`faint ${nameOf(el)}${inside(el)} ${box(full)}: contrast ${ratio.toFixed(1)}:1 ${seeing.say(el, cs.color)}`);
      }
      const clips = cs.textOverflow === "ellipsis" || /hidden|clip/.test(cs.overflowX + cs.overflowY);
      // a 1 px box is words for screen readers only, hidden on purpose
      if (clips && full.width > 2 && full.height > 2 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        wrong.push(`cut-text ${nameOf(el)}${inside(el)} ${box(full)} needs ${el.scrollWidth}x${el.scrollHeight}`);
      }
    }
  }
  // Words over words: two texts' boxes crossing by more than 3 px, neither inside the other.
  // Only words that show: under anything opaque drawn on top (a pinned row, a sheet, the other's own button), they can't clash.
  const showing = (el: Element, r: DOMRect) => {
    for (const c of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
      if (c === el || el.contains(c) || c.contains(el)) return true;
      if (!/^(transparent|rgba\([^)]*, 0\))$/.test(getComputedStyle(c).backgroundColor)) return false;
    }
    return true;
  };
  // A modal menu makes the page behind it inert, and hit tests skip inert elements and ones with
  // pointer events off; for this look only (synchronous, nothing paints in between) every element counts.
  const peek = new CSSStyleSheet();
  peek.replaceSync("* { pointer-events: auto !important; }");
  const sheets = [...document.adoptedStyleSheets];
  document.adoptedStyleSheets = [...sheets, peek];
  const inert = [...document.querySelectorAll<HTMLElement>("[inert]")];
  for (const e of inert) e.inert = false;
  const n = Math.min(texts.length, 700);
  try {
    for (let a = 0; a < n && wrong.length < cap; a++) {
      for (let b = a + 1; b < n; b++) {
        const A = texts[a], B = texts[b];
        const x = cross(A.r, B.r);
        // Only within one layer: a menu or dialog drawn over the page is meant to cover it.
        if (x && x.width > 3 && x.height > 3 && A.layer === B.layer && !A.el.contains(B.el) && !B.el.contains(A.el)
          && showing(A.el, A.r) && showing(B.el, B.r)) wrong.push(`overlap ${nameOf(A.el)} ${box(A.r)} / ${nameOf(B.el)} ${box(B.r)}`);
      }
    }
    // A control with something solid over its middle (not a menu or dialog, which are meant to cover): it can't be seen or pressed.
    for (const c of controls.slice(0, 300)) {
      if (wrong.length >= cap) break;
      if (c.el.closest(POPUP)) continue;
      const by = coverOf(c.el, c.r);
      if (by) wrong.push(`covered ${nameOf(c.el)}${inside(c.el)} ${box(c.r)}: under ${nameOf(by)}${inside(by)}`);
    }
  } finally {
    document.adoptedStyleSheets = sheets;
    for (const e of inert) e.inert = true;
  }
  const head = [`window ${innerWidth}x${innerHeight}`];
  const rest = cap - head.length - Math.min(wrong.length, 60);
  return [...head, ...wrong.slice(0, 60), ...regions.slice(0, Math.max(0, rest))];
}
/** Controls turned off on purpose: dim is right for them. */
const OFF = "[disabled],[aria-disabled=true],[inert],[data-census-dim]";
let measure: CanvasRenderingContext2D | null | undefined;
const FAINT_TEXT = 2; // contrast under 2:1 is hard to read for anyone (WCAG asks 4.5 for text, 3 for large; app chrome often sits near 3)
const FAINT_ICON = 1.5;
const clear = (c: [number, number, number, number] | null) => !c || c[3] < 0.02;
/**
 * What shows behind an element and how see-through it is, from computed
 * styles (no pixels): its own and its ancestors' backgrounds laid over each
 * other, and their opacities multiplied. Kept per element for one read.
 */
function looking() {
  const bg = new Map<Element, [number, number, number, number]>(), op = new Map<Element, number>();
  const base = (): [number, number, number, number] => {
    for (const e of [document.body, document.documentElement]) { const c = e && parseColor(getComputedStyle(e).backgroundColor); if (c && !clear(c)) return over(c, [255, 255, 255, 1]); }
    return [255, 255, 255, 1];
  };
  const back = (el: Element | null): [number, number, number, number] => {
    if (!el) return base();
    const had = bg.get(el);
    if (had) return had;
    const c = parseColor(getComputedStyle(el).backgroundColor);
    const out = clear(c) ? back(el.parentElement) : c![3] >= 0.995 ? c! : over(c!, back(el.parentElement));
    bg.set(el, out);
    return out;
  };
  const opacity = (el: Element | null): number => {
    if (!el) return 1;
    const had = op.get(el);
    if (had !== undefined) return had;
    const out = (parseFloat(getComputedStyle(el).opacity) || 0) * opacity(el.parentElement);
    op.set(el, out);
    return out;
  };
  return {
    opacity,
    /** The contrast of `color` drawn at `alpha` in el, against what's behind el. */
    ratio(el: Element, color: string, alpha: number): number | null {
      const fg = parseColor(color);
      if (!fg) return null;
      const under = back(el);
      return contrast(over([fg[0], fg[1], fg[2], fg[3] * alpha], under), under);
    },
    say: (el: Element, color: string) => { const rgb = (c: number[]) => `rgb(${c.slice(0, 3).map(Math.round).join(",")})`, fg = parseColor(color); return `(${fg ? rgb(fg) : color.replace(/\s+/g, "")} on ${rgb(back(el))})`; },
  };
}
/** What shows behind an element, from computed styles: its own background color, else its ancestors'. For a canvas whose background is CSS and not drawn. */
export function behind(el: Element | null): [number, number, number, number] {
  if (!el) return [255, 255, 255, 1];
  const c = parseColor(getComputedStyle(el).backgroundColor);
  return clear(c) ? behind(el.parentElement) : c![3] >= 0.995 ? c! : over(c!, behind(el.parentElement));
}
/** The first solid thing drawn over an element's middle that isn't part of it, a menu or a backdrop; null when nothing covers it. */
function coverOf(el: Element, r: DOMRect): Element | null {
  for (const c of document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)) {
    if (c === el || el.contains(c) || c.contains(el)) return null;
    if (c.closest(POPUP)) return null;
    const cr = c.getBoundingClientRect();
    if (cr.width * cr.height > innerWidth * innerHeight * 0.8) continue; // a backdrop or the page itself
    const bg = parseColor(getComputedStyle(c).backgroundColor);
    if ((bg && bg[3] > 0.5) || c.tagName === "CANVAS" || c.tagName === "IMG" || c.tagName === "VIDEO") return c;
  }
  return null;
}
/** Where two boxes cross, or null. */
function cross(a: DOMRect, b: DOMRect): DOMRect | null {
  const l = Math.max(a.left, b.left), t = Math.max(a.top, b.top), r = Math.min(a.right, b.right), btm = Math.min(a.bottom, b.bottom);
  return r > l && btm > t ? new DOMRect(l, t, r - l, btm - t) : null;
}


// ---------- The styles on screen, counted ----------

/**
 * A design system's allowed values, to mark what is off it. Colors as CSS
 * colors; sizes in px. `parts`: the design system's part names, so a place
 * is named by its part (Button) rather than the component around it, and a
 * native control that no listed part drew says so. `shadows`: its named
 * box-shadows. `ignore`: a selector for subtrees to leave out. `foreign:
 * false` keeps what no component drew (by default, on a page with component
 * names, such a subtree with controls in it is named once and left out).
 * `closed`: also what pop-ups not opened yet would look like (React only).
 * `sources`: " @ file:line" where a place's part was used, on the places that
 * need a fix (set where used, off the system, a part in two looks).
 */
export type StyleRules = { colors?: Record<string, string>; type?: string[]; radii?: number[]; parts?: string[]; shadows?: Record<string, string>; ignore?: string; foreign?: boolean; closed?: boolean; sources?: boolean };

/** The census as data: groups of counted values with a few places each. censusLines writes it out; mergeCensus joins pages. */
export type CensusLook = { state: string; shape: string; skin: string; say: string; n: number; at: string[]; lo?: number; hi?: number };
export type CensusRow = { key: string; n: number; note?: string; at: string[]; looks?: CensusLook[]; flag?: boolean };
export type CensusGroup = { name: string; what?: string; rows: CensusRow[]; more?: number };
export type Census = { head: string; groups: CensusGroup[] };

type RGBA = [number, number, number, number];
const hex = (c: RGBA) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}${c[3] < 0.995 ? Math.round(c[3] * 255).toString(16).padStart(2, "0") : ""}`;
const num = (v: number) => String(Math.round(v * 10) / 10);
/** A list split at its top-level commas (none inside brackets). */
const splitTop = (s: string): string[] => {
  const parts: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === "(" || c === "[") depth++; else if (c === ")" || c === "]") depth--; else if (c === "," && !depth) { parts.push(s.slice(from, i)); from = i + 1; } }
  parts.push(s.slice(from));
  return parts.map((x) => x.trim());
};

/**
 * A box-shadow as its layers: `rings` are the ones with no offset or blur
 * (a line drawn as a shadow: "#ffffff1a 1px (ring)"), `rest` the real
 * shadows ("0 4px 6px -1px #0000001a"). Layers that draw nothing (see-through,
 * or all zero) are dropped.
 */
export function shadowLayers(css: string): { rings: string[]; rest: string[] } {
  const out = { rings: [] as string[], rest: [] as string[] };
  if (!css || css === "none") return out;
  for (const layer of splitTop(css)) {
    let color = "", inset = false;
    const len: number[] = [];
    const words = layer.replace(/[a-z-]+\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)|#[0-9a-f]{3,8}\b/i, (m) => { color = m; return " "; });
    for (const w of words.trim().split(/\s+/)) { if (w === "inset") inset = true; else if (/^-?[\d.]+(e[+-]?\d+)?(px)?$/.test(w)) len.push(parseFloat(w)); else if (w) color ||= w; }
    const [x = 0, y = 0, blur = 0, spread = 0] = len;
    const c = color ? parseColor(color) : null;
    if ((c && c[3] < 0.02) || (!x && !y && !blur && !spread)) continue;
    const say = c ? hex(c) : color || "currentcolor";
    if (!x && !y && !blur) out.rings.push(`${say} ${num(Math.abs(spread))}px (ring${inset ? " inset" : ""})`);
    else out.rest.push(`${[x, y, blur, spread].map((v) => (v ? `${num(v)}px` : "0")).join(" ")} ${say}${inset ? " inset" : ""}`);
  }
  return out;
}

/** The state a control says it is in (ARIA, data-state, disabled): "disabled", "selected", "open", or two of them; "" at rest. */
export function stateOf(el: Element): string {
  const a = (k: string) => el.getAttribute(k);
  const out: string[] = [];
  if ((el as HTMLButtonElement).disabled === true || a("aria-disabled") === "true" || a("data-disabled") !== null) out.push("disabled");
  if (a("aria-selected") === "true" || a("aria-checked") === "true" || a("aria-pressed") === "true" || (a("aria-current") ?? "false") !== "false" || /^(on|active|checked|selected)$/.test(a("data-state") ?? "") || a("data-selected") !== null) out.push("selected");
  if (a("aria-expanded") === "true" || a("data-state") === "open") out.push("open");
  return out.join(" ");
}

/** A font stack said against the first one: what it adds and what it leaves out (whole, when they share little). */
export function fontDiff(stack: string, first: string): string {
  const fam = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const a = fam(stack), b = fam(first);
  const plus = a.filter((x) => !b.includes(x)), minus = b.filter((x) => !a.includes(x));
  if (!plus.length && !minus.length) return `the first stack in another order: ${a.join(", ")}`;
  if (plus.length + minus.length > a.length + b.length - plus.length - minus.length) return a.join(", "); // little in common: said whole
  return `the first stack${plus.length ? ` plus ${plus.map((x) => `${x}${a[0] === x ? " (in front)" : ""}`).join(", ")}` : ""}${minus.length ? ` minus ${minus.join(", ")}` : ""}`;
}

// ---------- Which part drew an element ----------

const PART_PROPS = ["variant", "size", "tone", "intent", "kind", "appearance", "shape", "density"];
// props that also pick a look in some kits: they join a part's key only where they tell two of its looks apart
const MORE_PROPS = ["color", "colorScheme", "colorPalette", "status", "severity", "level"];
type Fiber = { type: unknown; elementType?: unknown; return: Fiber | null; child?: Fiber | null; sibling?: Fiber | null; alternate?: Fiber | null; memoizedProps?: Record<string, unknown> | null; _debugOwner?: unknown };
const compName = (t: unknown, depth = 0): string => {
  if (depth > 3) return "";
  if (typeof t === "function") return (t as { displayName?: string }).displayName ?? t.name ?? "";
  if (t && typeof t === "object") { const o = t as { displayName?: string; render?: unknown; type?: unknown }; return o.displayName ?? compName(o.render ?? o.type, depth + 1); }
  return "";
};
// a minified name (a, Xe) or a framework's plumbing names nothing
const PLAIN = /^[A-Z][A-Za-z0-9]{2,}$/, PLUMBING = /(Provider|Context|Consumer|Boundary|Slot|Portal|Fragment|FocusManager|FocusScope|FocusTrap|Presence)$/;
// React keeps an element's fiber under one key per root; finding it means listing the element's keys, so remember it
let fiberKey = "";
const fiberOf = (el: Element): Fiber | null => {
  const bag = el as unknown as Record<string, Fiber | undefined>;
  if (!fiberKey || !(fiberKey in bag)) { const k = Object.keys(el).find((x) => x.startsWith("__reactFiber$")); if (!k) return null; fiberKey = k; }
  return bag[fiberKey] ?? null;
};
// only short word-like values of the variant props: never text, never a flag
const propsOf = (f: Fiber, keys = PART_PROPS) => keys.flatMap((k) => { const v = f.memoizedProps?.[k]; return (typeof v === "string" || typeof v === "number") && /^[\w.-]{1,20}$/.test(String(v)) ? [`${k}=${v}`] : []; }).join(" ");
const named = (f: Fiber) => { const n = compName(f.type); return PLAIN.test(n) && !PLUMBING.test(n) ? n : ""; };
const family = (name: string) => name.match(/^[A-Za-z][a-z0-9]*/)?.[0] ?? name;
type Link = { name: string; props: string; fiber: Fiber | null; gap: boolean; src?: string };
type PartInfo = { say: string; key: string; fiber: Fiber | null; listed: boolean; cand: boolean; own: boolean; src?: string };

// ---------- Other frameworks: Vue, Svelte and Angular keep their component names in dev builds too ----------

type Bag = Record<string, unknown>;
const obj = (v: unknown): Bag | null => (v && typeof v === "object" ? (v as Bag) : null);
// the variant props of a plain object of props or inputs; an Angular signal input says its value in its name
const propsIn = (o: Bag | null, keys = PART_PROPS) => (o ? keys.flatMap((k) => {
  let v = o[k];
  if (typeof v === "function") { try { v = /^\[(?:Input )?Signal: (.*)\]$/.exec(String(v))?.[1]; } catch { v = undefined; } }
  return (typeof v === "string" || typeof v === "number") && /^[\w.-]{1,20}$/.test(String(v)) ? [`${k}=${v}`] : [];
}).join(" ") : "");
const baseName = (file: unknown) => (typeof file === "string" ? file.replace(/^.*[\\/]/, "").replace(/\.(vue|svelte|[jt]sx?)$/, "") : "");
/**
 * The components that returned an element as their root, inner first, when the page is not React:
 * Vue 3 and Vue 2 (component names and props, the file that used it), Svelte 4 and 5 (the file that
 * wrote the element; Svelte 5 also the tag and line where the component was used) and Angular (the
 * host element's component and its inputs). Each only in a dev build; [] when none says.
 */
function otherChain(el: Element): Link[] {
  const e = el as unknown as Bag, out: Link[] = [];
  const add = (name: string, props: string, src?: string) => { if (PLAIN.test(name) && !PLUMBING.test(name)) out.push({ name, props, fiber: null, gap: false, src }); };
  // Vue 3: the instance that rendered it, then each parent whose root is the same element
  for (let inst = obj(e.__vueParentComponent), i = 0; inst && i < 12; inst = obj(inst.parent), i++) {
    if (obj(inst.subTree)?.el !== el && obj(inst.vnode)?.el !== el) break;
    const type = obj(inst.type) ?? {};
    add(String(type.name ?? type.__name ?? "") || baseName(type.__file), propsIn(obj(inst.props)), String(obj(obj(inst.parent)?.type)?.__file ?? "") || undefined);
  }
  if (out.length) return out;
  // Vue 2: __vue__ is the instance whose root this is
  for (let vm = obj(e.__vue__), i = 0; vm && vm.$el === el && i < 12; vm = obj(vm.$parent), i++) {
    const o = obj(vm.$options) ?? {};
    add(String(o.name ?? o._componentTag ?? "") || baseName(o.__file), propsIn(obj(vm.$props)), String(obj(obj(vm.$parent)?.$options)?.__file ?? "") || undefined);
  }
  if (out.length) return out;
  // Svelte: an element written in Button.svelte whose parent element was written elsewhere is Button's root
  const meta = obj(e.__svelte_meta), file = obj(meta?.loc)?.file;
  if (typeof file === "string") {
    const up = obj((el.parentElement as unknown as Bag | null)?.__svelte_meta);
    if (obj(up?.loc)?.file !== file) {
      const name = baseName(file);
      let src: string | undefined;
      for (let p = obj(meta!.parent), i = 0; p && i < 20; p = obj(p.parent), i++) if (p.type === "component" && (!p.componentTag || p.componentTag === name) && typeof p.file === "string") { src = `${p.file}:${p.line ?? 0}`; break; }
      add(name, "", src);
    }
    return out;
  }
  // Angular (dev mode): the component a host element belongs to, or the lone root inside one
  const ng = obj((globalThis as unknown as Bag).ng);
  if (ng && typeof ng.getComponent === "function") {
    const get = ng.getComponent as (x: Element) => unknown;
    for (const host of [el, el.parentElement && el.parentElement.children.length === 1 ? el.parentElement : null]) {
      if (!host) continue;
      let c: Bag | null = null;
      try { c = obj(get(host)); } catch { c = null; }
      if (c) { add(String((c.constructor as { name?: string } | undefined)?.name ?? "").replace(/Component$/, ""), propsIn(c)); break; }
    }
  }
  return out;
}

// ---------- Where a part was used: file and line ----------

// frames of React and the bundler's own code, never the app's
const NOT_APP = /node_modules|react-dom|react-jsx|jsx-dev-runtime|react-server|scheduler|\(native\)|<anonymous>/;
/**
 * The file and line where a component was used (its JSX), from React's dev build: _debugSource (React 18
 * with the dev JSX transform) as "file:line", else _debugStack (React 19) as up to three frames of the
 * bundled code, "{url:line:col url:line:col}", which the capture maps through the page's source maps.
 */
function fiberSrc(f: Fiber | null): string {
  const b = obj(f);
  if (!b) return "";
  const ds = obj(b._debugSource);
  if (ds && typeof ds.fileName === "string") return `${ds.fileName}:${ds.lineNumber ?? 0}`;
  const st = obj(b._debugStack)?.stack;
  if (typeof st !== "string") return "";
  const frames: string[] = [];
  for (const line of st.split("\n").slice(1)) {
    const m = /((?:https?|file|webpack|turbopack|webpack-internal):\/\/[^\s()]+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (m && !NOT_APP.test(m[1])) frames.push(`${m[1]}:${m[2]}:${m[3]}`);
    if (frames.length === 3) break;
  }
  return frames.length ? `{${frames.join(" ")}}` : "";
}
/**
 * The part an element is the root of. `say` is how a place names it, `key`
 * the part its looks are counted under, `fiber` the component to ask what
 * its use site passed, `listed` whether rules.parts has it, `cand` whether
 * it is a part whose looks should agree (listed, or with variant props, its
 * family's included), `own` whether what its use site passed is worth
 * reading (listed, or with variant props of its own).
 */
function partInfo(el: Element, parts?: string[]): PartInfo | null {
  const tag = el.getAttribute("data-part");
  if (tag) {
    const props = (e: Element) => ["variant", "size", "tone"].flatMap((k) => { const v = e.getAttribute(`data-${k}`); return v ? [`${k}=${v.slice(0, 20)}`] : []; }).join(" ");
    let say = [tag, props(el)].filter(Boolean).join(" ");
    if (!props(el)) for (let p = el.parentElement, i = 0; p && i < 6; p = p.parentElement, i++) { const t = p.getAttribute("data-part"); if (t && family(t) === family(tag) && props(p)) { say = `${tag} of ${t} ${props(p)}`; break; } }
    return { say, key: say, fiber: null, listed: !parts?.length || parts.includes(tag), cand: true, own: false };
  }
  const start = fiberOf(el);
  let chain: Link[] = [];
  // up from the element to the next element: every component that returned it as its root (16 names at most)
  // `gap`: a context was crossed since the name before, so what is further out wraps this part and isn't it (a Modal around its trigger)
  let gap = false;
  if (!start) chain = otherChain(el);
  else for (let f = start.return, i = 0; f && typeof f.type !== "string" && chain.length < 16 && i < 80; f = f.return, i++) {
    const raw = compName(f.type);
    if (/(Provider|Context|Consumer|Boundary)$/.test(raw)) gap = chain.length > 0;
    else if (PLAIN.test(raw) && !PLUMBING.test(raw)) { chain.push({ name: raw, props: propsOf(f), fiber: f, gap }); gap = false; }
  }
  if (!chain.length) return null;
  const text = (c: Link) => (c.props ? `${c.name} ${c.props}` : c.name);
  const inner = chain.find((c) => c.props);
  let main = chain.find((c) => parts?.includes(c.name));
  const listed = !!main;
  const reach = (from: Link, ok: (c: Link) => boolean) => { let to = from; for (const c of chain.slice(chain.indexOf(from) + 1)) { if (c.gap) break; if (ok(c)) to = c; } return to; };
  // a kit's part inside the system's part of the same family (a kit's Toggle inside the system's ToggleButton): the outermost is the part
  if (main) main = reach(main, (c) => !!parts?.includes(c.name) && family(c.name) === family(main!.name));
  else if (inner) main = reach(inner, (c) => !!c.props);
  else main = chain[0];
  let key = text(main);
  if (!main.props && start) {
    // no variant of its own: a part of a family (TabsTab) takes it from the family's root (TabsList variant=...)
    let hosts = 0;
    for (let f = start.return, i = 0; f && i < 60 && hosts < 6; f = f.return, i++) {
      if (typeof f.type === "string") { hosts++; continue; }
      const name = hosts ? named(f) : "";
      if (name && family(name) === family(main.name) && propsOf(f)) { key = `${main.name} of ${name} ${propsOf(f)}`; break; }
    }
  }
  // the part it is drawn with, when that is another part with props of its own (a Badge drawn by a Body)
  const say = inner && inner !== main && inner.name !== main.name && chain.indexOf(inner) < chain.indexOf(main) ? `${key} < ${text(inner)}` : key;
  return { say, key, fiber: main.fiber, listed, cand: listed || key.includes("="), own: listed || !!main.props, src: start ? undefined : main.src };
}
/**
 * The component that drew an element as its own root, with its variant
 * props ("Button variant=secondary size=sm"): a `data-part` attribute (and
 * `data-variant`, `data-size`) if the app sets one, else React's own
 * component names, which dev builds keep. A part with no variant of its own
 * takes its family's ("TabsTab of TabsList variant=secondary"), and a part
 * drawn with another names both ("Badge variant=info < Text size=sm").
 * Only short word-like prop values of the PART_PROPS keys, never text. ""
 * when nothing says.
 */
export function partOf(el: Element, parts?: string[]): string { return partInfo(el, parts)?.say ?? ""; }

// ---------- What the page's style rules say ----------

/** Where a rule stands in the cascade: its @layer ("" for none), its selector (for the specificity) and its place in the page's sheets. */
type Ranked = { sel: string; layer: string; order: number; spec?: number };
// `on`: the state is [data-pressed] with no :active; `toggle`: and the selector offers it next to an on-state ([data-state=on])
type StateRule = Ranked & { state: string; base: string; pseudo: string; style: CSSStyleDeclaration; on?: boolean; toggle?: boolean };
// `has`: the states its selector names (a rule with :not(:hover) holds at rest and not under the pointer)
type PlainRule = Ranked & { style: CSSStyleDeclaration; has: string[]; base?: string; pseudo?: string };
type Sheets = { states: StateRule[]; plain: PlainRule[]; unreadable: number; beats: (a: Ranked, aImp: boolean, b: Ranked, bImp: boolean) => boolean };
const identEnd = (s: string, i: number) => { while (i < s.length) { if (s[i] === "\\") i += 2; else if (/[\w-]/.test(s[i]) || s.charCodeAt(i) > 127) i++; else break; } return i; };
const closeOf = (s: string, i: number) => { let d = 0; for (; i < s.length; i++) { if (s[i] === "\\") i++; else if (s[i] === "(" || s[i] === "[") d++; else if ((s[i] === ")" || s[i] === "]") && !--d) return i + 1; } return s.length; };
/** A selector's specificity as one number (ids, then classes, attributes and pseudo-classes, then types): :where() counts nothing, :is(), :not() and :has() their most specific branch. */
export function specificity(sel: string): number {
  let n = 0;
  for (let i = 0; i < sel.length; ) {
    const c = sel[i];
    if (c === "\\") i += 2;
    else if (c === "#") { n += 1e6; i = identEnd(sel, i + 1); }
    else if (c === ".") { n += 1e3; i = identEnd(sel, i + 1); }
    else if (c === "[") { n += 1e3; i = closeOf(sel, i); }
    else if (c === ":") {
      const el = sel[i + 1] === ":", from = i + (el ? 2 : 1), to = identEnd(sel, from), name = sel.slice(from, to).toLowerCase();
      const end = sel[to] === "(" ? closeOf(sel, to) : to, arg = end > to ? sel.slice(to + 1, end - 1) : "";
      if (el || /^(before|after|first-line|first-letter)$/.test(name)) n += 1;
      else if (/^(is|not|has|matches|-webkit-any|-moz-any)$/.test(name)) n += Math.max(0, ...splitTop(arg).map(specificity));
      else if (name !== "where") n += 1e3 + (/^nth-(last-)?child$/.test(name) && / of /.test(arg) ? Math.max(0, ...splitTop(arg.slice(arg.indexOf(" of ") + 4)).map(specificity)) : 0);
      i = end;
    } else if (/[a-zA-Z_]/.test(c) || sel.charCodeAt(i) > 127) { n += 1; i = identEnd(sel, i); }
    else i++;
  }
  return n;
}
const ON_STATE = /\[(?:data-state=["']?(?:on|active|checked|selected)["']?|aria-(?:pressed|checked|selected)=["']?true["']?|data-(?:selected|checked|on)(?:=[^\]]*)?)\]/;
const PRESSED_ATTR = /\[data-pressed(?:=[^\]]*)?\]/;
/** Whether a selector offers [data-pressed] as another way to say "on": next to an on-state in one :is() or :where(), or in the rule's comma list. */
const pressedIsOnIn = (sel: string, list: string[]): boolean => {
  const alt = (arms: string[]) => arms.some((x) => PRESSED_ATTR.test(x)) && arms.some((x) => ON_STATE.test(x) && !PRESSED_ATTR.test(x));
  if (alt(list)) return true;
  for (const m of sel.matchAll(/:(?:is|where|matches|-webkit-any)\(/g)) { const open = m.index + m[0].length - 1; if (alt(splitTop(sel.slice(open + 1, closeOf(sel, open) - 1)))) return true; }
  return false;
};
/**
 * The page's own style rules (nested rules, @import and adopted sheets
 * included; rules under an @media or @supports that doesn't hold are left
 * out; a sheet from another site can't be read and is counted), each with
 * its place in the cascade (@layer, source order). `states` are the rules
 * for a hovered, pressed or focused control, each with the selector that
 * finds the control at rest: the state is replaced by :where(*), not
 * deleted, so :not(:hover) still matches nothing. A rule on ::before or
 * ::after is the control's overlay. `beats` says which of two declarations
 * the cascade takes: !important, then the layer (none over any, a later one
 * over an earlier; the other way round when !important), then specificity,
 * then the later rule.
 */
function readSheets(): Sheets {
  const layers = new Map<string, number>();
  const layerCmp = (a: string, b: string): number => {
    if (a === b) return 0;
    if (!a || !b) return a ? -1 : 1;
    const x = a.split("."), y = b.split(".");
    for (let i = 0; ; i++) {
      if (i >= x.length || i >= y.length) return i >= x.length ? 1 : -1; // a layer's own rules over its sub-layers'
      if (x[i] !== y[i]) return (layers.get(x.slice(0, i + 1).join(".")) ?? 0) - (layers.get(y.slice(0, i + 1).join(".")) ?? 0);
    }
  };
  const spec = (r: Ranked) => (r.spec ??= specificity(r.sel));
  const out: Sheets = { states: [], plain: [], unreadable: 0, beats: (a, aImp, b, bImp) => {
    if (aImp !== bImp) return aImp;
    const l = layerCmp(a.layer, b.layer) * (aImp ? -1 : 1);
    return l ? l > 0 : spec(a) !== spec(b) ? spec(a) > spec(b) : a.order > b.order;
  } };
  let order = 0, anon = 0;
  const enter = (parent: string, name: string) => { let full = parent; for (const seg of name.split(".")) { full = full ? `${full}.${seg}` : seg; if (!layers.has(full)) layers.set(full, layers.size); } return full; };
  const re = (pseudo: string, attrs: string[]) => new RegExp([`(?<!\\\\)${pseudo}(?![\\w-])`, ...attrs.map((n) => `\\[${n}(?:=[^\\]]*)?\\]`)].join("|"), "g");
  const STATE: [string, RegExp][] = [["hover", re(":hover", ["data-hovered", "data-highlighted"])], ["pressed", re(":active", ["data-pressed"])], ["focus", re(":focus-visible", ["data-focus-visible"])]];
  const walk = (list: CSSRuleList, parent: string, layer: string) => {
    for (const rule of list) {
      if (out.plain.length > 40000) return;
      const kind = rule.constructor.name;
      if (rule instanceof CSSImportRule) {
        const ln = (rule as CSSImportRule & { layerName?: string | null }).layerName;
        try { if (rule.styleSheet && (!rule.media.mediaText || matchMedia(rule.media.mediaText).matches)) walk(rule.styleSheet.cssRules, "", ln == null ? layer : enter(layer, ln || `(${anon++})`)); } catch { out.unreadable++; }
        continue;
      }
      if (kind === "CSSLayerStatementRule") { for (const n of (rule as unknown as { nameList: string[] }).nameList ?? []) enter(layer, n); continue; }
      if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText).matches) continue;
      if (rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) continue;
      if (kind === "CSSStartingStyleRule") continue;
      const within = kind === "CSSLayerBlockRule" ? enter(layer, (rule as unknown as { name: string }).name || `(${anon++})`) : layer;
      let sels: string[] | null = null;
      if (rule instanceof CSSStyleRule) sels = splitTop(rule.selectorText).map((x) => (parent ? (x.includes("&") ? x.replaceAll("&", parent) : `${parent} ${x}`) : x));
      else if (parent && kind === "CSSNestedDeclarations") sels = [parent]; // declarations after a nested rule or inside a nested @media
      const style = sels ? (rule as CSSStyleRule).style : null;
      if (sels && style?.length) {
        order++;
        for (const sel of sels) {
          const plain: PlainRule = { sel, style, layer: within, order, has: [] };
          out.plain.push(plain);
          for (const [state, r] of STATE) {
            r.lastIndex = 0;
            if (!r.test(sel)) continue;
            plain.has.push(state);
            r.lastIndex = 0;
            let base = sel.replace(r, ":where(*)");
            const pm = /::?(before|after)$/.exec(base);
            if (pm) base = base.slice(0, pm.index) || "*";
            // [data-pressed] is a pointer's press in some kits and a toggle's "on" in others: the census tells by the selector, the page and the control
            const on = state === "pressed" && !/(?<!\\):active(?![\w-])/.test(sel);
            if (!base.includes("::")) out.states.push({ state, base, pseudo: pm ? pm[1] : "", style, sel, layer: within, order, on, toggle: on && pressedIsOnIn(sel, sels) });
          }
        }
      }
      const kids = (rule as CSSGroupingRule).cssRules as CSSRuleList | undefined;
      if (kids?.length) walk(kids, rule instanceof CSSStyleRule ? (sels!.length > 1 ? `:is(${sels!.join(",")})` : sels![0]) : parent, within);
    }
  };
  for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) {
    if (sheet.disabled) continue;
    try { if (!sheet.media.mediaText || matchMedia(sheet.media.mediaText).matches) walk(sheet.cssRules, "", ""); } catch { out.unreadable++; }
  }
  return out;
}
/** A selector that ends in ::before or ::after, as the element's selector and the pseudo ("" for none, "other" for any other pseudo-element). */
const pseudoOf = (x: PlainRule): string => {
  if (x.pseudo === undefined) { const m = /::?(before|after)$/.exec(x.sel); x.base = m ? x.sel.slice(0, m.index) || "*" : x.sel; x.pseudo = m ? m[1] : x.sel.includes("::") ? "other" : ""; }
  return x.pseudo;
};
/** A declared value with its var() filled in: from the rules that hold with it (`first`: a state rule sets its own --x), then from the element's own custom properties. */
function resolveVars(v: string, el: Element, first: CSSStyleDeclaration[] = []): string {
  const cs = getComputedStyle(el);
  const get = (name: string) => { for (const s of first) { const x = s.getPropertyValue(name).trim(); if (x) return x; } return cs.getPropertyValue(name).trim(); };
  for (let i = 0; i < 6 && v.includes("var("); i++) v = v.replace(/var\((--[\w-]+)(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fb?: string) => get(name) || (fb ?? "").trim());
  return v.trim();
}

/** The census written out: one line a value, a group under its heading. */
export function censusLines(c: Census): string[] {
  const out = [c.head];
  for (const g of c.groups) {
    if (!g.rows.length) continue;
    const n = g.rows.length + (g.more ?? 0);
    out.push(`${g.name} (${n}${g.what === undefined ? " values" : g.what ? `, ${g.what}` : ""})`);
    for (const r of g.rows) out.push(`  ${rowText(r)}`);
    if (g.more) out.push(`  ... ${g.more} more`);
  }
  return out;
}
/** How many looks a part shows: the most skins inside one state, or the shapes (height and corner) across all states: a state changes colors, not size. */
const looksOf = (r: CensusRow): number => {
  if (!r.flag || !r.looks) return 1;
  const skins = new Map<string, Set<string>>();
  for (const l of r.looks) skins.set(l.state, (skins.get(l.state) ?? new Set<string>()).add(l.skin));
  return Math.max(new Set(r.looks.map((l) => l.shape)).size, ...[...skins.values()].map((s) => s.size));
};
function rowText(r: CensusRow): string {
  if (!r.looks) return `${r.key}${r.n ? ` ×${r.n}` : ""}${r.note ?? ""}${r.at.length ? `: ${r.at.join("; ")}` : ""}`;
  const multi = r.looks.length > 1, n = looksOf(r);
  const by = new Map<string, string[]>();
  for (const l of [...r.looks].sort((a, b) => b.n - a.n)) {
    const say = l.say.replace("h=content", l.lo === l.hi ? `h${l.lo} (its content's)` : `h${l.lo}-${l.hi} (its content's)`);
    by.set(l.state, [...(by.get(l.state) ?? []), `${say} ×${l.n}${multi && l.at.length ? ` (${l.at.join("; ")})` : ""}`]);
  }
  return `${r.key}${n > 1 ? ` IN ${n} LOOKS` : ""}${r.note ?? ""}: ${[...by].sort((a, b) => a[0].localeCompare(b[0])).map(([st, v]) => `${st ? `${st}: ` : ""}${v.join(" | ")}`).join(" ; ")}`;
}
/**
 * Several pages' censuses as one: a value on more than one page is said
 * once, with the pages it is on ("(all)", "(home+cart)"), its counts added
 * and a place from each page, tagged "[home]".
 */
export function mergeCensus(pages: Record<string, Census>): Census {
  const names = Object.keys(pages);
  const groups: CensusGroup[] = [];
  type Acc = { row: CensusRow; pages: string[]; at: Map<string, string[]> };
  const accs = new Map<CensusGroup, Map<string, Acc>>();
  for (const page of names) for (const g of pages[page].groups) {
    let to = groups.find((x) => x.name === g.name);
    if (!to) { to = { name: g.name, what: g.what, rows: [], more: 0 }; groups.push(to); accs.set(to, new Map()); }
    to.more = Math.max(to.more ?? 0, g.more ?? 0);
    const rows = accs.get(to)!;
    for (const r of g.rows) {
      const k = `${r.key}\n${r.note ?? ""}`;
      let a = rows.get(k);
      if (!a) { a = { row: { key: r.key, n: 0, note: r.note, at: [], looks: r.looks ? [] : undefined }, pages: [], at: new Map() }; rows.set(k, a); to.rows.push(a.row); }
      a.row.n += r.n; a.pages.push(page); a.at.set(page, r.at);
      if (r.flag) a.row.flag = true;
      for (const l of r.looks ?? []) {
        const had = a.row.looks!.find((x) => x.state === l.state && x.say === l.say), at = l.at.slice(0, 1).map((p) => `[${page}] ${p}`);
        if (!had) a.row.looks!.push({ ...l, at });
        else { had.n += l.n; had.lo = Math.min(had.lo ?? 1e9, l.lo ?? 1e9); had.hi = Math.max(had.hi ?? 0, l.hi ?? 0); if (had.at.length < 2) had.at.push(...at); }
      }
    }
  }
  for (const rows of accs.values()) for (const a of rows.values()) {
    a.row.note = `${a.row.note ?? ""} (${a.pages.length === names.length && names.length > 1 ? "all" : a.pages.join("+")})`;
    // a place from each page in turn, three in all
    const said = new Set<string>();
    for (let i = 0; i < 3; i++) for (const p of a.pages) { const x = a.at.get(p)?.[i]; if (x && a.row.at.length < 3 && !said.has(x)) { said.add(x); a.row.at.push(`[${p}] ${x}`); } }
  }
  for (const g of groups) if (g.name !== "layout problems") g.rows.sort((a, b) => looksOf(b) - looksOf(a) || b.n - a.n);
  return { head: `${pages[names[0]]?.head ?? "styles on screen"}; pages: ${names.join(", ")}`, groups: groups.map((g) => ({ ...g, more: g.more || undefined })) };
}
/** How many rows each group may show when they don't all fit: small groups whole, the rest an even share. */
const shares = (sizes: number[], budget: number): number[] => {
  const out = sizes.map(() => 0);
  let left = budget, n = sizes.length;
  for (const i of sizes.map((_, j) => j).sort((a, b) => sizes[a] - sizes[b])) { out[i] = Math.min(sizes[i], Math.floor(left / n)); left -= out[i]; n--; }
  return out;
};

/**
 * Every style the screen uses, counted, for a reader checking a design
 * system without seeing it: font stacks, text styles ("type 14/500/20 ×38"),
 * text, fill and line colors, corner radii, shadows, fields, control
 * heights, the hover, pressed and focus colors the page's rules give each
 * control, what a part's use site changed ("set where used"), pop-up layers,
 * and each part with its looks by state. Each value names up to 3 places
 * (role and the app's own words, the part that drew it, where, its box).
 * Values nearly the same as a more used one are marked "near"; with rules,
 * a value off them says OFF and names the nearest. Loading placeholders,
 * controls under the pointer or focused when read (they wear a state),
 * things caught mid-animation and what no component drew are counted apart.
 * Then what the layout check finds. Only on request (a design check), never
 * in a feedback bundle by default: it adds one hidden element to the page
 * while it reads and takes it out again.
 */
export function styleLines(rules: StyleRules = {}, root: Element = document.body, cap = 220): string[] { return censusLines(styleData(rules, root, cap)); }
/** styleLines as data (see Census). */
export function styleData(rules: StyleRules = {}, root: Element = document.body, cap = 220): Census {
  // everything this read adds to the page goes in one hidden element: one append, one remove
  const host = document.createElement("div");
  host.setAttribute("data-census-private", "");
  host.style.display = "none";
  document.body.append(host);
  colorProbe(host);
  try { return census(rules, root, cap, host); } finally { colorProbe(null); host.remove(); }
}

/** How many lines an element's words take. */
const textLines = (el: Element): number => {
  const tops: number[] = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), range = document.createRange();
  for (let n = walk.nextNode(), i = 0; n && i < 200; n = walk.nextNode(), i++) {
    if (!n.nodeValue?.trim()) continue;
    range.selectNodeContents(n);
    for (const b of range.getClientRects()) if (b.width > 0 && !tops.some((t) => Math.abs(t - b.top) < b.height / 2)) tops.push(b.top);
  }
  return tops.length;
};
const CONTROL = "button,[role=button],[role=tab],[role=radio],[role=checkbox],[role=switch],[role=option],[role=menuitem],input,select,textarea,a[href]";
const NATIVE = "a[href],button,input,select,textarea";
const LAYER = /^(dialog|alertdialog|menu|listbox|tooltip)$/;
// what a class or style given at a part's use site may change about its look (not where it sits: width, margin, flex)
const LOOK = ["height", "min-height", "border-top-left-radius", "background-color", "color", "font-size", "font-weight", "line-height", "letter-spacing", "font-family", "box-shadow", "border-top-color"];
const STYLE_KEYS: Record<string, string> = { height: "height", minHeight: "min-height", borderRadius: "border-top-left-radius", background: "background-color", backgroundColor: "background-color", color: "color", fontSize: "font-size", fontWeight: "font-weight", lineHeight: "line-height", letterSpacing: "letter-spacing", fontFamily: "font-family", boxShadow: "box-shadow", borderColor: "border-top-color" };

function census(rules: StyleRules, root: Element, cap: number, host: HTMLElement): Census {
  type Seen = { n: number; at: string[]; el: Element; els?: Element[]; parts?: Set<string> };
  const G = () => new Map<string, Seen>();
  const groups = { font: G(), type: G(), text: G(), fill: G(), line: G(), radius: G(), shadow: G(), field: G(), height: G(), states: G(), used: G(), layer: G() };
  const infos = new Map<Element, PartInfo | null>();
  const part = (el: Element) => { let p = infos.get(el); if (p === undefined) { p = partInfo(el, rules.parts); infos.set(el, p); } return p; };
  // with rules.sources: " @ file:line" where the part that drew a place was used
  const srcs = new Map<Fiber, string>();
  const srcOf = (p: PartInfo | null | undefined): string => {
    if (!rules.sources || !p) return "";
    let s = p.src ?? "";
    if (!s && p.fiber) { s = srcs.get(p.fiber) ?? fiberSrc(p.fiber); srcs.set(p.fiber, s); }
    return s ? ` @ ${s}` : "";
  };
  // a place no part drew: where its own element was written (React's dev build, Svelte's)
  const hostSrc = (el: Element): string => {
    if (!rules.sources) return "";
    const loc = obj(obj((el as unknown as Bag).__svelte_meta)?.loc);
    const s = fiberSrc(fiberOf(el)) || (loc && typeof loc.file === "string" ? `${loc.file}:${loc.line ?? 0}` : "");
    return s ? ` @ ${s}` : "";
  };
  // a native control inside a listed part's root (a Field that draws a div around its input): the part drew it. With React's
  // dev build the control says who made it; without, the wrapper must hold this one control (a button put in a Card is not the Card's)
  const owners = new Map<Element, PartInfo | null>();
  const ownerOf = (el: Element): PartInfo | null => {
    let o = owners.get(el);
    if (o !== undefined) return o;
    o = null;
    const makers = new Set<string>(), f = fiberOf(el);
    let told = false;
    if (f && "_debugOwner" in f) { told = true; for (let m = f._debugOwner as { type?: unknown; name?: string; _debugOwner?: unknown; owner?: unknown } | null, i = 0; m && i < 12; m = (m._debugOwner ?? m.owner ?? null) as typeof m, i++) makers.add(compName(m.type) || m.name || ""); }
    for (let a = el.parentElement, i = 0; a && a !== document.body && i < 4; a = a.parentElement, i++) {
      if (a.matches(CONTROL)) break;
      const lone = told || a.querySelectorAll(CONTROL).length === 1, ap = part(a);
      if (ap?.listed && lone && (!told || !ap.fiber || makers.has(compName(ap.fiber.type)))) { o = ap; break; }
      if (!lone) break;
    }
    owners.set(el, o);
    return o;
  };
  const inPart = (el: Element, p: PartInfo | null) => (rules.parts?.length && !p?.listed && el.matches(NATIVE) ? ownerOf(el) : null);
  // a native control that none of the listed parts drew
  const stray = (el: Element, p: PartInfo | null) => !!rules.parts?.length && !p?.listed && el.matches(NATIVE) && !ownerOf(el);
  const where = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const t = p.tagName.toLowerCase(), role = p.getAttribute("role");
      if (/^(header|footer|nav|aside)$/.test(t)) return ` in ${t}`;
      if (role && /^(dialog|alertdialog|menu|listbox|tooltip|toolbar)$/.test(role)) return ` in ${role}`;
    }
    return inside(el);
  };
  const place = (el: Element, r: DOMRect, name: Element = el) => {
    const p = part(name), st = stateOf(name), no = stray(name, p), own = no ? null : inPart(name, p), tail = no ? "no DS part" : own ? `inside ${own.say}` : "";
    return `${nameOf(name)}${st ? ` (${st})` : ""}${p ? ` [${p.say}${tail ? `, ${tail}` : ""}]` : tail ? ` [${tail}]` : ""}${where(el)} ${box(r)}`;
  };
  const add = (g: Map<string, Seen>, k: string, el: Element, r: DOMRect, name: Element = el) => {
    let s = g.get(k);
    if (!s) g.set(k, (s = { n: 0, at: [], el: name, els: [] }));
    s.n++;
    if (s.at.length < 3) { s.at.push(place(el, r, name)); s.els?.push(name); }
    return s;
  };
  // each part and variant: the looks it shows, by state; one part in two looks was changed where it's used
  const looks = new Map<string, { flag: boolean; m: Map<string, CensusLook> }>();
  const seenLooks: { key: string; flag: boolean; st: string; shape: string; skin: string; say: string; h: number; hug: boolean; at: string; fiber: Fiber | null }[] = [];
  const colorOf = (css: string) => { const c = parseColor(css); return c && c[3] >= 0.02 ? hex(c) : null; };
  const px = (v: string) => Math.round(parseFloat(v) * 10) / 10;
  const lineOf = (cs: CSSStyleDeclaration) => {
    for (const side of ["top", "right", "bottom", "left"]) {
      const w = parseFloat(cs.getPropertyValue(`border-${side}-width`));
      const c = w > 0 && cs.getPropertyValue(`border-${side}-style`) !== "none" ? colorOf(cs.getPropertyValue(`border-${side}-color`)) : null;
      if (c) return `${c} ${num(w)}px`;
    }
    return "";
  };
  // "full" only when the rule says so (999 px or more, or half the box), else what is declared; four numbers when the corners differ
  const cornerOf = (cs: CSSStyleDeclaration) => {
    const one = (v: string) => { const n = parseFloat(v) || 0; return (v.includes("%") ? n >= 50 : n >= 999) ? "full" : num(n); };
    const c = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(one);
    return c.every((x) => x === c[0]) ? c[0] : c.join(" ");
  };
  const sayCorner = (c: string) => c.split(" ").map((x) => (x === "full" || x === "0" ? x : `${x}px`)).join(" ");
  const seeing = looking();
  let skipped: string[] = [];
  try { if (rules.ignore) skipped = [rules.ignore]; root.querySelector(rules.ignore || "*"); } catch { skipped = []; }
  const out = new Set<Element>(root.querySelectorAll(["[data-census-private]", ...skipped].join(",")));
  // drawn by something that isn't the app's own components (a dev tool, an embedded widget): a control with no component, on a page that has them
  let react = rules.foreign !== false && [...document.body.children].some((c) => fiberOf(c) || [...c.children].some(fiberOf));
  // a page that is only partly React (static markup around a root): when controls with no component aren't a small minority, they are the page's own
  if (react) { const cs = [...document.querySelectorAll("button,[role=button],input,a[href]")].filter((c) => !c.closest("[data-census-private]")); if (cs.filter((c) => !fiberOf(c)).length * 3 > cs.length) react = false; }
  const foreign = new Map<Element, boolean>(), embedded = new Map<Element, number>(), roots = new Map<Element, boolean>();
  const isRoot = (el: Element) => { let r = roots.get(el); if (r === undefined) { r = Object.keys(el).some((k) => k.startsWith("__reactContainer$")); roots.set(el, r); } return r; };
  // judged by the subtree: the topmost element with no component above it, when it has controls with none; not what the app wrote as
  // markup (innerHTML), not a React root or a box around one, and not a block of the page's own flow straight under the body
  const foreignTop = (el: Element): Element | null => {
    let top = el;
    while (top.parentElement && top.parentElement !== document.body && !fiberOf(top.parentElement) && !isRoot(top.parentElement)) top = top.parentElement;
    let f = foreign.get(top);
    if (f === undefined) {
      const par = top.parentElement, pf = par ? fiberOf(par) : null;
      f = false;
      if (!pf?.memoizedProps?.dangerouslySetInnerHTML && !isRoot(top) && ![...top.querySelectorAll("*")].some((c) => fiberOf(c) || isRoot(c))) {
        const tr = top.getBoundingClientRect(), flow = par === document.body && /^(static|relative)$/.test(getComputedStyle(top).position) && tr.width > 0 && tr.height > 0;
        f = !flow && (top.matches("button,[role=button],input,a[href]") ? [top] : [...top.querySelectorAll("button,[role=button],input,a[href]")]).some((c) => !fiberOf(c));
      }
      foreign.set(top, f);
    }
    return f ? top : null;
  };
  // rules first: what is under the pointer, pressed or focused right now wears a state's colors, not its own
  const sheets = readSheets();
  // in this kit [data-pressed] is "on" when something wears it with no pointer down
  const pressedIsOn = !!document.querySelector("[data-pressed]:not(:active)");
  const saysOn = (el: Element) => el.hasAttribute("aria-pressed") || el.hasAttribute("aria-checked") || el.hasAttribute("aria-selected");
  const lit = new Set<Element>(), litText = new Set<Element>(), litBy = new Map<string, Element[]>();
  for (const st of sheets.states) {
    if (st.pseudo || (st.on && (st.toggle || pressedIsOn))) continue;
    const tint = !!st.style.getPropertyValue("color");
    if (!tint && !["background-color", "background", "border-color", "box-shadow", "opacity"].some((k) => st.style.getPropertyValue(k))) continue;
    let els = litBy.get(st.sel);
    if (!els) { try { els = [...document.querySelectorAll(st.sel)]; } catch { els = []; } litBy.set(st.sel, els); }
    for (const e of els) { if (st.on && saysOn(e)) continue; lit.add(e); if (tint) litText.add(e); }
  }
  // whether a rule (or the style attribute) gives an element its height
  const sizing = new Map<Element, boolean>(), sizers = new Map<string, PlainRule[]>();
  const sized = (el: Element): boolean => {
    let v = sizing.get(el);
    if (v !== undefined) return v;
    const real = (x: string) => !!x && !/^(auto|0(px)?|fit-content|min-content|max-content|inherit|initial|unset|revert|revert-layer)$/.test(x.trim());
    v = ["height", "min-height", "block-size", "min-block-size", "aspect-ratio"].some((k) => {
      const own = (el as HTMLElement).style?.getPropertyValue(k) ?? "";
      if (own) return real(own);
      let list = sizers.get(k), top: PlainRule | null = null;
      if (!list) sizers.set(k, (list = sheets.plain.filter((x) => x.style.getPropertyValue(k))));
      const imp = (x: PlainRule) => x.style.getPropertyPriority(k) === "important";
      // the rule the cascade takes: a later height:auto undoes a height
      for (const x of list) { try { if ((!top || sheets.beats(x, imp(x), top, imp(top))) && el.matches(x.sel)) top = x; } catch { /* a selector this browser can't match */ } }
      return !!top && real(top.style.getPropertyValue(k));
    });
    sizing.set(el, v);
    return v;
  };
  const placeholders = new Map<string, number>(), icons = new Map<Element, Set<string>>(), tracking = new Map<number, Map<number, Seen>>();
  let moving = 0, hot = 0, warm: Element | null = null;
  const controls: { el: Element; r: DOMRect }[] = [];
  const uses: { el: Element; r: DOMRect; key: string; cls: string[]; style: string[]; ctl: boolean }[] = [];
  const all = [root, ...root.querySelectorAll("*")];
  let skip: Element | null = root.closest("[data-census-private]") ? root : null;
  for (const el of all) {
    if (skip) { if (skip.contains(el)) continue; skip = null; }
    if (out.has(el)) { skip = el; continue; }
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    if (react && !fiberOf(el)) { const top = foreignTop(el); if (top) { embedded.set(top, (embedded.get(top) ?? 0) + 1); continue; } }
    const r = el.getBoundingClientRect();
    if (!shown(el, r)) continue;
    const cs = getComputedStyle(el);
    if (el instanceof SVGElement) {
      // an icon's colors, once per drawing: every shape that has a fill or a stroke of its own
      if (/^(path|rect|circle|ellipse|line|polyline|polygon|use)$/.test(el.tagName)) {
        const svg = el.closest("svg") ?? el;
        const had = icons.get(svg) ?? new Set<string>();
        icons.set(svg, had);
        for (const v of [cs.fill, cs.stroke]) { const c = v && v !== "none" ? colorOf(v) : null; if (c && !had.has(c)) { had.add(c); add(groups.text, `${c} (icon)`, svg, svg.getBoundingClientRect()); } }
      }
      continue;
    }
    // text inside something whose state colors its words (a hovered button's label) isn't in its resting color
    if (warm && !warm.contains(el)) warm = null;
    if (!warm && litText.has(el)) warm = el;
    const own = ownText(el);
    // a loading placeholder: an empty box that animates forever
    if (!own && !el.children.length && cs.animationName !== "none" && /infinite/.test(cs.animationIterationCount)) {
      const f = colorOf(cs.backgroundColor) ?? "none";
      placeholders.set(f, (placeholders.get(f) ?? 0) + 1);
      continue;
    }
    // a 1 px box is words for screen readers only
    if (own && r.width > 2 && r.height > 2) {
      const lh = cs.lineHeight === "normal" ? "normal" : String(px(cs.lineHeight)), ls = parseFloat(cs.letterSpacing) ? px(cs.letterSpacing) : 0;
      add(groups.type, `${px(cs.fontSize)}/${cs.fontWeight}/${lh}${ls ? ` ${ls}ls` : ""}`, el, r);
      add(groups.font, cs.fontFamily.replace(/["']/g, "").replace(/\s*,\s*/g, ", "), el, r);
      const t = colorOf(cs.color);
      if (t && !warm) add(groups.text, t, el, r);
      const per = tracking.get(px(cs.fontSize)) ?? new Map<number, Seen>();
      tracking.set(px(cs.fontSize), per);
      const had = per.get(ls);
      if (had) had.n++; else per.set(ls, { n: 1, at: [place(el, r)], el });
    }
    const big = r.width >= 4 && r.height >= 4;
    // a color on its way somewhere (a flash, a fade) is not a value of the page
    let bg = colorOf(cs.backgroundColor), line = lineOf(cs), corner = cornerOf(cs);
    const ctl = big && el.matches(CONTROL);
    const still = !(bg || ctl) || !el.getAnimations?.().some((a) => a.playState === "running");
    if (!still) { moving++; bg = null; }
    // so is one under the pointer, pressed or focused when read, where a rule of the page colors that state
    const live = lit.has(el);
    if (live) { if (bg || line || ctl) hot++; bg = null; line = ""; }
    if (bg && big) add(groups.fill, bg, el, r);
    if (line) add(groups.line, line, el, r);
    const sh = !live && cs.boxShadow && cs.boxShadow !== "none" ? shadowLayers(cs.boxShadow) : null;
    // a ring (a shadow with no offset or blur) is a line
    for (const ring of sh?.rings ?? []) add(groups.line, ring, el, r);
    if (corner !== "0" && (bg || line)) add(groups.radius, sayCorner(corner), el, r);
    if (sh?.rest.length) add(groups.shadow, sh.rest.join(", "), el, r);
    const role = el.getAttribute("role");
    if ((role && LAYER.test(role)) || (el === root && root !== document.body)) {
      // a pop-up's own box: the element with the role, else the filled box around it
      let lb = bg, ll = line, lc = corner, ls = sh;
      // (a bare list inside a dialog is the dialog's, not a layer of its own)
      const inner = !lb && !ls?.rest.length && !!el.parentElement?.closest("[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[role=tooltip]");
      for (let p = el.parentElement, i = 0; !inner && !lb && !ls?.rest.length && p && i < 4; p = p.parentElement, i++) {
        const pcs = getComputedStyle(p), pb = colorOf(pcs.backgroundColor), ps = shadowLayers(pcs.boxShadow);
        if (pb || ps.rest.length) { lb = pb; ll = lineOf(pcs); lc = cornerOf(pcs); ls = ps; }
      }
      if (!inner) add(groups.layer, `${role ?? "layer"} corner ${sayCorner(lc)} fill ${lb ?? "none"}${ll ? ` line ${ll}` : ""} shadow ${ls?.rest.length ? ls.rest.join(", ") : "none"}`, el, r);
    }
    const p = part(el);
    let boxR = r, hug = false;
    if (ctl) {
      // a text field with no box of its own sits in one: the nearest filled or lined wrapper, when it is about the field's size
      if (!live && ((el instanceof HTMLInputElement && /^(text|search|email|number|password|tel|url)$/.test(el.type)) || el instanceof HTMLTextAreaElement)) {
        for (let w = el.parentElement, i = 0; !bg && !line && w && i < 6; w = w.parentElement, i++) {
          const wr = w.getBoundingClientRect();
          if (wr.height > r.height * 3 + 8) break;
          const wcs = getComputedStyle(w), wb = colorOf(wcs.backgroundColor), wl = lineOf(wcs);
          if (wb || wl) { bg = wb; line = wl; corner = cornerOf(wcs); boxR = wr; }
        }
        add(groups.field, `${Math.round(boxR.height)}px corner ${sayCorner(corner)} fill ${bg ?? "none"}${line ? ` line ${line}` : ""}`, el, boxR);
      }
      // a bare control (no fill, line or padding) as tall as what's in it has no height of its own
      const inner = Math.max(0, ...[...el.children].map((c) => c.getBoundingClientRect().height), own && cs.lineHeight !== "normal" ? parseFloat(cs.lineHeight) : 0);
      hug = !bg && !line && !parseFloat(cs.paddingTop) && !parseFloat(cs.paddingBottom) && inner >= r.height - 1;
      const kind = role ?? (el.tagName === "INPUT" ? `input ${(el as HTMLInputElement).type}` : el.tagName.toLowerCase());
      if (!hug) { const s = add(groups.height, `${kind} ${Math.round(boxR.height)}px${boxR === r ? "" : " (field box)"}`, el, boxR); if (p) (s.parts ??= new Set()).add(p.key); }
      controls.push({ el, r: boxR });
    }
    const no = stray(el, p), within = no ? null : inPart(el, p);
    if (big && (p || no || within) && (bg || ctl)) {
      if (still && !live) {
        const st = stateOf(el), tc = ctl ? colorOf(cs.color) : null, op = seeing.opacity(el);
        let h = Math.round(boxR.height);
        // a height nothing set that is a whole number of text lines is the content's: words that wrapped, a textarea's rows. One line of it is the look
        if (ctl && !hug && boxR === r) {
          const lh = parseFloat(cs.lineHeight), inner = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth), n = lh > 0 ? Math.round(inner / lh) : 0;
          if (n >= 2 && Math.abs(inner - n * lh) <= 1 && (el instanceof HTMLTextAreaElement || textLines(el) === n) && !sized(el)) h = Math.round(r.height - (n - 1) * lh);
        }
        const shape = `${ctl ? (hug ? "h=content " : `h${h} `) : ""}r${corner.replaceAll(" ", "/")}`;
        const skin = `${shape} fill ${bg ?? "none"}${op < 0.995 ? ` at ${Math.round(op * 100)}%` : ""}`, say = `${skin}${tc ? ` text ${tc}` : ""}`;
        const key = no ? `${p?.key ?? el.tagName.toLowerCase()} (no DS part)` : within ? `${within.key} ${el.tagName.toLowerCase()}` : p!.key;
        seenLooks.push({ key, flag: no ? false : within ? within.cand : p!.cand, st, shape, skin, say, h, hug, at: `${nameOf(el)}${where(el)} ${box(boxR)}${srcOf(within ?? p)}`, fiber: (within ?? p)?.fiber ?? null });
      }
    }
    // what its use site passed the part: classes and an inline style
    const props = p?.own && big ? p.fiber?.memoizedProps : null;
    if (props && uses.length < 600) {
      const cls = typeof props.className === "string" ? props.className.split(/\s+/).filter(Boolean).slice(0, 40) : [];
      const style = props.style && typeof props.style === "object" ? Object.keys(props.style).flatMap((k) => (STYLE_KEYS[k] ? [STYLE_KEYS[k]] : [])) : [];
      if (cls.length || style.length) uses.push({ el, r, key: p!.key, cls, style, ctl });
    }
  }

  // a part in more than one look whose uses differ in a prop that picks a look in some kits (color, status): those are variants too
  const perKey = new Map<string, typeof seenLooks>();
  for (const x of seenLooks) perKey.set(x.key, [...(perKey.get(x.key) ?? []), x]);
  for (const [key, list] of perKey) {
    // (only where it would read as two looks: two skins in one state, or two shapes)
    if (!list[0].flag || (new Set(list.map((x) => x.shape)).size < 2 && new Set(list.map((x) => `${x.st}|${x.skin}`)).size === new Set(list.map((x) => x.st)).size)) continue;
    const more = list.map((x) => (x.fiber ? propsOf(x.fiber, MORE_PROPS) : ""));
    if (new Set(more).size > 1) list.forEach((x, i) => { if (more[i]) x.key = `${key} ${more[i]}`; });
  }
  for (const x of seenLooks) {
    const of = looks.get(x.key) ?? { flag: x.flag, m: new Map<string, CensusLook>() };
    looks.set(x.key, of);
    let l = of.m.get(`${x.st}|${x.say}`);
    if (!l) of.m.set(`${x.st}|${x.say}`, (l = { state: x.st, shape: x.shape, skin: x.skin, say: x.say, n: 0, at: [] }));
    l.n++;
    if (x.hug) { l.lo = Math.min(l.lo ?? 1e9, x.h); l.hi = Math.max(l.hi ?? 0, x.h); }
    if (l.at.length < 2) l.at.push(x.at);
  }

  // what the rules allow, and the nearest allowed value
  const ruleColors = Object.entries(rules.colors ?? {}).map(([k, v]) => [k, parseColor(v)] as const).filter((x): x is readonly [string, RGBA] => !!x[1]);
  const dist = (a: RGBA, b: RGBA) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], (a[3] - b[3]) * 255);
  const tokens = new Map<string, { name?: string; off?: string }>();
  const tokenOf = (h: string) => {
    let t = tokens.get(h);
    if (t) return t;
    t = {};
    const c = ruleColors.length ? parseColor(h) : null;
    if (c) {
      let best = ruleColors[0], d = Infinity;
      for (const x of ruleColors) { const e = dist(c, x[1]); if (e < d) { d = e; best = x; } }
      // a token at another opacity (a modifier, bg-green-300/20) is the token
      const solid = d <= 2 || c[3] >= 0.995 ? undefined : ruleColors.find((x) => x[1][3] >= 0.995 && Math.hypot(c[0] - x[1][0], c[1] - x[1][1], c[2] - x[1][2]) <= 3);
      t = d <= 2 ? { name: best[0] } : solid ? { name: `${solid[0]}/${Math.round(c[3] * 100)}` } : { off: ` OFF (nearest ${best[0]}, ${Math.round(d)} away)` };
    }
    tokens.set(h, t);
    return t;
  };
  // colors by their token's name; only one off the system keeps its hex (a shadow's color, after its lengths, stays as it is)
  const sayColors = (s: string) => s.replace(/(?<![\dx] )#[0-9a-f]{6,8}\b/g, (h) => { const t = tokenOf(h); return t.name ?? `${h}${t.off ?? ""}`; });
  const shadowNames = Object.entries(rules.shadows ?? {}).map(([k, v]) => [k, shadowLayers(v).rest.join(", ")] as const);
  const sayShadow = (k: string) => (!shadowNames.length || k === "none" ? k : shadowNames.find((x) => x[1] === k)?.[0] ?? `${k} OFF`);

  // what each control turns into hovered, pressed or focused, from the page's own rules: one query a selector,
  // the rule the cascade takes wins, and a value the control already has at rest, or can never show, isn't said
  // closed: what the page holds as elements it hasn't drawn yet (React keeps a closed pop-up's content in props until it opens)
  const shut = new Map<string, { name: string; props: string; cls: string; n: number; el?: HTMLElement }>();
  let cut = false;
  if (rules.closed) {
    let top = all.map(fiberOf).find(Boolean) ?? null;
    while (top?.return) top = top.return;
    const mounted = new Set<unknown>(), fibers: Fiber[] = [], stack = top ? [top] : [];
    // a wrapper that clones its child (asChild, render) draws it with new props: the same component with the same variant and all of its classes is that child, on screen
    const worn = new Map<unknown, { props: string; cls: Set<string> }[]>();
    while (stack.length && fibers.length < 60000) {
      const f = stack.pop()!;
      fibers.push(f); mounted.add(f.memoizedProps);
      if (f.alternate?.memoizedProps) mounted.add(f.alternate.memoizedProps);
      const cn = typeof f.type === "string" ? null : f.memoizedProps?.className;
      if (typeof cn === "string" && cn) for (const t of new Set([f.type, f.elementType ?? f.type])) { const l = worn.get(t) ?? []; if (l.length < 400) l.push({ props: propsOf(f), cls: new Set(cn.split(/\s+/)) }); worn.set(t, l); }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    if (stack.length) cut = true;
    const seen = new Set<unknown>();
    // the budget is for elements: data passed down as props (a table's rows) is not walked
    let budget = 30000;
    const scan = (v: unknown, depth: number) => {
      if (!v || typeof v !== "object" || depth > 12) return;
      if (Array.isArray(v)) {
        if (seen.has(v)) return;
        seen.add(v);
        // children hold elements, strings and lists of them; a list with a plain object in it is data
        for (let i = 0; i < v.length && i < 200; i++) { const x = v[i] as { $$typeof?: unknown } | null; if (x && typeof x === "object" && !Array.isArray(x) && !x.$$typeof) return; scan(x, depth + 1); }
        return;
      }
      const e = v as { $$typeof?: unknown; type?: unknown; props?: Record<string, unknown> };
      if (!e.$$typeof || !e.props || typeof e.props !== "object" || seen.has(v)) return;
      if (budget-- < 0) { cut = true; return; }
      seen.add(v);
      const name = compName(e.type);
      if (!mounted.has(e.props) && typeof e.props.className === "string" && e.props.className && PLAIN.test(name) && !PLUMBING.test(name)) {
        const props = propsOf({ type: e.type, return: null, memoizedProps: e.props }), k = `${name} ${props}\n${e.props.className}`, had = shut.get(k), cls = e.props.className.split(/\s+/).filter(Boolean);
        if (had) had.n++;
        else if (worn.get(e.type)?.some((w) => w.props === props && cls.every((t) => w.cls.has(t)))) { /* drawn through a clone */ }
        else if (shut.size < 300) shut.set(k, { name, props, cls: e.props.className, n: 1 });
        else cut = true;
      }
      for (const k of Object.keys(e.props)) scan(e.props[k], depth + 1);
    };
    for (const f of fibers) { const p = f.memoizedProps; if (p && typeof p === "object") for (const k of Object.keys(p)) scan(p[k], 0); }
    for (const x of shut.values()) { x.el = document.createElement("div"); x.el.className = x.cls; host.append(x.el); }
  }
  const ghosts = new Map<string, { el: HTMLElement; sets: Map<string, string> }>();
  for (const cls of [...uses.map((u) => u.cls), ...[...shut.values()].filter((x) => x.props).map((x) => x.cls.split(/\s+/).filter(Boolean))]) for (const t of cls) if (!ghosts.has(t) && ghosts.size < 500) { const g = document.createElement("div"); g.className = t; host.append(g); ghosts.set(t, { el: g, sets: new Map() }); }
  const targets = new Set<Element>([...controls.map((c) => c.el), ...uses.map((u) => u.el), ...[...ghosts.values()].map((g) => g.el)]);
  const matched = new Map<Element, StateRule[]>(), found = new Map<string, Element[]>();
  for (const st of sheets.states) {
    // [data-pressed] worn as "on" is a resting state, not what a pointer does
    if (st.on && (st.toggle || pressedIsOn)) continue;
    let els = found.get(st.base);
    if (!els) { try { els = [...document.querySelectorAll(st.base)].filter((e) => targets.has(e)); } catch { els = []; } found.set(st.base, els); }
    for (const el of els) { const l = matched.get(el); if (l) l.push(st); else matched.set(el, [st]); }
  }
  const stateSaid = new Map<Element, string[]>();
  // the plain rules that declare a property, to see whether a state's rule gets past them
  const setters = new Map<string, PlainRule[]>();
  const settersOf = (prop: string) => { let l = setters.get(prop); if (!l) setters.set(prop, (l = sheets.plain.filter((x) => x.style.getPropertyValue(prop)))); return l; };
  const statesOf = (el: Element): string[] => {
    let said = stateSaid.get(el);
    if (said) return said;
    said = [];
    const win = new Map<string, { raw: string; imp: boolean; st: StateRule; prop: string }>();
    // a control that says whether it is on (aria-pressed, -checked, -selected) wears data-pressed as that state, not under a pointer
    const toggles = saysOn(el), mine = matched.get(el) ?? [];
    for (const st of mine) for (const [prop, word] of [["background-color", "fill"], ["color", "text"], ["border-color", "line"]] as const) {
      const raw = st.on && toggles ? "" : st.style.getPropertyValue(prop);
      if (!raw) continue;
      const k = `${st.state}${st.pseudo ? " overlay" : ""} ${word}`, imp = st.style.getPropertyPriority(prop) === "important", had = win.get(k);
      if (!had || sheets.beats(st, imp, had.st, had.imp)) win.set(k, { raw, imp, st, prop });
    }
    const ecs = win.size ? getComputedStyle(el) : null, off = el.matches(":disabled");
    for (const [k, w] of win) {
      const state = w.st.state, long = w.prop === "border-color" ? "border-top-color" : w.prop;
      // a state the control can't be in: no pointer reaches it, or it is disabled (a disabled control can still be hovered)
      if ((state !== "focus" && ecs!.pointerEvents === "none") || (state !== "hover" && off)) continue;
      // a value the state's rule can't change: the style attribute's, or one from a rule that holds at rest and that the cascade puts first
      const inline = w.st.pseudo ? "" : (el as HTMLElement).style?.getPropertyValue(long) ?? "";
      if (inline && !(w.imp && (el as HTMLElement).style.getPropertyPriority(long) !== "important")) continue;
      if (settersOf(long).some((x) => {
        if (x === (w.st as unknown) || x.has.includes(state) || pseudoOf(x) !== w.st.pseudo || !sheets.beats(x, x.style.getPropertyPriority(long) === "important", w.st, w.imp)) return false;
        try { return el.matches(x.base!); } catch { return false; }
      })) continue;
      const rest = getComputedStyle(el, w.st.pseudo ? `::${w.st.pseudo}` : undefined);
      if (w.st.pseudo && /^(none|normal)$/.test(rest.content) && !w.st.style.getPropertyValue("content")) continue; // an overlay that isn't drawn
      if (w.prop === "border-color" && !(parseFloat(rest.borderTopWidth) > 0)) continue;
      // its var() from the state's own rules first (the winner, then the others of that state), and currentColor as the state's text color
      const same = [w.st.style, ...mine.filter((x) => x !== w.st && x.state === state && x.pseudo === w.st.pseudo).reverse().map((x) => x.style)];
      let value = resolveVars(w.raw, el, same);
      if (w.prop !== "color" && /currentcolor/i.test(value)) {
        const tw = win.get(`${state}${w.st.pseudo ? " overlay" : ""} text`) ?? win.get(`${state} text`);
        const text = tw ? resolveVars(tw.raw, el, [tw.st.style]) : "";
        value = value.replace(/currentcolor/gi, text && !/currentcolor|inherit/i.test(text) ? text : rest.color);
      }
      const c = colorOf(value);
      if (c && c !== colorOf(rest.getPropertyValue(long))) said.push(`${k} ${c}`);
    }
    stateSaid.set(el, said);
    return said;
  };
  for (const c of controls) for (const s of statesOf(c.el)) add(groups.states, s, c.el, c.r);

  // set where used: a bare element with one class of the use site, next to one with none, says what the class changes;
  // it counts when the part's element shows the same value (the part passed it on)
  const closed: CensusRow[] = [];
  if (uses.length || shut.size) {
    const bare = host.appendChild(document.createElement("div")), bcs = getComputedStyle(bare);
    const base = new Map(LOOK.map((k) => [k, bcs.getPropertyValue(k)]));
    for (const g of ghosts.values()) { const gcs = getComputedStyle(g.el); for (const k of LOOK) { const v = gcs.getPropertyValue(k); if (v !== base.get(k)) g.sets.set(k, v); } }
    for (const u of uses) {
      const cs = getComputedStyle(u.el), set = new Set(u.style), hover = new Set<string>();
      for (const t of u.cls) { const g = ghosts.get(t); if (!g) continue; for (const [k, v] of g.sets) if (cs.getPropertyValue(k) === v) set.add(k); for (const s of statesOf(g.el)) hover.add(s); }
      const items: string[] = [];
      for (const k of LOOK) {
        if (!set.has(k)) continue;
        const v = cs.getPropertyValue(k), c = /color$/.test(k) ? colorOf(v) : null;
        // a height is a look only on a control: a box takes whatever size its place gives it
        if (k === "height" || k === "min-height") { if (u.ctl) items.push(`${k === "height" ? "height" : "min height"} ${num(parseFloat(v))}px`); }
        else if (k === "border-top-left-radius") items.push(`corner ${sayCorner(cornerOf(cs))}`);
        else if (k === "background-color") items.push(`fill ${c ?? "none"}`);
        else if (k === "color") { if (c) items.push(`text ${c}`); }
        else if (k === "border-top-color") { if (c && parseFloat(cs.borderTopWidth) > 0 && c !== colorOf(cs.color)) items.push(`line ${c}`); }
        else if (k === "font-size" || k === "line-height") items.push(`${k === "font-size" ? "size" : "line height"} ${num(parseFloat(v))}px`);
        else if (k === "font-weight") items.push(`weight ${v}`);
        else if (k === "letter-spacing") items.push(`tracking ${num(parseFloat(v) || 0)}px`);
        else if (k === "font-family") items.push(`font ${v.replace(/["']/g, "").split(",")[0]}…`);
        else if (k === "box-shadow") { const s = shadowLayers(v); items.push(`shadow ${s.rest.length ? sayShadow(s.rest.join(", ")) : s.rings.length ? s.rings.join(", ") : "none"}`); }
      }
      const mine = statesOf(u.el);
      items.push(...[...hover].filter((s) => mine.includes(s)));
      // a text color alone is how text is meant to be colored; with a hover color of its own it is a restyled control
      if (!items.length || items.every((i) => i.startsWith("text "))) continue;
      add(groups.used, `${u.key}: ${items.join("; ")}`, u.el, u.r);
    }
    // a closed pop-up's box (an element whose classes fill it), and a part inside one with what its use site sets; no type or text color: those come from where it opens
    const rows = new Map<string, number>();
    for (const x of shut.values()) {
      const cs = getComputedStyle(x.el!), fill = colorOf(cs.backgroundColor), sh = shadowLayers(cs.boxShadow), line = lineOf(cs), say = x.props ? `${x.name} ${x.props}` : x.name;
      let row = "";
      if (fill && (sh.rest.length || cornerOf(cs) !== "0" || line)) row = `${say}: corner ${sayCorner(cornerOf(cs))} fill ${fill}${line ? ` line ${line}` : ""} shadow ${sh.rest.length ? sayShadow(sh.rest.join(", ")) : "none"}`;
      else if (x.props && (!rules.parts?.length || rules.parts.includes(x.name))) {
        const set = new Map<string, string>(), hover = new Set<string>();
        for (const t of x.cls.split(/\s+/)) { const g = ghosts.get(t); if (!g) continue; for (const [k, v] of g.sets) set.set(k, v); for (const st of statesOf(g.el)) hover.add(st); }
        const items = [set.has("height") ? `height ${num(parseFloat(set.get("height")!))}px` : "", set.has("border-top-left-radius") ? `corner ${sayCorner(cornerOf(cs))}` : "", fill ? `fill ${fill}` : "", ...hover].filter((i) => i && !/NaN/.test(i));
        if (items.length) row = `${say}: set where used: ${items.join("; ")}`;
      }
      if (row) rows.set(row, (rows.get(row) ?? 0) + x.n);
    }
    for (const [k, n] of [...rows].slice(0, 30)) closed.push({ key: sayColors(k), n, at: [] });
  }

  // which rule a value comes from, when only one rule that matches declares it (up the tree for what is inherited)
  // a rule that says inherit (every reset does) declares nothing; a shorthand holding var() hides its longhands, so it is asked too
  const SHORT: Record<string, string[]> = { "border-top-left-radius": ["border-radius"], "background-color": ["background"], "font-family": ["font"], "line-height": ["font"] };
  const PASS = /^(inherit|unset|revert|revert-layer)$/;
  const declared = (style: CSSStyleDeclaration, prop: string): string => style.getPropertyValue(prop).trim() || (SHORT[prop] ?? []).map((k) => style.getPropertyValue(k).trim()).find((v) => v.includes("var(")) || "";
  const declaring = new Map<string, PlainRule[]>();
  const whence = (el: Element, prop: string, inherited: boolean): string => {
    let list = declaring.get(prop);
    if (!list) declaring.set(prop, (list = sheets.plain.filter((x) => declared(x.style, prop))));
    for (let e: Element | null = el, i = 0; e && i < (inherited ? 16 : 1); e = e.parentElement, i++) {
      const own = (e as HTMLElement).style ? declared((e as HTMLElement).style, prop) : "";
      if (own && !PASS.test(own)) return " (from its style attribute)";
      const hits = new Map<CSSStyleDeclaration, PlainRule>(), pass: PlainRule[] = [];
      for (const x of list) { try { if (e.matches(x.sel)) { if (PASS.test(declared(x.style, prop))) pass.push(x); else hits.set(x.style, x); } } catch { /* a selector this browser can't match */ } }
      if (hits.size > 1) return "";
      for (const [style, x] of hits) {
        // (when a rule that passes the value on is the one the cascade takes, the value isn't this rule's)
        const imp = (r: PlainRule) => r.style.getPropertyPriority(prop) === "important";
        if (own || pass.some((y) => sheets.beats(y, imp(y), x, imp(x)))) break;
        const text = declared(style, prop), whole = text.match(/^var\((--[\w-]+)\)$/), vars = style.getPropertyValue(prop) ? [] : [...text.matchAll(/var\((--[\w-]+)/g)];
        const v = whole?.[1] ?? (vars.length === 1 ? vars[0][1] : "");
        return ` (from ${x.sel.length > 40 ? `${x.sel.slice(0, 39)}…` : x.sel}, ${v ? `via var(${v})` : "written out"})`;
      }
      // nothing here sets it: it is the parent's only when the parent has the same value (a link's blue is the browser's own)
      if (!inherited || !e.parentElement || getComputedStyle(e).getPropertyValue(prop) !== getComputedStyle(e.parentElement).getPropertyValue(prop)) return "";
    }
    return "";
  };

  const typeNote = (k: string) => (!rules.type?.length || rules.type.includes(k.split(" ")[0]) ? "" : " OFF");
  const radiusNote = (k: string) => {
    if (!rules.radii?.length) return "";
    const off = k.split(" ").map(parseFloat).filter((v) => v > 0 && !rules.radii!.includes(v));
    return off.length ? ` OFF (nearest ${rules.radii.reduce((a, b) => (Math.abs(b - off[0]) < Math.abs(a - off[0]) ? b : a))}px)` : "";
  };
  // near: within a small step of a more used value of the same group
  const nearOf = (g: string, k: string, list: [string, Seen][]) => {
    const me = list.find((x) => x[0] === k)!;
    for (const [o, s] of list) {
      if (o === k || s.n < me[1].n) continue;
      if (g === "text" || g === "fill" || g === "line") {
        const a = parseColor(k.split(" ")[0]), b = parseColor(o.split(" ")[0]);
        if (a && b && dist(a, b) > 0 && dist(a, b) <= 12 && k.split(" ").slice(1).join(" ") === o.split(" ").slice(1).join(" ")) return ` near ${sayColors(o.split(" ")[0])}`;
      } else if (g === "radius" && !/full| /.test(k + o) && Math.abs(parseFloat(k) - parseFloat(o)) <= 1.5) return ` near ${o}`;
      else if (g === "type") {
        const [a, b] = [k.split(/[/ ]/), o.split(/[/ ]/)];
        if (a[0] !== b[0] && Math.abs(parseFloat(a[0]) - parseFloat(b[0])) <= 1 && a[1] === b[1]) return ` near ${o.split(" ")[0]}`;
        if (a[0] === b[0] && a[1] === b[1] && a[2] !== b[2]) return ` near ${o.split(" ")[0]} (line height)`;
      } else if (g === "height") {
        const [ka, kh] = [k.replace(/ \d+px.*$/, ""), parseFloat(k.match(/(\d+)px/)![1])], [oa, oh] = [o.replace(/ \d+px.*$/, ""), parseFloat(o.match(/(\d+)px/)![1])];
        // only when the same part and variant shows both heights: other parts and sizes differ on purpose
        if (ka === oa && kh !== oh && Math.abs(kh - oh) <= 4 && [...(me[1].parts ?? [])].some((x) => s.parts?.has(x))) return ` near ${oh}px (same part)`;
      }
    }
    return "";
  };
  const WHENCE: Record<string, [string, boolean]> = { text: ["color", true], fill: ["background-color", false], radius: ["border-top-left-radius", false] };
  const made: CensusGroup[] = [];
  for (const [g, map] of Object.entries(groups)) {
    const list = [...map].sort((a, b) => b[1].n - a[1].n);
    if (!list.length) continue;
    const rows: CensusRow[] = list.map(([k, s]) => {
      let key = k, note = "";
      if (g === "font") { key = k === list[0][0] ? k : fontDiff(k, list[0][0]); note = whence(s.el, "font-family", true); }
      else if (g === "type") note = typeNote(k);
      else if (g === "radius") note = radiusNote(k);
      else if (g === "shadow") key = sayShadow(k);
      else if (g === "layer") key = `${sayColors(k.slice(0, k.indexOf(" shadow ")))} shadow ${sayShadow(k.slice(k.indexOf(" shadow ") + 8))}`;
      else if (g === "text" || g === "fill" || g === "line") {
        // a hair off a token is named by the token, unless a more used value already is: then its own hex tells them apart
        const [h, ...rest] = k.split(" "), t = tokenOf(h), near = nearOf(g, k, list);
        key = [t.name && near !== ` near ${t.name}` ? t.name : h, ...rest].join(" "); note = t.off ?? "";
      }
      else key = sayColors(k);
      note += nearOf(g, k, list);
      // where a value off the system or next to another comes from
      if (note && WHENCE[g] && !/\(icon\)/.test(k)) note += whence(s.el, ...WHENCE[g]);
      else if (g === "type" && / \(line height\)$/.test(note)) note += whence(s.el, "line-height", true);
      // where the part of a place off the system, or set where used, was used in the code
      const at = rules.sources && (g === "used" || / OFF| near /.test(`${key}${note}`)) ? s.at.map((a, i) => { const e = s.els?.[i]; return e ? `${a}${srcOf(part(e) ?? ownerOf(e)) || hostSrc(e)}` : a; }) : s.at;
      return { key, n: s.n, note: note || undefined, at };
    });
    if (g === "type") {
      // one size of text with letter-spacing both ways: a style that adds its own tracking
      for (const [size, per] of tracking) {
        const signs = [...per].sort((a, b) => b[1].n - a[1].n);
        const odd = signs.find(([ls]) => ls * signs[0][0] < 0);
        if (odd) rows.push({ key: `tracking at ${size}px: ${signs.map(([ls, s]) => `${ls > 0 ? "+" : ""}${ls} ×${s.n}`).join(", ")}`, n: 0, note: whence(odd[1].el, "letter-spacing", true) || undefined, at: odd[1].at });
      }
    }
    made.push({ name: g === "used" ? "set where used" : g, what: g === "used" ? "what a part's use site changed about its look with a class or style of its own" : g === "layer" ? "pop-ups and their boxes" : undefined, rows });
  }
  // parts: the same part and variant in more than one look first (changed where it's used)
  const partRows: CensusRow[] = [...looks].map(([key, l]) => ({ key, n: [...l.m.values()].reduce((n, x) => n + x.n, 0), at: [], flag: l.flag, looks: [...l.m.values()].map((x) => ({ ...x, skin: sayColors(x.skin), say: sayColors(x.say) })) }));
  partRows.sort((a, b) => looksOf(b) - looksOf(a) || b.n - a.n);
  if (closed.length) made.push({ name: "closed", what: "would look; not on screen: pop-ups and their contents the page holds but hasn't opened", rows: closed });
  if (partRows.length) made.push({ name: "parts", what: "by the component that drew them; looks are height (controls), corner, fill and text color, by state", rows: partRows });
  const give = shares(made.map((g) => g.rows.length), cap);
  made.forEach((g, i) => { if (g.rows.length > give[i]) { g.more = g.rows.length - give[i]; g.rows = g.rows.slice(0, give[i]); } });
  const left: CensusRow[] = [];
  if (placeholders.size) left.push({ key: "loading placeholders (empty boxes that animate forever)", n: [...placeholders.values()].reduce((a, b) => a + b, 0), at: [[...placeholders].map(([f, n]) => `fill ${sayColors(f)} ×${n}`).join(", ")] });
  if (moving) left.push({ key: "mid-animation when read (a flash or a fade: its fill and look aren't counted)", n: moving, at: [] });
  if (hot) left.push({ key: "under the pointer, pressed or focused when read (it wears that state's colors: its fill, line and look aren't counted)", n: hot, at: [] });
  if (cut) left.push({ key: "closed pop-ups: the scan stopped early, the closed list is incomplete", n: 0, at: [] });
  if (embedded.size) left.push({ key: "not the app's components (drawn by another script: a dev tool, an embedded widget)", n: [...embedded.values()].reduce((a, b) => a + b, 0), at: [...embedded.keys()].slice(0, 4).map((e) => { const b = e.matches("button,a[href]") ? e : e.querySelector("button,[role=button],a[href]") ?? e; return `${nameOf(b)} ${box(b.getBoundingClientRect())}`; }) });
  if (sheets.unreadable) left.push({ key: `${sheets.unreadable} sheets unreadable (another site's: their hover and pressed colors aren't in states)`, n: 0, at: [] });
  if (left.length) made.push({ name: "left out", what: "", rows: left });
  // what the layout check finds wrong: buttons that don't show, cut or faint words, things covered
  const gone = [...embedded.keys(), ...out];
  const problems = layoutLines(root, 160, gone.length ? (el) => gone.some((x) => x.contains(el)) : undefined).filter((l) => PROBLEM.test(l));
  if (problems.length) made.push({ name: "layout problems", what: "", rows: problems.slice(0, 30).map((l) => ({ key: l, n: 0, at: [] })), more: Math.max(0, problems.length - 30) || undefined });
  return { head: `styles on screen, window ${innerWidth}x${innerHeight}${rules.colors || rules.type || rules.radii ? ", checked against the design system's values" : ""}`, groups: made };
}
