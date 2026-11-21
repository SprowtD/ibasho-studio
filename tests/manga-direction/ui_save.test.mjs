// The Save button beside Undo and Redo, in a real browser: typing in a balloon is saved even while the box is still being typed in,
// Save changes sends it at once, and Export saves first, so an export never holds changes that are not on disk. Same safety as the
// other screen tests: its own port, scratch saved work, a do-nothing `codex`. Needs playwright-core (set IBASHO_PLAYWRIGHT) and a Chromium.
import { spawn, execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { APP, scratch, ok, done } from "./helpers.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  save button (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);
const PORT = 5386, tmp = scratch("uisave"), bin = path.join(tmp, "bin"), U = `http://127.0.0.1:${PORT}`, PE = path.join(APP, "page-editor"), ID = "zz-ui-save-test";
fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, "codex"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
const dir = path.join(PE, "projects", ID);
fs.mkdirSync(dir, { recursive: true }); fs.cpSync(path.join(APP, "tests/manga-direction/fixtures/ferry"), dir, { recursive: true, force: true });
execFileSync("node", [path.join(APP, "tools/build_spec.mjs"), dir]);
const N = JSON.parse(fs.readFileSync(path.join(dir, "spec.json"), "utf8")).pages.length;
const srv = spawn("node", [path.join(PE, "server.mjs"), String(PORT)], { stdio: "ignore",
  env: { ...process.env, PATH: bin + ":" + process.env.PATH, STUDIO_SAVED: path.join(tmp, "saved"), STUDIO_ANIME: path.join(tmp, "anime"), STUDIO_LOOKS: path.join(tmp, "looks"), OPENROUTER_BASE: "http://127.0.0.1:9" } });
const onDisk = async () => JSON.stringify(await (await fetch(U + "/api/spec?p=" + ID)).json().catch(() => ({})));
let browser;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(U + "/api/ping")).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 200)); }
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, acceptDownloads: true });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
  await page.goto(U + "/"); await page.waitForSelector("#projSel option", { state: "attached" });
  await page.evaluate((id) => { document.getElementById("projSel").value = id; document.getElementById("projSel").dispatchEvent(new Event("change", { bubbles: true })); }, ID);
  await page.waitForFunction((id) => localStorage.getItem("ld-project") === id && /pages/.test(document.getElementById("sbProj").textContent) && document.getElementById("status").textContent === "Saved", ID);
  await page.click('#side [data-page="0"]'); await page.click('#modeTabs [data-mode="letter"]');
  await page.waitForSelector("#saveBtn:not([hidden])");
  ok(await page.evaluate(() => { const b = document.getElementById("saveBtn"), r = document.getElementById("redoBtn"); return b.previousElementSibling === r && b.disabled && b.textContent === "Saved"; }), "Save sits right after Redo and says Saved when nothing is waiting");
  if (process.env.IBASHO_SHOTS) await page.screenshot({ path: path.join(process.env.IBASHO_SHOTS, "save-toolbar.png"), clip: { x: 0, y: 0, width: 1400, height: 160 } });

  // a new balloon, typed in without leaving the box: saved by itself a moment later
  await page.click("#addDetails summary"); await page.click('#addMenu [data-add="speech"]'); await page.waitForSelector("#textIn", { state: "visible" });
  await page.fill("#textIn", ""); await page.focus("#textIn"); await page.keyboard.type("First words");
  ok(await page.evaluate(() => { const b = document.getElementById("saveBtn"); return !b.disabled && /Save changes|Saving/.test(b.textContent); }), "typing turns the button on (Save changes)");
  await page.waitForFunction(() => document.getElementById("saveBtn").textContent === "Saved", null, { timeout: 15000 });
  ok((await onDisk()).includes("First words"), "typing is saved even while the box is still being typed in");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === "textIn"), "(the box was never left)");

  // Save changes sends at once
  await page.focus("#textIn"); await page.keyboard.type(" and more");
  await page.click("#saveBtn");
  await page.waitForFunction(() => document.getElementById("saveBtn").textContent === "Saved", null, { timeout: 15000 });
  ok((await onDisk()).includes("First words and more"), "Save changes puts the change on disk at once");
  ok(/^Saved\./.test(await page.textContent("#status")), "the status says it was saved: " + await page.textContent("#status"));

  // Ctrl+S too
  await page.focus("#textIn"); await page.keyboard.type("!"); await page.keyboard.press("Control+s");
  await page.waitForFunction(() => document.getElementById("saveBtn").textContent === "Saved", null, { timeout: 15000 });
  ok((await onDisk()).includes("First words and more!"), "Ctrl+S saves");

  // Undo after a live save still takes the typing back in one step
  await page.click("#undoBtn"); await page.waitForFunction(() => document.getElementById("saveBtn").textContent === "Saved", null, { timeout: 15000 });
  ok(!(await onDisk()).includes("and more!"), "Undo still works after a save, and is saved too");
  await page.click("#redoBtn"); await page.waitForFunction(() => document.getElementById("saveBtn").textContent === "Saved", null, { timeout: 15000 });

  // Export saves first: an unsaved change goes to disk before the pages are drawn
  await page.evaluate(() => { const t = document.getElementById("textIn"); t.focus(); t.value += " (export)"; t.dispatchEvent(new Event("input", { bubbles: true })); });
  ok(!(await onDisk()).includes("(export)"), "(not yet on disk)");
  await page.click("#exportBtn"); await page.waitForSelector("#exDlg[open]"); // the toolbar's Export: this page
  await page.click('#exFormat [data-format="png"]');
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#exGo")]);
  ok(!!dl && (await onDisk()).includes("First words and more! (export)"), "Export saved the change before drawing the pages");

  // leaving the page with unsaved typing asks first
  await page.evaluate(() => { const t = document.getElementById("textIn"); t.value += " x"; t.dispatchEvent(new Event("input", { bubbles: true })); });
  ok(await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), "closing or reloading with unsaved changes asks first");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
} finally {
  if (browser) await browser.close(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
}
done("save button");
