// Bundled-code places ("http://host/chunk.js:120:33") back to the app's files ("src/ui/Header.tsx:42"),
// through the source maps the page serves. Plain source map v3, index maps (sections) included; no dependencies.

const B64 = new Map([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));

/** One line of mappings as [generated column, source, line, column] segments (absolute values). */
function decode(mappings) {
  const lines = [];
  let src = 0, line = 0, col = 0;
  for (const text of mappings.split(";")) {
    const segs = [];
    let gen = 0;
    for (const seg of text.split(",")) {
      if (!seg) continue;
      const v = [];
      for (let i = 0, shift = 0, val = 0; i < seg.length; i++) {
        const d = B64.get(seg[i]);
        val += (d & 31) << shift;
        if (d & 32) shift += 5;
        else { v.push(val & 1 ? -(val >>> 1) : val >>> 1); val = 0; shift = 0; }
      }
      gen += v[0];
      if (v.length >= 4) { src += v[1]; line += v[2]; col += v[3]; segs.push([gen, src, line, col]); }
    }
    lines.push(segs);
  }
  return lines;
}

/** Where a 1-based line and column of the generated file came from: { source, line } or null. */
function lookup(map, line, col) {
  if (map.sections) {
    let best = null;
    for (const s of map.sections) {
      const o = s.offset;
      if (o.line + 1 < line || (o.line + 1 === line && o.column <= col - 1)) best = s;
      else break;
    }
    if (!best) return null;
    const o = best.offset;
    return lookup(best.map, line - o.line, line - 1 === o.line ? col - o.column : col);
  }
  map._lines ??= decode(map.mappings ?? "");
  const segs = map._lines[line - 1];
  if (!segs?.length) return null;
  let hit = null;
  for (const s of segs) { if (s[0] <= col - 1) hit = s; else break; }
  hit ??= segs[0];
  const source = (map.sourceRoot ? map.sourceRoot.replace(/\/?$/, "/") : "") + map.sources[hit[1]];
  return { source, line: hit[2] + 1 };
}

/** A source path as the app's own: bundler prefixes off, relative to the project. */
export function cleanSource(s, root = process.cwd()) {
  let p = decodeURIComponent(s)
    .replace(/^(turbopack|webpack|webpack-internal):\/\/\/?(\[project\]\/|_N_E\/|\(app-pages-browser\)\/)?/, "")
    .replace(/^file:\/\//, "")
    .replace(/\?.*$/, "")
    .replace(/^\.\//, "");
  if (p.startsWith(root + "/")) p = p.slice(root.length + 1);
  return p;
}

/**
 * A mapper for one capture: `get(url)` fetches a file as text (through the browser context, so a signed-in
 * page's chunks come too). map("url:line:col") gives "src/x.tsx:42", or null when there is no map.
 */
export function sourceMapper(get, root) {
  const maps = new Map();
  const mapOf = async (url) => {
    if (maps.has(url)) return maps.get(url);
    let map = null;
    try {
      const js = await get(url);
      const ref = /\/[/*][#@]\s*sourceMappingURL=([^\s*]+)\s*(?:\*\/)?\s*$/.exec(js ?? "")?.[1];
      if (ref) {
        const text = ref.startsWith("data:") ? Buffer.from(ref.slice(ref.indexOf(",") + 1), /;base64,/.test(ref) ? "base64" : "utf8").toString("utf8") : await get(new URL(ref, url).href);
        map = text ? JSON.parse(text) : null;
      }
    } catch { map = null; }
    maps.set(url, map);
    return map;
  };
  return async (place) => {
    const m = /^(.*):(\d+):(\d+)$/.exec(place);
    if (!m) return null;
    const map = await mapOf(m[1]);
    const hit = map && lookup(map, +m[2], +m[3]);
    return hit ? `${cleanSource(hit.source, root)}:${hit.line}` : null;
  };
}

/**
 * The census text with its places mapped: "{frame frame frame}" (React 19's stack at the use site) becomes the
 * first frame that maps into the app's own files; a lone "url:line:col" after " @ " becomes its file and line.
 */
export async function mapSources(text, map) {
  const groups = [...new Set(text.match(/ @ \{[^{}]+\}| @ (?:https?|file):\/\/\S+:\d+:\d+/g) ?? [])];
  const said = new Map();
  for (const g of groups) {
    const frames = g.slice(3).replace(/^\{|\}$/g, "").split(" ");
    let out = null;
    for (const f of frames) {
      const s = await map(f);
      if (s && !/node_modules|^\[externals\]|^\[turbopack\]/.test(s)) { out = s; break; }
    }
    said.set(g, out ? ` @ ${out}` : "");
  }
  return text.replace(/ @ \{[^{}]+\}| @ (?:https?|file):\/\/\S+:\d+:\d+/g, (g) => said.get(g) ?? "");
}
