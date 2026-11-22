// "Start from an idea" on Home, in a real browser: the Writer's script lands in the New project form, the person changes it,
// and only their press of Create makes a project. A reload while the Writer works picks the draft up again.
// Runs on a COPY of the app (tests/harness.mjs): scratch saved work, its own port, a stand-in `codex` that answers with a fixed chapter.
// Needs playwright-core (set IBASHO_PLAYWRIGHT) and a Chromium; skipped when there is none.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { ok, done } from "./helpers.mjs";
import { startApp, copyApp, codexCalls } from "../harness.mjs";
const pwDir = process.env.IBASHO_PLAYWRIGHT || path.join(os.homedir(), "Documents/clocked/web/node_modules/playwright-core");
if (!fs.existsSync(pwDir)) { console.log("skipped  a chapter from an idea, on the screen (no playwright-core; set IBASHO_PLAYWRIGHT)"); process.exit(0); }
const { chromium } = createRequire(import.meta.url)(pwDir);
const cache = path.join(os.homedir(), ".cache/ms-playwright"); let exe = process.env.IBASHO_CHROME;
if (!exe) for (const d of fs.readdirSync(cache).sort().reverse()) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/chrome", "chrome-linux64/chrome"]) if (!exe && fs.existsSync(path.join(cache, d, rel))) exe = path.join(cache, d, rel);

const SCRIPT = ["Kai stands at the ferry rail in the rain, a paper ticket in his fist.", "Kai: I am going to cross tonight, whatever it takes.", "Aya lowers the gangway chain without looking at him.", "Aya: The last ferry left an hour ago.", "Kai folds the ticket and steps onto the empty deck anyway."].join("\n\n");
const STORY = { hero: "Kai", aim: "Kai wants to cross tonight.", aim_line: "I am going to cross tonight, whatever it takes.", turn: "The ferry Aya guards is already Kai's own.", begins: "Kai waits for someone to let him cross.", ends: "Kai steps onto the deck without asking." };
const IDEA = "A boy has to get across the bay tonight, and the ferry keeper will not let him.";
const PLAN = { hook: "A ferry that only sails for its owner.", hero: "Kai", aim: "Kai wants to cross tonight.", turn: "The ferry is Kai's own.", begins: "Kai waits.", ends: "Kai sails.",
  acts: [{ part: "Setup", pages: 2, what: "Kai at the rail." }, { part: "Development", pages: 4, what: "Aya refuses." }, { part: "Twist", pages: 3, what: "The ferry is his." }, { part: "Ending", pages: 2, what: "He sails." }] };
