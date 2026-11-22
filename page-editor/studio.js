/* Ibasho studio look: the theme switch shared by the manga editor and the anime screens.
 * Follows the device (light or dark) until the person picks one with the switch; that choice is kept in this browser ("ibasho-theme"). Loaded before the page paints. */
(function () {
  "use strict";
  const KEY = "ibasho-theme", root = document.documentElement;
  const dev = matchMedia("(prefers-color-scheme: light)");
  const read = () => { let v = null; try { v = localStorage.getItem(KEY); } catch (e) { /* no storage */ } return v === "light" || v === "dark" ? v : dev.matches ? "light" : "dark"; };
  dev.addEventListener("change", () => apply(read()));
  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
  function apply(t) {
    root.dataset.theme = t;
    const b = document.getElementById("themeBtn");
    if (b) { b.innerHTML = t === "dark" ? SUN : MOON; b.setAttribute("aria-label", t === "dark" ? "Switch to the light look" : "Switch to the dark look"); b.title = b.getAttribute("aria-label"); }
  }
  apply(read());
  // Phone: the grip at the top of a tools sheet folds it away and back
  document.addEventListener("click", (e) => { const g = e.target.closest(".sheet-grip"); if (!g) return; const p = g.closest(".panel"); const min = p.classList.toggle("sheet-min"); g.setAttribute("aria-expanded", !min); g.setAttribute("aria-label", min ? "Show the tools" : "Hide the tools"); document.body.classList.toggle("sheet-min", min); });
  addEventListener("DOMContentLoaded", () => {
    apply(read());
    const b = document.getElementById("themeBtn");
    if (b) b.addEventListener("ibasho-refresh", () => apply(root.dataset.theme));
    if (b) b.addEventListener("click", () => { const t = root.dataset.theme === "dark" ? "light" : "dark"; try { localStorage.setItem(KEY, t); } catch (e) { /* no storage */ } apply(t); });
  });
})();

