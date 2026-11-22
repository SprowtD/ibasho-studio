// The Japanese switch's dictionary (page-editor/i18n.js + i18n-ja.js), without a browser: known words come out Japanese, unknown
// ones stay English (never a raw key), filled-in values are kept, every entry is usable, and the page another device sees first
// (the access code page) speaks Japanese to a Japanese browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "./harness.mjs";

const load = (language, stored) => {
  const store = new Map(stored ? [["ibasho-lang", stored]] : []);
  const ctx = { navigator: { language }, console, URLSearchParams, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ["i18n-ja.js", "i18n.js"]) vm.runInContext(readFileSync(join(REPO, "page-editor", f), "utf8"), ctx);
  return ctx.IbashoI18n;
};

test("the language follows the browser until the person picks one", () => {
  assert.equal(load("ja-JP").lang, "ja");
  assert.equal(load("en-US").lang, "en");
  assert.equal(load("ja-JP", "en").lang, "en", "the person's choice wins over the browser");
  assert.equal(load("en-GB", "ja").lang, "ja");
});

test("known words come out Japanese; unknown ones stay English; values are filled in", () => {
  const I = load("ja");
  for (const [en, ja] of [["Save", "保存"], ["Undo", "元に戻す"], ["Redo", "やり直す"], ["Export", "書き出し"], ["Cancel", "キャンセル"], ["Lettering", "写植"], ["Layout", "コマ割り"]]) assert.equal(I.tr(en), ja, en);
  assert.equal(I.tr("  Save "), "  保存 ", "spacing around the words is kept");
  assert.equal(I.tr("Some words nobody put in the dictionary"), "Some words nobody put in the dictionary");
  assert.equal(I.tr("12 pages"), "12ページ", "a template fills its value in");
  assert.equal(I.t("{0} pages", [3]), "3ページ");
  const E = load("en-US");
  assert.equal(E.tr("Save"), "Save", "in English nothing changes");
  assert.equal(E.t("{0} pages", [3]), "3 pages");
});

test("every dictionary entry is usable: no empty Japanese, every regex compiles, no English left as the Japanese", () => {
  const src = readFileSync(join(REPO, "page-editor/i18n-ja.js"), "utf8");
  let dict; const ctx = { globalThis: {}, IbashoI18n: { add: (d) => { dict = d; } } }; vm.createContext(ctx); vm.runInContext(src, ctx);
  assert.ok(dict && Object.keys(dict.exact).length > 500, "the dictionary is loaded and large");
  for (const [en, ja] of Object.entries({ ...dict.exact, ...dict.templates })) {
    assert.ok(typeof ja === "string" && ja.trim(), "Japanese for: " + en);
    assert.ok(/[\u3040-\u30ff\u4e00-\u9fff]/.test(ja) || ja === en, "looks Japanese: " + en + " -> " + ja);
    for (const m of ja.matchAll(/\{(\d+)\}/g)) assert.ok(en.includes(`{${m[1]}}`), `{${m[1]}} in the Japanese is in the English too: ${en}`);
  }
  for (const [re, ja] of dict.regex) { assert.doesNotThrow(() => new RegExp(re), re); assert.ok(re.startsWith("^") && re.endsWith("$"), "anchored: " + re); assert.ok(ja, re); }
});

test("the access code page speaks Japanese to a Japanese browser, and keeps the choice through the code", async () => {
  const { langOf, page } = await import(join(REPO, "page-editor/access.mjs"));
  assert.equal(langOf({ headers: { "accept-language": "ja,en-US;q=0.8" } }, new URL("http://x/")), "ja");
  assert.equal(langOf({ headers: { "accept-language": "en-US,ja;q=0.5" } }, new URL("http://x/")), "en");
  assert.equal(langOf({ headers: {} }, new URL("http://x/?lang=ja")), "ja");
  const ja = page("", "ja");
  assert.match(ja, /<html lang="ja">/); assert.match(ja, /この端末を許可/); assert.match(ja, /name="lang" value="ja"/, "the code form carries the choice on");
  assert.match(page("", "en"), /Let this device in/);
  assert.match(page("wrong", "ja"), /コードが違います/);
  assert.match(page("many", "en"), /Too many wrong codes/);
});
