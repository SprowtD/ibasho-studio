#!/usr/bin/env node
// Builds page-editor/i18n-ja.js from dictionary parts: node tools/i18n_merge.mjs core.json part1.json part2.json ...
// Each part: { exact: {}, templates: {}, regex: [[source, ja]], unsure: [] }. The first part to give an English key wins
// (so the core part, first, keeps the main words the same everywhere); later disagreements are listed on stderr.
import fs from "node:fs"; import path from "node:path";
const files = process.argv.slice(2);
const exact = {}, templates = {}, regex = [], seenRe = new Set(), clash = [];
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(f, "utf8")), tag = path.basename(f);
  for (const [k0, v] of Object.entries(d.exact || {})) { const k = norm(k0); if (!v) continue; const into = /\{\d+\}/.test(k) ? templates : exact; if (k in into) { if (into[k] !== v) clash.push(`${tag}: "${k}" kept "${into[k]}", not "${v}"`); } else into[k] = v; }
  for (const [k0, v] of Object.entries(d.templates || {})) { const k = norm(k0); if (!v) continue; if (k in templates) { if (templates[k] !== v) clash.push(`${tag}: "${k}" kept "${templates[k]}", not "${v}"`); } else templates[k] = v; }
  for (const r of d.regex || []) { try { new RegExp(r[0]); } catch (e) { clash.push(`${tag}: bad regex ${r[0]}`); continue; } if (!seenRe.has(r[0])) { seenRe.add(r[0]); regex.push([r[0], r[1]]); } }
}
const lines = (o) => Object.entries(o).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join("\n");
const out = `/* The Japanese dictionary for page-editor/i18n.js (read its top comment). English text as a person sees it -> Japanese.
 * exact: the whole text. templates: {0}, {1} stand where the code fills something in. regex: [source, Japanese with $1, $2].
 * Terms follow private/ja-glossary.md. Built by tools/i18n_merge.mjs from parts; edit here or in the parts and merge again.
 * i18n.js loads this itself when the screen is in Japanese (it adds itself to IbashoI18n, or waits if loaded first). */
(function (d) { if (typeof IbashoI18n !== "undefined" && IbashoI18n.add) IbashoI18n.add(d); else (globalThis.IBASHO_JA_PENDING = globalThis.IBASHO_JA_PENDING || []).push(d); })({
  exact: {
${lines(exact)}
  },
  templates: {
${lines(templates)}
  },
  regex: [
${regex.map((r) => `    ${JSON.stringify(r)},`).join("\n")}
  ]
});
`;
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "../page-editor/i18n-ja.js"), out);
console.error(`exact ${Object.keys(exact).length}, templates ${Object.keys(templates).length}, regex ${regex.length}; ${clash.length} disagreements`);
if (process.env.SHOW_CLASH) for (const c of clash) console.error("  " + c);