/* ---------- The model picker: one window for every kind of job (Writing, Pictures, Video).
 * Ibasho.pickModel(kind) opens it and resolves to the chosen model ({ service, model, name, price, ... }) or null when closed.
 * Choosing a model makes it the one that kind of job uses everywhere (saved on the computer that runs Ibasho: /api/models).
 * Ibasho.modelChoice(kind) -> the model in use now, with its price line. ---------- */
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CSS = `
  .mp-dlg { width: min(720px, calc(100vw - 16px)); max-height: min(86vh, 900px); padding: 0 !important; display: flex; flex-direction: column; }
  .mp-dlg:not([open]) { display: none; }
  .mp-dlg::backdrop { background: rgb(0 0 0 / .55); }
  .mp-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px; border-bottom: 1px solid var(--line); }
  .mp-head h2 { margin: 0; font-size: 1.05rem; flex: 1; }
  .mp-search { margin: 8px 14px; min-height: 40px; padding: 6px 10px; font: inherit; border: 1px solid var(--line-2); background: var(--bg); color: var(--ink); border-radius: var(--r); }
  .mp-body { overflow-y: auto; padding: 0 14px 14px; -webkit-overflow-scrolling: touch; }
  .mp-note { margin: 4px 0 10px; padding: 8px 10px; border-radius: var(--r); background: var(--raise); border: 1px solid var(--line-2); font-size: .88rem; color: var(--muted); }
  .mp-note a { color: var(--blue); }
  .mp-sec { font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin: 14px 0 6px; }
  .mp-opt { display: block; width: 100%; text-align: left; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: var(--r); padding: 9px 11px; margin: 0 0 6px; font: inherit; cursor: pointer; }
  .mp-opt:hover:not(:disabled) { background: var(--hover); }
  .mp-opt:disabled { opacity: .5; cursor: not-allowed; }
  .mp-opt[aria-current="true"] { border-color: var(--blue); box-shadow: inset 3px 0 0 var(--blue); }
  .mp-top { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .mp-nm { font-weight: 700; }
  .mp-by { color: var(--muted); font-size: .82rem; }
  .mp-star { font-size: .72rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: var(--blue-soft); color: var(--blue); white-space: nowrap; }
  .mp-price { margin-left: auto; font-size: .84rem; font-weight: 650; white-space: nowrap; }
  .mp-why { color: var(--muted); font-size: .84rem; margin-top: 2px; }
  .mp-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .mp-tag { font-size: .72rem; padding: 1px 6px; border-radius: 3px; background: var(--bg); color: var(--muted); border: 1px solid var(--line); }
  .mp-more { width: 100%; margin: 6px 0; }
  @media (max-width: 520px) { .mp-price { margin-left: 0; flex-basis: 100%; white-space: normal; } }
  /* C Pro: model cards with an example each model made in this studio (from Create), filters as chips */
  .mp-dlg { width: min(1040px, calc(100vw - 16px)); }
  .mp-filt { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 8px; }
  .mp-filt button { border: 1px solid var(--line-2); background: none; color: var(--muted); border-radius: 999px; padding: 5px 12px; font: inherit; font-weight: 700; cursor: pointer; }
  .mp-filt button[aria-pressed="true"] { background: var(--blue-soft); border-color: var(--blue); color: var(--ink); }
  .mp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .mp-card { display: flex; flex-direction: column; padding: 0; text-align: left; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 14px; overflow: hidden; font: inherit; cursor: pointer; }
  .mp-card:hover:not(:disabled) { border-color: var(--line-2); }
  .mp-card:disabled { opacity: .5; cursor: not-allowed; }
  .mp-card[aria-current="true"] { border: 2px solid var(--blue); box-shadow: var(--glow); }
  .mp-pv { position: relative; display: flex; align-items: center; justify-content: center; height: 124px; background: linear-gradient(135deg, var(--raise), var(--bg)) center / cover; color: var(--muted); font-size: .8rem; }
  .mp-pv .mp-star { position: absolute; top: 8px; left: 8px; background: rgb(0 0 0 / .62); color: #ffb09c; }
  .mp-pv .mp-made { position: absolute; bottom: 8px; right: 8px; padding: 2px 7px; border-radius: 6px; background: rgb(0 0 0 / .62); color: #f6f0ec; font-size: .72rem; }
  .mp-cb { display: grid; gap: 2px; padding: 10px 12px 12px; }
  .mp-cb .mp-price { margin: 6px 0 0; font-family: var(--mono); color: var(--amber); font-size: .78rem; font-weight: 500; white-space: normal; }
  .mp-btn { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 0; text-align: left; line-height: 1.2; max-width: 100%; }
  .mp-btn small { color: var(--muted); font-weight: 500; font-size: .76rem; }
  `;
  let dlg = null, data = null, done = null, showMore = false, q = "", filt = "sug", made = {};
  { const st = document.createElement("style"); st.textContent = CSS; (document.head || document.documentElement).appendChild(st); } // the picker button is styled before the window is first opened
  function frame() {
    if (dlg) return;
    dlg = document.createElement("dialog"); dlg.className = "mp-dlg"; dlg.setAttribute("aria-labelledby", "mpTitle");
    dlg.innerHTML = `<div class="mp-head"><h2 id="mpTitle">Pick a model</h2><button class="btn ghost" type="button" data-mp="close" aria-label="Close">✕</button></div>
      <input class="mp-search" type="search" placeholder="Search models" aria-label="Search models" autocomplete="off">
      <div class="mp-filt" role="group" aria-label="Show"><button type="button" data-mp="f" data-f="sug" aria-pressed="true">★ Suggested</button><button type="button" data-mp="f" data-f="refs" aria-pressed="false">Takes reference pictures</button><button type="button" data-mp="f" data-f="cheap" aria-pressed="false">Cheapest first</button><button type="button" data-mp="f" data-f="all" aria-pressed="false">All</button></div>
      <div class="mp-body" id="mpBody"></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => { if (done) { done(null); done = null; } });
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) return dlg.close();
      const b = e.target.closest("[data-mp]"); if (!b) return;
      if (b.dataset.mp === "close") return dlg.close();
      if (b.dataset.mp === "more") { showMore = true; return draw(); }
      if (b.dataset.mp === "f") { filt = b.dataset.f; dlg.querySelectorAll("[data-mp=f]").forEach((x) => x.setAttribute("aria-pressed", x === b)); return draw(); }
      if (b.dataset.mp === "pick") choose(+b.dataset.i);
    });
    dlg.querySelector(".mp-search").addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  }
  const isCur = (o) => data.choice && data.choice.service === o.service && data.choice.model === o.model;
  function row(o, i) {
    const off = !o.connected, svc = o.service === "codex" ? "Codex" : "OpenRouter";
    return `<button type="button" class="mp-opt" data-mp="pick" data-i="${i}"${off ? " disabled" : ""} aria-current="${isCur(o)}">
      <span class="mp-top"><span class="mp-nm">${esc(o.name)}</span><span class="mp-by">${esc(o.maker && o.maker !== o.name ? o.maker + " · " : "")}${esc(svc)}</span>${o.suggested ? `<span class="mp-star">★ ${esc(o.suggested)}</span>` : ""}<span class="mp-price">${esc(o.price || "")}</span></span>
      ${o.why ? `<span class="mp-why" style="display:block">${esc(o.why)}</span>` : ""}
      ${(o.tags || []).length || off ? `<span class="mp-tags">${off ? `<span class="mp-tag">Connect ${esc(svc)} first</span>` : ""}${(o.tags || []).map((t) => `<span class="mp-tag">${esc(t)}</span>`).join("")}</span>` : ""}</button>`;
  }
  function card(o, i) {
    const off = !o.connected, svc = o.service === "codex" ? "Codex" : "OpenRouter", ex = made[o.model];
    return `<button type="button" class="mp-card" data-mp="pick" data-i="${i}"${off ? " disabled" : ""} aria-current="${isCur(o)}">
      <span class="mp-pv"${ex ? ` style="background-image:url('${esc(ex)}')"` : ""}>${o.suggested ? `<span class="mp-star">★ ${esc(o.suggested)}</span>` : ""}${ex ? `<span class="mp-made">made in your studio</span>` : "No example yet"}</span>
      <span class="mp-cb"><b>${esc(o.name)}</b><span class="mp-by">${esc(o.maker && o.maker !== o.name ? o.maker + " · " : "")}${esc(svc)}${off ? " · connect first" : ""}</span>${o.why ? `<span class="mp-why">${esc(o.why)}</span>` : ""}<span class="mp-price">${esc(o.price || "")}</span></span></button>`;
  }
  function draw() {
    const body = dlg.querySelector("#mpBody"), all = data.options.map((o, i) => [o, i]);
    const match = ([o]) => !q || (o.name + " " + (o.maker || "") + " " + o.model + " " + (o.suggested || "")).toLowerCase().includes(q);
    const sug = all.filter(([o]) => o.suggested && !o.more).filter(match);
    const rest = all.filter(([o]) => !o.suggested).filter(match).sort((a, b) => (a[0].est ?? 1e9) - (b[0].est ?? 1e9));
    const cur = all.find(([o]) => isCur(o));
    let h = "";
    if (!data.services.openrouter) h += `<p class="mp-note">Connect OpenRouter to use the models below Codex: one key, every model, you pay each maker's price. <a href="/connections">Open Connections</a></p>`;
    if (data.choice && data.choice.off) h += `<p class="mp-note">The model you picked before (${esc(data.choice.name || data.choice.model)}) is not connected now.</p>`;
    const takesRefs = (t) => /^references$|up to \d+ reference|takes up to \d+ reference/i.test(t) && !/\bno reference/i.test(t);
    const refs = ([o]) => (o.tags || []).some(takesRefs) || takesRefs(o.why || "");
    if (cur && !q && !cur[0].suggested && filt === "sug") h += `<div class="mp-sec">In use now</div><div class="mp-cards">${card(cur[0], cur[1])}</div>`;
    if (filt === "sug" && !q) {
      h += `<div class="mp-sec">★ Suggested</div><div class="mp-cards">` + (sug.map(([o, i]) => card(o, i)).join("") || `<p class="mp-why">None match.</p>`) + `</div>`;
      const limit = showMore ? 400 : 0;
      if (rest.length) {
        h += `<div class="mp-sec">More models (${rest.length}), cheapest first</div>`;
        h += rest.slice(0, limit).map(([o, i]) => row(o, i)).join("");
        if (rest.length > limit) h += `<button type="button" class="btn mp-more" data-mp="more">Show ${rest.length} more models</button>`;
      }
    } else {
      let list = all.filter(match);
      if (filt === "refs") list = list.filter(refs);
      if (filt === "cheap" || filt === "refs") list.sort((a, b) => (a[0].est ?? 1e9) - (b[0].est ?? 1e9));
      const top = list.filter(([o]) => o.suggested || made[o.model]), others = list.filter(([o]) => !(o.suggested || made[o.model]));
      if (filt !== "cheap" && top.length) h += `<div class="mp-cards">${top.map(([o, i]) => card(o, i)).join("")}</div>`;
      const rows = filt === "cheap" ? list : others;
      if (rows.length) h += `<div class="mp-sec">${filt === "cheap" ? "Cheapest first" : "More"} (${rows.length})</div>` + rows.map(([o, i]) => row(o, i)).join("");
      if (!list.length) h += `<p class="mp-why">None match.</p>`;
    }
    h += `<p class="mp-why" style="margin-top:12px">Prices are OpenRouter's list prices from ${esc(data.fetched || "the last refresh")}. The model you pick is used for every ${esc(data.name.toLowerCase())} job until you pick another.</p>`;
    body.innerHTML = h;
  }
  async function choose(i) {
    const o = data.options[i]; if (!o || !o.connected) return;
    try {
      const r = await fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: data.kind, service: o.service, model: o.model }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not save the choice.");
    } catch (e) { alert(e.message); return; }
    const d = done; done = null; dlg.close(); if (d) d({ ...o, quality: ((await list(data.kind).catch(() => ({}))).choice || {}).quality || "" });
  }
  async function list(kind) { const r = await fetch("/api/models?kind=" + encodeURIComponent(kind)); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not load the models."); return j; }
  window.Ibasho = window.Ibasho || {};
  window.Ibasho.pickModel = async function (kind) {
    frame(); showMore = false; q = ""; filt = "sug"; dlg.querySelector(".mp-search").value = "";
    dlg.querySelectorAll("[data-mp=f]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.f === "sug"));
    try { // an example for each model: the newest finished thing made with it in Create
      made = {}; const items = await (await fetch("/api/create/list")).json();
      for (const m of items) if (m.status === "done" && m.model && !made[m.model] && (m.file || m.poster)) made[m.model] = `/api/create/file?id=${encodeURIComponent(m.id)}${m.kind === "video" ? "&poster=1" : ""}`;
    } catch (e) { made = {}; }
    try { data = await list(kind); } catch (e) { alert(e.message); return null; }
    dlg.querySelector("#mpTitle").textContent = "Model for " + data.name.toLowerCase();
    draw(); if (done) done(null);
    return new Promise((ok) => { done = ok; dlg.showModal(); const cur = dlg.querySelector('[aria-current="true"]'); if (cur) cur.scrollIntoView({ block: "center" }); });
  };
  /** The model a kind of job uses now, with its line from the list (price, tags). null when nothing is connected. */
  window.Ibasho.modelChoice = async function (kind) {
    const d = await list(kind); if (!d.choice) return null;
    const o = d.options.find((x) => x.service === d.choice.service && x.model === d.choice.model) || {};
    return { ...o, ...d.choice, connected: !d.choice.off };
  };
  /** The label a picker button shows: the model's name, and its price underneath. */
  const QL = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
  window.Ibasho.modelLabel = (c) => c ? `${esc(c.name || c.model)}${c.quality ? " · " + esc(QL[c.quality] || c.quality) : ""}<small>${esc(c.off ? "not connected" : c.quality && window.IbashoPrice && c.pm ? `about ${window.IbashoPrice.money(window.IbashoPrice.picture(c.pm, { quality: c.quality, size: [1024, 1536], chars: 3000 }).usd)} a panel at ${(QL[c.quality] || c.quality).toLowerCase()} quality` : c.price || "")}</small>` : `Pick a model<small>nothing connected</small>`;
  /** Keep a quality for the picture model in use (it is sent with every picture; medium unless changed). Resolves to the new choice. */
  window.Ibasho.setQuality = async function (kind, c, quality) {
    const r = await fetch("/api/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, service: c.service, model: c.model, quality }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "Could not save the quality."); return { ...c, quality: j.choice && j.choice.quality };
  };
  window.Ibasho.QUALITY = QL;

  // ---------- spending: ask before a paid job over the person's threshold; never past the monthly cap (the server checks the cap too) ----------
  let sp = null, spAt = 0;
  window.Ibasho.spend = async function (fresh) { if (!fresh && sp && Date.now() - spAt < 15000) return sp; const r = await fetch("/api/spend"); sp = await r.json(); spAt = Date.now(); paintSpend(); return sp; };
  /** usd = the estimate; what = "Drawing 6 pictures"; o.asked = the screen already showed the price and asked. Resolves true to go ahead. */
  // The server keeps "ask me first" too (since 19 Nov 2026): a paid request must carry what the person agreed to. For two minutes after
  // a yes (or after a price under their amount was found fine), requests that start work carry it in two headers.
  let said = null; const yes = (usd, asked) => { said = { usd, asked: !!asked, at: Date.now() }; return true; };
  const plainFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (said && Date.now() - said.at < 120000 && typeof input === "string" && input.indexOf("://") < 0 && init && init.method && init.method !== "GET") {
      const h = new Headers(init.headers || {}); h.set("x-ibasho-ok", String(said.usd)); if (said.asked) h.set("x-ibasho-asked", "1"); init = Object.assign({}, init, { headers: h });
    }
    return plainFetch(input, init);
  };
  window.Ibasho.okToSpend = async function (usd, what, o) {
    o = o || {}; if (!(usd > 0)) return true; let s; try { s = await window.Ibasho.spend(true); } catch (e) { return (o.asked || confirm(`${what} will cost about $${usd.toFixed(2)}. Go ahead?`)) && yes(usd, true); }
    const cap = s.settings.cap;
    if (cap != null && s.total + usd > cap) { alert(`${what} would take this month's spending past your cap: $${s.total.toFixed(2)} spent of $${(+cap).toFixed(2)}, and this is about $${usd.toFixed(2)}.\n\nRaise the cap under Connections > Spending.`); return false; }
    if (o.asked || usd <= (s.settings.askOver || 0)) return yes(usd, o.asked);
    return confirm(`${what} will cost about $${usd.toFixed(2)}.\n\nSpent this month: $${s.total.toFixed(2)}${cap != null ? ` of your $${(+cap).toFixed(2)} cap` : ""}.${s.credit && s.credit.left != null ? ` OpenRouter credit left: $${s.credit.left.toFixed(2)}.` : ""}\n\nGo ahead? (Change when Ibasho asks under Connections > Spending.)`) && yes(usd, true);
  };
  /** The status bar's spending figure: this month, and what is left on OpenRouter. */
  function paintSpend() {
    const bar = document.querySelector(".statusbar"); if (!bar || !sp) return;
    let a = document.getElementById("spendChip"); if (!a) { a = document.createElement("a"); a.id = "spendChip"; a.href = "/connections#spending"; a.className = "spendchip"; bar.appendChild(a); }
    a.textContent = `$${sp.total.toFixed(2)} this month${sp.credit && sp.credit.left != null ? ` · $${sp.credit.left.toFixed(2)} left` : ""}`;
    a.title = "Spending on paid models this month" + (sp.settings.cap != null ? `, cap $${(+sp.settings.cap).toFixed(2)}` : "") + ". Open Spending.";
    a.classList.toggle("near", sp.settings.cap != null && sp.total >= sp.settings.cap * 0.8);
  }
  addEventListener("DOMContentLoaded", () => { const go = () => window.Ibasho.spend(true).catch(() => {}); go(); setInterval(go, 60000); });
})();

