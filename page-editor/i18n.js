/* Ibasho language: English or 日本語 (Japanese), on every screen.
 *
 * How it works
 * - The screens are written in English, and English stays the source: nothing in the screens' code was rewritten.
 * - The Japanese words live in one dictionary, page-editor/i18n-ja.js (loaded only for Japanese), keyed by the English text exactly as a person sees it.
 *   It has three parts: `exact` ("Save" -> "保存"), `templates` (English with {0}, {1} where the code fills something in:
 *   "{0} pages" -> "{0}ページ") and `regex` (for the few that need more than that). A filled-in part is itself translated
 *   when the dictionary knows it ("the page" -> "ページ"), else shown as it is (numbers, names).
 * - When the screen is in Japanese, this file translates the page as it is drawn: every text, the tooltip (title), placeholder
 *   and aria-label, and alert/confirm/prompt messages. It watches the page, so text the code adds later is translated too.
 *   Text the dictionary does not know stays in English: a raw key is never shown.
 * - Never translated: the person's own words (text boxes, balloons and the page picture, which is SVG), anything marked
 *   translate="no" or data-no-i18n, code. What is sent to the AI models is untouched (only what is on screen changes).
 * - In code: IbashoI18n.t("English text {0}", ["value"]) gives the Japanese (or the English) with the values filled in.
 *
 * The choice: the browser's language at first (Japanese if it starts with "ja"), then whatever the person picks with the
 * EN / 日本語 switch in the top bar or in Settings. Kept in this browser ("ibasho-lang"). `?lang=ja` or `?lang=en` in the
 * address also picks it (handy for a shared link). Changing it reloads the screen. <html lang> follows it. */
