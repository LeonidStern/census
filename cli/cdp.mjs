// A small Chrome DevTools Protocol client for the capture: it starts Chrome (or attaches to one that runs with
// --remote-debugging-port), opens one tab of its own and drives it. No dependencies: Node's WebSocket and fetch.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome's path: --chrome or CENSUS_CHROME, else the usual places, else Playwright's Chromium when it is installed. */
export async function findChrome(given) {
  if (given) return given;
  if (process.env.CENSUS_CHROME) return process.env.CENSUS_CHROME;
  const env = process.env;
  const list = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : process.platform === "win32"
      ? [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean).flatMap((d) => [join(d, "Google/Chrome/Application/chrome.exe"), join(d, "Microsoft/Edge/Application/msedge.exe")])
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"];
  const hit = list.find((p) => existsSync(p));
  if (hit) return hit;
  try {
    const { createRequire } = await import("node:module");
    const { chromium } = createRequire(join(process.cwd(), "x.js"))("playwright");
    if (existsSync(chromium.executablePath())) return chromium.executablePath();
  } catch {}
  throw new Error("Chrome not found: pass --chrome <path>, or --connect to a Chrome started with --remote-debugging-port");
}

/** The browser: a new headless Chrome, or `connect` (a port, http://host:port or ws://…) to one that already runs. */
export async function openBrowser({ connect, chrome, width, height }) {
  let ws, proc, dir;
  if (connect) {
    const base = /^\d+$/.test(connect) ? `http://127.0.0.1:${connect}` : connect;
    ws = base.startsWith("ws") ? base : (await (await fetch(`${base.replace(/\/$/, "")}/json/version`)).json()).webSocketDebuggerUrl;
  } else {
    dir = mkdtempSync(join(tmpdir(), "census-"));
    const bin = await findChrome(chrome);
    // chrome-headless-shell is headless already and doesn't take --headless=new
    const flags = [...(/headless.shell/i.test(bin) ? [] : ["--headless=new"]), "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", `--window-size=${width},${height}`];
    if (process.platform === "linux" && process.getuid?.() === 0) flags.push("--no-sandbox");
    proc = spawn(bin, [...flags, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
    ws = await new Promise((ok, no) => {
      let err = "";
      const t = setTimeout(() => no(new Error(`Chrome didn't start: ${err.slice(-400)}`)), 30000);
      proc.stderr.on("data", (d) => { err += d; const m = err.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); ok(m[1]); } });
      proc.on("exit", (c) => { clearTimeout(t); no(new Error(`Chrome exited (${c}): ${err.slice(-400)}`)); });
    });
  }
  const conn = await connectWs(ws);
  return {
    conn,
    async newPage() {
      const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
      return new Page(conn, sessionId, targetId, width, height);
    },
    async close() {
      // Chrome may close before it answers: wait for the process, at most 3 s, then make sure it's gone
      if (proc) { conn.send("Browser.close").catch(() => {}); let timer; await new Promise((r) => (proc.exitCode !== null ? r() : (proc.once("exit", r), (timer = setTimeout(r, 3000))))); clearTimeout(timer); if (proc.exitCode === null) proc.kill(); }
      conn.close();
      if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

async function connectWs(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error(`can't reach ${url}`)); });
  let id = 0;
  const wait = new Map(), on = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.no(new Error(`${w.method}: ${m.error.message}`)) : w.ok(m.result); }
    else if (m.method) for (const f of on) f(m);
  };
  return {
    send(method, params = {}, sessionId) {
      const i = ++id;
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((ok, no) => wait.set(i, { ok, no, method }));
    },
    on(f) { on.add(f); return () => on.delete(f); },
    close() { ws.close(); },
  };
}