/* ---------- The Assistant (TODO 36): a chat on every screen. A screen tells it what is open and which actions it offers:
 *   Ibasho.registerAssistant({ where: () => ({...}), actions: { name: { desc, args: { arg: "what it is" }, paid, cost(args) -> usd, label(args), auto, check(args) -> "" or why it cannot run, run(args) -> what it did } } })
 * What each step really did (or that it was never run, or why it failed) is shown on its button and sent back with the conversation, so the next answer rests on facts.
 * The answer's actions show as buttons; a paid one shows its price and runs only when tapped (and passes the ask-first and cap checks). ---------- */
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const KEY = "ibasho-assistant";
  let reg = { where: () => ({}), actions: {} }, msgs = [], busy = false, el = null;
  const load = () => { try { msgs = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { msgs = []; } };
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(msgs.slice(-40))); } catch (e) { /* no storage */ } };
  const GLOBAL = {
    open_screen: { desc: "Go to another part of the app", args: { screen: "home | manga | anime | create | library | connections" }, label: (a) => `Open ${a.screen}`,
      run: (a) => { location.href = { home: "/#home", manga: "/", anime: "/anime/#/", create: "/create", library: "/library", connections: "/connections" }[a.screen] || "/#home"; } },
  };
  const all = () => ({ ...GLOBAL, ...reg.actions });
  window.Ibasho = window.Ibasho || {};
  window.Ibasho.registerAssistant = (r) => { reg = { where: r.where || (() => ({})), actions: r.actions || {} }; };
  const CSS = `
  body.sheet-min .as-btn { bottom: calc(var(--bb, 44px) + 8px) !important; }
  .as-btn { position: fixed; right: 14px; bottom: calc(44px + env(safe-area-inset-bottom, 0px)); z-index: 60; border-radius: 999px; min-height: 44px; padding: 8px 16px; box-shadow: 0 6px 24px rgb(0 0 0 / .35); }
  .as-panel { position: fixed; z-index: 70; right: 0; top: var(--bar, 40px); bottom: 0; width: min(400px, 100vw); background: var(--surface); border-left: 1px solid var(--line-2); display: flex; flex-direction: column; box-shadow: -12px 0 40px rgb(0 0 0 / .35); }
  .as-panel[hidden] { display: none !important; }
  @media (max-width: 640px) { .as-panel { top: auto; height: 78vh; width: 100vw; border-left: 0; border-top: 1px solid var(--line-2); border-radius: 12px 12px 0 0; } }
  .as-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .as-head b { flex: 1; } .as-head small { color: var(--muted); font-weight: 500; }
  .as-log { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; -webkit-overflow-scrolling: touch; }
  .as-m { max-width: 92%; padding: 8px 11px; border-radius: 10px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .94rem; }
  .as-m.user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 3px; }
  .as-m.assistant { align-self: flex-start; background: var(--raise); border: 1px solid var(--line); border-bottom-left-radius: 3px; }
  .as-m.err { color: var(--red); }
  .as-acts { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; white-space: normal; }
  .as-acts .btn { text-align: left; min-height: 38px; white-space: normal; }
  .as-acts .btn small { display: block; color: var(--muted); font-weight: 500; }
  .as-acts .btn.done { border-color: var(--ok); color: var(--ok); }
  .as-in { display: flex; gap: 6px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid var(--line); }
  .as-in textarea { flex: 1; min-height: 44px; max-height: 140px; resize: none; padding: 8px 10px; font: inherit; border-radius: 8px; }
  .as-hint { color: var(--muted); font-size: .84rem; }
  .as-hint button { margin: 4px 4px 0 0; }`;
  function frame() {
    if (el) return; const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    const b = document.createElement("button"); b.className = "btn primary as-btn"; b.type = "button"; b.textContent = "✦ Assistant"; b.setAttribute("aria-label", "Open the Assistant");
    el = document.createElement("aside"); el.className = "as-panel"; el.hidden = true; el.setAttribute("aria-label", "Assistant");
    el.innerHTML = `<div class="as-head"><b>Assistant <small id="asModel"></small></b><button class="btn ghost" type="button" data-as="clear" title="Start a new conversation">New</button><button class="btn ghost" type="button" data-as="close" aria-label="Close the Assistant">✕</button></div>
      <div class="as-log" id="asLog" aria-live="polite"></div>
      <form class="as-in" id="asForm"><textarea id="asText" rows="1" placeholder="Ask, or tell it what to do" aria-label="Message to the Assistant"></textarea><button class="btn primary" type="submit">Send</button></form>`;
    document.body.append(b, el);
    b.onclick = () => { el.hidden = false; b.hidden = true; draw(); el.querySelector("#asText").focus(); };
    el.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-as]"); if (x) { if (x.dataset.as === "close") { el.hidden = true; b.hidden = false; } if (x.dataset.as === "clear") { msgs = []; keep(); draw(); } return; }
      const s = e.target.closest("[data-say]"); if (s) { el.querySelector("#asText").value = s.dataset.say; return ask(); }
      const a = e.target.closest("[data-act]"); if (a) { const [i, j] = a.dataset.act.split(":").map(Number); runAction(i, j); }
    });
    el.querySelector("#asForm").addEventListener("submit", (e) => { e.preventDefault(); ask(); });
    el.querySelector("#asText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } });
  }
  function costText(def, args) { try { const c = def && def.cost ? def.cost(args) : null; return c > 0 ? ` · about $${c.toFixed(2)}` : ""; } catch (e) { return ""; } }
  function draw() {
    const log = el.querySelector("#asLog"), A = all();
    log.innerHTML = msgs.length ? msgs.map((m, i) => `<div class="as-m ${m.role}${m.err ? " err" : ""}">${esc(m.content)}${(m.actions || []).length ? `<div class="as-acts">${m.actions.map((a, j) => { const d = A[a.name];
        return `<button class="btn${a.done ? " done" : ""}" data-act="${i}:${j}" ${a.done || a.bad || !d ? "disabled" : ""}>${a.done ? "✓ " : ""}${esc(d && d.label ? d.label(a.args) : a.name.replace(/_/g, " "))}${esc(costText(d, a.args))}${a.why || a.err || !d ? `<small>${esc(a.err || (!d ? "Not available on this screen" : a.why))}</small>` : ""}</button>`; }).join("")}</div>` : ""}</div>`).join("")
      : `<div class="as-hint">Ask about your project, or tell it what to do. It proposes each step as a button; anything that costs money waits for your tap.<br>${["What is left to draw here?", "Page 1 is crowded: spread it out", "Redraw this panel with more rain"].map((t) => `<button class="btn" data-say="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
    if (busy) log.insertAdjacentHTML("beforeend", `<div class="as-m assistant">Thinking…${busy === "codex" ? " (Codex can take a minute)" : ""}</div>`);
    log.scrollTop = log.scrollHeight;
  }
  /** The facts about an earlier answer's steps, for the model: what ran and what it did, what failed, what was never tapped. */
  function stepsNote(m) {
    if (m.role !== "assistant" || !(m.actions || []).length) return "";
    return "\n\n[STEPS, written by the app: " + m.actions.map((a) => `${a.name}(${JSON.stringify(a.args || {}).slice(0, 200)}) = ${a.done ? "RAN: " + (a.result || a.why || "done") : a.err ? "DID NOT RUN: " + a.err : "NOT RUN (the person has not tapped it)"}`).join("; ").slice(0, 1800) + "]";
  }
  async function runAction(i, j) {
    const a = msgs[i] && msgs[i].actions[j], d = a && all()[a.name]; if (!a || !d || a.done) return;
    try {
      if (d.paid) { const c = d.cost ? d.cost(a.args) : 0; if (!(await window.Ibasho.okToSpend(c || 0, d.label ? d.label(a.args) : a.name))) return; }
      const out = await d.run(a.args); a.done = true; delete a.err; a.result = typeof out === "string" && out ? out : "Done."; a.why = a.result;
    } catch (e) { a.err = e.message || String(e); }
    keep(); draw();
  }
  async function ask() {
    const ta = el.querySelector("#asText"), text = ta.value.trim(); if (!text || busy) return;
    let model = "", pick = null; try { pick = (await window.Ibasho.modelChoice("text")) || {}; model = pick.service; } catch (e) { /* unknown */ }
    if (model === "openrouter" && !(await window.Ibasho.okToSpend((pick.jobUsd || 0) / 6, "The Assistant's answer"))) return; // the server refuses a paid answer nobody agreed to
    ta.value = ""; msgs.push({ role: "user", content: text }); keep();
    busy = model === "codex" ? "codex" : true; draw();
    const A = all(), list = Object.entries(A).map(([name, d]) => ({ name, desc: d.desc, args: d.args || {}, paid: !!d.paid }));
    let where = {}; try { where = reg.where() || {}; } catch (e) { /* nothing */ }
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: msgs.map((m) => ({ role: m.role, content: m.content + stepsNote(m) })), where, actions: list }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "The Assistant could not answer.");
      el.querySelector("#asModel").textContent = j.model ? "· " + j.model : "";
      const m = { role: "assistant", content: (j.reply || "(no words)") + (j.dropped ? `\n\n(${j.dropped} step${j.dropped === 1 ? "" : "s"} it proposed cannot be done from this screen and ${j.dropped === 1 ? "was" : "were"} left out.)` : ""), actions: j.actions || [] };
      for (const a of m.actions) { const d = A[a.name]; if (d && d.check) { let why = ""; try { why = d.check(a.args) || ""; } catch (e) { why = e.message; } if (why) { a.bad = true; a.err = "Cannot run: " + why; } } } // a step that names a page or panel that is not there is shown, greyed, with the reason
      msgs.push(m); keep(); busy = false; draw();
      for (const [k, a] of m.actions.entries()) { const d = A[a.name]; if (d && d.auto && !d.paid) await runAction(msgs.length - 1, k); } // free, harmless steps (open a panel) run by themselves
    } catch (e) { msgs.push({ role: "assistant", content: e.message, err: true }); keep(); busy = false; draw(); }
  }
  addEventListener("DOMContentLoaded", () => { if (!document.querySelector(".appbar")) return; load(); frame(); });
})();