// the stand-in Codex gives the same answer every time: it carries a talk round (say, plan, questions) and a chapter (title, script, story)
const app = await startApp(copyApp(), { env: { FAKE_CODEX_ANSWER: JSON.stringify({ say: "Kai wants across; Aya stands in the way.", plan: PLAN, questions: ["Does Kai cross alone? (I would say yes.)"], title: "The Last Crossing", script: SCRIPT, story: STORY }), FAKE_CODEX_SLEEP: "2500" } });
const projects = path.join(app.app, "page-editor", "projects"); let browser;
try {
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  for (const [name, viewport] of [["desktop", { width: 1400, height: 1000 }], ["phone", { width: 390, height: 800 }]]) {
    const page = await browser.newPage({ viewport }); const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
    await page.goto(app.base + "/"); await page.waitForSelector("#newProj:not([hidden])");
    await page.click("#newProj > summary");
    ok(await page.isVisible("#npIdea") && await page.isVisible("#npIdeaGo") && await page.isVisible("#npIdeaSkip") && !(await page.isVisible("#npTalk")), `${name}: the form has an idea box, “Talk it through” and “Skip the talk”; no talk yet`);
    const box = await page.evaluate(() => { const r = document.getElementById("npIdeaGo").getBoundingClientRect(); return { right: r.right, wide: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }; });
    ok(box.right <= box.wide + 1 && box.scroll <= box.wide + 1, `${name}: nothing runs off the side: ` + JSON.stringify(box));
    await page.click("#npIdeaGo");
    ok(/a little more/.test(await page.textContent("#npIdeaHint")), `${name}: an empty idea is asked for more, and nothing is sent`);
    const before = codexCalls(app).length;
    await page.fill("#npIdea", IDEA); await page.click(name === "desktop" ? "#npIdeaGo" : "#npIdeaSkip");
    await page.waitForFunction(() => document.getElementById("npIdeaGo").disabled && document.getElementById("npIdeaSkip").disabled && /Writer/.test(document.getElementById("npIdeaHint").textContent));
    ok(true, `${name}: while the Writer works the buttons wait and the form says so`);
    if (name === "desktop") { // a reload in the middle: the draft is picked up again
      await page.waitForFunction(() => localStorage.getItem("ibasho.idea")); // (the draft's id is kept once the Writer's job is taken: a reload before that has nothing to pick up)
      await page.reload(); await page.waitForSelector("#newProj:not([hidden])");
      // the talk: the Writer's plan and question come back; the person changes the plan, answers, and asks for the script
      await page.waitForSelector("#npTalk:not([hidden])", { timeout: 20000 });
      ok(/Aya stands in the way/.test(await page.textContent("#npTalkLog")) && /Does Kai cross alone/.test(await page.textContent("#npTalkLog")), `${name}: the Writer's words and its question are shown`);
      ok(await page.inputValue("#npPlanHook") === PLAN.hook && await page.locator("#npPlanActs .act").count() === 4 && /About 11 pages/.test(await page.textContent("#npPlanTotal")), `${name}: the plan is filled in, four parts, the pages added up`);
      ok(await page.inputValue("#npScript") === "", `${name}: no script yet`);
      const wide = await page.evaluate(() => ({ w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth })); ok(wide.s <= wide.w + 1, `${name}: the talk fits the screen`);
      await page.fill("#npPlanEnds", "Kai gives the ferry to Aya."); await page.fill("#npPlanActs .act:nth-child(4) .actPages", "3");
      ok(/About 12 pages/.test(await page.textContent("#npPlanTotal")), `${name}: the page count follows the person's change`);
      await page.click("#npReplyGo"); ok(/answer to the Writer first/.test(await page.textContent("#npIdeaHint")), `${name}: an empty answer is not sent`);
      await page.fill("#npReply", "Yes, alone."); await page.click("#npReplyGo");
      await page.waitForFunction(() => document.querySelectorAll("#npTalkLog > li").length === 3 && !document.getElementById("npReplyGo").disabled, null, { timeout: 20000 });
      ok(await page.inputValue("#npReply") === "" && /You/.test(await page.textContent("#npTalkLog > li:nth-child(2)")), `${name}: the answer is in the talk and the box is empty again`);
      const told = fs.readFileSync(path.join(app.saved, "ideas", await page.evaluate(() => localStorage.getItem("ibasho.idea")), "TALK_DATA.md"), "utf8");
      ok(/Yes, alone\./.test(told) && /Kai gives the ferry to Aya\./.test(told) && /"pages": 3/.test(told), `${name}: the Writer was given the answer and the person's changes to the plan`);
      await page.click("#npWriteGo"); }
    await page.waitForFunction((s) => document.getElementById("npScript").value === s, SCRIPT, { timeout: 20000 });
    ok(await page.evaluate(() => document.getElementById("newProj").open), `${name}: the form is open on the script`);
    ok(/Read it and change anything.*Nothing has been storyboarded/.test(await page.textContent("#npIdeaHint")), `${name}: it says to read and change it, and that nothing is storyboarded: ` + await page.textContent("#npIdeaHint"));
    ok(await page.inputValue("#npName") === "The Last Crossing", `${name}: the Writer's title is offered as the name`);
    ok(await page.inputValue("#npIdea") === IDEA, `${name}: the idea is still in its box`);
    ok(codexCalls(app).length === before + (name === "desktop" ? 3 : 1), `${name}: ${name === "desktop" ? "two talk rounds and the script" : "one run of the Writer"}, no Paneler yet`);
    ok(fs.readdirSync(projects).length === (name === "desktop" ? 0 : 1), `${name}: no project was made by the Writer`);
    // the person changes the script, then creates
    const mine = SCRIPT + "\n\nAya: Then row.";
    if (name === "phone") await page.fill("#npScript", mine);
    await page.fill("#npName", "Crossing " + name); await page.click("#npGo");
    await page.waitForFunction(() => !document.getElementById("newProj").open, null, { timeout: 10000 });
    const id = fs.readdirSync(projects).find((d) => d.startsWith("crossing-" + name)), dir = path.join(projects, id || "none");
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
    ok(meta.story && meta.story.from_idea === true && meta.story.ends === STORY.ends, `${name}: the project remembers it came from an idea, with the Writer's notes`);
    ok(fs.readFileSync(path.join(dir, "script.md"), "utf8") === (name === "phone" ? mine : SCRIPT), `${name}: the script is the one in the box, word for word`);
    ok(name === "phone" ? meta.story.edited === true && !meta.paneler_note : !meta.story.edited && /turn of the story/.test(meta.paneler_note || ""), `${name}: ${name === "phone" ? "a changed script marks the notes as possibly stale" : "the turn goes to the Paneler as a note"}`);
    ok(await page.evaluate(() => localStorage.getItem("ibasho.idea")) === null && await page.inputValue("#npScript") === "" && !(await page.isVisible("#npTalk")), `${name}: the draft is let go and the form is empty again`);
    ok(errors.length === 0, `${name}: no script errors: ` + errors.join(" | "));
    await page.close();
  }
} finally { if (browser) await browser.close(); await app.stop(); }
done("a chapter from an idea, on the screen");