class Page {
  constructor(conn, session, target, width, height) {
    Object.assign(this, { conn, session, target, width, height });
    // requests in flight, to know when the page has its data
    this.open = new Map();
    conn.on((m) => {
      if (m.sessionId !== session) return;
      if (m.method === "Network.requestWillBeSent") this.open.set(m.params.requestId, { type: m.params.type, at: Date.now() });
      else if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") this.open.delete(m.params.requestId);
    });
  }
  /** Requests still loading, leaving out streams (EventSource, a long poll) open for more than 5 s. */
  busy() { const now = Date.now(); return [...this.open.values()].filter((r) => r.type !== "EventSource" && r.type !== "WebSocket" && now - r.at < 5000).length; }
  /**
   * Waits until the page settles: no request loading and the same controls in the same places for `quiet` ms, at most `max` ms.
   * Words and numbers may keep changing (a clock, a price): only what the page is made of has to hold still. Returns the ms it took, or null.
   */
  async settle(max = 15000, quiet = 600) {
    const t = Date.now();
    let last = "", since = Date.now();
    while (Date.now() - t < max) {
      const sig = await this.evaluate(() => {
        const out = [document.querySelectorAll("*").length, document.documentElement.scrollHeight];
        for (const e of document.querySelectorAll("button,a[href],input,select,textarea,[role],img,svg,canvas")) { const r = e.getBoundingClientRect(); if (r.width && r.height) out.push(Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)); }
        return out.join(",");
      }).catch(() => "");
      if (sig !== last || this.busy()) { last = sig; since = Date.now(); }
      else if (Date.now() - since >= quiet) return Date.now() - t;
      await sleep(150);
    }
    return null;
  }
  send(method, params) { return this.conn.send(method, params, this.session); }
  async init({ script, storage, clock }) {
    await Promise.all(["Page.enable", "Runtime.enable", "DOM.enable", "CSS.enable", "Network.enable"].map((m) => this.send(m)));
    await this.send("Emulation.setDeviceMetricsOverride", { width: this.width, height: this.height, deviceScaleFactor: 1, mobile: false });
    if (storage) {
      // a Playwright storage state: its cookies, and each origin's localStorage set before the page's own script runs
      const cookies = (storage.cookies ?? []).map(({ expires, ...c }) => (expires > 0 ? { ...c, expires } : c));
      if (cookies.length) await this.send("Network.setCookies", { cookies });
      for (const o of storage.origins ?? []) {
        const set = `if (location.origin === ${JSON.stringify(o.origin)}) for (const [k, v] of ${JSON.stringify((o.localStorage ?? []).map((x) => [x.name, x.value]))}) try { localStorage.setItem(k, v); } catch {}`;
        await this.send("Page.addScriptToEvaluateOnNewDocument", { source: set });
      }
    }
    if (clock) {
      // the page's clock starts at `clock` on each load and runs from there, so a time on screen reads the same in two captures
      const at = Date.parse(clock);
      if (Number.isNaN(at)) throw new Error(`--clock ${clock}: not a date`);
      await this.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const R = Date, at = ${at}, t0 = performance.now(), now = () => at + Math.floor(performance.now() - t0);
        class D extends R { constructor(...a) { a.length ? super(...a) : super(now()); } static now() { return now(); } }
        globalThis.Date = D; })();` });
    }
    if (script) await this.send("Page.addScriptToEvaluateOnNewDocument", { source: script });
  }
  async goto(url, timeout = 120000) {
    this.root = null;
    let off;
    const loaded = new Promise((ok) => { off = this.conn.on((m) => m.sessionId === this.session && m.method === "Page.loadEventFired" && ok()); });
    const r = await this.send("Page.navigate", { url });
    if (r.errorText) { off(); throw new Error(`${url}: ${r.errorText}`); }
    let timer;
    await Promise.race([loaded, new Promise((r) => (timer = setTimeout(r, timeout)))]);
    clearTimeout(timer); off();
  }
  async evaluate(fn, arg) {
    const r = await this.send("Runtime.evaluate", { expression: `(${fn})(${arg === undefined ? "" : JSON.stringify(arg)})`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  sleep(ms) { return sleep(ms); }
  async waitFor(sel, timeout = 60000) {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(200)) if (await this.evaluate((s) => !!document.querySelector(s), sel).catch(() => false)) return true;
    return false;
  }
  addStyle(css) { return this.evaluate((c) => { const s = document.createElement("style"); s.textContent = c; document.head.append(s); }, css); }
  url() { return this.evaluate(() => location.href); }
  mouse(type, x, y) { return this.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }); }
  move(x, y) { return this.mouse("mouseMoved", x, y); }
  /** The middle of the first element `sel` names, scrolled into view, when it is visible. */
  center(sel) {
    return this.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e || !e.checkVisibility()) return null;
      e.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, sel);
  }
  async hover(sel) { const c = await this.center(sel); if (!c) return false; await this.move(c.x, c.y); return true; }
  async click(sel) {
    const c = await this.center(sel);
    if (!c) return false;
    await this.move(c.x, c.y); await this.mouse("mousePressed", c.x, c.y); await this.mouse("mouseReleased", c.x, c.y);
    return true;
  }
  async escape() {
    for (const type of ["keyDown", "keyUp"]) await this.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  }
  /** The DOM nodes `sel` names, by their protocol ids. */
  async nodes(sel) {
    // one document per page load: asking for it again drops the ids handed out before
    this.root ??= (await this.send("DOM.getDocument", { depth: 0 })).root.nodeId;
    return (await this.send("DOM.querySelectorAll", { nodeId: this.root, selector: sel })).nodeIds;
  }
  force(nodeIds, classes) { return Promise.all(nodeIds.map((nodeId) => this.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: classes }))); }
  async close() {
    let timer;
    await Promise.race([this.conn.send("Target.closeTarget", { targetId: this.target }).catch(() => {}), new Promise((r) => (timer = setTimeout(r, 2000)))]);
    clearTimeout(timer);
  }
}
