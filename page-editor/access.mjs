// Who may talk to this Ibasho. Before this file, anyone who could reach the port could read keys, change settings and spend.
//
//   1. The address must be this computer's own: "localhost", an IP address, a Tailscale name, or a name listed in
//      STUDIO_HOSTS. A web page that points its own name at this computer (DNS rebinding) is turned away.
//   2. A request sent by another web site is refused (the browser says where a request comes from).
//   3. This computer itself is let in. Every other device (phone, laptop, tablet) needs the access code once;
//      it is then remembered by that device for a year. The code is in saved/access.json, is printed when the
//      app starts, and is shown under Settings when Ibasho is opened on the computer that runs it.
//
//   STUDIO_OPEN=1   let every device in without the code (the old behaviour; only for a network you fully trust)
//   STUDIO_HOSTS    extra names this app may be opened by, comma separated (e.g. studio.example.com)
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { networkInterfaces } from "node:os";

const OPEN = process.env.STUDIO_OPEN === "1";
const HOSTS = new Set(["localhost", ...(process.env.STUDIO_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)]);
const COOKIE = "ibasho_access", YEAR = 365 * 24 * 3600;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L: it is typed on a phone
let code = null;

export async function accessCode(saved) {
  if (code) return code;
  const f = join(saved, "access.json");
  try { const c = JSON.parse(await readFile(f, "utf8")).code; if (typeof c === "string" && c.length >= 12) return (code = c); } catch { /* first start */ }
  const b = randomBytes(12); let c = ""; for (let i = 0; i < 12; i++) c += ALPHABET[b[i] % ALPHABET.length] + (i % 4 === 3 && i < 11 ? "-" : "");
  await mkdir(saved, { recursive: true }); await writeFile(f, JSON.stringify({ code: c, made: new Date().toISOString() }, null, 1), { mode: 0o600 }); try { await chmod(f, 0o600); } catch { /* not every disk keeps modes */ }
  return (code = c);
}
const hostOf = (h) => String(h || "").trim().toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.includes(":") && /^[0-9a-f:.]+$/.test(h));
const hostOk = (h) => HOSTS.has(h) || isIp(h) || h.endsWith(".ts.net") || h.endsWith(".localhost");
export const isLocal = (req) => { const a = req.socket.remoteAddress || ""; if (req.headers["x-forwarded-for"] || req.headers.forwarded) return false; // relayed by something on this computer (tailscale serve, a proxy): the real visitor is elsewhere
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1"; };
const same = (a, b) => { const x = Buffer.from(String(a).toUpperCase().replace(/[^A-Z0-9]/g, "")), y = Buffer.from(String(b).toUpperCase().replace(/[^A-Z0-9]/g, "")); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
const cookieOf = (req) => { const m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)").exec(req.headers.cookie || ""); if (!m) return ""; try { return decodeURIComponent(m[1]); } catch { return ""; } };
// Wrong codes, newest last, by the device that sent them: a guesser gets 20 in ten minutes, and cannot lock anyone else out by
// using theirs up (before 19 Nov 2026 the 20 were shared). All devices together get 200, so many guessers are still held back.
const tries = new Map(), WINDOW = 600000;
const fresh = (list, now) => { while (list.length && now - list[0] > WINDOW) list.shift(); return list; };
const deviceOf = (req) => String((req.socket && req.socket.remoteAddress) || "?");
const tooManyTries = (req) => { const now = Date.now(); let all = 0; for (const [k, l] of tries) { if (!fresh(l, now).length) tries.delete(k); else all += l.length; } return (tries.get(deviceOf(req)) || []).length >= 20 || all >= 200; };
const wrongTry = (req) => { const k = deviceOf(req); if (!tries.has(k)) tries.set(k, []); tries.get(k).push(Date.now()); };
/** host:port as the browser names it, lower case: an Origin ("http://name:5178") and a Host header ("name:5178") compare equal. */
const siteOf = (v) => String(v || "").toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/\/.*$/, "");

// The page another device sees first: in Japanese when the address says ?lang=ja or the browser asks for Japanese first (Accept-Language)
const WORDS = {
  en: { title: "Ibasho: let this device in", h: "Let this device in", p: "This Ibasho belongs to someone. Type its access code once and this device is remembered. The code is shown under Settings when Ibasho is opened on the computer that runs it.", go: "Open Ibasho",
    many: "Too many wrong codes. Wait ten minutes and try again.", wrong: "That is not the code. Check it and try again." },
  ja: { title: "Ibasho: この端末を許可", h: "この端末を許可", p: "この Ibasho には持ち主がいます。アクセスコードを一度入力すると、この端末は記憶されます。コードは、Ibasho を動かしているコンピューターで開いたときに「設定」に表示されます。", go: "Ibasho を開く",
    many: "間違ったコードが多すぎます。10分待ってからもう一度お試しください。", wrong: "コードが違います。確認してもう一度お試しください。" },
};
export const langOf = (req, url) => { const q = url && url.searchParams.get("lang"); if (q === "ja" || q === "en") return q; return /^\s*ja\b/i.test(String(req.headers["accept-language"] || "")) ? "ja" : "en"; };
export const page = (msg, lang = "en") => { const w = WORDS[lang] || WORDS.en; return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${w.title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0908;color:#f6f0ec;font:500 17px/1.5 system-ui,sans-serif}main{width:min(92vw,420px);padding:24px}h1{font-size:1.6rem;margin:0 0 10px;letter-spacing:-.02em}p{color:#b3a49b;margin:0 0 18px}
input{width:100%;box-sizing:border-box;min-height:52px;padding:0 16px;border-radius:12px;border:1.5px solid #3a2e29;background:#14100e;color:#f6f0ec;font:600 1.2rem ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
button{margin-top:12px;width:100%;min-height:52px;border:0;border-radius:12px;background:#f2603f;color:#250803;font:800 1rem system-ui,sans-serif}.bad{color:#ff8f8f}</style></head>
<body><main><h1>${w.h}</h1><p>${w.p}</p>
${msg ? `<p class="bad">${w[msg] || ""}</p>` : ""}<form method="get"><input name="key" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" required autofocus>${lang === "ja" ? '<input type="hidden" name="lang" value="ja">' : ""}<button>${w.go}</button></form></main></body></html>`; };

/** Addresses another device may open this Ibasho by: STUDIO_ADDRESSES first (set it when the computer is reached through another
 * address, e.g. Windows forwarding to WSL, or Tailscale), then this computer's own network addresses. */
export function addresses() {
  const out = (process.env.STUDIO_ADDRESSES || "").split(",").map((a) => a.trim()).filter(Boolean);
  for (const list of Object.values(networkInterfaces())) for (const a of list || []) if (a.family === "IPv4" && !a.internal && !out.includes(a.address)) out.push(a.address);
  return out.slice(0, 8);
}
/** True when the request may go on. Otherwise the answer has been sent. */
export async function gate(req, res, url, saved) {
  const host = hostOf(req.headers.host);
  if (!hostOk(host)) { res.statusCode = 421; res.setHeader("content-type", "text/plain; charset=utf-8"); res.end("Open Ibasho by this computer's own address (localhost or its IP address). To use another name, start it with STUDIO_HOSTS=that.name"); return false; }
  const origin = req.headers.origin, site = req.headers["sec-fetch-site"], isApi = url.pathname.startsWith("/api/");
  const foreign = (origin && (origin === "null" || siteOf(origin) !== siteOf(req.headers.host))) || ((site === "cross-site" || site === "same-site") && (isApi || req.method !== "GET"));
  if (foreign) { res.statusCode = 403; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: "This request came from another web site and was refused." })); return false; }
  if (url.pathname === "/api/access") { // the code, for the Settings screen: only to the computer that runs Ibasho
    res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store");
    if (!isLocal(req)) { res.statusCode = 403; res.end(JSON.stringify({ error: "The access code is only shown on the computer that runs Ibasho." })); return false; }
    res.end(JSON.stringify({ code: await accessCode(saved), open: OPEN, port: +(req.socket.localPort || 0), addresses: addresses() })); return false;
  }
  if (OPEN || isLocal(req)) return true;
  const want = await accessCode(saved);
  if (same(cookieOf(req), want)) return true;
  const key = url.searchParams.get("key") || req.headers["x-ibasho-access"];
  if (key && !tooManyTries(req)) {
    if (same(key, want)) {
      res.setHeader("set-cookie", `${COOKIE}=${encodeURIComponent(want)}; Max-Age=${YEAR}; Path=/; HttpOnly; SameSite=Lax`);
      if (req.headers["x-ibasho-access"]) return true; // a tool that sends the code with each request
      url.searchParams.delete("key"); res.statusCode = 303; res.setHeader("location", url.pathname + (url.searchParams.size ? "?" + url.searchParams : "")); res.end(); return false;
    }
    wrongTry(req);
  }
  res.setHeader("cache-control", "no-store");
  if (isApi) { res.statusCode = 401; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: "This device has not been let in yet. Open Ibasho in the browser and type the access code." })); return false; }
  res.statusCode = 401; res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(page(tooManyTries(req) ? "many" : key ? "wrong" : "", langOf(req, url))); return false;
}
