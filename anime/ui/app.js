/* Anime Desk: scenes made from manga pages, an editable shot list with the plan check, and a still animatic. */
(function () {
  "use strict";
  const P = window.AnimePlan, $ = (s, el = document) => el.querySelector(s), app = $("#app");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, opts) => { const r = await fetch(path, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || r.statusText), { data: d }); return d; };
  const send = (path, method, data) => api(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data || {}) });
  const fmt = (s) => (Math.round(s * 10) / 10).toFixed(1) + " s";
  const img = (u) => (u ? "/" + String(u).replace(/^\/+/, "") : "");
  let poll = null;

  // ---------- routing ----------
  const WIDE = matchMedia("(min-width: 1100px)"), docked = () => WIDE.matches; // a wide window: shot list left, player middle, shot editor right
  WIDE.addEventListener("change", () => { if (S && document.body.classList.contains("in-scene")) drawScene(); });
  let INTO = { show: "", episode: "" }; // where the scene being made will go
  async function route() {
    clearInterval(poll); poll = null; clearInterval(showT); Solo.on = false; Solo.t = 0; Mix.stop(); Player.park(); document.body.classList.remove("docked", "in-scene");
    const h = location.hash.replace(/^#\/?/, "").split("/");
    try {
      if (h[0] === "newin") { INTO = { show: decodeURIComponent(h[1] || ""), episode: decodeURIComponent(h[2] || "") }; return await pickProject(); } // a new scene for this show and episode
      if (h[0] === "new") return await (h[1] ? pickPages(decodeURIComponent(h[1])) : pickProject());
      INTO = { show: "", episode: "" };
      if (h[0] === "show" && h[1]) return await showPage(decodeURIComponent(h[1]));
      if (h[0] === "newshow") return await newShowPage();
      if (h[0] === "scene" && h[1]) return await scene(decodeURIComponent(h[1]));
      return await home();
    } catch (e) {
      if (e.data && e.data.broken && h[0] === "scene") return brokenScene(decodeURIComponent(h[1]), e);
      app.innerHTML = `<div class="card empty">Something went wrong: ${esc(e.message)} <p><a href="#/">Back to scenes</a></p></div>`; }
  }
  /** A scene whose plan file cannot be read: say so, and offer its earlier versions (each save of a plan keeps one in history/). */
  function brokenScene(id, e) {
    const hist = (e.data.history || []).slice(0, 30);
    app.innerHTML = `<div class="card"><h2>${esc(e.data.title || id)}</h2><p>${esc(e.message)}</p>` + (hist.length ? `<p class="small muted">Put back an earlier version of the plan (the one that cannot be read is kept too):</p><div class="list">${hist.map((n) => `<div class="tools" style="align-items:center"><span class="grow small">${esc(n.replace(/\.json$/, ""))}</span><button class="btn sm" data-restore="${esc(n)}">Put this one back</button></div>`).join("")}</div>` : `<p class="small muted">There is no earlier version of this plan.</p>`) + `<p><a href="#/">Back to scenes</a></p></div>`;
    app.querySelectorAll("[data-restore]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { await send("/api/anime/history?id=" + encodeURIComponent(id), "POST", { name: b.dataset.restore }); route(); } catch (err) { b.disabled = false; alert(err.message); } }));
  }
  addEventListener("hashchange", route);
  // something for this scene landed while this page was not watching it (after a restart, or from Create): save, then load the scene again
  addEventListener("ibasho-work-landed", async (e) => { const h = e.detail || {}; if (!S || !S.id || !String(h.link || "").endsWith("/scene/" + encodeURIComponent(S.id))) return;
    if (Object.values(S.draws || {}).some((d) => d.status === "waiting" || d.status === "drawing")) return; // its own watcher takes care of it
    try { clearTimeout(S.saveT); await save(); } catch (err) { /* reload anyway */ } route(); });

  // ---------- home: the shows, their episodes and scenes ----------
  const E = encodeURIComponent;
  const sceneRow = (s, extra) => `<div class="card row srow"><a class="rowlink" href="#/scene/${E(s.id)}">
          <div class="thumb" style="background-image:url('${esc(img(s.thumb))}')">${s.thumb ? "" : "no picture"}</div>
          <div class="grow"><div class="title">${esc(s.title)}</div>
            <div class="small muted">${s.broken ? `Its plan cannot be read: ${esc(s.broken)}` : `${s.shots} shots · ${fmt(s.seconds)}${s.drawn ? ` · ${s.drawn} drawn in the look` : ""}`}</div>
            <div style="margin-top:4px">${statusChip(s)}</div></div></a>${extra || ""}</div>`;
  const total = (list) => `${list.length} scene${list.length === 1 ? "" : "s"} · ${fmt(list.reduce((a, x) => a + x.seconds, 0))}`;
  const sheetsText = (w) => { const part = (c, one, many) => (c.all ? `${c.all} ${c.all === 1 ? one : many}${c.sheets < c.all ? ` (${c.all - c.sheets} with no sheet)` : ""}` : ""); return [part(w.people, "character", "characters"), part(w.places, "place", "places"), part(w.props, "prop", "props")].filter(Boolean).join(" · "); };
  async function home() {
    const shows = await api("/api/anime/shows"), all = shows.flatMap((w) => [...w.loose, ...w.episodes.flatMap((e) => e.scenes)]);
    app.innerHTML = `
      <div class="top"><h1>Anime</h1><span class="spacer"></span>
        <a class="btn" href="#/newshow">+ New show</a><a class="btn primary" href="#/new">+ New scene</a></div>
      ${shows.length ? shows.map((w) => `<section class="show">
        <div class="showHead"><a class="showName" href="#/show/${E(w.id)}">${esc(w.name)}</a>
          <span class="small muted grow">${[w.job && w.job.status === "running" ? "the Writer is writing it" : "", w.episodes.length ? `${w.episodes.length} episode${w.episodes.length === 1 ? "" : "s"}` : "", sheetsText(w) || "no characters or places yet", w.styled ? "" : "style not chosen"].filter(Boolean).join(" · ")}</span>
          <a class="btn sm" href="#/show/${E(w.id)}">Cast, places and style</a></div>
        ${w.episodes.map((e) => `<div class="epHead"><b>${esc(e.title)}</b><span class="small muted">${total(e.scenes)}</span>${e.planned ? `<a class="small" href="#/show/${E(w.id)}">${e.planned} planned</a>` : ""}<span class="spacer"></span><a class="btn sm ghost" href="#/newin/${E(w.id)}/${E(e.id)}">+ Scene</a></div>
          <div class="list">${e.scenes.map((x) => sceneRow(x)).join("") || `<div class="small muted epEmpty">No scenes in this episode yet.</div>`}</div>`).join("")}
        ${w.loose.length ? `${w.episodes.length ? `<div class="epHead"><b>Not in an episode</b><span class="small muted">${total(w.loose)}</span></div>` : ""}<div class="list">${w.loose.map((x) => sceneRow(x)).join("")}</div>` : ""}
        ${!w.episodes.length && !w.loose.length ? `<div class="small muted epEmpty">No scenes yet. <a href="#/newin/${E(w.id)}">Make the first scene</a>, or set up the cast, places and style first.</div>` : ""}
      </section>`).join("")
        : `<div class="card empty">Nothing here yet.<br>Start a show to set its style, cast and places first, or go straight to a scene: from a script, from nothing, or from storyboarded manga pages.</div>`}`;
    if (all.some((s) => s.job && s.job.status === "running") || shows.some((w) => w.job && w.job.status === "running")) poll = setInterval(route, 8000);
  }
  async function newShowDialog(then) {
    const name = prompt("Name of the new show"); if (!name || !name.trim()) return null;
    try { const r = await send("/api/anime/shows", "POST", { name: name.trim() }); if (then) return then(r.id); location.hash = "#/show/" + E(r.id); return r.id; } catch (e) { alert(e.message); return null; }
  }

  // ---------- a new show: a name, or an idea the Writer turns into a cast, places and episodes ----------
  async function newShowPage() {
    app.innerHTML = `<div class="top"><a class="btn ghost" href="#/">← Anime</a><h1>New show</h1></div>
      <div class="card" style="padding:12px;display:grid;gap:10px">
        <label class="field"><span>Name of the show (leave empty and the Writer names it)</span><input id="nsName" maxlength="80" placeholder="For example: Night Shift"></label>
        <label class="field"><span>What is it about? (optional)</span><textarea id="nsIdea" rows="5" maxlength="3000" placeholder="A few words or a few paragraphs. For example: a slow romance between two co-workers on the night shift of a ferry terminal."></textarea></label>
        <div class="small muted">With an idea, the Writer sets the show up for you in about 3 to 6 minutes: what it is about, its characters and places with descriptions, and the first three episodes with planned scenes. You can change every word after. With no idea you get an empty show to fill in yourself.</div>
        <div class="tools"><button class="btn primary" id="nsGo">Make the show</button></div></div>`;
    $("#nsGo").onclick = async () => { const name = $("#nsName").value.trim(), idea = $("#nsIdea").value.trim(); if (!name && !idea) return alert("Give the show a name, or say what it is about.");
      $("#nsGo").disabled = true; try { const r = await send("/api/anime/shows", "POST", { name, idea }); location.hash = "#/show/" + E(r.id); } catch (e) { alert(e.message); $("#nsGo").disabled = false; } };
  }

  // ---------- a show: its episodes and scenes, and its look (style, cast, places, props) ----------
  let showT = null, W = null; // W: { id, show: { episodes }, scenes }
  async function showPage(id) {
    const d = await api("/api/anime/show?show=" + E(id));
    W = { id, show: d.show, scenes: d.scenes, job: d.job, videos: d.videos || {} };
    S = { show: id, id: "", scene: { title: d.look.name }, plan: { shots: [] }, look: d.look, looks: [], templates: d.templates || [], people: d.people || [], draws: d.draws || {}, defaultLook: d.defaultLook || "", takes: {}, open: new Set() };
    app.innerHTML = `<div class="top"><a class="btn ghost" href="#/">← Anime</a><h1 class="grow">${esc(d.look.name)}</h1><a class="btn primary" href="#/newin/${E(id)}">+ New scene</a></div>
      ${d.job && d.job.status !== "done" ? `<div class="card problems" style="border-color:${d.job.status === "failed" ? "var(--red)" : "var(--line)"}"><b>${d.job.kind === "episode" ? (d.job.status === "running" ? "Making the episode's video" : "The episode's video could not be made") : d.job.status === "running" ? "The Writer is at work" : "The Writer could not finish"}</b><div class="small" id="showJob">${esc(jobText(d.job))}</div>${d.job.status === "running" ? `<div class="small muted">${d.job.kind === "episode" ? "Its link appears on the episode when it is done." : "The cast, places and episodes appear here when it is done."} You can leave this screen.</div>` : ""}</div>` : ""}
      <label class="field"><span>What the show is about</span><textarea id="showAbout" rows="2" maxlength="600" placeholder="One or two sentences: whose story it is and what they want">${esc(d.show.about)}</textarea></label>
      <div class="tools" style="margin:8px 0 0"><button class="btn sm" id="showMore" ${d.job && d.job.status === "running" ? "disabled" : ""}>Ask the Writer${d.show.episodes.length || Object.keys(d.look.cast).length ? " for more" : " to set it up"}…</button></div>
      <h2>Episodes and scenes</h2><div id="eps"></div>
      <h2>Style, cast, places and props</h2>
      <div class="small muted" style="margin-bottom:8px">Settle these once for the whole show. Every scene of “${esc(d.look.name)}” is drawn this way, and each character, place and prop sheet goes along with the shots it is in.</div>
      <div class="card problems" id="look"></div>`;
    drawEps(); wireEps(); drawLook(); wireLook(); watchShow();
    $("#showAbout").oninput = (e) => { W.show.about = e.target.value; saveEps(); };
    $("#showMore").onclick = async () => { const first = !W.show.episodes.length && !Object.keys(S.look.cast).length;
      const idea = prompt(first ? "What is the show about? The Writer adds characters, places and the first three episodes." : "What should the Writer add? It writes the next three episodes and any new people and places they need.", first ? W.show.about : "");
      if (!idea || !idea.trim()) return; await saveEps(true); try { await send("/api/anime/showidea?show=" + E(id), "POST", { idea }); } catch (err) { return alert(err.message); } showPage(id); };
    if (d.job && d.job.status === "running") poll = setInterval(async () => { const n = await api("/api/anime/show?show=" + E(id)).catch(() => null); if (!n || location.hash.indexOf("#/show/") !== 0) return;
      if (!n.job || n.job.status !== "running") { clearInterval(poll); poll = null; return showPage(id); } const m = $("#showJob"); if (m) m.textContent = jobText(n.job); }, 6000);
  }
  function drawEps() {
    const el = $("#eps"); if (!el || !W) return; const by = (i) => W.scenes.find((x) => x.id === i), inEp = new Set(W.show.episodes.flatMap((e) => e.scenes)), loose = W.scenes.filter((x) => !inEp.has(x.id));
    const mover = (x, ei, si, n) => `<div class="mv"><select data-move="${esc(x.id)}" class="btn sm" aria-label="Which episode ${esc(x.title)} is in"><option value="">Not in an episode</option>${W.show.episodes.map((e, k) => `<option value="${esc(e.id)}" ${k === ei ? "selected" : ""}>${esc(e.title)}</option>`).join("")}</select>
      ${ei >= 0 ? `<button class="btn sm" data-up="${ei}:${si}" ${si ? "" : "disabled"} aria-label="Earlier in the episode">↑</button><button class="btn sm" data-down="${ei}:${si}" ${si < n - 1 ? "" : "disabled"} aria-label="Later in the episode">↓</button>` : ""}</div>`;
    el.innerHTML = W.show.episodes.map((e, ei) => { const list = e.scenes.map(by).filter(Boolean);
      return `<div class="card ep"><div class="epHead"><input data-eptitle="${ei}" value="${esc(e.title)}" maxlength="80" aria-label="Name of this episode"><span class="small muted">${total(list)}</span><span class="spacer"></span>
        <button class="btn sm" data-epup="${ei}" ${ei ? "" : "disabled"} aria-label="Move this episode earlier">↑</button><button class="btn sm" data-epdown="${ei}" ${ei < W.show.episodes.length - 1 ? "" : "disabled"} aria-label="Move this episode later">↓</button>
        <a class="btn sm" href="#/newin/${E(W.id)}/${E(e.id)}">+ Scene</a><button class="btn sm" data-epdel="${ei}">Remove</button></div>
        <div class="tools epVid" style="align-items:center"><button class="btn sm" data-epvideo="${ei}" ${list.length && !(W.job && W.job.status === "running") ? "" : "disabled"} title="All of this episode's scenes, in order, as one video file">Make the episode's video</button>
          ${W.videos[e.id] ? `<span class="small">Latest: <a href="${esc(img(W.videos[e.id].url))}" target="_blank" rel="noopener">Play</a> · <a href="${esc(img(W.videos[e.id].url))}" download="${esc(W.videos[e.id].name)}">Download</a> <span class="muted">(${(W.videos[e.id].size / 1e6).toFixed(1)} MB, ${new Date(W.videos[e.id].at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})</span></span>` : ""}</div>
        <textarea class="epSum" data-epsum="${ei}" rows="3" maxlength="800" placeholder="What happens in this episode (optional)">${esc(e.summary || "")}</textarea>
        <div class="list">${list.map((x, si) => sceneRow(x, mover(x, ei, si, list.length))).join("") || ((e.ideas || []).length ? "" : `<div class="small muted epEmpty">No scenes in this episode yet.</div>`)}</div>
        ${(e.ideas || []).length ? `<div class="small muted" style="margin:10px 0 4px">Planned scenes (not made yet)</div>${e.ideas.map((x, k) => `<div class="idea"><div class="grow"><b>${esc(x.title)}</b><div class="small">${esc(x.idea)}</div></div>
          <div class="tools"><button class="btn sm primary" data-write="${ei}:${k}">Write this scene</button><button class="btn sm" data-ideadel="${ei}:${k}">Remove</button></div></div>`).join("")}` : ""}</div>`; }).join("")
      + (loose.length ? `<div class="card ep"><div class="epHead"><b>${W.show.episodes.length ? "Not in an episode" : "Scenes"}</b><span class="small muted">${total(loose)}</span></div><div class="list">${loose.map((x) => sceneRow(x, W.show.episodes.length ? mover(x, -1, 0, 0) : "")).join("")}</div></div>` : "")
      + (!W.scenes.length && !W.show.episodes.length ? `<div class="card empty">No scenes yet. Add an episode to plan the show, or make a scene straight away.</div>` : "")
      + `<div class="tools" style="margin-top:8px"><button class="btn" id="epAdd">+ Add an episode</button></div>`;
  }
  let epT = null;
  const putEps = () => send("/api/anime/show?show=" + E(W.id), "PUT", { episodes: W.show.episodes }).catch((e) => alert("The episodes could not be saved: " + e.message));
  const saveEps = (now) => { clearTimeout(epT); if (now) return putEps(); epT = setTimeout(putEps, 500); };
  function wireEps() {
    const el = $("#eps"); if (!el) return; const eps = () => W.show.episodes, swap = (a, i, j) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
    el.addEventListener("input", (e) => { const t = e.target.closest("[data-eptitle]"); if (t) { eps()[+t.dataset.eptitle].title = t.value; saveEps(); }
      const u = e.target.closest("[data-epsum]"); if (u) { eps()[+u.dataset.epsum].summary = u.value; saveEps(); } });
    el.addEventListener("change", async (e) => { const m = e.target.closest("[data-move]"); if (!m) return;
      await saveEps(true); try { await send("/api/anime/place?id=" + E(m.dataset.move), "POST", { show: W.id, episode: m.value }); const d = await api("/api/anime/show?show=" + E(W.id)); W.show = d.show; W.scenes = d.scenes; } catch (err) { alert(err.message); } drawEps(); });
    el.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const d = b.dataset;
      if (b.id === "epAdd") { let n = eps().length + 1, id = "ep" + n; while (eps().some((x) => x.id === id)) id = "ep" + ++n; eps().push({ id, title: "Episode " + (eps().length + 1), scenes: [] }); }
      else if (d.epup != null) swap(eps(), +d.epup, +d.epup - 1);
      else if (d.epdown != null) swap(eps(), +d.epdown, +d.epdown + 1);
      else if (d.epdel != null) { const ep = eps()[+d.epdel]; if (ep.scenes.length && !confirm(`Remove “${ep.title}”? Its ${ep.scenes.length} scene${ep.scenes.length === 1 ? " stays" : "s stay"} in the show, in no episode.`)) return; eps().splice(+d.epdel, 1); }
      else if (d.epvideo != null) { b.disabled = true; return (async () => { await saveEps(true); try { await send(`/api/anime/episode?show=${E(W.id)}&ep=${E(eps()[+d.epvideo].id)}&subs=${localStorage.getItem("ibasho.exportSubs") === "0" ? 0 : 1}&shape=${E(expShape())}&twos=${localStorage.getItem("ibasho.exportTwos") === "1" ? 1 : 0}`, "POST"); } catch (err) { alert(err.message); } showPage(W.id); })(); }
      else if (d.ideadel != null) { const [ei, k] = d.ideadel.split(":").map(Number); eps()[ei].ideas.splice(k, 1); }
      else if (d.write != null) { const [ei, k] = d.write.split(":").map(Number), x = eps()[ei].ideas[k]; b.disabled = true;
        return (async () => { await saveEps(true); try { const r = await send("/api/anime/scenes", "POST", { title: x.title, idea: x.idea, show: W.id, episode: eps()[ei].id, planned: k }); location.hash = "#/scene/" + E(r.id); } catch (err) { alert(err.message); b.disabled = false; } })(); }
      else if (d.up != null || d.down != null) { const [ei, si] = (d.up != null ? d.up : d.down).split(":").map(Number); swap(eps()[ei].scenes, si, si + (d.up != null ? -1 : 1)); }
      else return;
      saveEps(true); drawEps(); });
  }
  function watchShow() { // while a sheet is being drawn from the show's screen: take it as it lands
    clearInterval(showT); if (!S || !S.show || !Object.keys(S.draws).some(active)) return; const id = S.show;
    showT = setInterval(async () => { if (!S || S.show !== id) return clearInterval(showT);
      const d = await api("/api/anime/draws?show=" + E(id)).catch(() => null); if (!d) return;
      const sig = (x) => Object.keys(x).map((k) => k + x[k].status).join(), same = sig(d) === sig(S.draws);
      for (const k of Object.keys(d)) if (k.startsWith("sheet:") && active(k) && d[k].status === "done" && d[k].url && S.look.cast[k.slice(6)]) S.look.cast[k.slice(6)].sheet = d[k].url;
      S.draws = d; if (!same) drawLook(); if (!Object.keys(d).some(active)) clearInterval(showT); }, 6000);
  }
  const ctx = () => (S.show ? "show=" + E(S.show) : "id=" + E(S.id)); // the look is edited from a scene or from its show

  function statusChip(s) {
    const what = { blocking: "Blocking pass", previs: "Previs pass", render: "Render", writing: "The Writer", export: "Video export" }[s.job && s.job.kind] || "Blocking pass";
    if (s.job && s.job.status === "running") return `<span class="chip busy">${what} running</span>`;
    if (s.job && s.job.status === "failed") return `<span class="chip bad">${what} failed</span>`;
    if (!s.errors) return `<span class="chip ok">Plan check passes</span>`;
    return `<span class="chip ${s.blocked ? "bad" : ""}">${s.blocked ? s.errors + " problems" : "Draft: needs the Blocking pass"}</span>`;
  }

  // ---------- new scene ----------
  async function pickProject() {
    const projects = await api("/api/anime/projects");
    app.innerHTML = `
      <div class="top"><a class="btn ghost" href="${INTO.show ? "#/show/" + E(INTO.show) : "#/"}">← Back</a><h1>New scene</h1></div>
      <div class="card" style="padding:12px;margin-bottom:16px;display:grid;gap:10px">
        <b>Where it goes</b>
        <div class="tools"><label class="field" style="flex:1;min-width:180px"><span>Show</span><select id="intoShow"></select></label>
          <label class="field" style="flex:1;min-width:180px"><span>Episode</span><select id="intoEp"></select></label></div>
        <div class="small muted" id="intoHint"></div>
      </div>
      <div class="card" style="padding:12px;margin-bottom:16px;display:grid;gap:10px">
        <b>Start without a manga</b>
        <div class="small muted">Give the scene a name. Paste a script if you have one: each paragraph becomes a shot and “NAME: words” becomes a spoken line. With no script you get one empty shot to build from. You add your own pictures and sound on the next screen.</div>
        <label class="field"><span>Scene name</span><input id="ownTitle" maxlength="80" placeholder="For example: Rooftop, night"></label>
        <label class="field"><span>Script (optional)</span><textarea id="ownScript" rows="6" placeholder="The rain has stopped. Mara waits by the rail.&#10;MARA: You came.&#10;TOBIAS: I said I would."></textarea></label>
        <div class="tools"><button class="btn primary" id="ownGo">Make the scene</button></div>
      </div>
      <div class="card" style="padding:12px;margin-bottom:16px;display:grid;gap:10px">
        <b>Or start from an idea</b>
        <div class="small muted">Say what happens in a few sentences. The Writer writes the script with the show's characters and places (about 2 to 4 minutes), and each paragraph becomes a shot. You can change every word after.</div>
        <label class="field"><span>Scene name</span><input id="ideaTitle" maxlength="80" placeholder="For example: The last ferry"></label>
        <label class="field"><span>What happens</span><textarea id="ideaText" rows="4" maxlength="3000" placeholder="For example: Closing time. She finds his umbrella left behind and runs after him in the rain; he has already gone, so she keeps it."></textarea></label>
        <div class="tools"><button class="btn primary" id="ideaGo">Write the scene</button></div>
      </div>
      <div class="card" style="padding:12px;margin-bottom:16px;display:grid;gap:10px">
        <b>Or start from video clips</b>
        <div class="small muted">Pick the clips of one scene (mp4, mov or webm), made anywhere. Each becomes a shot of the clip's length, in the order of their file names, with the clip's own sound on a “Clip sound” layer. You can reorder, trim, add music and voices, then export the finished video.</div>
        <label class="field"><span>Scene name</span><input id="clipsTitle" maxlength="80" placeholder="For example: Opening"></label>
        <label class="field"><span>The clips</span><input type="file" id="clipsFiles" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" multiple></label>
        <div class="tools" style="align-items:center"><button class="btn primary" id="clipsGo">Make the scene from these clips</button><span class="small muted" id="clipsMsg"></span></div>
      </div>
      <h2>Or animate manga pages</h2>
      <div class="list">${projects.map((p) => `
        <a class="card row" href="#/new/${encodeURIComponent(p.id)}" style="color:inherit;text-decoration:none">
          <div class="thumb" style="background-image:url('${esc(img((p.pages.find((x) => x.thumb) || {}).thumb))}')"></div>
          <div class="grow"><div class="title">${esc(p.title)}</div>
          <div class="small muted">${p.pages.length} pages · ${p.pages.reduce((a, x) => a + x.drawn, 0)} of ${p.pages.reduce((a, x) => a + x.panels, 0)} panels drawn</div></div></a>`).join("") || `<div class="card empty">No storyboarded manga yet.</div>`}</div>`;
    wireOwn(); wireInto(await api("/api/anime/shows"));
  }
  function wireInto(shows) {
    const sh = $("#intoShow"), ep = $("#intoEp"); if (!sh) return;
    const fill = () => { const w = shows.find((x) => x.id === INTO.show);
      sh.innerHTML = `<option value="">A new show, named after this scene</option>${shows.map((x) => `<option value="${esc(x.id)}" ${x.id === INTO.show ? "selected" : ""}>${esc(x.name)}</option>`).join("")}<option value="+">+ A new show…</option>`;
      ep.innerHTML = `<option value="">Not in an episode</option>${(w ? w.episodes : []).map((e) => `<option value="${esc(e.id)}" ${e.id === INTO.episode ? "selected" : ""}>${esc(e.title)}</option>`).join("")}`; ep.disabled = !w || !w.episodes.length;
      $("#intoHint").textContent = w ? `It is drawn in the style of “${w.name}”, with that show's character, place and prop sheets.` : "A scene made from manga pages joins its manga series' show. Any other scene starts a show of its own; you can move it later."; };
    fill();
    sh.onchange = async () => { if (sh.value === "+") { const id = await newShowDialog((i) => i); if (id) { shows.push({ id, name: (await api("/api/anime/show?show=" + E(id))).look.name, episodes: [] }); INTO = { show: id, episode: "" }; } } else INTO = { show: sh.value, episode: "" }; fill(); };
    ep.onchange = () => { INTO.episode = ep.value; };
  }
  function wireOwn() {
    const ig = $("#ideaGo"); if (ig) ig.onclick = async () => { if (!$("#ideaText").value.trim()) return alert("Say what happens in the scene first.");
      ig.disabled = true; try { const r = await send("/api/anime/scenes", "POST", { title: $("#ideaTitle").value, idea: $("#ideaText").value, show: INTO.show, episode: INTO.episode }); location.hash = "#/scene/" + E(r.id); } catch (e) { alert(e.message); ig.disabled = false; } };
    const cg = $("#clipsGo"); if (cg) cg.onclick = async () => { const files = [...$("#clipsFiles").files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); if (!files.length) return alert("Pick the video clips first.");
      cg.disabled = true; const msg = $("#clipsMsg");
      try { const r = await send("/api/anime/scenes", "POST", { title: $("#clipsTitle").value || files[0].name.replace(/\.\w+$/, ""), show: INTO.show, episode: INTO.episode }), d = await api("/api/anime/scene?id=" + E(r.id)), base = d.plan.shots[0], shots = [], bad = [];
        for (let i = 0; i < files.length; i++) { msg.textContent = `Adding clip ${i + 1} of ${files.length}…`;
          try { const up = await fetch(`/api/anime/upload?id=${E(r.id)}&kind=clip&name=${E(files[i].name)}`, { method: "POST", body: files[i] }), u = await up.json(); if (!up.ok) throw new Error(u.error || "could not be added");
            const sh = { ...JSON.parse(JSON.stringify(base)), shot_id: "S" + String(shots.length + 1).padStart(3, "0"), source_ids: ["clip:" + files[i].name], scene_type: "action", action: files[i].name.replace(/\.\w+$/, "").replace(/[_-]+/g, " "), lines: [], still: "" }; setClip(sh, u); shots.push(sh); }
          catch (err) { bad.push(files[i].name + ": " + err.message); } }
        if (!shots.length) throw new Error("None of the clips could be added. " + bad.join("; "));
        d.plan.shots = shots; await send("/api/anime/plan?id=" + E(r.id), "PUT", d.plan); if (bad.length) alert("These were left out:\n" + bad.join("\n")); location.hash = "#/scene/" + E(r.id); }
      catch (e) { alert(e.message); cg.disabled = false; msg.textContent = ""; } };
    const go = $("#ownGo"); if (!go) return;
    go.onclick = async () => {
      go.disabled = true;
      try { const r = await send("/api/anime/scenes", "POST", { title: $("#ownTitle").value, script: $("#ownScript").value, show: INTO.show, episode: INTO.episode }); location.hash = "#/scene/" + encodeURIComponent(r.id); }
      catch (e) { alert(e.message); go.disabled = false; }
    };
  }
  async function pickPages(id) {
    const p = (await api("/api/anime/projects")).find((x) => x.id === id);
    if (!p) throw new Error("That manga project is gone.");
    app.innerHTML = `
      <div class="top"><a class="btn ghost" href="#/new">← Back</a><h1>${esc(p.title)}</h1></div>
      <p class="small muted">Tick the pages of one scene. Each panel becomes a shot. Undrawn panels play as grey cards in the animatic.</p>
      <div class="list" id="pages">${p.pages.map((g, i) => `
        <label class="card pick"><input type="checkbox" value="${esc(g.id)}" data-i="${i}">
          <div class="thumb" style="background-image:url('${esc(img(g.thumb))}')">${g.thumb ? "" : "not drawn"}</div>
          <div class="grow"><div class="title">${esc(g.label)}</div><div class="small muted">${g.panels} panels · ${g.drawn} drawn</div>
          <div class="small" style="margin-top:2px">${esc(g.note)}</div></div></label>`).join("")}</div>
      <div class="card" style="padding:12px;margin-top:12px;position:sticky;bottom:8px">
        <label class="field"><span>Scene name (optional)</span><input id="title" placeholder="For example: Karaoke booth"></label>
        <div class="tools" style="margin-top:10px"><span class="small muted grow" id="count">No pages ticked</span><button class="btn primary" id="make" disabled>Make the shot list</button></div></div>`;
    let last = null;
    const boxes = [...app.querySelectorAll("#pages input")];
    const update = () => { const n = boxes.filter((b) => b.checked); $("#count").textContent = n.length ? `${n.length} page${n.length > 1 ? "s" : ""}, ${n.reduce((a, b) => a + p.pages[+b.dataset.i].panels, 0)} shots` : "No pages ticked"; $("#make").disabled = !n.length; };
    boxes.forEach((b) => b.addEventListener("click", (e) => { // shift-click ticks a run of pages
      if (e.shiftKey && last != null) { const [a, z] = [last, +b.dataset.i].sort((x, y) => x - y); for (let i = a; i <= z; i++) boxes[i].checked = b.checked; }
      last = +b.dataset.i; update(); }));
    $("#make").onclick = async () => {
      $("#make").disabled = true; $("#make").textContent = "Making…";
      try { const r = await send("/api/anime/scenes", "POST", { project: id, pageIds: boxes.filter((b) => b.checked).map((b) => b.value), title: $("#title").value, show: INTO.show, episode: INTO.episode });
        location.hash = "#/scene/" + encodeURIComponent(r.id); }
      catch (e) { alert(e.message); $("#make").disabled = false; $("#make").textContent = "Make the shot list"; }
    };
  }

  // ---------- a scene: summary, scene cards, shot list ----------
  let S = null; // { id, scene, plan, check, job, open:Set, saveT }
  // ---------- the Assistant on the anime screens (studio.js): what is open, and the actions it may propose ----------
  const AS = window.AnimeSteps;
  const shotIdx = (id) => AS.idx(S && S.plan, id);
  function openShot(id) { const i = shotIdx(id); if (docked()) return select(i); S.open.add(S.plan.shots[i].shot_id); redrawShot(i); const c = document.querySelector(`.shot[data-i="${i}"]`); if (c) c.scrollIntoView({ block: "center" }); }
  const vidCost = (id) => { const m = MODELS.video; if (!m || !S) return 0; const s = S.plan.shots[shotIdx(id)]; return m.perSecond != null ? m.perSecond * vidLen(m, +s.duration || 3) : 0; };
  // ----- shot-level steps for the Assistant (20 Nov 2026): each changes only the shots named, at once, and Undo takes it back -----
  let asUndo = []; // { scene, plan (as text), what }: the plan as it was before each step, newest last
  function drawAsUndo() { const b = $("#asUndo"); if (!b) return; const mine = asUndo.filter((u) => S && u.scene === S.id), last = mine[mine.length - 1]; b.hidden = !last; b.disabled = busy(); if (last) b.title = "Takes back: " + last.what; }
  function asNeed() { if (!S || !S.plan) throw new Error("No scene is open."); if (busy()) throw new Error(`The ${JOB[S.job.kind] || "Blocking pass"} is rewriting this scene's plan: editing waits until it finishes.`); }
  /** Run one step from anime/core/steps.js on the open scene: the plan as it was is kept for Undo, the shot it changed is shown,
   *  and the sentence it returns is what really happened (the Assistant's button and the model are given exactly that). */
  function asStep(fn, label) {
    return (a) => { asNeed(); const was = JSON.stringify(S.plan), r = fn(S.plan, a || {});
      if (r.same) return r.msg;
      asUndo.push({ scene: S.id, plan: was, what: label(a || {}) }); if (asUndo.length > 30) asUndo.shift();
      if (S.vsent) S.vsent = {}; // the video words shown are out of date
      S.sel = r.shot; if (!docked()) S.open.add(r.shot);
      changed(true); drawAsUndo();
      const c = document.querySelector(`#shots .shot[data-i="${S.plan.shots.findIndex((x) => x.shot_id === r.shot)}"]`); if (c && !docked()) c.scrollIntoView({ block: "center" });
      return r.msg + " Undo takes it back."; };
  }
  function asUndoLast() {
    asNeed(); let k = -1; for (let i = asUndo.length - 1; i >= 0; i--) if (asUndo[i].scene === S.id) { k = i; break; }
    if (k < 0) throw new Error("There is no step of the Assistant's to take back in this scene.");
    const u = asUndo.splice(k, 1)[0], now = S.plan, old = JSON.parse(u.plan);
    for (const s of old.shots) { const n = now.shots.find((x) => x.shot_id === s.shot_id); if (!n) continue; for (const f of ["still", "clip", "clip_dur", "clip_from", "clip_sound", "clip_poster", "clip_takes"]) if (n[f] !== undefined && s[f] === undefined) s[f] = n[f]; } // a picture or clip that landed since stays
    S.plan = old; if (S.vsent) S.vsent = {}; changed(true); drawAsUndo();
    return `Taken back: ${u.what}. The scene has ${S.plan.shots.length} shot${S.plan.shots.length === 1 ? "" : "s"} again.`;
  }
  /** What the Assistant is shown: every shot with its lines (and their ids), cut shorter only when a very long scene would pass the size limit. */
  function assistantWhere() {
    if (!S || !S.plan) return { screen: "anime", note: "No scene is open (the list of scenes or a show's page)." };
    const build = (cut) => ({ screen: "anime", scene: S.id, title: S.scene.title || S.plan.title, open: { shot: S.sel || null }, total_seconds: Math.round(S.plan.shots.reduce((n, s) => n + (+s.duration || 0), 0) * 10) / 10,
      models: { stills: MODELS.picture ? MODELS.picture.name + (MODELS.picture.quality ? " (" + MODELS.picture.quality + ")" : "") : "Codex", video: MODELS.video ? MODELS.video.name : "none picked" },
      voices: S.look ? Object.keys(S.look.cast || {}).filter((n) => S.look.cast[n].voice) : [],
      plan_check: { errors: S.check.errors.length, warnings: S.check.warnings.length }, busy: busy() ? "a pass is rewriting the plan: nothing can be edited until it finishes" : undefined,
      note: "Shots are listed in playing order. A line is written as its id, then who says it.",
      shots: S.plan.shots.map((s) => ({ id: s.shot_id, seconds: +s.duration || 0, type: s.scene_type || undefined, framing: (s.camera && s.camera.framing) || "", move: (s.camera && s.camera.move) || "", action: String(s.action || "").slice(0, cut), has_picture: !!s.still, drawn_in_look: isAnime(s), has_video: !!s.clip,
        joins_before: s.join ? (s.join === "wipe" ? "hidden wipe" : "match move") + (s.join_cover ? ": " + s.join_cover : "") : undefined, long_take: s.long_take ? true : undefined, beats: String(s.beats || "").split("\n").filter((x) => x.trim()).length || undefined,
        lines: (s.lines || []).map((id) => { const l = lineOf(id); return l ? `${id} ${l.speaker || "caption"}: ${String(l.text || "").slice(0, cut)}` : ""; }).filter(Boolean) })) });
    for (const cut of [1200, 600, 300, 160]) { const w = build(cut); if (JSON.stringify(w).length < 56000 || cut === 160) return w; }
  }
  if (window.Ibasho && window.Ibasho.registerAssistant) { const hasShot = (a) => { if (!S || !S.plan) return "No scene is open."; return AS.has(S.plan, a.shot); }, given = (a, ks) => ks.filter((k) => a[k] != null && String(a[k]).trim()).join(", ") || "nothing given";
    window.Ibasho.registerAssistant({ where: assistantWhere, actions: {
      open_shot: { desc: "Show one shot (its picture, video and settings)", args: { shot: "shot id" }, auto: true, check: hasShot, label: (a) => `Open shot ${a.shot}`, run: (a) => { openShot(a.shot); } },
      edit_shot: { desc: "Change ONE shot's plan: what happens (action), the framing (for example close-up, wide), the camera move and the reason for it, the shot type, or its length in seconds. Give only what changes. The spoken lines are the script's own words and cannot be changed here. Free, at once; a drawn picture or made video stays until it is made again.",
        args: { shot: "shot id", action: "optional: what happens", framing: "optional", move: "optional camera move", move_reason: "optional: why the camera moves", type: "optional: " + Object.keys(P.TARGETS).join(" | "), seconds: "optional number" }, check: hasShot,
        label: (a) => `Change shot ${a.shot}: ${given(a, ["action", "framing", "move", "move_reason", "type", "seconds"])}`, run: asStep((p, a) => AS.edit(p, a, Object.keys(P.TARGETS)), (a) => `the change to shot ${a.shot}`) },
      split_shot: { desc: "Make ONE shot into two, one after the other. Free, at once, only that shot changes. The time is shared half and half, or seconds = the first part's length. Its lines stay on the first part, or line = the id of the first line that goes to the second part (it and the lines after it). The second part starts as a copy: follow with edit_shot to say what it shows.",
        args: { shot: "shot id", line: "optional line id: it and the lines after it go to the second part", seconds: "optional: the first part's length" }, check: hasShot, label: (a) => `Split shot ${a.shot} in two`, run: asStep(AS.split, (a) => `the split of shot ${a.shot}`) },
      join_shots: { desc: "Make a shot and the shot AFTER it into one shot: the lengths add up, the lines follow each other, the first shot's picture is kept. Free, at once. Not for shots that have a video clip.", args: { shot: "the first of the two shots" }, check: hasShot,
        label: (a) => `Join shot ${a.shot} with the shot after it`, run: asStep(AS.join, (a) => `the join of shot ${a.shot} with the shot after it`) },
      move_shot: { desc: "Move one shot one place earlier or later (it changes places with its neighbour). Free, at once. Two shots that both carry lines cannot change places: the script stays in order.", args: { shot: "shot id", to: "earlier | later" }, check: hasShot,
        label: (a) => `Move shot ${a.shot} one place ${/^(earlier|before|up|prev)/i.test(String(a.to)) ? "earlier" : "later"}`, run: asStep(AS.move, (a) => `the move of shot ${a.shot}`) },
      set_join: { desc: "Set how a shot's video joins the shot BEFORE it: cut (plain), wipe (a hidden wipe: something fills the frame at the end of one shot and the start of the next; cover = what fills it) or match (a match move: cover = the movement both shots share). reason = why the cut is hidden or the move carried on. Free, at once; it changes the words sent to the video model for both shots.",
        args: { shot: "shot id (not the first shot)", how: "cut | wipe | match", cover: "for wipe or match", reason: "optional" }, check: hasShot, label: (a) => `Shot ${a.shot}: join the shot before with ${AS.JOIN_NAME[{ cut: "", wipe: "wipe", match: "match" }[String(a.how || "").toLowerCase()] || ""] || String(a.how)}`, run: asStep(AS.setJoin, (a) => `the join set on shot ${a.shot}`) },
      long_take: { desc: "Turn the Long take tick on or off for one shot. A long take is for talk: one 10 to 15 s video clip with 3 to 5 beats instead of many short clips. Free, at once.", args: { shot: "shot id", on: "yes | no" }, check: hasShot,
        label: (a) => `Shot ${a.shot}: long take ${/^(no|off|false|0)$/i.test(String(a.on).trim()) ? "off" : "on"}`, run: asStep(AS.longTake, (a) => `the Long take tick on shot ${a.shot}`) },
      undo_step: { desc: "Take back the last step of yours that changed this scene's shots (edit, split, join, move, join setting, long take).", args: {}, check: () => (S && asUndo.some((u) => u.scene === S.id) ? "" : "There is no step to take back in this scene."), label: () => "Take back the last step", run: asUndoLast },
      draw_shot: { desc: "Draw or redraw a shot's still in the show's look with the stills model. note = the person's direction for the picture.", args: { shot: "shot id", note: "optional direction" }, paid: true, cost: () => stillCost(1), check: hasShot,
        label: (a) => `Draw shot ${a.shot}${a.note ? ": " + String(a.note).slice(0, 60) : ""}`,
        run: async (a) => { const s = S.plan.shots[shotIdx(a.shot)]; if (a.note) s.draw_note = String(a.note); await flush(); await ask(s.shot_id, true); return "Queued: the new still lands on the shot when it is drawn."; } },
      make_video: { desc: "Turn a shot's picture into a video clip with the video model (the shot must have a picture). note = the person's direction for the motion.", args: { shot: "shot id", note: "optional direction for the motion" }, paid: true, cost: (a) => { try { return vidCost(a.shot); } catch (e) { return 0; } }, check: hasShot,
        label: (a) => `Make a video of shot ${a.shot}${a.note ? ": " + String(a.note).slice(0, 60) : ""}`,
        run: async (a) => { const s = S.plan.shots[shotIdx(a.shot)]; if (!s.still) throw new Error("Shot " + a.shot + " has no picture yet: draw it first."); if (!MODELS.video) throw new Error("Pick a video model first (the Video button above the shots)."); if (a.note) s.video_note = String(a.note); await askVideo(s, true); return "Started: the clip lands on the shot in a few minutes."; } },
      plan_again: { desc: "LAST RESORT: run the Blocking pass again on the WHOLE scene with a note. EVERY shot is planned again, it takes 10 to 20 minutes, and changes made by hand to the shots are replaced (the plan as it is now is kept under Versions). Never use it to change one shot or a few: use edit_shot, split_shot, join_shots, move_shot, set_join or long_take.", args: { note: "what to change" },
        label: (a) => `Plan the WHOLE scene again${a.note ? ": " + String(a.note).slice(0, 60) : ""}`,
        run: async (a) => { asNeed(); if (running()) throw new Error(`Not started: the ${JOB[S.job.kind] || "Blocking pass"} is still running on this scene.`);
          const n = S.plan.shots.length, pics = S.plan.shots.filter((s) => s.still).length, vids = S.plan.shots.filter((s) => s.clip).length;
          if (!confirm(`Plan the WHOLE scene again?\n\nAll ${n} shots are planned again by the Blocking agent. It takes 10 to 20 minutes, and the shots cannot be edited while it runs.` + (pics || vids ? `\n${pics} picture${pics === 1 ? "" : "s"}${vids ? ` and ${vids} video clip${vids === 1 ? "" : "s"}` : ""} may not land on the same shots.` : "") + "\nThe plan as it is now is kept under Versions.\n\nTo change one shot, cancel and ask for that shot only.")) throw new Error("Not started: you cancelled. Nothing changed.");
          clearTimeout(S.saveT); await save(); await send("/api/anime/block?id=" + encodeURIComponent(S.id), "POST", { note: String(a.note || "") }); scene(S.id);
          return "Started. Nothing has changed yet: the new plan loads when the Blocking pass is done, in 10 to 20 minutes."; } },
    } }); }
  async function scene(id, keepOpen) {
    const d = await api("/api/anime/scene?id=" + encodeURIComponent(id)), keepSel = S && S.id === id ? { sel: S.sel, tab: S.tab } : {}; // a reload keeps the picked shot and tab
    S = { id, scene: d.scene, plan: d.plan, check: d.check, job: d.job, previs: d.previs || {}, sound: d.sound && Array.isArray(d.sound.clips) ? d.sound : { clips: [] }, exports: d.exports || [], look: d.look || { id: "", name: "", text: "", refs: [], cast: {} }, own: d.ownStyle || { on: false, template: "", text: "", refs: [] }, looks: d.looks || [], templates: d.templates || [], people: d.people || [], takes: d.takes || {}, ck: d.assetCheck || null, sent: {}, defaultLook: d.defaultLook || "", draws: d.draws || {}, open: keepOpen || new Set(), saveT: null, sndT: null };
    Object.assign(S, keepSel); drawScene(); watchDraws();
    if (S.job && S.job.status === "running") poll = setInterval(async () => {
      const n = await api("/api/anime/scene?id=" + encodeURIComponent(id)).catch(() => null);
      if (!n) return;
      if (!n.job || n.job.status !== "running") { clearInterval(poll); poll = null; scene(id); return; }
      S.job = n.job; const m = $("#jobMsg"); if (m) m.textContent = jobText(n.job);
    }, 6000);
  }
  const running = () => S.job && S.job.status === "running";
  const busy = () => running() && (S.job.kind === "blocking" || S.job.kind === "writing"); // the Blocking pass and the Writer rewrite the plan: editing waits for them
  const JOB = { blocking: "Blocking pass", previs: "Previs pass (3D)", render: "Render", writing: "The Writer", export: "Video export" };
  function jobText(j) { const min = Math.max(0, Math.round((Date.now() - j.at) / 60000)); return (j.msg || "Planning shots") + (j.status === "running" ? ` · ${min} min so far` : ""); }

  function drawScene() {
    const { plan, check } = S, by = shotProblems(), dk = docked();
    Player.park(); document.body.classList.add("in-scene"); document.body.classList.toggle("docked", dk);
    if (!plan.shots.some((x) => x.shot_id === S.sel)) S.sel = plan.shots[0] ? plan.shots[0].shot_id : "";
    app.innerHTML = `<div class="desk"><div class="deskHead">
      <div class="top"><a class="btn ghost" href="#/">← Anime</a>${S.look && S.look.id ? `<a class="btn ghost" href="#/show/${E(S.look.id)}" title="The show this scene belongs to: its episodes, cast, places and style">${esc(S.look.name)}</a>` : ""}<h1 class="grow">${esc(S.scene.title || plan.title)}</h1></div>
      <div class="card summary" id="summary"></div>
      ${S.job ? `<div class="card problems" style="border-color:${S.job.status === "failed" ? "var(--red)" : "var(--line)"}"><b>${JOB[S.job.kind] || "Blocking pass"} ${S.job.status === "running" ? "running" : S.job.status === "failed" ? "failed" : "finished"}</b>
        <div class="small" id="jobMsg">${esc(jobText(S.job))}</div>${busy() ? `<div class="small muted">Editing is paused until it finishes. You can leave this screen.</div>` : running() ? `<div class="small muted">You can keep editing and leave this screen.</div>` : ""}</div>` : ""}
      <div class="actions">
        <button class="btn primary" id="play" ${plan.shots.length ? "" : "disabled"}>▶︎ Play animatic</button>
        <button class="btn" id="block" ${running() ? "disabled" : ""}>${S.scene.blocked ? "Blocking pass again" : "Blocking pass"}</button>
        <button class="btn" id="versions">Versions</button>
        <button class="btn" id="asUndo" hidden>Undo the Assistant's step</button>
        <button class="btn" id="exportBtn" ${running() || !plan.shots.length ? "disabled" : ""} title="One video file of this scene: its pictures and video clips, the subtitles and the sound">Export as a video</button>
        <label class="small" style="display:inline-flex;align-items:center;gap:5px;cursor:pointer"><input type="checkbox" id="exportSubs" ${localStorage.getItem("ibasho.exportSubs") === "0" ? "" : "checked"}> with subtitles</label>
        <label class="small" style="display:inline-flex;align-items:center;gap:5px" title="The shape of the video file. Upright and square cut each picture around the people in the shot."><span>Shape</span><select id="exportShape">${[["16:9", "16:9, as made"], ["9:16", "9:16, upright"], ["1:1", "1:1, square"]].map(([v, t]) => `<option value="${v}"${expShape() === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="small" style="display:inline-flex;align-items:center;gap:5px;cursor:pointer" title="Each drawing of a video clip is held for two frames (12 drawings a second), the cadence of hand-drawn anime. Stills and the sound are not changed."><input type="checkbox" id="exportTwos" ${localStorage.getItem("ibasho.exportTwos") === "1" ? "checked" : ""}> On twos (anime cadence)</label>
      </div>
      ${S.exports.length ? `<div class="small exportLine">Latest video: <a href="${esc(img(S.exports[0].url))}" target="_blank" rel="noopener">Open</a> · <a href="${esc(img(S.exports[0].url))}" download="${esc(S.exports[0].name)}">Download</a> <span class="muted">(${(S.exports[0].size / 1e6).toFixed(1)} MB, made ${new Date(S.exports[0].at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})</span></div>` : ""}
      <details class="card grade" id="grade" ${S.gradeOpen ? "open" : ""}><summary>Colour grade <span class="small muted" id="gradeNow"></span></summary><div id="gradeBody"></div></details>
      <div class="card problems" id="missing" hidden></div>
      <div class="card problems" id="problems" hidden></div></div>
      <div class="mid"><div id="playerSlot"></div>
      <div class="midTabs" role="tablist" aria-label="Scene tools">${[["look", "The look"], ["check", "Check"], ["sound", "Sound"], ["previs", "Grey 3D"], ["cards", "Scene cards"]].map(([k, n]) => `<button class="btn sm" role="tab" data-tab="${k}" aria-selected="${(S.tab || "look") === k}">${n}</button>`).join("")}</div>
      <div class="tabp" data-tabp="previs">${previsCard()}</div>
      <div class="tabp" data-tabp="look"><div class="card problems" id="look"></div></div>
      <div class="tabp" data-tabp="check"><div class="card problems" id="acheck"></div></div>
      <div class="tabp" data-tabp="sound"><div class="card problems" id="sound"></div></div>
      <div class="tabp" data-tabp="cards">${sceneCards()}</div></div>
      <div class="dockL"><div class="tools dockT" style="align-items:center"><h2 class="grow" style="margin:0">Shots</h2><button class="btn sm" id="drawAll" ${busy() ? "disabled" : ""}></button></div>
      <div class="tools" id="models" style="align-items:center;margin:0 0 8px">${modelsBar()}</div>
      <div class="list" id="shots">${plan.shots.map((s, i) => shotCard(s, i, by[s.shot_id], dk ? false : null)).join("")}</div>
      <div style="margin-top:10px"><button class="btn" id="addEnd" ${busy() ? "disabled" : ""}>+ Add a shot at the end</button></div></div>
      <div class="dockR" ${dk ? "" : "hidden"}><div class="dockT"><h2 style="margin:0">Shot</h2></div><div id="shotEd"></div></div></div>`;
    if (dk) { drawDock(); Player.dock($("#playerSlot")); const i = Math.max(0, plan.shots.findIndex((x) => x.shot_id === S.sel)); Player.open(S.plan, i, { paused: true }); }
    drawSummary();
    $("#play").onclick = () => Player.open(S.plan, 0);
    $("#block").onclick = () => askNote("blocking");
    wirePrevis(); drawLook(); wireLook(); drawCheck(); wireCheck(); drawSound(); wireSound(); drawAllLabel(); wireModels();
    $("#drawAll").onclick = async () => { const todo = S.plan.shots.filter((s) => !isAnime(s) && !active(s.shot_id)); if (!todo.length || (todo.length > 6 && !confirm(`Draw ${todo.length} shots? About 3 minutes each, one at a time.`))) return; if (window.Ibasho && !(await window.Ibasho.okToSpend(stillCost(todo.length), `Drawing ${todo.length} still${todo.length === 1 ? "" : "s"}`))) return; await flush(); for (const s of todo) await ask(s.shot_id, true); };
    $("#versions").onclick = versions;
    $("#asUndo").onclick = () => { try { asUndoLast(); } catch (e) { alert(e.message); } }; drawAsUndo();
    drawGrade(); $("#grade").addEventListener("toggle", () => { S.gradeOpen = $("#grade").open; });
    $("#exportBtn").onclick = async () => { $("#exportBtn").disabled = true; clearTimeout(S.saveT); clearTimeout(S.sndT); // the video is made from what is saved
      try { await save(); await send("/api/anime/sound?id=" + E(S.id), "PUT", S.sound); await send(`/api/anime/export?id=${E(S.id)}&subs=${$("#exportSubs").checked ? 1 : 0}&shape=${E($("#exportShape").value)}&twos=${$("#exportTwos").checked ? 1 : 0}`, "POST"); } catch (e) { alert(e.message); } scene(S.id, S.open); };
    $("#exportSubs").onchange = (e) => localStorage.setItem("ibasho.exportSubs", e.target.checked ? "1" : "0");
    $("#exportShape").onchange = (e) => localStorage.setItem("ibasho.exportShape", e.target.value); // remembered on this device, like the subtitles tick
    $("#exportTwos").onchange = (e) => localStorage.setItem("ibasho.exportTwos", e.target.checked ? "1" : "0");
    $("#addEnd").onclick = () => addShot(plan.shots.length - 1);
    wireCards(); wireShots($("#shots")); wireShots($("#shotEd"));
    const showTab = () => { for (const x of app.querySelectorAll(".tabp")) x.classList.toggle("on", x.dataset.tabp === (S.tab || "look")); for (const x of app.querySelectorAll(".midTabs [data-tab]")) x.setAttribute("aria-selected", x.dataset.tab === (S.tab || "look")); const c = $("#cards"); if (c && dk) c.open = true; };
    $(".midTabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; S.tab = b.dataset.tab; showTab(); if (S.tab === "sound") drawSound(); }; showTab();
  }
  function drawDock() { // the selected shot, open, in the right dock
    const el = $("#shotEd"); if (!el || !docked()) return; const i = S.plan.shots.findIndex((x) => x.shot_id === S.sel);
    el.innerHTML = i < 0 ? `<div class="card empty">Pick a shot on the left.</div>` : shotCard(S.plan.shots[i], i, shotProblems()[S.sel], true);
  }
  function select(i, play) {
    const s = S.plan.shots[i]; if (!s) return; S.sel = s.shot_id;
    for (const c of document.querySelectorAll("#shots .shot")) c.classList.toggle("sel", +c.dataset.i === i);
    drawDock(); Player.open(S.plan, i, { paused: !play });
  }
  // ---------- colour grade: one look over the whole scene, the same in the player and the exported video ----------
  function applyGrade() { const g = P.gradeOf(S.scene && S.scene.grade), f = document.getElementById("gradeF"); document.body.classList.toggle("graded", !!g); if (!g || !f) return;
    f.querySelectorAll("feFuncR, feFuncG, feFuncB").forEach((x) => { x.setAttribute("slope", g.k); x.setAttribute("intercept", Math.round(0.5 * (1 - g.k) * 10000) / 10000); });
    f.querySelector("feColorMatrix").setAttribute("values", g.m.map((r) => r.join(" ") + " 0 0").join(" ") + " 0 0 0 1 0"); }
  function drawGrade() { const el = $("#gradeBody"); if (!el) return; const g = Object.assign({ preset: "", bright: 0, contrast: 0, sat: 1, warm: 0 }, S.scene.grade || {}), ro = busy() ? "disabled" : "";
    const row = (k, name, a, b) => `<label class="grow"><span>${name}</span><input type="range" min="${a}" max="${b}" step="0.05" data-g="${k}" value="${g[k]}" ${ro} aria-label="${name}"></label>`;
    $("#gradeNow").textContent = P.gradeOf(g) ? "· " + ((P.GRADES[g.preset] || {}).name && g.preset ? P.GRADES[g.preset].name : "your own") : "· none";
    el.innerHTML = `<div class="small muted">One colour look over every shot of this scene. The player shows it, and the exported video has it.</div>
      <div class="tools gpre">${Object.entries(P.GRADES).map(([k, v]) => `<button class="btn sm" data-gpre="${k}" aria-pressed="${g.preset === k && (k || !P.gradeOf(g))}" ${ro}>${v.name}</button>`).join("")}</div>
      <div class="grows">${row("bright", "Brightness", -1, 1)}${row("contrast", "Contrast", -1, 1)}${row("sat", "Colour strength", 0, 2)}${row("warm", "Cooler ↔ warmer", -1, 1)}</div>`;
    const save = () => { applyGrade(); $("#gradeNow").textContent = P.gradeOf(S.scene.grade) ? "· " + (S.scene.grade.preset ? P.GRADES[S.scene.grade.preset].name : "your own") : "· none"; clearTimeout(S.gradeT); S.gradeT = setTimeout(() => send("/api/anime/grade?id=" + E(S.id), "PUT", S.scene.grade).catch((e) => alert(e.message)), 400); };
    el.onclick = (e) => { const b = e.target.closest("[data-gpre]"); if (!b) return; const v = P.GRADES[b.dataset.gpre]; S.scene.grade = { preset: b.dataset.gpre, bright: v.bright || 0, contrast: v.contrast || 0, sat: v.sat == null ? 1 : v.sat, warm: v.warm || 0 }; save(); drawGrade(); };
    el.oninput = (e) => { const r = e.target.closest("[data-g]"); if (!r) return; S.scene.grade = Object.assign({ bright: 0, contrast: 0, sat: 1, warm: 0 }, S.scene.grade || {}, { preset: "", [r.dataset.g]: +r.value }); el.querySelectorAll("[data-gpre]").forEach((x) => x.setAttribute("aria-pressed", "false")); save(); };
    applyGrade(); }
  function drawSummary() {
    const c = S.check, el = $("#summary"); if (!el) return;
    const st = c.stats, nE = c.errors.length, nW = c.warnings.length;
    el.innerHTML = `<span class="stat">${st.shots} shots · ${fmt(st.seconds)} · median ${st.median} s</span>
      ${st.thirds ? `<span class="stat muted" title="Mean shot length in each third: begin slow, end swift">thirds ${st.thirds.join(" / ")}</span>` : ""}
      <span class="grow"></span>
      ${(() => { const n = missing().reduce((a, g) => a + g.items.length, 0); return n ? `<button class="chip" id="miss" style="cursor:pointer" title="What this scene still needs">Still to do: ${n}</button>` : `<span class="chip ok" title="Every shot has a picture, every line a recording, every character a sheet">Nothing missing</span>`; })()}
      <button class="chip ${nE ? "bad" : "ok"}" id="chk" style="cursor:pointer">${nE ? `Plan check: ${nE} problem${nE > 1 ? "s" : ""}` : "Plan check passes"}${nW ? ` · ${nW} to look at` : ""}</button>`;
    $("#chk").onclick = () => { const p = $("#problems"); p.hidden = !p.hidden; if (!p.hidden) drawProblems(); };
    const mb = $("#miss"), mx = $("#missing"); if (mb) mb.onclick = () => { S.missOpen = !S.missOpen; drawSummary(); };
    if (mx) { mx.hidden = !S.missOpen || !mb; if (!mx.hidden) { mx.innerHTML = `<b>What this scene still needs</b>` + missing().filter((g) => g.items.length).map((g) => `<div class="missg"><span class="small"><b>${g.items.length}</b> ${esc(g.what)}</span><div class="tools">${g.items.map((x) => (x.shot ? `<button class="btn sm" data-goshot="${esc(x.shot)}">${esc(x.label)}</button>` : `<span class="chip">${esc(x.label)}</span>`)).join("")}</div>${g.hint ? `<div class="small muted">${esc(g.hint)}</div>` : ""}</div>`).join("");
      mx.onclick = (e) => { const b = e.target.closest("[data-goshot]"); if (!b) return; const i = S.plan.shots.findIndex((q) => q.shot_id === b.dataset.goshot); if (i < 0) return; if (docked()) select(i); else { const c = app.querySelector(`.shot[data-i="${i}"]`); if (c) c.scrollIntoView({ block: "center", behavior: "smooth" }); } }; } }
    if (!$("#problems").hidden) drawProblems();
  }
  /** What a scene still needs before it is finished: pictures, recordings, sheets, sound. */
  function missing() {
    const sh = S.plan.shots || [], so = S.sound || { clips: [] }, cast = (S.look && S.look.cast) || {}, has = (n) => Object.keys(cast).some((k) => k.toLowerCase() === String(n).toLowerCase() && cast[k].sheet);
    const lines = (S.plan.dialogue || []).filter((d) => d.kind !== "title" && d.speaker).map((d) => ({ d, shot: (sh.find((x) => (x.lines || []).includes(d.line_id)) || {}).shot_id || "" })).filter((x) => x.shot);
    const clipSound = (id) => { const x = sh.find((q) => q.shot_id === id); return !!(x && x.clip && x.clip_sound); }; // a shot whose video clip came with sound has its line in it
    return [
      { what: "shots with no picture or video clip", items: sh.filter((x) => !x.still && !x.clip && !x.title && !x.title_sub).map((x) => ({ shot: x.shot_id, label: x.shot_id })), hint: "Draw the shot, add a picture, or add a video clip." },
      { what: "spoken lines with no recording", items: lines.filter((x) => !clipSound(x.shot) && !so.clips.some((c) => c.line === x.d.line_id)).map((x) => ({ shot: x.shot, label: `${x.shot} ${x.d.speaker}: ${x.d.text.slice(0, 28)}${x.d.text.length > 28 ? "…" : ""}` })), hint: "Sound tab: press the character's layer name, then Record or Add a file beside the line." },
      { what: "characters with no sheet in the show", items: (S.people || []).filter((q) => q.kind === "person" && !has(q.name)).map((q) => ({ label: q.name })), hint: "The look tab: add them and draw or upload a sheet, so they look the same in every shot." },
      { what: "sound: nothing on the timeline yet", items: sh.length && !so.clips.length ? [{ label: "no music, voices or effects" }] : [] },
    ];
  }
  function drawProblems() {
    const c = S.check, scene = (x) => !x.shot;
    $("#problems").innerHTML = `<b>Plan check</b> <span class="small muted">(craft gate G1: the plan does not go for approval until this passes)</span>
      ${!S.scene.blocked && c.errors.length ? `<p class="small" style="margin:6px 0 0">This is the first draft straight from the panels. The <b>Blocking pass</b> fills in most of this: movement, cameras, timing and the scene cards.</p>` : ""}
      <ul>${c.errors.filter(scene).map((e) => `<li class="err">${esc(e.msg)}</li>`).join("")}${c.warnings.filter(scene).map((w) => `<li class="warn">${esc(w.msg)}</li>`).join("")}</ul>
      ${c.errors.some((e) => e.shot) || c.warnings.some((w) => w.shot) ? `<div class="small muted">Problems with one shot are shown on that shot.</div>` : ""}`;
  }
  function shotProblems() {
    const by = {};
    for (const e of S.check.errors) if (e.shot) (by[e.shot] = by[e.shot] || { e: [], w: [] }).e.push(e.msg);
    for (const w of S.check.warnings) if (w.shot) (by[w.shot] = by[w.shot] || { e: [], w: [] }).w.push(w.msg);
    return by;
  }

  // scene cards: intent, light, palette, sound, gestures, craft checks
  function sceneCards() {
    const p = S.plan, it = p.intent || {}, pal = Array.isArray(p.palette) ? p.palette : (p.palette && p.palette.colours) || [];
    const sp = typeof p.sound_plan === "string" ? p.sound_plan : p.sound_plan ? JSON.stringify(p.sound_plan, null, 1) : "";
    const gest = p.signature_gestures && typeof p.signature_gestures === "object" ? Object.entries(p.signature_gestures).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n") : String(p.signature_gestures || "");
    const cc = p.craft_checks || {}, ro = busy() ? "disabled" : "";
    return `<details class="card cards" id="cards"><summary>Scene cards <span class="small muted">(intent, light, palette, sound, craft checks)</span></summary>
      <div class="editor" style="border-top:0">
        <label class="field"><span>Feel: what the viewer feels at the end</span><input data-k="intent.feel" value="${esc(it.feel)}" ${ro}></label>
        <div class="two"><label class="field"><span>Peak: the strongest moment (shot or line id)</span><input data-k="intent.peak" value="${esc(it.peak)}" ${ro}></label>
        <label class="field"><span>Must know before the peak</span><input data-k="intent.must_know" value="${esc(it.must_know)}" ${ro}></label></div>
        <label class="field"><span>Lighting mood (one for the scene)</span><input data-k="lighting_mood" value="${esc(p.lighting_mood)}" ${ro}></label>
        <div class="field"><span>Palette (4 to 6 colours)</span><div class="swatches">${pal.map((c) => { const hex = typeof c === "string" ? c : c.hex || c.colour || ""; return `<span class="sw"><i style="background:${esc(hex)}"></i>${esc(hex)} ${esc(typeof c === "string" ? "" : c.role || "")}</span>`; }).join("") || `<span class="small muted">None yet: the Blocking pass proposes one.</span>`}</div></div>
        <label class="field"><span>Sound plan</span><textarea data-k="sound_plan" ${ro}>${esc(sp)}</textarea></label>
        <label class="field"><span>Signature gestures (one line each, "Name: gesture"; you pick)</span><textarea data-k="signature_gestures" ${ro}>${esc(gest)}</textarea></label>
        ${Object.keys(P.CRAFT).map((k) => `<label class="field"><span>${esc(k.replace(/_/g, " "))}: <span style="font-weight:400">${esc(P.CRAFT[k])}</span></span><input data-k="craft_checks.${k}" value="${esc(typeof cc[k] === "string" ? cc[k] : cc[k] ? JSON.stringify(cc[k]) : "")}" ${ro}></label>`).join("")}
      </div></details>`;
  }
  function wireCards() {
    for (const el of app.querySelectorAll("#cards [data-k]")) el.addEventListener("input", () => {
      const k = el.dataset.k, v = el.value, p = S.plan;
      if (k === "signature_gestures") { const o = {}; for (const ln of v.split("\n")) { const m = ln.match(/^\s*([^:]+):\s*(.+)$/); if (m) o[m[1].trim()] = m[2].trim(); } p.signature_gestures = o; }
      else if (k.includes(".")) { const [a, b] = k.split("."); p[a] = p[a] && typeof p[a] === "object" ? p[a] : {}; p[a][b] = v; }
      else p[k] = v;
      changed(false);
    });
  }

  // one shot card
  const TYPES = Object.keys(P.TARGETS);
  function lineOf(id) { return (S.plan.dialogue || []).find((l) => l.line_id === id); }
  function blockingText(b) {
    if (!b) return ""; if (typeof b === "string") return b;
    if (Array.isArray(b)) return b.map((w) => (typeof w === "string" ? w : [w.name, w.facing ? "facing " + w.facing : "", w.position || w.where || "", w.path || ""].filter(Boolean).join(", "))).join("; ");
    return Object.entries(b).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("; ");
  }
  function movementOf(s) { let m = s.movement || {}; if (Array.isArray(m)) { const o = {}; for (const x of m) o[String(x).split(":")[0].trim()] = String(x).split(":").slice(1).join(":").trim(); m = o; } return m; }
  function shotCard(s, i, pr, force) { // force: true = always open (the dock), false = always closed (the list beside the dock)
    const open = force != null ? force : S.open.has(s.shot_id), ro = busy() ? "disabled" : "", cam = s.camera || {}, mv = movementOf(s);
    const [lo, hi] = P.TARGETS[s.scene_type] || [0, 0];
    const exprs = s.expressions && typeof s.expressions === "object" ? Object.entries(s.expressions).map(([k, v]) => `${k}: ${v}`).join("; ") : String(s.expressions || "");
    return `<div class="card shot ${open ? "open" : ""} ${force === false && s.shot_id === S.sel ? "sel" : ""}" data-i="${i}">
      <div class="shot-head">
        ${s.clip ? `<div class="thumb hasclip" data-act="play" title="Play from here (this shot is a video)"><video src="${esc(img(s.clip))}#t=${+s.clip_from || 0}" ${s.clip_poster ? `poster="${esc(img(s.clip_poster))}"` : ""} muted loop playsinline autoplay preload="metadata" aria-label="Video of shot ${esc(s.shot_id)}"></video><span class="vbadge">▶ Video</span></div>`
          : `<div class="thumb" data-act="play" title="Play from here" style="background-image:url('${esc(img(s.still))}');${focusStyle(s)}">${s.still ? "" : esc(s.title || cam.framing || "new shot")}</div>`}
        <div class="grow">
          <div class="shot-meta"><span class="shot-id">${esc(s.shot_id)}</span>
            <span class="chip" title="target ${lo} to ${hi} s">${esc(s.scene_type || "?")}</span>
            <span class="dur"><button data-act="dur-" ${ro} aria-label="Shorter">−</button><span>${fmt(+s.duration || 0)}</span><button data-act="dur+" ${ro} aria-label="Longer">+</button></span>
            ${cam.move && !/^(still|locked)$/i.test(cam.move) ? `<span class="chip">${esc(cam.move)}</span>` : ""}
            ${s.title || s.title_sub ? `<span class="chip">Title</span>` : ""}${s.tin ? `<span class="chip">${TIN[s.tin] || ""}</span>` : ""}${s.tout ? `<span class="chip">${TOUT[s.tout] || ""}</span>` : ""}</div>
          <div class="small muted">${esc(cam.framing || "")}</div>
          <p class="shot-action">${esc(s.action || "")}</p>
        </div></div>
      ${(s.lines || []).length ? `<div class="lines">${s.lines.map((id) => { const l = lineOf(id) || { text: "(missing line " + id + ")" }; return `<div class="line">
          <button class="mouth ${l.mouth === "on" ? "on" : ""}" data-act="mouth" data-line="${esc(id)}" ${ro} title="Mouth on: lips move on this line. Mouth off: it plays over something else.">${l.mouth === "on" ? "mouth on" : l.mouth === "off" ? "mouth off" : "mouth ?"}</button>
          <span><span class="who">${esc(l.speaker || "Caption")}</span> ${esc(l.text)}</span></div>`; }).join("")}</div>` : ""}
      ${pr && pr.e.length ? `<div class="shot-errs">${pr.e.map(esc).join("<br>")}</div>` : ""}
      ${pr && pr.w.length && open ? `<div class="shot-warns">${pr.w.map(esc).join("<br>")}</div>` : ""}
      <div class="tools" style="margin-top:8px">
        <button class="btn sm" data-act="toggle">${open ? "Close" : "Edit"}</button>
        <button class="btn sm" data-act="up" ${i === 0 || ro ? "disabled" : ""} aria-label="Move up">↑</button>
        <button class="btn sm" data-act="down" ${i === S.plan.shots.length - 1 || ro ? "disabled" : ""} aria-label="Move down">↓</button>
        <button class="btn sm" data-act="add" ${ro}>+ Shot after</button>
        <button class="btn sm" data-act="addcard" ${ro} title="A shot of words on black or white: a title, a chapter name, credits">+ Title card after</button>
        <button class="btn sm" data-act="split" ${ro}>Split</button>
        <button class="btn sm" data-act="del" ${ro}>Delete</button>
        ${active(s.shot_id) ? `<span class="chip busy">${S.draws[s.shot_id].status === "drawing" ? "Drawing… " + Math.max(0, Math.round((Date.now() - S.draws[s.shot_id].at) / 60000)) + " min" + (window.Ibasho && window.Ibasho.workBar ? window.Ibasho.workBar({ ...S.draws[s.shot_id], now: Date.now() }) : "") : "Waiting its turn"}</span>` : `<button class="btn sm" data-act="draw" ${ro} title="Draw this shot in the scene's look${s.still && !isAnime(s) ? ", using the picture it has now for the composition" : ""}">${isAnime(s) ? "Draw again" : s.still ? "Draw in the look" : "Draw this shot"}</button>`}
        ${S.draws[s.shot_id] && S.draws[s.shot_id].status === "failed" ? `<span class="chip bad" title="${esc(S.draws[s.shot_id].msg)}">Not drawn: ${esc(S.draws[s.shot_id].msg)}</span>` : ""}
        ${active("video:" + s.shot_id) ? `<span class="chip busy" title="${esc(S.draws["video:" + s.shot_id].msg || "")}">${S.draws["video:" + s.shot_id].status === "drawing" ? "Making the video… " + Math.max(0, Math.round((Date.now() - S.draws["video:" + s.shot_id].at) / 60000)) + " min" + (window.Ibasho && window.Ibasho.workBar ? window.Ibasho.workBar({ ...S.draws["video:" + s.shot_id], now: Date.now() }) : "") : "Video waiting its turn"}</span>`
          : s.still && window.Ibasho && window.Ibasho.pickModel ? `<button class="btn sm" data-act="video" ${ro} title="Turn this shot's picture into video with the scene's video model">${s.clip ? "Make another video" : "Make a video"}</button>` : ""}
        ${S.draws["video:" + s.shot_id] && S.draws["video:" + s.shot_id].status === "failed" ? `<span class="chip bad" title="${esc(S.draws["video:" + s.shot_id].msg)}">No video: ${esc(S.draws["video:" + s.shot_id].msg)}</span>` : ""}
        ${S.draws["video:" + s.shot_id] && S.draws["video:" + s.shot_id].status === "done" && S.draws["video:" + s.shot_id].cost != null ? `<span class="chip">Video cost $${(+S.draws["video:" + s.shot_id].cost).toFixed(2)}</span>` : ""}
        <label class="btn sm" style="display:inline-flex;align-items:center;cursor:pointer" title="Use your own picture for this shot">${s.still ? "Change picture" : "Add a picture"}<input type="file" accept="image/jpeg,image/png,image/webp" data-still hidden ${ro}></label>
        <label class="btn sm" style="display:inline-flex;align-items:center;cursor:pointer" title="Use a piece of video for this shot (made anywhere)">${s.clip ? "Add another take of the clip" : "Add a video clip"}<input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm" data-clipup hidden ${ro}></label>
        ${s.clip ? `<button class="btn sm" data-act="clipdel" ${ro}>${clipTakes(s).length > 1 ? "Remove this take" : "Remove the clip"}</button>` : ""}</div>
      ${s.clip ? `<div class="clipbar small"><span class="chip">Video clip · ${fmt(+s.clip_dur || 0)}</span>
        <button class="btn sm" type="button" data-hear="${esc(s.clip)}" data-hear-shot="${esc(s.shot_id)}" title="The words spoken in this clip, with their times, from a Whisper on this computer (free, nothing is sent anywhere)">Write down what is said</button>
        <label>starts at <input type="number" step="0.1" min="0" data-clipfrom value="${esc(+s.clip_from || 0)}" style="width:70px" ${ro}> s into the clip</label>
        <label>speed <input type="number" step="0.1" min="0.25" max="4" data-clipspeed value="${esc(+s.clip_speed || 1)}" style="width:62px" ${ro}> ×</label>
        ${Math.abs(clipRest(s) - (+s.duration || 0)) > 0.05 ? `<button class="btn sm" data-act="cliplen" ${ro}>Make the shot ${fmt(Math.max(0.3, clipRest(s)))} (the rest of the clip)</button>` : ""}
        ${(+s.duration || 0) > clipRest(s) + 0.05 ? `<span class="muted">The shot is longer than the clip: it holds on the last picture.</span>` : ""}
        ${+s.clip_speed > 0 && +s.clip_speed !== 1 && s.clip_sound ? `<span class="muted">The clip's own sound still plays at normal speed.</span>` : ""}</div>` : ""}
      ${clipTakes(s).length > 1 ? `<div class="takes" aria-label="Video takes of this shot">${clipTakes(s).map((k, n) => `<button data-act="cliptake" data-n="${n}" aria-pressed="${k.url === s.clip}" title="Use video take ${n + 1}${k.name ? " (" + esc(k.name) + ")" : ""}" ${ro}>${k.poster ? `<img src="${esc(img(k.poster))}" alt="Video take ${n + 1}" loading="lazy">` : `<i style="display:block;aspect-ratio:16/9"></i>`}<span>▶ ${n + 1} · ${fmt(+k.dur || 0)}</span></button>`).join("")}</div>` : ""}
      ${(S.takes[s.shot_id] || []).length > 1 ? `<div class="takes" aria-label="Takes drawn for this shot">${S.takes[s.shot_id].map((u, n) => `<button data-act="take" data-url="${esc(u)}" aria-pressed="${u === s.still}" title="Use take ${n + 1}" ${ro}><img src="${esc(img(u))}" alt="Take ${n + 1}" loading="lazy"><span>${n + 1}</span></button>`).join("")}</div>` : ""}
      ${open ? `<div class="editor">
        <div class="two"><label class="field"><span>Shot type (target ${lo} to ${hi} s)</span><select data-f="scene_type" ${ro}>${TYPES.map((t) => `<option ${t === s.scene_type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        <label class="field"><span>Length in seconds</span><input type="number" step="0.1" min="0.1" data-f="duration" value="${esc(s.duration)}" ${ro}></label></div>
        <div class="two"><label class="field"><span>Into this shot</span><span class="pair"><select data-f="tin" ${ro}>${Object.entries({ "": i ? "Cut" : "Cut (starts straight away)", ...(i ? { cross: "Cross-fade from the shot before" } : {}), black: "Fade in from black", white: "Fade in from white" }).map(([k, n]) => `<option value="${k}" ${k === (s.tin || "") ? "selected" : ""}>${n}</option>`).join("")}</select>${s.tin ? `<input type="number" step="0.1" min="0.1" max="3" data-f="tin_dur" value="${esc(+s.tin_dur || 0.5)}" aria-label="Seconds" ${ro}> s` : ""}</span></label>
        <label class="field"><span>Out of this shot</span><span class="pair"><select data-f="tout" ${ro}>${Object.entries({ "": "Cut", black: "Fade out to black", white: "Fade out to white" }).map(([k, n]) => `<option value="${k}" ${k === (s.tout || "") ? "selected" : ""}>${n}</option>`).join("")}</select>${s.tout ? `<input type="number" step="0.1" min="0.1" max="3" data-f="tout_dur" value="${esc(+s.tout_dur || 0.5)}" aria-label="Seconds" ${ro}> s` : ""}</span></label></div>
        <div class="two">${i ? `<label class="field"><span>How the video joins the shot before</span><select data-f="join" ${ro}>${Object.entries({ "": "Cut", wipe: "Hidden wipe (something fills the frame)", match: "Match move (the movement carries on)" }).map(([k, n]) => `<option value="${k}" ${k === (s.join || "") ? "selected" : ""}>${n}</option>`).join("")}</select></label>` : "<span></span>"}
        ${s.join === "wipe" || s.join === "match" ? `<label class="field"><span>${s.join === "wipe" ? "What fills the frame (a back, a pillar, darkness)" : "The movement both shots share"}</span><input data-f="join_cover" value="${esc(s.join_cover || "")}" maxlength="200" ${ro}></label>` : "<span></span>"}</div>
        ${s.join === "wipe" || s.join === "match" ? `<label class="field"><span>Why it joins this way</span><input data-f="join_reason" value="${esc(s.join_reason || "")}" maxlength="200" ${ro}></label>` : ""}
        <label class="tick"><input type="checkbox" data-f="long_take" ${s.long_take ? "checked" : ""} ${ro}> Long take <span class="small muted">(for talk: one 10 to 15 s clip with 3 to 5 beats, instead of many short clips)</span></label>
        <label class="field"><span>Beats for the video, one a line (optional; for example "0-3 She turns to him")</span><textarea data-f="beats" rows="3" ${ro}>${esc(s.beats || "")}</textarea></label>
        <div class="field"><button class="btn sm" data-act="vsent">${S.vsent && S.vsent[s.shot_id] ? "Hide what is sent to the video model" : "Show what is sent to the video model"}</button>
          ${S.vsent && S.vsent[s.shot_id] ? (() => { const v = S.vsent[s.shot_id], m = v.meter || {}; return `<div class="small ${m.level === "ok" ? "muted" : ""}" style="margin-top:6px">${m.words} words for ${m.seconds} s: <b>${m.wps} words a second</b> ${m.level === "ok" ? "(about 60 a second has worked)" : m.level === "long" ? "(more than the 60 a second that has worked: cut some words, or make the shot longer)" : "(far more than the 60 a second that has worked: models skip or blur most of it. Cut words, or use a long take)"}</div><pre class="sent">${esc(v.prompt)}</pre>`; })() : ""}</div>
        <div class="two"><label class="field"><span>Words on screen (a title; leave empty for none)</span><input data-f="title" value="${esc(s.title || "")}" maxlength="120" ${ro}></label>
        <label class="field"><span>Smaller line under it</span><input data-f="title_sub" value="${esc(s.title_sub || "")}" maxlength="160" ${ro}></label></div>
        ${1 ? `<div class="two"><label class="field"><span>Where the words sit</span><select data-f="title_pos" ${ro}><option value="" ${s.title_pos ? "" : "selected"}>Middle</option><option value="low" ${s.title_pos === "low" ? "selected" : ""}>Low</option></select></label>
        ${s.still || s.clip ? "" : `<label class="field"><span>Behind the words (when the shot has no picture)</span><select data-f="title_bg" ${ro}><option value="" ${s.title_bg ? "" : "selected"}>Black</option><option value="white" ${s.title_bg === "white" ? "selected" : ""}>White</option></select></label>`}</div>` : ""}
        <label class="field"><span>Framing (size, angle, who is where on screen)</span><input data-f="camera.framing" value="${esc(cam.framing)}" ${ro}></label>
        <div class="two"><label class="field"><span>Camera move (still, push in, pull out, pan, tilt, track, arc, crane)</span><input data-f="camera.move" value="${esc(cam.move)}" ${ro}></label>
        <label class="field"><span>Why the camera moves</span><input data-f="camera.move_reason" value="${esc(cam.move_reason)}" ${ro}></label></div>
        <label class="field"><span>Camera setup id (same position and lens = same id; 3 uses at most)</span><input data-f="camera.previs_cam" value="${esc(cam.previs_cam)}" ${ro}></label>
        <label class="field"><span>What happens</span><textarea data-f="action" ${ro}>${esc(s.action)}</textarea></label>
        <label class="field"><span>Note for the artist on this shot (optional; it wins over the rest)</span><textarea data-f="draw_note" placeholder="For example: her left hand holds the microphone; night outside the window" ${ro}>${esc(s.draw_note || "")}</textarea></label>
        <div class="field"><button class="btn sm" data-act="sent">${S.sent[s.shot_id] ? "Hide what is sent" : "Show what is sent to the artist"}</button>
          ${S.sent[s.shot_id] ? `<div class="small muted" style="margin-top:6px">Pictures sent with it: ${S.sent[s.shot_id].images.length ? S.sent[s.shot_id].images.map(esc).join(", ") : "none"}</div><pre class="sent">${esc(S.sent[s.shot_id].prompt)}</pre>` : ""}</div>
        <label class="field"><span>Book verb (what the source gives them to do)</span><input data-f="book_verb" value="${esc(s.book_verb)}" ${ro}></label>
        <label class="field"><span>Who is where</span><input value="${esc(blockingText(s.blocking))}" disabled></label>
        <label class="field"><span>Expressions ("Name: expression; Name: expression")</span><input data-f="expressions" value="${esc(exprs)}" ${ro}></label>
        ${(s.lines || []).length ? `<label class="field"><span>Lines play</span><select data-f="line_placement" ${ro}>${P.PLACEMENTS.map((x) => `<option value="${x}" ${x === s.line_placement ? "selected" : ""}>${x.replace(/_/g, " ")}</option>`).join("")}</select></label>` : ""}
        <div class="field"><span>What moves (2 or more in every shot; indoors never wind)</span>
          ${P.LAYERS.map((k) => `<label class="field"><span style="font-weight:400">${k}</span><input data-f="movement.${k}" value="${esc(mv[k] || "")}" ${ro}></label>`).join("")}</div>
        ${s.scene_type === "action" ? `<div class="two"><label class="field"><span>Cut on</span><input data-f="cut_on" value="${esc(s.cut_on)}" ${ro}></label><label class="field"><span>Entry pose</span><input data-f="entry_pose" value="${esc(s.entry_pose)}" ${ro}></label></div>
          <label class="field"><span>Exit pose</span><input data-f="exit_pose" value="${esc(s.exit_pose)}" ${ro}></label>` : ""}
        ${s.panel_note ? `<div class="small muted">Manga panel note: ${esc(s.panel_note)}</div>` : ""}
        <div class="small muted">${(s.interpretation || []).map(esc).join("<br>")}</div>
      </div>` : ""}
    </div>`;
  }
  const TIN = { cross: "Cross-fade in", black: "From black", white: "From white" }, TOUT = { black: "To black", white: "To white" };
  const clipRest = (s) => Math.round((((+s.clip_dur || 0) - (+s.clip_from || 0)) / (+s.clip_speed > 0 ? +s.clip_speed : 1)) * 100) / 100; // seconds of the shot the clip can fill
  /** The video takes of a shot (the one in use is s.clip). */
  const clipTakes = (s) => (Array.isArray(s.clip_takes) && s.clip_takes.length ? s.clip_takes : s.clip ? [{ url: s.clip, dur: s.clip_dur, sound: s.clip_sound, poster: s.clip_poster }] : []);
  /** Put an uploaded video clip on a shot: it becomes the take in use, earlier takes are kept. */
  function setClip(s, r, name) { if (s.clip && !Array.isArray(s.clip_takes)) s.clip_takes = clipTakes(s);
    if (s.clip_takes || s.clip) { s.clip_takes = s.clip_takes || []; if (!s.clip_takes.some((k) => k.url === r.url)) s.clip_takes.push({ url: r.url, dur: r.dur, sound: !!r.sound, poster: r.poster || "", name: String(name || "").slice(0, 60) }); }
    useClip(s, r, true); }
  /** Switch the shot to one of its takes. fit: the shot takes the clip's length (a new clip); otherwise the shot keeps its length when the take is long enough. */
  function useClip(s, r, fit) { const posterWas = s.clip_poster; s.clip = r.url; s.clip_dur = r.dur; s.clip_sound = !!r.sound; s.clip_poster = r.poster || "";
    if (fit) s.clip_from = 0; else s.clip_from = Math.max(0, Math.min(+s.clip_from || 0, Math.max(0, (+r.dur || 0) - 0.1)));
    if (r.poster && (!s.still || s.still === posterWas)) s.still = r.poster; else if (!r.poster && s.still === posterWas) s.still = "";
    if (r.dur > 0 && (fit || (+s.duration || 0) > r.dur - s.clip_from)) s.duration = Math.max(0.3, Math.round((r.dur - s.clip_from) * 100) / 100); }
  const expShape = () => { const v = localStorage.getItem("ibasho.exportShape"); return v === "9:16" || v === "1:1" ? v : "16:9"; }; // the shape last chosen for a video export on this device
  function focusStyle(s) { // centre the crop on the people in the panel
    const pts = (Array.isArray(s.blocking) ? s.blocking : []).map((w) => w && w.at).filter((a) => Array.isArray(a) && a.length === 2);
    if (!pts.length) return "";
    const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    return `background-position:${Math.round(x * 100)}% ${Math.round(y * 100)}%`;
  }
  function wireShots(list) {
    if (!list) return;
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) { const c = docked() && list.id === "shots" && !e.target.closest("button, input, select, textarea, label, a") && e.target.closest(".shot"); if (c) select(+c.dataset.i); return; }
      if (b.disabled) return;
      const card = b.closest(".shot"), i = +card.dataset.i, s = S.plan.shots[i], act = b.dataset.act;
      if (act === "play") { if (docked()) return select(i, true); return Player.open(S.plan, i); }
      if (act === "toggle" && docked()) return select(i);
      if (act === "toggle") { S.open.has(s.shot_id) ? S.open.delete(s.shot_id) : S.open.add(s.shot_id); return redrawShot(i); }
      if (act === "dur-" || act === "dur+") { s.duration = Math.max(0.2, Math.round(((+s.duration || 0) + (act === "dur+" ? 0.25 : -0.25)) * 100) / 100); return changed(true); }
      if (act === "mouth") { const l = lineOf(b.dataset.line); if (l) l.mouth = l.mouth === "on" ? "off" : "on"; return changed(true); }
      if (act === "up" || act === "down") { const j = act === "up" ? i - 1 : i + 1; [S.plan.shots[i], S.plan.shots[j]] = [S.plan.shots[j], S.plan.shots[i]]; return changed(true); }
      if (act === "add") return addShot(i);
      if (act === "draw") return flush().then(() => ask(s.shot_id));
      if (act === "video") return askVideo(s);
      if (act === "take") { s.still = b.dataset.url; return changed(true); }
      if (act === "cliptake") { const k = clipTakes(s)[+b.dataset.n]; if (k && k.url !== s.clip) { useClip(s, k, false); changed(true); } return; }
      if (act === "addcard") { const c = { shot_id: newId(s.shot_id), source_ids: (s.source_ids || []).slice(0, 1), scene_type: "insert", camera: { framing: "Title card", move: "still", move_reason: "" }, action: "", expressions: {}, lines: [], duration: 2.5, movement: {}, book_verb: "", interpretation: ["VISUAL_INTERPRETATION: title card added by hand"], still: "", title: "Title", title_sub: "", tin: "black", tin_dur: 0.5, tout: "black", tout_dur: 0.5 };
        S.plan.shots.splice(i + 1, 0, c); S.open.add(c.shot_id); if (docked()) S.sel = c.shot_id; return changed(true); }
      if (act === "clipdel") { const more = clipTakes(s).filter((k) => k.url !== s.clip); if (!confirm(more.length ? "Remove this video take from the shot? The other takes stay." : "Remove the video clip from this shot? Its sound goes too.")) return;
        if (more.length) { s.clip_takes = more; useClip(s, more[more.length - 1], false); if (more.length === 1) delete s.clip_takes; return changed(true); }
        if (s.still === s.clip_poster) s.still = ""; delete s.clip; delete s.clip_dur; delete s.clip_from; delete s.clip_sound; delete s.clip_poster; delete s.clip_takes; return changed(true); }
      if (act === "cliplen") { s.duration = Math.max(0.3, clipRest(s)); return changed(true); }
      if (act === "vsent") { S.vsent = S.vsent || {}; if (S.vsent[s.shot_id]) { delete S.vsent[s.shot_id]; return redrawShot(i); } // the words only: nothing is sent anywhere
        return flush().then(() => api(`/api/anime/video-request?id=${encodeURIComponent(S.id)}&shot=${encodeURIComponent(s.shot_id)}&preview=1`)).then((r) => { S.vsent[s.shot_id] = r; redrawShot(i); }).catch((err) => alert(err.message)); }
      if (act === "sent") { if (S.sent[s.shot_id]) { delete S.sent[s.shot_id]; return redrawShot(i); }
        return flush().then(() => api(`/api/anime/request?id=${encodeURIComponent(S.id)}&shot=${encodeURIComponent(s.shot_id)}`)).then((r) => { S.sent[s.shot_id] = r; redrawShot(i); }).catch((err) => alert(err.message)); }
      if (act === "split") {
        const c = JSON.parse(JSON.stringify(s)); c.shot_id = newId(s.shot_id); c.lines = []; delete c.line_placement;
        c.duration = s.duration = Math.round((+s.duration || 2) / 2 * 10) / 10;
        c.source_ids = (s.source_ids || []).slice(); c.interpretation = ["VISUAL_INTERPRETATION: split from " + s.shot_id];
        S.plan.shots.splice(i + 1, 0, c); S.open.add(c.shot_id); return changed(true);
      }
      if (act === "del") {
        const ln = s.lines || [], to = S.plan.shots[i - 1] || S.plan.shots[i + 1];
        if (!confirm(ln.length && to ? `Delete ${s.shot_id}? Its ${ln.length} line${ln.length > 1 ? "s move" : " moves"} to ${to.shot_id}.` : `Delete ${s.shot_id}?`)) return;
        if (ln.length && to) { to.lines = i > 0 ? (to.lines || []).concat(ln) : ln.concat(to.lines || []); to.line_placement = to.line_placement || "over_reaction"; }
        S.plan.shots.splice(i, 1); if (S.sel === s.shot_id && to) S.sel = to.shot_id; return changed(true);
      }
    });
    list.addEventListener("input", (e) => {
      const el = e.target.closest("[data-f]"); if (!el) return;
      const s = S.plan.shots[+el.closest(".shot").dataset.i], f = el.dataset.f, v = el.value;
      if (el.type === "checkbox") { if (el.checked) s[f] = true; else delete s[f]; }
      else if (f === "duration") s.duration = Math.max(0.1, +v || 0);
      else if (f === "expressions") { const o = {}; for (const part of v.split(";")) { const m = part.match(/^\s*([^:]+):\s*(.+?)\s*$/); if (m) o[m[1].trim()] = m[2]; } s.expressions = o; }
      else if (f.startsWith("camera.")) { s.camera = s.camera || {}; s.camera[f.slice(7)] = v; }
      else if (f.startsWith("movement.")) { s.movement = movementOf(s); s.movement[f.slice(9)] = v; }
      else s[f] = v;
      if (S.vsent) delete S.vsent[s.shot_id]; // the words shown are out of date
      if (f === "join") { changed(false); return redrawShot(+el.closest(".shot").dataset.i); } // the cover and reason fields appear or go
      changed(false);
    });
    list.addEventListener("change", async (e) => { // a piece of video for a shot: the shot takes its length, and the clip's own sound goes on the "Clip sound" layer
      const cf = e.target.closest("[data-clipfrom]"); if (cf) { const s = S.plan.shots[+cf.closest(".shot").dataset.i]; s.clip_from = Math.max(0, Math.min(Math.max(0, (+s.clip_dur || 0) - 0.1), +cf.value || 0)); return changed(true); }
      const cs = e.target.closest("[data-clipspeed]"); if (cs) { const s = S.plan.shots[+cs.closest(".shot").dataset.i], v = Math.max(0.25, Math.min(4, +cs.value || 1)); if (v === 1) delete s.clip_speed; else s.clip_speed = Math.round(v * 100) / 100; return changed(true); }
      const inp = e.target.closest("[data-clipup]"); if (!inp || !inp.files[0]) return;
      const s = S.plan.shots[+inp.closest(".shot").dataset.i], f = inp.files[0], lab = inp.parentElement; lab.firstChild.textContent = "Adding the clip…";
      try { const r = await upload("clip", f); setClip(s, r, f.name); changed(true); } catch (err) { alert(err.message); changed(true); }
    });
    list.addEventListener("change", async (e) => { // your own picture for a shot
      const inp = e.target.closest("[data-still]"); if (!inp || !inp.files[0]) return;
      const s = S.plan.shots[+inp.closest(".shot").dataset.i], f = inp.files[0];
      try { const r = await upload("still", f, s.shot_id + (f.name.match(/\.\w+$/) || [".jpg"])[0]); s.still = r.url; changed(true); } catch (err) { alert(err.message); }
    });
    list.addEventListener("change", (e) => { // a new type or length shows on the card once the field is left
      const el = e.target.closest('[data-f="scene_type"], [data-f="duration"], [data-f="tin"], [data-f="tout"]'); if (el) redrawShot(+el.closest(".shot").dataset.i);
    });
  }
  async function upload(kind, file, name) {
    const r = await fetch(`/api/anime/upload?${ctx()}&kind=${kind}&name=${encodeURIComponent(name || file.name || "file")}`, { method: "POST", body: file });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "That file could not be added."); return d;
  }

  // ---------- the look: words and reference pictures; shots are drawn in it ----------
  const isAnime = (s) => /f=stills\/[^&]*-take\d+\.png/.test(s.still || ""); // a picture drawn here, in the look
  const active = (shot) => { const d = S.draws[shot]; return !!d && (d.status === "waiting" || d.status === "drawing"); };
  const flush = async () => { clearTimeout(S.saveT); await save(); }; // the server draws from the saved plan
  // ---------- models: which picture model draws the stills and which video model makes a shot's video (the studio's model picker, studio.js) ----------
  const MODELS = { picture: null, video: null }; let modelsAsked = false;
  const pickQ = (m) => (m && m.service ? `&service=${encodeURIComponent(m.service)}&model=${encodeURIComponent(m.model)}${m.quality ? "&quality=" + encodeURIComponent(m.quality) : ""}` : "");
  function modelsBar() {
    if (!window.Ibasho || !window.Ibasho.pickModel) return "";
    const b = (k, title) => `<button class="btn sm mp-btn" data-model="${k}" title="${title}"><span>${k === "picture" ? "Stills" : "Video"}: ${MODELS[k] ? esc(MODELS[k].name || MODELS[k].model) : k === "video" ? "pick a model" : "Codex"}</span><small>${esc(MODELS[k] ? (MODELS[k].off ? "not connected" : MODELS[k].price || "") : k === "video" ? "needs OpenRouter" : "")}</small></button>`;
    const P = MODELS.picture, qs = P && P.service === "openrouter" ? (P.qualities || []).filter((x) => ["low", "medium", "high"].includes(x)) : [];
    const qsel = qs.length ? `<label class="small" style="display:inline-flex;align-items:center;gap:4px">Quality <select data-quality>${qs.map((x) => { const e = window.IbashoPrice && P.pm ? window.IbashoPrice.picture(P.pm, { quality: x, size: [1536, 1024], refs: 3, chars: 2500 }) : null; return `<option value="${x}" ${P.quality === x ? "selected" : ""}>${window.Ibasho.QUALITY[x]}${e && e.usd != null ? " · about " + window.IbashoPrice.money(e.usd) : ""}</option>`; }).join("")}</select></label>` : "";
    return b("picture", "The model that draws this scene's stills") + qsel + b("video", "The model that turns a shot's still into video");
  }
  async function loadModels() { if (!window.Ibasho || !window.Ibasho.modelChoice) return; modelsAsked = true;
    for (const k of ["picture", "video"]) { try { MODELS[k] = await window.Ibasho.modelChoice(k); } catch (e) { MODELS[k] = null; } }
    const el = $("#models"); if (el) el.innerHTML = modelsBar(); }
  function wireModels() { if (!modelsAsked) loadModels(); const el = $("#models"); if (!el) return;
    el.onchange = async (e) => { const s = e.target.closest("[data-quality]"); if (!s) return; try { MODELS.picture = { ...MODELS.picture, ...(await window.Ibasho.setQuality("picture", MODELS.picture, s.value)) }; } catch (err) { alert(err.message); } el.innerHTML = modelsBar(); };
    el.onclick = async (e) => { const b = e.target.closest("[data-model]"); if (!b) return; const o = await window.Ibasho.pickModel(b.dataset.model); if (o) { MODELS[b.dataset.model] = o; el.innerHTML = modelsBar(); changed(true); } }; }
  /** The length the video model makes for a shot: the shortest it offers that covers the shot (the clip plays from its start). */
  const vidLen = (m, sec) => { const L = (m.lengths || []).slice().sort((a, b) => a - b); return L.find((x) => x >= sec) || L[L.length - 1] || Math.ceil(sec); };
  async function askVideo(s, asked) {
    let m = MODELS.video; if (!m || m.off) { m = await window.Ibasho.pickModel("video"); if (!m) return; MODELS.video = m; const el = $("#models"); if (el) el.innerHTML = modelsBar(); }
    const len = vidLen(m, +s.duration || 3), cost = m.perSecond != null ? m.perSecond * len : null;
    let info = {}; try { info = await api(`/api/anime/video-request?id=${encodeURIComponent(S.id)}&shot=${encodeURIComponent(s.shot_id)}`); } catch (e) { /* asked anyway */ }
    const said = !info.lines ? "No lines in this shot: no sound." : !m.sound ? "This model makes no sound: the lines are left for your own voice track." : m.voices ? (info.voices && info.voices.length ? `With sound, in ${info.voices.join(" and ")}'s voice${info.voices.length > 1 ? "s" : ""}.` : "With sound, but nobody in this shot has a voice yet (add one under The look), so the model picks voices.") : "With sound; this model picks its own voices (Seedance 2 and newer can use your characters' voices).";
    if (!asked && !confirm(`Make a ${len} s video of shot ${s.shot_id} from its picture with ${m.name}${m.res ? " at " + m.res : ""}?\n\n${said}\n\n${cost != null ? "About $" + cost.toFixed(2) + ", paid from your OpenRouter credit." : "Paid from your OpenRouter credit."} It takes a few minutes.`)) return;
    if (cost != null && window.Ibasho && !(await window.Ibasho.okToSpend(cost, "This video", { asked: true }))) return; // asked above; this only checks the cap
    await flush();
    try { S.draws = await send(`/api/anime/draw?id=${encodeURIComponent(S.id)}&shot=${encodeURIComponent(s.shot_id)}&what=video${pickQ(m)}`, "POST"); } catch (e) { alert(e.message); } changed(true); watchDraws();
  }
  /** A video made here becomes the shot's clip in use; the shot keeps its own length. */
  function setMadeClip(s, r) { if (s.clip && !Array.isArray(s.clip_takes)) s.clip_takes = clipTakes(s);
    s.clip_takes = s.clip_takes || []; if (!s.clip_takes.some((k) => k.url === r.url)) s.clip_takes.push({ url: r.url, dur: r.dur, sound: !!r.sound, poster: r.poster || "", name: String(r.name || "").slice(0, 60) });
    useClip(s, r, false); }
  /** A still drawn by a paid picture model: the estimate for n of them (0 for Codex). */
  const stillCost = (n) => { const P = MODELS.picture; if (!P || P.service !== "openrouter" || !P.pm || !window.IbashoPrice) return 0; const e = window.IbashoPrice.picture(P.pm, { quality: P.quality, size: [1536, 1024], refs: 3, chars: 2500 }); return (e.usd || 0) * n; };
  async function ask(shot, asked) { if (!asked && window.Ibasho && !(await window.Ibasho.okToSpend(stillCost(1), "This still"))) return; try { S.draws = await send(`/api/anime/draw?id=${encodeURIComponent(S.id)}&shot=${encodeURIComponent(shot)}${pickQ(MODELS.picture)}`, "POST"); } catch (e) { alert(e.message); } changed(true); watchDraws(); }
  function drawAllLabel() { const b = $("#drawAll"); if (!b) return; const n = S.plan.shots.filter((s) => !isAnime(s) && !active(s.shot_id)).length; b.hidden = !n; b.textContent = `Draw the ${n} shot${n === 1 ? "" : "s"} not yet in the look`; }
  let drawT = null;
  function watchDraws() { // while pictures are being drawn: look every few seconds, and take each one as it lands
    clearInterval(drawT); if (!S || !Object.keys(S.draws).some(active)) return;
    const id = S.id;
    let busy = false;
    const look = async () => { if (busy) return; busy = true; try { await lookOnce(); } finally { busy = false; } };
    const lookOnce = async () => {
      if (!S || S.id !== id) return clearInterval(drawT);
      const d = await api("/api/anime/draws?id=" + encodeURIComponent(id)).catch(() => null); if (!d) return;
      const sig = (x) => Object.keys(x).map((k) => k + x[k].status).join(), same = sig(d) === sig(S.draws);
      const landed = Object.keys(d).filter((k) => active(k) && d[k].status === "done" && (d[k].url || d[k].clip)); S.draws = d;
      if (!same && d.check && (d.check.status === "done" || d.check.status === "failed")) loadCheck(); else if (!same && d.check) drawCheck();
      for (const k of landed) {
        if (k === "check") continue;
        if (k.startsWith("sheet:")) { const c = S.look.cast[k.slice(6)]; if (c) c.sheet = d[k].url; continue; }
        if (k.startsWith("video:")) { const v = S.plan.shots.find((s) => s.shot_id === k.slice(6)); if (v && d[k].clip) { setMadeClip(v, d[k].clip); if (d[k].mediaRev) v.media_rev = d[k].mediaRev; } continue; }
        const a = S.plan.shots.find((s) => s.shot_id === k); if (a) { if (!a.comp_still && a.still) a.comp_still = a.still; a.still = d[k].url; if (d[k].mediaRev) a.media_rev = d[k].mediaRev; /* this screen has now seen it: a later pick of another take wins */ const t = S.takes[k] || (S.takes[k] = []); if (!t.includes(d[k].url)) t.push(d[k].url); } }
      if (!same && Object.keys(d).some((k) => k.startsWith("sheet:"))) drawLook();
      if (!same) changed(true); // the list is rebuilt only when something started, landed or failed, so typing is not disturbed
      if (!Object.keys(d).some(active)) { clearInterval(drawT); lookNow = null; }
    };
    drawT = setInterval(look, 3000); lookNow = look; // every 3 s; and at once when the page comes back from the background (phones slow timers there)
  }
  let lookNow = null;
  document.addEventListener("visibilitychange", () => { if (!document.hidden && lookNow) lookNow(); });
  const KIND = { person: "Character", place: "Place", prop: "Prop" };
  // ---------- asset check: do the drawn shots agree with each other and with the look's sheets? (it only warns) ----------
  async function loadCheck(method, bodyObj) { try { const u = "/api/anime/check?id=" + encodeURIComponent(S.id), r = method ? await send(u, method, bodyObj) : await api(u); S.ck = r; if (r.draws) S.draws = r.draws; } catch (e) { alert(e.message); } drawCheck(); }
  function drawCheck() {
    const el = $("#acheck"); if (!el) return; const k = S.ck || { drawn: 0, changed: [], open: 0 }, c = k.check, job = S.draws.check, on = active("check");
    const live = (f) => { const sh = S.plan.shots.find((x) => x.shot_id === f.shot); return !!sh && sh.still === f.image; };
    const open = c ? c.faults.filter((f) => !c.verdicts[f.id] && live(f)) : [];
    const state = on ? (job.status === "drawing" ? `Checking… ${Math.max(0, Math.round((Date.now() - job.at) / 60000))} min so far. You can keep working.` : "Waiting its turn in the queue.")
      : k.drawn < 2 ? "Draw at least two shots in the look first: there is nothing to compare yet."
      : !c ? `${k.drawn} shots drawn in the look, not checked yet.`
      : `${open.length ? `<b style="color:var(--amber)">${open.length} to look at</b>` : "The drawn shots agree with each other and the sheets"} · ${c.pictures} shots checked` + (k.changed.length ? ` · <b style="color:var(--amber)">${k.changed.length} changed since</b>` : "");
    const fault = (f) => { const v = c.verdicts[f.id], gone = !live(f);
      return `<div class="ckf ${v || gone ? "closed" : ""}" data-fault="${esc(f.id)}"><img src="${esc(img(f.image))}" alt="Shot ${esc(f.shot)}" loading="lazy">
        <div><div class="small"><b>Tile ${f.tile}</b> · shot ${esc(f.shot)} <span class="chip">${esc(f.about)}</span> <span class="chip ${f.sure === "high" ? "bad" : ""}">${f.sure === "high" ? "clear" : f.sure === "low" ? "possible" : "likely"}</span></div><p style="margin:4px 0 8px">${esc(f.what)}</p>
        ${gone ? `<span class="small muted">This shot's picture has since been replaced.</span>` : v ? `<span class="small muted">${v === "fine" ? "You said it is fine." : v === "sheet" ? "You said the sheet is wrong: change it under The look, then check again." : "Sent to be drawn again with this note."} <button class="btn sm ghost" data-ck="undo">Undo</button></span>`
          : `<div class="tools"><button class="btn sm" data-ck="redraw">Draw this shot again</button><button class="btn sm" data-ck="fine">It is fine</button><button class="btn sm" data-ck="sheet">The sheet is wrong</button><button class="btn sm" data-ck="show">Show the shot</button></div>`}</div></div>`; };
    el.innerHTML = `<b>Asset check</b> <span class="small muted">the same face, hair, outfit, hands, props and place from shot to shot, and against the look's sheets. It only warns.</span>
      <div class="small" style="margin:6px 0">${state}</div>${job && job.status === "failed" ? `<div class="small" style="color:var(--red)">The last check failed: ${esc(job.msg)}</div>` : ""}
      <div class="tools"><button class="btn sm ${c ? "" : "primary"}" data-ck="run" ${on || k.drawn < 2 ? "disabled" : ""}>${c ? "Check again" : "Check the drawn shots"}</button></div>
      ${c ? c.groups.map((g) => { const fs = c.faults.filter((f) => f.name === g.name).sort((a, b) => (!!(c.verdicts[a.id] || !live(a)) - !!(c.verdicts[b.id] || !live(b))) || a.tile - b.tile), n = fs.filter((f) => !c.verdicts[f.id] && live(f)).length;
        return `<details class="ckg" ${fs.length ? "open" : ""}><summary><b>${esc(g.name)}</b> <span class="small muted">${KIND[g.kind] || ""} · in ${g.tiles.length} shot${g.tiles.length === 1 ? "" : "s"}</span> <span class="chip ${n ? "bad" : "ok"}">${n ? n + " to look at" : "agrees"}</span></summary>
          ${(c.sheetNotes || []).filter((x) => x.name === g.name).map((x) => `<p class="small" style="color:var(--amber);margin:6px 0 0">About the sheet: ${esc(x.what)}</p>`).join("")}
          <div class="ckl">${g.sheet ? `<a href="${esc(img(g.sheet))}" target="_blank" rel="noopener"><img src="${esc(img(g.sheet))}" alt="${esc(g.name)}: sheet in the look" loading="lazy" style="border:2px solid var(--blue)"></a>` : ""}${g.lineups.map((u, i) => `<a href="${esc(img(u))}" target="_blank" rel="noopener"><img src="${esc(img(u))}&t=${encodeURIComponent(c.at)}" alt="${esc(g.name)}: line-up ${i + 1}" loading="lazy"></a>`).join("")}</div>
          ${fs.map(fault).join("")}</details>`; }).join("") : ""}`;
  }
  function wireCheck() {
    const el = $("#acheck"); if (!el) return;
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ck]"); if (!b) return; const act = b.dataset.ck;
      if (act === "run") { await flush(); await loadCheck("POST"); return watchDraws(); }
      const fe = b.closest("[data-fault]"), c = S.ck && S.ck.check, f = fe && c && c.faults.find((x) => x.id === fe.dataset.fault); if (!f) return;
      const i = S.plan.shots.findIndex((x) => x.shot_id === f.shot);
      if (act === "show") { if (i < 0) return; if (docked()) return select(i); S.open.add(f.shot); changed(true); const card = $(`#shots .shot[data-i="${i}"]`); if (card) card.scrollIntoView({ block: "center" }); return; }
      if (act === "redraw") { if (i < 0) return; const all = c.faults.filter((x) => x.shot === f.shot && x.image === f.image && (x.id === f.id || !c.verdicts[x.id])), sh = S.plan.shots[i];
        const note = "Fix from the last picture: " + all.map((x) => `${x.name}: ${x.what}`).join(" "); sh.draw_note = [String(sh.draw_note || "").replace(/\s*Fix from the last picture:[\s\S]*$/, "").trim(), note].filter(Boolean).join(" ");
        changed(true); await flush(); await ask(f.shot); for (const x of all) await loadCheck("PUT", { id: x.id, verdict: "redrawn" }); return; }
      await loadCheck("PUT", { id: f.id, verdict: act === "undo" ? "" : act });
    });
  }
  function drawLook() {
    const el = $("#look"); if (!el) return; const l = S.look, cast = l.cast || (l.cast = {});
    const have = new Set(Object.keys(cast).map((k) => k.toLowerCase())), missing = S.people.filter((q) => !have.has(q.name.toLowerCase()));
    const card = (n) => { const c = cast[n], d = S.draws["sheet:" + n], on = d && (d.status === "waiting" || d.status === "drawing"), src = S.people.find((q) => q.name === n);
      return `<div class="ref sheetc" data-name="${esc(n)}">
        ${c.sheet ? `<img src="${esc(img(c.sheet))}" alt="${esc(n)}: sheet in this look" loading="lazy">` : `<div class="nosheet">${src && src.manga ? `<img src="${esc(img(src.manga))}" alt="" loading="lazy"><span>manga sheet: not in this look yet</span>` : "<span>No sheet yet</span>"}</div>`}
        <b>${esc(n)} <span class="small muted" style="font-weight:400">${KIND[c.kind] || ""}</span></b>
        <textarea data-desc placeholder="${c.kind === "person" ? "Age, build, hair colour and cut, eye colour, clothes and their colours" : "What it looks like, with its colours"}">${esc(c.desc)}</textarea>
        ${on ? `<span class="chip busy">${d.status === "drawing" ? "Drawing the sheet…" : "Waiting its turn"}</span>` : `<div class="tools"><button class="btn sm" data-sheet="draw">${c.sheet ? "Draw again" : "Draw a sheet"}</button>
          <label class="btn sm" style="display:inline-flex;align-items:center;cursor:pointer">Upload<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-sheetup></label>
          <button class="btn sm" data-sheet="del">Remove</button></div>`}
        ${c.kind === "person" || !c.kind ? `<div class="voicec">${c.voice ? `<audio controls preload="none" src="${esc(img(c.voice))}" aria-label="${esc(n)}'s voice"></audio>
          <input class="small" data-voicenote value="${esc(c.voice_note || "")}" placeholder="About the voice (optional): calm, raspy, Kansai accent…" maxlength="200">
          <div class="tools"><label class="btn sm" style="display:inline-flex;align-items:center;cursor:pointer">Change the voice<input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.wav,.m4a,.ogg" hidden data-voiceup></label><button class="btn sm" data-sheet="voicedel">Remove the voice</button></div>`
          : `<label class="btn sm" style="display:inline-flex;align-items:center;cursor:pointer" title="A short, clean recording of how ${esc(n)} sounds (5 to 15 seconds). It goes with every shot ${esc(n)} is in.">Add ${esc(n)}'s voice<input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.wav,.m4a,.ogg" hidden data-voiceup></label>`}</div>` : ""}
        ${d && d.status === "failed" ? `<span class="chip bad">Not drawn: ${esc(d.msg)}</span>` : ""}</div>`; };
    const o = S.own, ownBox = S.show || !o ? "" : `<label class="ownTick"><input type="checkbox" id="ownOn" ${o.on ? "checked" : ""}> <b>This scene has its own style</b></label>
      <div class="small muted" style="margin:2px 0 8px">Tick this when one scene should look different from the rest of “${esc(l.name)}”: a flashback, a dream, a title sequence. Its shots are then drawn in the style below. The characters, places and props still come from the show's sheets.</div>
      ${o.on ? `<div class="ownStyle"><div class="field"><span>Start from one of ours (you can change the words after)</span>
        <div class="tmpls">${S.templates.map((t) => `<button class="tmplc" data-otmpl="${esc(t.id)}" aria-pressed="${o.template === t.id}"><img src="/anime/looks/${esc(t.id)}.jpg" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${esc(t.name)}</span></button>`).join("")}</div></div>
        <div class="field" style="margin-top:10px"><span>Pictures of the style for this scene</span>
        <div class="refs">${o.refs.map((r, i) => `<div class="ref" data-oref="${i}"><img src="${esc(img(r.url))}" alt="Style reference ${i + 1} for this scene" loading="lazy">
          <input data-orefnote placeholder="What to take from it (optional)" value="${esc(r.note)}" maxlength="200"><button class="btn sm" data-orefdel>Remove</button></div>`).join("")}
          ${o.refs.length < 8 ? `<label class="ref addref">+ Add reference pictures<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden id="ownAdd"></label>` : ""}</div></div>
        <label class="field" style="margin-top:10px"><span>This scene's style in words (empty = ${o.refs.length ? "your pictures with " : ""}our Clean TV anime look)</span><textarea id="ownText" placeholder="${esc(S.defaultLook)}">${esc(o.text)}</textarea></label></div>
        <div class="small muted" style="margin:12px 0 4px"><b>The show's look</b> (used by its other scenes; this scene uses only its sheets)</div>` : ""}`;
    el.innerHTML = ownBox + `<div class="tools" style="align-items:center"><b>${S.show ? "Name of the show" : "The show and its look"}</b>
        ${S.show ? "" : `<select id="lookUse" class="btn sm" style="max-width:240px" aria-label="Which show this scene belongs to">${S.looks.map((x) => `<option value="${esc(x.id)}" ${x.id === l.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}<option value="new">+ A new show…</option></select>`}
        <input id="lookName" value="${esc(l.name)}" maxlength="80" aria-label="Name of this look" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:4px;padding:5px 8px;background:var(--bg)"></div>
      ${S.show ? "" : `<div class="small muted" style="margin-top:4px">How the pictures are drawn. The look belongs to the show: every scene of “${esc(l.name)}” is drawn this way, with the same sheets. <a href="#/show/${E(l.id)}">Open the show</a></div>`}
      <div class="field" style="margin-top:10px"><span>Start from one of ours (you can change the words after)</span>
        <div class="tmpls">${S.templates.map((t) => `<button class="tmplc" data-tmpl="${esc(t.id)}" aria-pressed="${l.template === t.id}"><img src="/anime/looks/${esc(t.id)}.jpg" alt="" loading="lazy" onerror="this.style.visibility='hidden'"><span>${esc(t.name)}</span></button>`).join("")}</div></div>
      <div class="field" style="margin-top:10px"><span>Pictures of the look you are going for (every shot is drawn to match how they are drawn)</span>
      <div class="refs">${l.refs.map((r, i) => `<div class="ref" data-ref="${i}"><img src="${esc(img(r.url))}" alt="Look reference ${i + 1}" loading="lazy">
        <input data-refnote placeholder="What to take from it (optional)" value="${esc(r.note)}" maxlength="200"><button class="btn sm" data-refdel>Remove</button></div>`).join("")}
        ${l.refs.length < 8 ? `<label class="ref addref">+ Add reference pictures<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden id="lookAdd"></label>` : ""}</div></div>
      <label class="field" style="margin-top:10px"><span>The look in words (empty = ${l.refs.length ? "your pictures with " : ""}our Clean TV anime look)</span><textarea id="lookText" placeholder="${esc(S.defaultLook)}">${esc(l.text)}</textarea></label>
      <div class="field" style="margin-top:10px"><span>Characters, places and props in this look (their colours are settled once here, then sent with every shot they are in)</span>
        <div class="refs sheets">${Object.keys(cast).map(card).join("")}</div>
        <div class="tools" style="margin-top:8px;align-items:center">${missing.length ? `<span class="small muted">${S.show ? "In its scenes:" : "In this scene:"}</span>${missing.map((q) => `<button class="btn sm" data-addname="${esc(q.name)}">+ ${esc(q.name)}</button>`).join("")}${missing.length > 1 ? `<button class="btn sm" data-addname="*">+ All ${missing.length}</button>` : ""}` : ""}
          <input id="newName" placeholder="Another name" maxlength="60" style="width:150px;border:1px solid var(--line);border-radius:4px;padding:5px 8px;background:var(--bg)">
          <select id="newKind" class="btn sm" style="width:auto" aria-label="What it is"><option value="person">Character</option><option value="place">Place</option><option value="prop">Prop</option></select><button class="btn sm" id="newAdd">Add</button>
          ${Object.keys(cast).some((n) => !cast[n].sheet) ? `<button class="btn sm" id="sheetAll">Draw the sheets that are missing</button>` : ""}</div></div>`;
  }
  let ownT = null;
  const putOwn = () => send("/api/anime/style?id=" + E(S.id), "PUT", S.own).catch((e) => alert("This scene's style could not be saved: " + e.message));
  const saveOwn = (now) => { clearTimeout(ownT); if (now) return putOwn(); ownT = setTimeout(putOwn, 500); };
  let lookT = null;
  const putLook = () => send("/api/anime/look?" + ctx(), "PUT", S.look).then((r) => { S.looks = r.looks; }).catch((e) => alert("The look could not be saved: " + e.message));
  const saveLook = () => { clearTimeout(lookT); lookT = setTimeout(putLook, 500); };
  const flushLook = async () => { clearTimeout(lookT); await putLook(); };
  async function askSheet(name) { await flushLook(); try { S.draws = await send(`/api/anime/draw?${ctx()}&sheet=${encodeURIComponent(name)}`, "POST"); } catch (e) { alert(e.message); } drawLook(); S.show ? watchShow() : watchDraws(); }
  function wireLook() {
    const el = $("#look"); if (!el) return;
    const addName = (n, kind) => { const q = S.people.find((x) => x.name === n); S.look.cast[n] = { kind: kind || (q && q.kind) || "person", desc: (q && q.desc) || "", sheet: "" }; };
    el.addEventListener("input", (e) => {
      if (e.target.id === "ownText") { S.own.text = e.target.value; S.own.template = ""; saveOwn(); }
      const on = e.target.closest("[data-orefnote]"); if (on) { S.own.refs[+on.closest(".ref").dataset.oref].note = on.value; saveOwn(); }
      if (e.target.id === "lookText") { S.look.text = e.target.value; S.look.template = ""; saveLook(); }
      if (e.target.id === "lookName") { S.look.name = e.target.value; saveLook(); }
      const n = e.target.closest("[data-refnote]"); if (n) { S.look.refs[+n.closest(".ref").dataset.ref].note = n.value; saveLook(); }
      const d = e.target.closest("[data-desc]"); if (d) { S.look.cast[d.closest(".sheetc").dataset.name].desc = d.value; saveLook(); }
    });
    el.addEventListener("change", async (e) => {
      if (e.target.id === "ownOn") { S.own.on = e.target.checked; await saveOwn(true); S.sent = {}; return drawLook(); }
      if (e.target.id === "ownAdd") { for (const f of e.target.files) { if (S.own.refs.length >= 8) break; try { const r = await upload("style", f); S.own.refs.push({ url: r.url, note: "" }); } catch (err) { alert(f.name + ": " + err.message); } } saveOwn(true); return drawLook(); }
      if (e.target.id === "lookAdd") { for (const f of e.target.files) { if (S.look.refs.length >= 8) break; try { const r = await upload("look", f); S.look.refs.push({ url: r.url, note: "" }); } catch (err) { alert(f.name + ": " + err.message); } } saveLook(); drawLook(); }
      if (e.target.id === "lookUse") { const v = e.target.value; let q = "use=" + encodeURIComponent(v);
        if (v === "new") { const nm = prompt("Name of the new show", S.scene.title || ""); if (!nm) { e.target.value = S.look.id; return; } q += "&name=" + encodeURIComponent(nm); }
        await flushLook(); try { const r = await send(`/api/anime/look?id=${encodeURIComponent(S.id)}&${q}`, "POST"); S.look = r.look; S.looks = r.looks; } catch (err) { alert(err.message); } drawLook(); }
      const vu = e.target.closest("[data-voiceup]"); if (vu && vu.files[0]) { const n = vu.closest(".sheetc").dataset.name; try { const r = await upload("voice", vu.files[0], n + (vu.files[0].name.match(/\.\w+$/) || [".mp3"])[0]); S.look.cast[n].voice = r.url; } catch (err) { alert(err.message); } saveLook(); drawLook(); return; }
      const vn = e.target.closest("[data-voicenote]"); if (vn) { S.look.cast[vn.closest(".sheetc").dataset.name].voice_note = vn.value; saveLook(); return; }
      const up = e.target.closest("[data-sheetup]"); if (up && up.files[0]) { const n = up.closest(".sheetc").dataset.name; try { const r = await upload("sheet", up.files[0], n + (up.files[0].name.match(/\.\w+$/) || [".jpg"])[0]); S.look.cast[n].sheet = r.url; delete S.look.cast[n].removed; } catch (err) { alert(err.message); } saveLook(); drawLook(); }
    });
    el.addEventListener("click", (e) => {
      const ot = e.target.closest("[data-otmpl]"); if (ot) { const tp = S.templates.find((x) => x.id === ot.dataset.otmpl); if (S.own.text.trim() && S.own.template !== tp.id && !S.templates.some((x) => x.text === S.own.text.trim()) && !confirm("Replace the words of this scene's style with “" + tp.name + "”?")) return; S.own.template = tp.id; S.own.text = tp.text; saveOwn(true); return drawLook(); }
      if (e.target.closest("[data-orefdel]")) { S.own.refs.splice(+e.target.closest(".ref").dataset.oref, 1); saveOwn(true); return drawLook(); }
      const t = e.target.closest("[data-tmpl]"); if (t) { const tp = S.templates.find((x) => x.id === t.dataset.tmpl); if (S.look.text.trim() && S.look.template !== tp.id && S.look.text.trim() !== tp.text && !S.templates.some((x) => x.text === S.look.text.trim()) && !confirm("Replace the words of this look with “" + tp.name + "”?")) return; S.look.template = tp.id; S.look.text = tp.text; saveLook(); return drawLook(); }
      if (e.target.closest("[data-refdel]")) { S.look.refs.splice(+e.target.closest(".ref").dataset.ref, 1); saveLook(); return drawLook(); }
      const an = e.target.closest("[data-addname]"); if (an) { for (const q of an.dataset.addname === "*" ? S.people.filter((x) => !S.look.cast[x.name]) : [{ name: an.dataset.addname }]) addName(q.name); saveLook(); return drawLook(); }
      if (e.target.id === "newAdd") { const n = $("#newName").value.trim(); if (!n || S.look.cast[n]) return; addName(n, $("#newKind").value); saveLook(); return drawLook(); }
      if (e.target.id === "sheetAll") { const todo = Object.keys(S.look.cast).filter((n) => !S.look.cast[n].sheet && !active("sheet:" + n)); return (async () => { for (const n of todo) await askSheet(n); })(); }
      const b = e.target.closest("[data-sheet]"); if (!b) return; const n = b.closest(".sheetc").dataset.name;
      if (b.dataset.sheet === "draw") return askSheet(n);
      if (b.dataset.sheet === "voicedel") { if (!confirm(`Remove ${n}'s voice? Their shots go back to the model's own voices.`)) return; delete S.look.cast[n].voice; delete S.look.cast[n].voice_note; saveLook(); drawLook(); return; }
      if (b.dataset.sheet === "del") { if (!confirm(`Remove ${n} from this look? The sheet picture is no longer used.`)) return; delete S.look.cast[n]; saveLook(); drawLook(); }
    });
  }

  // ---------- sound: layers (one per voice, music, sound effects) with clips placed along the scene ----------
  const KINDS = { voice: "Voice", music: "Music", sfx: "Sound effects", clip: "Clip sound" };
  const shotStarts = () => { const m = {}; let t = 0; for (const s of S.plan.shots) { m[s.shot_id] = t; t += +s.duration || 0; } return { m, total: t }; };
  const clipStart = (c, st) => Math.max(0, (c.shot && st.m[c.shot] != null ? st.m[c.shot] : 0) + (+c.offset || 0));
  const clipLen = (c) => Math.max(0.05, +c.len > 0 ? +c.len : Math.max(0, (+c.dur || 0) - (+c.from || 0)) || 1);
  const r2 = (x) => Math.round(x * 100) / 100, same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();
  const speakers = () => [...new Set((S.plan.dialogue || []).filter((d) => d.speaker).map((d) => d.speaker))];
  const linesOf = (who) => (S.plan.dialogue || []).filter((d) => d.kind !== "title" && (!who || same(d.speaker, who))).map((d) => ({ d, shot: (S.plan.shots.find((s) => (s.lines || []).includes(d.line_id)) || {}).shot_id || "" }));
  const trackOf = (c) => S.sound.tracks.find((t) => t.id === c.track);
  /** The layers of a scene: a voice layer for everyone who speaks, then music, then sound effects. Clips from before layers find theirs by kind. */
  function ensureTracks() {
    const so = S.sound; let changed = false; if (!Array.isArray(so.tracks)) { so.tracks = []; changed = true; } if (!Array.isArray(so.gone)) so.gone = [];
    const add = (kind, name, who, at) => { const t = { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind, name, who: who || "", gain: 1, mute: false, solo: false }; at == null ? so.tracks.push(t) : so.tracks.splice(at, 0, t); changed = true; return t; };
    const fresh = !so.tracks.length;
    for (const w of speakers()) if (!so.tracks.some((t) => t.kind === "voice" && same(t.who, w)) && !so.gone.some((g) => same(g, w))) { let i = -1; so.tracks.forEach((t, k) => { if (t.kind === "voice") i = k; }); add("voice", w, w, fresh ? null : i + 1); }
    if (fresh) { add("music", "Music"); add("sfx", "Sound effects"); }
    // the sound that came with a shot's video clip: one sound clip per such shot, kept to the part of the video the shot shows
    for (let i = so.clips.length - 1; i >= 0; i--) { const c = so.clips[i]; if (!c.clipOf) continue; const sh = S.plan.shots.find((x) => x.shot_id === c.clipOf); if (!sh || sh.clip !== c.url || sh.clip_sound === false) { so.clips.splice(i, 1); changed = true; } }
    for (const sh of S.plan.shots) { if (!sh.clip || !sh.clip_sound) continue; let c = so.clips.find((x) => x.clipOf === sh.shot_id);
      if (!c) { const t = so.tracks.find((x) => x.kind === "clip") || add("clip", "Clip sound"); c = { id: "c" + Date.now().toString(36) + so.clips.length, kind: "clip", track: t.id, name: sh.shot_id + " clip", url: sh.clip, clipOf: sh.shot_id, shot: sh.shot_id, offset: 0, from: 0, len: 0, gain: 1, fadeIn: 0, fadeOut: 0, dur: +sh.clip_dur || 0 }; so.clips.push(c); changed = true; }
      const from = +sh.clip_from || 0, len = r2(Math.max(0.05, Math.min((+sh.clip_dur || 0) - from, +sh.duration || 0)));
      if (c.shot !== sh.shot_id || c.offset || c.from !== from || c.len !== len) { c.shot = sh.shot_id; c.offset = 0; c.from = from; c.len = len; changed = true; } }
    for (const c of so.clips) if (!trackOf(c)) { const k = KINDS[c.kind] ? c.kind : "sfx", t = so.tracks.find((x) => x.kind === k) || add(k, k === "voice" ? "Voice" : KINDS[k]); c.track = t.id; changed = true; }
    if (changed) { if (S.snd) S.snd.last = JSON.stringify(so); // layers made by the app itself are saved quietly and are not an undo step
      clearTimeout(S.sndT); S.sndT = setTimeout(() => send("/api/anime/sound?id=" + encodeURIComponent(S.id), "PUT", S.sound).catch(() => {}), 500); }
    return changed;
  }
  /** The sound engine: every clip plays over its own stretch of the scene at its layer's and its own loudness, with its fades. */
  const Mix = (() => {
    const AC = window.AudioContext || window.webkitAudioContext; let ctx = null, items = [];
    const hook = (x) => { if (!ctx || x.g || x.dead) return; try { const src = ctx.createMediaElementSource(x.a); x.g = ctx.createGain(); src.connect(x.g); x.g.connect(ctx.destination); x.a.volume = 1; } catch (e) { x.dead = true; } };
    function wake() { if (!AC) return; try { if (!ctx) ctx = new AC(); if (ctx.state === "suspended") ctx.resume().catch(() => {}); items.forEach(hook); } catch (e) { ctx = null; } } // called from a press, as browsers ask
    function build() { for (const x of items) x.a.pause(); if (!S || !S.sound) { items = []; return; } ensureTracks();
      const old = items; items = S.sound.clips.map((c) => old.find((x) => x.c === c && x.url === c.url) || { c, url: c.url, a: soundEl(c.url), g: null }); if (ctx) items.forEach(hook); }
    /** A clip's sound: for a shot's video, the sound saved beside it (.m4a) instead of downloading the whole video a second time;
     * clips made before 19 Nov 2026 have none, and fall back to the video file. */
    function soundEl(u) {
      const side = /f=clips\/[^&]*\.mp4$/.test(u) ? u.replace(/\.mp4$/, ".m4a") : "", a = Object.assign(new Audio("/" + (side || u)), { preload: "auto" });
      if (side) a.addEventListener("error", () => { if (a.fell) return; a.fell = true; a.src = "/" + u; a.load(); });
      return a; }
    const DUCK = { to: 0.35, before: 0.3, after: 0.4 }; let talk = []; // when anyone speaks: music set to dip goes down to 35 %
    function talking(st) { const solo = S.sound.tracks.some((x) => x.solo); talk = S.sound.clips.filter((c) => { const t = trackOf(c); return !c.off && t && t.kind === "voice" && !t.mute && (!solo || t.solo); }).map((c) => { const a = clipStart(c, st); return [a, a + clipLen(c)]; }); }
    const duck = (now) => { let m = 1; for (const [s, e] of talk) { if (now < s - DUCK.before || now > e + DUCK.after) continue; m = Math.min(m, now < s ? 1 - ((now - (s - DUCK.before)) / DUCK.before) * (1 - DUCK.to) : now <= e ? DUCK.to : DUCK.to + ((now - e) / DUCK.after) * (1 - DUCK.to)); } return m; };
    function level(c, into, now) { const t = trackOf(c) || { gain: 1 }, solo = S.sound.tracks.some((x) => x.solo); if (t.mute || (solo && !t.solo)) return 0;
      if (c.duck && t.kind === "music") return Math.max(0, (c.gain == null ? 1 : +c.gain) * (t.gain == null ? 1 : +t.gain) * duck(now) * Math.max(0, Math.min(1, +c.fadeIn > 0 ? into / +c.fadeIn : 1, +c.fadeOut > 0 ? (clipLen(c) - into) / +c.fadeOut : 1)));
      const len = clipLen(c), fi = +c.fadeIn || 0, fo = +c.fadeOut || 0, env = Math.max(0, Math.min(1, fi > 0 ? into / fi : 1, fo > 0 ? (len - into) / fo : 1));
      return Math.max(0, (c.gain == null ? 1 : +c.gain) * (t.gain == null ? 1 : +t.gain) * env); }
    function tick(t, playing) { if (!S || !S.sound) return; const st = shotStarts(); talking(st);
      for (const x of items) { const at = clipStart(x.c, st), on = playing && !x.c.off && t >= at && t < at + clipLen(x.c), want = (+x.c.from || 0) + (t - at), v = on ? level(x.c, t - at, t) : 0;
        x.v = v; if (x.g) x.g.gain.value = v; else x.a.volume = Math.min(1, v);
        // start once and let it play: it used to set the time again on every frame until play() began, and to seek whenever it was a
        // little behind while still loading, which is what made the sound stutter (19 Nov 2026)
        if (on) { if (x.a.paused) { if (!x.starting) { x.starting = true; x.a.currentTime = want; x.a.play().catch(() => {}).finally(() => { x.starting = false; }); } }
          else if (!x.a.seeking && x.a.readyState >= 3 && Math.abs(x.a.currentTime - want) > 0.35) x.a.currentTime = want; }
        else if (!x.a.paused) x.a.pause(); } }
    const stop = () => { for (const x of items) x.a.pause(); };
    return { build, tick, stop, wake, state: () => items.map((x) => ({ name: x.c.name, playing: !x.a.paused, level: r2(x.v || 0) })) };
  })();
  window.__mix = () => Mix.state(); // for tests: what each clip is doing now
  // the clock the sound follows: the player when it sits beside the timeline (wide windows), else a clock of its own that plays sound alone
  const Solo = { t: 0, on: false, last: 0 };
  const withPlayer = () => docked() && Player.active();
  const Clock = { time: () => (withPlayer() ? Player.time() : Solo.t), playing: () => (withPlayer() ? Player.playing() : Solo.on),
    seek: (x) => { const tot = shotStarts().total; x = Math.max(0, Math.min(tot, x)); if (withPlayer()) Player.seek(x); else { Solo.t = x; Mix.tick(Solo.t, Solo.on); } },
    toggle: () => { Mix.build(); Mix.wake(); if (withPlayer()) return Player.toggle(); if (Solo.t >= shotStarts().total - 0.05) Solo.t = 0; Solo.on = !Solo.on; Solo.last = performance.now(); } };
  let sndRaf = 0;
  function sndLoop(now) { // moves the playhead; on a narrow screen it is also the clock
    const head = $("#sndHead"); if (!head || !S) { sndRaf = 0; Solo.on = false; return; }
    if (!withPlayer()) { if (Solo.on) { Solo.t += (now - Solo.last) / 1000; const tot = shotStarts().total; if (Solo.t >= tot) { Solo.t = tot; Solo.on = false; } } Solo.last = now; Mix.tick(Solo.t, Solo.on); }
    const t = Clock.time(); head.style.left = t * (S.snd.pps || 1) + "px";
    const b = $("#sndPlay"), txt = Clock.playing() ? "❚❚ Pause" : "▶ Play"; if (b && b.dataset.txt !== txt) { b.dataset.txt = txt; b.textContent = txt; } // (compared by what was set: the shown words may be translated)
    const tm = $("#sndTime"); if (tm) tm.textContent = `${t.toFixed(1)} / ${shotStarts().total.toFixed(1)} s`;
    sndRaf = requestAnimationFrame(sndLoop);
  }
  /** Shots whose spoken recordings run past the shot's end: [{ shot, i, has (its length now), need (the length that fits its lines) }]. */
  function longLines() {
    const st = shotStarts(), out = []; if (!S.sound.tracks) return out;
    S.plan.shots.forEach((s, i) => { const a = st.m[s.shot_id], d = +s.duration || 0; let end = 0;
      for (const c of S.sound.clips) { const t = trackOf(c); if (!t || t.kind !== "voice" || c.off) continue; const at = clipStart(c, st); if (at >= a - 0.001 && at < a + d) end = Math.max(end, at + clipLen(c) - a); }
      if (end > d + 0.05) out.push({ shot: s.shot_id, i, has: d, need: Math.ceil((end + 0.2) * 10) / 10 }); });
    return out;
  }
  function drawSound() {
    const el = $("#sound"); if (!el) return; if (!S.snd) S.snd = { sel: -1, track: "", zoom: 1, pps: 10, hist: [], redo: [], last: null };
    const fixed = ensureTracks(); if (S.snd.last == null) S.snd.last = JSON.stringify(S.sound);
    const so = S.sound, cs = so.clips, st = shotStarts(), total = Math.max(st.total, 0.1), U = S.snd;
    const headW = el.clientWidth && el.clientWidth < 560 ? 104 : 168, room = Math.max(200, (el.clientWidth || 700) - headW - 26), pps = (U.pps = Math.max(4, (room / total) * U.zoom)), W = Math.max(room, total * pps), px = (x) => Math.round(x * pps * 10) / 10;
    if (U.sel >= cs.length) U.sel = -1; if (U.track && !so.tracks.some((t) => t.id === U.track)) U.track = "";
    const anySolo = so.tracks.some((t) => t.solo);
    const lane = (t) => `<div class="ltrack ${t.mute || (anySolo && !t.solo) ? "quiet" : ""}" data-lane="${esc(t.id)}">${S.plan.shots.slice(1).map((s) => `<i class="ltick" style="left:${px(st.m[s.shot_id])}px"></i>`).join("")}
      ${t.kind === "voice" ? linesOf(t.who).filter((x) => x.shot && (t.who || x.d.speaker)).map((x) => `<i class="lmark ${cs.some((c) => c.line === x.d.line_id) ? "has" : ""}" style="left:${px(st.m[x.shot])}px" title="${esc((x.d.speaker ? x.d.speaker + ": " : "") + x.d.text)}"></i>`).join("") : ""}
      ${cs.map((c, i) => (c.track === t.id && !c.off ? `<div class="lclip ${esc(t.kind)} ${i === U.sel ? "sel" : ""}" data-clip="${i}" role="button" tabindex="0" aria-label="${esc(c.name)}: drag to move, drag its ends to trim" style="left:${px(clipStart(c, st))}px;width:${Math.max(10, px(clipLen(c)))}px"><canvas class="wave" data-wave="${i}"></canvas><i class="hl"></i><span>${esc(c.name)}</span><i class="hr"></i></div>` : "")).join("")}</div>`;
    const head = (t) => `<div class="tlh ${t.id === U.track ? "sel" : ""}" data-track="${esc(t.id)}"><button class="tname" data-tsel title="${esc(t.name)}: open this layer's settings">${esc(t.name)}</button>
      <button class="tbtn" data-mute aria-pressed="${!!t.mute}" aria-label="Mute ${esc(t.name)}" title="Mute">M</button><button class="tbtn" data-solo aria-pressed="${!!t.solo}" aria-label="Hear only ${esc(t.name)}" title="Hear only this layer">S</button>
      <label class="tbtn" title="Add sound files to ${esc(t.name)}" aria-label="Add sound files to ${esc(t.name)}">+<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" multiple hidden data-addsound="${esc(t.id)}"></label></div>`;
    const sc = U.sel >= 0 ? cs[U.sel] : null, tr = sc ? trackOf(sc) : so.tracks.find((t) => t.id === U.track);
    const keepX = (el.querySelector(".tlscroll") || {}).scrollLeft || 0;
    el.innerHTML = `<div class="tools" style="align-items:center"><b>Sound</b><span class="small muted grow">One layer for each voice, plus music and sound effects. Everything plays with the animatic.</span></div>
      <div class="tools mixbar"><button class="btn sm primary" id="sndPlay">▶ Play</button><span class="small" id="sndTime"></span><span class="spacer"></span>
        <button class="btn sm" data-step="-1" ${U.hist.length ? "" : "disabled"} aria-label="Undo the last change to the sound" title="Undo">↶ Undo</button><button class="btn sm" data-step="1" ${U.redo.length ? "" : "disabled"} aria-label="Redo" title="Redo">↷</button>
        <button class="btn sm" data-zoom="out" aria-label="Zoom out" ${U.zoom <= 1 ? "disabled" : ""}>−</button><button class="btn sm" data-zoom="in" aria-label="Zoom in" ${U.zoom >= 16 ? "disabled" : ""}>+</button>
        <select id="sndAddLayer" class="btn sm" aria-label="Add a layer"><option value="">+ Add a layer…</option><option value="voice">A voice layer</option><option value="music">A music layer</option><option value="sfx">A sound effects layer</option><option value="clip">A clip sound layer</option></select></div>
      <div class="tl ${headW < 150 ? "narrow" : ""}" style="--headw:${headW}px"><div class="tlheads"><div class="tlh rulerh small muted">Shots</div>${so.tracks.map(head).join("")}</div>
        <div class="tlscroll"><div class="tlin" style="width:${Math.ceil(W)}px"><div class="ruler" data-ruler>${S.plan.shots.map((s) => `<span style="left:${px(st.m[s.shot_id])}px">${esc(s.shot_id.replace(/^S0*/, ""))}</span>`).join("")}</div>
          ${so.tracks.map(lane).join("")}<i class="phead" id="sndHead"></i></div></div></div>
      ${(() => { const L = longLines(); return L.length ? `<div class="fitbox"><b>${L.length === 1 ? "A line runs longer than its shot" : L.length + " lines run longer than their shots"}</b>
        ${L.map((x) => `<div class="tools" style="align-items:center"><span class="grow small">Shot ${esc(x.shot)} is ${fmt(x.has)} long, but its recording needs ${fmt(x.need)}.</span><button class="btn sm" data-fit="${x.i}">Make the shot ${fmt(x.need)}</button></div>`).join("")}
        ${L.length > 1 ? `<div class="tools"><button class="btn sm primary" data-fit="all">Make all ${L.length} shots fit their lines</button></div>` : ""}
        <div class="small muted">The shot gets longer and everything after it moves later; clips stay with their shots.</div></div>` : ""; })()}
      <div id="sndEdit">${sc ? clipEditor(sc, U.sel, tr) : tr ? layerEditor(tr) : `<div class="small muted">${cs.length ? "Press a clip to change it, or a layer's name for its settings. Drag a clip to move it (it can go to another layer); drag its ends to trim it. Press the shot numbers to move the playhead." : "Nothing yet. Press + on a layer to add sound files to it: recordings of each line on that character's layer, a music track, sound effects. Then drag them to where they belong."}</div>`}</div>`;
    const sl = el.querySelector(".tlscroll"); if (sl) sl.scrollLeft = keepX;
    if (fixed) saveSound(false);
    if (!sndRaf) sndRaf = requestAnimationFrame(sndLoop);
    paintWaves();
  }
  const PEAKS = new Map(); // sound file -> its outline (50 values a second), asked for once
  const peaksOf = (c) => { const f = (/[?&]f=([^&]+)/.exec(c.url) || [])[1]; if (!f) return Promise.resolve(null); const k = S.id + "/" + f;
    if (!PEAKS.has(k)) PEAKS.set(k, api(`/api/anime/peaks?id=${E(S.id)}&f=${f}`).catch(() => null)); return PEAKS.get(k); };
  function paintWaves() { // the part of each sound that its clip plays, drawn inside the clip
    for (const cv of document.querySelectorAll("#sound canvas.wave")) { const c = S.sound.clips[+cv.dataset.wave]; if (!c) continue;
      peaksOf(c).then((pk) => { if (!pk || !pk.v || !cv.isConnected) return; const w = Math.min(4000, Math.max(8, Math.round(cv.clientWidth))), h = 28, g = cv.getContext("2d"); cv.width = w; cv.height = h;
        const a = (+c.from || 0) * pk.rate, n = clipLen(c) * pk.rate; g.fillStyle = "rgba(255,255,255,.42)";
        for (let x = 0; x < w; x++) { let m = 0; const i0 = Math.floor(a + (x / w) * n), i1 = Math.max(i0 + 1, Math.floor(a + ((x + 1) / w) * n)); for (let i = i0; i < i1 && i < pk.v.length; i++) if (pk.v[i] > m) m = pk.v[i];
          const bar = Math.max(1, (m / 255) * h); g.fillRect(x, (h - bar) / 2, 1, bar); } }); }
  }
  function clipEditor(c, i, tr) {
    const so = S.sound, who = tr && tr.kind === "voice" ? tr.who : "", lines = tr && tr.kind === "voice" ? linesOf(who).filter((x) => x.shot) : [];
    return `<div class="clip" data-clip="${i}"><div class="tools" style="align-items:center"><span class="chip">${esc(tr ? tr.name : "")}</span><input class="cname grow" data-s="name" value="${esc(c.name)}" maxlength="80" aria-label="Name of this clip">
        <button class="btn sm" data-snd="hear">▶ Hear it</button><button class="btn sm" data-snd="split" title="Cut this clip in two where the playhead is">Split at the playhead</button><button class="btn sm" data-snd="dup">Duplicate</button><button class="btn sm" data-snd="del">Remove</button></div>
      <div class="cgrid">
        <label class="field"><span>Layer</span><select data-s="track">${so.tracks.map((t) => `<option value="${esc(t.id)}" ${t.id === c.track ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
        ${lines.length ? `<label class="field"><span>Which line this is</span><select data-s="line"><option value="">no line in particular</option>${lines.map((x) => `<option value="${esc(x.d.line_id)}" ${c.line === x.d.line_id ? "selected" : ""}>${esc((who ? "" : (x.d.speaker || "") + ": ") + x.d.text.slice(0, 60))}</option>`).join("")}</select></label>` : ""}
        <label class="field"><span>Starts with</span><select data-s="shot"><option value="">the scene</option>${S.plan.shots.map((s) => `<option value="${esc(s.shot_id)}" ${c.shot === s.shot_id ? "selected" : ""}>shot ${esc(s.shot_id)}</option>`).join("")}</select></label>
        <label class="field"><span>Seconds after that</span><input type="number" step="0.1" data-s="offset" value="${esc(r2(+c.offset || 0))}"></label>
        <label class="field"><span>Skip the first (s)</span><input type="number" step="0.1" min="0" data-s="from" value="${esc(r2(+c.from || 0))}"></label>
        <label class="field"><span>Play for (s, empty = all${c.dur ? " of " + fmt(c.dur) : ""})</span><input type="number" step="0.1" min="0" data-s="len" value="${c.len ? esc(r2(c.len)) : ""}"></label>
        <label class="field"><span>Loudness ${Math.round((c.gain == null ? 1 : c.gain) * 100)}%</span><input type="range" min="0" max="2" step="0.05" data-s="gain" value="${esc(c.gain == null ? 1 : +c.gain || 0)}"></label>
        <label class="field"><span>Fade in (s)</span><input type="number" step="0.1" min="0" data-s="fadeIn" value="${esc(+c.fadeIn || 0)}"></label>
        <label class="field"><span>Fade out (s)</span><input type="number" step="0.1" min="0" data-s="fadeOut" value="${esc(+c.fadeOut || 0)}"></label>
        ${tr && tr.kind === "music" ? `<label class="tick"><input type="checkbox" data-s="duck" ${c.duck ? "checked" : ""}> Dip under voices <span class="small muted">(goes down to 35% while anyone speaks)</span></label>` : ""}
      </div></div>`;
  }
  function layerEditor(t) {
    const so = S.sound, i = so.tracks.indexOf(t), mine = so.clips.filter((c) => c.track === t.id), lines = t.kind === "voice" && t.who ? linesOf(t.who).filter((x) => x.shot) : [];
    return `<div class="clip" data-layer="${esc(t.id)}"><div class="tools" style="align-items:center"><span class="chip">Layer</span><input class="cname grow" data-t="name" value="${esc(t.name)}" maxlength="60" aria-label="Name of this layer">
        <button class="btn sm" data-lay="up" ${i ? "" : "disabled"}>Move up</button><button class="btn sm" data-lay="down" ${i < so.tracks.length - 1 ? "" : "disabled"}>Move down</button><button class="btn sm" data-lay="mute" aria-pressed="${!!t.mute}">${t.mute ? "Muted" : "Mute"}</button><button class="btn sm" data-lay="solo" aria-pressed="${!!t.solo}">${t.solo ? "Hearing only this" : "Hear only this"}</button><button class="btn sm" data-lay="del">Remove the layer</button></div>
      <div class="cgrid">
        <label class="field"><span>What it holds</span><select data-t="kind">${Object.keys(KINDS).map((k) => `<option value="${k}" ${t.kind === k ? "selected" : ""}>${KINDS[k]}</option>`).join("")}</select></label>
        ${t.kind === "voice" ? `<label class="field"><span>Whose voice</span><select data-t="who"><option value="">nobody in particular</option>${[...new Set([...speakers(), t.who].filter(Boolean))].map((w) => `<option ${same(w, t.who) ? "selected" : ""}>${esc(w)}</option>`).join("")}</select></label>` : ""}
        <label class="field"><span>Layer loudness ${Math.round((t.gain == null ? 1 : t.gain) * 100)}%</span><input type="range" min="0" max="2" step="0.05" data-t="gain" value="${esc(t.gain == null ? 1 : +t.gain || 0)}"></label>
      </div>
      <div class="tools" style="align-items:center">${recButton(t, "")}<span class="small muted">records onto this layer at the playhead</span></div>
      <div class="small muted">${mine.length} clip${mine.length === 1 ? "" : "s"} on this layer. ${t.kind === "music" ? "A new music clip starts at 60% so voices stay clear." : ""}</div>
      ${lines.length ? `<div class="field"><span>${esc(t.who)}'s lines (add a recording to a line and it lands where the line is spoken)</span>
        <div class="vlines">${lines.map((x) => { const has = so.clips.some((c) => c.line === x.d.line_id); return `<div class="vline"><span class="chip ${has ? "ok" : ""}">${has ? "Recorded" : "No recording"}</span><span class="grow">${esc(x.d.text)} <span class="small muted">shot ${esc(x.shot)}</span></span>
          ${(() => { const rec = so.clips.find((c) => c.line === x.d.line_id && !c.off && c.url); return rec ? `<button class="btn sm" type="button" data-hear="${esc(rec.url)}" data-hear-shot="${esc(x.shot)}" data-hear-line="${esc(x.d.line_id)}" title="The words in this recording, with their times, from a Whisper on this computer (free, nothing is sent anywhere)">Write down what is said</button>` : ""; })()}
          ${recButton(t, x.d.line_id)}<label class="btn sm" style="display:inline-flex;align-items:center;cursor:pointer">${has ? "Add another file" : "Add a file"}<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" hidden data-addsound="${esc(t.id)}" data-line="${esc(x.d.line_id)}"></label>
          ${(() => { const tk = so.clips.map((c, ci) => ({ c, ci })).filter((q) => q.c.line === x.d.line_id); return tk.length > 1 || tk.some((q) => q.c.off) ? `<div class="takerow">${tk.map((q, n) => `<span class="take ${q.c.off ? "" : "used"}">Take ${n + 1} · ${fmt(clipLen(q.c))} <button class="btn sm" data-take="hear" data-ci="${q.ci}" aria-label="Hear take ${n + 1}">▶</button>${q.c.off ? `<button class="btn sm" data-take="use" data-ci="${q.ci}">Use this</button>` : `<span class="chip ok">In use</span>`}<button class="btn sm" data-take="del" data-ci="${q.ci}" aria-label="Remove take ${n + 1}">✕</button></span>`).join("")}</div>` : ""; })()}</div>`; }).join("")}</div></div>` : ""}
      ${canRecord() ? "" : `<div class="small muted">Recording inside the app needs a safe address (https), which this one is not: “Record” opens your phone's own recorder where it has one, or lets you pick a recording you made. On the PC itself (localhost) the app records directly.</div>`}</div>`;
  }
  /** Undo for the sound: every saved change keeps the state before it (the newest 80). */
  function soundStep(dir) { const U = S.snd, from = dir < 0 ? U.hist : U.redo, to = dir < 0 ? U.redo : U.hist; if (!from || !from.length) return;
    to.push(JSON.stringify(S.sound)); S.sound = JSON.parse(from.pop()); U.last = JSON.stringify(S.sound); U.sel = -1; U.track = ""; saveSound(true, true); }
  function saveSound(redraw, stepping) {
    const U = S.snd; if (U) { const now = JSON.stringify(S.sound); if (!stepping && U.last != null && now !== U.last) { (U.hist || (U.hist = [])).push(U.last); if (U.hist.length > 80) U.hist.shift(); U.redo = []; } U.last = now; }
    if (redraw) drawSound(); Mix.build(); drawSummary(); // the count of what is still to do follows the sound
    clearTimeout(S.sndT); S.sndT = setTimeout(() => send("/api/anime/sound?id=" + encodeURIComponent(S.id), "PUT", S.sound).catch((e) => alert("The sound could not be saved: " + e.message)), 500);
  }
  /** A sound file onto a layer: at the playhead, or, for a recording of a line, where that line is spoken (after any earlier line of the same shot). */
  async function addSound(trackId, f, line, name) {
    const so = S.sound, t = so.tracks.find((x) => x.id === trackId), st = shotStarts(); if (!t) return;
    try { const r = await upload("audio", f, name), dur = await duration("/" + r.url), c = { id: "c" + Date.now().toString(36) + so.clips.length, kind: t.kind, track: t.id, name: (name || f.name || "sound").replace(/\.\w+$/, ""), url: r.url, shot: "", offset: 0, from: 0, len: 0, gain: t.kind === "music" ? 0.6 : 1, fadeIn: 0, fadeOut: 0, dur, duck: t.kind === "music" };
      const all = linesOf(""), me = all.findIndex((x) => x.d.line_id === line), lshot = me >= 0 ? all[me].shot : "";
      if (lshot) { c.line = line; c.shot = lshot; let end = 0; // lines of one shot are laid one after another, in the order they are spoken
        const was = so.clips.find((o) => o.line === line && !o.off); // a new take of a line takes the place of the one in use; the older takes are kept, switched off
        for (const o of so.clips) { const k = all.findIndex((x) => x.d.line_id === o.line); if (!o.off && o.shot === lshot && k >= 0 && k < me) end = Math.max(end, (+o.offset || 0) + clipLen(o) + 0.15); } c.offset = was ? +was.offset || 0 : r2(end);
        for (const o of so.clips) if (o.line === line) o.off = true; }
      else { const at = Math.min(S.snd.addAt != null ? S.snd.addAt : Clock.time(), Math.max(0, st.total - 0.1)); let sh = ""; for (const x of S.plan.shots) if (st.m[x.shot_id] <= at + 1e-6) sh = x.shot_id; c.shot = sh; c.offset = r2(at - (sh ? st.m[sh] : 0)); S.snd.addAt = at + (dur || 1); }
      so.clips.push(c); S.snd.sel = so.clips.length - 1; S.snd.track = ""; }
    catch (err) { alert((f.name || "The recording") + ": " + err.message); }
  }
  // Recording in the browser: the microphone is only offered to a page on a safe address (https, or this computer itself).
  const canRecord = () => !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  let REC = null; // { rec, stream, chunks, t0, timer, track, line, name }
  async function record(btn) {
    if (REC) { if (REC.rec.state !== "inactive") REC.rec.stop(); return; } // the same button stops it
    const track = btn.dataset.rec, line = btn.dataset.line || "", t = S.sound.tracks.find((x) => x.id === track); if (!t) return;
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { return alert("The microphone could not be used: " + (e.name === "NotAllowedError" ? "this page was not given leave to use it. Allow the microphone for this site in the browser, then press Record again." : e.message)); }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "", rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const ln = line ? linesOf("").find((x) => x.d.line_id === line) : null, n = S.sound.clips.filter((c) => c.track === track).length + 1;
    REC = { rec, stream, chunks: [], t0: Date.now(), track, line, name: (ln ? `${t.name} ${ln.shot} take ${S.sound.clips.filter((c) => c.line === line).length + 1}` : `${t.name} recording ${n}`).slice(0, 60) };
    S.snd.addAt = Clock.time(); if (Clock.playing()) Clock.toggle(); // quiet while recording
    rec.ondataavailable = (e) => { if (e.data && e.data.size) REC.chunks.push(e.data); };
    rec.onstop = async () => { const R = REC; REC = null; clearInterval(R.timer); for (const tr of R.stream.getTracks()) tr.stop();
      const blob = new Blob(R.chunks, { type: rec.mimeType || type || "audio/webm" }); if (blob.size < 800) { drawSound(); return alert("Nothing was recorded. Check the microphone and try again."); }
      const ext = /mp4/.test(blob.type) ? ".mp4" : ".webm"; await addSound(R.track, blob, R.line, R.name + ext); S.snd.addAt = null; saveSound(true); };
    rec.start(); REC.timer = setInterval(() => { const b = $("[data-rec].recording"); if (b && REC) b.textContent = `■ Stop (${((Date.now() - REC.t0) / 1000).toFixed(0)} s)`; }, 300);
    drawSound();
  }
  const recButton = (t, line) => { const on = REC && REC.track === t.id && (REC.line || "") === (line || "");
    return canRecord() ? `<button class="btn sm ${on ? "recording" : ""}" data-rec="${esc(t.id)}" ${line ? `data-line="${esc(line)}"` : ""} ${REC && !on ? "disabled" : ""}>${on ? "■ Stop" : "● Record"}</button>`
      : `<label class="btn sm" style="display:inline-flex;align-items:center;cursor:pointer" title="Opens your phone's own recorder where it has one">● Record<input type="file" accept="audio/*" capture hidden data-addsound="${esc(t.id)}" ${line ? `data-line="${esc(line)}"` : ""}></label>`; };
  const duration = (url) => new Promise((ok) => { const a = new Audio(); a.preload = "metadata"; a.onloadedmetadata = () => ok(isFinite(a.duration) ? Math.round(a.duration * 100) / 100 : 0); a.onerror = () => ok(0); a.src = url; });
  let hearing = null;
  function wireSound() {
    const el = $("#sound"); if (!el) return; const so = () => S.sound, U = () => S.snd;
    /** Where a clip starts, as the shot it falls in and the seconds after that shot begins: it then follows the shot when lengths or order change. */
    const place = (c, abs) => { const st = shotStarts(); let at = ""; for (const s of S.plan.shots) if (st.m[s.shot_id] <= abs + 1e-6) at = s.shot_id; c.shot = at; c.offset = r2(abs - (at ? st.m[at] : 0)); };
    el.addEventListener("change", async (e) => {
      const add = e.target.closest("[data-addsound]");
      if (add) { S.snd.addAt = null; for (const f of add.files) await addSound(add.dataset.addsound, f, add.dataset.line || ""); return saveSound(true); }
      if (e.target.id === "sndAddLayer") { const k = e.target.value; if (!k) return; const n = so().tracks.filter((x) => x.kind === k).length + 1, t = { id: "t" + Date.now().toString(36), kind: k, name: (k === "voice" ? "Voice" : KINDS[k]) + (n > 1 ? " " + n : ""), who: "", gain: 1, mute: false, solo: false };
        let i = -1; so().tracks.forEach((x, j) => { if (x.kind === k) i = j; }); so().tracks.splice(i < 0 ? so().tracks.length : i + 1, 0, t); U().track = t.id; U().sel = -1; return saveSound(true); }
      const lt = e.target.closest("[data-t]"); if (lt) { const t = so().tracks.find((x) => x.id === lt.closest("[data-layer]").dataset.layer), k = lt.dataset.t; if (!t) return;
        if (k === "gain") t.gain = Math.max(0, Math.min(2, +lt.value)); else if (k === "kind") { t.kind = lt.value; for (const c of so().clips) if (c.track === t.id) c.kind = t.kind; } else if (k === "who") { t.who = lt.value; if (lt.value && (!t.name || /^Voice( \d+)?$/.test(t.name))) t.name = lt.value; } else t.name = lt.value.trim() || t.name;
        return saveSound(true); }
      const inp = e.target.closest("[data-s]"); if (!inp) return;
      const c = so().clips[+inp.closest(".clip").dataset.clip], k = inp.dataset.s; if (!c) return;
      if (k === "shot") { c.shot = inp.value; c.offset = 0; } // jumps to the start of that shot and follows it from now on
      else if (k === "name") c.name = inp.value.trim() || c.name;
      else if (k === "duck") c.duck = inp.checked;
      else if (k === "track") { c.track = inp.value; c.kind = (trackOf(c) || {}).kind || c.kind; }
      else if (k === "line") { c.line = inp.value; const x = linesOf("").find((q) => q.d.line_id === inp.value); if (x && x.shot) { c.shot = x.shot; c.offset = 0; } }
      else c[k] = Math.max(k === "offset" ? -600 : 0, +inp.value || 0);
      saveSound(true);
    });
    el.addEventListener("click", (e) => {
      if (e.target.closest("#sndPlay")) return Clock.toggle();
      const stp = e.target.closest("[data-step]"); if (stp) return soundStep(+stp.dataset.step);
      const tk = e.target.closest("[data-take]"); if (tk) { const c = so().clips[+tk.dataset.ci]; if (!c) return; if (hearing) { hearing.pause(); hearing = null; }
        if (tk.dataset.take === "hear") { hearing = new Audio("/" + c.url); hearing.currentTime = +c.from || 0; hearing.play().catch(() => {}); const stop = hearing; setTimeout(() => stop.pause(), Math.min(15000, clipLen(c) * 1000)); return; }
        if (tk.dataset.take === "use") { const cur = so().clips.find((o) => o.line === c.line && !o.off); if (cur) { c.shot = cur.shot; c.offset = cur.offset; c.track = cur.track; } for (const o of so().clips) if (o.line === c.line) o.off = o !== c; }
        if (tk.dataset.take === "del") { if (!confirm(`Remove this take (“${c.name}”)?`)) return; const line = c.line, used = !c.off; so().clips.splice(+tk.dataset.ci, 1); if (used) { const next = so().clips.filter((o) => o.line === line).pop(); if (next) next.off = false; } }
        return saveSound(true); }
      const fit = e.target.closest("[data-fit]"); if (fit) { for (const x of longLines()) if (fit.dataset.fit === "all" || +fit.dataset.fit === x.i) S.plan.shots[x.i].duration = x.need; return changed(true); }
      const rec = e.target.closest("[data-rec]"); if (rec) return record(rec);
      const z = e.target.closest("[data-zoom]"); if (z) { U().zoom = Math.max(1, Math.min(16, U().zoom * (z.dataset.zoom === "in" ? 1.6 : 1 / 1.6))); if (U().zoom < 1.05) U().zoom = 1; return drawSound(); }
      const h = e.target.closest(".tlh[data-track]");
      if (h) { const t = so().tracks.find((x) => x.id === h.dataset.track); if (!t) return;
        if (e.target.closest("[data-mute]")) { t.mute = !t.mute; return saveSound(true); }
        if (e.target.closest("[data-solo]")) { t.solo = !t.solo; return saveSound(true); }
        if (e.target.closest("[data-tsel]")) { U().track = U().track === t.id && U().sel < 0 ? "" : t.id; U().sel = -1; return drawSound(); }
        return; }
      const lb = e.target.closest("[data-lay]");
      if (lb) { const ts = so().tracks, i = ts.findIndex((x) => x.id === lb.closest("[data-layer]").dataset.layer), t = ts[i], a = lb.dataset.lay; if (!t) return;
        if (a === "mute") t.mute = !t.mute; else if (a === "solo") t.solo = !t.solo; else
        if (a === "up" && i) { ts[i] = ts[i - 1]; ts[i - 1] = t; } else if (a === "down" && i < ts.length - 1) { ts[i] = ts[i + 1]; ts[i + 1] = t; }
        else if (a === "del") { const n = so().clips.filter((c) => c.track === t.id).length; if (!confirm(n ? `Remove the layer “${t.name}” and the ${n} clip${n === 1 ? "" : "s"} on it?` : `Remove the layer “${t.name}”?`)) return;
          so().clips = so().clips.filter((c) => c.track !== t.id); ts.splice(i, 1); if (t.kind === "voice" && t.who) so().gone.push(t.who); U().track = ""; U().sel = -1; }
        return saveSound(true); }
      const b = e.target.closest("[data-snd]"); if (!b) return;
      const i = +b.closest(".clip").dataset.clip, c = so().clips[i], st = shotStarts(); if (!c) return;
      if (hearing) { hearing.pause(); hearing = null; }
      if (b.dataset.snd === "del") { if (confirm(`Remove “${c.name}” from this scene?`)) { so().clips.splice(i, 1); U().sel = -1; saveSound(true); } return; }
      if (b.dataset.snd === "dup") { const d = { ...c, id: "c" + Date.now().toString(36), line: "" }; place(d, Math.min(clipStart(c, st) + clipLen(c), Math.max(0, st.total - 0.1))); so().clips.push(d); U().sel = so().clips.length - 1; return saveSound(true); }
      if (b.dataset.snd === "split") { const at = clipStart(c, st), len = clipLen(c), cut = Clock.time() - at; if (cut < 0.05 || cut > len - 0.05) return alert("Move the playhead to where this clip should be cut (press the shot numbers above the layers, or play and pause), then press Split.");
        const d = { ...c, id: "c" + Date.now().toString(36), from: r2((+c.from || 0) + cut), len: r2(len - cut), fadeIn: 0, line: "" }; place(d, at + cut); c.len = r2(cut); c.fadeOut = 0; so().clips.splice(i + 1, 0, d); return saveSound(true); }
      hearing = new Audio("/" + c.url); hearing.volume = Math.min(1, c.gain == null ? 1 : c.gain); hearing.currentTime = +c.from || 0; hearing.play().catch(() => {});
      const stop = hearing; setTimeout(() => stop.pause(), Math.min(8000, clipLen(c) * 1000));
    });
    el.addEventListener("pointerdown", (e) => {
      const ruler = e.target.closest("[data-ruler]"), bar = e.target.closest(".lclip"), lane = e.target.closest(".ltrack"), pps = U().pps;
      if (ruler || (lane && !bar)) { // press or drag along the shot numbers, or press an empty stretch of a layer: the playhead goes there
        const box = el.querySelector(".tlin"), seek = (m) => Clock.seek((m.clientX - box.getBoundingClientRect().left) / pps); seek(e);
        if (ruler) { ruler.setPointerCapture(e.pointerId); ruler.onpointermove = seek; ruler.onpointerup = ruler.onpointercancel = () => { ruler.onpointermove = null; }; }
        else if (U().sel >= 0 || U().track) { U().sel = -1; U().track = ""; drawSound(); }
        return; }
      if (!bar) return;
      const i = +bar.dataset.clip, c = so().clips[i], st = shotStarts(), x0 = e.clientX, y0 = e.clientY, a0 = clipStart(c, st), len0 = clipLen(c), from0 = +c.from || 0, edge = e.target.classList.contains("hl") ? "l" : e.target.classList.contains("hr") ? "r" : "";
      const cuts = [0, ...S.plan.shots.map((s) => st.m[s.shot_id]), st.total], snap = (x) => { for (const q of cuts) if (Math.abs(q - x) < 7 / pps) return q; return x; };
      bar.setPointerCapture(e.pointerId); let moved = false, abs = a0, over = null; e.preventDefault();
      bar.onpointermove = (m) => { const d = (m.clientX - x0) / pps; if (Math.abs(m.clientX - x0) < 3 && Math.abs(m.clientY - y0) < 8 && !moved) return; moved = true;
        if (edge === "l") { const sh = Math.max(-from0, -a0, Math.min(len0 - 0.1, snap(a0 + d) - a0)); abs = a0 + sh; c.from = r2(from0 + sh); c.len = r2(len0 - sh); bar.style.left = abs * pps + "px"; bar.style.width = Math.max(10, c.len * pps) + "px"; }
        else if (edge === "r") { c.len = r2(Math.max(0.1, Math.min(c.dur ? c.dur - from0 : 3600, snap(a0 + len0 + d) - a0))); bar.style.width = Math.max(10, c.len * pps) + "px"; }
        else { abs = Math.max(0, Math.min(Math.max(0, st.total - 0.1), snap(a0 + d))); bar.style.left = abs * pps + "px";
          const under = document.elementFromPoint(m.clientX, m.clientY), ln = under && under.closest ? under.closest(".ltrack") : null; if (over && over !== ln) over.classList.remove("drop"); over = ln && ln.dataset.lane !== c.track ? ln : null; if (over) over.classList.add("drop"); } };
      bar.onpointerup = bar.onpointercancel = () => { bar.onpointermove = bar.onpointerup = bar.onpointercancel = null;
        if (moved) { if (edge !== "r") place(c, abs); if (over) { c.track = over.dataset.lane; c.kind = (trackOf(c) || {}).kind || c.kind; } }
        U().sel = i; U().track = ""; moved ? saveSound(true) : drawSound(); };
    });
    el.addEventListener("keydown", (e) => { const bar = e.target.closest && e.target.closest(".lclip"); if (!bar) return; const c = so().clips[+bar.dataset.clip], st = shotStarts(); // arrow keys nudge a clip, Enter picks it
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); U().sel = +bar.dataset.clip; U().track = ""; return drawSound(); }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault(); place(c, Math.max(0, clipStart(c, st) + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1))); U().sel = +bar.dataset.clip; saveSound(true);
      const again = el.querySelector(`.lclip[data-clip="${U().sel}"]`); if (again) again.focus(); });
  }

  function newId(base) { const ids = new Set(S.plan.shots.map((s) => s.shot_id)); const root = String(base).replace(/[a-z]+$/, ""); for (const c of "bcdefghijklmnopqrstuvwxyz") if (!ids.has(root + c)) return root + c; return root + "-" + Date.now() % 1000; }
  function addShot(i) {
    const prev = S.plan.shots[i] || {}, s = { shot_id: newId(prev.shot_id || "S" + String(S.plan.shots.length + 1).padStart(3, "0")), source_ids: (prev.source_ids || []).slice(0, 1),
      scene_type: "insert", camera: { framing: "", move: "still", move_reason: "" }, action: "", expressions: {}, lines: [], duration: 1.5, movement: {}, book_verb: "",
      interpretation: ["VISUAL_INTERPRETATION: shot added by hand"], still: "" };
    S.plan.shots.splice(i + 1, 0, s); S.open.add(s.shot_id); if (docked()) S.sel = s.shot_id; changed(true);
  }
  function redrawShot(i) {
    const old = $(`#shots .shot[data-i="${i}"]`); if (!old) return;
    const t = document.createElement("div"); t.innerHTML = shotCard(S.plan.shots[i], i, shotProblems()[S.plan.shots[i].shot_id], docked() ? false : null); old.replaceWith(t.firstElementChild);
    if (docked() && S.plan.shots[i].shot_id === S.sel) drawDock();
  }
  /** After any edit: check again, save soon. redraw = true rebuilds the shot list; "soft" rebuilds only the edited card's numbers on blur. */
  // what "Write down what is said" (hear.js) needs from this screen: the open scene, a shot's lines, and a way to put heard words into one line
  window.IbashoHear = { scene: () => (S ? S.id : ""), busy: () => !S || busy(),
    lines: (shot) => { const sh = S && S.plan.shots.find((x) => x.shot_id === shot); return sh ? (S.plan.dialogue || []).filter((d) => (sh.lines || []).includes(d.line_id) && d.kind !== "title").map((d) => ({ id: d.line_id, speaker: d.speaker || "", text: d.text || "" })) : []; },
    put: (lineId, text) => { const d = S && (S.plan.dialogue || []).find((x) => x.line_id === lineId); if (!d || busy()) return false; d.text = String(text || "").replace(/\s+/g, " ").trim().slice(0, 600); changed(true); return true; } };
  function changed(redraw) {
    S.check = P.check(S.plan); drawSummary();
    drawSound(); drawAllLabel(); // clips follow their shots when lengths or order change
    if (redraw === true) { const y = scrollY, dk = docked(), by = shotProblems();
      if (dk && !S.plan.shots.some((x) => x.shot_id === S.sel)) S.sel = S.plan.shots[0] ? S.plan.shots[0].shot_id : "";
      $("#shots").innerHTML = S.plan.shots.map((s, i) => shotCard(s, i, by[s.shot_id], dk ? false : null)).join(""); scrollTo(0, y); drawDock(); }
    if (docked()) Player.sync();
    clearTimeout(S.saveT); S.saveT = setTimeout(save, 700);
  }
  async function save() {
    const id = S.id;
    try { const r = await send("/api/anime/plan?id=" + encodeURIComponent(id), "PUT", S.plan);
      // a still or clip landed after this screen loaded the plan: the server kept it; take it here too
      const got = r && r.media ? Object.keys(r.media) : []; if (!got.length || !S || S.id !== id) return;
      for (const sid of got) { const s = S.plan.shots.find((x) => x.shot_id === sid); if (!s) continue; for (const [k, v] of Object.entries(r.media[sid])) { if (v === null) delete s[k]; else s[k] = v; } }
      changed(true); }
    catch (e) { alert("Not saved: " + e.message); }
  }

  // Blocking pass + versions
  $("#noteCancel").onclick = () => $("#noteDlg").close();
  const NOTES = {
    blocking: { title: "Blocking pass", path: "block", text: "The Blocking agent turns the panels into anime shots: it adds the movement the manga skipped, cameras with reasons, timing, and the scene cards. About 10 to 20 minutes. Your current plan is kept as a version.", hint: "For example: slower opening; keep Kai mostly still; more hands and props" },
    previs: { title: "Grey 3D animatic", path: "previs", text: "The Previs agent builds the place at real size, puts a mannequin for each character where the plan says, walks them through their moves, and sets up every shot's camera. Then this computer films it. About 10 to 20 minutes, then about 4 minutes of rendering. Free: no paid model.", hint: "For example: the door is behind Kai; the booth is small, about 3 by 4 metres" },
  };
  let noteKind = "blocking";
  function askNote(kind) {
    noteKind = kind; const n = NOTES[kind];
    $("#noteTitle").textContent = n.title; $("#noteInfo").textContent = n.text; $("#noteText").placeholder = n.hint;
    $("#noteText").value = (kind === "blocking" ? S.scene.blocking_note : S.scene.previs_note) || ""; $("#noteDlg").showModal();
  }
  $("#noteGo").onclick = async () => {
    $("#noteDlg").close(); clearTimeout(S.saveT); await save();
    try { await send(`/api/anime/${NOTES[noteKind].path}?id=` + encodeURIComponent(S.id), "POST", { note: $("#noteText").value }); } catch (e) { alert(e.message); }
    scene(S.id);
  };

  // the grey 3D animatic (StageFlow previs)
  function previsCard() {
    const v = S.previs || {}, r = running(), dis = r ? "disabled" : "";
    if (!v.score) return `<div class="card problems"><b>Grey 3D animatic</b>
      <div class="small">Stage the scene in 3D before any art or video: the place at real size, a mannequin for each character walking their moves, and every shot's camera and lens. Free (Codex + this computer).</div>
      ${S.check.errors.length ? `<div class="small" style="color:var(--amber);margin-top:4px">Best after the plan check passes.</div>` : ""}
      <div class="tools" style="margin-top:8px"><button class="btn" id="previsGo" ${dis}>Make the grey 3D animatic</button></div></div>`;
    const pov = v.pov, top = v.top;
    return `<div class="card problems"><b>Grey 3D animatic</b>
      ${pov && !pov.fresh ? `<div class="small" style="color:var(--amber)">Shot lengths or shots changed since this was rendered.</div>` : ""}
      ${v.scoreBroken ? `<div class="small" style="color:var(--red)">The 3D staging file cannot be read. Run the previs pass again.</div>` : ""}
      <div class="tools" style="margin-top:8px">
        ${pov ? `<button class="btn primary" id="previsPlay">▶︎ Play grey 3D</button>` : ""}
        ${!pov || !pov.fresh ? `<button class="btn" id="previsRender" ${dis}>${pov ? "Render again (about 4 min, no AI)" : "Render it (about 4 min)"}</button>` : ""}
        <button class="btn" id="previsTop" ${top && top.fresh ? "" : dis}>${top && top.fresh ? "View from above" : "Render the view from above"}</button>
        <button class="btn" id="previsGo" ${dis}>Previs pass again</button></div></div>`;
  }
  function wirePrevis() {
    const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = fn; };
    on("#previsGo", () => askNote("previs"));
    on("#previsPlay", () => Player.open(S.plan, 0, { video: S.previs.pov.url, videoNote: S.previs.pov.fresh ? "" : "out of date", mode: "video" }));
    const renderIt = async (view) => { try { await send(`/api/anime/render?view=${view}&id=` + encodeURIComponent(S.id), "POST"); } catch (e) { alert(e.message); } scene(S.id); };
    on("#previsRender", () => renderIt("pov"));
    on("#previsTop", () => { const top = S.previs.top; if (top && top.fresh) { $("#topVid").src = top.url; $("#topDlg").showModal(); } else renderIt("top"); });
  }
  $("#topClose").onclick = () => { $("#topVid").pause(); $("#topDlg").close(); };
  async function versions() {
    const names = await api("/api/anime/history?id=" + encodeURIComponent(S.id));
    $("#verList").innerHTML = names.length ? names.map((n) => { const m = n.match(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)/); const why = n.replace(/^.*?Z-/, "").replace(/\.json$/, "").replace(/-/g, " ");
      return `<div class="card row"><div class="grow"><div class="title">${m ? `${m[1]} ${m[2]}:${m[3]} UTC` : esc(n)}</div><div class="small muted">${esc(why)}</div></div><button class="btn sm" data-n="${esc(n)}" ${busy() ? "disabled" : ""}>Put back</button></div>`; }).join("")
      : `<div class="empty small">No earlier versions yet. One is kept every time the Blocking pass runs or an old version is put back.</div>`;
    $("#verList").onclick = async (e) => { const b = e.target.closest("[data-n]"); if (!b) return; if (!confirm("Put this version back? The current plan is kept as a version too.")) return;
      try { await send("/api/anime/history?id=" + encodeURIComponent(S.id), "POST", { name: b.dataset.n }); $("#verDlg").close(); scene(S.id); } catch (er) { alert(er.message); } };
    $("#verDlg").showModal();
  }
  $("#verClose").onclick = () => $("#verDlg").close();

  // ---------- the animatic: stills (pictures with slow camera moves) or the grey 3D previs video ----------
  const Player = (() => {
    const el = $("#player"), stage = $("#stage"), bar = $("#bar"), fill = $("#fill");
    let plan, starts = [], total = 0, t = 0, playing = false, last = 0, cur = -1, labels = true, raf = 0, held = 0;
    let videoUrl = null, videoNote = "", mode = "stills", vid = null, ov = null;
    const soundTick = () => Mix.tick(t, playing); // each clip plays over its own stretch of the scene, in step with the picture
    function motion(s) { // the camera move as a slow push, pull or pan over the still
      const m = (s.camera && s.camera.motion) || {}, txt = String((s.camera && s.camera.move) || "").toLowerCase(), a = +m.amount || 0.1;
      const kind = m.kind || (/push|dolly in|zoom in|crane down|punch/.test(txt) ? "push" : /pull|zoom out|dolly out|crane up/.test(txt) ? "pull" : /pan|track|truck|arc|orbit/.test(txt) ? "pan" : /tilt/.test(txt) ? "tilt" : "still");
      const dir = m.dir || (/left/.test(txt) ? "left" : /right/.test(txt) ? "right" : /up/.test(txt) ? "up" : /down/.test(txt) ? "down" : kind === "pull" ? "out" : "in");
      return { kind, dir, a };
    }
    function transform(s, k) {
      const { kind, dir, a } = motion(s);
      if (kind === "push") return `scale(${1.04 + a * k})`;
      if (kind === "pull") return `scale(${1.04 + a * (1 - k)})`;
      const sg = dir === "left" || dir === "up" ? 1 : -1, d = (k - 0.5) * a * 100 * sg;
      if (kind === "pan") return `scale(${1.08 + a / 2}) translateX(${d}%)`;
      if (kind === "tilt") return `scale(${1.08 + a / 2}) translateY(${d}%)`;
      return "scale(1.04)";
    }
    function build(i) {
      const s = plan.shots[i], cam = s.camera || {};
      const who = (Array.isArray(s.blocking) ? s.blocking : []).filter((w) => w && Array.isArray(w.at));
      const pic = mode === "video" ? "" : s.clip ? `<video class="clipv" muted playsinline preload="auto" src="${esc(img(s.clip))}" poster="${esc(img(s.clip_poster || ""))}"></video>` : s.still ? `<div class="pic" style="background-image:url('${esc(img(s.still))}');${focusStyle(s)}"></div>`
        : `<div class="grey"><div><b>${esc(cam.framing || "Shot " + s.shot_id)}</b>${esc(s.action || "")}</div></div><div class="floor"></div>${who.map((w) => `<span class="dot" style="left:${8 + w.at[0] * 84}%;top:${72 + w.at[1] * 22}%">${esc(w.name)}</span>`).join("")}`;
      const p = i > 0 && s.tin === "cross" && mode !== "video" ? plan.shots[i - 1] : null; // the shot before, on top, melting away
      const xp = p ? (p.clip ? `<video class="clipv xprev" muted playsinline preload="auto" src="${esc(img(p.clip))}"></video>` : p.still ? `<div class="pic xprev" style="background-image:url('${esc(img(p.still))}');${focusStyle(p)};transform:${transform(p, 1)}"></div>` : `<div class="xprev" style="position:absolute;inset:0;background:${p.title || p.title_sub ? (p.title_bg === "white" ? "#f4f1ea" : "#000") : "#30333a"}"></div>`) : "";
      const card = mode !== "video" && (s.title || s.title_sub), bare = card && !s.clip && !s.still;
      ov.innerHTML = (bare ? `<div class="cardbg" style="background:${s.title_bg === "white" ? "#f4f1ea" : "#000"}"></div>` : pic) + xp + (mode !== "video" && (s.tin === "black" || s.tin === "white" || s.tout) ? `<div class="xcol"></div>` : "") + (card ? `<div class="ttl ${s.title_pos === "low" ? "low" : ""} ${bare && s.title_bg === "white" ? "dark" : ""}"><b>${esc(s.title || "")}</b><span>${esc(s.title_sub || "")}</span></div>` : "") + `<div class="label" ${labels ? "" : "hidden"}>${esc(s.shot_id)} · ${esc(s.scene_type || "")} · ${fmt(+s.duration || 0)}${cam.move && !/^(still|locked)$/i.test(cam.move) ? " · " + esc(cam.move) : ""}${mode === "video" && videoNote ? " · " + esc(videoNote) : ""}</div><div class="sub"></div>`;
    }
    function subtitle(s, k) { // the shot's lines share its time by word count
      const ls = (s.lines || []).map((id) => lineOf(id)).filter(Boolean); if (!ls.length) return "";
      const w = ls.map((l) => Math.max(1, String(l.text).split(/\s+/).length)), sum = w.reduce((a, b) => a + b, 0);
      let acc = 0, pick = ls[ls.length - 1]; for (let j = 0; j < ls.length; j++) { acc += w[j] / sum; if (k <= acc) { pick = ls[j]; break; } }
      return `<span class="${pick.mouth === "off" ? "off" : ""}">${pick.speaker ? `<span class="spk">${esc(pick.speaker)}:</span> ` : ""}${esc(pick.text)}</span>`;
    }
    function frame(now) {
      if (mode === "video") { t = Math.min(total, vid.currentTime || 0); playing = !vid.paused && !vid.ended; }
      else if (playing) { // the scene's clock. While a shot's video plays, the video IS the clock; while it is still loading, the clock waits
        // (up to 2 s a shot). Before 19 Nov 2026 the clock ran on alone and the video was sought back every time it fell 0.3 s behind
        // while it loaded, so it never got going: the choppy clip.
        const s0 = plan.shots[cur], cv0 = s0 && s0.clip ? ov.querySelector("video.clipv:not(.xprev)") : null, sp0 = s0 && +s0.clip_speed > 0 ? +s0.clip_speed : 1, into0 = s0 ? t - starts[cur] : 0;
        const tv = cv0 ? starts[cur] + (cv0.currentTime - (+s0.clip_from || 0)) / sp0 : 0, inClip = cv0 && into0 < (+s0.duration || 0) && (+s0.clip_from || 0) + into0 * sp0 < (cv0.duration || 1e9) - 0.05;
        if (inClip && !cv0.paused && cv0.readyState >= 3 && !cv0.seeking && Math.abs(tv - t) < 1) t = Math.max(t, tv);
        else if (inClip && (cv0.readyState < 3 || cv0.seeking || cv0.paused) && (held += now - last) < 2000) { /* the video is loading: hold */ }
        else t += (now - last) / 1000;
        if (t >= total) { t = total; playing = false; } }
      $("#pPlay").textContent = playing ? "Pause" : t >= total - 0.05 ? "Play again" : "Play";
      last = now;
      let i = starts.findIndex((st, j) => t < st + (+plan.shots[j].duration || 0)); if (i < 0) i = plan.shots.length - 1;
      if (i !== cur) { cur = i; held = 0; build(i); }
      const s = plan.shots[i], k = Math.min(1, Math.max(0, (t - starts[i]) / Math.max(0.01, +s.duration || 0)));
      const pic = ov.querySelector(".pic"); if (pic) pic.style.transform = transform(s, k);
      const into = t - starts[i], left = (+s.duration || 0) - into, fl = (v) => Math.max(0.1, Math.min(+v > 0 ? +v : 0.5, 3, Math.max(0.1, (+s.duration || 0) * 0.9)));
      const xc = ov.querySelector(".xcol"); if (xc) { const a = s.tin === "black" || s.tin === "white" ? Math.max(0, 1 - into / fl(s.tin_dur)) : 0, b = s.tout ? Math.max(0, 1 - left / fl(s.tout_dur)) : 0; xc.style.background = b > a ? s.tout : s.tin === "white" ? "white" : "black"; xc.style.opacity = Math.max(a, b); }
      const xp = ov.querySelector(".xprev"); if (xp) { const o = Math.max(0, 1 - into / fl(s.tin_dur)); xp.style.opacity = o; xp.style.visibility = o > 0 ? "" : "hidden";
        if (xp.tagName === "VIDEO" && xp.readyState >= 1 && !xp.dataset.set) { const p = plan.shots[i - 1]; xp.dataset.set = 1; xp.currentTime = Math.max(0, Math.min((+p.clip_from || 0) + (+p.duration || 0) * (+p.clip_speed > 0 ? +p.clip_speed : 1), (xp.duration || 1e9) - 0.05)); } }
      const tt = ov.querySelector(".ttl"); if (tt) { const f = Math.min(0.4, (+s.duration || 0) * 0.25); tt.style.opacity = f > 0 ? Math.max(0, Math.min(1, into / f, left / f)) : 1; }
      const cv = ov.querySelector("video.clipv:not(.xprev)"); if (cv) { const sp = +s.clip_speed > 0 ? +s.clip_speed : 1, want = (+s.clip_from || 0) + (t - starts[i]) * sp; if (cv.playbackRate !== sp) cv.playbackRate = sp; // the shot's video keeps to the scene's clock (its sound is played by the sound layers)
        if (cv.readyState >= 1 && !cv.seeking && Math.abs(cv.currentTime - want) > (playing ? 0.5 : 0.04)) cv.currentTime = Math.min(want, Math.max(0, (cv.duration || want) - 0.04)); // a jump (a scrub, a new shot), not a small lag
        if (playing && cv.paused && !cv.starting && want < (cv.duration || 1e9) - 0.05) { cv.starting = true; cv.play().catch(() => {}).finally(() => { cv.starting = false; }); } else if (!playing && !cv.paused) cv.pause(); }
      const sub = ov.querySelector(".sub"), html = subtitle(s, k); if (sub && sub.innerHTML !== html) sub.innerHTML = html;
      soundTick();
      fill.style.width = (t / total) * 100 + "%";
      $("#pTime").textContent = `${s.shot_id} · ${t.toFixed(1)} / ${total.toFixed(1)} s`;
      raf = requestAnimationFrame(frame);
    }
    function seekTo(x) { t = Math.max(0, Math.min(total - 0.001, x)); if (mode === "video") vid.currentTime = t; }
    function setMode(m) {
      mode = m === "video" && videoUrl ? "video" : "stills"; cur = -1;
      vid.hidden = mode !== "video";
      if (mode === "video") { if (vid.getAttribute("src") !== videoUrl) vid.src = videoUrl; vid.currentTime = t; if (playing) vid.play().catch(() => {}); }
      else vid.pause();
      $("#pMode").hidden = !videoUrl; $("#pMode").textContent = mode === "video" ? "Show stills" : "Show grey 3D";
    }
    /** opts: { video: url of the grey previs, videoNote: shown in the label (e.g. out of date) } */
    function open(p, from, opts) {
      plan = p; starts = []; total = 0; for (const s of plan.shots) { starts.push(total); total += +s.duration || 0; }
      if (!total) return;
      opts = opts || {}; videoUrl = opts.video || null; videoNote = opts.videoNote || "";
      stage.innerHTML = `<video class="vid" playsinline muted preload="auto" hidden></video><div class="ov"></div>`;
      vid = stage.querySelector("video"); ov = stage.querySelector(".ov");
      bar.querySelectorAll(".tick").forEach((x) => x.remove());
      starts.slice(1).forEach((st) => { const d = document.createElement("i"); d.className = "tick"; d.style.left = (st / total) * 100 + "%"; bar.appendChild(d); });
      for (const s of plan.shots) if (s.still) { const im = new Image(); im.src = img(s.still); } // load the pictures before they are needed
      Mix.build(); if (!opts.paused) Mix.wake();
      t = starts[from] || 0; playing = !opts.paused;
      setMode(opts.mode || (videoUrl ? "video" : "stills")); seekTo(t); if (opts.paused && vid) vid.pause();
      el.hidden = false; if (!isDocked()) document.body.style.overflow = "hidden"; last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    }
    const isDocked = () => el.classList.contains("docked");
    /** Wide windows: the player sits in the middle column instead of covering the screen. */
    function dock(slot) { if (!slot) return; slot.appendChild(el); el.classList.add("docked"); }
    function park() { if (!el.classList.contains("docked") && el.parentNode === document.body) return; close(); el.classList.remove("docked"); document.body.appendChild(el); }
    function sync() { // lengths or order changed while the player is on screen: keep its clock on the same shot
      if (el.hidden || !plan || !isDocked()) return; const id = plan.shots[cur] && plan.shots[cur].shot_id, was = playing;
      plan = S.plan; starts = []; total = 0; for (const x of plan.shots) { starts.push(total); total += +x.duration || 0; } if (!total) return;
      bar.querySelectorAll(".tick").forEach((x) => x.remove()); starts.slice(1).forEach((st) => { const d = document.createElement("i"); d.className = "tick"; d.style.left = (st / total) * 100 + "%"; bar.appendChild(d); });
      const i = Math.max(0, plan.shots.findIndex((x) => x.shot_id === id)); if (!was) t = starts[i] || 0; t = Math.min(t, total - 0.001); cur = -1;
    }
    function close() { playing = false; Mix.stop(); if (vid) vid.pause(); cancelAnimationFrame(raf); el.hidden = true; document.body.style.overflow = ""; }
    $("#pClose").onclick = close;
    $("#pPlay").onclick = () => {
      Mix.wake(); if (t >= total - 0.05) seekTo(0);
      if (mode === "video") { vid.paused || vid.ended ? vid.play().catch(() => {}) : vid.pause(); }
      else { playing = !playing; last = performance.now(); }
    };
    $("#pMode").onclick = () => setMode(mode === "video" ? "stills" : "video");
    $("#pPrev").onclick = () => { const i = Math.max(0, cur - (t - starts[cur] < 0.4 ? 1 : 0)); seekTo(starts[i]); };
    $("#pNext").onclick = () => { if (cur < plan.shots.length - 1) seekTo(starts[cur + 1]); };
    $("#pLabels").onclick = () => { labels = !labels; $("#pLabels").textContent = labels ? "Labels on" : "Labels off"; cur = -1; };
    const scrub = (e) => { const r = bar.getBoundingClientRect(); seekTo(((e.clientX - r.left) / r.width) * total); };
    bar.addEventListener("pointerdown", (e) => { bar.setPointerCapture(e.pointerId); scrub(e); bar.onpointermove = scrub; });
    bar.addEventListener("pointerup", () => { bar.onpointermove = null; });
    addEventListener("keydown", (e) => { if (el.hidden) return; if (isDocked() && (e.key === "Escape" || /INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target && e.target.tagName) || "") || document.querySelector("dialog[open]"))) return; if (e.key === "Escape") close(); if (e.key === " ") { e.preventDefault(); $("#pPlay").click(); } if (e.key === "ArrowRight") $("#pNext").click(); if (e.key === "ArrowLeft") $("#pPrev").click(); });
    return { open, dock, park, sync, time: () => t, seek: (x) => { if (plan && total) seekTo(x); }, playing: () => playing, toggle: () => $("#pPlay").click(), active: () => !el.hidden && !!plan && total > 0 };
  })();

  route();
})();
