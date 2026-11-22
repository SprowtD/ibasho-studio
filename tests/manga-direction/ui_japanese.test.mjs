// The Japanese switch, in a real browser: EN / 日本語 in the top bar switches every screen, the choice is kept after a reload and
// on the other screens, a Japanese browser starts in Japanese, Settings can switch back, the person's own words and the page
// picture are never translated, and nothing spills sideways on a phone. Same safety as the other screen tests: its own port,
// scratch saved work, a do-nothing `codex`. Needs playwright-core (set IBASHO_PLAYWRIGHT) and a Chromium.
// IBASHO_JA_SHOTS=<folder> also saves phone-size screenshots of the main screens in Japanese there (JPEG).
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  Japanese switch (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5405, tmp = scratch("uija"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-ja-test";
const SHOTS = process.env.IBASHO_JA_SHOTS || "";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
// a scene on the anime side, so its screen has something on it
const sdir = path.join(tmp, "anime", "pier"); fs.mkdirSync(sdir, { recursive: true });
fs.writeFileSync(path.join(sdir, "scene.json"), JSON.stringify({ id: "pier", title: "The pier", project: "", made: new Date().toISOString() }));
fs.writeFileSync(path.join(sdir, "SCENE_PLAN.json"), JSON.stringify({ scene_id: "pier", title: "The pier", dialogue: [{ line_id: "L1", speaker: "Mara", text: "Save" }],
  shots: [{ shot_id: "S01", duration: 3, scene_type: "establishing", camera: { framing: "wide", move: "still" }, action: "The pier at dusk.", lines: ["L1"] }] }));
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
const text = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; }, sel);
const hasKana = (s) => /[぀-ヿ一-鿿]/.test(s || "");
// what sticks out sideways on a phone: the page itself, and any visible button whose words do not fit in it (a row that scrolls
// sideways on purpose is left out)
const spill = (page) => page.evaluate(() => {
  const out = []; const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 1) out.push("page " + document.documentElement.scrollWidth + " > " + W);
  const scrolls = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return true; } return false; };
  for (const b of document.querySelectorAll("button, .btn, a.wsb, .tab, .seg, summary")) {
    const r = b.getBoundingClientRect(); if (!r.width || !r.height || b.closest("dialog:not([open]), [hidden]")) continue;
    if (r.right > W + 1 && getComputedStyle(b).position !== "fixed" && !scrolls(b)) out.push("off the right: " + b.textContent.trim().slice(0, 30));
    if (b.scrollWidth > b.clientWidth + 2 && getComputedStyle(b).overflow !== "visible" && b.clientWidth > 0) out.push("cut: " + b.textContent.trim().slice(0, 30));
  }
  return out;
});
const openProj = async (page) => { // the test chapter open in the editor, as a person picks it from the project list
  await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { const s = document.getElementById("projSel"); s.value = id; s.dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && document.querySelector("#side [data-page]"), ID, { timeout: 15000 });
};
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });

  // 1. An English browser starts in English; the top-bar switch turns everything Japanese and the choice sticks
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  const asked = []; page.on("dialog", (d) => { asked.push(d.message()); d.accept(); });
  await page.goto(U + "/"); await openProj(page);
  ok(await page.evaluate(() => document.documentElement.lang) === "en", "an English browser starts in English (<html lang=en>)");
  ok(await text(page, "#undoBtn") === "Undo" && await text(page, "#langBtn") === "EN/日本語", "English labels, and the EN / 日本語 switch is in the top bar");
  const svgBefore = await page.evaluate(() => [...document.querySelectorAll("#page text")].map((t) => t.textContent).join("|"));
  await Promise.all([page.waitForNavigation(), page.click("#langBtn")]);
  await openProj(page);
  ok(await page.evaluate(() => document.documentElement.lang) === "ja" && await page.evaluate(() => localStorage.getItem("ibasho-lang")) === "ja", "the switch picks Japanese: <html lang=ja>, kept in this browser");
  const labels = { "#undoBtn": "元に戻す", "#redoBtn": "やり直す", "#exportBtn": "書き出し", "#homeBtn": "ホーム", "#mangaBtn": "マンガ", '#modeTabs [data-mode="letter"] span': "写植", '#modeTabs [data-mode="layout"] span': "コマ割り", '#modeTabs [data-mode="art"] span': "作画", '#modeTabs [data-mode="chapter"] span': "チャプター", '#modeTabs [data-mode="series"] span': "シリーズ" };
  for (const [sel, ja] of Object.entries(labels)) ok(await text(page, sel) === ja, `manga editor: ${sel} reads ${ja} (got ${await text(page, sel)})`);
  ok(await page.getAttribute("#settingsBtn", "title") === "設定", "tooltips are translated too (Settings = 設定)");
  const svgAfter = await page.evaluate(() => [...document.querySelectorAll("#page text")].map((t) => t.textContent).join("|"));
  ok(svgAfter === svgBefore, "the page picture (balloons, the person's own words) is not translated");
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="letter"]');
  await page.click("#addDetails summary"); await page.click('#addMenu [data-add="speech"]'); await page.waitForSelector("#textIn", { state: "visible" });
  await page.fill("#textIn", "Save"); await page.waitForTimeout(300);
  ok(await page.inputValue("#textIn") === "Save", "words typed into a balloon stay as typed (\"Save\" is not turned into 保存)");
  await page.click("#undoBtn");
  // a confirm() speaks Japanese too
  asked.length = 0; await page.evaluate(() => confirm("Close without saving these strokes?"));
  ok(asked.length === 1 && hasKana(asked[0]) && !/strokes/.test(asked[0]), "confirm() messages speak Japanese: " + asked[0]);

  // 2. A reload keeps it, and so does every other screen
  await page.reload(); await openProj(page);
  ok(await text(page, "#undoBtn") === "元に戻す", "after a reload the editor is still Japanese");
  const screens = [
    ["/connections", "main h2", "接続"],
    ["/create", ".appbar a[href='/create']", "作成"],
    ["/library", ".appbar a[href='/library']", "ライブラリ"],
    ["/anime/", ".appbar a[href='/anime/#/']", "アニメ"],
  ];
  for (const [url, sel, ja] of screens) {
    await page.goto(U + url); await page.waitForTimeout(600);
    ok(await page.evaluate(() => document.documentElement.lang) === "ja", `${url}: <html lang=ja>`);
    ok(await text(page, sel) === ja, `${url}: ${sel} reads ${ja} (got ${await text(page, sel)})`);
    ok(await text(page, ".ws a[href='/#home'], #homeBtn") === "ホーム", `${url}: the Home link reads ホーム`);
    ok(!!(await page.$("#langBtn")), `${url}: the EN / 日本語 switch is in the top bar`);
  }
  // the anime screen's own words, and a scene's line ("Save", the person's) left alone
  await page.goto(U + "/anime/#/scene/pier"); await page.waitForTimeout(1200);
  const animeText = await page.evaluate(() => document.querySelector("#app").innerText);
  ok(hasKana(animeText), "the anime scene screen shows Japanese");
  ok(await page.evaluate(() => [...document.querySelectorAll("#app textarea, #app input")].some((e) => e.value === "Save")) || !/保存/.test(animeText.split("Mara")[1] || ""), "a scene's own line (\"Save\") is not translated");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await ctx.close();

  // 3. A Japanese browser starts in Japanese; Settings switches back to English, which sticks
  const jctx = await browser.newContext({ locale: "ja-JP", viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const jp = await jctx.newPage(); const jerr = []; jp.on("pageerror", (e) => jerr.push(String(e)));
  await jp.goto(U + "/connections"); await jp.waitForTimeout(500);
  ok(await jp.evaluate(() => document.documentElement.lang) === "ja" && await jp.evaluate(() => localStorage.getItem("ibasho-lang")) === null, "a Japanese browser starts in Japanese without being asked");
  await jp.click("#settingsBtn"); await jp.waitForSelector("#sharedSettings[open] .set-lang");
  await Promise.all([jp.waitForNavigation(), jp.click('#sharedSettings [data-lang="en"]')]);
  ok(await jp.evaluate(() => document.documentElement.lang) === "en" && await text(jp, "main h2") === "Connections", "Settings, Language, English: back to English");
  await jp.goto(U + "/library"); ok(await jp.evaluate(() => document.documentElement.lang) === "en", "and English sticks on the next screen, even in a Japanese browser");
  await jp.evaluate(() => localStorage.setItem("ibasho-lang", "ja"));

  // 4. Phone width (390 px), Japanese: nothing sticks out sideways; screenshots when asked
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  await jp.goto(U + "/"); await jp.evaluate((id) => localStorage.setItem("ld-project", id), ID);
  const phone = [["home", "/#home"], ["editor-lettering", "/", "letter"], ["editor-chapter", "/", "chapter"], ["editor-series", "/", "series"], ["connections", "/connections"], ["create", "/create"], ["library", "/library"], ["anime", "/anime/#/"], ["anime-scene", "/anime/#/scene/pier"]];
  const look = async (url, mode) => { await jp.goto("about:blank"); await jp.goto(U + url); await jp.waitForTimeout(900); // (about:blank first: a change of #hash alone would not load the screen again)
    if (mode) { await jp.evaluate((m) => { const b = document.querySelector(`#modeTabs [data-mode="${m}"]`); if (b) b.click(); }, mode); await jp.waitForTimeout(500); } };
  for (const [name, url, mode] of phone) {
    await jp.evaluate(() => localStorage.setItem("ibasho-lang", "en")); await look(url, mode); const en = await spill(jp);
    await jp.evaluate(() => localStorage.setItem("ibasho-lang", "ja")); await look(url, mode); const ja = await spill(jp);
    ok(ja.length <= en.length, `phone, ${name}: nothing more sticks out sideways in Japanese than in English (ja: ${ja.slice(0, 4).join("; ")} | en: ${en.slice(0, 4).join("; ")})`);
    if (SHOTS) await jp.screenshot({ path: path.join(SHOTS, `ja-${name}.jpg`), type: "jpeg", quality: 60, fullPage: false });
  }
  ok(!jerr.length, "no page errors (Japanese browser): " + jerr.join(" | "));
} finally {
  if (browser) await browser.close(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
}
done("Japanese switch");