(function () {
  "use strict";
  const KEY = "ibasho-lang", root = typeof document !== "undefined" ? document.documentElement : null;
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const put = (v) => { try { localStorage.setItem(KEY, v); } catch (e) { /* no storage */ } };
  function pick() {
    try { const q = new URLSearchParams(location.search).get("lang"); if (q === "ja" || q === "en") { put(q); return q; } } catch (e) { /* no location */ }
    const v = get(); if (v === "ja" || v === "en") return v;
    const nav = (typeof navigator !== "undefined" && (navigator.languages && navigator.languages[0] || navigator.language)) || "";
    return /^ja\b/i.test(nav) ? "ja" : "en";
  }
  const lang = pick();
  if (root) root.lang = lang;

  // ---------- the dictionary ----------
  const exact = new Map(), tmpls = new Map(), pats = [], cache = new Map();
  let mo = null; // watches the page once the screen is in Japanese
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function add(d) {
    if (!d) return;
    for (const [en, ja] of Object.entries(d.exact || {})) if (ja) { if (/\{\d+\}/.test(en)) addTemplate(en, ja); else exact.set(norm(en), ja); }
    for (const [en, ja] of Object.entries(d.templates || {})) if (ja) addTemplate(en, ja);
    for (const r of d.regex || []) { try { const re = r[0] instanceof RegExp ? r[0] : new RegExp(r[0]); pats.push({ re, ja: r[1], weight: 1000 + String(re.source).length }); } catch (e) { /* a bad entry is skipped */ } }
    pats.sort((a, b) => b.weight - a.weight); cache.clear();
    if (mo && root) walk(root); // what was drawn before the dictionary arrived
  }
  function addTemplate(en, ja) {
    const t = norm(en), lit = t.replace(/\{\d+\}/g, ""); tmpls.set(t, ja);
    if ((lit.match(/[A-Za-z]/g) || []).length < 3) return; // too loose to match safely
    const order = []; const src = "^" + t.split(/(\{\d+\})/).map((p) => { const m = /^\{(\d+)\}$/.exec(p); if (!m) return reEsc(p); order.push(+m[1]); return "(.*?)"; }).join("") + "$";
    // "{0}" in the Japanese means the value that stood at {0} in the English, whatever its place in the regex
    const jaRe = ja.replace(/\{(\d+)\}/g, (m, n) => { const k = order.indexOf(+n); return k < 0 ? m : "${" + (k + 1) + "}"; });
    pats.push({ re: new RegExp(src), ja: jaRe, weight: lit.length, loose: !/\s/.test(lit.trim()) && lit.replace(/[^A-Za-z]/g, "").length < 15 }); // "Open {0}", "{0} chapters": one word around a value
  }
  // English (one run of text) -> Japanese, or null when the dictionary does not know it
  function look(s, html, depth) {
    const k = (html ? "\u0001" : "") + s;
    if (cache.has(k)) return cache.get(k);
    let out = null;
    if (/[A-Za-z]/.test(s)) {
      const e = exact.get(s);
      if (e != null) out = html ? e : strip(e);
      else if ((depth || 0) < 4) {
        for (const p of pats) {
          const m = p.re.exec(s); if (!m) continue;
          let wrong = false;
          const o = p.ja.replace(/\$\{(\d+)\}|\$(\d)/g, (x, n1, n2) => { const n = n1 || n2; const g = m[+n]; if (g == null) return ""; const t = g.trim() ? look(norm(g), false, (depth || 0) + 1) : null;
            // a short template ("Open {0}", "{0} chapters") that caught a piece of an English sentence it does not know: not this one
            if (t == null && p.loose && /\b[a-z]{2,}\b.*\s.*\b[a-z]{2,}\b/.test(g)) wrong = true;
            const v = t == null ? g : t; return html ? esc(v) : v; });
          if (wrong) continue;
          out = o;
          if (!html) out = strip(out);
          break;
        }
        if (out == null) { // "Saved." / "Series:" / "Loading…" when the dictionary has the words without the mark
          const m = /^(.*[A-Za-z)])\s*([.:…]|\.\.\.)$/.exec(s);
          if (m) { const t = look(m[1], html, (depth || 0) + 1); if (t != null) out = t + (m[2] === "." ? "。" : m[2] === ":" ? "：" : "…"); }
        }
      }
    }
    if (cache.size > 20000) cache.clear();
    cache.set(k, out); return out;
  }
  const strip = (s) => String(s).replace(/<[^>]+>/g, "");
  /** Translate one string (any spacing kept around it). English when the screen is in English or the words are unknown. */
  function tr(s) {
    if (lang !== "ja" || s == null) return s;
    const str = String(s), m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str); if (!m[2]) return str;
    const t = look(norm(m[2])); if (t != null) return m[1] + t + m[3];
    // a message of several lines or paragraphs: each on its own
    if (/\n/.test(m[2])) { const parts = m[2].split(/(\n+)/); let any = false; const o = parts.map((p) => { if (/^\n+$/.test(p) || !p.trim()) return p; const x = look(norm(p)); if (x != null) { any = true; return x; } return p; }); if (any) return m[1] + o.join("") + m[3]; }
    return str;
  }
  /** t("English {0}", [values]) or t("English {name}", { name }): the words in the screen's language, values filled in. */
  function t(en, vars) {
    let s = lang === "ja" ? (tmpls.get(norm(en)) ?? look(norm(en)) ?? en) : en;
    if (vars != null) { const v = Array.isArray(vars) || typeof vars === "object" ? vars : [vars]; s = s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? (lang === "ja" ? tr(String(v[k])) : String(v[k])) : m)); }
    return s;
  }

  // dictionaries loaded before this file wait in IBASHO_JA_PENDING
  if (typeof globalThis !== "undefined" && globalThis.IBASHO_JA_PENDING) { for (const d of globalThis.IBASHO_JA_PENDING) add(d); globalThis.IBASHO_JA_PENDING = []; }

  // ---------- translating the page as it is drawn ----------
  const SKIP = "svg, textarea, script, style, code, pre, [contenteditable=''], [contenteditable='true'], [translate='no'], [data-no-i18n], #projSel, #stage .sub, #stage .ttl, .no-i18n";
  const ATTRS = ["title", "placeholder", "aria-label", "alt"];
  const INLINE = new Set(["B", "STRONG", "I", "EM", "KBD"]);
  const skipped = (el) => !el || !el.closest || !!el.closest(SKIP);
  function doText(n) {
    const d = n.data; if (!d || !/[A-Za-z]/.test(d)) return;
    const x = tr(d); if (x === d) return;
    // an <option> with no value of its own is worth its words: keep the English as its value, so what is saved stays the same
    const p = n.parentNode; if (p && p.tagName === "OPTION" && !p.hasAttribute("value")) p.setAttribute("value", p.text.replace(/\s+/g, " ").trim());
    n.data = x;
  }
  function doAttrs(el) {
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v && /[A-Za-z]/.test(v)) { const x = tr(v); if (x !== v) el.setAttribute(a, x); } }
    if (el.tagName === "INPUT" && /^(button|submit|reset)$/i.test(el.type)) { const v = el.value; const x = tr(v); if (x !== v) el.value = x; }
  }
  // An element that reads as one sentence with a bold word in it: translated whole, so the Japanese can be in its own order
  function doMixed(el) {
    let words = false, inl = false;
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { if (c.data.trim()) words = true; }
      else if (c.nodeType === 1) { if (!INLINE.has(c.tagName) || c.id || c.attributes.length) return false; for (const g of c.childNodes) if (g.nodeType !== 3) return false; inl = true; }
      else if (c.nodeType !== 8) return false;
    }
    if (!words || !inl) return false;
    const key = norm(el.textContent); if (!/[A-Za-z]/.test(key)) return false;
    const h = look(key, true); if (h == null) return false;
    if (/<[a-z]/i.test(h)) el.innerHTML = h; else el.textContent = h;
    return true;
  }
  // a text box: its words are the person's, but its placeholder and label are the screen's
  const boxAttrs = (el) => el.tagName === "TEXTAREA" && !skipped(el.parentElement);
  function walk(node) { // a node just added: its own place is checked once, then everything inside it
    if (node.nodeType === 3) { if (!skipped(node.parentNode)) doText(node); return; }
    if (node.nodeType === 1) { if (skipped(node)) { if (boxAttrs(node)) doAttrs(node); return; } inner(node); }
  }
  function inner(el) {
    if (el.nodeType === 3) return doText(el);
    if (el.nodeType !== 1) return;
    if (el.matches(SKIP)) { if (boxAttrs(el)) doAttrs(el); return; }
    doAttrs(el);
    if (doMixed(el)) return;
    for (const c of Array.from(el.childNodes)) inner(c);
  }

  function start() {
    if (lang !== "ja" || mo || typeof MutationObserver === "undefined") return;
    walk(root);
    mo = new MutationObserver((recs) => {
      for (const r of recs) {
        if (r.type === "childList") { for (const n of r.addedNodes) if (n.isConnected) walk(n); }
        else if (r.type === "characterData") { const n = r.target; if (n.isConnected && !skipped(n.parentNode)) { const p = n.parentNode; if (!(p && p.nodeType === 1 && doMixed(p))) doText(n); } }
        else if (r.type === "attributes") { const el = r.target; if (el.isConnected && (!skipped(el) || boxAttrs(el))) { if (r.attributeName === "value") doAttrs(el); else { const v = el.getAttribute(r.attributeName); if (v && /[A-Za-z]/.test(v)) { const x = tr(v); if (x !== v) el.setAttribute(r.attributeName, x); } } } }
      }
    });
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat("value") });
  }
  if (lang === "ja" && typeof window !== "undefined" && typeof document !== "undefined") {
    // alert, confirm and prompt speak Japanese too (the message only: a prompt's starting value is the person's)
    const A = window.alert, C = window.confirm, P = window.prompt;
    if (A) window.alert = function (m) { return A.call(window, tr(m)); };
    if (C) window.confirm = function (m) { return C.call(window, tr(m)); };
    if (P) window.prompt = function (m, d) { return P.call(window, tr(m), d); };
    start(); // from the very top of the page, so nothing is ever painted in English first
    // the dictionary is only loaded for Japanese (it is large): right here, before the rest of the page is read
    if (!exact.size && document.readyState === "loading" && typeof document.write === "function") document.write('<script src="/i18n-ja.js?v=2"><\/script>');
  }

  // ---------- the switch: EN / 日本語 in the top bar, and a row in Settings ----------
  function setLang(v) { if (v !== "ja" && v !== "en") return; put(v); if (v === lang) return; location.reload(); }
  const CSS = `#langBtn{width:auto;min-width:0;padding:0 9px;gap:3px;display:inline-flex;align-items:center;flex:none;font:700 .78rem/1 var(--ui, system-ui, sans-serif);white-space:nowrap}
  #langBtn span{opacity:.55}#langBtn span[aria-current="true"]{opacity:1;color:var(--ink)}#langBtn i{font-style:normal;opacity:.4}
  :root:lang(ja){--ui:"Manrope","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Noto Sans CJK JP","Yu Gothic UI","Yu Gothic","Meiryo",system-ui,sans-serif}
  :root:lang(ja) body{line-break:strict}`;
  if (typeof document !== "undefined" && document.head) { const st = document.createElement("style"); st.id = "i18nStyle"; st.textContent = CSS; document.head.appendChild(st); }
  function langBtn() {
    const b = document.createElement("button"); b.type = "button"; b.className = "iconbtn lang-btn"; b.id = "langBtn"; b.setAttribute("translate", "no");
    b.innerHTML = `<span lang="en" aria-current="${lang === "en"}">EN</span><i aria-hidden="true">/</i><span lang="ja" aria-current="${lang === "ja"}">日本語</span>`;
    const say = lang === "ja" ? "言語: 日本語 (English に切り替え)" : "Language: English (switch to 日本語)";
    b.setAttribute("aria-label", say); b.title = say;
    b.addEventListener("click", () => setLang(lang === "ja" ? "en" : "ja"));
    return b;
  }
  /** The row for a Settings window: "Language  [English] [日本語]". */
  function row() {
    return `<div class="setrow set-lang" translate="no"><span><b>${lang === "ja" ? "言語" : "Language"}</b><br><span class="hint">${lang === "ja" ? "画面の言語。この端末のブラウザに保存されます。" : "The language of the screens. Kept in this browser on this device."}</span></span><span class="segs" role="group" aria-label="${lang === "ja" ? "言語" : "Language"}">` +
      [["en", "English"], ["ja", "日本語"]].map(([v, l]) => `<button type="button" class="seg" data-lang="${v}" lang="${v}" aria-pressed="${lang === v}">${l}</button>`).join("") + `</span></div>`;
  }
  function wire(box) { box.addEventListener("click", (e) => { const b = e.target.closest("[data-lang]"); if (b) setLang(b.dataset.lang); }); }
  if (typeof document !== "undefined" && typeof addEventListener !== "undefined") addEventListener("DOMContentLoaded", () => {
    if (!document.getElementById("i18nStyle")) { const st = document.createElement("style"); st.id = "i18nStyle"; st.textContent = CSS; document.head.appendChild(st); }
    const theme = document.getElementById("themeBtn");
    if (theme && !document.getElementById("langBtn")) theme.parentNode.insertBefore(langBtn(), theme);
    // Settings: the editor's own window and the shared one (made by studio.js on DOMContentLoaded, so a moment later)
    setTimeout(() => {
      for (const id of ["settingsDlg", "sharedSettings"]) {
        const d = document.getElementById(id); if (!d || d.querySelector(".set-lang")) continue;
        const look = d.querySelector(".set-look"), head = d.querySelector(".dlg-head");
        const at = look || head; if (!at) continue;
        at.insertAdjacentHTML(look ? "beforebegin" : "afterend", row()); wire(d);
      }
    }, 0);
  });

  const api = { lang, t, tr, add, set: setLang, row, wire, covers: (s) => look(norm(s)) != null, version: 1 };
  if (typeof window !== "undefined") window.IbashoI18n = api;
  if (typeof globalThis !== "undefined") globalThis.IbashoI18n = api;
})();
