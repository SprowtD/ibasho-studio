#!/usr/bin/env node
// Finds the English text a screen can show, so it can be put in the Japanese dictionary (page-editor/i18n-ja.js).
// Usage: node tools/i18n_extract.mjs [--missing] file.js|file.html ...  -> JSON lines { file, line, text, kind }
//   kind: "text" (exact text), "pattern" (has {0}, {1} where code fills something in)
//   --missing: only what the dictionary does not cover yet.
// Rough by design: it reads string literals and HTML text, and leaves out what looks like code (selectors, CSS, routes).
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm";

const args = process.argv.slice(2); const missing = args.includes("--missing"); const files = args.filter((a) => !a.startsWith("--"));
const norm = (s) => s.replace(/\s+/g, " ").trim();
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", hellip: "…", middot: "·", rarr: "→", larr: "←", times: "×", mdash: "—", ndash: "–" };
const unent = (s) => s.replace(/&(#?\w+);/g, (m, e) => ENT[e] ?? m);

// Does this look like words a person reads (not code)?
function readable(s) {
  const t = norm(s.replace(/\{\d+\}/g, " "));
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (/^[\w$.-]+$/.test(t) && !/^[A-Z][a-z]+$/.test(t) && !/^[A-Z][a-z]+[A-Z]?$/.test(t)) return false; // identifiers, keys
  if (/^[#.[]?[\w-]+(\[[^\]]*\])?([ >+~,][#.[]?[\w-]+(\[[^\]]*\])?)*$/.test(t) && !/[A-Z]/.test(t[0])) return false; // selectors
  if (/^(\/|\.\/|https?:)/.test(t) || /^[\w/-]+\.(json|js|mjs|png|jpg|jpeg|webp|mp4|md|txt|css|html|svg|py|wav|mp3)$/i.test(t)) return false;
  if (/[{};]\s*$|:\s*[\w#-]+\s*;/.test(t) && /[:;]/.test(t) && !/[A-Z][a-z]+ [a-z]/.test(t)) return false; // css
  if (/^(var|const|let|function|return|if|else)\b/.test(t)) return false;
  if (/^[a-z-]+(:[a-z-]+)?$/.test(t)) return false; // event names, enum values
  if (/^[a-z]+(-[a-z]+)+$/.test(t)) return false;
  if (/^(rgb|rgba|hsl|url|calc|var|translate|rotate|scale|matrix)\(/.test(t)) return false;
  if (/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/.test(t) && /\d/.test(t)) return false; // svg paths
  if (/^(GET|POST|PUT|DELETE|PATCH)$/.test(t)) return false;
  if (/^[a-z]+ [a-z]+$/.test(t) && /^(btn|chip|small|muted|card|row|field|seg|hint)\b/.test(t)) return false; // class lists
  if (/^[a-z0-9 _-]+$/.test(t) && /\b(btn|sm|ghost|primary|chip|muted|small|grow|hint|seg|lbl|row|wrap|sect|card|tools|field|note|ok|bad|busy|warn)\b/.test(t) && t.split(" ").every((w) => /^[a-z0-9_-]+$/.test(w)) && t.split(" ").length <= 4 && !/\b(the|a|is|to|of|and|it|no|not|this)\b/.test(t)) return false;
  return true;
}

const out = [];
function add(file, line, text, kind) {
  const t = norm(unent(text)); if (!t || !readable(t)) return;
  out.push({ file, line, text: t, kind: /\{\d+\}/.test(t) ? "pattern" : kind || "text" });
}

// HTML: text between tags and the readable attributes. "{n}" stands where a template fills something in.
function fromHtml(file, line, html) {
  html = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<svg\b[\s\S]*?<\/svg>/gi, "<svg/>").replace(/<!--[\s\S]*?-->/g, " ");
  for (const m of html.matchAll(/\b(title|placeholder|aria-label|alt|data-tip|label)\s*=\s*("([^"]*)"|'([^']*)')/g)) add(file, line, m[3] ?? m[4]);
  for (const m of html.matchAll(/<input\b[^>]*type=["']?(button|submit)[^>]*value=["']([^"']*)["']/g)) add(file, line, m[2]);
  // text runs: inline tags (b, i, em, strong, small, br, code, kbd, span without attributes) kept inside one run, as a person reads it
  const runs = html.replace(/<\/?(b|i|em|strong|kbd)>/gi, "").split(/<[^>]*>/);
  for (const r of runs) add(file, line, r);
}

// JS: a small scanner for string and template literals; a template's ${...} becomes {n}.
function fromJs(file, src, base = 1) {
  let i = 0, line = base; const n = src.length;
  const prevSig = () => { let k = i - 1; while (k >= 0 && /\s/.test(src[k])) k--; return k >= 0 ? src[k] : ""; };
  const prevWord = () => { const m = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, i - 20), i)); return m ? m[1] : ""; };
  const nextSig = (k) => { while (k < n && /\s/.test(src[k])) k++; return src[k] || ""; };
  function readTemplate() { // at the backtick; returns { text, end }
    let j = i + 1, text = "", ph = 0;
    while (j < n && src[j] !== "`") {
      if (src[j] === "\\") { text += src[j + 1]; j += 2; continue; }
      if (src[j] === "$" && src[j + 1] === "{") { // skip the expression, scanning nested strings
        let depth = 1, k = j + 2; const exprStart = k;
        while (k < n && depth) {
          const c = src[k];
          if (c === "{") depth++; else if (c === "}") depth--;
          else if (c === '"' || c === "'") { k++; while (k < n && src[k] !== c) { if (src[k] === "\\") k++; k++; } }
          else if (c === "`") { const save = i; i = k; const r = readTemplate(); i = save; k = r.end; }
          if (depth) k++;
        }
        const expr = src.slice(exprStart, k); fromJs(file, expr, line + (src.slice(i, exprStart).match(/\n/g) || []).length);
        text += `{${ph++}}`; j = k + 1; continue;
      }
      text += src[j]; j++;
    }
    return { text, end: j };
  }
  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); line += (src.slice(i, e).match(/\n/g) || []).length; i = e < 0 ? n : e + 2; continue; }
    if (c === "/") { const p = prevSig(), w = prevWord(); if (!p || "(,=:[!&|?{};+-*%<>~^".includes(p) || /^(return|typeof|case|of|in)$/.test(w)) { // a regex literal
        let j = i + 1, cls = false; while (j < n && src[j] !== "\n") { if (src[j] === "\\") { j += 2; continue; } if (src[j] === "[") cls = true; else if (src[j] === "]") cls = false; else if (src[j] === "/" && !cls) break; j++; }
        i = j + 1; continue; } }
    if (c === '"' || c === "'") {
      let j = i + 1, s = ""; while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") { const e = src[j + 1]; s += e === "n" ? "\n" : e === "u" ? String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)) : e; j += e === "u" ? 6 : 2; continue; } s += src[j]; j++; }
      const before = prevSig() === "+", after = nextSig(j + 1) === "+";
      const prevKey = /\b(querySelector(All)?|getElementById|closest|matches|addEventListener|removeEventListener|classList\.\w+|setAttribute|getAttribute|removeAttribute|hasAttribute|fetch|createElement|startsWith|endsWith|includes|split|join|localStorage\.\w+|dataset|\$|\$\$|get|put|send|post|api|emit|on)\s*\(\s*$/.test(src.slice(Math.max(0, i - 60), i));
      if (!prevKey) {
        if (/<[a-z][^>]*>|<\/[a-z]+>/i.test(s)) fromHtml(file, line, s);
        else add(file, line, (before ? "{0}" : "") + s + (after ? (before ? "{1}" : "{0}") : ""));
      }
      i = j + 1; continue;
    }
    if (c === "`") {
      const startLine = line, r = readTemplate(); const text = r.text;
      line += (src.slice(i, r.end).match(/\n/g) || []).length;
      if (/<[a-z][^>]*>|<\/[a-z]+>/i.test(text)) fromHtml(file, startLine, text); else add(file, startLine, text);
      i = r.end + 1; continue;
    }
    i++;
  }
}

for (const f of files) {
  const src = fs.readFileSync(f, "utf8"), rel = path.relative(process.cwd(), f);
  if (f.endsWith(".html")) {
    // inline scripts are JS; the rest is HTML
    let rest = src; const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi; let m;
    while ((m = re.exec(src))) { const line = src.slice(0, m.index).split("\n").length; fromJs(rel, m[1], line); }
    rest = src.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (s) => "\n".repeat((s.match(/\n/g) || []).length));
    rest.split("\n").forEach((l, k) => fromHtml(rel, k + 1, l));
    // multi-line text runs: join lines between tags once more
    fromHtml(rel, 0, rest.replace(/\n/g, " "));
  } else fromJs(rel, src);
}

let known = null;
if (missing) { // load the dictionary and keep only what it does not translate
  const ctx = { window: {}, document: undefined, navigator: { language: "en" }, localStorage: undefined, console };
  ctx.window = ctx; vm.createContext(ctx);
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "../page-editor");
  vm.runInContext(fs.readFileSync(path.join(dir, "i18n.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(dir, "i18n-ja.js"), "utf8"), ctx);
  known = (s) => ctx.IbashoI18n.covers(s);
}
const seen = new Set();
for (const o of out) {
  if (seen.has(o.text)) continue; seen.add(o.text);
  if (known && known(o.text)) continue;
  console.log(JSON.stringify(o));
}
