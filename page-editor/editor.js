/* Page editor: drag balloons and tails, change type / font / size, live checks, save, export PNG.
 * Saves to the artifact database when published on claude.ai, or to the local studio server when run locally.
 */
(function () {
  "use strict";
  const R = window.PageRender, W = R.W, H = R.H;
  const NO_PROJECT = { id: "", label: "", dir: "", doc: "" }; // a new copy of the app starts empty: Home, and "New project"
  let PROJECTS = []; // filled from the server (fetchProjects): the person's own projects, and any samples beside the app
  let proj = NO_PROJECT, SPEC_URL = "", BASE = "", DOC = "";
  try { const saved = localStorage.getItem("ld-project"); const f = PROJECTS.find((q) => q.id === saved); if (f) { proj = f; SPEC_URL = f.dir + "spec.json"; BASE = f.dir; DOC = f.doc; } } catch (e) { /* no storage */ }
  const $ = (id) => document.getElementById(id);

  let spec = null, original = null, pageIdx = 0, sel = -1, guides = true, mode = "letter", selP = null, tmplFilter = "all", selB = null, shaping = false, selV = -1, placing = null; // selB: the chosen break-out; shaping: the chosen panel's corners can be dragged (selV = the chosen corner); placing: the corners tapped so far for a new free-shape panel
  let hist = [], redo = [], measured = [];
  let store = { kind: "none" }, saveTimer = null, dirty = false, edited = false;
  let bible = null, drafts = {}, savedPages = {}, saveFails = 0;
  // Where a panel can be drawn. Only Codex is connected in this test; the others arrive with the bring-your-own-models settings.
  const SOURCES = [
    { id: "codex", label: "Codex (ChatGPT subscription)", on: true, hint: "Uses the image tool in your Codex subscription. No extra cost." },
    { id: "openai", label: "OpenAI API key (not connected yet)", on: false },
    { id: "openrouter", label: "OpenRouter (not connected yet)", on: false },
    { id: "runpod", label: "RunPod open model (not connected yet)", on: false },
    { id: "local", label: "This computer, local model (not connected yet)", on: false },
  ];

  // ---------- text measuring (canvas, same fonts as the SVG) ----------
  const mctx = document.createElement("canvas").getContext("2d");
  const mcache = new Map();
  function measureText(font, s) {
    const k = font + "|" + s;
    if (!mcache.has(k)) { mctx.font = font; mcache.set(k, mctx.measureText(s).width); }
    return mcache.get(k);
  }

  const page = () => spec.pages[pageIdx];
  const items = () => page().text;

  // ---------- history ----------
  function snap() {
    const s = JSON.stringify(spec);
    if (hist[hist.length - 1] !== s) { hist.push(s); if (hist.length > 200) hist.shift(); redo = []; edited = true; queueSave(); }
    updateUndo();
  }
  function undo() { if (hist.length < 2) return; redo.push(hist.pop()); spec = JSON.parse(hist[hist.length - 1]); clampSel(); queueSave(); render(); }
  function redoFn() { if (!redo.length) return; const s = redo.pop(); hist.push(s); spec = JSON.parse(s); clampSel(); queueSave(); render(); }
  function updateUndo() { $("undoBtn").disabled = hist.length < 2; $("redoBtn").disabled = !redo.length; updateSaveBtn(); }
  /** Typing in a box or dragging a slider changes the page at once; it is saved a moment later even before the box is left (undo still takes the whole change). */
  function liveEdit() { edited = true; queueSave(); }
  function clampSel() {
    if (pageIdx >= spec.pages.length) pageIdx = 0;
    if (sel >= items().length) sel = -1;
    if (selP && !findPanel(selP)) selP = null;
    if (selB && !findBo(selB)) selB = null;
  }
  // ---------- a panel's own shape: corners placed by hand, as shares of the plain panel's box (R.layoutGeom gives that box as c.frame) ----------
  const VMIN = -0.5, VMAX = 1.5;
  /** The chosen panel's cell and its shape's corners on the page: [{ k, x, y }] in page units. */
  function shapeCorners() {
    const c = selP && page().layout && geomById(page()).get(selP); if (!c) return null;
    const f = c.frame || c.bbox, w = f[2] - f[0], h = f[3] - f[1], sh = c.panel.shape;
    const at = ([u, v]) => [c.mirrored ? f[2] - u * w : f[0] + u * w, f[1] + v * h];
    const plain = () => { const mir = !c.inset && isRtl(); return c.drawPoly.map(([x, y]) => [round3((mir ? f[2] - x : x - f[0]) / w), round3((y - f[1]) / h)]); }; // the panel as it is now (slanted gutters and all), as a shape
    return { c, f, w, h, at, pts: (R.validShape(sh) ? sh : plain()).map((p, k) => { const [x, y] = at(p); return { k, x, y }; }), plain };
  }
  const toShape = (S, x, y) => [round3(Math.min(VMAX, Math.max(VMIN, (S.c.mirrored || (!S.c.inset && isRtl()) ? S.f[2] - x * W : x * W - S.f[0]) / S.w))), round3(Math.min(VMAX, Math.max(VMIN, (y * H - S.f[1]) / S.h)))];
  function ownShape() { const S = shapeCorners(); if (!S) return null; if (!R.validShape(S.c.panel.shape)) S.c.panel.shape = S.plain(); return S; } // from now on the panel keeps a shape of its own
  function finishFree() {
    const pts = placing || []; placing = null;
    if (pts.length < 3) { render(); return setStatus("A panel needs three corners or more. Nothing was added."); }
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(round3), w = box[2] - box[0], h = box[3] - box[1];
    if (w < 0.05 || h < 0.04) { render(); return setStatus("That shape is too small to be a panel. Nothing was added."); }
    const p = page(), n = { id: newId(), box, type: "framed", shape: pts.map(([x, y]) => [round3((x - box[0]) / w), round3((y - box[1]) / h)]) };
    if (spec.kind === "storyboard") n.board = { shot: "", action: "", who: [], lines: [] };
    mutateLayout(() => { (p.layout.insets = p.layout.insets || []).push(n); });
    selP = n.id; selB = null; shaping = true; selV = -1; render(); snap();
    setStatus("The panel is on the page, over the others. Drag its corners to adjust it, then pick or draw its art.", "ok");
  }

  // ---------- the Toner: screentone made by code over the Artist's flat greys, kept as layers; shown and exported as one flat picture a panel ----------
  const tonerOn = () => !!(bible && bible.tone_by === "toner" && !bible.colour);
  const toneBusy = (pg) => { const j = jobs["tone:" + (pg || page()).id]; return !!j && (j.status === "waiting" || j.status === "drawing"); };
  const cellOf = (id, p = page()) => (p.layout ? R.allPanels(p.layout).find((c) => c.panel.id === id) : null);
  /** Has this page a picture the Toner can work on: a drawn panel, a drawn break-out, or the page itself when it is one whole picture? */
  const canTone = (p) => (p.layout ? R.allPanels(p.layout).some((c) => c.panel.image) || (p.layout.breakouts || []).some((b) => b.image) : !!p.art);
  async function tonePages(list, only) {
    if (!canDraw()) return setStatus("The Toner needs Ibasho running on your computer.", "error");
    list = list.filter(canTone); if (!list.length) return setStatus("There is no drawn panel to tone yet.", "error");
    clearTimeout(saveTimer); await save(); // the Toner reads the page as saved
    let n = 0;
    for (const p of list) { try { const r = await fetch(`/api/tone?p=${encodeURIComponent(proj.id)}&page=${encodeURIComponent(p.id)}${only ? "&panel=" + encodeURIComponent(only) : ""}`, { method: "POST" }); if (r.ok) { const j = await r.json(); jobs[j.panel] = Object.assign(j, { now: Date.now() }); n++; } } catch (e) { /* counted below */ } }
    pollJobs(); render();
    setStatus(n ? `The Toner is at work on ${only ? "the panel" : n === 1 ? "the page" : n + " pages"}: under a minute a page. It shows by itself when it is done.` : "The Toner could not start.", n ? "ok" : "error");
  }
  // "Tone a new picture by itself" (Series, off unless turned on): a page a picture has just landed on is toned as soon as the Toner is free for it
  const toneDue = new Set();
  const toneAuto = () => tonerOn() && !!bible.tone_auto && canDraw() && store.kind === "local" && proj.own !== false;
  function toneWhenFree(pageIds) {
    if (!toneAuto()) { toneDue.clear(); return; }
    for (const id of pageIds || []) toneDue.add(id);
    const ready = [...toneDue].map((id) => spec.pages.find((p) => p.id === id)).filter((p) => p && canTone(p) && !toneBusy(p));
    for (const id of [...toneDue]) { const p = spec.pages.find((q) => q.id === id); if (!p || !canTone(p) || !toneBusy(p)) toneDue.delete(id); } // a page still being toned stays due: it is toned again when that ends
    if (ready.length) tonePages(ready);
  }
  // the chapter's dot size and kind of tone, chosen on the screen (kept in the project's toner.json)
  let toneSet = null, toneSetFor = "";
  const TONE_NAMES = { 40: "very big dots", 50: "big dots", 60: "standard", 70: "fine dots", 85: "very fine dots" };
  const toneSetKey = (s) => (s.kind === "noise" ? "noise" : "dots:" + s.lines);
  /** How the panel was toned, read from its layer names ("dots 60 lines 20%", "noise grey 20%"): "dots:60" | "noise" | "". */
  const tonedAs = (t) => { const n = ((t && t.layers) || []).find((x) => /noise grey|dots \d+ lines/.test(x)); return !n ? "" : /noise grey/.test(n) ? "noise" : "dots:" + /dots (\d+) lines/.exec(n)[1]; };
  async function loadToneSet() {
    if (!canDraw() || !proj || toneSetFor === proj.id) return; toneSetFor = proj.id; toneSet = null;
    try { const r = await fetch("/api/tone?settings&p=" + encodeURIComponent(proj.id)); if (r.ok) { toneSet = await r.json(); render(); } } catch (e) { toneSetFor = ""; }
  }
  function renderToneSet(t) {
    const box = $("toneSetBox"); box.hidden = !toneSet; if (!toneSet) { loadToneSet(); return; }
    const sel = $("toneSet"), want = toneSet.choices.map((n) => `<option value="dots:${n}">${n} lines to the inch (${TONE_NAMES[n] || "dots"})</option>`).join("") + `<option value="noise">Noise: a fine grain, no dots</option>`;
    if (sel.dataset.made !== want) { sel.innerHTML = want; sel.dataset.made = want; }
    sel.value = toneSetKey(toneSet); sel.disabled = toneBusy();
    const was = tonedAs(t);
    $("toneSetNote").textContent = was && was !== toneSetKey(toneSet) ? "This panel was toned with another choice. Tone the page again to match; tone every page from the Chapter screen so no two sizes meet." : "One choice for the whole chapter, so no two sizes of dot meet. A shade from light to dark is always dots.";
  }
  async function saveToneSet(v) {
    const next = v === "noise" ? { lines: toneSet.lines, kind: "noise" } : { lines: +v.split(":")[1], kind: "dots" };
    let r, j = {}; try { r = await fetch("/api/tone?settings&p=" + encodeURIComponent(proj.id), { method: "PUT", body: JSON.stringify(next) }); j = await r.json(); } catch (e) { render(); return setStatus("The choice could not be saved.", "error"); }
    if (!r.ok) { render(); return setStatus(j.error || "The choice could not be saved.", "error"); }
    toneSet = j; render();
    setStatus(`Saved: ${j.kind === "noise" ? "noise" : j.lines + " lines to the inch"} for this chapter. Pages already toned keep what they have until they are toned again.`, "ok");
  }
  /** What the Toner last made is put on the panels (the renderer shows it only while it still fits the panel). */
  async function takeTone() {
    if (!canDraw() || !spec) return;
    let m = null; try { const r = await fetch("/api/tone?p=" + encodeURIComponent(proj.id)); if (r.ok) m = await r.json(); } catch (e) { /* next time */ }
    if (!m) return; let n = 0;
    let other = 0; const put = (on, t) => { const { id, kind, ...keep } = t; if (JSON.stringify(on.toned || null) !== JSON.stringify(keep)) { on.toned = keep; n++; other++; } }; // break-outs and whole-page pictures
    for (const p of spec.pages) { const rec = m[String(p.id).replace(/[^\w-]/g, "_")]; if (!rec) continue;
      if (!p.layout) { const t = rec.panels.find((x) => x.kind === "page"); if (t && p.art) put(p, t); continue; } // a page that is one whole picture
      for (const b of breakouts(p)) { const t = rec.panels.find((x) => x.kind === "breakout" && x.id === b.id); if (t) put(b, t); }
      for (const c of R.allPanels(p.layout)) { const t = rec.panels.find((x) => !x.kind && x.id === c.panel.id); if (t && JSON.stringify(c.panel.toned || null) !== JSON.stringify(t)) { const { id, ...keep } = t; if (JSON.stringify(c.panel.toned || null) !== JSON.stringify(keep)) { c.panel.toned = keep; n++; } } } }
    if (n) { render(); snap(); setStatus(`The Toner's screentone is on ${n} ${other ? "picture" : "panel"}${n === 1 ? "" : "s"}.`, "ok"); }
  }
  // scraping and painting back by hand: strokes drawn on the panel's flat picture, kept beside the layers, never destroying them
  const TH = { panel: null, page: null, size: [0, 0], strokes: [], tool: "soft", img: null, cur: null, dirty: false };
  function thPaint() {
    const cv = $("toneCanvas"), g = cv.getContext("2d"); if (!TH.img) return;
    g.clearRect(0, 0, cv.width, cv.height); g.drawImage(TH.img, 0, 0, cv.width, cv.height);
    const k = cv.width / TH.size[0]; g.lineCap = "round"; g.lineJoin = "round";
    for (const s of TH.strokes.slice(TH.shown).concat(TH.cur ? [TH.cur] : [])) { // strokes not yet in the saved picture, shown roughly: white for scraping, blue for painting back
      g.strokeStyle = s.tool === "back" ? "rgb(44 99 214 / .35)" : s.tool === "hatch" ? "rgb(255 255 255 / .6)" : "rgb(255 255 255 / .85)"; g.lineWidth = Math.max(2, s.size * k); g.beginPath();
      s.points.forEach(([x, y], i) => (i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k))); if (s.points.length === 1) g.lineTo(s.points[0][0] * k + 0.1, s.points[0][1] * k); g.stroke(); }
    for (const b of $("toneTools").children) b.setAttribute("aria-pressed", b.dataset.tool === TH.tool);
    $("toneSizeOut").textContent = $("toneSize").value + " px"; $("toneUndo").disabled = !TH.strokes.length; $("toneClear").disabled = !TH.strokes.length; $("toneSave").disabled = !TH.dirty || TH.saving;
    $("toneSave").textContent = TH.saving ? "Saving…" : "Save";
  }
  async function thLoad(src) { TH.img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = BASE + src; }); const cv = $("toneCanvas"), k = Math.min(1, 1100 / TH.size[0]); cv.width = Math.round(TH.size[0] * k); cv.height = Math.round(TH.size[1] * k); }
  async function openToneHand() {
    const c = cellOf(selP); if (!c || R.toneState(c) !== "toned") return;
    const t = c.panel.toned; let j = { strokes: [] };
    try { const r = await fetch(`/api/tone/strokes?p=${encodeURIComponent(proj.id)}&page=${encodeURIComponent(page().id)}&panel=${encodeURIComponent(selP)}`); if (!r.ok) throw new Error((await r.json()).error); j = await r.json(); } catch (e) { return setStatus(e.message || "The panel's tone could not be opened.", "error"); }
    Object.assign(TH, { panel: selP, page: page().id, size: j.size, strokes: j.strokes || [], cur: null, dirty: false, saving: false }); TH.shown = TH.strokes.length; // those are already in the picture
    try { await thLoad(t.src); } catch (e) { return setStatus("The toned picture could not be loaded.", "error"); }
    thPaint(); $("toneDlg").showModal();
  }
  async function saveToneHand() {
    TH.saving = true; thPaint();
    try {
      const r = await fetch(`/api/tone/strokes?p=${encodeURIComponent(proj.id)}&page=${encodeURIComponent(TH.page)}&panel=${encodeURIComponent(TH.panel)}`, { method: "PUT", body: JSON.stringify({ size: TH.size, strokes: TH.strokes }) }), j = await r.json();
      if (!r.ok) throw new Error(j.error || "not saved");
      const pg = spec.pages.find((p) => p.id === TH.page), c = pg && cellOf(TH.panel, pg); if (c && c.panel.toned) { c.panel.toned.src = j.src; c.panel.toned.strokes = j.strokes; }
      TH.shown = TH.strokes.length; TH.dirty = false; await thLoad(j.src); render(); snap(); setStatus("Saved. The page and the export show it.", "ok");
    } catch (e) { setStatus("The tone could not be saved: " + e.message, "error"); }
    TH.saving = false; thPaint();
  }

  // ---------- break-outs: a figure drawn by itself (cut out of plain white) and laid over the page, above the panel borders ----------
  const breakouts = (p = spec && spec.pages[pageIdx]) => (p && p.layout && p.layout.breakouts) || [];
  const findBo = (id) => breakouts().find((b) => b.id === id) || null;
  const boJob = (b) => jobs["breakout:" + b.id];
  const boBusy = (b) => { const j = boJob(b); return !!j && (j.status === "waiting" || j.status === "drawing"); };
  /** Break-outs on any page that have their words but no picture, and are not being drawn. */
  const missingBos = () => (spec ? spec.pages.flatMap((p) => breakouts(p)) : []).filter((b) => !b.image && !boBusy(b) && (b.who || b.action));
  async function drawBo(b, quiet) {
    if (!canDraw()) return setStatus("Drawing a break-out needs Ibasho running on your computer.", "error");
    clearTimeout(saveTimer); await save();
    let r, j = {}; try { r = await fetch("/api/breakouts?p=" + encodeURIComponent(proj.id), { method: "POST", body: JSON.stringify({ id: b.id, who: b.who || "", action: b.action || "" }) }); j = await r.json(); } catch (e) { return setStatus("The break-out could not be sent to be drawn.", "error"); }
    if (!r.ok) return setStatus(j.error || "The break-out could not be drawn.", "error");
    jobs[j.panel] = Object.assign(j, { now: Date.now() }); pollJobs(); render();
    if (quiet) return true;
    setStatus("Codex is drawing the break-out: about three minutes. It lands on the page by itself.", "ok");
  }
  /** Newly drawn break-outs are put on the page (the newest take of each). */
  async function takeBreakouts() {
    if (!canDraw() || !spec || !spec.pages.some((p) => breakouts(p).length)) return;
    let m = null; try { const r = await fetch("/api/breakouts?p=" + encodeURIComponent(proj.id)); if (r.ok) m = await r.json(); } catch (e) { /* next time */ }
    if (!m) return; const no = (s) => +(/-take(\d+)\.png$/.exec(s || "") || [0, 0])[1]; let n = 0;
    const on = new Set();
    for (const p of spec.pages) for (const b of breakouts(p)) if (m[b.id] && no(m[b.id]) > no(b.image)) { b.image = m[b.id]; n++; on.add(p.id); }
    if (n) { render(); snap(); setStatus(n === 1 ? "The break-out is drawn and on the page. Drag its dots to place it." : `${n} break-outs are drawn and on the page.`, "ok"); toneWhenFree([...on]); }
  }
  function boWords(b) { // ask who and what; false when the person backs out
    const f = b.panel && findPanel(b.panel), bd = f && f.panel.board, first = bd && bd.who && bd.who[0] ? bd.who[0].name : "";
    const who = prompt("Who or what breaks out of the panel? A character or prop from Series is drawn from its sheet.", b.who != null ? b.who : first); if (who == null) return false;
    const action = prompt("What are they doing? Describe the pose in a line.", b.action != null ? b.action : (bd && (bd.breakout || bd.action)) || ""); if (action == null) return false;
    if (!who.trim() && !action.trim()) { setStatus("Say who or what breaks out, and what they are doing.", "error"); return false; }
    b.who = who.trim().slice(0, 80); b.action = action.trim().slice(0, 600); return true;
  }
  function addBreakout() {
    const p = page(); if (!p.layout) return;
    const c = selP && geomById(p).get(selP), bb = c ? c.bbox : [W * 0.25, H * 0.25, W * 0.75, H * 0.75];
    const b = { id: "bo" + newId(), ...(selP ? { panel: selP } : {}) }; if (!boWords(b)) return;
    const w = Math.min(0.5, Math.max(0.22, (bb[2] - bb[0]) / W * 0.75)), cx = (bb[0] + bb[2]) / 2 / W, top = Math.max(0.01, bb[1] / H - 0.03), x0 = Math.min(Math.max(cx - w / 2, 0), 1 - w); // as tall as it is wide in page shares = a 2:3 figure; it starts a little above its panel's top border
    b.box = [x0, Math.min(top, 1 - w), x0 + w, Math.min(top, 1 - w) + w].map(round3);
    (p.layout.breakouts = p.layout.breakouts || []).push(b); selB = b.id; selP = null; render(); snap();
    drawBo(b);
  }

  // ---------- storage ----------
  function mergeSaved(saved) {
    if ((saved.boardAt || "") !== (original.boardAt || "")) { // the chapter was storyboarded again: old saved pages belong to the old board
      const fresh = JSON.parse(JSON.stringify(original));
      for (const k of ["bank", "voices", "styles"]) if (saved[k]) fresh[k] = saved[k];
      return fresh;
    }
    const byId = new Map((saved.pages || []).map((p) => [p.id, p]));
    const mergeOne = (p, s) => {
      if (!s || (p.artTake || "") !== (s.artTake || "")) { // new art from the Artist: the page starts fresh on it, in the place you gave it
        const n = JSON.parse(JSON.stringify(p));
        if (s) { n.number = s.number; n.label = s.label; }
        return n;
      }
      if (p.plan) s.plan = JSON.parse(JSON.stringify(p.plan)); // the Letterer's latest plan always comes from the project
      if (p.layout && s.layout) { // pages saved before panels had project ids: give each saved panel the id of the project panel with the same storyboard
        const key = (q) => (q.board ? q.board.action || "" : ""), mineL = leaves(s.layout.rows), want = new Map(leaves(p.layout.rows).map((q) => [key(q), q.id]));
        const have = new Set(mineL.map((q) => q.id));
        for (const q of mineL) {
          const id = key(q) && want.get(key(q));
          if (!id || id === q.id || have.has(id)) continue;
          for (const it of s.text || []) if (it.panel === q.id) it.panel = id;
          have.delete(q.id); have.add(id); q.id = id;
        }
      }
      if (p.layout && s.layout) { // a panel drawn on its own: only that panel takes the new picture, and its request is done
        const mine = new Map(); eachPanel(s.layout.rows, (q) => mine.set(q.id, q)); for (const q of s.layout.insets || []) mine.set(q.id, q);
        const take = (o) => { const q = mine.get(o.id); if (q && o.take && o.take !== q.take) { q.image = o.image; q.take = o.take; delete q.focus; delete q.zoom; delete q.request; } };
        eachPanel(p.layout.rows, take); for (const o of p.layout.insets || []) take(o);
      }
      return s;
    };
    const orig = new Map(original.pages.map((p) => [p.id, p]));
    const pages = (saved.pages || []).filter((s) => orig.has(s.id) || !/^board-cover/.test(s.id)).map((s) => (orig.has(s.id) ? mergeOne(orig.get(s.id), s) : s)); // your page order is kept; a cover that was removed or changed goes
    original.pages.forEach((p, i) => { if (!byId.has(p.id)) pages.splice(Math.min(i, pages.length), 0, JSON.parse(JSON.stringify(p))); });
    return Object.assign({}, saved, { pages, library: original.library, templates: original.templates, script: original.script });
  }
  function forSave() {
    const body = JSON.parse(JSON.stringify(spec));
    delete body.library; delete body.templates; delete body.script; // these always come from the project
    return body;
  }
  async function detectStore() {
    if (window.claude && typeof window.claude.use === "function") {
      try { const db = await window.claude.use("db"); if (db) { store = { kind: "db", db }; return; } } catch (e) { /* fall through */ }
    }
    try { const r = await fetch("/api/ping"); if (r.ok) { store = { kind: "local" }; return; } } catch (e) { /* no local server */ }
    store = { kind: "none" };
  }
  async function loadSaved() {
    const want = proj.id; savedFor = "";
    try {
      let d = null;
      if (store.kind === "db") {
        setStatus("Loading saved edits…");
        const snapDoc = await Promise.race([store.db.doc(DOC).get(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
        if (snapDoc.exists) d = (snapDoc.data() || {}).spec;
        if (d && d.pageIds) { // one document per page (a whole chapter with its prompts is too big for one)
          const qs = await store.db.collection(DOC + "/pages").limit(1000).get(), got = new Map();
          for (const s of qs.docs) { const pg = (s.data() || {}).page; if (pg) { got.set(pg.id, pg); savedPages[pg.id] = JSON.stringify(pg); } }
          d.pages = d.pageIds.map((id) => got.get(id)).filter(Boolean); delete d.pageIds;
        }
      } else if (store.kind === "local") {
        const s = await fetch("/api/spec?p=" + encodeURIComponent(proj.id));
        if (s.ok) { const j = await s.json(); if (j && j.pages) d = j; }
      } else { setStatus("Edits are not being saved here", "warn"); return; }
      if (want !== proj.id) return; // switched project meanwhile
      if (d && !edited) { spec = prepare(mergeSaved(JSON.parse(JSON.stringify(d)))); const turned = syncReading(); hist = [JSON.stringify(spec)]; redo = []; drafts = {}; clampSel(); render(); if (turned) { queueSave(); setStatus(`This series reads ${READING[spec.reading][0].toLowerCase()}: ${turned} page${turned === 1 ? " was" : "s were"} turned to match.`, "ok"); return; } } // drafts made from the built pages in the first moments are stale now
      setStatus("Saved", "ok");
    } catch (e) { setStatus("Saved edits could not load. New edits still save.", "warn"); }
    finally { if (want === proj.id) { savedFor = want; if (spec) renderDrawAll(); } }
  }
  let storeReady = null;
  async function initStore() { if (!storeReady) storeReady = detectStore(); await storeReady; await loadSaved(); loadPicModel(); registerAssistant(); loadOwnLayouts(); }
  // ---------- your own page layouts: saved on this computer, offered in every project beside the ready-made ones ----------
  let ownLayouts = [];
  const T = () => (window.Director ? window.Director.withFullPage((spec && spec.templates) || []) : (spec && spec.templates) || []).concat(ownLayouts);
  async function loadOwnLayouts() { if (store.kind !== "local") return; try { const r = await fetch("/api/layouts"); if (r.ok) { ownLayouts = (await r.json()).layouts || []; if (spec && mode === "layout") renderLayoutPanel(); } } catch (e) { /* none */ } }
  /** The page's layout with only its build kept (tiers, shares, slants, panel types): no pictures, storyboard or ids. */
  function bareRows(rows) { return rows.map((r) => Object.assign({ h: r.h || 1 }, r.slant ? { slant: r.slant } : {}, r.strip ? { strip: true } : {}, { panels: r.panels.map((q) => Object.assign({ w: q.w || 1 }, q.slant ? { slant: q.slant } : {}, q.rows ? { rows: bareRows(q.rows) } : (q.type && q.type !== "framed" ? { type: q.type } : {}), !q.rows && q.shape ? { shape: q.shape } : {})) })); }
  async function saveOwnLayout() {
    const p = page(); if (!p.layout) return; const n = leaves(p.layout.rows).length;
    const name = prompt("A name for this layout (it is saved on this computer and offered in every project):", `${n} panel${n === 1 ? "" : "s"}, mine`); if (name == null) return;
    const r = await fetch("/api/layouts", { method: "POST", body: JSON.stringify({ name, rows: bareRows(p.layout.rows) }) }), j = await r.json().catch(() => ({}));
    if (!r.ok) return setStatus(j.error || "The layout could not be saved.", "error");
    ownLayouts = j.layouts; tmplFilter = "mine"; $("tmplDetails").open = true; renderLayoutPanel(); setStatus(`Saved as ${j.code}. It is under Page layouts, Mine, in every project.`, "ok");
  }
  async function removeOwnLayout(code) {
    const t = ownLayouts.find((x) => x.code === code); if (!t || !confirm(`Remove your layout ${code} (${t.name})? Pages that use it keep their layout.`)) return;
    const r = await fetch("/api/layouts?code=" + encodeURIComponent(code), { method: "DELETE" }); if (!r.ok) return setStatus("The layout could not be removed.", "error");
    ownLayouts = (await r.json()).layouts; if (!ownLayouts.length) tmplFilter = "all"; renderLayoutPanel(); setStatus(`Removed ${code}.`, "ok");
  }

  function queueSave() {
    dirty = true; updateSaveBtn();
    if (store.kind === "none") return;
    saveStatus("Saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1200);
  }
  let saving = null, saveConflict = false; // the save being sent now; the chapter was storyboarded again under this tab
  function save() { // one save at a time: a second call waits for the first, then sends what is left
    const mine = (saving || Promise.resolve()).then(saveOnce).finally(() => { if (saving === mine) saving = null; updateSaveBtn(); });
    saving = mine; updateSaveBtn(); return mine;
  }
  /** The Save button: commits what is being typed, then saves at once (no waiting for the timer). Resolves true when everything is on disk. */
  async function saveNow() {
    if (store.kind === "none") return false;
    if (spec && hist.length && hist[hist.length - 1] !== JSON.stringify(spec)) snap();
    clearTimeout(saveTimer);
    if (saving) await saving;
    if (dirty) await save();
    if (dirty) { await new Promise((r) => setTimeout(r, 1500)); clearTimeout(saveTimer); if (dirty) await save(); } // one quick retry
    return !dirty && !saveConflict;
  }
  function updateSaveBtn() {
    const b = $("saveBtn"); if (!b) return;
    b.hidden = store.kind === "none" || !spec;
    const busy = !!saving;
    b.disabled = !dirty && !busy;
    b.textContent = busy ? "Saving…" : dirty ? "Save changes" : "Saved";
    b.classList.toggle("primary", dirty && !busy);
    b.title = dirty ? "Save your changes now (Ctrl+S). They also save by themselves a moment after each change." : "Everything is saved";
  }
  async function saveOnce() {
    if (!dirty) return;
    dirty = false;
    const body = forSave();
    try {
      if (store.kind === "db") {
        let n = 0;
        for (const p of body.pages) { // only the pages that changed; paced, because the store refuses a burst of writes
          const s = JSON.stringify(p);
          if (savedPages[p.id] === s) continue;
          if (n++) await new Promise((r) => setTimeout(r, 350));
          await store.db.doc(DOC + "/pages/" + p.id).set({ page: p });
          savedPages[p.id] = s;
        }
        const index = Object.assign({}, body, { pageIds: body.pages.map((p) => p.id) }); delete index.pages;
        await store.db.doc(DOC).set({ spec: index, savedAt: new Date().toISOString() });
      }
      else if (store.kind === "local") {
        const r = await fetch("/api/spec?p=" + encodeURIComponent(proj.id), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body, null, 1) });
        if (r.status === 409) { dirty = false; saveConflict = true; setStatus("This chapter was storyboarded again since you opened it. Reload the page to see the new pages (this tab's changes were not saved).", "error"); return; }
        if (!r.ok) throw new Error("HTTP " + r.status);
      }
      saveFails = 0;
      saveStatus(dirty ? "Saving…" : "Saved", dirty ? "" : "ok"); updateSaveBtn();
    } catch (e) {
      dirty = true; saveFails++;
      // pages already written are remembered, so each retry only sends what is left
      if (saveFails <= 6) { setStatus("Still saving… (trying again)", "warn"); clearTimeout(saveTimer); saveTimer = setTimeout(save, 4000 * saveFails); }
      else setStatus("Could not save. Your edits are still here; change anything to try again.", "error");
    }
  }
  // News on the status line (what a button just did) is not wiped by the save that follows it: "Saved" waits its turn for six seconds.
  let newsAt = 0, saveNote = null; const SAVE_WORDS = /^(Saved|Saving…)$/;
  function setStatus(msg, tone) { const el = $("status"); el.textContent = msg; el.dataset.tone = tone || ""; clearTimeout(saveNote); if (!SAVE_WORDS.test(msg)) newsAt = Date.now(); }
  function saveStatus(msg, tone) {
    const wait = newsAt + 6000 - Date.now();
    if (wait > 0 && !SAVE_WORDS.test($("status").textContent)) { clearTimeout(saveNote); saveNote = setTimeout(() => saveStatus(msg, tone), wait); return; }
    setStatus(msg, tone);
  }
  let savedFor = ""; // the project whose saved edits are loaded: counts taken before that are of the built chapter, not the person's

  // ---------- rendering ----------
  function renderDrawAll() { const n = missingCount(); $("drawAllBtn").hidden = !canDraw() || !n || !spec.boardAt || savedFor !== proj.id; $("drawAllBtn").textContent = `Draw the ${n} missing picture${n === 1 ? "" : "s"}`; }
  function renderChapter() {
    const res = window.Paneler ? window.Paneler.check(spec, R) : { chapter: [], pages: {} };
    const lines = (spec.script || []).filter((b) => b.type === "line").length;
    const pagesWithNotes = spec.pages.filter((p) => (res.pages[p.id] || []).length).length;
    const unboarded = spec.kind === "storyboard" && !spec.boardAt && /^projects\//.test(proj.dir || "");
    { // the chapter's header: its art behind, its numbers in tiles
      let panels = 0, drawn = 0, lettered = 0; for (const p of spec.pages) { const qs = p.layout ? leaves(p.layout.rows).concat(p.layout.insets || []) : []; panels += qs.length; drawn += qs.filter((q) => q.image).length; if ((p.text || []).length) lettered++; }
      const cov = spec.pages.find((p) => p.cover) || spec.pages.find((p) => p.layout ? leaves(p.layout.rows).some((q) => q.image) : p.art);
      const cq = cov && cov.layout ? leaves(cov.layout.rows).find((q) => q.image) : null, src = cq ? BASE + cq.image : cov && cov.art ? BASE + cov.art : "";
      const top = $("chapterView").querySelector(".chap-top"); top.classList.add("chap-hero"); top.style.backgroundImage = src && !unboarded ? `url("${encodeURI(src)}")` : "";
      $("chapterView").dataset.tiles = unboarded ? "" : `<div class="tiles"><span><b>${spec.pages.length}</b> pages</span><span><b>${drawn}<small>/${panels}</small></b> panels drawn</span><span><b>${lettered}<small>/${spec.pages.length}</small></b> pages lettered</span><span><b>${res.chapter.length || 0}</b> script problems</span></div>`;
    }
    if (unboarded) $("chapterHead").innerHTML = `<div><h2>${R.esc(spec.project || "")} · Chapter ${R.esc(spec.chapter || "")}</h2><p>Not storyboarded yet. “Storyboard this chapter” lays out the pages from the text.</p></div>`;
    else $("chapterHead").innerHTML = `<div><h2>${R.esc(spec.project || "")} · Chapter ${R.esc(spec.chapter || "")}</h2>${$("chapterView").dataset.tiles}<p>${spec.pages.length} pages` +
      (lines ? ` · ${lines} script lines` : "") + ` · ${res.chapter.length ? `<b class="bad">${res.chapter.length} script problems</b>` : lines ? "every line placed, word for word, in order" : ""}` +
      ` · ${pagesWithNotes ? `${pagesWithNotes} page${pagesWithNotes === 1 ? "" : "s"} flagged` : "all pages pass the Paneler checks"}</p>` +
      (res.chapter.length ? `<ul class="chap-issues">${res.chapter.map((c) => `<li>${R.esc(c.msg)}</li>`).join("")}</ul>` : "") +
      ((res.advice || []).length ? `<ul class="chap-advice">${res.advice.map((c) => `<li>${R.esc(c.msg)}</li>`).join("")}</ul>` : "") +
      (() => { const L = lib(); let n = 0; for (const p of spec.pages) if (p.layout) for (const q of leaves(p.layout.rows).concat(p.layout.insets || [])) { const e = q.image && L[q.image]; if (e && (e.review || []).length && q.reviewOk !== q.image) n++; }
        return n ? `<p style="margin-top:6px;color:var(--amber)"><b>${n} picture${n === 1 ? "" : "s"} to check.</b> The Artist's own check found something; open the panel in Art to see what.</p>` : ""; })() +
      (spec.book && spec.boardAt ? ((spec.bookFaults || []).length ? `<p style="margin-top:6px;color:var(--amber)"><b>Checked against the book: ${spec.bookFaults.length} to look at.</b></p><ul class="chap-issues" style="color:var(--amber)">${spec.bookFaults.map((m) => `<li>${R.esc(m)}</li>`).join("")}</ul>`
        : `<p style="margin-top:6px">Checked against the book: every balloon and caption is the book's own words, every stretch of speech is used, and every paragraph is drawn.</p>`) : "") +
      (() => { // characters drawn from words alone drift from panel to panel
        if (store.kind !== "local" || !bible) return "";
        const loose = Object.keys(bible.cast).filter((n) => !hasSheet(bible.cast[n]) && !bankSaved(n) && inChapter(n));
        const wait = bible.strict ? Object.keys(bible.cast).filter((n) => inChapter(n) && !(hasSheet(bible.cast[n]) && bible.cast[n].approved !== false)) : [];
        if (wait.length) return `<p style="margin-top:6px;color:var(--amber)"><b>${wait.length} character${wait.length === 1 ? "" : "s"} in this chapter cannot be drawn yet</b> (${R.esc(wait.join(", "))}): each needs a sheet you have approved. Set them up under <b>Series</b>.</p>`;
        return loose.length ? `<p style="margin-top:6px;color:var(--amber)">${loose.length === 1 ? `${R.esc(loose[0])} has` : `${loose.length} characters (${R.esc(loose.join(", "))}) have`} no character sheet yet, so their look will change from panel to panel. Set them up under <b>Series</b> before drawing.</p>` : "";
      })() + `</div>`;
    $("reboardBtn").hidden = !(store.kind === "local" && proj && /^projects\//.test(proj.dir || ""));
    $("reboardBtn").textContent = spec.boardAt ? "Storyboard again" : "Storyboard this chapter";
    $("coverBtn").hidden = $("reboardBtn").hidden || !spec.boardAt; $("coverBtn").textContent = spec.pages.some((p) => p.cover) ? "Change the cover" : "Add a cover";
    $("chapterGrid").innerHTML = spec.pages.map((p, i) => {
      const Ls = p.text.map((it) => R.measure(it, spec, measureText));
      const art = p.layout ? R.layoutSvg(p, (s) => BASE + s, sizes()) : `<image href="${R.esc(BASE + R.pageArt(p))}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
      const iss = res.pages[p.id] || [];
      return `<button type="button" class="pg" data-open="${i}"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${art}${R.letteringSvg(Ls)}${R.pageNumberSvg(p)}</svg>` +
        `<span class="pg-meta"><b>${R.esc(p.label || "Page " + p.number)}</b>${iss.length ? `<span class="chip warn">${iss.length}</span>` : ""}</span>` +
        (p.note ? `<span class="pg-note">${R.esc(p.note)}</span>` : "") + `</button>`;
    }).join("");
    $("letterAllBtn").hidden = !spec.pages.some((p) => p.layout && R.planFor(p).length);
    $("exportAllBtn").hidden = store.kind !== "local"; $("publishBtn").hidden = store.kind !== "local" || proj.own === false; $("stillsBtn").hidden = store.kind !== "local" || !homeList.some((q) => q.id === proj.id && q.own);
    $("toneAllBtn").hidden = store.kind !== "local" || !tonerOn() || !spec.pages.some(canTone);
    renderDrawAll();
    renderExports();
  }

  // ---------- home: your projects, and a new one from a script ----------
  let homeTimer = null, homeList = [];
  let npReading = "rtl", nbReading = "rtl"; // a new project or book starts right to left (manga); left to right is one tap away
  function paintNpReading() { // a chapter that joins a series reads the way that series does
    const o = $("npLike").selectedOptions[0], joined = !!$("npLike").value;
    readingSegs($("npReading"), joined ? o.dataset.reading : npReading, joined);
    $("npReadingHint").textContent = joined ? "A chapter reads the way its series does. Change it under Series." : "Manga reads right to left: the first panel of a row is on the right. Pick left to right for a comic. You can change it later under Series.";
  }
  async function fetchProjects() {
    if (store.kind !== "local") return;
    try {
      homeList = await (await fetch("/api/projects")).json();
      PROJECTS = homeList.map((q) => ({ id: q.id, label: q.label, dir: q.dir, doc: "specs/" + q.id }));
      const cur = $("projSel").value;
      $("projSel").innerHTML = PROJECTS.map((q) => `<option value="${q.id}">${R.esc(q.label)}</option>`).join(""); $("projSel").value = cur || proj.id;
    } catch (e) { /* keep the list we have */ }
  }
  // ---------- home: every project with its flow (one cell per step of the work; press a step to go to it) ----------
  const step = (label, value, st, attrs) => `<${attrs.startsWith("href") ? "a" : 'button type="button"'} class="step" data-st="${st}" ${attrs}><span class="sl">${label}</span><span class="sv">${R.esc(value).replace(/ (panels|pages)$/, '<span class="u"> $1</span>')}</span></${attrs.startsWith("href") ? "a" : "button"}>`;
  const frac = (a, b) => (!b ? "none" : a >= b ? "done" : a > 0 ? "part" : "none");
  function mangaFlow(q, scenes) {
    const id = R.esc(q.id), go = (m) => `data-proj="${id}" data-go="${m}"`, sb = q.storyboard, board = q.kind === "storyboard";
    const busy = sb && (sb.status === "waiting" || sb.status === "drawing"), mine = scenes.filter((s) => s.project === q.id);
    const out = [];
    if (board || sb) out.push(step("Storyboard", busy ? "Working…" : sb && sb.status === "failed" ? "Failed" : sb && sb.status === "none" ? "Not started" : `${q.pages} page${q.pages === 1 ? "" : "s"}`, busy ? "busy" : sb && sb.status === "failed" ? "bad" : sb && sb.status === "none" ? "none" : "done", go("chapter")));
    if (q.cast != null && board) out.push(step("Sheets", q.cast ? `${q.sheets} of ${q.cast}` : "No cast yet", frac(q.sheets, q.cast), go("series")));
    out.push(step("Art", `${q.drawn} of ${q.panels} panels`, frac(q.drawn, q.panels), go(board ? "art" : "letter")));
    if (board && q.check && q.drawn) { const c = q.check; out.push(step("Asset check", c.running ? "Checking…" : !c.at ? "Not checked" : c.open ? `${c.open} to look at` : c.changed ? `${c.changed} new picture${c.changed === 1 ? "" : "s"}` : "Agrees", c.running ? "busy" : !c.at ? "none" : c.open ? "bad" : c.changed ? "part" : "done", go("check"))); }
    out.push(step("Lettering", `${q.lettered || 0} of ${q.pages} pages`, frac(q.lettered || 0, q.pages), go("letter")));
    if (board) out.push(step("Export", q.exported ? `${q.exported} page${q.exported === 1 ? "" : "s"}` : "Not yet", frac(q.exported || 0, q.pages), go("chapter")));
    if (board) out.push(step("Anime", mine.length ? `${mine.length} scene${mine.length === 1 ? "" : "s"}` : "Start a scene", mine.length ? "part" : "none", `href="/anime/#/${mine.length === 1 ? "scene/" + encodeURIComponent(mine[0].id) : mine.length ? "" : "new/" + encodeURIComponent(q.id)}"`));
    return `<div class="flow">${out.join("")}</div>`;
  }
  let homeQ = "";
  function homeFilter() { // show only the rows whose name holds every word typed; a series heading stays while one of its chapters does
    const words = homeQ.toLowerCase().split(/\s+/).filter(Boolean), hit = (el) => words.every((w) => (el.dataset.find || "").includes(w));
    let n = 0, all = 0;
    for (const grid of ["homeGrid", "bookGrid", "animeGrid", "awayGrid"]) {
      for (const g of $(grid).querySelectorAll(".pgroup")) { const head = g.querySelector(".pgh"), whole = hit(head); let any = false; for (const r of g.querySelectorAll(".prow")) { const on = whole || hit(r); r.hidden = !on; any = any || on; r.dataset.seen = 1; all++; if (on) n++; } g.hidden = !any; }
      for (const r of $(grid).querySelectorAll(".prow")) { if (r.dataset.seen) { delete r.dataset.seen; continue; } const on = hit(r); r.hidden = !on; all++; if (on) n++; }
    }
    if (words.length && $("awayGrid").querySelector(".prow:not([hidden])")) $("homeAway").open = true;
    $("homeFindN").textContent = words.length ? (n ? `${n} of ${all}` : "Nothing by that name") : "";
  }
  async function renderHome() {
    clearTimeout(homeTimer);
    const local = store.kind === "local";
    await fetchProjects();
    if (mode !== "home") return;
    const list = local ? homeList.filter((q) => !q.series) : PROJECTS.map((q) => ({ id: q.id, dir: q.dir, label: q.label })); // a book's chapters are listed inside the book
    $("booksWrap").hidden = !local; $("newAnime").hidden = !local; $("flowKey").hidden = !local;
    let books = [], scenes = [];
    if (local) {
      [books, scenes] = await Promise.all([fetch("/api/series").then((r) => r.json()).catch(() => []), fetch("/api/anime/scenes").then((r) => r.json()).catch(() => [])]);
      if (mode !== "home") return;
      $("nbStyleBtn").innerHTML = styleButton(STYLES.find((s) => s.id === npStyle));
      readingSegs($("nbReading"), nbReading);
      $("bookGrid").innerHTML = books.map((b) => { const bid = R.esc(b.id), chs = homeList.filter((q) => q.series === b.id), sum = (k) => chs.reduce((a, q) => a + (q[k] || 0), 0);
        return `<div class="prow"><span class="pt">${b.chapters} chapters</span><button type="button" class="pn" data-book="${bid}"><b>${R.esc(b.name)}</b><small>${num(b.words)} words · about ${num(b.pages_est)} pages</small></button>` +
          `<div class="flow">${step("Text", `${b.chapters} chapters`, "done", `data-book="${bid}"`)}${step("Chapters started", `${b.started} of ${b.chapters}`, frac(b.started, b.chapters), `data-book="${bid}"`)}` +
          `${step("Art", chs.length ? `${sum("drawn")} of ${sum("panels")} panels` : "Not yet", frac(sum("drawn"), sum("panels")), `data-book="${bid}"`)}${step("Lettering", chs.length ? `${sum("lettered")} of ${sum("pages")} pages` : "Not yet", frac(sum("lettered"), sum("pages")), `data-book="${bid}"`)}</div></div>`; }).join("");
      $("animeGrid").innerHTML = scenes.map((s) => { const url = "/anime/#/scene/" + encodeURIComponent(s.id), from = homeList.find((q) => q.id === s.project), run = s.job && s.job.status === "running", kind = run && s.job.kind, a = `href="${url}"`;
        return `<div class="prow">${s.thumb ? `<img class="pt" src="${R.esc(s.thumb)}" alt="" loading="lazy">` : `<span class="pt">No picture</span>`}<a class="pn" href="${url}"><b>${R.esc(s.title)}</b><small>${from ? "from " + R.esc(from.label) : "its own scene, no manga"}</small></a>` +
          `<div class="flow">${step("Shot list", `${s.shots} shots · ${Math.round(s.seconds)} s`, "done", a)}${step("Plan check", s.errors ? `${s.errors} problem${s.errors === 1 ? "" : "s"}` : "Passes", s.errors ? "bad" : "done", a)}` +
          `${step("Blocking", kind === "blocking" ? "Working…" : s.blocked ? "Done" : "Not run", kind === "blocking" ? "busy" : s.blocked ? "done" : "none", a)}${step("Grey 3D animatic", kind === "previs" || kind === "render" ? "Working…" : s.previs ? "Ready to play" : "Not made", kind === "previs" || kind === "render" ? "busy" : s.previs ? "done" : "none", a)}${step("Pictures in the look", `${s.drawn || 0} of ${s.shots}`, frac(s.drawn || 0, s.shots), a)}${step("Sound", s.sound ? `${s.sound} clip${s.sound === 1 ? "" : "s"}` : "None yet", s.sound ? "part" : "none", a)}</div></div>`; }).join("");
    }
    $("hAnimeH").hidden = !local;
    if (local && !scenes.length) $("animeGrid").innerHTML = `<p class="home-empty">No anime scenes yet. Press “New anime scene” to start one from a script or from nothing, or “Anime” on a storyboarded chapter above.</p>`;
    $("homeInfo").textContent = local ? "Every project and where it stands. Each row is one piece of work, left to right in the order it is made." : "Starting your own project works in the copy on your computer. These two are the test projects.";
    $("newProj").hidden = !local;
    $("npStyleBtn").innerHTML = styleButton(STYLES.find((s) => s.id === npStyle));
    paintNpReading();
    if (local && document.activeElement !== $("npLike")) { // a new chapter can join a series that is already there
      const mine = homeList.filter((q) => q.own && !q.series), seen = new Set(), keep = $("npLike").value;
      $("npLike").innerHTML = `<option value="">A new series</option>` + mine.filter((q) => !seen.has(q.project) && seen.add(q.project)).map((q) => `<option value="${R.esc(q.id)}" data-name="${R.esc(q.project)}" data-reading="${q.reading === "rtl" ? "rtl" : "ltr"}" data-next="${Math.max(...mine.filter((x) => x.project === q.project).map((x) => +x.chapter || 0)) + 1}">${R.esc(q.project)} (same style, cast and sheets)</option>`).join("");
      $("npLike").value = keep; if ($("npLike").value !== keep) $("npLike").value = "";
    }
    { const last = (() => { try { return localStorage.getItem("ld-project"); } catch (e) { return null; } })();
      const q = list.find((x) => x.id === last && x.cover) || list.find((x) => x.cover && x.pages != null), ban = $("homeBanner");
      ban.hidden = !q;
      if (q) {
        const left = (q.panels || 0) - (q.drawn || 0), pct = q.panels ? Math.round(100 * (q.drawn || 0) / q.panels) : 0;
        ban.style.backgroundImage = `url("${encodeURI(q.dir + q.cover)}")`;
        ban.innerHTML = `<div class="in"><span class="kick">Carry on</span><h3 id="carryT">${R.esc(q.label)}</h3>` +
          `<p>${q.pages} page${q.pages === 1 ? "" : "s"} · ${q.drawn || 0} of ${q.panels || 0} panels drawn${left > 0 ? "" : " · every panel drawn"}</p>` +
          `<div class="bar" role="img" aria-label="${pct}% drawn"><i style="width:${pct}%"></i></div>` +
          `<div class="row"><button type="button" class="btn primary" data-carry="${R.esc(q.id)}">Open</button>` +
          (left > 0 ? `<button type="button" class="btn" data-carry="${R.esc(q.id)}" data-go="art">Draw the ${left} empty panel${left === 1 ? "" : "s"}</button>` : "") + `</div></div>`;
      }
    }
    // ---- Home list: series grouped, search, and what was put away (archived: only hidden here, nothing deleted) ----
    const put = (kind, id, on) => (local ? `<button type="button" class="btn putaway" data-put="${kind}" data-id="${R.esc(id)}" data-on="${on ? 1 : 0}">${on ? "Put away" : "Bring back"}</button>` : "");
    const ago = (iso) => { const m = (Date.now() - Date.parse(iso)) / 60000; return !iso || !(m >= 0) ? "" : m < 2 ? "worked on just now" : m < 60 ? `worked on ${Math.round(m)} min ago` : m < 1440 ? `worked on ${Math.round(m / 60)} h ago` : m < 43200 ? `worked on ${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? "" : "s"} ago` : "worked on " + new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
    const chapterRow = (q, on) => {
      const sb = q.storyboard, busy = sb && (sb.status === "waiting" || sb.status === "drawing"), id = R.esc(q.id);
      const state = !sb ? "" : busy ? `<span class="state">Storyboarding… ${sb.at ? mins(sb.now - sb.at) : "waiting its turn"}</span>` :
        sb.status === "failed" ? `<span class="state bad">Storyboard failed: ${R.esc(sb.msg || "")}</span>` : sb.status === "none" ? `<span class="state bad">Not storyboarded yet</span>` : sb.msg ? `<small>Storyboard: ${R.esc(sb.msg)}</small>` : "";
      const cover = q.cover ? `<img class="pt" src="${R.esc(q.dir + q.cover)}" alt="" loading="lazy">` : `<span class="pt">${busy ? "Reading the script" : "No art yet"}</span>`;
      const when = ago(q.changed);
      return `<div class="prow" data-find="${R.esc(String(q.label || "").toLowerCase())}">${cover}<button type="button" class="pn" data-proj="${id}"><b>${R.esc(q.label)}${q.own === false ? '<span class="tagx">sample</span>' : ""}</b>` +
        (q.pages != null ? `<small>${q.pages} page${q.pages === 1 ? "" : "s"} · ${q.panels} panels${when ? " · " + when : ""}</small>` : "") + state + `</button><div class="pact">` +
        (!on ? "" : sb && (sb.status === "failed" || sb.status === "none") ? `<button type="button" class="btn" data-reboard="${id}">Storyboard it now</button>` : q.pages != null ? mangaFlow(q, scenes) : "") + put("project", q.id, on) + `</div></div>`;
    };
    const shown = list.filter((q) => !q.archived), away = list.filter((q) => q.archived), awayBooks = books.filter((b) => b.archived);
    const groups = []; // chapters of one series sit together under the series' name (two or more), in chapter order
    for (const q of shown) { const key = local && q.project ? (q.own === false ? "s:" : "o:") + q.project : "one:" + q.id; let g = groups.find((x) => x.key === key); if (!g) groups.push((g = { key, name: q.project, rows: [] })); g.rows.push(q); }
    $("homeGrid").innerHTML = groups.map((g) => {
      if (g.rows.length < 2) return g.rows.map((q) => chapterRow(q, true)).join("");
      const rows = g.rows.slice().sort((a, b) => (parseFloat(a.chapter) || 0) - (parseFloat(b.chapter) || 0)), sum = (k) => rows.reduce((a, q) => a + (q[k] || 0), 0);
      return `<div class="pgroup"><div class="pgh" data-find="${R.esc(String(g.name).toLowerCase())}"><b>${R.esc(g.name)}</b><small>${rows.length} chapters · ${sum("pages")} pages · ${sum("drawn")} of ${sum("panels")} panels drawn</small></div>${rows.map((q) => chapterRow(q, true)).join("")}</div>`;
    }).join("") || (local && !books.length && !away.length ? `<p class="home-empty">Nothing here yet. Press “New project from a script” to paste a scene, or “New book from a file” to bring in a whole book.</p>` : "");
    for (const r of $("bookGrid").querySelectorAll(".prow")) { const b = books.find((x) => x.id === (r.querySelector("[data-book]") || {}).dataset.book); if (!b) continue; if (b.archived) { r.remove(); continue; } r.dataset.find = String(b.name || "").toLowerCase(); const fl = r.querySelector(".flow"), w = document.createElement("div"); w.className = "pact"; fl.replaceWith(w); w.appendChild(fl); w.insertAdjacentHTML("beforeend", put("book", b.id, true)); }
    for (const r of $("animeGrid").querySelectorAll(".prow")) r.dataset.find = ((r.querySelector(".pn") || {}).textContent || "").toLowerCase();
    $("hBooksH").hidden = !books.some((b) => !b.archived);
    const nAway = away.length + awayBooks.length;
    $("homeAway").hidden = !nAway; $("homeAwayN").textContent = nAway ? `Put away (${nAway})` : "";
    $("awayGrid").innerHTML = away.map((q) => chapterRow(q, false)).join("") + awayBooks.map((b) => `<div class="prow" data-find="${R.esc(String(b.name || "").toLowerCase())}"><span class="pt">${b.chapters} chapters</span><span class="pn"><b>${R.esc(b.name)}<span class="tagx">book</span></b><small>${num(b.words)} words</small></span><div class="pact">${put("book", b.id, false)}</div></div>`).join("");
    const total = shown.length + books.length + scenes.length + nAway;
    $("homeFindWrap").hidden = !(local && (total > 8 || homeQ)); // search only earns its place when the list is long
    homeFilter();
    if (local && (homeList.some((q) => q.storyboard && (q.storyboard.status === "waiting" || q.storyboard.status === "drawing")) || scenes.some((s) => s.job && s.job.status === "running"))) homeTimer = setTimeout(renderHome, 5000);
  }
  // ---------- books: a long text split into chapters ----------
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  let book = null, bookId = null;
  async function openBook(id) { bookId = id; book = null; mode = "book"; sel = -1; selP = null; render(); window.scrollTo(0, 0); }
  async function renderBook() {
    const want = bookId;
    if (!book || book.id !== want) { $("bkTitle").textContent = "Opening the book…"; $("bkInfo").textContent = ""; $("bkList").innerHTML = ""; }
    try { const b = await (await fetch("/api/series?id=" + encodeURIComponent(want))).json(); if (want !== bookId || mode !== "book") return; book = b; }
    catch (e) { $("bkTitle").textContent = "That book could not be opened."; return; }
    const real = book.chapters.filter((c) => c.kind !== "front"), parts = real.some((c) => c.kind === "part");
    $("bkTitle").textContent = book.name;
    $("bkInfo").textContent = `${real.length} ${parts ? "parts" : "chapters"} · ${num(book.words)} words · ${num(book.paragraphs)} numbered paragraphs · about ${num(book.pages_est)} manga pages (a rough guide: ${book.words_per_page} words a page).`;
    { // the whole book at a glance
      const st = real.map((c) => c.state).filter(Boolean), done = st.filter((x) => x.panels && x.drawn >= x.panels).length, sum = (k) => st.reduce((n, x) => n + (x[k] || 0), 0), anyExp = st.some((x) => x.exported);
      $("bkInfo").textContent += st.length ? ` Started: ${st.length} of ${real.length}. Drawn so far: ${num(sum("drawn"))} of ${num(sum("panels"))} panels in the started chapters; ${done} chapter${done === 1 ? "" : "s"} fully drawn.` : "";
      $("bkZip").hidden = !anyExp; $("bkZip").href = "/api/series/zip?id=" + encodeURIComponent(book.id);
    }
    $("bkNotes").hidden = !(book.notes || []).length; $("bkNotes").innerHTML = (book.notes || []).map((n) => `<li>${R.esc(n)}</li>`).join("");
    const open = new Set([...document.querySelectorAll("#bkList .bk-text:not([hidden])")].map((d) => d.dataset.text));
    $("bkList").innerHTML = book.chapters.map((c) => {
      const st = c.state, sb = st && st.storyboard, busy = sb && (sb.status === "waiting" || sb.status === "drawing");
      const state = !st ? "" : busy ? `<span class="state">Storyboarding…${sb.msg ? " " + R.esc(sb.msg) : ""}</span>` : sb && sb.status === "failed" ? `<span class="state" style="color:var(--red)">Storyboard failed: ${R.esc(sb.msg || "")}</span>` : sb && sb.status === "none" ? `<span class="state">Started · not storyboarded yet</span>` :
        `<small>${st.pages} page${st.pages === 1 ? "" : "s"} · ${st.drawn} of ${st.panels} panels drawn · ${st.lettered} of ${st.pages} pages lettered · ${st.exported ? (st.exported >= st.pages ? "exported" : `${st.exported} pages exported`) : "not exported"}</small>` +
        `<span class="bar"><i style="width:${st.panels ? Math.round((st.drawn / st.panels) * 100) : 0}%"></i></span>`;
      return `<div class="bk-ch"><div><b>${R.esc(c.title)}</b><small>${num(c.words)} words · ${num(c.paragraphs)} paragraphs${c.kind === "front" ? " · kept for reference, not a chapter" : ` · about ${c.pages_est} page${c.pages_est === 1 ? "" : "s"}`}</small>${state}</div>` +
        (c.opens ? `<p class="opens">${R.esc(c.opens)}</p>` : "") + `<div class="row">` +
        (c.kind === "front" ? "" : c.project ? `<button type="button" class="btn primary" data-bkopen="${R.esc(c.project)}">Open the chapter</button>` : `<button type="button" class="btn" data-bkstart="${R.esc(c.id)}">Start this chapter</button>`) +
        `<button type="button" class="btn" data-bkread="${R.esc(c.id)}">Read the text</button></div><div class="bk-text" data-text="${R.esc(c.id)}" hidden></div></div>`; }).join("");
    for (const id of open) showChapterText(id);
    renderCast();
  }
  // the book's people and places: found by reading the whole text, each with the book's own words for how they look
  let castTimer = null, castData = null;
  function chapterSpan(ids) { // "chapters 1 to 3, 5"
    const real = book.chapters.filter((c) => c.kind !== "front"), ns = ids.map((id) => real.findIndex((c) => c.id === id) + 1).filter((n) => n > 0).sort((a, b) => a - b), out = [];
    if (ns.length === real.length && ns.length > 2) return "every chapter";
    for (let i = 0; i < ns.length; i++) { let j = i; while (ns[j + 1] === ns[j] + 1) j++; out.push(j > i + 1 ? `${ns[i]} to ${ns[j]}` : j > i ? `${ns[i]}, ${ns[j]}` : String(ns[i])); i = j; }
    return out.length ? `chapter${ns.length === 1 ? "" : "s"} ${out.join(", ")}` : "";
  }
  async function renderCast() {
    clearTimeout(castTimer);
    const want = bookId; let d;
    try { d = await (await fetch("/api/series/cast?id=" + encodeURIComponent(want))).json(); } catch (e) { return; }
    if (want !== bookId || mode !== "book") return;
    drawCast(d);
  }
  function drawCast(d) {
    castData = d;
    const job = d.job, busy = job && (job.status === "reading" || job.status === "folding"), cast = d.cast, go = $("bkCastGo"), all = $("bkCastAll");
    const mins0 = Math.max(3, Math.round(book.words / 9000) + 3);
    go.disabled = !!busy; go.textContent = busy ? "Reading the book…" : cast ? "Read the book again" : "Find the people and places"; go.className = "btn" + (cast || busy ? "" : " primary");
    let info = cast ? "" : `Codex reads the whole book and lists everyone who has to be drawn and every place, with the book's own words for how each one looks. About ${mins0} minutes for this book. Nothing is drawn.`;
    if (busy) info = job.status === "folding" ? `Every part is read (${mins(job.now - job.started)} so far). Now joining the lists: the same person under two names becomes one.` :
      job.total ? `Reading: ${job.done} of ${job.total} parts read (${mins(job.now - job.started)} so far). You can leave this screen; it carries on.` : "Starting to read…";
    else if (job && job.status === "failed") info = `The reading stopped: ${job.msg || "no reason given"}` + (cast ? " The list below is from the last full reading." : "");
    else if (cast) {
      const drawn = cast.people.filter((c) => c.part !== "mentioned"), bare = drawn.filter((c) => !c.look).length;
      info = `${cast.people.length} people and ${cast.places.length} places, read on ${new Date(cast.made).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. ` +
        `${bare} of the ${drawn.length} people who appear are never described in the book: you write their look in Series, or upload a sheet. Every look below is built only from the quoted words.`;
    }
    $("bkCastInfo").textContent = info; $("bkCastInfo").style.color = job && job.status === "failed" ? "var(--red)" : "";
    if (!cast) { all.hidden = true; $("bkCastList").innerHTML = ""; if (busy) castTimer = setTimeout(renderCast, 5000); return; }
    const inCast = new Set(d.in_cast.map((n) => n.toLowerCase())), inPlaces = new Set(d.in_places.map((n) => n.toLowerCase()));
    const key = cast.people.filter((c) => (c.part === "main" || c.part === "supporting") && !inCast.has(c.name.toLowerCase()));
    all.hidden = !key.length; all.textContent = `Add the ${key.length} main and supporting people to the cast`;
    const openNow = new Set([...document.querySelectorAll("#bkCastList > details[open]")].map((x) => x.dataset.group)), first = !document.querySelector("#bkCastList > details");
    const quotesOpen = new Set([...document.querySelectorAll("#bkCastList .bk-person details[open]")].map((x) => x.closest(".bk-person").dataset.key));
    const card = (c, kind) => {
      const isIn = (kind === "place" ? inPlaces : inCast).has(c.name.toLowerCase()), k = kind + ":" + c.name;
      const sub = [c.full && c.full !== c.name ? c.full : "", c.age, chapterSpan(c.chapters)].filter(Boolean).join(" · ");
      return `<div class="bk-person" data-key="${R.esc(k)}"><div><b>${R.esc(c.name)}</b>${sub ? `<small>${R.esc(sub)}</small>` : ""}${c.also.length ? `<small>Also: ${R.esc(c.also.slice(0, 6).join(", "))}</small>` : ""}</div>` +
        (c.who ? `<small>${R.esc(c.who)}</small>` : "") +
        (c.look ? `<p class="look">${R.esc(c.look)}</p>` : kind === "place" || c.part !== "mentioned" ? `<p class="none">The book never says what ${kind === "place" ? "this place looks" : "they look"} like.</p>` : "") +
        (c.quotes.length ? `<details${quotesOpen.has(k) ? " open" : ""}><summary>What the book says (${c.quotes.length})</summary>${c.quotes.map((q) => `<blockquote><span class="pid">${R.esc(q.id.split(":").slice(1).join(" "))}</span>${R.esc(q.words)}</blockquote>`).join("")}</details>` : "") +
        (isIn ? `<span class="in">${kind === "place" ? "In the places list" : "In the cast"}</span>` : `<button type="button" class="btn" data-castadd="${R.esc(c.name)}" data-kind="${kind}" style="width:fit-content">${kind === "place" ? "Add to the places" : "Add to the cast"}</button>`) +
        `<button type="button" class="btn link" data-castname="${R.esc(c.name)}" data-kind="${kind}" style="width:fit-content">Rename</button></div>`;
    };
    const groups = [["main", "Main"], ["supporting", "Supporting"], ["minor", "Minor"], ["mentioned", "Only talked about"]].map(([part, label]) => [part, label, cast.people.filter((c) => c.part === part), "person"]).concat([["places", "Places", cast.places, "place"]]);
    $("bkCastList").innerHTML = groups.filter((g) => g[2].length).map(([id, label, rows, kind]) =>
      `<details data-group="${id}"${(first ? id === "main" : openNow.has(id)) ? " open" : ""}><summary>${label} (${rows.length})</summary><div class="bk-people">${rows.map((c) => card(c, kind)).join("")}</div></details>`).join("");
    if (busy) castTimer = setTimeout(renderCast, 5000);
  }
  async function castSend(method, query, bodyObj) {
    try { const r = await fetch(`/api/series/cast?id=${encodeURIComponent(bookId)}${query || ""}`, { method, body: bodyObj ? JSON.stringify(bodyObj) : undefined }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "It did not work."); if (mode === "book") drawCast(d); return true; }
    catch (e) { setStatus(String(e.message || e), "error"); return false; }
  }
  function wireCast() {
    $("bkCastGo").addEventListener("click", async () => {
      const again = !!(castData && castData.cast);
      if (again && !confirm("Read the whole book again? The list is made new. People and places already added to the cast stay as they are.")) return;
      $("bkCastGo").disabled = true; await castSend("POST", again ? "&fresh=1" : ""); castTimer = setTimeout(renderCast, 3000);
    });
    $("bkCastAll").addEventListener("click", async () => {
      const inCast = new Set(castData.in_cast.map((n) => n.toLowerCase())), names = castData.cast.people.filter((c) => (c.part === "main" || c.part === "supporting") && !inCast.has(c.name.toLowerCase())).map((c) => c.name);
      if (await castSend("PUT", "", { people: names })) setStatus(`${names.length} people added to the cast. Open a chapter, then Series, to check each look and draw the sheets.`, "ok");
    });
    $("bkCastList").addEventListener("click", async (e) => {
      const rn = e.target.closest("[data-castname]");
      if (rn) {
        const from = rn.dataset.castname, to = (prompt(`New name for ${from}. Use the short name people call them in the story: it is the name on storyboards and in the cast.`, from) || "").trim();
        if (to && to !== from && await castSend("PUT", "", { rename: { from, to, kind: rn.dataset.kind } })) setStatus(`${from} is now ${to}.`, "ok");
        return;
      }
      const b = e.target.closest("[data-castadd]"); if (!b) return; b.disabled = true;
      const place = b.dataset.kind === "place";
      if (await castSend("PUT", "", place ? { places: [b.dataset.castadd] } : { people: [b.dataset.castadd] })) setStatus(`${b.dataset.castadd} added to the ${place ? "places" : "cast"}.`, "ok");
    });
  }
  async function showChapterText(id) {
    const box = document.querySelector(`#bkList .bk-text[data-text="${id}"]`); if (!box) return;
    box.hidden = false; box.textContent = "Loading…";
    try { const t = await (await fetch(`/api/series/chapter?id=${encodeURIComponent(bookId)}&ch=${encodeURIComponent(id)}`)).json();
      box.innerHTML = t.paragraphs.map((p) => `<p><span class="pid">${R.esc(p.id.split(":").pop())}</span>${R.esc(p.text)}</p>`).join(""); }
    catch (e) { box.textContent = "The text could not be loaded."; }
  }
  function wireBooks() {
    wireCast();
    $("bookGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-book]"); if (b) openBook(b.dataset.book); });
    $("bkBack").addEventListener("click", () => { clearTimeout(castTimer); mode = "home"; render(); });
    $("nbStyleBtn").addEventListener("click", async () => { const s = await pickStyle(npStyle); if (s) { npStyle = s.id; $("nbStyleBtn").innerHTML = styleButton(s); $("npStyleBtn").innerHTML = styleButton(s); } });
    $("nbReading").addEventListener("click", (e) => { const b = e.target.closest("[data-reading]"); if (b) { nbReading = b.dataset.reading; readingSegs($("nbReading"), nbReading); } });
    $("bookForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = $("nbFile").files[0], go = $("nbGo"), hint = $("nbHint"); if (!f) return;
      go.disabled = true; hint.style.color = ""; hint.textContent = "Reading the file…";
      try {
        const r = await fetch(`/api/series?name=${encodeURIComponent($("nbName").value)}&file=${encodeURIComponent(f.name)}&style=${encodeURIComponent(npStyle)}&reading=${nbReading}`, { method: "POST", body: f });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || "It could not be imported.");
        $("bookForm").reset(); $("newBook").open = false; hint.textContent = "";
        setStatus("The book is in. Check the chapter list, then start a chapter.", "ok"); openBook(j.id);
      } catch (err) { hint.textContent = String(err.message || err); hint.style.color = "var(--red)"; }
      go.disabled = false;
    });
    $("bkList").addEventListener("click", async (e) => {
      const o = e.target.closest("[data-bkopen]"), st = e.target.closest("[data-bkstart]"), rd = e.target.closest("[data-bkread]");
      if (rd) { const box = document.querySelector(`#bkList .bk-text[data-text="${rd.dataset.bkread}"]`); if (box.hidden) showChapterText(rd.dataset.bkread); else box.hidden = true; return; }
      let pid = o && o.dataset.bkopen;
      if (st) {
        st.disabled = true;
        try { const r = await fetch(`/api/series/chapter?id=${encodeURIComponent(bookId)}&ch=${encodeURIComponent(st.dataset.bkstart)}`, { method: "POST" }), j = await r.json(); if (!r.ok) throw new Error(j.error); pid = j.project; }
        catch (err) { st.disabled = false; setStatus("The chapter could not be started: " + String(err.message || err), "error"); return; }
      }
      if (pid) { await fetchProjects(); loadProject(pid).catch(() => setStatus("That chapter could not load.", "error")); }
    });
  }
  // "Start from an idea": the Writer first talks the idea through (a story plan and questions, as many rounds as the person
  // wants), then writes the chapter script into the form from the plan. "Skip the talk" asks for the script at once. The person
  // reads and changes the script there; only Create storyboards it.
  let npIdea = "", npIdeaTimer = 0, npRounds = -1;
  const ideaKeep = (id) => { npIdea = id || ""; try { if (id) localStorage.setItem("ibasho.idea", id); else localStorage.removeItem("ibasho.idea"); } catch (e) { /* kept for this visit only */ } };
  const PLAN_FIELDS = [["hook", "npPlanHook"], ["hero", "npPlanHero"], ["aim", "npPlanAim"], ["turn", "npPlanTurn"], ["begins", "npPlanBegins"], ["ends", "npPlanEnds"]];
  function planTotal() { const n = [...document.querySelectorAll("#npPlanActs .actPages")].reduce((t, el) => t + (parseInt(el.value, 10) || 0), 0); $("npPlanTotal").textContent = n ? `About ${n} page${n === 1 ? "" : "s"} in all.` : ""; }
  function fillPlan(plan) {
    plan = plan || {}; for (const [k, el] of PLAN_FIELDS) $(el).value = plan[k] || "";
    const acts = (plan.acts && plan.acts.length ? plan.acts : [{ part: "Setup" }, { part: "Development" }, { part: "Twist" }, { part: "Ending" }]);
    $("npPlanActs").innerHTML = acts.map((a) => `<div class="act"><input class="actPart" maxlength="40" aria-label="Part" value="${R.esc(a.part || "")}"><input class="actPages" type="number" min="1" max="40" aria-label="Pages" value="${a.pages ? +a.pages : ""}"><textarea class="actWhat" rows="2" maxlength="300" aria-label="What happens in ${R.esc(a.part || "this part")}" placeholder="What happens">${R.esc(a.what || "")}</textarea></div>`).join("");
    planTotal();
  }
  function readPlan() {
    const plan = {}; for (const [k, el] of PLAN_FIELDS) plan[k] = $(el).value.trim();
    plan.acts = [...document.querySelectorAll("#npPlanActs .act")].map((r) => ({ part: r.querySelector(".actPart").value.trim(), pages: parseInt(r.querySelector(".actPages").value, 10) || 1, what: r.querySelector(".actWhat").value.trim() })).filter((a) => a.part || a.what);
    return plan;
  }
  function paintTalk(talk) {
    $("npTalkLog").innerHTML = (talk || []).map((t) => `<li class="${t.who === "you" ? "you" : "writer"}"><b>${t.who === "you" ? "You" : "The Writer"}</b>${R.esc(t.say || "")}` +
      (t.questions && t.questions.length ? `<ul>${t.questions.map((q) => `<li>${R.esc(q)}</li>`).join("")}</ul>` : "") + "</li>").join("");
    const log = $("npTalkLog"); log.scrollTop = log.scrollHeight;
  }
  function wireIdea() {
    const hint = (t, bad) => { $("npIdeaHint").textContent = t; $("npIdeaHint").style.color = bad ? "var(--red)" : ""; }, go = $("npIdeaGo"), skip = $("npIdeaSkip");
    const busy = (on) => { for (const id of ["npIdeaGo", "npIdeaSkip", "npReplyGo", "npWriteGo"]) $(id).disabled = on; };
    const show = (j, id, fresh) => {
      clearTimeout(npIdeaTimer);
      const talk = j.talk || [];
      $("npTalk").hidden = !talk.length;
      if (talk.length) { paintTalk(talk); const rounds = talk.filter((t) => t.who === "writer").length; if (rounds !== npRounds) { npRounds = rounds; fillPlan(j.plan); } }
      if (j.status === "waiting" || j.status === "writing") { busy(true);
        hint(j.status === "waiting" ? "Waiting in the queue for the Writer." : j.msg || (j.step === "plan" ? "The Writer is reading your idea and thinking it through. With Codex this takes a minute or two; you can leave this page open." : "The Writer is writing the script. With Codex this takes two or three minutes; you can leave this page open."));
        npIdeaTimer = setTimeout(() => poll(id, true), 3000); return; }
      busy(false);
      if (j.idea && !$("npIdea").value) $("npIdea").value = j.idea;
      if (j.status === "talk") { ideaKeep(id); $("newProj").open = true;
        hint("The Writer answered. Answer its questions or change the plan and send it back, as often as you like. When the plan is right, press “Write the script from this plan”.");
        if (fresh) $("npReply").focus(); }
      else if (j.status === "done") {
        if (fresh || !$("npScript").value.trim()) { $("npScript").value = j.script; if (j.title && !$("npName").value && !$("npLike").value) $("npName").value = j.title; ideaKeep(id); $("newProj").open = true;
          hint("The Writer wrote the script below. Read it and change anything you like, then press Create and storyboard. Nothing has been storyboarded or drawn."); if (fresh) $("npScript").focus(); } }
      else if (j.status === "failed") { if (talk.length) ideaKeep(id); else ideaKeep(""); hint("The Writer did not finish: " + (j.msg || "no reason given") + (talk.length ? "" : " Press the button to try again."), true); }
      else ideaKeep("");
    };
    const poll = async (id, fresh) => { try { show(await (await fetch("/api/idea?id=" + encodeURIComponent(id))).json(), id, fresh); } catch (e) { npIdeaTimer = setTimeout(() => poll(id, fresh), 5000); } };
    const send = async (url, payload, asking) => {
      if (!(await okToWrite())) return false;
      busy(true); hint(asking);
      try { const r = await fetch(url, { method: "POST", body: JSON.stringify(payload) }), j = await r.json(); if (!r.ok) throw new Error(j.error || "The Writer could not start."); ideaKeep(j.id); show(j, j.id, true); return true; }
      catch (err) { busy(false); hint(String(err.message || err), true); return false; }
    };
    const start = async (skipTalk) => {
      const idea = $("npIdea").value.trim();
      if (idea.length < 12) return hint("Say a little more about the idea first: who it is about and what happens.", true);
      if (skipTalk && $("npScript").value.trim() && !confirm("The script box already has text. The Writer's script will replace it. Go on?")) return;
      npRounds = -1; $("npTalk").hidden = true; $("npTalkLog").innerHTML = ""; $("npReply").value = "";
      await send("/api/idea", { idea, like: $("npLike").value, ...(skipTalk ? { skip: true } : {}) }, "Asking the Writer.");
    };
    go.addEventListener("click", () => start(false)); skip.addEventListener("click", () => start(true));
    $("npPlanActs").addEventListener("input", planTotal);
    $("npReplyGo").addEventListener("click", async () => {
      if (!npIdea) return; const say = $("npReply").value.trim();
      if (!say) { hint("Write your answer to the Writer first (a plain “yes” takes its suggestions).", true); $("npReply").focus(); return; }
      if (await send("/api/idea/reply", { id: npIdea, say, plan: readPlan() }, "Sending your answer to the Writer.")) $("npReply").value = "";
    });
    $("npWriteGo").addEventListener("click", async () => {
      if (!npIdea) return;
      if ($("npScript").value.trim() && !confirm("The script box already has text. The Writer's script will replace it. Go on?")) return;
      await send("/api/idea/write", { id: npIdea, plan: readPlan() }, "Asking the Writer for the script.");
    });
    let was = ""; try { was = localStorage.getItem("ibasho.idea") || ""; } catch (e) { /* none */ }
    if (was) { npIdea = was; poll(was, false); } // a draft asked for before a reload: it is picked up again
  }
  function wireHome() {
    wireIdea();
    wireBooks();
    $("homeBtn").addEventListener("click", () => { mode = "home"; sel = -1; selP = null; inProject(false); render(); });
    $("mangaBtn").addEventListener("click", () => { if ((mode !== "home" && mode !== "book") || !spec) return; mode = spec && spec.kind === "storyboard" ? "chapter" : "letter"; inProject(true); render(); });
    $("homeBanner").addEventListener("click", (e) => { const b = e.target.closest("[data-carry]"); if (!b) return; inProject(true); openProject(b.dataset.carry, b.dataset.go).catch(() => setStatus("That project could not open.", "error")); });
    $("homeGrid").addEventListener("click", async (e) => {
      const re = e.target.closest("[data-reboard]"), b = e.target.closest("[data-proj]");
      if (re) { if (!(await okToWrite())) return; await fetch("/api/storyboard?p=" + encodeURIComponent(re.dataset.reboard), { method: "POST" }); renderHome(); return; }
      if (b) openProject(b.dataset.proj, b.dataset.go).catch(() => setStatus("That project could not load.", "error"));
    });
    $("homeFind").addEventListener("input", (e) => { homeQ = e.target.value.trim(); homeFilter(); });
    $("homeView").addEventListener("click", async (e) => { // Put away / Bring back: the chapter or book only leaves the Home list
      const b = e.target.closest("[data-put]"); if (!b) return;
      e.stopPropagation(); if (!(await okToWrite())) return;
      const on = b.dataset.on === "1"; b.disabled = true;
      try {
        const r = await fetch("/api/put-away", { method: "POST", body: JSON.stringify({ kind: b.dataset.put, id: b.dataset.id, on }) }), j = await r.json();
        if (!r.ok) throw new Error(j.error || "That did not work.");
        setStatus(on ? "Put away. Nothing was deleted: it is under “Put away” at the bottom of Home." : "Brought back to the list.", "ok");
        if (on) $("homeAway").open = false;
        await renderHome();
      } catch (err) { b.disabled = false; setStatus(String(err.message || err), "error"); }
    });
    $("npStyleBtn").addEventListener("click", async () => { const s = await pickStyle(npStyle); if (s) { npStyle = s.id; $("npStyleBtn").innerHTML = styleButton(s); } });
    $("npLike").addEventListener("change", (e) => { const o = e.target.selectedOptions[0], on = !!e.target.value; if (on) { $("npName").value = o.dataset.name; $("npChapter").value = o.dataset.next; }
      paintNpReading(); $("npName").readOnly = on; $("npStyleBtn").disabled = on; $("npLikeHint").textContent = on ? "This chapter uses that series' art style, characters, places, props and sheets." : ""; });
    $("npReading").addEventListener("click", (e) => { const b = e.target.closest("[data-reading]"); if (b && !b.disabled) { npReading = b.dataset.reading; paintNpReading(); } });
    $("npFile").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) $("npScript").value = await f.text(); });
    $("newForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!(await okToWrite())) return;
      const go = $("npGo"); go.disabled = true;
      try {
        const r = await fetch("/api/projects", { method: "POST", body: JSON.stringify({ name: $("npName").value, chapter: $("npChapter").value, script: $("npScript").value, style: npStyle, like: $("npLike").value, reading: npReading, idea: npIdea }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "It could not be created.");
        $("newForm").reset(); $("newProj").open = false; paintNpReading(); ideaKeep(""); $("npIdeaHint").textContent = ""; $("npTalk").hidden = true; $("npTalkLog").innerHTML = ""; npRounds = -1;
        setStatus("Project created. The Paneler is storyboarding it; this takes a few minutes.", "ok");
        renderHome();
      } catch (err) { $("npHint").textContent = String(err.message || err); $("npHint").style.color = "var(--red)"; }
      go.disabled = false;
    });
  }

  // ---------- use existing stills: an anime scene's pictures onto this chapter's panels, before anything is drawn ----------
  // Self-contained: its own dialog (stillsDlg), its own routes (/api/stills/*, page-editor/stills.mjs). Three steps: where the stills
  // are, the match as a sheet (accept or change each panel), then a tap on the face of each placed picture.
  const stl = { source: null, sources: null, match: null, picks: new Map(), placed: [] };
  const stillsApi = async (what, body) => { const r = await fetch("/api/stills/" + what, body ? { method: "POST", body: JSON.stringify(body) } : undefined), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "That did not work."); return j; };
  const stillsSay = (msg, bad) => { $("stillsNote").textContent = msg || ""; $("stillsNote").style.color = bad ? "var(--red)" : ""; };
  async function openStills() {
    stl.source = null; stl.match = null; stl.picks = new Map(); stl.placed = [];
    if (!$("stillsDlg").open) $("stillsDlg").showModal();
    stillsSay("Looking for stills…"); $("stillsBody").innerHTML = ""; $("stillsGo").hidden = true; $("stillsBack").hidden = true;
    try { stl.sources = await stillsApi("sources"); stillsSources(); } catch (e) { stillsSay(String(e.message || e), true); }
  }
  function stillsSources() {
    const so = stl.sources, row = (attrs, name, n) => `<button type="button" class="st-src" ${attrs}><b>${R.esc(name)}</b><small>${n} still${n === 1 ? "" : "s"}</small></button>`;
    $("stillsT").textContent = "Use existing stills"; $("stillsGo").hidden = true; $("stillsBack").hidden = true;
    stillsSay(so.scenes.length + so.folders.length ? "Pick where the stills are. Nothing changes until you accept the match." : "No stills were found yet.");
    $("stillsBody").innerHTML =
      (so.scenes.length ? `<h3 class="sect-h">Anime scenes in Ibasho</h3><div class="st-list">${so.scenes.map((x) => row(`data-scene="${R.esc(x.id)}"`, x.title, x.stills)).join("")}</div>` : "") +
      (so.folders.length ? `<h3 class="sect-h">Stills folders on this computer</h3><div class="st-list">${so.folders.map((x) => row(`data-root="${x.root}" data-folder="${R.esc(x.folder)}"`, x.name, x.stills)).join("")}</div>` : "") +
      `<details class="st-add"${so.scenes.length + so.folders.length ? "" : " open"}><summary>Stills kept somewhere else on the computer</summary>` +
      `<p class="hint">A stills folder is any folder that holds scene folders, each with a SCENE_PLAN.json whose shots name their still and what part of the script they show.</p>` +
      (so.roots.length ? `<ul class="st-roots">${so.roots.map((r) => `<li><span>${R.esc(r.path || r.name)}</span>${so.local && !r.fixed ? `<button type="button" class="btn" data-unroot="${R.esc(r.path)}">Take off the list</button>` : ""}</li>`).join("")}</ul>` : "") +
      (so.local ? `<div class="field"><label for="stillsPath">The folder's whole path</label><div class="row"><input type="text" id="stillsPath" placeholder="/path/to/your/episodes" autocomplete="off" spellcheck="false"><button type="button" class="btn" id="stillsAdd">Add this folder</button></div></div>`
        : `<p class="hint">A folder can only be added on the computer that runs Ibasho (open Ibasho there, then this window).</p>`) + `</details>`;
  }
  async function stillsMatch(source) {
    stl.source = source; stillsSay("Matching stills to panels…"); $("stillsBody").innerHTML = "";
    try {
      try { await save(); } catch (e) { /* the match then uses the pages as last saved */ }
      stl.match = await stillsApi("match", { p: proj.id, source });
      stl.picks = new Map(stl.match.panels.filter((q) => q.pick && !q.has).map((q) => [q.id, q.pick]));
      stillsSheet();
    } catch (e) { stillsSay(String(e.message || e), true); $("stillsBack").hidden = false; }
  }
  function stillsSheet() {
    const m = stl.match, withPick = m.panels.filter((q) => q.pick).length, n = stl.picks.size, used = new Map(); for (const [panel, shot] of stl.picks) used.set(shot, (used.get(shot) || 0) + 1);
    $("stillsT").textContent = "The match"; $("stillsBack").hidden = false;
    $("stillsGo").hidden = false; $("stillsGo").disabled = !n; $("stillsGo").textContent = n ? `Put ${n} still${n === 1 ? "" : "s"} on ${n === 1 ? "its panel" : "their panels"}` : "No still is ticked";
    stillsSay(`${m.count} stills, ${m.panels.length} panels: a still was found for ${withPick}. Untick or change any; the ${m.panels.length - n} left are for the Artist to draw.`);
    let last = null;
    $("stillsBody").innerHTML = `<div class="st-sheet">` + m.panels.map((q, i) => {
      const head = q.page !== last ? `<h3 class="sect-h">Page ${q.number}</h3>` : ""; last = q.page;
      const shot = stl.picks.get(q.id) || "", sv = shot && m.stills[shot], opt = q.options.find((o) => o.shot === shot), twice = shot && used.get(shot) > 1;
      const nth = m.panels.slice(0, i + 1).filter((x) => x.page === q.page).length;
      return head + `<div class="st-row${shot ? "" : " off"}" data-panel="${R.esc(q.id)}">` +
        (sv ? `<img src="${R.esc(sv.url)}" alt="" loading="lazy">` : `<span class="st-none">${q.options.length ? "Not used" : "No still"}</span>`) +
        `<div class="st-what"><b>Panel ${nth}${q.shot ? " · " + R.esc(q.shot) : ""}${q.who.length ? " · " + R.esc(q.who.join(", ")) : ""}</b><small>${R.esc(q.action || "Nothing written for this panel.")}</small>` +
        (q.has ? `<small class="st-has">This panel already has a picture${shot ? ": the still will take its place" : ""}.</small>` : "") +
        (twice ? `<small class="st-warn">This still is on another panel too.</small>` : "") +
        (q.options.length ? `<label class="st-pick"><span class="vh">Still for panel ${nth} on page ${q.number}</span><select data-pick="${R.esc(q.id)}"><option value="">${q.has ? "Keep its picture" : "No still: the Artist draws it"}</option>${q.options.map((o) => `<option value="${R.esc(o.shot)}"${o.shot === shot ? " selected" : ""}>${R.esc(o.shot)}: ${R.esc(o.why)}</option>`).join("")}</select></label>` +
          (sv && sv.action ? `<small class="st-shot">The still: ${R.esc(sv.action)}</small>` : "") : `<small>Nothing in the stills shows this part of the script.</small>`) +
        `</div></div>`; }).join("") + `</div>`;
  }
  async function stillsUse() {
    const picks = [...stl.picks].map(([panel, shot]) => ({ panel, shot })); if (!picks.length || !(await okToWrite())) return;
    $("stillsGo").disabled = true; stillsSay(`Putting ${picks.length} still${picks.length === 1 ? "" : "s"} in place…`);
    try {
      const j = await stillsApi("use", { p: proj.id, source: stl.source, picks });
      stl.placed = j.placed; await refreshArt();
      setStatus(`${j.placed.length} still${j.placed.length === 1 ? "" : "s"} in place. The panels with none are for the Artist.`, "ok");
      stillsFaces();
    } catch (e) { $("stillsGo").disabled = false; stillsSay(String(e.message || e), true); }
  }
  const stillsPanel = (id) => { let f = null; for (const p of spec.pages) if (p.layout) eachPanel(p.layout.rows, (q) => { if (q.id === id) f = q; }); return f; };
  function stillsFaces() {
    $("stillsT").textContent = "Where is the face?"; $("stillsGo").hidden = true; $("stillsBack").hidden = true;
    stillsSay("Done: the stills are on their panels. A narrow panel shows only part of a picture: tap the face (or whatever matters most) in any picture that needs it, then close this window.");
    $("stillsBody").innerHTML = `<div class="st-faces">` + stl.placed.map((x) => { const q = stillsPanel(x.panel); if (!q || !q.image) return "";
      return `<figure><button type="button" class="st-face" data-face="${R.esc(x.panel)}" aria-label="Tap the face in the still on panel ${R.esc(x.panel)}"><img src="${R.esc(proj.dir + q.image)}" alt=""><i hidden></i></button><figcaption>${R.esc(x.shot)}</figcaption></figure>`; }).join("") + `</div>`;
  }
  async function stillsFace(btn, e) {
    const img = btn.querySelector("img"), r = img.getBoundingClientRect(), f = [round3(clamp01((e.clientX - r.left) / r.width)), round3(clamp01((e.clientY - r.top) / r.height))], id = btn.dataset.face;
    const dot = btn.querySelector("i"); dot.hidden = false; dot.style.left = f[0] * 100 + "%"; dot.style.top = f[1] * 100 + "%";
    try {
      await stillsApi("focus", { p: proj.id, panel: id, focus: f });
      const q = stillsPanel(id); if (q) { q.focus = f; delete q.zoom; render(); snap(); }
      btn.closest("figure").classList.add("set"); stillsSay("Kept. Tap again to move it, or tap another picture.");
    } catch (err) { stillsSay(String(err.message || err), true); }
  }
  function wireStills() {
    $("stillsBtn").addEventListener("click", openStills);
    $("stillsX").addEventListener("click", () => $("stillsDlg").close());
    $("stillsBack").addEventListener("click", () => { stl.match = null; stillsSources(); });
    $("stillsGo").addEventListener("click", stillsUse);
    $("stillsBody").addEventListener("change", (e) => { const sel = e.target.closest("[data-pick]"); if (!sel) return; if (sel.value) stl.picks.set(sel.dataset.pick, sel.value); else stl.picks.delete(sel.dataset.pick); const y = $("stillsDlg").scrollTop; stillsSheet(); $("stillsDlg").scrollTop = y; const again = $("stillsBody").querySelector(`[data-pick="${CSS.escape(sel.dataset.pick)}"]`); if (again) again.focus(); });
    $("stillsBody").addEventListener("click", async (e) => {
      const src = e.target.closest(".st-src"), face = e.target.closest("[data-face]"), un = e.target.closest("[data-unroot]");
      if (src) return stillsMatch(src.dataset.scene != null ? { scene: src.dataset.scene } : { root: +src.dataset.root, folder: src.dataset.folder });
      if (face) return stillsFace(face, e);
      if (un || e.target.id === "stillsAdd") {
        try { await stillsApi("roots", un ? { remove: un.dataset.unroot } : { add: $("stillsPath").value }); stl.sources = await stillsApi("sources"); stillsSources(); if (!un && !stl.sources.folders.length) stillsSay("The folder is on the list, but no SCENE_PLAN.json with stills was found in it (up to three folders down).", true); }
        catch (err) { stillsSay(String(err.message || err), true); }
      }
    });
  }

  // ---------- series settings: the art style and the cast (looks and character sheets) ----------
  let bibleTimer = null;
  const hasSheet = (c) => !!(c && (c.ref || c.sheet));
  function saveBible() { // a moment after the last keystroke
    clearTimeout(bibleTimer);
    bibleTimer = setTimeout(async () => {
      try { const r = await fetch("/api/bible?p=" + encodeURIComponent(proj.id), { method: "PUT", body: JSON.stringify(bible) }); $("seStyleNote").textContent = r.ok ? "Saved. New pictures use it from now on; pictures already drawn stay as they are." : "Could not save the settings."; drafts = {}; }
      catch (e) { $("seStyleNote").textContent = "Could not save the settings."; }
    }, 700);
  }
  async function reloadBible() { bible = await fetch(BASE + "bible.json?t=" + Date.now()).then((r) => (r.ok ? r.json() : bible)).catch(() => bible); drafts = {}; }
  function inChapter(name) { return spec.pages.some((p) => p.layout && leaves(p.layout.rows).some((q) => q.board && (q.board.who || []).some((w) => w.name === name))); }
  let STYLES = [], npStyle = "loose-pen";
  const styleImg = (s) => `<img src="${R.esc(s.example)}" alt="Example of the ${R.esc(s.name)} style" loading="lazy" onerror="this.outerHTML='<span class=&quot;noimg&quot;></span>'">`;
  /** The current style as a button that opens the picker. */
  function styleButton(s, extra) {
    return s ? `${styleImg(s)}<span><b>${R.esc(s.name)} · ${s.colour ? "colour" : "black and white"}</b><small>${R.esc(extra || s.blurb)}</small></span><span class="chg">Change</span>`
      : `<span class="noimg"></span><span><b>Your own style text</b><small>Not one of the ready-made styles.</small></span><span class="chg">Choose</span>`;
  }
  /** Opens the style picker: example cards for every style. Resolves with the style picked, or null if closed. */
  function pickStyle(currentId) {
    const dlg = $("styleDlg");
    $("styleDlgGrid").innerHTML = STYLES.map((s) => `<button type="button" class="scard" data-style="${R.esc(s.id)}" aria-pressed="${s.id === currentId}">${styleImg(s)}` +
      `<b>${R.esc(s.name)}<span class="dot${s.colour ? " art" : ""}">${s.colour ? "Colour" : "B&W"}</span></b><small>${R.esc(s.blurb)}</small></button>`).join("");
    return new Promise((res) => {
      let done = false; const finish = (v) => { if (done) return; done = true; dlg.removeEventListener("click", onClick); dlg.removeEventListener("close", onClose); if (dlg.open) dlg.close(); res(v); };
      const onClick = (e) => { const b = e.target.closest("[data-style]"); if (b) finish(STYLES.find((q) => q.id === b.dataset.style)); else if (e.target === dlg || e.target.closest("#styleDlgX")) finish(null); };
      const onClose = () => finish(null);
      dlg.addEventListener("click", onClick); dlg.addEventListener("close", onClose);
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    });
  }
  function renderSeries() {
    if (!bible) { $("seCast").innerHTML = `<p class="empty">This project has no series settings.</p>`; return; }
    setVal("seStyle", bible.style || ""); $("seColour").checked = !!bible.colour; $("seStrict").checked = !!bible.strict; $("seToner").checked = bible.tone_by === "toner"; $("seTonerBox").style.display = bible.colour ? "none" : "flex"; renderMood(); $("seToneAuto").checked = !!bible.tone_auto; $("seToneAutoBox").style.display = bible.colour || bible.tone_by !== "toner" ? "none" : "flex"; $("seNoNames").checked = !!bible.no_names; $("seStandInsBox").hidden = !bible.no_names; setVal("seStandIns", bible.stand_ins || "");
    readingSegs($("seReading"), readingNow());
    const on = readOnNow(); $("seReadOn").innerHTML = Object.entries(READ_ON).map(([k, [a, b]]) => `<button type="button" class="seg" data-readon="${k}" aria-pressed="${on === k}">${a} <small>(${b})</small></button>`).join("");
    $("seReadOnNote").textContent = on === "phone" ? "Pages are read small: the Paneler aims for 3 to 5 roomy panels a page, and the checks say so when pages get crowded." : "Pages are read at book size: about five panels a page, up to six.";
    $("seReadingNote").textContent = readingNow() === "rtl" ? "Panels run from the right of each row, and in a panel the first balloon sits top right. The words stay in horizontal English."
      : "Panels run from the left of each row, and in a panel the first balloon sits top left.";
    const cur = STYLES.find((s) => s.id === bible.style_id) || STYLES.find((s) => s.style === bible.style), edited = cur && cur.style !== bible.style;
    $("seStyleInfo").textContent = (cur ? `This series is drawn in “${cur.name}”${edited ? ", with your own changes to the wording" : ""}.` : "This series has its own style text.") + " Pick another to change the look of every new picture.";
    $("seStyleBtn").innerHTML = styleButton(cur, edited ? "with your changes to the wording" : "");
    $("seOwnRow").hidden = !canDraw(); $("seOwnPicBtn").hidden = !(cur && cur.own); $("seOwnSave").textContent = cur && cur.own ? "Save my changes to this style" : "Save this as my own style";
    const names = Object.keys(bible.cast), without = names.filter((n) => !hasSheet(bible.cast[n]) && !jobs["sheet:" + n]);
    $("seCastInfo").textContent = names.length ? `${names.length} character${names.length === 1 ? "" : "s"}; ${names.filter((n) => hasSheet(bible.cast[n])).length} with a sheet.` : "No characters yet.";
    $("seAll").hidden = !canDraw() || !without.length; $("seAll").textContent = `Draw sheets for the ${without.length} without one`;
    $("seCast").innerHTML = names.map((n) => {
      const c = bible.cast[n], j = jobs["sheet:" + n], busy = j && (j.status === "waiting" || j.status === "drawing");
      const stale = c.sheet && (c.sheet_style || "") !== (bible.style_id || "") && c.sheet_style !== undefined;
      const pic = c.thumb ? `<img class="sheet" src="${R.esc(BASE + c.thumb)}" alt="Character sheet for ${R.esc(n)}">` + (stale ? `<p class="state">This sheet was drawn in another style. Draw a new one so the panels match.</p>` : "") : `<span class="sheet">${busy ? "Drawing the sheet…" : "No sheet yet: this character is drawn from the words below, so their look will drift."}</span>`;
      const state = busy ? `<p class="state">${j.status === "drawing" ? `Drawing with Codex (${mins(j.now - j.at)} so far)` : `Waiting its turn: ${j.ahead} ahead`}</p>` : j && j.status === "failed" ? `<p class="state bad">Could not draw: ${R.esc(j.msg || "")}</p>` : "";
      return `<div class="ccard" data-name="${R.esc(n)}">${pic}<b>${R.esc(n)}${inChapter(n) ? "" : ` <small style="color:var(--muted);font-weight:500">· not in this chapter's panels</small>`}</b>` +
        `<div class="field"><label>Look <output>age, build, hair, clothes</output></label><textarea data-look rows="3">${R.esc(c.desc || "")}</textarea></div>` +
        `<div class="field"><label>Other outfits <output>optional: which pages, what they wear</output></label><textarea data-outfits rows="2" placeholder="Pages 6 to 9: pyjamas, hair down">${R.esc(c.outfits || "")}</textarea></div>${state}` +
        (canDraw() ? `<div class="row"><button type="button" class="btn${hasSheet(c) ? "" : " primary"}" data-sdraw${busy ? " disabled" : ""}>${hasSheet(c) ? "Draw a new sheet" : "Draw a sheet"}</button>` +
          `<label class="btn" style="text-align:center;cursor:pointer">Upload<input type="file" data-supload accept="image/*" hidden></label></div>` : "") +
        (hasSheet(c) && c.approved === false ? `<p class="state">Not approved yet. Look at the sheet: if this is the character, approve it.</p><button type="button" class="btn primary" data-sapprove>Approve this sheet</button>` : "") +
        (c.sheet ? `<button type="button" class="btn link" data-sremove>Remove this sheet</button>` : "") + (canDraw() ? `<button type="button" class="btn link" data-srename>Rename</button>` : "") + `</div>`;
    }).join("");
    for (const [kind, field, box, hint] of [["place", "places", "sePlaces", "what is there, light, colours"], ["prop", "props", "seProps", "shape, size, material, details"]]) {
      const all = bible[field] || {};
      $(box).innerHTML = Object.keys(all).map((n) => {
        const c = all[n], j = jobs[`sheet:${kind}:${n}`], busy = j && (j.status === "waiting" || j.status === "drawing");
        const pic = c.thumb ? `<img class="sheet" src="${R.esc(BASE + c.thumb)}" alt="Reference picture of ${R.esc(n)}">` : `<span class="sheet">${busy ? "Drawing the picture…" : `No picture yet: this ${kind} is drawn from the words below, so it will change from panel to panel.`}</span>`;
        const state = busy ? `<p class="state">${j.status === "drawing" ? `Drawing with Codex (${mins(j.now - j.at)} so far)` : `Waiting its turn: ${j.ahead} ahead`}</p>` : j && j.status === "failed" ? `<p class="state bad">Could not draw: ${R.esc(j.msg || "")}</p>` : "";
        return `<div class="ccard" data-thing="${R.esc(n)}" data-kind="${kind}">${pic}<b>${R.esc(n)}</b><div class="field"><label>Look <output>${hint}</output></label><textarea data-thinglook rows="4">${R.esc(c.desc || "")}</textarea></div>${state}` +
          (canDraw() ? `<div class="row"><button type="button" class="btn${c.sheet ? "" : " primary"}" data-tdraw${busy ? " disabled" : ""}>${c.sheet ? "Draw a new picture" : "Draw a picture"}</button>` +
            `<label class="btn" style="text-align:center;cursor:pointer">Upload<input type="file" data-tupload accept="image/*" hidden></label></div>` : "") +
          `<button type="button" class="btn link" data-tremove>Remove this ${kind}</button></div>`;
      }).join("") || `<p class="empty">None yet.</p>`;
    }
  }
  async function shrinkUpload(f) { // an uploaded picture, at most 1600 px, as a JPEG data URL
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.9);
  }
  function wireSeries() {
    $("seReadOn").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-readon]"); if (!b || !bible || b.dataset.readon === readOnNow()) return;
      const was = bible.read_on; bible.read_on = b.dataset.readon; clearTimeout(bibleTimer);
      try { const r = await fetch("/api/bible?p=" + encodeURIComponent(proj.id), { method: "PUT", body: JSON.stringify(bible) }); if (!r.ok) throw new Error("not saved"); }
      catch (err) { bible.read_on = was; setStatus("Where the series is read could not be saved.", "error"); renderSeries(); return; }
      spec.read_on = bible.read_on; renderSeries(); render();
      setStatus(bible.read_on === "phone" ? "This series is read on a phone: new storyboards aim for 3 to 5 panels a page." : "This series is read in print: new storyboards aim for about five panels a page.", "ok");
    });
    $("seReading").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-reading]"); if (!b || !bible || b.dataset.reading === readingNow()) return;
      const to = b.dataset.reading, drawn = spec.pages.reduce((n, p) => n + (p.layout ? leaves(p.layout.rows).filter((q) => q.image).length : 0), 0);
      if (drawn && !confirm(`Turn this series to read ${READING[to][0].toLowerCase()}?\n\nEvery page's panels change sides, in this chapter now and in the series' other chapters when they are next opened. The ${drawn} picture${drawn === 1 ? "" : "s"} already drawn stay${drawn === 1 ? "s" : ""} in ${drawn === 1 ? "its panel and is" : "their panels and are"} not redrawn, so who stands left and right inside a picture does not change. You can turn it back the same way.`)) return;
      bible.reading = to;
      clearTimeout(bibleTimer);
      try { const r = await fetch("/api/bible?p=" + encodeURIComponent(proj.id), { method: "PUT", body: JSON.stringify(bible) }); if (!r.ok) throw new Error("not saved"); }
      catch (err) { setStatus("The reading direction could not be saved.", "error"); await reloadBible(); renderSeries(); return; }
      const n = syncReading(); thumbCache.clear(); drafts = {}; hist = [JSON.stringify(spec)]; redo = []; queueSave(); render(); // undo does not cross a change of direction
      setStatus(`This series now reads ${READING[to][0].toLowerCase()}. ${n} page${n === 1 ? "" : "s"} turned; new storyboards and pictures follow it.`, "ok");
    });
    for (const [kind, field, box, form, input] of [["place", "places", "sePlaces", "sePlaceForm", "seNewPlace"], ["prop", "props", "seProps", "sePropForm", "seNewProp"]]) {
      const url = (n) => `/api/sheet?p=${encodeURIComponent(proj.id)}&kind=${kind}&name=${encodeURIComponent(n)}`;
      const push = async () => { clearTimeout(bibleTimer); await fetch("/api/bible?p=" + encodeURIComponent(proj.id), { method: "PUT", body: JSON.stringify(bible) }); drafts = {}; };
      $(box).addEventListener("input", (e) => { const card = e.target.closest("[data-thing]"); if (!card || e.target.dataset.thinglook == null) return; bible[field][card.dataset.thing].desc = e.target.value; $("seStyleNote").textContent = "Saving…"; saveBible(); });
      $(box).addEventListener("click", async (e) => {
        const card = e.target.closest("[data-thing]"); if (!card) return; const n = card.dataset.thing;
        if (e.target.closest("[data-tremove]")) { delete bible[field][n]; await push(); renderSeries(); }
        else if (e.target.closest("[data-tdraw]")) { await push(); try { const r = await fetch(url(n), { method: "POST" }); if (r.ok) jobs[`sheet:${kind}:${n}`] = Object.assign(await r.json(), { now: Date.now() }); } catch (err) { /* stays */ } renderSeries(); pollJobs(); }
      });
      $(box).addEventListener("change", async (e) => {
        const card = e.target.closest("[data-thing]"); if (!card || e.target.dataset.tupload == null || !e.target.files[0]) return;
        await push(); const r = await fetch(url(card.dataset.thing), { method: "PUT", body: JSON.stringify({ dataUrl: await shrinkUpload(e.target.files[0]) }) });
        setStatus(r.ok ? `Picture added for ${card.dataset.thing}.` : "That picture could not be added.", r.ok ? "ok" : "error"); await reloadBible(); renderSeries();
      });
      $(form).addEventListener("submit", async (e) => {
        e.preventDefault(); const n = $(input).value.trim(); if (!n || !bible) return; bible[field] = bible[field] || {}; if (bible[field][n]) return;
        bible[field][n] = { desc: `${n.toUpperCase()}: ` }; $(input).value = ""; await push(); renderSeries();
      });
    }
    $("seStyle").addEventListener("input", (e) => { if (!bible) return; if (/<[^<>]{3,}>/.test(e.target.value)) { $("seStyleNote").textContent = "Not used yet: fill in every part between the < > marks. Until then pictures keep the style from before."; return; } bible.style = e.target.value; $("seStyleNote").textContent = "Saving…"; saveBible(); });
    const ownSend = async (bodyObj) => { const r = await fetch("/api/styles", { method: "POST", body: JSON.stringify(bodyObj) }), j = await r.json().catch(() => ({})); if (!r.ok) { setStatus(j.error || "The style could not be saved.", "error"); return null; }
      STYLES = await fetch("/api/styles").then((x) => x.json()).catch(() => STYLES); return j; };
    $("seMoodFile").addEventListener("change", async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f || !bible) return;
      if (moodRefs().length >= MOOD_MAX) return setStatus(`A series has ${MOOD_MAX} mood pictures at most. Remove one first.`, "error");
      try { const r = await addUpload(f); bible.mood = moodRefs().map((m) => ({ id: m.id, name: m.name })).concat([{ id: r.id, name: String(f.name || "picture").slice(0, 80) }]); $("seStyleNote").textContent = "Saving…"; saveBible(); renderMood(); setStatus("The mood picture goes with every panel drawn from now on. Pictures already drawn are not changed.", "ok"); }
      catch (err) { setStatus("That picture could not be added.", "error"); } });
    $("seMoodList").addEventListener("click", (e) => { const b = e.target.closest("[data-mood-del]"); if (!b || !bible) return; bible.mood = moodRefs().filter((m) => m.id !== b.dataset.moodDel).map((m) => ({ id: m.id, name: m.name })); if (!bible.mood.length) delete bible.mood; $("seStyleNote").textContent = "Saving…"; saveBible(); renderMood(); });
    $("seOwnTpl").addEventListener("click", () => { // a style holds better when each part is said: the five sections our own styles are written in
      if (!bible || !confirm("Replace the style text in this box with five empty sections to fill in? The series keeps its style until every section is filled.")) return;
      const t = "Style: <one or two sentences: what kind of picture this is, and what it is not>. CHARACTER DESIGN: <head and body proportions; face shape; how eyes, brows, nose and mouth are drawn; hair; the resting expression>. LINE AND COLOUR: <the line: tool, weight, how steady; shading; palette; light; texture>. COMPOSITION AND FINISH: <how full or empty a picture is; how backgrounds are drawn where asked for; how much detail>. AVOID: <what it must never look like>. Do not copy any labels or text from the reference sheets.";
      $("seStyle").value = t; $("seStyleNote").textContent = "Fill in each part between the < > marks. Until then pictures keep the style from before."; $("seStyleMore").open = true; $("seStyle").focus();
    });
    $("seOwnSave").addEventListener("click", async () => {
      if (!bible) return; const cur = STYLES.find((q) => q.id === bible.style_id);
      const name = cur && cur.own ? cur.name : (prompt("A name for your style (it joins the style picker for every project):", "") || "").trim(); if (!name) return;
      const st = await ownSend({ id: cur && cur.own ? cur.id : undefined, name, style: bible.style, colour: !!bible.colour }); if (!st) return;
      bible.style_id = st.id; saveBible(); renderSeries(); setStatus(`“${st.name}” is saved as your own style. Add an example picture so it shows in the picker.`, "ok");
    });
    $("seOwnPic").addEventListener("change", async (e) => {
      const f = e.target.files[0], cur = bible && STYLES.find((q) => q.id === bible.style_id); if (!f || !cur || !cur.own) return;
      if (await ownSend({ id: cur.id, dataUrl: await shrinkUpload(f) })) { renderSeries(); setStatus("Example picture added.", "ok"); } e.target.value = "";
    });
    $("seToner").addEventListener("change", (e) => { if (!bible) return; if (e.target.checked) bible.tone_by = "toner"; else delete bible.tone_by; $("seToneAutoBox").style.display = bible.colour || bible.tone_by !== "toner" ? "none" : "flex"; $("seStyleNote").textContent = "Saving…"; saveBible(); });
    $("seToneAuto").addEventListener("change", (e) => { if (!bible) return; if (e.target.checked) bible.tone_auto = true; else delete bible.tone_auto; $("seStyleNote").textContent = "Saving…"; saveBible(); });
    $("seStrict").addEventListener("change", (e) => { if (!bible) return; bible.strict = e.target.checked; $("seStyleNote").textContent = "Saving…"; saveBible(); });
    $("seNoNames").addEventListener("change", (e) => { if (!bible) return; bible.no_names = e.target.checked; $("seStandInsBox").hidden = !bible.no_names; $("seStyleNote").textContent = "Saving…"; saveBible(); });
    $("seStandIns").addEventListener("input", (e) => { if (!bible) return; bible.stand_ins = e.target.value; $("seStyleNote").textContent = "Saving…"; saveBible(); });
    $("seColour").addEventListener("change", (e) => { if (!bible) return; bible.colour = e.target.checked; $("seStyleNote").textContent = "Saving…"; saveBible(); });
    $("seStyleBtn").addEventListener("click", async () => {
      if (!bible) return;
      const s = await pickStyle(bible.style_id); if (!s) return;
      bible.style = s.style; bible.style_id = s.id; bible.colour = !!s.colour;
      if (bible.tones === "Use the one light dot tone sparingly.") bible.tones = ""; // a black-and-white leftover from the default
      $("seStyle").value = s.style; $("seStyleNote").textContent = "Saving…"; saveBible(); renderSeries();
    });
    const drawSheet = async (n) => { try { const r = await fetch(`/api/sheet?p=${encodeURIComponent(proj.id)}&name=${encodeURIComponent(n)}`, { method: "POST" }); if (r.ok) jobs["sheet:" + n] = Object.assign(await r.json(), { now: Date.now() }); } catch (e) { /* stays as it was */ } };
    const flush = async () => { clearTimeout(bibleTimer); await fetch("/api/bible?p=" + encodeURIComponent(proj.id), { method: "PUT", body: JSON.stringify(bible) }); }; // the runner reads the saved look
    $("seCast").addEventListener("input", (e) => { const card = e.target.closest("[data-name]"), c = card && bible.cast[card.dataset.name]; if (!c) return;
      if (e.target.dataset.look != null) c.desc = e.target.value; else if (e.target.dataset.outfits != null) { if (e.target.value.trim()) c.outfits = e.target.value; else delete c.outfits; } else return;
      $("seStyleNote").textContent = "Saving…"; saveBible(); });
    $("seCast").addEventListener("click", async (e) => {
      const card = e.target.closest("[data-name]"); if (!card) return; const n = card.dataset.name;
      if (e.target.closest("[data-sdraw]")) { await flush(); await drawSheet(n); renderSeries(); pollJobs(); }
      else if (e.target.closest("[data-srename]")) {
        const to = (prompt(`New name for ${n}. It changes in the cast, on the storyboards and on every picture of every chapter in this series.`, n) || "").trim();
        if (!to || to === n) return;
        await flush(); if (dirty) { clearTimeout(saveTimer); await save(); }
        const r = await fetch("/api/cast/rename?p=" + encodeURIComponent(proj.id), { method: "POST", body: JSON.stringify({ from: n, to }) }), j = await r.json().catch(() => ({}));
        if (!r.ok) { setStatus(j.error || "The name could not be changed.", "error"); return; }
        await loadProject(proj.id); mode = "series"; render(); setStatus(`${n} is now ${to}${j.chapters > 1 ? ` in all ${j.chapters} chapters` : ""}.`, "ok");
      }
      else if (e.target.closest("[data-sapprove]")) { await reloadBible(); if (bible.cast[n]) bible.cast[n].approved = true; await flush(); renderSeries(); setStatus(`${n}'s sheet is approved.`, "ok"); }
      else if (e.target.closest("[data-sremove]")) { const c = bible.cast[n]; delete c.sheet; delete c.thumb; delete c.ref_role; await flush(); drafts = {}; renderSeries(); }
    });
    $("seCast").addEventListener("change", async (e) => {
      const card = e.target.closest("[data-name]"); if (!card || e.target.dataset.supload == null || !e.target.files[0]) return;
      const f = e.target.files[0], dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      await flush();
      const r = await fetch(`/api/sheet?p=${encodeURIComponent(proj.id)}&name=${encodeURIComponent(card.dataset.name)}`, { method: "PUT", body: JSON.stringify({ dataUrl: c.toDataURL("image/jpeg", 0.9) }) });
      setStatus(r.ok ? `Sheet added for ${card.dataset.name}.` : "That picture could not be added.", r.ok ? "ok" : "error");
      await reloadBible(); renderSeries();
    });
    $("seAll").addEventListener("click", async () => { await flush(); for (const n of Object.keys(bible.cast)) if (!hasSheet(bible.cast[n]) && !jobs["sheet:" + n]) await drawSheet(n); renderSeries(); pollJobs(); });
    $("seAddForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const n = $("seNewName").value.trim(); if (!n || !bible || bible.cast[n]) return;
      bible.cast[n] = { desc: `${n.toUpperCase()}: ` }; $("seNewName").value = ""; await flush(); renderSeries();
    });
  }

  function render() {
    const atHome = mode === "home" || mode === "book";
    document.body.classList.toggle("at-home", atHome);
    if (atHome) $("homeBtn").setAttribute("aria-current", "page"); else $("homeBtn").removeAttribute("aria-current");
    if (atHome) $("mangaBtn").removeAttribute("aria-current"); else $("mangaBtn").setAttribute("aria-current", "page");
    $("sbProj").textContent = atHome || !spec ? "" : `${proj.label} · ${spec.pages.length} pages`;
    { const M = { letter: "Lettering", layout: "Layout", art: "Art", check: "Check", chapter: "Chapter", series: "Series" }, pg = spec && spec.pages[pageIdx];
      $("crumb").innerHTML = atHome || !spec ? "" : mode === "chapter" || mode === "series" || mode === "check" ? `/ <b>${M[mode]}</b>` : `/ ${R.esc(pg ? pg.label || "Page " + pg.number : "")} / <b>${M[mode] || ""}</b>`; }
    $("homeView").hidden = mode !== "home";
    $("bookView").hidden = mode !== "book";
    $("checkView").hidden = mode !== "check"; $("checkTab").hidden = store.kind !== "local" || !spec || spec.kind !== "storyboard";
    if (mode === "book") { $("seriesView").hidden = true; $("chapterView").hidden = true; $("workView").hidden = true; renderBook(); return; }
    $("seriesView").hidden = mode !== "series";
    $("seriesTab").hidden = store.kind !== "local" || !bible;
    if (mode === "series") { $("chapterView").hidden = true; $("workView").hidden = true; renderSide(); renderModes(); renderSeries(); updateUndo(); return; }
    if (mode === "home") { $("chapterView").hidden = true; $("workView").hidden = true; renderHome(); return; }
    if (mode === "check") { $("chapterView").hidden = true; $("workView").hidden = true; renderSide(); renderModes(); renderCheck(); updateUndo(); return; }
    $("chapterView").hidden = mode !== "chapter";
    $("workView").hidden = mode === "chapter";
    renderSide();
    if (mode === "chapter") { renderModes(); renderChapter(); updateUndo(); return; }
    const p = page();
    measured = p.text.map((it) => R.measure(it, spec, measureText));
    let guidesSvg = "";
    if (guides) {
      for (const b of p.layout ? [] : p.panels || []) guidesSvg += `<rect x="${b[0] * W}" y="${b[1] * H}" width="${(b[2] - b[0]) * W}" height="${(b[3] - b[1]) * H}" class="g-panel"/>`;
      for (const b of R.protectBoxes(p, lib())) guidesSvg += `<rect x="${b[0] * W}" y="${b[1] * H}" width="${(b[2] - b[0]) * W}" height="${(b[3] - b[1]) * H}" class="g-protect"/>`;
    }
    if (mode !== "layout") { placing = null; shaping = false; selV = -1; } // a half-made shape does not follow you to another screen
    let hits = "", selSvg = "";
    const G = p.layout ? R.layoutGeom(p.layout) : null;
    const pts = (ps) => ps.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ");
    if (mode === "letter") measured.forEach((L, i) => {
      const [ox, oy] = R.outer(L);
      hits += `<rect class="hit" data-i="${i}" x="${L.cx - ox}" y="${L.cy - oy}" width="${2 * ox}" height="${2 * oy}" rx="20"/>`;
    });
    if (mode === "art" && G) for (const c of G.cells.concat(G.insets)) {
      hits += `<polygon class="phit" style="cursor:pointer" data-pid="${R.esc(c.panel.id)}" points="${pts(c.drawPoly)}"/>`;
      if (c.panel.request) {
        const [x0, y0, x1, y1] = c.bbox;
        selSvg += `<polygon class="art-queued" points="${pts(c.drawPoly)}"/><text class="art-queued-t" data-pid="${R.esc(c.panel.id)}" x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2}">${jobWord(c.panel.id)}${jobWord(c.panel.id) === "Drawing" ? "…" : ""}</text>`;
      }
      if (selP === c.panel.id) selSvg += `<polygon class="sel" points="${pts(c.drawPoly)}"/>`;
    }
    if (mode === "art" && G && selP) { // who is labelled where on the selected picture (dashed = placed from the storyboard, a guess)
      const cells = R.allPanels(p.layout), ci = cells.findIndex((c) => c.panel.id === selP);
      if (ci >= 0 && cells[ci].panel.image) for (const z of R.faceZones(p, lib())) {
        if (z.cell !== ci || !z.who) continue;
        const [a, b, c2, d] = z.box, g = z.guess ? " guess" : "";
        selSvg += `<rect class="face-box${g}" x="${a}" y="${b}" width="${c2 - a}" height="${d - b}" rx="6"/><text class="face-tag${g}" x="${(a + c2) / 2}" y="${b - 8 < cells[ci].bbox[1] + 20 ? d + 24 : b - 8}">${R.esc(z.who)}${z.guess ? "?" : ""}</text>`;
      }
    }
    if (mode === "layout" && G) {
      for (const c of G.cells) {
        hits += `<polygon class="phit" data-pid="${R.esc(c.panel.id)}" points="${pts(c.drawPoly)}"/>`;
        if (selP === c.panel.id) selSvg += `<polygon class="sel" points="${pts(c.drawPoly)}"/>`;
      }
      const mid = (L) => [(L.p0[0] + L.p1[0]) / 2, (L.p0[1] + L.p1[1]) / 2];
      const gut = (kind, L, extra) => {
        const [mx, my] = mid(L), [tx, ty] = L.p1;
        return `<g class="gut" data-gut="${kind}" data-path="${L.path.join(",")}" data-r="${L.r}"${extra}><line class="gut-hit" x1="${L.p0[0]}" y1="${L.p0[1]}" x2="${L.p1[0]}" y2="${L.p1[1]}"/>` +
          `<line class="gut-line" x1="${L.p0[0]}" y1="${L.p0[1]}" x2="${L.p1[0]}" y2="${L.p1[1]}"/>` +
          `<circle class="gut-knob" data-part="move" cx="${mx}" cy="${my}" r="17"/>` +
          `<rect class="tilt-knob" data-part="tilt" x="${tx - 13}" y="${ty - 13}" width="26" height="26" transform="rotate(45 ${tx} ${ty})"/></g>`;
      };
      for (const L of G.rowLines) hits += gut("row", L, "");
      for (const L of G.colLines) hits += gut("col", L, ` data-k="${L.k}"`);
      for (const c of G.insets) {
        hits += `<polygon class="phit" data-pid="${R.esc(c.panel.id)}" points="${pts(c.drawPoly)}"/>`;
        if (selP === c.panel.id) {
          const [x0, y0, x1, y1] = c.bbox;
          selSvg += `<polygon class="sel" points="${pts(c.drawPoly)}"/>`;
          hits += `<g class="inset-knobs"><circle class="inset-knob" data-part="imove" data-pid="${R.esc(c.panel.id)}" cx="${x0}" cy="${y0}" r="20"/>` +
            `<path class="knob-icon" d="M${x0 - 9} ${y0}h18M${x0} ${y0 - 9}v18"/>` +
            `<circle class="inset-knob" data-part="iresize" data-pid="${R.esc(c.panel.id)}" cx="${x1}" cy="${y1}" r="20"/>` +
            `<path class="knob-icon" d="M${x1 - 7} ${y1 + 7}L${x1 + 7} ${y1 - 7}"/></g>`;
        }
      }
      if (shaping && selP && !placing) { const S = shapeCorners(); if (S) { // the chosen panel's corners: a dot on each, a small + on each edge
        S.pts.forEach((a, k) => { const b = S.pts[(k + 1) % S.pts.length], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (S.pts.length < 64 && Math.hypot(b.x - a.x, b.y - a.y) > 70) hits += `<circle class="vadd" data-part="vadd" data-k="${k}" cx="${mx}" cy="${my}" r="13"/><path class="vadd-i" d="M${mx - 7} ${my}h14M${mx} ${my - 7}v14"/>`; });
        for (const a of S.pts) hits += `<circle class="vtx" data-part="vtx" data-k="${a.k}" data-on="${selV === a.k ? 1 : 0}" cx="${a.x}" cy="${a.y}" r="17"/>`; } }
      for (const b of breakouts(p)) { // above everything else on the page: tap to choose, drag to move
        const x0 = b.box[0] * W, y0 = b.box[1] * H, x1 = b.box[2] * W, y1 = b.box[3] * H;
        hits += `<rect class="phit" data-bo="${R.esc(b.id)}" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>`;
        if (selB === b.id) {
          selSvg += `<rect class="sel" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>`;
          hits += `<g class="inset-knobs"><circle class="inset-knob" data-part="bmove" data-bo="${R.esc(b.id)}" cx="${x0}" cy="${y0}" r="20"/><path class="knob-icon" d="M${x0 - 9} ${y0}h18M${x0} ${y0 - 9}v18"/>` +
            `<circle class="inset-knob" data-part="bresize" data-bo="${R.esc(b.id)}" cx="${x1}" cy="${y1}" r="20"/><path class="knob-icon" d="M${x1 - 7} ${y1 + 7}L${x1 + 7} ${y1 - 7}"/></g>`;
        }
      }
    }
    if (placing) selSvg += (placing.length > 1 ? `<polygon class="free-line" points="${placing.map(([x, y]) => (x * W).toFixed(1) + "," + (y * H).toFixed(1)).join(" ")}"/>` : "") + placing.map(([x, y], k) => `<circle class="vtx" data-on="${k === 0 ? 1 : 0}" cx="${x * W}" cy="${y * H}" r="${k === 0 ? 22 : 15}" style="pointer-events:none"/>`).join("");
    $("page").classList.toggle("placing", !!placing);
    for (const b of breakouts(p)) if (!b.image) { // not drawn yet: its place is shown on the page (never in an export)
      const x0 = b.box[0] * W, y0 = b.box[1] * H, x1 = b.box[2] * W, y1 = b.box[3] * H, j = boJob(b);
      selSvg += `<rect class="bo-wait" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="14"/><text class="bo-wait-t" x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2 - 8}">Break-out${b.who ? ": " + R.esc(b.who.slice(0, 22)) : ""}</text>` +
        `<text class="bo-wait-t" x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2 + 28}">${boBusy(b) ? (j.status === "drawing" ? "Drawing…" : "Waiting its turn") : j && j.status === "failed" ? "Not drawn" : "Not drawn yet"}</text>`;
    }
    if (mode === "letter" && sel >= 0 && measured[sel]) {
      const L = measured[sel], [ox, oy] = R.outer(L);
      selSvg += `<rect class="sel" x="${L.cx - ox - 8}" y="${L.cy - oy - 8}" width="${2 * ox + 16}" height="${2 * oy + 16}" rx="14"/>`;
      if (L.item.tail && R.TAIL_KINDS.has(L.kind)) {
        const tx = L.item.tail[0] * W, ty = L.item.tail[1] * H;
        selSvg += `<line class="tail-guide" x1="${L.cx}" y1="${L.cy}" x2="${tx}" y2="${ty}"/>`;
        selSvg += `<circle class="tail-handle" data-tail="${sel}" cx="${tx}" cy="${ty}" r="22"/><circle class="tail-dot" cx="${tx}" cy="${ty}" r="7"/>`;
      }
    }
    const art = $("art"), href = p.layout ? "" : BASE + R.pageArt(p);
    if (art.getAttribute("href") !== href) art.setAttribute("href", href);
    art.setAttribute("visibility", p.layout ? "hidden" : "visible");
    $("page").classList.toggle("layout-mode", mode === "layout" || mode === "art");
    if (marking && (mode !== "art" || selP !== marking.pid)) marking = null;
    $("page").classList.toggle("marking", !!marking);
    $("dyn").innerHTML = (p.layout ? `<g class="layout">${R.layoutSvg(p, (s) => BASE + s, sizes())}</g>` : "") +
      `<g class="guides">${guidesSvg}</g>` + R.letteringSvg(measured) + R.pageNumberSvg(p) +
      `<g class="hits">${hits}</g><g class="selection">${selSvg}</g>`;
    renderModes(); renderInspector(); renderLayoutPanel(); renderArtPanel(); renderChecks(); updateUndo();
  }
  function lib() { const s = {}; for (const it of spec.library || []) s[it.src] = it; return s; }
  function sizes() { const s = {}; for (const it of spec.library || []) s[it.src] = it.size; return s; }

  function renderModes() {
    for (const b of document.querySelectorAll("[data-mode]")) b.setAttribute("aria-selected", b.dataset.mode === mode);
    $("addDetails").hidden = mode !== "letter";
    if (mode === "chapter" || mode === "series" || mode === "check") { $("planBox").hidden = true; return; }
    const p = page(), plan = R.planFor(p), hasPlan = !!(p.layout && plan.length);
    $("pageNote").hidden = !p.note; $("pageNote").textContent = p.note ? "Page beat: " + p.note : "";
    $("planBox").hidden = mode !== "letter" || !hasPlan;
    if (hasPlan) {
      $("autoBtn").textContent = p.text.length ? "Letterer: place balloons again" : "Letterer: place balloons";
      $("planList").innerHTML = plan.map((l) => `<li><span class="chip k">${R.esc(R.KINDS[l.kind || "speech"].label)}</span><span><b>${R.esc(l.speaker || "Caption")}</b>${l.off ? " (off-panel)" : ""} · panel ${l.panel}: “${R.esc(l.text)}”${l.note ? `<small>${R.esc(l.note)}</small>` : ""}</span></li>`).join("");
    }
  }

  // ---------- sidebar: pages, and the open page's panels ----------
  const capWord = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function panelLabel(q) {
    const b = q.board;
    if (b) return capWord(b.shot || "panel") + ((b.who || []).length ? " · " + b.who.map((w) => w.name).join(", ") : "");
    return q.image ? "Art" : "Empty";
  }
  const panelState = (q) => (q.request ? ["queued", jobWord(q.id)] : q.image ? ["art", "Art"] : ["board", q.board ? "Board" : "Empty"]);

  // ---------- drawing jobs: when the editor runs on your own computer, Generate draws the panel straight away ----------
  let jobs = {}, jobTimer = null;
  const canDraw = () => store.kind === "local";
  /** A storyboard written by a paid model: ask first when it is over the threshold (Codex is in the plan: never asks). */
  async function okToWrite() { if (!canDraw() || !window.Ibasho || !window.Ibasho.modelChoice) return true; let c = null; try { c = await window.Ibasho.modelChoice("text"); } catch (e) { return true; }
    return !c || c.service !== "openrouter" || window.Ibasho.okToSpend(c.jobUsd || 0, `Writing the storyboard with ${c.name}`); }
  // The picture model in use (the model picker; the choice is kept by the server, /api/models). null = not known: Codex.
  let picModel = null;
  async function loadPicModel() { if (!canDraw() || !window.Ibasho || !window.Ibasho.modelChoice) return; try { picModel = await window.Ibasho.modelChoice("picture"); } catch (e) { picModel = null; } if (typeof render === "function") render(); }
  /** What one picture will cost with the model and quality in use (window.IbashoPrice, the same estimate the server uses). */
  const picEst = (o, quality) => (picModel && picModel.service === "openrouter" && picModel.pm && window.IbashoPrice ? window.IbashoPrice.picture(picModel.pm, { quality: quality || picModel.quality, size: o.size || [1024, 1536], refs: Math.min(o.refs || 0, refLimit()), chars: o.chars || 3000 }) : null);
  const picCost = (n) => { const e = picEst({ refs: 2 }); return e && e.usd != null ? ` (about $${(e.usd * n).toFixed(2)})` : ""; };
  const jobWord = (pid) => { const j = jobs[pid]; return !j ? "Queued" : j.status === "drawing" ? "Drawing" : j.status === "waiting" ? "Waiting" : j.status === "failed" ? "Failed" : "Queued"; };
  const mins = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function jobNote(pid) {
    const j = jobs[pid];
    if (!canDraw()) return "Queued for the Artist. On this test page the queue is drawn when you ask Claude to “draw the queue”; the picture then lands in this panel.";
    if (!j) return "Queued. Starting…";
    if (j.status === "drawing") return `Drawing now${j.model ? " with " + (j.model === "codex" ? "Codex" : j.model.split("/").pop()) : ""} (${mins(j.now - j.at)} so far${j.expect ? `, usually about ${mins(j.expect * 1000)}` : ""}). You can keep working: you will hear a chime when it lands.`;
    if (j.status === "waiting") return `Waiting its turn: ${j.ahead} picture${j.ahead === 1 ? "" : "s"} ahead of it. Two pictures are drawn at a time.`;
    if (j.status === "failed") return `This picture could not be drawn: ${j.msg || "no reason given"}`;
    return "Finished. Placing the picture…";
  }
  async function startJobs(ids) {
    if (!canDraw() || !ids.length) return;
    clearTimeout(saveTimer); await save(); // the runner reads the saved request
    for (const id of ids) {
      try { const r = await fetch(`/api/generate?p=${encodeURIComponent(proj.id)}&panel=${encodeURIComponent(id)}`, { method: "POST" }); if (r.ok) jobs[id] = Object.assign(await r.json(), { now: Date.now() }); } catch (e) { /* shown as Queued */ }
    }
    pollJobs();
  }
  async function pollJobs() {
    clearTimeout(jobTimer);
    if (!canDraw()) return;
    const want = proj.id;
    let list = [];
    try { list = await (await fetch("/api/jobs?p=" + encodeURIComponent(want))).json(); } catch (e) { jobTimer = setTimeout(pollJobs, 8000); return; }
    if (want !== proj.id) return;
    const before = jobs; jobs = {};
    for (const j of list) jobs[j.panel] = j;
    const landed = list.filter((j) => j.status === "done" && (!before[j.panel] || before[j.panel].status !== "done"));
    if (landed.some((j) => j.kind === "breakout")) takeBreakouts();
    if (landed.some((j) => j.kind === "tone")) { takeTone(); if (toneDue.size) toneWhenFree(); }
    if (landed.some((j) => j.kind === "sheet")) await reloadBible();
    if (mode === "series") { if (document.activeElement.tagName !== "TEXTAREA") renderSeries(); }
    if (landed.some((j) => j.kind !== "sheet")) await refreshArt();
    else if (mode !== "chapter" && mode !== "series" && mode !== "home" && mode !== "check" && !drag && !sideDrag) { renderSide(); if (mode === "art") { renderArtPanel(); renderQueuedMarks(); } }
    if (list.some((j) => j.status === "waiting" || j.status === "drawing")) jobTimer = setTimeout(pollJobs, 4000);
    else if (landed.some((j) => !j.kind && before[j.panel])) afterDrawn(); // the last picture of a batch has landed
  }
  // ---------- asset check: do the pictures agree with each other and with the approved sheets? (it only warns) ----------
  let CK = null, ckTimer = null, ckFor = "";
  const AUTO = "ibasho-auto-check"; // "on" | "off"; not set = not asked yet. Kept in this browser: it is this person's choice.
  const autoPref = () => { try { return localStorage.getItem(AUTO) || ""; } catch (e) { return ""; } };
  const setAuto = (v) => { try { localStorage.setItem(AUTO, v); } catch (e) { /* no storage */ } };
  const ckBusy = () => !!(CK && CK.job && (CK.job.status === "waiting" || CK.job.status === "drawing"));
  async function loadCheck(method, bodyObj) {
    if (store.kind !== "local" || !spec || spec.kind !== "storyboard") { CK = null; return; }
    const want = proj.id;
    try { const r = await fetch("/api/check?p=" + encodeURIComponent(want), { method: method || "GET", body: bodyObj ? JSON.stringify(bodyObj) : undefined }); const d = await r.json(); if (want !== proj.id || !r.ok) return; const was = ckBusy() && ckFor === want; CK = d; ckFor = want;
      if (was && !ckBusy()) setStatus(d.job && d.job.status === "failed" ? "Asset check failed: " + d.job.msg : d.open ? `Asset check: ${d.open} to look at. Open Check to see.` : "Asset check: the pictures agree.", d.job && d.job.status === "failed" ? "error" : d.open ? "" : "ok");
    } catch (e) { /* shown as it was */ }
    clearTimeout(ckTimer); if (ckBusy()) ckTimer = setTimeout(() => loadCheck().then(() => { if (mode === "check") renderCheck(); }), 5000);
  }
  async function startCheck() { if (dirty) { clearTimeout(saveTimer); await save(); } await loadCheck("POST"); if (mode === "check") renderCheck(); else setStatus("Checking the pictures against each other and the sheets. This takes a few minutes.", "ok"); }
  function afterDrawn() { // pictures have just landed: check them, when this person wants that
    if (store.kind !== "local" || !spec || spec.kind !== "storyboard") return;
    const a = autoPref();
    if (a === "on") return void startCheck();
    if (!a && !$("autoDlg").open) $("autoDlg").showModal();
  }
  function renderCheck() {
    const head = $("checkHead"), body = $("checkBody"); if (!CK || ckFor !== proj.id) { head.innerHTML = `<div><h2>Asset check</h2><p>Loading…</p></div>`; body.innerHTML = ""; loadCheck().then(() => { if (mode === "check" && CK) renderCheck(); }); return; }
    const c = CK.check, busy = ckBusy(), now = {}; for (const p of spec.pages) if (p.layout) { eachPanel(p.layout.rows, (q) => { if (!q.rows && q.id) now[q.id] = q.image || ""; }); for (const q of p.layout.insets || []) if (q.id) now[q.id] = q.image || ""; }
    const live = (f) => now[f.panel] === f.image, open = c ? c.faults.filter((f) => !c.verdicts[f.id] && live(f)) : [];
    const mins = busy && CK.job.status === "drawing" ? Math.max(0, Math.round((CK.job.now - CK.job.at) / 60000)) : 0;
    const state = busy ? (CK.job.status === "drawing" ? `Checking… ${mins} min so far. You can keep working; the answer shows here.` : "Waiting its turn in the queue.")
      : !CK.drawn ? "No pictures drawn yet. Draw some panels in Art first."
      : !c ? `${CK.drawn} picture${CK.drawn === 1 ? "" : "s"} drawn, not checked yet.`
      : `${open.length ? `<b class="warn">${open.length} to look at</b>` : "The pictures agree with each other and the sheets"} · ${c.pictures} pictures checked ${when(c.at)}` + (CK.changed.length ? ` · <b class="warn">${CK.changed.length} picture${CK.changed.length === 1 ? " has" : "s have"} changed since</b>` : "");
    head.innerHTML = `<div><h2>Asset check</h2><p>${state}</p>` + (CK.job && CK.job.status === "failed" ? `<p class="bad">The last check failed: ${R.esc(CK.job.msg)}</p>` : "") +
      `<p style="margin-top:6px">Looks at every drawn panel for the same face, hair, outfit, hands, props and places from picture to picture. It only warns: nothing is held back by it. ${autoPref() === "on" ? "It runs by itself after pictures are drawn." : "It runs when you press the button."} <button type="button" class="linkbtn" data-ck="settings">Change</button></p></div>` +
      `<div class="row"><button class="btn primary" type="button" data-ck="run" ${busy || !CK.drawn ? "disabled" : ""}>${c ? "Check again" : "Check the pictures"}</button></div>`;
    if (!c) { body.innerHTML = ""; return; }
    const chip = (f) => `<span class="chip">${R.esc(f.about)}</span><span class="chip ${f.sure === "high" ? "warn" : ""}">${f.sure === "high" ? "clear" : f.sure === "low" ? "possible" : "likely"}</span>`;
    const fault = (f) => { const v = c.verdicts[f.id], gone = !live(f);
      return `<div class="ckf ${v || gone ? "closed" : ""}" data-fault="${R.esc(f.id)}"><img src="${R.esc(proj.dir + f.image)}" alt="Page ${f.page}, panel ${R.esc(f.panel)}" loading="lazy">
        <div><div class="ckm"><b>Tile ${f.tile}</b> · page ${f.page} ${chip(f)}</div><p>${R.esc(f.what)}</p>
        ${gone ? `<p class="hint">This picture has since been replaced.</p>` : v ? `<p class="hint">${v === "fine" ? "You said it is fine." : v === "sheet" ? "You said the sheet is wrong: change it in Series, then check again." : "Sent to be redrawn with this note."} <button type="button" class="linkbtn" data-ck="undo">Undo</button></p>`
          : `<div class="row"><button class="btn sm" type="button" data-ck="redraw">Redraw this panel</button><button class="btn sm" type="button" data-ck="fine">It is fine</button><button class="btn sm" type="button" data-ck="sheet">The sheet is wrong</button><button class="btn sm" type="button" data-ck="open">Open in Art</button></div>`}</div></div>`; };
    const KINDS = { person: "Character", place: "Place", prop: "Prop" };
    body.innerHTML = c.groups.map((g) => { const fs = c.faults.filter((f) => f.name === g.name).sort((a, b) => (!!(c.verdicts[a.id] || !live(a)) - !!(c.verdicts[b.id] || !live(b))) || a.tile - b.tile), n = fs.filter((f) => !c.verdicts[f.id] && live(f)).length, notes = (c.sheetNotes || []).filter((x) => x.name === g.name);
      return `<details class="ckg" ${fs.length ? "open" : ""}><summary><b>${R.esc(g.name)}</b> <span class="hint">${KINDS[g.kind] || ""} · ${g.tiles.length} appearance${g.tiles.length === 1 ? "" : "s"}</span> ${n ? `<span class="chip warn">${n} to look at</span>` : `<span class="chip ok">agrees</span>`}</summary>
        ${notes.map((x) => `<p class="cknote">About the sheet: ${R.esc(x.what)}</p>`).join("")}
        <div class="ckl">${g.sheet ? `<a href="${R.esc(proj.dir + g.sheet.replace(/-thumb\.jpg$/, ".png"))}" target="_blank" rel="noopener" class="cks"><img src="${R.esc(proj.dir + g.sheet)}" alt="${R.esc(g.name)}: approved sheet" loading="lazy"><span>Sheet</span></a>` : `<span class="cks none">No sheet: compared with each other</span>`}
          ${g.lineups.map((f, i) => `<a href="${R.esc(proj.dir + f)}?t=${encodeURIComponent(c.at)}" target="_blank" rel="noopener"><img src="${R.esc(proj.dir + f)}?t=${encodeURIComponent(c.at)}" alt="${R.esc(g.name)}: line-up ${i + 1}, numbered tiles" loading="lazy"></a>`).join("")}</div>
        ${fs.map(fault).join("")}</details>`; }).join("") || `<p class="hint">Nobody in the drawn pictures has a labelled face yet, so there was nothing to line up.</p>`;
  }
  const when = (iso) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? "" : "s"} ago`; };
  async function redrawFault(f) {
    const i = spec.pages.findIndex((p) => { let hit = false; if (p.layout) { eachPanel(p.layout.rows, (q) => { if (q.id === f.panel) hit = true; }); for (const q of p.layout.insets || []) if (q.id === f.panel) hit = true; } return hit; });
    if (i < 0) return setStatus("That panel is no longer in the chapter.", "error");
    pageIdx = i; const a = aiPrompt(f.panel);
    if (!a) { mode = "art"; selP = f.panel; render(); return setStatus("This panel has no Artist prompt to add the note to. Write the request here.", "error"); }
    const d = draftFor(f.panel); d.mode = "artist";
    const c = CK.check, all = c.faults.filter((x) => x.panel === f.panel && x.image === f.image && (x.id === f.id || !c.verdicts[x.id])); // every open fault on this picture goes into the one redraw
    d.artist = a.prompt + "\n\nFIX FROM THE LAST PICTURE (it got " + (all.length > 1 ? "these" : "this") + " wrong):\n" + all.map((x) => `- ${x.name}: ${x.what}`).join("\n") + "\nDraw " + [...new Set(all.map((x) => x.name))].join(" and ") + " exactly as on the sheet.";
    if (canDraw() && window.Ibasho && !(await window.Ibasho.okToSpend(costOf([f.panel]), "This picture"))) return; // a paid model: the price is agreed first, as on the Art screen
    if (!queuePanel(f.panel)) { mode = "art"; selP = f.panel; render(); return; }
    snap(); await startJobs([f.panel]);
    if (canDraw() && !jobs[f.panel]) { setStatus(`Panel ${f.panel} could not be sent to be redrawn. Its request is on the Art screen; try Generate there.`, "error"); return; } // refused or unreachable: the fault stays open
    for (const x of all) await loadCheck("PUT", { id: x.id, verdict: "redrawn" }); renderCheck();
    setStatus(`Panel ${f.panel} is being redrawn with the note.`, "ok");
  }
  function wireCheck() {
    $("checkView").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ck]"); if (!b || !CK) return; const act = b.dataset.ck;
      if (act === "run") return startCheck();
      if (act === "settings") return openSettings();
      const el = b.closest("[data-fault]"), f = el && CK.check && CK.check.faults.find((x) => x.id === el.dataset.fault); if (!f) return;
      if (act === "redraw") return redrawFault(f);
      if (act === "open") { const i = spec.pages.findIndex((p) => { let hit = false; if (p.layout) eachPanel(p.layout.rows, (q) => { if (q.id === f.panel) hit = true; }); return hit; }); if (i >= 0) pageIdx = i; mode = "art"; selP = f.panel; return render(); }
      await loadCheck("PUT", { id: f.id, verdict: act === "undo" ? "" : act }); renderCheck();
    });
    const sync = () => { $("setAuto").checked = autoPref() === "on"; };
    function openSettings() { sync(); $("settingsDlg").showModal(); }
    wireCheck.openSettings = openSettings;
    $("settingsBtn").addEventListener("click", openSettings);
    $("settingsX").addEventListener("click", () => $("settingsDlg").close());
    $("setAuto").addEventListener("change", (e) => { setAuto(e.target.checked ? "on" : "off"); if (mode === "check") renderCheck(); });
    $("autoYes").addEventListener("click", () => { setAuto("on"); $("autoDlg").close(); startCheck(); });
    $("autoNo").addEventListener("click", () => { setAuto("off"); $("autoDlg").close(); setStatus("Not checked. You can run it from Check, and change this in Settings (the cog, top right).", ""); });
  }
  const openSettings = () => wireCheck.openSettings();
  function renderQueuedMarks() { for (const t of document.querySelectorAll("#page .art-queued-t")) t.textContent = jobWord(t.dataset.pid) + (jobWord(t.dataset.pid) === "Drawing" ? "…" : ""); }
  /** New pictures from the Artist: take the project's fresh art list and put each new picture in its panel. */
  // a picture for this project landed while this page was not watching (after a restart): fetch the art again
  addEventListener("ibasho-work-landed", (e) => { const h = e.detail || {}; if (spec && proj && String(h.key || "").startsWith(proj.id + "/") && !Object.values(jobs).some((j) => j.status === "waiting" || j.status === "drawing")) refreshArt().then(() => render()).catch(() => {}); });
  async function refreshArt() {
    const fresh = prepare(await (await fetch(SPEC_URL + "?t=" + Date.now())).json());
    original = JSON.parse(JSON.stringify(fresh));
    spec.library = fresh.library;
    const got = new Map(); for (const p of fresh.pages) if (p.layout) { eachPanel(p.layout.rows, (q) => { if (q.take) got.set(q.id, q); }); for (const q of p.layout.insets || []) if (q.take) got.set(q.id, q); }
    let n = 0;
    const put = (q) => { const o = got.get(q.id); if (o && o.take !== q.take) { q.image = o.image; q.take = o.take; delete q.focus; delete q.zoom; delete q.request; n++; return true; } return false; };
    const fresh2 = new Set();
    for (const p of spec.pages) if (p.layout) { const hit = (q) => { if (put(q)) fresh2.add(p.id); }; eachPanel(p.layout.rows, hit); for (const q of p.layout.insets || []) hit(q); }
    render();
    if (n) { snap(); setStatus(`${n} new picture${n === 1 ? "" : "s"} from the Artist ${n === 1 ? "is" : "are"} in place.`, "ok"); toneWhenFree([...fresh2]); }
  }
  const GRIP = '<span class="grip" title="Drag to reorder" aria-hidden="true"><svg viewBox="0 0 10 16"><circle cx="2" cy="2" r="1.6"/><circle cx="8" cy="2" r="1.6"/><circle cx="2" cy="8" r="1.6"/><circle cx="8" cy="8" r="1.6"/><circle cx="2" cy="14" r="1.6"/><circle cx="8" cy="14" r="1.6"/></svg></span>';
  /** A small picture of a page for the pages list; kept until the page's art or layout changes. */
  const thumbCache = new Map();
  function pageThumb(p) {
    const key = BASE + "|" + (p.layout ? JSON.stringify(p.layout) : p.art || "");
    const hit = thumbCache.get(p.id); if (hit && hit.key === key) return hit.html;
    const art = p.layout ? R.layoutSvg(p, (src) => BASE + src, sizes()) : p.art ? `<image href="${R.esc(BASE + R.pageArt(p))}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>` : "";
    // its own ids: the page's clip paths share names with the open page, and a hidden copy must never clip the real one
    const pre = "th" + String(p.id).replace(/[^\w-]/g, "") + "-";
    const own = art.replace(/\bid="([^"]+)"/g, `id="${pre}$1"`).replace(/url\(#([^)]+)\)/g, `url(#${pre}$1)`).replace(/href="#([^"]+)"/g, `href="#${pre}$1"`);
    const html = `<span class="pthumb"><svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect width="${W}" height="${H}" fill="#fff"/>${own}</svg></span>`;
    thumbCache.set(p.id, { key, html }); return html;
  }
  function renderSide() {
    const open = mode !== "chapter" && mode !== "series";
    $("side").innerHTML = `<h2>Pages</h2><ul>` + spec.pages.map((p, i) => {
      const here = open && i === pageIdx, qs = p.layout ? leaves(p.layout.rows).concat(p.layout.insets || []) : [];
      const drawn = qs.filter((q) => q.image).length, queued = qs.filter((q) => q.request).length;
      const st = !p.layout ? "art" : queued ? `${queued} queued` : drawn ? `${drawn}/${qs.length} art` : "board";
      let sub = "";
      const nl = p.layout ? leaves(p.layout.rows).length : 0;
      if (here && qs.length) sub = `<ul>` + qs.map((q, k) => { const [cls, word] = panelState(q);
        return `<li data-kind="panel" data-idx="${k}"><button type="button" class="pnrow" data-pid="${R.esc(q.id)}" aria-pressed="${selP === q.id}">${k < nl && nl > 1 ? GRIP : ""}<span class="n">${k + 1}</span><span class="d">${R.esc(panelLabel(q))}</span><span class="dot ${cls}">${word}</span></button></li>`; }).join("") + `</ul>`;
      return `<li data-kind="page" data-idx="${i}"><button type="button" class="pgrow" data-page="${i}" aria-current="${here}">${GRIP}${pageThumb(p)}<span class="pl"><span>${R.esc(p.label || "Page " + p.number)}</span><small>${st}</small></span></button>${sub}</li>`;
    }).join("") + `</ul><p class="side-tip">Drag the dots to reorder pages or panels. Keyboard: Alt + up or down arrow.</p>`;
  }
  /** Page numbers follow the order; the cover is not counted and carries no number. */
  function renumber() { let n = 0; for (const q of spec.pages) { if (q.cover) { q.number = 0; continue; } n++; if (!q.label || /^Page \d+$/.test(q.label)) q.label = "Page " + n; q.number = n; } }
  function movePage(from, to) {
    if (to === from || to < 0 || to >= spec.pages.length) return;
    const cur = page().id, [p] = spec.pages.splice(from, 1);
    spec.pages.splice(to, 0, p);
    if (spec.kind === "storyboard") renumber();
    pageIdx = spec.pages.findIndex((q) => q.id === cur);
    render(); snap();
    setStatus(`Moved to place ${to + 1}. Undo puts it back.`, "ok");
  }
  /** Reorder panels on the open page: the shapes stay where they are, the contents (storyboard, art, request, balloons) move. */
  const CONTENT = ["id", "board", "image", "focus", "zoom", "request", "take", "type"];
  function movePanel(from, to) {
    const p = page(); if (!p.layout) return;
    const n = leaves(p.layout.rows).length;
    if (to === from || to < 0 || to >= n || from >= n) return;
    mutateLayout(() => {
      const qs = leaves(p.layout.rows);
      const cont = qs.map((q) => { const o = {}; for (const k of CONTENT) if (q[k] != null) o[k] = q[k]; return o; });
      const [c] = cont.splice(from, 1); cont.splice(to, 0, c);
      qs.forEach((q, i) => { for (const k of CONTENT) delete q[k]; Object.assign(q, cont[i]); });
    });
    render(); snap();
    setStatus(`Panel moved to place ${to + 1}. Its art and balloons went with it. Undo puts it back.`, "ok");
  }
  let sideDrag = null, sideDragged = false;
  function wireSideDrag() {
    const side = $("side");
    const clear = () => { for (const li of side.querySelectorAll(".drop-before, .drop-after, .dragging")) li.classList.remove("drop-before", "drop-after", "dragging"); };
    side.addEventListener("pointerdown", (e) => {
      const g = e.target.closest(".grip"); if (!g) return;
      const li = g.closest("li");
      sideDrag = { li, list: li.parentElement, kind: li.dataset.kind, from: +li.dataset.idx, y: e.clientY, on: false, slot: null };
      g.setPointerCapture(e.pointerId); e.preventDefault();
    });
    side.addEventListener("pointermove", (e) => {
      const d = sideDrag; if (!d) return;
      if (!d.on && Math.abs(e.clientY - d.y) < 5) return;
      d.on = true; side.classList.add("sorting"); clear(); d.li.classList.add("dragging");
      const rows = [...d.list.children].filter((li) => d.kind === "page" || d.li.parentElement === li.parentElement);
      const max = d.kind === "panel" ? leaves(page().layout.rows).length : rows.length; // insets stay last
      let slot = max;
      for (let i = 0; i < max; i++) { const r = rows[i].firstElementChild.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { slot = i; break; } }
      d.slot = slot;
      if (slot < max) rows[slot].classList.add("drop-before"); else rows[max - 1].classList.add("drop-after");
      const sr = side.getBoundingClientRect();
      if (e.clientY < sr.top + 36) side.scrollTop -= 14; else if (e.clientY > sr.bottom - 36) side.scrollTop += 14;
    });
    const end = () => {
      const d = sideDrag; sideDrag = null; if (!d) return;
      side.classList.remove("sorting"); clear();
      if (!d.on || d.slot == null) return;
      sideDragged = true; setTimeout(() => { sideDragged = false; }, 0);
      const to = d.slot > d.from ? d.slot - 1 : d.slot;
      if (d.kind === "page") movePage(d.from, to); else movePanel(d.from, to);
    };
    side.addEventListener("pointerup", end); side.addEventListener("pointercancel", end);
    side.addEventListener("keydown", (e) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const li = e.target.closest("li[data-kind]"); if (!li) return;
      e.preventDefault();
      const from = +li.dataset.idx, to = from + (e.key === "ArrowUp" ? -1 : 1), kind = li.dataset.kind;
      if (kind === "page") movePage(from, to); else movePanel(from, to);
      const again = $("side").querySelector(kind === "page" ? `li[data-kind="page"][data-idx="${Math.max(0, Math.min(to, spec.pages.length - 1))}"] > button` : `li[data-kind="panel"][data-idx="${to}"] > button`);
      if (again) again.focus();
    });
  }

  // ---------- art: draw one panel (source, prompt written by the Artist or your own) ----------
  function aiPrompt(pid, opts) {
    const f = findPanel(pid);
    if (!bible || !window.Artist || !f) return null;
    if (!f.panel.board && !(opts && opts.own != null)) return null;
    try { return window.Artist.panelBrief(page(), pid, spec, bible, R, measureText, Object.assign({ noRefLine: true }, opts)); } catch (e) { return null; }
  }
  // ---------- references: pictures sent with a prompt (character bank, a face or a whole drawn panel, an upload) ----------
  let refTab = "panel", refPick = null;
  const uploads = {}; // id -> data URL (kept in the store, loaded when needed)
  const bankRef = (n) => ({ type: "bank", name: n, note: (bible.cast[n] && bible.cast[n].ref_role) || n });
  const thingOf = (r) => ((r.kind === "place" ? bible.places : r.kind === "prop" ? bible.props : bible.cast) || {})[r.name];
  const thingRef = (t) => ({ type: "bank", kind: t.kind, name: t.name, note: ((bible[t.kind === "place" ? "places" : "props"][t.name] || {}).ref_role) || t.name });
  // Characters saved to the bank from a drawn panel (kept with the project's saved edits): { name, src, box }
  const bankSaved = (name) => (spec.bank || []).find((b) => b.name === name);
  const savedRef = (b) => ({ type: "panel", src: b.src, who: b.name, box: b.box, saved: true, note: `${b.name} as already drawn in this chapter: take the face, hair and clothes only; the pose here is new` });
  /** A face box grown to take in the hair, shoulders and some clothes. */
  const cropAround = ([x0, y0, x1, y1]) => { const w = x1 - x0, h = y1 - y0; return [Math.max(0, x0 - w * 0.6), Math.max(0, y0 - h * 0.6), Math.min(1, x1 + w * 0.6), Math.min(1, y1 + h * 1.4)].map(round3); };
  /** What the Artist attaches by itself: the series sheets for the cast in the panel, then any saved character among them. */
  function autoRefs(pid) {
    const a = aiPrompt(pid), f = findPanel(pid); if (!a) return [];
    const saved = (a.cast || []).filter((n) => !(a.named || []).includes(n)).map(bankSaved).filter(Boolean); // also when redrawing the panel they were saved from
    return a.refs.map(bankRef).concat(saved.map(savedRef)).concat((a.things || []).filter((t) => t.sheet).map(thingRef)).concat(moodRefs()).slice(0, 6); // people first, then the place and props, then the series' mood pictures
  }
  /** The series' mood pictures (Series, "Mood pictures"): uploaded pictures that show the look to aim for. They ride along with every panel, last. */
  const MOOD_MAX = 4, MOOD_NOTE = "mood picture for this series: take the LOOK only (line, tone, light, feeling); never copy its people, places or composition";
  const moodRefs = () => ((bible && Array.isArray(bible.mood) ? bible.mood : []).filter((m) => m && /^u[a-z0-9]{6,24}$/.test(m.id || "")).slice(0, MOOD_MAX).map((m) => ({ type: "upload", id: m.id, name: m.name || "mood picture", note: MOOD_NOTE, mood: true })));
  function renderMood() {
    const box = $("seMoodBox"); if (!box) return; const show = !!bible && store.kind === "local" && proj.own !== false; box.hidden = !show; if (!show) return;
    const list = moodRefs(); $("seMoodAdd").hidden = list.length >= MOOD_MAX;
    $("seMoodList").innerHTML = list.map((r) => `<span class="mood-pic" style="display:inline-flex;flex-direction:column;align-items:center;gap:4px">${refThumb(r)}<button type="button" class="btn link" data-mood-del="${R.esc(r.id)}" aria-label="Remove ${R.esc(r.name)}">Remove</button></span>`).join("") || `<span class="hint">None yet.</span>`;
  }
  const refLine = (refs) => (refs && refs.length ? `\n\nINPUT REFERENCES, ordered: ${refs.map((r, i) => `Image ${i + 1}: ${(r.note || "reference").trim()}`).join("; ")}.` : "");
  const promptText = (req) => req.text || (req.prompt || "").split("\n\nINPUT REFERENCES, ordered:")[0];
  function refTitle(r) {
    if (r.type === "bank") return `${r.name} · ${r.kind === "place" ? "place" : r.kind === "prop" ? "prop" : "character bank"}`;
    if (r.type === "panel") return r.saved ? `${r.who} · character bank (saved)` : `${r.who || "Whole panel"} · ${(lib()[r.src] || {}).label || "a drawn panel"}`;
    return `Upload · ${r.name || "picture"}`;
  }
  function refThumb(r) {
    if (r.type === "bank") { const c = bible && thingOf(r); return c && c.thumb ? `<img class="rthumb" src="${R.esc(BASE + c.thumb)}" alt="">` : `<span class="rthumb"></span>`; }
    if (r.type === "panel") {
      if (!r.box) return `<img class="rthumb" src="${R.esc(BASE + r.src)}" alt="">`;
      const [x0, y0, x1, y1] = r.box, w = x1 - x0, h = y1 - y0;
      return `<span class="rthumb" style="background-image:url('${R.esc(BASE + r.src)}');background-size:${100 / w}% ${100 / h}%;background-position:${w < 1 ? (x0 / (1 - w)) * 100 : 0}% ${h < 1 ? (y0 / (1 - h)) * 100 : 0}%"></span>`;
    }
    if (!uploads[r.id]) { loadUpload(r.id); return `<span class="rthumb"></span>`; }
    return `<img class="rthumb" src="${uploads[r.id]}" alt="">`;
  }
  async function loadUpload(id) {
    if (uploads[id] !== undefined) return;
    uploads[id] = "";
    try {
      if (store.kind === "db") { const s = await store.db.doc("refs/" + id).get(); if (s.exists) uploads[id] = (s.data() || {}).dataUrl || ""; }
      else if (store.kind === "local") { const r = await fetch("/api/ref?id=" + id); if (r.ok) uploads[id] = (await r.json()).dataUrl || ""; }
    } catch (e) { /* thumbnail only */ }
    if (uploads[id]) { renderArtPanel(); if (mode === "series") renderMood(); }
  }
  async function addUpload(file) {
    const img = new Image(), url = URL.createObjectURL(file);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    let dataUrl = "";
    for (const [max, q] of [[1024, 0.82], [896, 0.78], [768, 0.74], [640, 0.7], [512, 0.65]]) { // a stored document holds 256 KiB at most
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      dataUrl = c.toDataURL("image/jpeg", q);
      if (dataUrl.length < 230000) break;
    }
    URL.revokeObjectURL(url);
    const id = "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), body = { dataUrl, name: file.name, at: new Date().toISOString() };
    if (store.kind === "db") await store.db.doc("refs/" + id).set(body);
    else if (store.kind === "local") { const r = await fetch("/api/ref?id=" + id, { method: "PUT", body: JSON.stringify(body) }); if (!r.ok) throw new Error("HTTP " + r.status); }
    else throw new Error("nowhere to keep it");
    uploads[id] = dataUrl;
    return { type: "upload", id, name: file.name, note: "reference picture from the author" };
  }
  // ---------- tags: the project's asset bible (Series: characters, places, props). Tag one and its approved sheet and description go with the prompt.
  // A tagged picture lives in d.refs (a bank or saved-character reference); someone tagged with no picture yet is in d.tagsOnly (description only).
  const tagKey = (kind, name) => (kind || "person") + "|" + name;
  function bibleAssets() {
    if (!bible) return [];
    const out = Object.keys(bible.cast || {}).map((n) => ({ kind: "person", name: n, desc: bible.cast[n].desc || "", pic: !!(bible.cast[n].ref || bible.cast[n].sheet) || !!bankSaved(n), thumb: bible.cast[n].thumb || "" }));
    for (const [kind, field] of [["place", "places"], ["prop", "props"]]) for (const n of Object.keys(bible[field] || {})) { const t = bible[field][n]; out.push({ kind, name: n, desc: t.desc || "", pic: !!(t.ref || t.sheet), thumb: t.thumb || "" }); }
    return out;
  }
  const refTagKey = (r) => (r.type === "bank" ? tagKey(r.kind, r.name) : r.type === "panel" && r.saved ? tagKey("person", r.who) : null);
  function tagged(d) { const k = new Set(d.refs.map(refTagKey).filter(Boolean)); for (const t of d.tagsOnly || []) k.add(tagKey(t.kind, t.name)); return k; }
  function toggleTag(kind, name) {
    if (!selP) return; const d = draftFor(selP), key = tagKey(kind, name); d.tagsOnly = d.tagsOnly || [];
    const wordsOnly = (d.tagsOnly || []).some((t) => tagKey(t.kind, t.name) === key) && bibleAssets().some((t) => tagKey(t.kind, t.name) === key && t.pic);
    if (wordsOnly) d.tagsOnly = d.tagsOnly.filter((t) => tagKey(t.kind, t.name) !== key); // a "words only" tag tapped = send the sheet too
    if (!wordsOnly && tagged(d).has(key)) { d.refs = d.refs.filter((r) => refTagKey(r) !== key); d.tagsOnly = d.tagsOnly.filter((t) => tagKey(t.kind, t.name) !== key); }
    else {
      const sheet = kind === "person" ? bible.cast[name] && (bible.cast[name].ref || bible.cast[name].sheet) : (bible[kind === "place" ? "places" : "props"][name] || {}).sheet || (bible[kind === "place" ? "places" : "props"][name] || {}).ref;
      const r = kind === "person" ? (sheet ? bankRef(name) : bankSaved(name) ? savedRef(bankSaved(name)) : null) : sheet ? thingRef({ kind, name }) : null;
      if (r) { const firstOneOff = d.refs.findIndex((x) => !refTagKey(x)); d.refs.splice(firstOneOff < 0 ? d.refs.length : firstOneOff, 0, r); } // tags first, one-off pictures after
      else d.tagsOnly.push({ kind, name });
    }
    d.refsTouched = true; renderArtPanel();
  }
  function renderTags(d) {
    const all = bibleAssets(), on = tagged(d), wrap = $("tagsField"); wrap.hidden = !bible;
    if (!bible) return;
    const label = { person: "", place: " · place", prop: " · prop" };
    $("tagChips").innerHTML = all.length ? all.map((t) => `<button type="button" class="btn tagchip" data-tag="${R.esc(tagKey(t.kind, t.name))}" aria-pressed="${on.has(tagKey(t.kind, t.name))}" title="${R.esc(t.desc || t.name)}">${t.thumb ? `<img src="${R.esc(BASE + t.thumb)}" alt="">` : ""}${R.esc(t.name)}<small>${label[t.kind]}${!t.pic ? " · no picture" : on.has(tagKey(t.kind, t.name)) && !d.refs.some((r) => refTagKey(r) === tagKey(t.kind, t.name)) ? " · words only" : ""}</small></button>`).join("")
      : "";
    const words = refLimit() === 0;
    $("tagHint").textContent = !all.length ? "This project's asset bible is empty. Add characters, places and props (with a sheet each) under Series, then tag them here."
      : words ? "This model takes words only: tagged assets go as their descriptions, without pictures."
      : "Tap to tag. A tagged asset's approved sheet and description are sent with the prompt. Add or change assets under Series.";
  }
  /** The words added for tagged assets the prompt does not already describe. */
  function tagWords(d, a) {
    const said = new Set([...((a && a.cast) || []), ...(((a && a.things) || []).map((t) => t.name))]), on = tagged(d), out = [];
    for (const t of bibleAssets()) if (on.has(tagKey(t.kind, t.name)) && t.desc && !(d.mode === "artist" && said.has(t.name))) out.push(`${t.name}${t.kind === "person" ? "" : " (" + t.kind + ")"}: ${t.desc}`);
    return out.length ? `\n\nTAGGED, draw them exactly as described: ${out.join(" ")}` : "";
  }
  function addRef(r) {
    if (!selP) return;
    const d = draftFor(selP);
    if (d.refs.length >= refLimit()) { setStatus(refLimit() ? `${refLimit()} pictures is the most this model takes.` : "This model takes words only.", "warn"); return; }
    d.refs.push(r); d.refsTouched = true; refPick = null; $("refAdd").open = false; renderArtPanel();
  }
  function renderRefs(refs, locked) {
    $("refList").innerHTML = refs.map((r, i) => `<li>${refThumb(r)}<span><b>${i + 1}. ${R.esc(refTitle(r))}</b>` +
      `<input type="text" data-rnote="${i}" value="${R.esc(r.note || "")}" aria-label="What this reference is for" placeholder="What to take from it"${locked ? " readonly" : ""}></span>` +
      (locked ? "<span></span>" : `<button type="button" class="x" data-rdel="${i}" aria-label="Remove reference ${i + 1}">✕</button>`) + `</li>`).join("");
    $("genRefs").textContent = refs.length ? "" : "No pictures are sent with this prompt.";
    $("genRefs").hidden = !!refs.length;
    $("refAdd").hidden = locked;
    if (locked || !$("refAdd").open) return;
    for (const b of document.querySelectorAll("[data-rt]")) b.setAttribute("aria-pressed", b.dataset.rt === refTab);
    const pane = $("refPane");
    if (refTab === "bank") {
      const names = bible ? Object.keys(bible.cast).filter((n) => bible.cast[n].ref || bible.cast[n].sheet) : [];
      const saved = spec.bank || [];
      pane.innerHTML = names.length || saved.length ? `<div class="refgrid">` + names.map((n) => `<button type="button" data-rbank="${R.esc(n)}"><img src="${R.esc(BASE + (bible.cast[n].thumb || ""))}" alt=""><span>${R.esc(n)}</span></button>`).join("") +
        saved.map((b, i) => `<button type="button" data-rsaved="${i}">${refThumb(savedRef(b))}<span>${R.esc(b.name)} (saved)</span></button>`).join("") + `</div>` +
        `<p class="hint">Approved character sheets, and characters you saved from drawn panels.</p>` : `<p class="hint">This project has no character sheets yet. Save one from a drawn panel.</p>`;
    } else if (refTab === "panel") {
      const arts = spec.library || [], pick = refPick && lib()[refPick];
      let s = arts.length ? `<div class="refgrid">` + arts.map((it) => `<button type="button" data-rsrc="${R.esc(it.src)}" aria-pressed="${refPick === it.src}" title="${R.esc(it.label)}"><img src="${R.esc(BASE + it.src)}" alt="${R.esc(it.label)}" loading="lazy"></button>`).join("") + `</div>` : `<p class="hint">No panels are drawn yet.</p>`;
      if (pick) s += `<p class="hint">${R.esc(pick.label)}: what should the Artist take from it?</p><div class="chips">` +
        (pick.protect || []).map((f, i) => `<button type="button" class="btn" data-rface="${i}">${R.esc(f.who)}</button>`).join("") + `<button type="button" class="btn" data-rface="-1">The whole panel</button></div>`;
      else if (arts.length) s += `<p class="hint">Tap a drawn panel, then pick a character in it or the whole panel.</p>`;
      pane.innerHTML = s;
    } else {
      pane.innerHTML = `<input type="file" id="refFile" accept="image/*"><p class="hint">A photo, a sketch or a reference sheet. It is shrunk to fit and kept with this project.</p>`;
    }
  }
  function draftFor(pid) {
    if (!drafts[pid]) {
      const a = aiPrompt(pid);
      drafts[pid] = { source: "codex", mode: a ? "artist" : "custom", artist: a ? a.prompt : "", custom: "", keepStyle: !!bible, refs: [] };
    }
    if (!drafts[pid].refsTouched) { // follows the storyboard and the asset bible until you change the tags yourself
      drafts[pid].refs = autoRefs(pid); const a = aiPrompt(pid), have = new Set(drafts[pid].refs.map(refTagKey).filter(Boolean));
      drafts[pid].tagsOnly = a ? (a.cast || []).filter((n) => bible.cast[n] && !have.has(tagKey("person", n))).map((n) => ({ kind: "person", name: n }))
        .concat((a.things || []).filter((t) => !have.has(tagKey(t.kind, t.name))).map((t) => ({ kind: t.kind, name: t.name }))) : [];
    }
    return drafts[pid];
  }
  function renderArtPanel() {
    const ap = $("artPanel");
    ap.hidden = mode !== "art";
    if (mode !== "art") return;
    const p = page(), f = p.layout ? findPanel(selP) : null;
    $("artHint").hidden = !!f; $("artTools").hidden = !f; $("pageGen").hidden = true;
    { const c = f && cellOf(selP), st = c ? R.toneState(c) : "", t = c && c.panel.toned, show = !!c && store.kind === "local" && !(bible && bible.colour) && proj.own !== false, busy = toneBusy();
      $("toneBox").hidden = !show;
      if (show) { const j = jobs["tone:" + p.id];
        $("toneInfo").textContent = busy ? "The Toner is at work on this page…" : j && j.status === "failed" ? "The Toner stopped: " + (j.msg || "no reason given") : !c.panel.image ? "This panel has no picture yet. Draw it first."
          : st === "toned" ? `Toned: ${t.layers.length ? t.layers.map((n) => n.replace(/^panel \d+, /, "")).join("; ") : "no grey area was found, so no dots were laid"}${t.strokes ? ` · ${t.strokes} stroke${t.strokes === 1 ? "" : "s"} by hand` : ""}.${t.baked ? " Its picture already has dots drawn in: they can clash with the Toner's. Draw it again with flat greys." : ""}`
          : st === "stale" ? "This panel has changed since it was toned (its picture, its place or its crop), so its plain picture is showing. Tone it again."
          : tonerOn() ? "Not toned yet. The Toner turns this picture's flat greys into screentone." : "The Toner can lay screentone over flat greys. For new pictures to be drawn with flat greys, turn on “Screentone made by the Toner” in Series.";
        renderToneSet(t); $("tonePage").disabled = busy || !canDraw(); $("toneOne").hidden = !st; $("toneOne").disabled = busy || !canDraw(); $("toneHand").hidden = st !== "toned" || !t.layers.length; } }
    { const show = !p.layout && !!p.art && store.kind === "local" && !(bible && bible.colour) && proj.own !== false, st = show ? R.pageTone(p) : "", j = jobs["tone:" + p.id], busy = show && toneBusy(); // a page that is one whole picture is toned as one
      $("toneWhole").hidden = !show;
      if (show) { $("toneWholeBtn").disabled = busy || !canDraw(); $("toneWholeBtn").textContent = st ? "Tone this page again" : "Tone this page";
        $("toneWholeInfo").textContent = busy ? "The Toner is at work on this page…" : j && j.status === "failed" ? "The Toner stopped: " + (j.msg || "no reason given")
          : st === "toned" ? `Toned: ${p.toned.layers.length ? p.toned.layers.map((n) => n.replace(/^the page, /, "")).join("; ") : "no grey area was found, so no dots were laid"}.${p.toned.baked ? " The picture already has dots drawn in: they can clash with the Toner's." : ""}`
          : st === "stale" ? "This page's picture has changed since it was toned, so the plain picture is showing. Tone it again."
          : "Not toned yet. The Toner turns this picture's flat greys into screentone, over the whole page as one picture."; } }
    if (!p.layout) { $("artHint").textContent = "This page was drawn as one picture. Panels can be drawn one at a time on storyboard pages."; return; }
    $("artHint").textContent = "Tap a panel, on the page or in the sidebar, to draw it.";
    if (!f) {
      const g = pageGenSets(); $("pageGen").hidden = !g.all.length && !g.queued;
      $("pgTitle").textContent = `${p.label || "Page " + p.number} · whole page`;
      $("pgInfo").textContent = `This page has ${g.total} panel${g.total === 1 ? "" : "s"}, so the whole page is ${g.total} picture${g.total === 1 ? "" : "s"}, one per panel` +
        `${g.drawn ? `; ${g.drawn} already ${g.drawn === 1 ? "has" : "have"} art` : ""}${g.queued ? `; ${g.queued} queued` : ""}${g.skip ? `; ${g.skip} with no storyboard or prompt cannot be queued from here` : ""}. Generated with ${picModel ? picModel.name : "Codex"}${picModel && picModel.price ? ", " + picModel.price : ""}.`;
      $("pgMissing").hidden = !g.missing.length || g.missing.length === g.all.length;
      $("pgMissing").textContent = `Generate the ${g.missing.length} without art${picCost(g.missing.length)}`;
      $("pgAll").hidden = !g.all.length; $("pgAll").className = "btn" + ($("pgMissing").hidden ? " primary" : "");
      $("pgAll").textContent = (g.drawn && g.all.length ? `Generate all ${g.all.length} again` : `Generate all ${g.all.length} pictures`) + picCost(g.all.length);
      return;
    }
    const q = f.panel, all = leaves(p.layout.rows).concat(p.layout.insets || []), n = all.findIndex((x) => x.id === q.id) + 1;
    const req = q.request, d = draftFor(q.id), a = aiPrompt(q.id), b = q.board;
    $("artTitle").textContent = `${p.label || "Page " + p.number} · panel ${n}`;
    $("artBoard").textContent = b ? `Storyboard: ${capWord(b.shot || "panel")}. ${b.action || ""}` : "No storyboard for this panel: write your own prompt.";
    { const ia = q.inart || {}, box = $("artInart"); box.hidden = !b || !!req; if (box.dataset.panel !== q.id) { box.dataset.panel = q.id; box.open = !!(ia.sfx || ia.writing); }
      if (document.activeElement !== $("artSfx")) $("artSfx").value = ia.sfx || ""; if (document.activeElement !== $("artWriting")) $("artWriting").value = ia.writing || ""; }
    { // a chapter of a book: the paragraphs this panel draws, and the paragraph behind each line
      const ids = spec.source ? [...new Set(((b && b.src) || []).concat(((b && b.lines) || []).map((l) => l.src).filter(Boolean)))].filter((id) => spec.source[id]).sort() : [];
      const box = $("artFrom"), was = box.dataset.panel === q.id; box.hidden = !ids.length; box.dataset.panel = q.id; if (!was) box.open = false;
      if (ids.length) { const sh = (id) => id.split(":").pop(); box.querySelector("summary").textContent = `From the book: ${ids.length === 1 ? sh(ids[0]) : `${sh(ids[0])} to ${sh(ids[ids.length - 1])}`}`;
        $("artFromText").innerHTML = ids.map((id) => `<p><span class="pid">${R.esc(sh(id))}</span>${R.esc(spec.source[id])}</p>`).join(""); }
    }
    const now = $("artNow"); now.hidden = !q.image; if (q.image && now.getAttribute("src") !== BASE + q.image) now.src = BASE + q.image;
    { // what the Artist's own check found in this picture; the person can wave it through
      const e = q.image ? lib()[q.image] : null, box = $("artReview"), found = e && Array.isArray(e.review) ? e.review : null, okd = q.reviewOk === q.image;
      box.hidden = !found; box.className = "art-review" + (found && (!found.length || okd) ? " ok" : "");
      if (found) box.innerHTML = !found.length ? "Checked after drawing: nothing wrong was found." : okd ? `Checked after drawing: ${found.length} thing${found.length === 1 ? "" : "s"} noted, and you passed it.`
        : `<b>Check this picture</b><ul>${found.map((m) => `<li>${R.esc(m)}</li>`).join("")}</ul><button type="button" class="btn" id="artReviewOk">It is fine as it is</button>`;
    }
    const people = q.image ? peopleIn(q) : [];
    $("artFacesWrap").hidden = !q.image || (!people.length && !canDraw());
    $("artFaces").innerHTML = people.map((x) => { const n = R.esc(x.who), bk = bankSaved(x.who), here = bk && bk.src === q.image, sheet = bible && bible.cast[x.who] && (bible.cast[x.who].ref || bible.cast[x.who].sheet);
      const state = x.face ? (x.face.by === "hand" ? "Face set by you." : "Face labelled.") : x.voice ? `${n} speaks here from out of frame, so the balloon has no tail. If the picture shows ${n}, set the face.` : x.absent ? `Codex could not find ${n} in this picture. The box is where the storyboard put them: a guess.` : `No face was labelled for ${n}. The box is where the storyboard put them: a guess.`;
      return `<div class="person${x.face || x.voice ? "" : " guess"}"><span><b>${n}</b> <small>${state}</small></span><div class="row">` +
        (canDraw() ? `<button type="button" class="btn${x.face || x.voice ? "" : " primary"}" data-mark="${n}"${marking && marking.who === x.who ? ' aria-pressed="true"' : ""}>${x.face ? "Move the face box" : `Set ${n}'s face`}</button>` : "") +
        (x.face ? `<button type="button" class="btn" data-bsave="${n}">${here ? "✓ Saved to the bank from here · remove" : bk ? `Replace saved ${n} with this one` : `Save to the character bank${sheet ? " (has a sheet)" : ""}`}</button>` : "") +
        (x.face && !x.board && canDraw() ? `<button type="button" class="btn" data-unmark="${n}">Remove the label</button>` : "") + `</div></div>`; }).join("");
    { const lk = jobs["look:" + q.id], busy = lk && (lk.status === "waiting" || lk.status === "drawing"), need = canDraw() && people.some((x) => !x.face);
      $("lookBtn").hidden = !need && !busy; $("lookBtn").disabled = !!busy;
      $("lookBtn").textContent = busy ? "Looking at the picture… (about a minute)" : "Look again for the missing faces";
      $("lookNote").hidden = !(lk && !busy && lk.msg); $("lookNote").textContent = lk && lk.msg ? (lk.status === "failed" ? "The look did not finish: " : "") + lk.msg : ""; }
    $("markNote").hidden = !marking;
    if (marking) $("markNote").innerHTML = `Now tap <b>${R.esc(marking.who)}</b>’s face in this panel on the page. <button type="button" class="btn link" id="markCancel">Cancel</button>`;
    const others = canDraw() && bible && q.image ? Object.keys(bible.cast).filter((n) => !people.some((x) => x.who === n)) : [];
    $("markOtherWrap").hidden = !others.length;
    $("markOther").innerHTML = `<option value="">Label someone else in this picture…</option>` + others.map((n) => `<option>${R.esc(n)}</option>`).join("");
    // The form always shows your draft, so after Generate it stays as it was: change the model, the prompt or the references and queue again.
    // Only a picture that is being drawn right now cannot be swapped (it is already paid for and on its way).
    const job = jobs[q.id], drawing = !!(req && job && job.status === "drawing"), live = canDraw(), artist0 = d.mode === "artist";
    $("artQueued").hidden = !req;
    if (req) $("artQueued").textContent = jobNote(q.id) + (req.modelName ? ` · ${req.modelName}` : "");
    $("genRetry").hidden = !(req && job && job.status === "failed");
    const cur = d;
    if (live && window.Ibasho && window.Ibasho.modelLabel) {
      $("genModel").innerHTML = picModel ? window.Ibasho.modelLabel(picModel) : `Codex image tool<small>Included in your plan</small>`;
      $("genSrcHint").textContent = picModel && picModel.service !== "codex" ? (picModel.refs ? `Sends the prompt and up to ${picModel.refs} reference picture${picModel.refs === 1 ? "" : "s"}. Faces are labelled afterwards by Codex.` : "This model takes words only, so it cannot be sent reference pictures. Pick another model to use references.") : SOURCES[0].hint;
    } else { $("genModel").innerHTML = `Codex image tool<small>Included in your plan</small>`; $("genSrcHint").textContent = SOURCES[0].hint; }
    $("genModel").disabled = !live;
    { // quality: sent on purpose (left on "auto", a model may pick "high" and charge four times as much); each level priced for this panel
      const qs = live && picModel && picModel.service === "openrouter" ? (picModel.qualities || []).filter((x) => ["low", "medium", "high"].includes(x)) : [], el = $("genQuality");
      el.hidden = !qs.length;
      if (qs.length) { const o = { size: (a && a.size) || [1024, 1536], refs: d.refs.length, chars: ((artist0 ? d.artist : d.custom) || "").length + 400 };
        el.innerHTML = qs.map((x) => { const e = picEst(o, x); return `<button type="button" class="seg" data-q="${x}" aria-pressed="${picModel.quality === x}">${window.Ibasho.QUALITY[x]}<small>${e && e.usd != null ? (e.rough ? "about " : "") + window.IbashoPrice.money(e.usd) : ""}</small></button>`; }).join(""); }
      const last = job && job.status === "done" && job.cost != null ? ` The last picture cost $${(+job.cost).toFixed(3)}.` : "";
      if (last) $("genSrcHint").textContent += last;
    }
    for (const s of document.querySelectorAll("[data-gm]")) { s.setAttribute("aria-pressed", s.dataset.gm === cur.mode); s.disabled = s.dataset.gm === "artist" && !a; }
    const artist = cur.mode === "artist", edited = artist && a && d.artist !== a.prompt;
    $("genLabel").textContent = artist ? "Written by the Artist from the storyboard" : "Your prompt";
    $("genTag").textContent = artist ? (edited ? "AI · edited by you" : "AI-written") : "yours";
    const ta = $("genPrompt"); ta.readOnly = false;
    ta.placeholder = artist ? "" : "Describe the picture for this panel: who, where, what they are doing, the camera.";
    setVal("genPrompt", artist ? d.artist : d.custom);
    $("genReset").hidden = !edited;
    $("genKeepWrap").hidden = artist || !bible; $("genKeep").checked = !!cur.keepStyle; $("genKeep").disabled = false;
    const maxRefs = refLimit();
    $("refsField").hidden = maxRefs === 0;
    renderTags(d);
    renderRefs(d.refs, false);
    if (maxRefs && d.refs.length > maxRefs) { $("genRefs").hidden = false; $("genRefs").textContent = `This model takes ${maxRefs} reference picture${maxRefs === 1 ? "" : "s"}: only the first ${maxRefs} are sent.`; }
    $("genBtn").hidden = false; $("genCancel").hidden = !req || drawing;
    $("genBtn").textContent = drawing ? "Drawing… you can generate again when it lands" : req ? "Replace the queued picture" : q.image ? "Generate again" : "Generate";
    $("genBtn").disabled = drawing || !(artist ? d.artist.trim() : d.custom.trim());
  }
  /** How many reference pictures the picked model takes: 0 = words only. Codex takes the usual 6. */
  function refLimit() { return picModel && picModel.service === "openrouter" ? Math.min(6, +picModel.refs || 0) : 6; }
  /** Everyone who should have a face on a drawn panel: the storyboard's cast for it, plus anyone labelled on the picture. */
  function peopleIn(q) {
    const art = lib()[q.image] || {}, out = [], seen = new Set();
    for (const f of art.protect || []) if (f.who && !seen.has(f.who)) { seen.add(f.who); out.push({ who: f.who, face: f, board: ((q.board && q.board.who) || []).some((w) => w.name === f.who) }); }
    for (const w of (q.board && q.board.who) || []) if (!seen.has(w.name)) { seen.add(w.name); out.push({ who: w.name, face: null, board: true, absent: (art.absent || []).includes(w.name) }); }
    for (const l of (q.board && q.board.lines) || []) if (l.speaker && !seen.has(l.speaker)) { seen.add(l.speaker); out.push({ who: l.speaker, face: null, board: false, voice: true }); } // speaks here, kept out of frame by the storyboard
    return out;
  }
  /** Set (box) or remove (null) one character's face label on a drawn picture; saved with the project, so every device sees it. */
  let marking = null;
  async function setFace(q, who, box) {
    const art = lib()[q.image]; if (!art) return;
    const protect = (art.protect || []).filter((f) => f.who !== who);
    if (box) protect.push({ who, box: box.map(round3), by: "hand" });
    try {
      const r = await fetch(`/api/faces?p=${encodeURIComponent(proj.id)}&src=${encodeURIComponent(q.image)}`, { method: "PUT", body: JSON.stringify({ protect }) });
      if (!r.ok) throw new Error("not saved");
    } catch (e) { setStatus("The face could not be saved. Check the connection and try again.", "error"); return; }
    const bk = bankSaved(who); // a bank picture cut from this face follows the box
    if (bk && bk.src === q.image) { if (box) bk.box = cropAround(box.map(round3)); else spec.bank = spec.bank.filter((x) => x !== bk); snap(); }
    await refreshArt();
    setStatus(box ? `${who}'s face is set. Balloon tails aim there the next time the Letterer places this page.` : `${who}'s label was removed.`, "ok");
  }
  /** A tap on the page while marking: the box is centred on the tap, sized like the old label or the storyboard's head. */
  function markAt(x, y) {
    const p = page(), c = geomById(p).get(marking.pid), q = c && c.panel, art = q && q.image && lib()[q.image]; if (!art) { marking = null; return; }
    const M = R.artMap(c, art.size), [fx, fy] = M.toArt(x * W, y * H), old = (art.protect || []).find((f) => f.who === marking.who);
    let hw, hh;
    if (old) { hw = (old.box[2] - old.box[0]) / 2; hh = (old.box[3] - old.box[1]) / 2; }
    else {
      const hd = R.boardHeads(c).find((h) => h.who === marking.who), r = hd ? hd.r : 0.09 * Math.min(c.bbox[2] - c.bbox[0], c.bbox[3] - c.bbox[1]);
      const a = M.toArt(x * W - r, y * H - r * 1.15), b = M.toArt(x * W + r, y * H + r * 1.15); hw = (b[0] - a[0]) / 2; hh = (b[1] - a[1]) / 2;
    }
    const who = marking.who; marking = null;
    setFace(q, who, [Math.max(0, fx - hw), Math.max(0, fy - hh), Math.min(1, fx + hw), Math.min(1, fy + hh)]);
  }
  /** Panels on the open page that a whole-page generate can queue (not already queued, with a prompt to send). */
  function pageGenSets() {
    const p = page(), qs = p.layout ? leaves(p.layout.rows).concat(p.layout.insets || []) : [];
    const ok = (q) => { const d = draftFor(q.id); return !!(d.mode === "artist" ? d.artist.trim() : d.custom.trim()); };
    const free = qs.filter((q) => !q.request), all = free.filter(ok);
    return { total: qs.length, drawn: qs.filter((q) => q.image).length, queued: qs.length - free.length, skip: free.length - all.length, all, missing: all.filter((q) => !q.image) };
  }
  /** In a series that only draws approved characters: who in this panel has no approved sheet. */
  function needSheet(q) {
    if (!bible || !bible.strict) return [];
    return ((q.board && q.board.who) || []).map((w) => w.name).filter((n, i, a) => a.indexOf(n) === i).filter((n) => { const c = bible.cast[n]; return !(hasSheet(c) && c.approved !== false); });
  }
  const missingCount = () => spec.pages.reduce((n, p) => n + (p.layout ? leaves(p.layout.rows).concat(p.layout.insets || []).filter((q) => !q.image && !q.request).length : 0), 0) + missingBos().length; // a quick count: no prompts are written for it
  /** Every panel of the chapter with no picture and no request waiting, page by page. */
  function chapterMissing() {
    const keep = pageIdx, out = []; let total = 0;
    for (let i = 0; i < spec.pages.length; i++) { if (!spec.pages[i].layout) continue; pageIdx = i; const list = pageGenSets().missing; if (list.length) { out.push({ i, list }); total += list.length; } }
    pageIdx = keep; return { pages: out, total };
  }
  function drawChapter() {
    const m = chapterMissing(), keep = pageIdx, ids = [], held = new Set(), bos = missingBos();
    const boNote = bos.length ? ` ${bos.length} break-out${bos.length === 1 ? " is" : "s are"} drawn too (Codex, about three minutes each).` : "";
    const sendBos = async () => { for (const b of bos) await drawBo(b, true); };
    for (const { i, list } of m.pages) { pageIdx = i; for (const q of list) { const lack = needSheet(q); if (lack.length) { lack.forEach((n) => held.add(n)); continue; } if (queuePanel(q.id)) ids.push(q.id); } }
    pageIdx = keep;
    if (!ids.length && bos.length) { sendBos(); setStatus(`Drawing ${bos.length} break-out${bos.length === 1 ? "" : "s"}: about three minutes each. ${bos.length === 1 ? "It lands" : "They land"} on the page by ${bos.length === 1 ? "itself" : "themselves"}.` + (held.size ? ` Panels wait for approved sheets: ${[...held].join(", ")}.` : ""), held.size ? "warn" : "ok"); return; }
    if (!ids.length) { setStatus(held.size ? `Nothing drawn: ${[...held].join(", ")} ${held.size === 1 ? "has" : "have"} no approved character sheet. Add or approve under Series.` : "There is nothing left to draw.", held.size ? "error" : "ok"); return; }
    render(); snap();
    setStatus(`Drawing ${ids.length} picture${ids.length === 1 ? "" : "s"}, two at a time: about ${Math.max(1, Math.round(ids.length * 1.5))} minutes. You can close this page; it carries on.` + boNote + (held.size ? ` ${m.total - ids.length} wait for approved sheets: ${[...held].join(", ")}.` : ""), held.size ? "warn" : "ok");
    startJobs(ids); sendBos();
  }
  // ---------- the Assistant on the manga screen (studio.js): what is open, and the actions it may propose ----------
  function pageOfPanel(id) { return spec.pages.findIndex((p) => p.layout && leaves(p.layout.rows).concat(p.layout.insets || []).some((q) => q.id === id)); }
  function openPanel(id) { const i = pageOfPanel(id); if (i < 0) throw new Error("There is no panel " + id + " in this chapter."); pageIdx = i; selP = id; sel = -1; mode = "art"; render(); }
  /** What the Assistant is shown. Every panel's storyboard in full when it fits; cut shorter only on a very long chapter (the whole
   *  thing must stay under the server's limit, or its end would be lost). */
  function assistantWhere() {
    if (!spec) return { screen: "manga", note: "No chapter is open." };
    const build = (cut) => ({ screen: "manga", project: proj.id, chapter: proj.label || spec.project || proj.id, reads: spec.reading === "rtl" ? "right to left" : "left to right",
      open: { page: page() && (page().cover ? "cover" : page().number), page_id: page() && page().id, panel: selP, mode },
      picture_model: picModel ? `${picModel.name}${picModel.quality ? " (" + picModel.quality + ")" : ""}` : "Codex",
      characters: bible ? Object.keys(bible.cast || {}) : [], places: bible ? Object.keys(bible.places || {}) : [], props: bible ? Object.keys(bible.props || {}) : [],
      note: "Panels are listed in reading order. A page is named by its number (or \"cover\").",
      pages: spec.pages.map((p) => ({ page: p.cover ? "cover" : p.number, label: p.label || "", balloons: (p.text || []).length, panels: p.layout ? R.allPanels(p.layout).map((c) => c.panel).map((q) => { const bd = q.board || {};
        return { id: q.id, drawn: !!q.image, queued: !!q.request, shot: bd.shot || undefined, job: bd.job || undefined, weight: bd.weight || undefined,
          action: String(bd.action || "").slice(0, cut), who: (bd.who || []).map((w) => w.name), lines: (bd.lines || []).map((l) => `${l.speaker || "caption"}: ${String(l.text || "").slice(0, cut)}`).slice(0, 12) }; }) : [] })) });
    for (const cut of [1200, 600, 300, 160]) { const w = build(cut); if (JSON.stringify(w).length < 56000 || cut === 160) return w; }
  }
  // ----- page-level steps for the Assistant: each changes only the pages named, at once, and Undo takes it back -----
  function asPage(ref) {
    const s = String(ref == null ? "" : ref).trim().replace(/^page\s*/i, "");
    let i = spec.pages.findIndex((p) => p.id === s); if (i < 0) i = /^cover$/i.test(s) ? spec.pages.findIndex((p) => p.cover) : spec.pages.findIndex((p) => !p.cover && String(p.number) === s);
    if (i < 0) throw new Error(`There is no page "${ref}" in this chapter.`);
    return i;
  }
  const asName = (p) => (p.cover ? "the cover" : "page " + p.number);
  const mainPanels = (p) => R.allPanels(p.layout).map((c) => c.panel).filter((q) => !(p.layout.insets || []).includes(q)); // in reading order
  const asIds = (v) => (Array.isArray(v) ? v : String(v == null ? "" : v).split(/[\s,;|]+/)).map((x) => String(x).trim()).filter(Boolean);
  function asPanelPage(id) { const i = pageOfPanel(String(id || "").trim()); if (i < 0) throw new Error(`There is no panel "${id}" in this chapter.`); return i; }
  function asBoardOnly() { if (!spec || spec.kind !== "storyboard") throw new Error("This works on a storyboarded chapter."); }
  /** Put these panels (reading order) on page i: the director picks the layout by their weights, and a lettered page is lettered again. */
  /** Lettering of a page the Assistant changed (20 Nov 2026): the Letterer places every line afresh, then each panel whose balloons
   *  still sit cleanly where the person had them (same place inside the panel; inside it, off faces, off other balloons, in reading
   *  order) keeps them as they were, with their words and styles. Only panels where the old places no longer work are lettered again.
   *  was = capture() of the pages, taken before the change. -> { text, kept, redone } (panels) */
  const AS_MOVED = /Leaves the page|Spills out of its panel|Covers a face|^Overlaps|Out of reading order/;
  function asKeepPlacement(p, was, fresh) {
    const cells = R.allPanels(p.layout), ids = cells.map((c) => c.panel.id), group = (list, key) => { const m = new Map(); for (const x of list) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
    const recs = (was || []).filter((r) => ids.includes(r.id)).map((r) => ({ ...r, it: JSON.parse(JSON.stringify(r.it)) })); // copies: the fresh lettering stays a choice
    const loose = (p.text || []).filter((it) => !it.panel || it.free), neu = group(fresh, (it) => it.panel);
    if (!recs.length) return { text: fresh.concat(loose), kept: 0, redone: neu.size };
    restore(recs, p);
    const old = group(recs.map((r) => r.it), (it) => it.panel), use = new Set([...old.keys()].filter((id) => !old.get(id).some((it) => it.bridge))); // a bridging balloon belongs to the border it sat on
    const build = () => cells.flatMap((c) => (use.has(c.panel.id) ? old.get(c.panel.id) : neu.get(c.panel.id) || [])).concat(loose);
    const had = use.size; let text = build();
    const keepText = p.text; p.text = text;
    try { for (const r of R.check(p, text.map((it) => R.measure(it, spec, measureText)), R.protectBoxes(p, lib()))) if (r.i >= 0 && AS_MOVED.test(r.msg) && text[r.i].panel) use.delete(text[r.i].panel); }
    finally { p.text = keepText; }
    if (use.size !== had) text = build();
    return { text, kept: use.size, redone: [...new Set(text.filter((it) => it.panel && !it.free && !use.has(it.panel)).map((it) => it.panel))].length };
  }
  let asKept = { kept: 0, redone: 0 }; // what the last page step did to the lettering, for its message
  const asLettered = () => (!asKept.kept ? "lettered again" : !asKept.redone ? "balloons kept where you placed them" : `balloons kept as placed in ${asKept.kept} panel${asKept.kept === 1 ? "" : "s"}, ${asKept.redone} lettered again`);
  function setPagePanels(i, panels, relettered, was) {
    const p = spec.pages[i], ids = new Set(panels.map((q) => q.id));
    p.layout = { ...(p.layout && p.layout.rtl ? { rtl: true } : {}), ...(p.layout && (p.layout.insets || []).length ? { insets: p.layout.insets } : {}), ...(p.layout && (p.layout.breakouts || []).length ? { breakouts: p.layout.breakouts } : {}),
      rows: panels.map((q) => { const n = { ...q, w: 1 }; delete n.slant; return { h: 1, panels: [n] }; }) };
    delete p.plan; ensureIds(p);
    const keep = pageIdx; pageIdx = i;
    p.text = (p.text || []).filter((it) => !it.panel || it.free || ids.has(it.panel) || (p.layout.insets || []).some((q) => q.id === it.panel)); // balloons of panels that left go with them
    try { if (panels.length > 1) applyTemplate(null, true, true); if (relettered && R.planFor(p).length) { const k = asKeepPlacement(p, was, R.autoPlace(p, spec, lib(), measureText)); p.text = k.text; asKept.kept += k.kept; asKept.redone += k.redone; } }
    finally { pageIdx = keep; }
  }
  const blankPage = (like) => ({ id: "board-" + newId(), number: 0, label: "", note: "", text: [], layout: { ...(like.layout && like.layout.rtl ? { rtl: true } : {}), rows: [] } });
  function asDone(open, msg) { pageIdx = Math.max(0, Math.min(spec.pages.length - 1, open)); sel = -1; selP = null; if (mode !== "chapter") mode = "layout"; render(); snap(); setStatus(msg + " Undo takes it back.", "ok"); return msg; }
  function asSplit(a) {
    asBoardOnly(); const i = asPage(a.page), p = spec.pages[i]; if (!p.layout || p.cover) throw new Error(`${asName(p)} has no panels to spread out.`);
    const order = mainPanels(p), cuts = [...new Set(asIds(a.after).map((id) => order.findIndex((q) => q.id === id)))].sort((x, y) => x - y);
    if (!cuts.length || cuts.some((c) => c < 0 || c >= order.length - 1)) throw new Error(`"after" must name panels on ${asName(p)} that are not its last one. Its panels, in reading order: ${order.map((q) => q.id).join(", ")}.`);
    const groups = []; let s0 = 0; for (const c of cuts) { groups.push(order.slice(s0, c + 1)); s0 = c + 1; } groups.push(order.slice(s0));
    const lettered = (p.text || []).length > 0, texts = p.text || [], was = p.number, cap = capture(p); asKept = { kept: 0, redone: 0 };
    const made = groups.slice(1).map(() => blankPage(p)); spec.pages.splice(i + 1, 0, ...made);
    made.forEach((np, k) => { const ids = new Set(groups[k + 1].map((q) => q.id)); np.text = texts.filter((it) => ids.has(it.panel)); });
    { const gone = new Set(groups.slice(1).flat().map((q) => q.id)); p.text = texts.filter((it) => !gone.has(it.panel)); }
    renumber(); groups.forEach((g, k) => setPagePanels(i + k, g, lettered, cap));
    return asDone(i, `Page ${was} is now pages ${p.number} ${made.length === 1 ? "and" : "to"} ${p.number + made.length} (${groups.map((g) => g.length).join(", ")} panels)${lettered ? ", " + asLettered() : ""}. ${spec.pages.filter((q) => !q.cover).length} pages in the chapter.`);
  }
  function asMove(a) {
    asBoardOnly(); const i = asPanelPage(a.panel), p = spec.pages[i], order = mainPanels(p), k = order.findIndex((q) => q.id === String(a.panel).trim()), next = /^next/i.test(String(a.to || ""));
    if (!next && !/^prev/i.test(String(a.to || ""))) throw new Error('"to" is next or previous.');
    if (k < 0) throw new Error("That panel is an inset: move it in Layout.");
    if (k !== (next ? order.length - 1 : 0)) throw new Error(`Only the ${next ? "last" : "first"} panel of a page can move to the ${next ? "next" : "previous"} page (the story stays in order). On ${asName(p)} that is ${order[next ? order.length - 1 : 0].id}.`);
    if (order.length < 2) throw new Error(`It is the only panel on ${asName(p)}. Use join_pages to put two pages together.`);
    let j = next ? i + 1 : i - 1, made = false;
    if (!spec.pages[j] || !spec.pages[j].layout || spec.pages[j].cover) { spec.pages.splice(next ? i + 1 : i, 0, blankPage(p)); made = true; j = next ? i + 1 : i; }
    const src = spec.pages[next ? i : (made ? i + 1 : i)], dst = spec.pages[j], q = order[k], lettered = (src.text || []).length > 0 || (dst.text || []).length > 0;
    const cap = capture(src).concat(made ? [] : capture(dst)); asKept = { kept: 0, redone: 0 };
    const there = made ? [] : mainPanels(dst); dst.text = (dst.text || []).concat((src.text || []).filter((it) => it.panel === q.id)); src.text = (src.text || []).filter((it) => it.panel !== q.id);
    renumber(); setPagePanels(spec.pages.indexOf(src), order.filter((x) => x !== q), lettered, cap); setPagePanels(spec.pages.indexOf(dst), next ? [q, ...there] : [...there, q], lettered, cap);
    return asDone(spec.pages.indexOf(dst), `Panel ${q.id} moved to ${made ? "a new " : ""}${asName(dst)} (${mainPanels(dst).length} panels there now, ${mainPanels(src).length} left on ${asName(src)})${lettered ? "; " + asLettered() : ""}.`);
  }
  function asJoin(a) {
    asBoardOnly(); const i = asPage(a.page), p = spec.pages[i], n = spec.pages[i + 1];
    if (!p.layout || p.cover || !n || !n.layout || n.cover) throw new Error(`${asName(p)} has no page after it to join with.`);
    const all = mainPanels(p).concat(mainPanels(n)); if (all.length > 8) throw new Error(`That would put ${all.length} panels on one page: too many to read. Move single panels with move_panel.`);
    const lettered = (p.text || []).length > 0 || (n.text || []).length > 0, was = [p.number, n.number];
    const cap = capture(p).concat(capture(n)); asKept = { kept: 0, redone: 0 };
    p.text = (p.text || []).concat(n.text || []); if ((n.layout.insets || []).length) p.layout.insets = (p.layout.insets || []).concat(n.layout.insets);
    spec.pages.splice(i + 1, 1); renumber(); setPagePanels(i, all, lettered, cap);
    return asDone(i, `Pages ${was[0]} and ${was[1]} are now one page, ${p.number}, with ${all.length} panels${lettered ? ", " + asLettered() : ""}. ${spec.pages.filter((q) => !q.cover).length} pages in the chapter.`);
  }
  function asLayout(a) {
    const i = asPage(a.page), p = spec.pages[i]; if (!p.layout || p.cover) throw new Error(`${asName(p)} is one whole picture.`);
    const n = mainPanels(p).length, code = String(a.code || "").trim(); if (n < 2) throw new Error(`${asName(p)} has one panel: there is nothing to lay out.`);
    if (code && !T().some((t) => t.code === code)) throw new Error(`There is no layout "${code}".`);
    const keep = pageIdx; pageIdx = i; let t; const before = JSON.stringify(p.layout.rows);
    try { t = applyTemplate(code, !code, true); } finally { pageIdx = keep; }
    if (!t) throw new Error(`No ready-made layout has ${n} panels. Change it by hand in Layout.`);
    if (JSON.stringify(p.layout.rows) === before) return `${asName(p)} already has the layout that fits best (${t.code}). Nothing changed.`;
    return asDone(i, `${asName(p)[0].toUpperCase() + asName(p).slice(1)} is laid out again: ${t.code}${t.name ? " " + t.name : ""}, sized by each panel's weight.`);
  }
  function asEditPanel(a) {
    const i = asPanelPage(a.panel), f = spec.pages[i], q = R.allPanels(f.layout).map((c) => c.panel).find((x) => x.id === String(a.panel).trim()), D = window.Director, done = [];
    q.board = q.board || { who: [], lines: [] };
    if (a.action != null && String(a.action).trim() && String(a.action).trim() !== q.board.action) { q.board.action = String(a.action).trim().slice(0, 2000); done.push("what it shows"); }
    if (a.shot != null && String(a.shot).trim() && String(a.shot).trim() !== q.board.shot) { q.board.shot = String(a.shot).trim().slice(0, 80); done.push("the shot"); }
    if (a.job != null && String(a.job).trim()) { const j = String(a.job).trim(); if (D && D.JOBS && !D.JOBS[j]) throw new Error(`"${j}" is not a job. The jobs: ${Object.keys(D.JOBS).join(", ")}.`); if (q.board.job !== j) { q.board.job = j; done.push("its job"); } }
    if (a.weight != null && String(a.weight).trim()) { const w = Math.round(+a.weight); if (!(w >= 1 && w <= 5)) throw new Error("The weight is 1 (a tiny beat) to 5 (the big moment)."); if (q.board.weight !== w) { q.board.weight = w; done.push("its weight"); } }
    if (!done.length) return `Nothing to change on panel ${q.id}: it already says that.`;
    pageIdx = i; selP = q.id; sel = -1; render(); snap();
    const msg = `Panel ${q.id}: changed ${done.join(", ")}. Its lines are untouched.${q.image ? " The picture is the old one until it is drawn again." : ""}${done.some((d) => /weight|job/.test(d)) ? " Use layout_page to size the page to it." : ""}`;
    setStatus(msg + " Undo takes it back.", "ok"); return msg;
  }
  function registerAssistant() {
    if (!window.Ibasho || !window.Ibasho.registerAssistant) return;
    const tryIt = (fn) => (a) => { try { fn(a); return ""; } catch (e) { return e.message; } }; // "can this run?" without changing anything
    const hasPage = tryIt((a) => asPage(a.page)), hasPanel = tryIt((a) => asPanelPage(a.panel));
    window.Ibasho.registerAssistant({ where: assistantWhere, actions: {
      open_panel: { desc: "Show one panel in Art mode (its picture, prompt, tags)", args: { panel: "panel id" }, auto: true, check: hasPanel, label: (a) => `Open panel ${a.panel}`, run: (a) => { openPanel(a.panel); } },
      open_page: { desc: "Show one page", args: { page: "page number, or cover" }, auto: true, check: hasPage, label: (a) => `Open page ${a.page}`, run: (a) => { pageIdx = asPage(a.page); sel = -1; selP = null; if (mode === "chapter") mode = "layout"; render(); } },
      split_page: { desc: "Spread ONE crowded page over two or more pages. Free, done at once, only that page changes. after = the panel id that ends each page but the last (for three pages give two ids). The story order is kept, each new page gets a layout sized by its panels' weights, and a lettered page is lettered again.",
        args: { page: "page number", after: "panel ids, comma separated: the LAST panel that stays on each page" }, check: hasPage, label: (a) => `Spread page ${a.page} over ${asIds(a.after).length + 1} pages`, run: asSplit },
      move_panel: { desc: "Move the LAST panel of a page to the start of the next page, or the FIRST panel to the end of the previous page (a new page is made when there is none). Free, at once; both pages are laid out again.",
        args: { panel: "panel id", to: "next | previous" }, check: hasPanel, label: (a) => `Move panel ${a.panel} to the ${/^next/i.test(String(a.to)) ? "next" : "previous"} page`, run: asMove },
      join_pages: { desc: "Put a page and the page after it together as one page (at most 8 panels). Free, at once.", args: { page: "the first of the two pages" }, check: hasPage, label: (a) => `Join page ${a.page} with the page after it`, run: asJoin },
      layout_page: { desc: "Lay one page out again: the panel director picks the layout that fits the panels' weights (the heaviest panel is the biggest), or give a layout code. Free, at once. Panels, pictures and balloons are kept.",
        args: { page: "page number", code: "optional layout code" }, check: hasPage, label: (a) => `Lay out page ${a.page} again${a.code ? " (" + a.code + ")" : ""}`, run: asLayout },
      edit_panel: { desc: "Change one panel's storyboard: what it shows (action), the shot (for example close-up, wide), its job (establish | talk | act | react | insert | big) or its weight (1 a tiny beat to 5 the big moment). Give only what changes. The spoken lines are the script's own words and cannot be changed here. Free, at once; a drawn picture stays until it is drawn again.",
        args: { panel: "panel id", action: "optional: what the panel shows", shot: "optional", job: "optional", weight: "optional, 1 to 5" }, check: hasPanel, label: (a) => `Change panel ${a.panel}: ${["action", "shot", "job", "weight"].filter((k) => a[k] != null && String(a[k]).trim()).join(", ") || "nothing given"}`, run: asEditPanel },
      draw_panel: { desc: "Draw or redraw one panel with the picture model in use. note = the person's direction, added to the Artist's prompt (keeps the storyboard). prompt = a whole new prompt instead (only when asked).", args: { panel: "panel id", note: "optional direction", prompt: "optional whole prompt" }, check: hasPanel,
        paid: true, cost: (a) => { try { return costOf([a.panel]); } catch (e) { return 0; } }, label: (a) => `Draw panel ${a.panel}${a.note ? ": " + String(a.note).slice(0, 60) : ""}`,
        run: async (a) => { if (!canDraw()) throw new Error("Drawing needs Ibasho running on your computer."); openPanel(a.panel); const d = draftFor(a.panel);
          if (a.prompt) { d.mode = "custom"; d.custom = String(a.prompt); } else if (a.note) { if (d.mode === "artist") d.artist = d.artist.replace(/\n\nNOTE FROM THE AUTHOR:[\s\S]*$/, "") + "\n\nNOTE FROM THE AUTHOR (it wins over anything above it contradicts): " + String(a.note); else d.custom = (d.custom + "\n" + String(a.note)).trim(); }
          await sendRequest(true); return "Queued: it lands in the panel when it is drawn."; } },
      storyboard_again: { desc: "LAST RESORT: run the Paneler again on the WHOLE chapter with a note. EVERY page and panel is rebuilt, it takes about six minutes, and lettering and hand changes are lost (pictures stay in the art list). Never use it to change one page or a few panels: use split_page, move_panel, join_pages, layout_page or edit_panel.", args: { note: "what to change" }, label: (a) => `Storyboard the WHOLE chapter again${a.note ? ": " + String(a.note).slice(0, 60) : ""}`,
        run: async (a) => {
          const pages = spec.pages.filter((p) => !p.cover).length, drawn = spec.pages.reduce((n, p) => n + (p.layout ? leaves(p.layout.rows).filter((q) => q.image).length : 0), 0), balloons = spec.pages.reduce((n, p) => n + (p.text || []).length, 0);
          if (!confirm(`Storyboard the WHOLE chapter again?\n\nAll ${pages} pages are rebuilt by the Paneler. It takes about six minutes.` + (balloons ? `\n${balloons} placed balloons and any layout changes made by hand are lost.` : "") + (drawn ? `\n${drawn} drawn pictures stay in the art list, but may not land on the same panels.` : "") + "\n\nTo change one page, cancel and ask for that page only.")) throw new Error("Not started: you cancelled. Nothing changed.");
          if (!(await okToWrite())) throw new Error("Not started."); const r = await fetch("/api/storyboard?p=" + encodeURIComponent(proj.id), { method: "POST", body: JSON.stringify({ note: String(a.note || "") }) }); if (!r.ok) throw new Error("The Paneler could not start (only chapters made in the app can be storyboarded again)."); return "Started. Nothing has changed yet: the new storyboard loads by itself when it is done, in about six minutes."; } },
    } });
  }
  async function queuePage(which) {
    const sets = pageGenSets()[which], held = [...new Set(sets.flatMap((q) => needSheet(q)))], list = sets.filter((q) => !needSheet(q).length);
    if (!list.length) { if (held.length) setStatus(`Nothing drawn: ${held.join(", ")} ${held.length === 1 ? "has" : "have"} no approved character sheet. Add or approve under Series.`, "error"); return; }
    if (canDraw() && window.Ibasho && !(await window.Ibasho.okToSpend(costOf(list.map((q) => q.id)), `Drawing ${list.length} picture${list.length === 1 ? "" : "s"}`))) return;
    for (const q of list) queuePanel(q.id);
    render(); snap();
    if (held.length) { setStatus(`Drawing ${list.length} of ${sets.length}. The rest wait for approved sheets: ${held.join(", ")}.`, "warn"); startJobs(list.map((q) => q.id)); return; }
    setStatus(canDraw() ? `Drawing ${list.length} picture${list.length === 1 ? "" : "s"}, two at a time.` : `${list.length} panel${list.length === 1 ? "" : "s"} queued for the Artist. Undo takes them all back.`, "ok");
    startJobs(list.map((q) => q.id));
  }
  /** The estimate for drawing these panels with the picture model in use (0 for Codex: it is in the plan). */
  function costOf(ids) { let t = 0; for (const id of ids) { const a = aiPrompt(id), d = draftFor(id), e = picEst({ size: (a && a.size) || [1024, 1536], refs: d.refs.length, chars: ((d.mode === "artist" ? d.artist : d.custom) || "").length + 400 }); t += e && e.usd ? e.usd : 0; } return t; }
  async function sendRequest(asked) {
    if (!asked && canDraw() && window.Ibasho && !(await window.Ibasho.okToSpend(costOf([selP]), "This picture"))) return;
    if (!queuePanel(selP)) return;
    render(); snap();
    setStatus(canDraw() ? "Drawing. The picture lands in the panel when it is done." : "Queued for the Artist. Undo takes the request back.", "ok");
    startJobs([selP]);
  }
  function queuePanel(selP) {
    const f = findPanel(selP); if (!f) return false;
    const lack = needSheet(f.panel);
    if (lack.length) { setStatus(`Not drawn: ${lack.join(" and ")} ${lack.length === 1 ? "has" : "have"} no approved character sheet. Add or approve ${lack.length === 1 ? "it" : "them"} under Series.`, "error"); return false; }
    const d = draftFor(selP), a = aiPrompt(selP);
    let out;
    if (d.mode === "artist") out = { text: d.artist.trim(), size: a ? a.size : [1024, 1024], edited: !a || d.artist !== a.prompt };
    else {
      const c = d.keepStyle && bible ? aiPrompt(selP, { own: d.custom }) : null;
      const bare = window.Artist ? window.Artist.panelBrief(page(), selP, spec, bible || { cast: {} }, R, measureText, { own: d.custom, bare: true }) : { size: [1024, 1024] };
      out = c ? { text: c.prompt, size: c.size, own: d.custom.trim() } : { text: d.custom.trim(), size: bare.size, own: d.custom.trim() };
    }
    out.refList = JSON.parse(JSON.stringify(d.refs.slice(0, refLimit()))); // the pictures, in order (as many as the model takes); the prompt names each one
    out.prompt = out.text + tagWords(d, a) + refLine(out.refList); delete out.text;
    out.tags = [...tagged(d)];
    const m = picModel && picModel.connected !== false ? picModel : { service: "codex", model: "codex", name: "Codex image tool" };
    f.panel.request = Object.assign({ source: m.service, model: m.model, modelName: m.name + (m.quality ? " · " + m.quality : ""), quality: m.quality || "", mode: d.mode, keepStyle: !!d.keepStyle, status: "queued", at: new Date().toISOString() }, out);
    return true;
  }

  function renderChecks() {
    const res = R.check(page(), measured, R.protectBoxes(page(), lib()));
    if (window.Paneler && page().layout && spec.kind === "storyboard") {
      const pr = window.Paneler.check(spec, R).pages[page().id] || [];
      for (const q of pr) res.push({ level: q.level, advice: q.advice, msg: q.advice ? q.msg.replace(/^Advice: /, "") : "Paneler: " + q.msg, i: -1 });
    }
    const errs = res.filter((r) => r.level === "error").length, warns = res.length - errs;
    $("checkSummary").textContent = res.length ? `${errs} must fix · ${warns} to look at` : "All checks pass";
    $("checkSummary").dataset.tone = errs ? "error" : warns ? "warn" : "ok";
    $("checks").innerHTML = res.map((r) => {
      const who = r.i >= 0 ? `“${R.esc(R.plain(items()[r.i].text).slice(0, 28))}”` : "Page";
      return `<li data-level="${r.level}"><button type="button" data-sel="${r.i}"><span class="chip">${r.level === "error" ? "Fix" : r.advice ? "Advice" : "Look"}</span><span><b>${who}</b> ${R.esc(r.msg)}</span></button></li>`;
    }).join("");
  }

  function speakers() {
    const set = new Set();
    for (const p of spec.pages) for (const t of p.text) if (t.speaker) set.add(t.speaker);
    return [...set];
  }

  function renderInspector() {
    const insp = $("inspector");
    const it = mode === "letter" ? items()[sel] : null;
    $("emptyInspector").hidden = !!it || mode !== "letter";
    insp.hidden = !it;
    if (!it) return;
    const { kind, fontKey, mult, voice } = R.styleFor(it, spec);
    const L = measured[sel];
    $("kindGrid").innerHTML = Object.entries(R.KINDS).map(([k, v]) =>
      `<button type="button" class="kind" data-kind="${k}" aria-pressed="${k === kind}" title="${R.esc(v.hint)}">${kindIcon(k)}<span>${v.label}</span></button>`).join("");
    $("kindHint").textContent = R.KINDS[kind].hint;
    setVal("textIn", it.text || "");
    $("speakerList").innerHTML = speakers().map((s) => `<option value="${R.esc(s)}"></option>`).join("");
    setVal("speakerIn", it.speaker || "");
    $("fontSel").innerHTML = `<option value="">Type default (${R.FONTS[R.KINDS[kind].font].label})</option>` +
      Object.entries(R.FONTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
    $("fontSel").value = it.font || "";
    setVal("sizeIn", mult); $("sizeOut").textContent = Math.round(L.size) + "u";
    const w = it.width != null ? it.width : R.KINDS[kind].width;
    setVal("widthIn", w); $("widthOut").textContent = Math.round(w * 100) + "%";
    const rotWrap = $("rotWrap"); rotWrap.hidden = R.KINDS[kind].shape !== "none";
    setVal("rotIn", it.rotate != null ? it.rotate : R.KINDS[kind].rotate || 0); $("rotOut").textContent = $("rotIn").value + "°";
    $("tailChk").checked = !!it.tail; $("tailChk").disabled = !R.TAIL_KINDS.has(kind);
    $("joinChk").checked = !!it.join; $("bleedChk").checked = !!it.bleed; $("bridgeChk").checked = !!it.bridge; $("hollowChk").checked = !!it.hollow;
    { const sfx = kind === "sfx"; $("hollowChk").closest("label").hidden = !sfx; $("bridgeChk").closest("label").hidden = sfx || !R.bridgeSpot(page(), it); $("joinChk").closest("label").hidden = sfx; $("tailChk").closest("label").hidden = sfx; $("sizeIn").max = sfx ? 4 : 1.8; }
    $("anchorWrap").hidden = !page().layout;
    $("anchorChk").checked = !!page().layout && !it.free;
    const ap = it.panel && findPanel(it.panel);
    $("anchorInfo").textContent = it.free ? "Stays where it is on the page" : ap ? (ap.inset ? "Attached to an inset panel" : `Attached to panel ${page().layout.rows.slice(0, ap.r).reduce((a, r) => a + r.panels.length, 0) + ap.k + 1}`) : "Not over a panel";
    const vb = $("voiceBtn");
    vb.hidden = !it.speaker;
    if (it.speaker) {
      const same = voice.font === (it.font || undefined) && (voice.size || 1) === mult;
      vb.textContent = same && (voice.font || voice.size) ? `${it.speaker}’s voice is set` : `Use this font and size for all of ${it.speaker}’s lines`;
      vb.disabled = same && !!(voice.font || voice.size);
    }
  }
  function miniLayout(rows) {
    const cs = R.layoutGeom({ rows, rtl: isRtl() }).cells;
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><rect width="${W}" height="${H}" fill="#fff"/>` +
      cs.map((c) => `<polygon points="${(c.drawPoly || c.poly).map((q) => q[0].toFixed(0) + "," + q[1].toFixed(0)).join(" ")}" fill="#dfe6f3" stroke="#15181d" stroke-width="18"/>`).join("") + "</svg>";
  }
  function renderLayoutPanel() {
    const lp = $("layoutPanel");
    lp.hidden = mode !== "layout";
    if (mode !== "layout") return;
    const p = page();
    $("layoutNA").hidden = !!p.layout;
    $("layoutTools").hidden = !p.layout;
    if (!p.layout) return;
    const found = findPanel(selP), panel = found ? found.panel : null;
    { const b = selB && findBo(selB), ask = !b && panel && panel.board && panel.board.breakout && !breakouts(p).some((x) => x.panel === panel.id);
      $("boTools").hidden = !b; $("boBtn").hidden = store.kind !== "local" || !!b;
      $("boAsk").hidden = !ask; if (ask) $("boAsk").textContent = `The storyboard asks for a break-out on this panel: “${panel.board.breakout}”. Press + Break-out to add it.`;
      if (b) { const j = boJob(b), busy = boBusy(b);
        $("boInfo").textContent = `${b.who || "A figure"}${b.action ? ": " + b.action : ""} · ${busy ? (j.status === "drawing" ? "Codex is drawing it…" : "waiting its turn to be drawn") : j && j.status === "failed" ? "not drawn: " + (j.msg || "it failed") : b.image ? "drawn" : "not drawn yet"}`;
        $("boDraw").textContent = b.image ? "Draw it again" : "Draw it"; $("boDraw").disabled = busy || !canDraw(); $("boDraw").classList.toggle("primary", !b.image); $("boFlip").disabled = !b.image; } }
    $("splitRow").hidden = !!(found && found.inset);
    $("panelTools").hidden = !panel;
    $("layoutHint").hidden = !!panel || !!selB;
    $("freeBtn").textContent = placing ? `Done (${placing.length} corner${placing.length === 1 ? "" : "s"})` : "+ Free-shape panel"; $("freeBtn").classList.toggle("primary", !!placing); $("freeCancel").hidden = !placing;
    if (panel) {
      { const has = R.validShape(panel.shape);
        $("pshapes").innerHTML = `<button type="button" class="seg" data-pshape="" aria-pressed="${!has}">Plain</button>` + Object.entries(R.SHAPES).map(([k, v]) => `<button type="button" class="seg" data-pshape="${k}" aria-pressed="${has && JSON.stringify(panel.shape) === JSON.stringify(v.make())}">${v.label}</button>`).join("") + (has && !Object.values(R.SHAPES).some((v) => JSON.stringify(panel.shape) === JSON.stringify(v.make())) ? `<button type="button" class="seg" aria-pressed="true" disabled>My own</button>` : "");
        $("shapeEdit").textContent = shaping ? "Done with corners" : "Edit corners"; $("shapeEdit").setAttribute("aria-pressed", shaping); $("shapeHint").hidden = !shaping;
        $("shapeDel").hidden = !shaping || selV < 0 || !has || panel.shape.length <= 3; }
      $("ptypes").innerHTML = Object.entries(R.PANEL_TYPES).map(([k, v]) => `<button type="button" class="seg" data-ptype="${k}" aria-pressed="${(panel.type || "framed") === k}">${v}</button>`).join("");
      $("pbgField").hidden = !panel.board; $("psplash").checked = !!(panel.board && panel.board.splash);
      $("pjobField").hidden = !panel.board || !window.Director;
      if (panel.board && window.Director) { // the panel director: a job and a weight for every panel
        const D = window.Director, b = panel.board, w = D.weightOf(b);
        $("pjob").innerHTML = `<option value="">Not said</option>` + Object.entries(D.JOBS).map(([k, j]) => `<option value="${k}"${b.job === k ? " selected" : ""}>${R.esc(j.label)}</option>`).join("");
        $("pjobHint").textContent = b.job && D.JOBS[b.job] ? D.JOBS[b.job].hint : "Give every panel a job: the layout, the background and how much is drawn all follow from it.";
        $("pweight").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="seg" data-pw="${n}" aria-pressed="${w === n}" title="${["A tiny beat", "Light", "Middle", "Heavy", "The big moment"][n - 1]}">${n}</button>`).join("");
        $("pface").checked = b.face === "big"; $("preveal").checked = !!b.reveal;
        const TN = D.TENSION || {}; $("ptension").innerHTML = `<option value="">None (an ordinary beat)</option>` + Object.entries(TN).map(([k, t]) => `<option value="${k}"${b.tension === k ? " selected" : ""}>${R.esc(t.label)}</option>`).join("");
        $("ptensionHint").textContent = b.tension && TN[b.tension] ? TN[b.tension].hint + " The next drawing of this panel follows it." : "Tense, danger or fear: the Artist picks the camera (low, tilted, close behind the hero) to match.";
      }
      if (panel.board) $("pbg").innerHTML = [["full", "Full"], ["simple", "Hint"], ["tone", "Tone"], ["white", "White"]].map(([k, v]) => `<button type="button" class="seg" data-pbg="${k}" aria-pressed="${(panel.board.bg || "simple") === k}">${v}</button>`).join("");
      setVal("zoomIn", panel.zoom || 1); $("zoomOut").textContent = Math.round((panel.zoom || 1) * 100) + "%";
    }
    $("tray").innerHTML = (spec.library || []).map((it) =>
      `<button type="button" class="thumb" data-src="${R.esc(it.src)}" aria-pressed="${!!panel && panel.image === it.src}" title="${R.esc(it.label)}"><img src="${R.esc(BASE + it.src)}" alt="${R.esc(it.label)}" loading="lazy"></button>`).join("");
    const counts = [...new Set(T().map((t) => leaves(t.rows).length))].sort((a, b) => a - b);
    const isOwn = (t) => ownLayouts.includes(t), hasStrip = (t) => (t.rows || []).some((r) => r.strip);
    if ((tmplFilter === "mine" && !ownLayouts.length) || (tmplFilter === "strip" && !T().some(hasStrip))) tmplFilter = "all";
    $("tmplFilters").innerHTML = ["all", ...counts, ...(T().some(hasStrip) ? ["strip"] : []), ...(ownLayouts.length ? ["mine"] : [])].map((c) => `<button type="button" class="seg" data-tf="${c}" aria-pressed="${String(tmplFilter) === String(c)}">${c === "all" ? "All" : c === "mine" ? "Mine" : c === "strip" ? "Strips" : c}</button>`).join("");
    $("tmplSave").hidden = store.kind !== "local";
    if (!$("tmplDetails").open) return;
    const list = T().filter((t) => tmplFilter === "all" || (tmplFilter === "mine" ? isOwn(t) : tmplFilter === "strip" ? hasStrip(t) : leaves(t.rows).length === +tmplFilter));
    // the panel director: layouts with this page's number of panels come first, best fit for the panels' weights first;
    // an even grid or upright gutters that line up are marked (they read as a grid, not as manga)
    const D = window.Director, mine = leaves(p.layout.rows), fit = new Map();
    if (D && (mine.length > 1 || (mine.length === 1 && !p.cover))) D.sorted(mine, T(), R, { avoid: neighbourShapes() }).forEach((x, i) => fit.set(x.template.code, Object.assign({ rank: i }, x)));
    const weighted = mine.some((q) => q.board && (q.board.weight || q.board.job || q.board.splash));
    $("tmplPick").hidden = !fit.size; $("tmplHint").hidden = !fit.size;
    if (fit.size) $("tmplHint").textContent = weighted ? mine.length === 1 ? "This page is one panel. It can sit inside the margins with a border (L1-01), or run to the page's edges with no border (L1-02): that one is for the splash, the biggest picture of the chapter." : `Layouts with ${mine.length} panels are listed best fit first for this page's weights. Faded ones are an even grid or have upright gutters that line up.` : `Give the panels a job and a weight (tap a panel) and the best layout for this page is listed first. Faded ones are an even grid or have upright gutters that line up.`;
    const rate = (t) => { const f = fit.get(t.code); if (f) return f.rating; try { return D ? D.rate(t.rows, R) : null; } catch (e) { return null; } };
    const order = list.slice().sort((a, b) => (fit.has(a.code) ? fit.get(a.code).rank : 1e6) - (fit.has(b.code) ? fit.get(b.code).rank : 1e6));
    $("tmplGrid").innerHTML = order.map((t) => { const rt = rate(t), fault = rt && (rt.even ? "an even grid" : rt.aligned ? "upright gutters line up" : ""), f = fit.get(t.code);
      return `<button type="button" class="tmpl" data-tmpl="${R.esc(t.code)}"${fault ? ` data-fault="1"` : ""}${f && f.rank === 0 && weighted ? ` data-best="1"` : ""} title="${R.esc(t.code + " · " + t.name + (f && f.rank === 0 && weighted ? " · best fit for this page's weights" : "") + (fault ? " · " + fault : ""))}">${miniLayout(f ? f.rows : t.rows)}<span>${R.esc(t.code)}</span></button>` + (tmplFilter === "mine" ? `<button type="button" class="btn link tmpl-x" data-tmpl-del="${R.esc(t.code)}" aria-label="Remove your layout ${R.esc(t.code)}">Remove</button>` : ""); }).join("");
    $("tmplGrid").dataset.mine = tmplFilter === "mine" ? "1" : "";
  }

  function setVal(id, v) { const el = $(id); if (document.activeElement !== el) el.value = v; }

  function kindIcon(k) {
    const s = {
      speech: '<ellipse cx="16" cy="13" rx="12" ry="8"/><path d="M12 20 L9 27 L17 20"/>',
      shout: '<path d="M16 3 L19 9 L26 6 L23 12 L30 15 L23 18 L26 24 L19 21 L16 28 L13 21 L6 24 L9 18 L2 15 L9 12 L6 6 L13 9 Z"/>',
      whisper: '<ellipse cx="16" cy="14" rx="12" ry="8" stroke-dasharray="3 3"/>',
      thought: '<path d="M8 17 a5 5 0 0 1 2-9 a6 6 0 0 1 11-1 a5 5 0 0 1 4 9 a5 5 0 0 1-7 3 a6 6 0 0 1-10-2z"/><circle cx="9" cy="24" r="2"/><circle cx="6" cy="28" r="1.2"/>',
      caption: '<rect x="4" y="8" width="24" height="14"/>',
      ambient: '<path d="M5 20 q4-6 8 0 t8 0 t8 0" fill="none"/>',
      crowd: '<ellipse cx="11" cy="12" rx="7" ry="5"/><ellipse cx="22" cy="19" rx="7" ry="5"/>',
      phone: '<rect x="5" y="7" width="22" height="16" rx="4"/><rect x="8" y="10" width="16" height="10" rx="2"/>',
      title: '<path d="M6 9 H26 M16 9 V25" />',
      sfx: '<path d="M4 22 L7 9 L12 17 L15 6 L19 16 L23 8 L28 21" stroke-width="3.2" stroke-linejoin="round"/>',
    }[k];
    return `<svg viewBox="0 0 32 32" aria-hidden="true">${s}</svg>`;
  }

  // ---------- layout model: panel ids, balloons attached to panels ----------
  const newId = () => "p" + Math.random().toString(36).slice(2, 8);
  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
  /** Leaf panels (the ones with art), in reading order: row by row, and down through a panel's own rows before moving right. */
  function leaves(rows, out = []) { for (const row of rows || []) for (const q of row.panels) { if (q.rows && q.rows.length) leaves(q.rows, out); else out.push(q); } return out; }
  function eachPanel(rows, fn) { for (const row of rows || []) for (const q of row.panels) { fn(q); if (q.rows) eachPanel(q.rows, fn); } }
  function rowsAt(path) { let rows = page().layout.rows; for (let i = 0; i < path.length; i += 2) rows = rows[path[i]].panels[path[i + 1]].rows; return rows; }
  function ensureIds(p) {
    if (!p || !p.layout) return;
    eachPanel(p.layout.rows, (q) => { if (!q.id) q.id = newId(); });
    for (const q of p.layout.insets || []) if (!q.id) q.id = newId();
  }
  function geomById(p) { const m = new Map(); for (const c of R.allPanels(p.layout)) m.set(c.panel.id, c); return m; }
  function findPanel(id) {
    const p = page(); if (!p.layout || !id) return null;
    const walk = (rows, path) => {
      for (let r = 0; r < rows.length; r++) {
        const ks = rows[r].panels;
        for (let k = 0; k < ks.length; k++) {
          if (ks[k].id === id) return { panel: ks[k], rows, r, k, path };
          if (ks[k].rows) { const f = walk(ks[k].rows, path.concat([r, k])); if (f) return f; }
        }
      }
      return null;
    };
    const f = walk(p.layout.rows, []); if (f) return f;
    const ins = p.layout.insets || [];
    for (let i = 0; i < ins.length; i++) if (ins[i].id === id) return { panel: ins[i], inset: true, i };
    return null;
  }
  function pointIn(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function assignPanel(p, it) {
    if (!p.layout || it.free) { delete it.panel; return; }
    const cs = R.allPanels(p.layout).reverse(); // insets sit on top
    const c = cs.find((q) => pointIn(q.drawPoly, it.at[0] * W, it.at[1] * H));
    if (c) it.panel = c.panel.id; else delete it.panel;
  }
  function prepare(s) {
    for (const p of s.pages) {
      ensureIds(p);
      if (p.layout) for (const it of p.text) if (!it.panel && !it.free) assignPanel(p, it);
    }
    return s;
  }
  /** Balloon positions relative to their panel (body) and art (tail tip), taken before a layout change. */
  function capture(p = page()) {
    if (!p.layout) return [];
    const G = geomById(p), S = sizes(), out = [];
    for (const it of p.text) {
      const c = it.panel && !it.free && G.get(it.panel); if (!c) continue;
      const [x0, y0, x1, y1] = c.bbox, w = x1 - x0, h = y1 - y0;
      const rec = { it, id: it.panel, at: [(it.at[0] * W - x0) / w, (it.at[1] * H - y0) / h] };
      if (it.tail) {
        if (c.panel.image) rec.tailArt = R.artMap(c, S[c.panel.image]).toArt(it.tail[0] * W, it.tail[1] * H);
        else rec.tail = [(it.tail[0] * W - x0) / w, (it.tail[1] * H - y0) / h];
      }
      out.push(rec);
    }
    return out;
  }
  function restore(cap, p = page()) {
    if (!p.layout) return;
    const G = geomById(p), S = sizes();
    for (const rec of cap) {
      const c = G.get(rec.id);
      if (!c) { delete rec.it.panel; continue; }
      const [x0, y0, x1, y1] = c.bbox, w = x1 - x0, h = y1 - y0;
      rec.it.at = [round3(clamp01((x0 + rec.at[0] * w) / W)), round3(clamp01((y0 + rec.at[1] * h) / H))];
      if (rec.tailArt && c.panel.image) {
        const [tx, ty] = R.artMap(c, S[c.panel.image]).toPage(rec.tailArt[0], rec.tailArt[1]);
        rec.it.tail = [round3(clamp01(tx / W)), round3(clamp01(ty / H))];
      } else if (rec.tail) rec.it.tail = [round3(clamp01((x0 + rec.tail[0] * w) / W)), round3(clamp01((y0 + rec.tail[1] * h) / H))];
    }
  }
  // ---------- reading direction: right to left (manga) or left to right (comic), one choice for the whole series ----------
  // The series settings say it (bible.reading); a project without that keeps what it was built with; anything older reads left to right.
  const READING = { rtl: ["Right to left", "manga"], ltr: ["Left to right", "comic"] };
  const READ_ON = { phone: ["Phone", "X, a reading site"], print: ["Print", "a book"] };
  /** Where the series is read: its settings say, else the chapter as built, else a phone. */
  function readOnNow() { return bible && (bible.read_on === "phone" || bible.read_on === "print") ? bible.read_on : spec && spec.read_on === "print" ? "print" : "phone"; }
  function readingNow() { return bible && (bible.reading === "rtl" || bible.reading === "ltr") ? bible.reading : original && original.reading === "rtl" ? "rtl" : "ltr"; }
  const isRtl = () => !!(spec && spec.reading === "rtl");
  /** Turn every page to the series' direction. Panels change sides; each balloon keeps its place inside its own panel. -> pages turned */
  function syncReading() {
    if (!spec) return 0;
    const want = readingNow(), rtl = want === "rtl"; let n = 0;
    for (const p of spec.pages) {
      if (!p.layout || !!p.layout.rtl === rtl) continue;
      const cap = capture(p);
      if (rtl) p.layout.rtl = true; else delete p.layout.rtl;
      restore(cap, p); n++;
    }
    spec.reading = want;
    if (bible && (bible.read_on === "phone" || bible.read_on === "print")) spec.read_on = bible.read_on; // where the series is read sets the panels-a-page advice
    return n;
  }
  function readingSegs(el, cur, off) {
    el.innerHTML = Object.entries(READING).map(([k, [a, b]]) => `<button type="button" class="seg" data-reading="${k}" aria-pressed="${cur === k}"${off ? " disabled" : ""}>${a} <small>(${b})</small></button>`).join("");
  }
  function mutateLayout(fn) { const cap = capture(); fn(); ensureIds(page()); restore(cap); }

  // ---------- pointer: drag balloons and tails ----------
  let drag = null;
  function toPage(ev) {
    const svg = $("page"), pt = svg.createSVGPoint();
    pt.x = ev.clientX; pt.y = ev.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [Math.min(Math.max(p.x / W, 0), 1), Math.min(Math.max(p.y / H, 0), 1)];
  }
  function onDown(ev) {
    const t = ev.target;
    const [x, y] = toPage(ev);
    const gut = t.closest && t.closest("[data-gut]");
    if (mode === "art" && marking) { if (t.dataset && t.dataset.pid === marking.pid) markAt(x, y); else { marking = null; setStatus("Tap inside the selected panel to set a face. Marking was cancelled."); } render(); return; }
    if (mode === "art") { selP = t.dataset && t.dataset.pid ? t.dataset.pid : null; render(); return; }
    if (mode === "layout") {
      const p = page();
      if (!p.layout) return;
      const part = t.dataset && t.dataset.part;
      if (placing) { // a new free-shape panel: each tap is a corner; a tap on the first corner closes it
        if (placing.length >= 3 && Math.hypot((x - placing[0][0]) * W, (y - placing[0][1]) * H) < 34) return finishFree();
        if (placing.length < 64) placing.push([round3(clamp01(x)), round3(clamp01(y))]);
        render(); setStatus(placing.length < 3 ? `${placing.length} corner${placing.length === 1 ? "" : "s"}. Tap the page for the next one.` : `${placing.length} corners. Tap the first one again, or press Done, to close the shape.`); return;
      }
      if (part === "vtx" || part === "vadd") {
        const S = ownShape(); if (!S) return; const sh = S.c.panel.shape; let k = +t.dataset.k;
        if (part === "vadd") { sh.splice(k + 1, 0, toShape(S, x, y)); k = k + 1; }
        selV = k; drag = { mode: "vtx", k, x, y, moved: part === "vadd", cap: capture() };
      } else if (gut) {
        const path = gut.dataset.path ? gut.dataset.path.split(",").map(Number) : [];
        const rows = rowsAt(path), r = +gut.dataset.r, k = +gut.dataset.k, col = gut.dataset.gut === "col";
        const G = R.layoutGeom(p.layout), same = (q) => q.path.join(",") === path.join(",") && q.r === r && (!col || q.k === k);
        const L = (col ? G.colLines : G.rowLines).find(same);
        drag = { mode: (col ? "col" : "row") + (part === "tilt" ? "tilt" : ""), path, r, k, x, y, moved: false, cap: capture(), flip: col && L.flip ? -1 : 1, // right to left: the panel before an upright gutter is on its right
          perU: col ? L.wPerU : L.hPerU,
          a: col ? rows[r].panels[k].w || 1 : rows[r].h, b: col ? rows[r].panels[k + 1].w || 1 : rows[r + 1].h };
      } else if (part === "imove" || part === "iresize") {
        const f = findPanel(t.dataset.pid);
        drag = { mode: part, id: t.dataset.pid, x, y, box: f.panel.box.slice(), moved: false, cap: capture() };
      } else if (t.dataset && t.dataset.bo) { // a break-out: its body or top-left dot moves it, its bottom-right dot resizes it
        const b = findBo(t.dataset.bo); if (!b) return;
        selB = b.id; selP = null;
        drag = { mode: part === "bresize" ? "bresize" : "bmove", id: b.id, x, y, box: b.box.slice(), moved: false, cap: capture() };
      } else if (t.dataset && t.dataset.pid) {
        selB = null; if (selP !== t.dataset.pid) selV = -1;
        selP = t.dataset.pid;
        const c = geomById(p).get(selP);
        const cw = R.cropWindow(c.panel, c.bbox[2] - c.bbox[0], c.bbox[3] - c.bbox[1], sizes()[c.panel.image]);
        drag = { mode: "pan", x, y, f: (c.panel.focus || [0.5, 0.5]).slice(), c: cw, moved: false, cap: capture() };
      } else { selP = null; selB = null; render(); return; }
      $("page").setPointerCapture(ev.pointerId);
      ev.preventDefault();
      render();
      return;
    }
    if (t.dataset && t.dataset.tail != null) {
      drag = { mode: "tail", i: +t.dataset.tail, moved: false };
    } else if (t.dataset && t.dataset.i != null) {
      const i = +t.dataset.i, it = items()[i];
      sel = i;
      drag = { mode: "body", i, dx: it.at[0] - x, dy: it.at[1] - y, tdx: it.tail ? it.tail[0] - it.at[0] : 0, tdy: it.tail ? it.tail[1] - it.at[1] : 0, moved: false, moveTail: ev.altKey };
    } else {
      sel = -1; render(); return;
    }
    $("page").setPointerCapture(ev.pointerId);
    ev.preventDefault();
    render();
  }
  function onMove(ev) {
    if (!drag) return;
    const [x, y] = toPage(ev);
    if (drag.cap) { layoutMove(x, y); restore(drag.cap); drag.moved = true; render(); return; }
    const it = items()[drag.i];
    if (drag.mode === "tail") it.tail = [round3(x), round3(y)];
    else {
      it.at = [round3(x + drag.dx), round3(y + drag.dy)];
      if (drag.moveTail && it.tail) it.tail = [round3(it.at[0] + drag.tdx), round3(it.at[1] + drag.tdy)];
    }
    drag.moved = true;
    render();
  }
  function layoutMove(x, y) {
    const p = page(), L = p.layout, min = 0.04;
    const same = (q) => q.path.join(",") === drag.path.join(",") && q.r === drag.r && (drag.mode[0] !== "c" || q.k === drag.k);
    if (drag.mode === "row" || drag.mode === "col") {
      const rows = rowsAt(drag.path), col = drag.mode === "col";
      const d = (col ? (x - drag.x) * W * drag.flip : (y - drag.y) * H) * drag.perU, sum = drag.a + drag.b, min = 60 * drag.perU;
      const a = Math.min(Math.max(drag.a + d, min), sum - min);
      if (col) { rows[drag.r].panels[drag.k].w = round3(a); rows[drag.r].panels[drag.k + 1].w = round3(sum - a); }
      else { rows[drag.r].h = round3(a); rows[drag.r + 1].h = round3(sum - a); }
    } else if (drag.mode === "rowtilt") {
      const rows = rowsAt(drag.path), line = R.layoutGeom(L).rowLines.find(same);
      rows[drag.r].slant = round3((y * H - line.yc) / H);
      if (Math.abs(rows[drag.r].slant) < 0.004) delete rows[drag.r].slant;
    } else if (drag.mode === "coltilt") {
      const rows = rowsAt(drag.path), line = R.layoutGeom(L).colLines.find(same);
      const q = rows[drag.r].panels[drag.k];
      q.slant = round3((line.flip ? -1 : 1) * (x * W - line.xc) / W);
      if (Math.abs(q.slant) < 0.004) delete q.slant;
    } else if (drag.mode === "imove" || drag.mode === "iresize") {
      const f = findPanel(drag.id); if (!f) return;
      const b = drag.box.slice(), dx = x - drag.x, dy = y - drag.y;
      if (drag.mode === "imove") {
        const w = b[2] - b[0], h = b[3] - b[1];
        b[0] = Math.min(Math.max(b[0] + dx, 0), 1 - w); b[1] = Math.min(Math.max(b[1] + dy, 0), 1 - h); b[2] = b[0] + w; b[3] = b[1] + h;
      } else { b[2] = Math.min(Math.max(b[2] + dx, b[0] + 0.08), 1); b[3] = Math.min(Math.max(b[3] + dy, b[1] + 0.06), 1); }
      f.panel.box = b.map(round3);
    } else if (drag.mode === "vtx") {
      const S = shapeCorners(); if (!S || !R.validShape(S.c.panel.shape) || !S.c.panel.shape[drag.k]) return;
      S.c.panel.shape[drag.k] = toShape(S, x, y);
    } else if (drag.mode === "bmove" || drag.mode === "bresize") {
      const bo = findBo(drag.id); if (!bo) return;
      const b = drag.box.slice(), dx = x - drag.x, dy = y - drag.y;
      if (drag.mode === "bmove") { const w = b[2] - b[0], h = b[3] - b[1]; b[0] = Math.min(Math.max(b[0] + dx, 0), 1 - w); b[1] = Math.min(Math.max(b[1] + dy, 0), 1 - h); b[2] = b[0] + w; b[3] = b[1] + h; }
      else { const k = Math.max((b[2] - b[0] + dx) / (b[2] - b[0]), (b[3] - b[1] + dy) / (b[3] - b[1])), w = Math.min(Math.max((b[2] - b[0]) * k, 0.1), 1 - b[0]), h = (b[3] - b[1]) * w / (b[2] - b[0]); // its shape is kept
        if (b[1] + h <= 1) { b[2] = b[0] + w; b[3] = b[1] + h; } }
      bo.box = b.map(round3);
    } else if (drag.mode === "pan" && selP) {
      const f = findPanel(selP); if (!f || !f.panel.image) return;
      const c = drag.c, dxu = (x - drag.x) * W, dyu = (y - drag.y) * H;
      f.panel.focus = [round3(clamp01(drag.f[0] - dxu / c.scale / c.iw)), round3(clamp01(drag.f[1] - dyu / c.scale / c.ih))];
    }
  }
  function editPanel(fn, commit = true) {
    const p = page(), f = findPanel(selP); if (!p.layout || !f) return;
    mutateLayout(() => fn(f.panel, p.layout, f)); render(); if (commit) snap(); else liveEdit();
  }
  /** The layouts of the pages on either side of this one (a page never repeats its neighbour's layout). */
  function neighbourShapes() { const D = window.Director; if (!D) return []; return [spec.pages[pageIdx - 1], spec.pages[pageIdx + 1]].filter((q) => q && q.layout && !q.cover).map((q) => D.shape(q.layout.rows)); }
  function applyTemplate(code, byWeight, quiet) {
    let t = T().find((q) => q.code === code); const p = page(); if (!p.layout) return;
    const D = window.Director, mine = leaves(p.layout.rows);
    const wasFull = !!(D && D.fullBleed(p.layout.rows)) && !p.cover; // leaving a full-page picture: the panel gets its border back
    if (D && (mine.length > 1 || (mine.length === 1 && !p.cover))) { // sized to this page's weights when the layout has this page's number of panels
      const all = D.sorted(mine, T(), R, { avoid: neighbourShapes() }), hit = byWeight ? all[0] : all.find((x) => x.template.code === code);
      if (hit) t = { code: hit.template.code, name: hit.template.name, rows: hit.rows };
    }
    if (!t) return;
    mutateLayout(() => {
      const old = leaves(p.layout.rows);
      let i = 0;
      const build = (rows) => rows.map((r) => ({ h: r.h, ...(r.slant ? { slant: r.slant } : {}), ...(r.strip ? { strip: true } : {}), panels: r.panels.map((q) => {
        if (q.rows) return { w: q.w, rows: build(q.rows) };
        const o = old[i++] || {};
        const n = { w: q.w, type: q.type || (wasFull ? "framed" : o.type) || "framed" };
        if (q.slant) n.slant = q.slant;
        if (R.validShape(q.shape)) n.shape = q.shape.map((pt) => pt.slice()); // a shape belongs to the place in the layout, not to the panel that moves into it
        if (o.id) n.id = o.id;
        if (o.image) { n.image = o.image; if (o.focus) n.focus = o.focus; if (o.zoom) n.zoom = o.zoom; }
        for (const k of ["board", "take", "request", "inart"]) if (o[k] != null) n[k] = o[k]; // the panel's storyboard, its lines and a waiting request move with it
        return n;
      }) }));
      p.layout.rows = build(t.rows);
    });
    if (quiet) return t;
    selP = null; render(); snap();
    setStatus(`Layout ${t.code} applied. Art and balloons kept in reading order.`);
    return t;
  }

  function onUp() {
    if (drag && drag.moved) {
      if (drag.mode === "body") { const it = items()[drag.i]; if (it) assignPanel(page(), it); }
      snap();
    }
    drag = null;
  }
  const round3 = (v) => Math.round(v * 1000) / 1000;

  // ---------- inspector edits ----------
  function edit(fn, commit = true) {
    const it = items()[sel]; if (!it) return;
    fn(it); render(); if (commit) snap(); else liveEdit();
  }

  function addBalloon(kind) {
    const k = R.KINDS[kind];
    const it = { kind, speaker: "", text: kind === "ambient" ? "…" : kind === "sfx" ? "KRAK" : "New line", at: [0.5, 0.45] };
    if (kind === "sfx") { const q = selP && findPanel(selP), c = q && geomById(page()).get(selP), heard = q && q.panel.inart && q.panel.inart.sfx; // into the chosen panel, with the sound the storyboard names
      if (c) it.at = [round3((c.bbox[0] + c.bbox[2]) / 2 / W), round3((c.bbox[1] + c.bbox[3]) / 2 / H)]; if (heard) it.text = String(heard).slice(0, 40); }
    if (R.TAIL_KINDS.has(kind)) it.tail = [0.5, 0.53];
    if (k.width) it.width = k.width;
    items().push(it);
    assignPanel(page(), it);
    sel = items().length - 1;
    render(); snap();
    $("textIn").focus(); $("textIn").select();
  }

  // ---------- export ----------
  async function dataUrl(url) {
    const b = await (await fetch(url)).blob();
    return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
  }
  const FONT_FILES = { playpen: ["Playpen Sans", "PlaypenSans.ttf", "100 800"], bangers: ["Bangers", "Bangers.ttf", "400"], vollkorn: ["Vollkorn", "Vollkorn.ttf", "400 900"], patrick: ["Patrick Hand", "PatrickHand.ttf", "400"], comicneue: ["Comic Neue", "ComicNeue-Bold.ttf", "700"], kalam: ["Kalam", "Kalam-Bold.ttf", "700"] };
  /** One finished page (art + lettering) as a 2048 x 3072 PNG. */
  async function pageBlob(p, measured) {
    const used = new Set(measured.map((L) => L.fontKey)); used.add("vollkorn");
    let css = "";
    for (const k of used) { const [fam, file, wt] = FONT_FILES[k]; css += `@font-face{font-family:'${fam}';src:url(${await dataUrl("fonts/" + file)});font-weight:${wt};}`; }
    let artSvg;
    if (p.layout) {
      const map = {};
      const all = leaves(p.layout.rows).concat(p.layout.insets || []);
      for (const src of R.pictures(p)) if (!map[src]) map[src] = await dataUrl(BASE + src); // panel art (or the Toner's picture of it) and break-outs
      artSvg = R.layoutSvg(p, (s) => map[s], sizes());
    } else {
      artSvg = `<image href="${await dataUrl(BASE + R.pageArt(p))}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="2048" height="3072"><style>${css}</style>${artSvg}${R.letteringSvg(measured)}${R.pageNumberSvg(p)}</svg>`;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    await new Promise((r) => setTimeout(r, 150)); // let embedded fonts settle
    const c = document.createElement("canvas"); c.width = 2048; c.height = 3072;
    c.getContext("2d").drawImage(img, 0, 0, 2048, 3072);
    URL.revokeObjectURL(url);
    return await new Promise((res) => c.toBlob(res, "image/png"));
  }
  /** Export: one dialog for a page, some pages or the chapter, as a PDF, PNGs or JPEGs.
   *  The browser draws each page (so the file is what the editor shows), the server keeps the PNGs and builds the download. */
  const ex = { format: "pdf", size: "full", sets: false, paper: "b5", picked: new Set(), busy: false };
  const exLabel = (p, i) => (p.cover ? "Cover" : String(p.number != null ? p.number : i + 1));
  function exPaint() {
    for (const b of $("exFormat").children) b.setAttribute("aria-pressed", b.dataset.format === ex.format);
    for (const b of $("exSize").children) b.setAttribute("aria-pressed", b.dataset.size === ex.size);
    for (const b of $("exPaper").children) b.setAttribute("aria-pressed", b.dataset.paper === ex.paper);
    const n = ex.picked.size, rtl = spec.reading === "rtl";
    $("exFormatHint").textContent = ex.format === "pdf" ? `One file, pages in reading order${spec.pages.some((p) => p.cover) ? ", the cover first" : ""}. Made for reading on a screen${rtl ? "; it is marked to open right to left" : ""}.`
      : ex.format === "print" ? `For a printer: every page on a sheet with trim marks and 3 mm of bleed round the cut page${rtl ? ", marked to open right to left" : ""}. The whole page is fitted inside the bleed, so nothing is cut off; on B5 and A5 a full-page picture runs off the top and the foot and the sides stay paper. Ask your printer which paper they want before sending it.`
      : ex.format === "png" ? "The sharpest pictures and the biggest files. More than one page comes as a zip." : "Smaller files, good for posting. More than one page comes as a zip.";
    $("exSizeRow").hidden = ex.format === "print"; $("exPaperRow").hidden = ex.format !== "print"; $("exSetsRow").hidden = ex.format === "pdf" || ex.format === "print" || n < 2; $("exSets").checked = ex.sets;
    for (const b of $("exPages").children) b.setAttribute("aria-pressed", ex.picked.has(+b.dataset.i));
    $("exCount").textContent = `${n} of ${spec.pages.length}`;
    $("exGo").disabled = !n || ex.busy; if (!ex.busy) $("exGo").textContent = n === 1 ? "Export 1 page" : `Export ${n} pages`;
  }
  // ---------- Publish: the finished chapter goes to the person's reading site as a private draft (page-editor/publish.mjs).
  // Nothing is made public from here: the person reviews it on the site and publishes there. The key never reaches this screen.
  const pub = { books: [], busy: false, state: null, sent: null };
  const pubGet = async (path, opt) => { try { const r = await fetch(path, opt); const j = await r.json().catch(() => ({})); return Object.assign({ httpOk: r.ok, http: r.status }, j); } catch (e) { return { httpOk: false, http: 0, error: "Ibasho on this computer did not answer." }; } };
  const pubBook = () => pub.books.find((b) => String(b.id) === $("pubBook").value) || null;
  function pubPaint() {
    const st = pub.state || {}, has = !!st.key, ok = !!st.connected, n = spec.pages.length;
    $("pubSetState").textContent = !has ? "not set up yet" : ok ? "connected" : "not connected";
    $("pubKeyNow").textContent = has ? "saved: " + st.key : ""; $("pubKey").placeholder = has ? "Paste a new key to replace the saved one" : "Paste the key from the site (it starts with ibr_)";
    if (document.activeElement !== $("pubSite")) $("pubSite").value = st.site || "";
    $("pubKeysLink").href = st.keys_at || "#"; $("pubForget").hidden = !has; $("pubTest").hidden = !has;
    $("pubSetNote").textContent = st.last ? st.last.msg : has ? "" : "Paste your key, then Save and test.";
    $("pubForm").hidden = !ok;
    const b = pubBook(), num = parseInt($("pubNumber").value, 10), hit = b && (b.chapters || []).find((c) => c.number === num);
    $("pubBookNote").innerHTML = ok && !pub.books.length ? `You have no manga book on the site yet. <a href="${R.esc(st.new_manga_at || "#")}" target="_blank" rel="noopener">Create one on the site</a>, then press Test connection.` : b && b.published === false ? "This book is not public yet on the site." : "";
    $("pubNumberNote").textContent = !hit ? "" : hit.status === "draft" ? `Chapter ${num} is already on the site as a draft (${hit.pages} pages). Sending asks first, then replaces that draft.` : `Chapter ${num} is already ${hit.status} on the site and cannot be replaced from here. Pick another number, or change it on the site.`;
    $("pubThumb").max = String(n);
    $("pubCheck").textContent = n > 100 ? `This chapter has ${n} pages and the site takes 100 a chapter. Split it in two before sending.` : `All ${n} page${n === 1 ? "" : "s"} are drawn again as you see them now and sent in reading order, at most 2,000 px wide.`;
    const blocked = !ok || !b || !(num >= 1 && num <= 9999) || !$("pubTitle").value.trim() || n > 100 || (hit && hit.status !== "draft");
    $("pubGo").disabled = pub.busy || blocked; if (!pub.busy) $("pubGo").textContent = "Send as a draft";
    $("pubSave").disabled = $("pubTest").disabled = pub.busy;
  }
  async function pubLoad() {
    pub.state = await pubGet("/api/publish"); pub.books = [];
    if (pub.state.connected || pub.state.key) { const r = await pubGet("/api/publish/books"); if (r.ok) pub.books = r.books || []; pub.state = await pubGet("/api/publish"); }
    const was = $("pubBook").value, last = pub.sent && String(pub.sent.book);
    $("pubBook").innerHTML = pub.books.map((b) => `<option value="${R.esc(String(b.id))}">${R.esc((b.book_label ? b.book_label + " · " : "") + b.title)}</option>`).join("");
    if (pub.books.some((b) => String(b.id) === was)) $("pubBook").value = was; else if (pub.books.some((b) => String(b.id) === last)) $("pubBook").value = last;
    pubSuggest(); $("pubSet").open = !pub.state.connected; pubPaint();
  }
  /** The number to offer: the one this chapter went as last time, else one after the highest on the site, else this chapter's own. */
  function pubSuggest() { const b = pubBook(); if (!b || $("pubNumber").dataset.typed) return;
    const top = Math.max(0, ...(b.chapters || []).map((c) => +c.number || 0)); $("pubNumber").value = pub.sent && String(pub.sent.book) === String(b.id) ? pub.sent.number : top ? top + 1 : +spec.chapter || 1; pubTitleFollows(); }
  /** Until the person types a title of their own, it reads "Chapter N" for the number shown. */
  function pubTitleFollows() { const t = $("pubTitle"); if (!t.dataset.typed && !(pub.sent && t.value === pub.sent.title)) t.value = `Chapter ${$("pubNumber").value || spec.chapter || 1}`; }
  async function openPublish() {
    if (store.kind !== "local") return;
    $("pubResult").textContent = ""; $("pubOpen").hidden = true; $("pubGo").className = "btn primary"; $("pubKey").value = ""; delete $("pubNumber").dataset.typed; delete $("pubTitle").dataset.typed;
    pub.sent = await pubGet("/api/publish/sent?p=" + encodeURIComponent(proj.id)); if (!pub.sent || !pub.sent.book) pub.sent = null;
    $("pubTitle").value = pub.sent ? pub.sent.title : ""; $("pubThumb").value = "1"; $("pubNotes").value = "";
    const dlg = $("pubDlg"); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    pub.state = null; pubPaint(); await pubLoad();
    if (!$("pubTitle").value) pubTitleFollows();
    pubPaint();
  }
  async function pubSaveSettings() {
    const body = { site: $("pubSite").value.trim() }, key = $("pubKey").value.trim(); if (key) body.key = key;
    pub.busy = true; pubPaint(); $("pubSetNote").textContent = "Asking the site…";
    const r = await pubGet("/api/publish", { method: "POST", body: JSON.stringify(body) });
    pub.busy = false; $("pubKey").value = "";
    if (!r.httpOk) { $("pubSetNote").textContent = r.error || "That could not be saved."; pubPaint(); $("pubSetNote").textContent = r.error || "That could not be saved."; return; }
    await pubLoad();
  }
  async function runPublish(replace) {
    const b = pubBook(), n = spec.pages.length, go = $("pubGo"), num = parseInt($("pubNumber").value, 10); if (!b) return;
    const hit = (b.chapters || []).find((c) => c.number === num);
    if (hit && hit.status === "draft" && !replace) { if (!confirm(`Chapter ${num} is already on the site as a draft (${hit.pages} pages). Replace that draft with these ${n} pages?`)) return; replace = true; }
    pub.busy = true; pubPaint(); $("pubResult").textContent = ""; $("pubOpen").hidden = true;
    try {
      if (!(await saveNow()) && dirty) throw new Error("your changes could not be saved first. Press Save changes and try again");
      await fetch("/api/exports?p=" + encodeURIComponent(proj.id), { method: "DELETE" }); // only this chapter's pages, as they are now
      for (let i = 0; i < n; i++) { const p = spec.pages[i]; go.textContent = `Drawing page ${i + 1} of ${n}…`;
        const blob = await pageBlob(p, p.text.map((it) => R.measure(it, spec, measureText)));
        const r = await fetch(`/api/export?p=${encodeURIComponent(proj.id)}&name=page-${String(i + 1).padStart(2, "0")}.png`, { method: "POST", body: blob }); if (!r.ok) throw new Error("A page could not be saved on this computer."); }
      go.textContent = "Sending to the site…";
      const r = await pubGet("/api/publish/send?p=" + encodeURIComponent(proj.id), { method: "POST", body: JSON.stringify({ book: b.id, number: $("pubNumber").value.trim(), title: $("pubTitle").value.trim(), thumbnail_page: $("pubThumb").value, notes: $("pubNotes").value, replace: !!replace }) });
      pub.busy = false;
      if (r.httpOk && r.ok) {
        pub.sent = r.sent; $("pubResult").textContent = `${r.message} ${r.sent.pages} pages${r.sent.replaced ? ", in place of the draft that was there" : ""}.`;
        if (r.sent.review_url) { $("pubOpen").href = r.sent.review_url; $("pubOpen").hidden = false; $("pubGo").className = "btn"; } // the next thing to do is on the site
        setStatus("Sent to your reading site as a draft. It is not public until you publish it there.", "ok"); await pubLoad(); renderExports(); return;
      }
      if (r.code === "chapter_exists" && !replace) { pubPaint(); if (confirm((r.error || "A draft with this number is already on the site.") + " Replace the draft on the site?")) return runPublish(true); $("pubResult").textContent = "Not sent: the draft on the site was left as it is."; return; }
      $("pubResult").textContent = [r.error || "The chapter was not sent.", r.next || "", r.http === 401 || r.code === "no_key" ? "" : "Nothing was saved on the site, so sending again is safe."].filter(Boolean).join(" ");
      if (r.http === 401 || r.code === "book_not_found") await pubLoad();
    } catch (e) { pub.busy = false; $("pubResult").textContent = "The chapter was not sent: " + (e && e.message ? e.message : "something went wrong on this computer.") + " Nothing was saved on the site."; }
    pub.busy = false; pubPaint(); renderExports();
  }
  function openExport(only) {
    try { const m = JSON.parse(localStorage.getItem("ibasho-export") || "{}"); if (["pdf", "png", "jpeg", "print"].includes(m.format)) ex.format = m.format; if (["b5", "a5", "us"].includes(m.paper)) ex.paper = m.paper; if (m.size === "web" || m.size === "full") ex.size = m.size; ex.sets = !!m.sets; } catch (e) { /* no memory of the last choice */ }
    ex.picked = new Set(only != null ? [only] : spec.pages.map((_, i) => i));
    $("exDlgT").textContent = only != null ? "Export this page" : "Export the chapter";
    $("exPages").innerHTML = spec.pages.map((p, i) => `<button type="button" class="btn" data-i="${i}" title="${R.esc(p.label || "Page " + exLabel(p, i))}">${R.esc(exLabel(p, i))}</button>`).join("");
    exPaint(); const dlg = $("exDlg"); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  async function runExport() {
    const idx = [...ex.picked].sort((a, b) => a - b), whole = idx.length === spec.pages.length, go = $("exGo");
    try { localStorage.setItem("ibasho-export", JSON.stringify({ format: ex.format, size: ex.size, sets: ex.sets, paper: ex.paper })); } catch (e) { /* not kept */ }
    ex.busy = true; exPaint();
    try {
      go.textContent = "Saving your changes…";
      if (!(await saveNow()) && dirty) throw new Error("Your changes could not be saved, so nothing was exported. Press Save changes and try again.");
      if (whole) await fetch("/api/exports?p=" + encodeURIComponent(proj.id), { method: "DELETE" }); // pages left over from a longer storyboard go
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k], p = spec.pages[i];
        go.textContent = `Drawing page ${k + 1} of ${idx.length}…`;
        const blob = await pageBlob(p, p.text.map((it) => R.measure(it, spec, measureText)));
        const r = await fetch(`/api/export?p=${encodeURIComponent(proj.id)}&name=page-${String(i + 1).padStart(2, "0")}.png`, { method: "POST", body: blob });
        if (!r.ok) throw new Error("save");
      }
      go.textContent = "Making the file…";
      const q = new URLSearchParams({ p: proj.id, format: ex.format, size: ex.size, title: `${spec.project} · Chapter ${spec.chapter}` });
      if (!whole) q.set("pages", idx.map((i) => i + 1).join(","));
      if (spec.reading === "rtl") q.set("rtl", "1");
      if (ex.sets && ex.format !== "pdf" && ex.format !== "print" && idx.length > 1) q.set("sets", "20");
      if (ex.format === "print") q.set("paper", ex.paper);
      const r = await fetch("/api/export-file?" + q); if (!r.ok) throw new Error(await r.text());
      const name = (/filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "") || [])[1] || proj.id + "." + ex.format;
      const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      $("exDlg").close(); setStatus(`Exported ${idx.length} page${idx.length === 1 ? "" : "s"}: ${name}`, "ok");
    } catch (e) { setStatus("The export did not finish. Try again." + (e && e.message && e.message !== "save" && e.message.length < 160 ? " (" + e.message + ")" : ""), "error"); }
    ex.busy = false; exPaint();
    renderExports();
  }
  async function renderExports() {
    const box = $("exportsBox"); if (!box) return;
    box.hidden = true;
    if (store.kind !== "local") return;
    let list = []; try { list = await (await fetch("/api/exports?p=" + encodeURIComponent(proj.id))).json(); } catch (e) { return; }
    if (!list.length || mode !== "chapter") return;
    box.hidden = false;
    box.innerHTML = `<div class="chap-top"><div><h2>Exported pages</h2><p>${list.length} page${list.length === 1 ? "" : "s"}, last exported ${R.esc(new Date(Math.max(...list.map((f) => f.at))).toLocaleString())}. Tap one to open it. Export gives them as a PDF, PNGs or JPEGs.</p></div></div>` +
      `<p class="hint" id="exMoire" hidden></p>` +
      `<div class="exp-grid">${list.map((f) => `<a href="${R.esc(f.url)}" target="_blank" rel="noopener"><img src="${R.esc(f.url)}?t=${f.at}" alt="${R.esc(f.name)}" loading="lazy"><span>${R.esc(f.name)}</span></a>`).join("")}</div>`;
    if (bible && bible.colour) return; // screentone is a black-and-white matter
    // the measured moire test: every exported page is looked at for a second set of dots lying over the first
    const want = proj.id; let m = null; try { const r = await fetch("/api/exports/moire?p=" + encodeURIComponent(want)); if (r.ok) m = await r.json(); } catch (e) { return; }
    const note = $("exMoire"); if (!note || want !== proj.id || !Array.isArray(m) || !m.some((x) => x.tiles)) return; // nothing with dots was exported: nothing to say
    const bad = m.filter((x) => x.moire), no = (x) => +(/(\d+)/.exec(x.name) || [0, 0])[1];
    note.hidden = false; note.dataset.moire = bad.length ? "1" : "0";
    note.textContent = bad.length
      ? `Moire measured on ${bad.length === 1 ? "page" : "pages"} ${bad.map(no).join(", ")}: two sets of dots lie over each other there (${bad.map((x) => `page ${no(x)}: a pattern about every ${Math.round(x.every_px)} px`).join("; ")}). The usual causes: dots drawn into a picture under the Toner's (draw it again with flat greys), or pages toned with two sizes of dot (tone every page again).`
      : `Measured for moire: none found on ${m.filter((x) => x.tiles).length} page${m.filter((x) => x.tiles).length === 1 ? "" : "s"} with screentone.`;
  }
  async function exportPng() {
    const btn = $("exportBtn"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Exporting…";
    try {
      const p = page();
      const blob = await pageBlob(p, measured);
      const name = `${proj.id || "chapter"}-${p.id || "page-" + p.number}-lettered.png`;
      if (window.claude && typeof window.claude.use === "function") {
        const dl = await window.claude.use("downloads");
        if (dl) { await dl.save({ filename: name, data: blob }); setStatus("Exported " + name, "ok"); return; }
      }
      if (store.kind === "local") {
        const r = await fetch("/api/export?name=" + encodeURIComponent(name), { method: "POST", body: blob });
        setStatus(r.ok ? "Exported to exports/" + name : "Export failed", r.ok ? "ok" : "error"); return;
      }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    } catch (e) {
      setStatus("Export did not finish. Try again; if it keeps failing, tell Claude.", "error");
    } finally { btn.disabled = false; btn.textContent = label; }
  }

  // ---------- wire up ----------
  function wire() {
    const svg = $("page");
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    $("side").addEventListener("click", (e) => {
      if (sideDragged) return;
      const pn = e.target.closest("[data-pid]"), pg = e.target.closest("[data-page]");
      if (pn) { selP = pn.dataset.pid; sel = -1; if (mode !== "layout") mode = "art"; document.body.classList.remove("side-open"); $("sideBtn").setAttribute("aria-expanded", "false"); render(); return; }
      if (!pg) return;
      pageIdx = +pg.dataset.page; sel = -1; selP = null; if (mode === "chapter" || mode === "series" || mode === "check") mode = "letter";
      render();
    });
    $("sideBtn").addEventListener("click", () => { const on = document.body.classList.toggle("side-open"); $("sideBtn").setAttribute("aria-expanded", on); });
    $("genModel").addEventListener("click", async () => { const o = await window.Ibasho.pickModel("picture"); if (o) { picModel = { ...o, connected: true }; render(); } });
    $("genQuality").addEventListener("click", async (e) => { const b = e.target.closest("[data-q]"); if (!b || !picModel) return;
      try { picModel = { ...picModel, ...(await window.Ibasho.setQuality("picture", picModel, b.dataset.q)) }; } catch (err) { setStatus(err.message, "error"); } render(); });
    $("genModes").addEventListener("click", (e) => { const b = e.target.closest("[data-gm]"); if (!b || !selP) return; draftFor(selP).mode = b.dataset.gm; renderArtPanel(); });
    $("genPrompt").addEventListener("input", (e) => { if (!selP) return; const d = draftFor(selP); d[d.mode === "artist" ? "artist" : "custom"] = e.target.value; renderArtPanel(); });
    $("genReset").addEventListener("click", () => { if (!selP) return; const a = aiPrompt(selP); if (a) { draftFor(selP).artist = a.prompt; $("genPrompt").value = a.prompt; renderArtPanel(); } });
    $("genKeep").addEventListener("change", (e) => { if (selP) { draftFor(selP).keepStyle = e.target.checked; renderArtPanel(); } });
    $("genBtn").addEventListener("click", () => sendRequest());
    for (const [id, key] of [["artSfx", "sfx"], ["artWriting", "writing"]]) $(id).addEventListener("change", (e) => {
      const f = selP && findPanel(selP); if (!f) return; const ia = Object.assign({}, f.panel.inart), v = e.target.value.replace(/["\n]/g, " ").trim();
      if (v) ia[key] = v; else delete ia[key];
      if (Object.keys(ia).length) f.panel.inart = ia; else delete f.panel.inart;
      delete drafts[selP]; snap(); renderArtPanel();
    });
    $("artReview").addEventListener("click", (e) => { if (!e.target.closest("#artReviewOk") || !selP) return; const f = findPanel(selP); if (!f) return; f.panel.reviewOk = f.panel.image; snap(); renderArtPanel(); });
    $("genRetry").addEventListener("click", () => { if (selP) { delete jobs[selP]; renderArtPanel(); startJobs([selP]); } });
    $("refAdd").addEventListener("toggle", () => renderArtPanel());
    $("tagChips").addEventListener("click", (e) => { const b = e.target.closest("[data-tag]"); if (!b) return; const i = b.dataset.tag.indexOf("|"); toggleTag(b.dataset.tag.slice(0, i), b.dataset.tag.slice(i + 1)); });
    $("refTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-rt]"); if (!b) return; refTab = b.dataset.rt; refPick = null; renderArtPanel(); });
    $("refList").addEventListener("click", (e) => { const b = e.target.closest("[data-rdel]"); if (!b || !selP) return; const d = draftFor(selP); d.refs.splice(+b.dataset.rdel, 1); d.refsTouched = true; renderArtPanel(); });
    $("refList").addEventListener("input", (e) => { const i = e.target.dataset.rnote; if (i == null || !selP) return; const d = draftFor(selP); d.refs[+i].note = e.target.value; d.refsTouched = true; });
    $("artFacesWrap").addEventListener("click", (e) => {
      const f = findPanel(selP); if (!f || !f.panel.image) return;
      if (e.target.closest("#markCancel")) { marking = null; render(); return; }
      const m = e.target.closest("[data-mark]"), u = e.target.closest("[data-unmark]");
      if (m) { marking = marking && marking.who === m.dataset.mark ? null : { pid: selP, who: m.dataset.mark }; render(); if (marking) { setStatus(`Tap ${marking.who}'s face in the panel on the page.`); $("page").scrollIntoView({ block: "nearest", behavior: "smooth" }); } return; }
      if (u) { setFace(f.panel, u.dataset.unmark, null); return; }
    });
    $("lookBtn").addEventListener("click", async () => {
      if (!selP) return;
      if (dirty && saveTimer) { clearTimeout(saveTimer); await save(); }
      try { await fetch(`/api/faces/look?p=${encodeURIComponent(proj.id)}&panel=${encodeURIComponent(selP)}`, { method: "POST" }); } catch (e) { setStatus("Could not start. Check the connection and try again.", "error"); return; }
      setStatus("Codex is looking at the picture for the missing faces. Nothing is redrawn."); pollJobs();
    });
    $("markOther").addEventListener("change", (e) => { const who = e.target.value; if (!who || !selP) return; marking = { pid: selP, who }; render(); setStatus(`Tap ${who}'s face in the panel on the page.`); $("page").scrollIntoView({ block: "nearest", behavior: "smooth" }); });
    $("artFaces").addEventListener("click", (e) => {
      const b = e.target.closest("[data-bsave]"), f = findPanel(selP); if (!b || !f || !f.panel.image) return;
      const who = b.dataset.bsave, face = (lib()[f.panel.image].protect || []).find((x) => x.who === who), was = bankSaved(who);
      spec.bank = (spec.bank || []).filter((x) => x.name !== who);
      const off = was && was.src === f.panel.image;
      if (!off) spec.bank.push({ name: who, src: f.panel.image, box: cropAround(face.box) });
      render(); snap();
      setStatus(off ? `${who} removed from the character bank. Undo puts them back.` : `${who} saved. The Artist now sends this picture whenever it draws ${who}.`, off ? "" : "ok");
    });
    $("refPane").addEventListener("click", (e) => {
      const bank = e.target.closest("[data-rbank]"), src = e.target.closest("[data-rsrc]"), face = e.target.closest("[data-rface]");
      const sv = e.target.closest("[data-rsaved]");
      if (sv) addRef(savedRef(spec.bank[+sv.dataset.rsaved]));
      else if (bank) addRef(bankRef(bank.dataset.rbank));
      else if (src) { refPick = src.dataset.rsrc; renderArtPanel(); }
      else if (face && refPick) {
        const it = lib()[refPick], f = +face.dataset.rface >= 0 ? it.protect[+face.dataset.rface] : null;
        if (!f) { addRef({ type: "panel", src: refPick, note: "an earlier panel of this chapter: match its drawing style and the place" }); return; }
        addRef({ type: "panel", src: refPick, who: f.who, box: cropAround(f.box),
          note: `${f.who} as already drawn in this chapter: match the face, hair and clothes` });
      }
    });
    $("refPane").addEventListener("change", async (e) => {
      if (e.target.id !== "refFile" || !e.target.files[0]) return;
      setStatus("Adding the picture…");
      try { addRef(await addUpload(e.target.files[0])); setStatus("Reference added.", "ok"); }
      catch (err) { setStatus("That picture could not be added. Try a JPEG or PNG.", "error"); }
    });
    $("pgMissing").addEventListener("click", () => queuePage("missing"));
    $("pgAll").addEventListener("click", () => queuePage("all"));
    wireSideDrag();
    $("genCancel").addEventListener("click", () => {
      const f = findPanel(selP); if (!f || !f.panel.request) return;
      const r = f.panel.request; drafts[selP] = { source: r.source, mode: r.mode, artist: r.mode === "artist" ? promptText(r) : ((aiPrompt(selP) || {}).prompt || ""), custom: r.own || "", keepStyle: !!r.keepStyle,
        refs: JSON.parse(JSON.stringify(r.refList || (r.refs || []).map(bankRef))), refsTouched: true,
        tagsOnly: (r.tags || []).filter((k) => !(r.refList || []).some((x) => refTagKey(x) === k)).map((k) => { const i = k.indexOf("|"); return { kind: k.slice(0, i), name: k.slice(i + 1) }; }) };
      delete f.panel.request; render(); snap(); setStatus("Request cancelled.");
      if (canDraw()) { const pid = selP; fetch(`/api/generate?p=${encodeURIComponent(proj.id)}&panel=${encodeURIComponent(pid)}`, { method: "DELETE" }).then(async (r) => { // the request is kept with the job on the server: take it out of the line there too
        if (r.status === 409) setStatus("That picture is being drawn right now and cannot be stopped. It will land; you can ask for another after it.", "warn"); else delete jobs[pid]; }).catch(() => { /* offline: the job runs */ }); }
    });
    $("projSel").addEventListener("change", (e) => { loadProject(e.target.value).catch(() => setStatus("That project could not load.", "error")); });
    $("chapterGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (!b) return; pageIdx = +b.dataset.open; mode = "letter"; sel = -1; selP = null; render(); window.scrollTo(0, 0); });
    $("coverBtn").addEventListener("click", async () => {
      let info = {}; try { info = await (await fetch("/api/project?p=" + encodeURIComponent(proj.id))).json(); } catch (e) { return; }
      const main = bible ? Object.keys(bible.cast).filter(inChapter).slice(0, 2) : [], has = info.cover;
      const start = has ? has.action : `Cover illustration, one striking full-page picture${main.length ? ` of ${main.join(" and ")}` : ""}. Leave calm, open space across the top third for the title. No lettering in the picture.`;
      const action = prompt(`What should the cover show? You can change the wording again in Art before drawing.${has ? " Clear the box to remove the cover." : ""}`, start);
      if (action == null) return;
      let title = ""; if (action.trim()) { title = prompt("Title lettered on the cover (leave empty for none):", has ? has.title : info.title || `${info.name || spec.project} · Chapter ${info.chapter || spec.chapter}`); if (title == null) return; }
      if (dirty) { clearTimeout(saveTimer); await save(); }
      const r = await fetch("/api/cover?p=" + encodeURIComponent(proj.id), { method: "PUT", body: JSON.stringify({ action, title }) });
      if (!r.ok) { setStatus("The cover could not be changed.", "error"); return; }
      await loadProject(proj.id); mode = "chapter"; render();
      setStatus(action.trim() ? "The cover is the first page. Open it in Art to draw it; the Letterer places the title." : "The cover is removed.", "ok");
    });
    $("reboardBtn").addEventListener("click", async () => {
      const dlg = $("sbDlg"), drawn = spec.pages.reduce((n, p) => n + (p.layout ? leaves(p.layout.rows).filter((q) => q.image).length : 0), 0), lettered = spec.pages.reduce((n, p) => n + p.text.length, 0);
      let info = {}; try { info = await (await fetch("/api/project?p=" + encodeURIComponent(proj.id))).json(); } catch (e) { /* offline */ }
      $("sbNote").value = info.note || "";
      $("sbDlgT").textContent = spec.boardAt ? "Storyboard this chapter again" : "Storyboard this chapter"; $("sbGo").textContent = spec.boardAt ? "Storyboard again" : "Storyboard it";
      $("sbWarn").textContent = "The new storyboard replaces these pages. " + (drawn ? `The ${drawn} picture${drawn === 1 ? "" : "s"} already drawn leave${drawn === 1 ? "s" : ""} the pages (kept in the art list, usable as references); the new panels are drawn again. ` : "") +
        (lettered ? "Balloons you placed or moved by hand are not carried over. " : "") + "The old storyboard is kept in the project's history folder.";
      if (!spec.boardAt) $("sbWarn").textContent = (homeList.find((q) => q.id === proj.id) || {}).series ? "The Paneler adapts the book's text section by section and adds nothing: every balloon is checked word for word against its numbered paragraph. About 6 minutes for every 1,500 words." : "The Paneler reads the script and lays out the pages.";
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    });
    $("sbChips").addEventListener("click", (e) => { const b = e.target.closest("[data-chip]"); if (!b) return; const ta = $("sbNote"); if (!ta.value.includes(b.dataset.chip)) ta.value = (ta.value.trim() ? ta.value.trim() + " " : "") + b.dataset.chip; });
    $("sbDlgX").addEventListener("click", () => $("sbDlg").close()); $("sbCancel").addEventListener("click", () => $("sbDlg").close());
    $("sbDlg").addEventListener("click", (e) => { if (e.target === $("sbDlg")) $("sbDlg").close(); });
    $("sbGo").addEventListener("click", async () => {
      if (!(await okToWrite())) return;
      if (dirty && saveTimer) { clearTimeout(saveTimer); await save(); }
      try { const r = await fetch("/api/storyboard?p=" + encodeURIComponent(proj.id), { method: "POST", body: JSON.stringify({ note: $("sbNote").value }) }); if (!r.ok) throw new Error(); }
      catch (e) { setStatus("The Paneler could not be started. Check the connection and try again.", "error"); return; }
      $("sbDlg").close(); mode = "home"; sel = -1; selP = null; render();
      setStatus("The Paneler is storyboarding the chapter again. Open the project when its card says it is done.", "ok");
    });
    $("letterAllBtn").addEventListener("click", () => {
      let n = 0;
      for (let i = 0; i < spec.pages.length; i++) {
        const p = spec.pages[i]; if (!p.layout || !R.planFor(p).length) continue;
        const keep = pageIdx; pageIdx = i; p.text = R.autoPlace(p, spec, lib(), measureText); pageIdx = keep; n += p.text.length;
      }
      render(); snap();
      setStatus(`Letterer placed ${n} balloons across the chapter. Undo takes them all back.`, "ok");
    });
    wireCheck();
    $("modeTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (!b) return; mode = b.dataset.mode; sel = -1; selP = null; render(); });
    $("pbg").addEventListener("click", (e) => { const b = e.target.closest("[data-pbg]"); if (!b || !selP) return; const pid = selP, old = aiPrompt(pid);
      editPanel((q) => { q.board = q.board || {}; q.board.bg = b.dataset.pbg; });
      const d = drafts[pid], now = aiPrompt(pid); if (d && old && now && d.artist === old.prompt) d.artist = now.prompt; // an untouched Artist prompt follows the change
      if (mode === "art") renderArtPanel(); });
    const panelField = (fn) => { if (!selP) return; const pid = selP, old = aiPrompt(pid); editPanel((q) => { q.board = q.board || {}; fn(q.board); });
      const d = drafts[pid], now = aiPrompt(pid); if (d && old && now && d.artist === old.prompt) d.artist = now.prompt; }; // an untouched Artist prompt follows the change
    $("pjob").addEventListener("change", (e) => panelField((b) => { if (e.target.value) b.job = e.target.value; else delete b.job; }));
    $("pweight").addEventListener("click", (e) => { const s = e.target.closest("[data-pw]"); if (s) panelField((b) => { b.weight = +s.dataset.pw; }); });
    $("pface").addEventListener("change", (e) => panelField((b) => { if (e.target.checked) b.face = "big"; else delete b.face; }));
    $("ptension").addEventListener("change", (e) => panelField((b) => { const D = window.Director; if (e.target.value && D && D.TENSION && D.TENSION[e.target.value]) b.tension = e.target.value; else delete b.tension; }));
    $("preveal").addEventListener("change", (e) => panelField((b) => { if (e.target.checked) b.reveal = true; else delete b.reveal; }));
    $("tmplPick").addEventListener("click", () => applyTemplate("", true));
    $("psplash").addEventListener("change", (e) => { if (!selP) return; const pid = selP, old = aiPrompt(pid), on = e.target.checked;
      editPanel((q) => { q.board = q.board || {}; if (on) q.board.splash = true; else delete q.board.splash; });
      const d = drafts[pid], now = aiPrompt(pid); if (d && old && now && d.artist === old.prompt) d.artist = now.prompt; });
    $("ptypes").addEventListener("click", (e) => { const b = e.target.closest("[data-ptype]"); if (!b) return; editPanel((q) => { q.type = b.dataset.ptype; }); });
    $("pshapes").addEventListener("click", (e) => { const b = e.target.closest("[data-pshape]"); if (!b) return; const k = b.dataset.pshape; selV = -1;
      editPanel((q) => { if (k && R.SHAPES[k]) q.shape = R.SHAPES[k].make(); else delete q.shape; }); if (!k) shaping = false; render();
      setStatus(k ? `${R.SHAPES[k].label} shape. Press Edit corners to change it by hand.` : "Back to the plain panel.", "ok"); });
    $("shapeEdit").addEventListener("click", () => { shaping = !shaping; selV = -1; render(); });
    $("shapeDel").addEventListener("click", () => { const k = selV; selV = -1; editPanel((q) => { if (R.validShape(q.shape) && q.shape.length > 3 && q.shape[k]) q.shape.splice(k, 1); }); });
    $("freeBtn").addEventListener("click", () => { if (placing) return finishFree(); const p = page(); if (!p.layout) return; placing = []; selP = null; selB = null; shaping = false; render(); setStatus("Tap the page to place each corner of the new panel, going round its edge. Tap the first corner again, or press Done, to close it."); });
    $("freeCancel").addEventListener("click", () => { placing = null; render(); setStatus("No panel added."); });
    $("zoomIn").addEventListener("input", (e) => editPanel((q) => { q.zoom = +e.target.value; }, false));
    $("zoomIn").addEventListener("change", () => snap());
    $("tray").addEventListener("click", (e) => {
      const b = e.target.closest("[data-src]"); if (!b) return;
      if (!selP) { setStatus("Tap a panel first, then pick its art."); return; }
      editPanel((q) => { q.image = b.dataset.src; delete q.focus; delete q.zoom; });
    });
    $("splitBtn").addEventListener("click", () => editPanel((q, L, f) => {
      if (f.inset) return;
      const row = f.rows[f.r]; q.w = round3((q.w || 1) / 2);
      row.panels.splice(f.k + 1, 0, { w: q.w, type: q.type || "framed", id: newId() });
    }));
    $("rowBtn").addEventListener("click", () => editPanel((q, L, f) => {
      if (f.inset) return;
      const n = { w: 1, type: q.type || "framed", id: newId() };
      if (f.rows[f.r].panels.length === 1) {
        const row = f.rows[f.r]; row.h = round3(row.h / 2);
        f.rows.splice(f.r + 1, 0, { h: row.h, panels: [n] });
      } else {
        // stack inside this panel: it becomes a column holding two rows; its art (and balloons) move to the top one
        const child = { w: 1, type: q.type || "framed", id: q.id };
        for (const key of ["image", "focus", "zoom"]) if (q[key] != null) { child[key] = q[key]; delete q[key]; }
        q.id = newId(); delete q.type;
        q.rows = [{ h: 1, panels: [child] }, { h: 1, panels: [n] }];
      }
      selP = n.id;
    }));
    $("pdelBtn").addEventListener("click", () => editPanel((q, L, f) => {
      if (f.inset) { L.insets.splice(f.i, 1); selP = null; return; }
      if (leaves(L.rows).length === 1) { setStatus("A page needs at least one panel."); return; }
      const row = f.rows[f.r];
      row.panels.splice(f.k, 1);
      if (!row.panels.length) f.rows.splice(f.r, 1);
      // a column left with one panel folds back into an ordinary panel
      if (f.path.length) {
        const parent = rowsAt(f.path.slice(0, -2))[f.path[f.path.length - 2]].panels[f.path[f.path.length - 1]];
        const rest = leaves(parent.rows);
        if (parent.rows.length === 1 && parent.rows[0].panels.length === 1 && !parent.rows[0].panels[0].rows) {
          const only = parent.rows[0].panels[0], w = parent.w, slant = parent.slant;
          for (const key of Object.keys(parent)) delete parent[key];
          Object.assign(parent, only, { w }); if (slant) parent.slant = slant;
        } else if (!rest.length) { /* nothing left: remove handled above */ }
      }
      selP = null;
    }));
    $("tonePage").addEventListener("click", () => tonePages([page()]));
    $("toneWholeBtn").addEventListener("click", () => tonePages([page()]));
    $("toneSet").addEventListener("change", (e) => saveToneSet(e.target.value));
    $("toneOne").addEventListener("click", () => tonePages([page()], selP));
    $("toneAllBtn").addEventListener("click", () => tonePages(spec.pages));
    $("toneHand").addEventListener("click", openToneHand);
    $("toneTools").addEventListener("click", (e) => { const b = e.target.closest("[data-tool]"); if (b) { TH.tool = b.dataset.tool; thPaint(); } });
    $("toneSize").addEventListener("input", thPaint);
    $("toneUndo").addEventListener("click", () => { TH.strokes.pop(); TH.shown = Math.min(TH.shown, TH.strokes.length); TH.dirty = true; thPaint(); $("toneNote").textContent = "Undone. Press Save to see the picture without it."; });
    $("toneClear").addEventListener("click", () => { TH.strokes = []; TH.shown = 0; TH.dirty = true; thPaint(); $("toneNote").textContent = "Every stroke is off. Press Save for the tone as the Toner made it."; });
    $("toneSave").addEventListener("click", saveToneHand);
    $("toneDlgX").addEventListener("click", () => { if (!TH.dirty || confirm("Close without saving these strokes?")) $("toneDlg").close(); });
    { const cv = $("toneCanvas"), at = (e) => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * TH.size[0] * 10) / 10, Math.round((e.clientY - r.top) / r.height * TH.size[1] * 10) / 10]; };
      cv.addEventListener("pointerdown", (e) => { if (TH.saving) return; cv.setPointerCapture(e.pointerId); TH.cur = { tool: TH.tool, size: +$("toneSize").value, points: [at(e)] }; thPaint(); e.preventDefault(); });
      cv.addEventListener("pointermove", (e) => { if (!TH.cur) return; const q = at(e), l = TH.cur.points[TH.cur.points.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 6 && TH.cur.points.length < 2000) { TH.cur.points.push(q); thPaint(); } });
      const end = () => { if (!TH.cur) return; if (TH.strokes.length < 400) { TH.strokes.push(TH.cur); TH.dirty = true; } TH.cur = null; thPaint(); };
      cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end); }
    $("boBtn").addEventListener("click", addBreakout);
    $("boDraw").addEventListener("click", () => { const b = findBo(selB); if (b) drawBo(b); });
    $("boEdit").addEventListener("click", () => { const b = findBo(selB); if (!b || !boWords(b)) return; render(); snap(); setStatus("Changed. Press Draw it again for a new picture.", "ok"); });
    $("boFlip").addEventListener("click", () => { const b = findBo(selB); if (!b) return; if (b.flip) delete b.flip; else b.flip = true; render(); snap(); });
    $("boRemove").addEventListener("click", () => { const p = page(), b = findBo(selB); if (!b) return; p.layout.breakouts = p.layout.breakouts.filter((x) => x !== b); if (!p.layout.breakouts.length) delete p.layout.breakouts; selB = null; render(); snap(); setStatus("The break-out is removed. Undo brings it back.", "ok"); });
    $("insetBtn").addEventListener("click", () => {
      const p = page(); if (!p.layout) return;
      const n = { id: newId(), box: [0.56, 0.07, 0.92, 0.3], type: "framed" };
      mutateLayout(() => { (p.layout.insets = p.layout.insets || []).push(n); });
      selP = n.id; render(); snap();
      setStatus("Inset added. Drag its corner dots to move and resize it, then pick its art.");
    });
    $("anchorChk").addEventListener("change", (e) => edit((it) => { if (e.target.checked) { delete it.free; assignPanel(page(), it); } else { it.free = true; delete it.panel; } }));
    $("tmplDetails").addEventListener("toggle", () => renderLayoutPanel());
    $("tmplFilters").addEventListener("click", (e) => { const b = e.target.closest("[data-tf]"); if (!b) return; tmplFilter = b.dataset.tf; renderLayoutPanel(); });
    $("tmplGrid").addEventListener("click", (e) => { const x = e.target.closest("[data-tmpl-del]"); if (x) return removeOwnLayout(x.dataset.tmplDel); const b = e.target.closest("[data-tmpl]"); if (!b) return; applyTemplate(b.dataset.tmpl); });
    $("tmplSave").addEventListener("click", saveOwnLayout);
    $("kindGrid").addEventListener("click", (e) => {
      const b = e.target.closest("[data-kind]"); if (!b) return;
      edit((it) => {
        it.kind = b.dataset.kind;
        if (R.TAIL_KINDS.has(it.kind) && !it.tail && !it.join) it.tail = [it.at[0], Math.min(1, it.at[1] + 0.06)];
        delete it.width;
      });
    });
    $("textIn").addEventListener("input", (e) => edit((it) => { it.text = e.target.value; }, false));
    $("textIn").addEventListener("change", () => snap());
    $("speakerIn").addEventListener("change", (e) => edit((it) => { it.speaker = e.target.value.trim(); }));
    $("fontSel").addEventListener("change", (e) => edit((it) => { if (e.target.value) it.font = e.target.value; else delete it.font; }));
    $("sizeIn").addEventListener("input", (e) => edit((it) => { it.size = +e.target.value; }, false));
    $("sizeIn").addEventListener("change", () => snap());
    $("widthIn").addEventListener("input", (e) => edit((it) => { it.width = +e.target.value; }, false));
    $("widthIn").addEventListener("change", () => snap());
    $("rotIn").addEventListener("input", (e) => edit((it) => { it.rotate = +e.target.value; }, false));
    $("rotIn").addEventListener("change", () => snap());
    $("tailChk").addEventListener("change", (e) => edit((it) => { if (e.target.checked) it.tail = [it.at[0], Math.min(1, it.at[1] + 0.06)]; else delete it.tail; }));
    $("joinChk").addEventListener("change", (e) => edit((it) => { if (e.target.checked) it.join = true; else delete it.join; }));
    $("bleedChk").addEventListener("change", (e) => edit((it) => { if (e.target.checked) it.bleed = true; else { delete it.bleed; delete it.bridge; } }));
    $("hollowChk").addEventListener("change", (e) => edit((it) => { if (e.target.checked) it.hollow = true; else delete it.hollow; }));
    $("bridgeChk").addEventListener("change", (e) => { edit((it) => {
      if (!e.target.checked) { delete it.bridge; return; }
      const spot = R.bridgeSpot(page(), it); if (!spot) return;
      const dx = spot[0] / W - it.at[0], dy = spot[1] / H - it.at[1]; it.at = [round3(spot[0] / W), round3(spot[1] / H)]; if (it.tail) it.tail = [round3(clamp01(it.tail[0] + dx * 0.4)), round3(clamp01(it.tail[1] + dy * 0.4))]; // the tail still points at the speaker
      it.bridge = true; it.bleed = true;
    }); if (e.target.checked) setStatus("The balloon sits on the border to the next panel. Drag it along the border to place it.", "ok"); }); // said after the edit, or "Saving…" would replace it
    $("voiceBtn").addEventListener("click", () => {
      const it = items()[sel]; if (!it || !it.speaker) return;
      spec.voices = spec.voices || {};
      const v = {};
      if (it.font) v.font = it.font;
      if (it.size != null && it.size !== 1) v.size = it.size;
      spec.voices[it.speaker] = v;
      for (const p of spec.pages) for (const t of p.text) if (t.speaker === it.speaker) { delete t.font; delete t.size; }
      render(); snap();
    });
    $("dupBtn").addEventListener("click", () => {
      const it = items()[sel]; if (!it) return;
      const c = JSON.parse(JSON.stringify(it));
      c.at = [Math.min(0.95, c.at[0] + 0.04), Math.min(0.95, c.at[1] + 0.04)];
      if (c.tail) c.tail = [Math.min(1, c.tail[0] + 0.04), Math.min(1, c.tail[1] + 0.04)];
      items().splice(sel + 1, 0, c); sel += 1; render(); snap();
    });
    $("delBtn").addEventListener("click", () => { if (sel < 0) return; items().splice(sel, 1); sel = -1; render(); snap(); setStatus("Deleted. Undo brings it back."); });
    $("autoBtn").addEventListener("click", () => {
      const p = page(); if (!p.layout || !R.planFor(p).length) return;
      p.text = R.autoPlace(p, spec, lib(), measureText);
      sel = -1; render(); snap();
      setStatus(`Letterer placed ${p.text.length} balloons. Drag anything you want to change; Undo puts the old ones back.`, "ok");
    });
    $("addMenu").addEventListener("click", (e) => { const b = e.target.closest("[data-add]"); if (!b) return; $("addDetails").open = false; addBalloon(b.dataset.add); });
    $("addMenu").innerHTML = Object.entries(R.KINDS).map(([k, v]) => `<button type="button" data-add="${k}">${kindIcon(k)}<span><b>${v.label}</b><small>${R.esc(v.hint)}</small></span></button>`).join("");
    $("undoBtn").addEventListener("click", undo);
    $("redoBtn").addEventListener("click", redoFn);
    $("saveBtn").addEventListener("click", async () => { const ok = await saveNow(); if (ok) setStatus("Saved. Your changes are on this computer.", "ok"); else if (dirty && !saveConflict) setStatus("Could not save. Your edits are still here; press Save changes to try again.", "error"); });
    window.addEventListener("beforeunload", (e) => { if (dirty || saving) { save(); e.preventDefault(); e.returnValue = ""; } }); // a reload or closing the tab with unsaved changes asks first
    document.addEventListener("visibilitychange", () => { if (document.hidden && dirty && store.kind !== "none") { clearTimeout(saveTimer); save(); } }); // a phone switching apps saves before the tab can be dropped
    $("guidesChk").addEventListener("change", (e) => { guides = e.target.checked; render(); });
    $("exportBtn").addEventListener("click", () => (store.kind === "local" && proj && proj.id ? openExport(mode === "chapter" ? undefined : pageIdx) : exportPng())); // away from the app's own server there is one PNG, as before
    $("exportAllBtn").addEventListener("click", () => openExport());
    $("publishBtn").addEventListener("click", () => openPublish());
    $("pubCancel").addEventListener("click", () => { if (!pub.busy) $("pubDlg").close(); });
    $("pubDlg").addEventListener("cancel", (e) => { if (pub.busy) e.preventDefault(); });
    $("pubSave").addEventListener("click", pubSaveSettings);
    $("pubTest").addEventListener("click", async () => { pub.busy = true; pubPaint(); $("pubSetNote").textContent = "Asking the site…"; await pubGet("/api/publish/test", { method: "POST" }); pub.busy = false; await pubLoad(); });
    $("pubForget").addEventListener("click", async () => { if (!confirm("Forget the publishing key on this computer? The key itself still works until you cancel it on the site.")) return; await pubGet("/api/publish", { method: "DELETE" }); await pubLoad(); });
    $("pubBook").addEventListener("change", () => { pubSuggest(); pubPaint(); });
    $("pubNumber").addEventListener("input", () => { $("pubNumber").dataset.typed = "1"; pubTitleFollows(); pubPaint(); });
    $("pubTitle").addEventListener("input", () => { $("pubTitle").dataset.typed = "1"; pubPaint(); });
    $("pubGo").addEventListener("click", () => runPublish(false));
    $("exFormat").addEventListener("click", (e) => { const b = e.target.closest("[data-format]"); if (b) { ex.format = b.dataset.format; exPaint(); } });
    $("exPaper").addEventListener("click", (e) => { const b = e.target.closest("[data-paper]"); if (b) { ex.paper = b.dataset.paper; exPaint(); } });
    $("exSize").addEventListener("click", (e) => { const b = e.target.closest("[data-size]"); if (b) { ex.size = b.dataset.size; exPaint(); } });
    $("exPages").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (!b) return; const i = +b.dataset.i; if (ex.picked.has(i)) ex.picked.delete(i); else ex.picked.add(i); exPaint(); });
    $("exAll").addEventListener("click", () => { ex.picked = new Set(spec.pages.map((_, i) => i)); exPaint(); });
    $("exNone").addEventListener("click", () => { ex.picked = new Set(); exPaint(); });
    $("exSets").addEventListener("change", (e) => { ex.sets = e.target.checked; });
    $("exGo").addEventListener("click", runExport);
    $("exDlgX").addEventListener("click", () => $("exDlg").close()); $("exCancel").addEventListener("click", () => $("exDlg").close());
    $("exDlg").addEventListener("click", (e) => { if (e.target === $("exDlg") && !ex.busy) $("exDlg").close(); });
    $("drawAllBtn").addEventListener("click", () => { const n = missingCount(); if (n > 12 && !confirm(`Draw ${n} pictures? That is about ${Math.round(n * 1.5)} minutes of drawing on your Codex plan.`)) return; drawChapter(); });
    $("checks").addEventListener("click", (e) => { const b = e.target.closest("[data-sel]"); if (!b) return; const i = +b.dataset.sel; if (i >= 0) { sel = i; render(); } });
    const reset = $("resetBtn");
    reset.addEventListener("click", () => {
      if (reset.dataset.armed) {
        delete reset.dataset.armed; reset.textContent = "Reset this page";
        const id = page().id, o = original.pages.find((q) => q.id === id);
        if (o) spec.pages[pageIdx] = JSON.parse(JSON.stringify(o));
        sel = -1; selP = null; render(); snap();
        setStatus("Page reset. Undo brings your edits back.");
      } else {
        reset.dataset.armed = "1"; reset.textContent = "Tap again to reset";
        setTimeout(() => { if (reset.dataset.armed) { delete reset.dataset.armed; reset.textContent = "Reset this page"; } }, 3000);
      }
    });
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); $("saveBtn").click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redoFn() : undo(); }
      else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && mode !== "home" && mode !== "book" && "lyachs".includes(e.key.toLowerCase()) && e.key.length === 1) { // tools: L Y A C H S
        const b = document.querySelector(`#modeTabs [data-mode="${{ l: "letter", y: "layout", a: "art", c: "check", h: "chapter", s: "series" }[e.key.toLowerCase()]}"]`);
        if (b && !b.hidden) { e.preventDefault(); b.click(); }
      }
      else if (!typing && (e.key === "Delete" || e.key === "Backspace") && sel >= 0) { e.preventDefault(); $("delBtn").click(); }
      else if (!typing && sel >= 0 && e.key.startsWith("Arrow")) {
        e.preventDefault(); const d = e.shiftKey ? 0.02 : 0.004;
        edit((it) => { const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0; it.at = [round3(it.at[0] + dx), round3(it.at[1] + dy)]; });
      }
    });
  }

  // Reloading the page keeps you in the project you had open in this tab; a fresh visit starts at Home.
  function inProject(on) { try { if (on) sessionStorage.setItem("ibasho-open", "1"); else sessionStorage.removeItem("ibasho-open"); } catch (e) { /* no storage */ } }
  async function openProject(id, go) { // from Home: open a project, at one step of its flow when asked
    await loadProject(id);
    if (go === "chapter" && spec.kind === "storyboard") mode = "chapter";
    else if (go === "series" && bible && store.kind === "local") mode = "series";
    else if (go === "art" && spec.kind === "storyboard") { mode = "art"; pageIdx = Math.max(0, spec.pages.findIndex((p) => { let miss = false; if (p.layout) eachPanel(p.layout.rows, (q) => { if (!q.rows && !q.image) miss = true; }); return miss; })); }
    else if (go === "letter") mode = "letter";
    else if (go === "check" && spec.kind === "storyboard" && store.kind === "local") mode = "check";
    else return;
    render(); window.scrollTo(0, 0);
  }
  async function loadProject(id) {
    const f = PROJECTS.find((q) => q.id === id) || PROJECTS[0];
    if (!f) { mode = "home"; inProject(false); render(); setStatus("Ready", "ok"); return; } // nothing made yet
    if (dirty && saveTimer) { clearTimeout(saveTimer); await save(); }
    proj = f; SPEC_URL = f.dir + "spec.json"; BASE = f.dir; DOC = f.doc;
    try { localStorage.setItem("ld-project", f.id); } catch (e) { /* no storage */ }
    inProject(true);
    const res = await fetch(SPEC_URL);
    spec = prepare(await res.json());
    original = JSON.parse(JSON.stringify(spec));
    hist = [JSON.stringify(spec)]; redo = []; edited = false; dirty = false; savedFor = ""; // the built chapter is on screen until the saved edits are loaded
    pageIdx = 0; sel = -1; selP = null; drafts = {}; savedPages = {}; saveConflict = false;
    bible = await fetch(f.dir + "bible.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (syncReading()) hist = [JSON.stringify(spec)]; // the series' direction was changed from another chapter
    mode = spec.kind === "storyboard" ? "chapter" : "letter";
    mcache.clear();
    $("projSel").value = f.id;
    render();
    jobs = {}; clearTimeout(jobTimer);
    initStore().then(() => { // on your own computer: pick up any request that is still waiting (made earlier, or on the test page)
      if (!canDraw() || f.id !== proj.id) return;
      const ids = []; for (const p of spec.pages) if (p.layout) { eachPanel(p.layout.rows, (q) => { if (q.request && !q.rows) ids.push(q.id); }); for (const q of p.layout.insets || []) if (q.request) ids.push(q.id); }
      if (ids.length) startJobs(ids); else pollJobs();
      takeBreakouts(); // a break-out drawn while nobody had the project open lands now
      takeTone();
      CK = null; loadCheck().then(() => { // pictures that landed while nobody had the project open are checked now, when this person wants that
        if (f.id !== proj.id || !CK || ckBusy() || ids.length || autoPref() !== "on" || !CK.drawn || !CK.changed.length) return;
        if (Object.values(jobs).some((j) => j.status === "waiting" || j.status === "drawing")) return;
        startCheck(); });
    });
  }

  // A tab that still holds an older storyboard (the chapter was storyboarded again from another tab, by the Assistant or by an agent)
  // loads the new one by itself and says so. Before 19 Nov 2026 such a tab kept saving its old pages over the new ones (now refused by
  // the server, 409), and nothing on screen said the new storyboard had landed.
  let boardBusy = false;
  async function watchBoard() {
    if (boardBusy || store.kind !== "local" || !spec || !proj.id || !/^projects\//.test(proj.dir || "") || document.hidden) return;
    boardBusy = true;
    try {
      const id = proj.id, info = await (await fetch("/api/project?p=" + encodeURIComponent(id))).json();
      if (!info || !info.own || typeof info.boardAt !== "string" || !info.boardAt || info.boardAt === (spec.boardAt || "") || id !== proj.id) return;
      const was = mode, lost = dirty || edited; dirty = false; clearTimeout(saveTimer); // this tab's pages belong to the old storyboard: they are not saved over the new one
      await loadProject(id);
      if (was === "home" || was === "book") { mode = was; inProject(false); }
      render();
      const say = () => { if (id === proj.id) setStatus(`The new storyboard is in (${spec.pages.length} pages) and this chapter was loaded again.` + (lost ? " Changes made here on the old pages were not kept." : ""), "ok"); };
      say(); setTimeout(say, 1500); // loading the chapter ends with its own "Saved": the news goes last
    } catch (e) { /* offline: try again next time */ } finally { boardBusy = false; }
  }

  async function boot() {
    storeReady = detectStore(); await storeReady; // on your own computer the project list comes from the server
    await fetchProjects();
    STYLES = await fetch(store.kind === "local" ? "/api/styles" : "core/styles.json").then((r) => (r.ok ? r.json() : [])).catch(() => []); // with the person's own styles on their computer
    { const saved = (() => { try { return localStorage.getItem("ld-project"); } catch (e) { return null; } })(), f = PROJECTS.find((q) => q.id === saved); proj = f || PROJECTS[0] || NO_PROJECT; }
    $("projSel").innerHTML = PROJECTS.map((q) => `<option value="${q.id}">${R.esc(q.label)}</option>`).join("");
    wire(); wireHome(); wireSeries(); wireStills();
    const fontLoads = [["Playpen Sans", 500], ["Playpen Sans", 800], ["Bangers", 400], ["Vollkorn", 500], ["Vollkorn", 700], ["Patrick Hand", 400], ["Comic Neue", 700], ["Kalam", 700]]
      .map(([f, w]) => document.fonts.load(`${w} 30px '${f}'`).catch(() => null));
    await Promise.all(fontLoads);
    document.body.classList.add("studio");
    const fresh = (() => { try { return !sessionStorage.getItem("ibasho-open"); } catch (e) { return false; } })();
    await loadProject(proj.id);
    if (fresh || location.hash === "#home") { mode = "home"; inProject(false); if (location.hash === "#home") history.replaceState(null, "", location.pathname); render(); }
    if (store.kind === "local") { // the whole studio's queue, in the status bar
      const tick = async () => { /* the studio's "Working on" chip (studio.js) shows the whole queue now */ };
      tick(); setInterval(tick, 8000);
      setInterval(watchBoard, 15000); document.addEventListener("visibilitychange", () => { if (!document.hidden) watchBoard(); });
      window.addEventListener("ibasho-work-landed", () => setTimeout(watchBoard, 500)); // a storyboard (or anything else) just finished
    } else $("animeLink").hidden = true;
  }
  boot().catch(() => setStatus("The page could not load. Reload to try again.", "error"));
})();
