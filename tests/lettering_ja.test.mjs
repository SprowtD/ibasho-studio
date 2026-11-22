// Japanese lettering: words in columns (縦書き), first column on the right; breaks between the writer's phrases and by 禁則; Japanese fonts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { REPO } from "./harness.mjs";
const require = createRequire(import.meta.url);
require(join(REPO, "page-editor/render.js")); const R = globalThis.PageRender;
const measureText = (font, s) => { const m = /(\d+(?:\.\d+)?)px/.exec(font); return String(s).length * (m ? +m[1] : 30) * 0.5; };
const spec = { voices: {}, styles: {} };
const cols = (L) => L.lines.map((c) => c.map((i) => L.toks[i].w).join(""));

test("Japanese speech stands up in columns, in a Japanese font; English and phone screens stay across", () => {
  const L = R.measure({ kind: "speech", text: "負けた方が 一杯 おごりだ！", at: [0.5, 0.5] }, spec, measureText);
  assert.equal(L.vertical, true);
  assert.equal(L.fontKey, "zenantique");
  assert.ok(L.ry > L.rx, "a column balloon is taller than wide");
  assert.equal(R.measure({ kind: "speech", text: "Loser buys the round!" }, spec, measureText).vertical, undefined);
  const P = R.measure({ kind: "phone", text: "今どこ？ 駅前で 待ってる" }, spec, measureText);
  assert.ok(!P.vertical); assert.equal(P.fontKey, "zenkaku");
  assert.deepEqual(cols(P), ["今どこ？駅前で待ってる"], "no spaces are drawn between Japanese words");
  assert.equal(R.measure({ kind: "shout", text: "ふざけんな！！" }, spec, measureText).fontKey, "delagothic");
  assert.equal(R.measure({ kind: "speech", text: "負けた", dir: "h" }, spec, measureText).vertical, undefined, "dir h keeps it across");
});

test("columns break between phrases, never inside one, and keep 禁則", () => {
  const t = (text, kind = "speech") => cols(R.measure({ kind, text }, spec, measureText));
  assert.deepEqual(t("次は誰だ？ ほら、 来いよ。 脈のある奴なら 誰でもいい。"), ["次は誰だ？", "ほら、来いよ。", "脈のある奴なら", "誰でもいい。"]);
  assert.deepEqual(t("その夜、 バー・ナインにて。", "caption"), ["その夜、", "バー・ナインにて。"]);
  // a run with no spaces still breaks, but never puts 、。」 or a small kana at a column's head, nor 「 at its foot
  for (const c of t("そんなこと言ったって、しょうがないじゃないかよ「本当に」って。")) {
    assert.ok(!/^[、。」』！？ーっゃゅょッャュョ…]/.test(c), "bad head: " + c);
    assert.ok(!/[「『]$/.test(c), "bad foot: " + c);
  }
  // the words are all there, in order
  assert.equal(t("いつか絶対 あんたに 勝つんだから！").join(""), "いつか絶対あんたに勝つんだから！");
});

test("columns run right to left in the drawing, and a column is one standing <text>", () => {
  const L = R.measure({ kind: "speech", text: "次は誰だ？ ほら、 来いよ。", at: [0.5, 0.5] }, spec, measureText);
  const svg = R.letteringSvg([L]);
  const xs = [...svg.matchAll(/<text x="([\d.]+)"[^>]*writing-mode="vertical-rl"/g)].map((m) => +m[1]);
  assert.equal(xs.length, L.lines.length);
  assert.ok(xs.every((x, i) => i === 0 || x < xs[i - 1]), "each next column lies to the left");
});

test("the Letterer gives Japanese a tall balloon that breaks between phrases, read right to left", () => {
  const page = { id: "p1", number: 1, layout: { rtl: true, rows: [{ h: 1, panels: [{ w: 1, id: "a", board: { who: [], lines: [
    { kind: "speech", speaker: "", text: "頼む、 この一球だけ 撞いてくれ。 一球だけ。", source_id: "L1" },
    { kind: "speech", speaker: "", text: "もう 球が 見えねえ。", source_id: "L2" }] } }] }] }, text: [] };
  const items = R.autoPlace(page, spec, {}, measureText);
  assert.equal(items.length, 2);
  for (const it of items) {
    const L = R.measure(it, spec, measureText);
    assert.ok(L.vertical && L.ry > L.rx * 1.05, "tall: " + it.text);
    assert.equal(L.lines.slice(1).filter((c) => c.length && !L.toks[c[0]].gap).length, 0, "no break inside a phrase: " + cols(L).join("|"));
  }
  assert.ok(items[0].at[0] > items[1].at[0] || items[0].at[1] < items[1].at[1], "the first line is read first (right, or above)");
});