/* ---------- Work you can see (TODO 35a): "Working on" in the status bar on every screen, a sheet with a progress bar per job,
 * and a notice (with a soft chime and a buzz on phones) when something lands. The list comes from the server (/api/work), which keeps
 * it on disk: a reload or a restart never loses track of a job. Ibasho.workBar(job) gives a small bar for a screen's own cards. ---------- */
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CSS = `
  .statusbar { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .statusbar > .status, .statusbar > #status { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .statusbar > .wk-chip, .statusbar > .spendchip { flex: 0 0 auto; }
  .wk-chip { display: inline-flex; align-items: center; gap: 7px; margin-left: auto; border: 0; background: none; color: var(--muted); font: inherit; font-size: .8rem; cursor: pointer; padding: 2px 4px; white-space: nowrap; }
  .wk-chip.on { color: var(--ink); font-weight: 650; }
  .wk-chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-2); }
  .wk-chip.on .dot { background: var(--blue); animation: wkp 1.2s ease-in-out infinite; }
  @keyframes wkp { 50% { opacity: .35; } }
  .wk-mini { width: 56px; height: 5px; border-radius: 3px; background: var(--line); overflow: hidden; }
  .wk-mini i, .wk-bar i { display: block; height: 100%; background: var(--blue); border-radius: inherit; transition: width .8s linear; }
  .wk-sheet { position: fixed; z-index: 75; right: 8px; bottom: calc(40px + env(safe-area-inset-bottom, 0px)); width: min(420px, calc(100vw - 16px)); max-height: 70vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--line-2); border-radius: 8px; box-shadow: 0 16px 50px rgb(0 0 0 / .45); padding: 10px 12px; }
  .wk-sheet[hidden] { display: none !important; }
  .wk-sheet h3 { font-size: .74rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 10px 0 6px; }
  .wk-row { display: block; padding: 8px 0; border-top: 1px solid var(--line); color: inherit; text-decoration: none; }
  .wk-row:first-of-type { border-top: 0; }
  .wk-row b { font-weight: 650; overflow-wrap: anywhere; } .wk-row small { display: block; color: var(--muted); font-size: .8rem; margin-top: 2px; overflow-wrap: anywhere; }
  .wk-bar { height: 7px; border-radius: 4px; background: var(--line); overflow: hidden; margin-top: 6px; }
  .wk-bar.over i { background: var(--amber); }
  .wk-row.ok b::before { content: "✓ "; color: var(--ok); } .wk-row.bad b::before { content: "✕ "; color: var(--red); }
  .wk-toast { position: fixed; z-index: 90; left: 50%; transform: translateX(-50%); bottom: calc(52px + env(safe-area-inset-bottom, 0px)); max-width: calc(100vw - 24px); background: var(--raise); color: var(--ink); border: 1px solid var(--line-2); border-left: 4px solid var(--ok); border-radius: 6px; padding: 10px 14px; box-shadow: 0 12px 40px rgb(0 0 0 / .45); font-weight: 600; cursor: pointer; }
  .wk-toast.bad { border-left-color: var(--red); }`;
  const fmt = (s) => { s = Math.max(0, Math.round(s)); return s < 60 ? s + " s" : Math.floor(s / 60) + " min" + (s % 60 >= 30 ? " ½" : ""); };
  /** How far along a running job is (0..1): time so far against the usual time, never shown as finished before it is. */
  const part = (j, now) => (j.status !== "working" || !j.started || !j.expect ? 0 : Math.min(0.95, (now - j.started) / 1000 / j.expect));
  window.Ibasho = window.Ibasho || {};
  /** A small progress bar for a job a screen shows itself: { at (ms started), expect (s), now (ms) }. */
  window.Ibasho.workBar = (j) => { if (!j || !j.expect || !j.at) return ""; const f = Math.min(0.95, ((j.now || Date.now()) - j.at) / 1000 / j.expect); return `<span class="wk-mini" title="Usually about ${fmt(j.expect)}" style="display:inline-block;vertical-align:middle;margin-left:6px"><i style="width:${Math.round(f * 100)}%"></i></span>`; };
  let W = null, seen = null, chip = null, sheet = null, timer = null, skew = 0;
  function chime() { try { const C = new (window.AudioContext || window.webkitAudioContext)(), o = C.createOscillator(), g = C.createGain(); o.type = "sine"; o.frequency.setValueAtTime(880, C.currentTime); o.frequency.setValueAtTime(1320, C.currentTime + 0.12); g.gain.setValueAtTime(0.0001, C.currentTime); g.gain.exponentialRampToValueAtTime(0.12, C.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, C.currentTime + 0.45); o.connect(g).connect(C.destination); o.start(); o.stop(C.currentTime + 0.5); } catch (e) { /* no sound */ } try { navigator.vibrate && navigator.vibrate(60); } catch (e) { /* no buzz */ } }
  function toast(h) { const t = document.createElement("div"); t.className = "wk-toast" + (h.status === "failed" ? " bad" : ""); t.setAttribute("role", "status");
    t.textContent = h.status === "failed" ? `Not done: ${h.label}. ${h.msg || ""}` : `Done: ${h.label}${h.cost != null ? ` ($${(+h.cost).toFixed(2)})` : ""}`;
    t.onclick = () => { if (h.link) location.href = h.link; }; document.body.appendChild(t); setTimeout(() => t.remove(), 7000); }
  function paint() {
    if (!chip || !W) return; const now = Date.now() - skew, n = W.running.length, w = W.waiting.length;
    chip.classList.toggle("on", !!(n || w));
    const avg = n ? W.running.reduce((a, j) => a + part(j, now), 0) / n : 0;
    chip.innerHTML = `<span class="dot"></span>${n || w ? `Working on ${n}${w ? ` · ${w} waiting` : ""}<span class="wk-mini"><i style="width:${Math.round(avg * 100)}%"></i></span>` : "Nothing running"}`;
    if (sheet.hidden) return;
    const row = (j) => { const f = part(j, now), over = j.status === "working" && j.started && (now - j.started) / 1000 > j.expect;
      return `<a class="wk-row" href="${esc(j.link)}"><b>${esc(j.label)}</b><small>${esc(j.model ? j.model + " · " : "")}${j.status === "waiting" ? "Waiting its turn" : `${fmt((now - j.started) / 1000)} so far · usually about ${fmt(j.expect)}${over ? " (taking longer than usual)" : ""}`}${j.msg ? " · " + esc(j.msg) : ""}</small>${j.status === "working" ? `<div class="wk-bar${over ? " over" : ""}"><i style="width:${Math.round(f * 100)}%"></i></div>` : ""}</a>`; };
    sheet.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b>Working on</b><button class="btn ghost" data-wk="x" aria-label="Close">✕</button></div>
      ${n || w ? W.running.concat(W.waiting).map(row).join("") : `<p class="hint" style="margin:6px 0">Nothing is being made right now.</p>`}
      ${W.recent.length ? `<h3>Finished</h3>${W.recent.slice(0, 15).map((h) => `<a class="wk-row ${h.status === "failed" ? "bad" : "ok"}" href="${esc(h.link)}"><b>${esc(h.label)}</b><small>${esc(h.model ? h.model + " · " : "")}${h.took ? fmt(h.took) + " · " : ""}${h.cost != null ? "$" + (+h.cost).toFixed(3) + " · " : ""}${esc(new Date(h.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}${h.status === "failed" && h.msg ? " · " + esc(h.msg) : ""}</small></a>`).join("")}` : ""}`;
  }
  async function poll() {
    clearTimeout(timer);
    try { const r = await fetch("/api/work"); W = await r.json(); skew = Date.now() - W.now; } catch (e) { timer = setTimeout(poll, 15000); return; }
    const keys = new Set(W.recent.map((h) => h.key + "|" + h.at));
    if (seen) for (const h of W.recent) if (!seen.has(h.key + "|" + h.at)) { toast(h); chime(); window.dispatchEvent(new CustomEvent("ibasho-work-landed", { detail: h })); }
    seen = keys; paint();
    timer = setTimeout(poll, W.running.length || W.waiting.length ? 3000 : 15000);
  }
  window.Ibasho.workNow = () => poll(); // a screen that just started a job asks for a fresh look
  addEventListener("DOMContentLoaded", () => {
    const bar = document.querySelector(".statusbar"); if (!bar) return;
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    const old = document.getElementById("sbQueue"); if (old) old.hidden = true;
    chip = document.createElement("button"); chip.type = "button"; chip.className = "wk-chip"; chip.setAttribute("aria-label", "What is being made"); bar.appendChild(chip);
    sheet = document.createElement("div"); sheet.className = "wk-sheet"; sheet.hidden = true; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Working on"); document.body.appendChild(sheet);
    chip.onclick = () => { sheet.hidden = !sheet.hidden; paint(); };
    sheet.addEventListener("click", (e) => { if (e.target.closest('[data-wk="x"]')) sheet.hidden = true; });
    setInterval(paint, 1000); poll();
  });
})();

/* ---------- Settings on every screen, the look choice, resizable panels and focus mode (C Pro, 18 Nov) ---------- */
(function () {
  "use strict";
  const KEY = "ibasho-theme", W = "ibasho-widths", root = document.documentElement;
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* no storage */ } };
  const dev = matchMedia("(prefers-color-scheme: light)");
  function setLook(v) { put(KEY, v === "device" ? null : v); root.dataset.theme = v === "device" ? (dev.matches ? "light" : "dark") : v; const b = document.getElementById("themeBtn"); if (b) b.dispatchEvent(new Event("ibasho-refresh")); }
  function lookRow() {
    const cur = get(KEY) || "device";
    const L = window.IbashoI18n && IbashoI18n.lang === "ja"; // "Look" alone means "to look at" elsewhere, so this row names itself
    return `<div class="setrow set-look"><span><b>${L ? "表示テーマ" : "Look"}</b><br><span class="hint">Follow the device switches with your phone or computer.</span></span><span class="segs" role="group" aria-label="${L ? "表示テーマ" : "Look"}">` +
      [["device", "Follow the device"], ["light", "Light"], ["dark", "Dark"]].map(([v, t]) => `<button type="button" class="seg" data-look="${v}" aria-pressed="${cur === v}">${t}</button>`).join("") + `</span></div>`;
  }
  function wireLook(box) { box.addEventListener("click", (e) => { const b = e.target.closest("[data-look]"); if (!b) return; setLook(b.dataset.look); box.querySelectorAll("[data-look]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }); }
  // Other devices: the access code, shown only when Ibasho is opened on the computer that runs it (GET /api/access answers no one else)
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ACCESS = `<div class="setrow set-access" hidden><span><b>Other devices</b><br><span class="hint" data-acc-say></span></span><span data-acc-box></span></div>`;
  async function wireAccess(box) {
    const row = box.querySelector(".set-access"); if (!row) return;
    let a; try { const r = await fetch("/api/access", { cache: "no-store" }); if (!r.ok) return; a = await r.json(); } catch (e) { return; }
    if (!a || !a.code) return;
    row.hidden = false;
    if (a.open) { row.querySelector("[data-acc-say]").textContent = "Every device on the network is let in without a code (STUDIO_OPEN=1)."; return; }
    const port = a.port || location.port || 5178, links = (a.addresses || []).map((h) => `http://${h}:${port}/?key=${encodeURIComponent(a.code)}`);
    row.querySelector("[data-acc-say]").innerHTML = "A phone, tablet or another computer needs this code once; then it is remembered for a year.";
    row.querySelector("[data-acc-box]").innerHTML = `<code class="acc-code" style="font:700 1.05rem ui-monospace,monospace;letter-spacing:.08em;user-select:all">${esc(a.code)}</code> <button type="button" class="btn" data-acc-more aria-expanded="false">Let another device in</button>
      <span data-acc-how hidden style="display:block;margin-top:8px"><span class="hint">On the other device, open this address (it carries the code), or open Ibasho there and type the code:</span>${links.length ? links.map((l) => `<br><a href="${esc(l)}" data-acc-link style="word-break:break-all;color:inherit">${esc(l)}</a> <button type="button" class="btn" data-acc-copy="${esc(l)}">Copy</button>`).join("") : `<br><span class="hint">This computer's address was not found. Use the address you open Ibasho by on that device, with ?key=${esc(a.code)} at the end.</span>`}</span>`;
    row.querySelector("[data-acc-more]").onclick = (e) => { const how = row.querySelector("[data-acc-how]"); how.hidden = !how.hidden; e.target.setAttribute("aria-expanded", String(!how.hidden)); };
    row.querySelectorAll("[data-acc-copy]").forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.accCopy); b.textContent = "Copied"; } catch (e) { b.textContent = "Select and copy it"; } }));
  }
  const KEYS = `<p class="hint set-keys"><b>Keys in the manga editor:</b> L Lettering · Y Layout · A Art · C Check · H Chapter · S Series · F focus (hide the panels) · Ctrl Z undo</p>`;
  addEventListener("DOMContentLoaded", () => {
    // the editor has its own Settings window: add the look choice to it
    const own = document.getElementById("settingsDlg");
    if (own) { const h = own.querySelector(".dlg-head"); h.insertAdjacentHTML("afterend", lookRow()); own.insertAdjacentHTML("beforeend", ACCESS + KEYS); wireLook(own); wireAccess(own);
      own.querySelectorAll("p.hint").forEach((p) => { if (p.hasAttribute("data-sun-hint") || /sun and moon/.test(p.textContent)) p.remove(); }); }
    // every other screen: a shared Settings window behind the cog
    const cog = document.getElementById("settingsBtn");
    if (cog && !own) {
      const d = document.createElement("dialog"); d.id = "sharedSettings"; d.setAttribute("aria-labelledby", "sSetT"); d.className = "set-dlg";
      const auto = get("ibasho-auto-check") === "on";
      d.innerHTML = `<div class="dlg-head"><h2 id="sSetT">Settings</h2><button type="button" class="btn" data-x>Close</button></div><p class="hint">Your own choices, kept in this browser on this device.</p>${lookRow()}
        <label class="setrow"><input type="checkbox" id="sSetAuto"${auto ? " checked" : ""}><span><b>Check pictures by themselves after they are drawn</b><br><span class="hint">The asset check compares every drawn panel with the others and with the approved sheets. It only warns.</span></span></label>
        <p class="setrow"><a class="btn" href="/connections">Connections</a><span class="hint">Sign in to Codex and link your keys. Spending and the monthly cap are there too.</span></p>${ACCESS}${KEYS}`;
      document.body.appendChild(d); wireLook(d); wireAccess(d);
      d.querySelector("[data-x]").onclick = () => d.close();
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
      d.querySelector("#sSetAuto").onchange = (e) => put("ibasho-auto-check", e.target.checked ? "on" : "off");
      cog.addEventListener("click", () => { d.querySelectorAll("[data-look]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.look === (get(KEY) || "device"))); d.showModal(); });
    }
    // resizable, foldable panels in the manga editor (wide screens)
    const widths = (() => { try { return JSON.parse(get(W) || "{}"); } catch (e) { return {}; } })();
    const grips = [["sideGrip", "--side-w", 236, 160, 420, 1], ["panelGrip", "--panel-w", 344, 260, 560, -1]];
    const apply = () => { for (const [id, v, def] of grips) { const w = widths[id]; root.style.setProperty(v, (w === 0 ? 0 : w || def) + "px"); const g = document.getElementById(id); if (g) { g.classList.toggle("min", w === 0); g.setAttribute("aria-valuenow", w === 0 ? 0 : w || def); } } document.body.classList.toggle("side-min", widths.sideGrip === 0); document.body.classList.toggle("panel-min", widths.panelGrip === 0); };
    const save = () => { put(W, JSON.stringify(widths)); apply(); };
    for (const [id, , def, min, max, dir] of grips) {
      const g = document.getElementById(id); if (!g) continue;
      g.setAttribute("aria-valuemin", 0); g.setAttribute("aria-valuemax", max);
      const fold = () => { widths[id] = widths[id] === 0 ? (widths["was-" + id] || def) : (widths["was-" + id] = widths[id] || def, 0); save(); };
      g.addEventListener("dblclick", fold);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); return fold(); }
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault();
        const w = widths[id] === 0 ? min : widths[id] || def; widths[id] = Math.max(min, Math.min(max, w + (e.key === "ArrowRight" ? 16 : -16) * dir)); save();
      });
      g.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return; e.preventDefault(); g.setPointerCapture(e.pointerId); g.classList.add("drag");
        const x0 = e.clientX, w0 = widths[id] === 0 ? 0 : widths[id] || def;
        const mv = (ev) => { const w = w0 + (ev.clientX - x0) * dir; widths[id] = w < min * 0.6 ? 0 : Math.max(min, Math.min(max, Math.round(w))); apply(); };
        const up = () => { g.classList.remove("drag"); g.removeEventListener("pointermove", mv); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up); if (widths[id]) widths["was-" + id] = widths[id]; save(); };
        g.addEventListener("pointermove", mv); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
      });
    }
    apply();
    // focus mode: F hides every panel around the page; F or Esc brings them back
    const chip = document.getElementById("focusChip");
    if (chip) document.addEventListener("keydown", (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey || document.body.classList.contains("at-home") || document.querySelector("dialog[open]")) return;
      const on = document.body.classList.contains("focus");
      if (e.key.toLowerCase() === "f" || (on && e.key === "Escape")) { e.preventDefault(); document.body.classList.toggle("focus", !on); chip.hidden = on; }
    });
  });
})();
