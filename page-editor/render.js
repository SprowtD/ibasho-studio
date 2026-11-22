/* Page lettering renderer: one page spec -> SVG markup.
 * The browser drawing IS the export, so editor preview and PNG always match.
 * Units: the page is 1000 x 1500 "u" (1u = 1/1000 of page width), same as the old Python letterer.
 * Positions in the spec (at, tail, panels, protect) are fractions of the page, 0-1, from the top left.
 */
(function (g) {
  "use strict";
  const W = 1000, H = 1500, STROKE = 2.6, N = 2.5;

  const FONTS = {
    playpen:   { label: "Playpen Sans", family: "'Playpen Sans', 'Comic Sans MS', cursive", w: 500, b: 800 },
    bangers:   { label: "Bangers",      family: "Bangers, Impact, sans-serif",            w: 400, b: 400 },
    vollkorn:  { label: "Vollkorn",     family: "Vollkorn, Georgia, serif",               w: 500, b: 700 },
    patrick:   { label: "Patrick Hand", family: "'Patrick Hand', 'Comic Sans MS', cursive", w: 400, b: 400 },
    comicneue: { label: "Comic Neue",   family: "'Comic Neue', 'Comic Sans MS', cursive", w: 700, b: 700 },
    kalam:     { label: "Kalam",        family: "Kalam, 'Comic Sans MS', cursive",        w: 700, b: 700 },
    // Japanese lettering (all OFL): an anti-que style for talk, heavy gothic for shouts and sounds, gothic for captions, round for asides
    zenantique: { label: "Zen Antique Soft (日本語)", family: "'Zen Antique Soft', 'Hiragino Mincho ProN', 'Yu Mincho', serif", w: 400, b: 400, ja: true },
    delagothic: { label: "Dela Gothic One (日本語)",  family: "'Dela Gothic One', 'Hiragino Sans', sans-serif",               w: 400, b: 400, ja: true },
    zenkaku:    { label: "Zen Kaku Gothic (日本語)",  family: "'Zen Kaku Gothic New', 'Hiragino Sans', sans-serif",           w: 700, b: 700, ja: true },
    zenmaru:    { label: "Zen Maru Gothic (日本語)",  family: "'Zen Maru Gothic', 'Hiragino Maru Gothic ProN', sans-serif",   w: 700, b: 700, ja: true },
  };
  // the Japanese font each kind uses when its words are Japanese and its own font has no Japanese letters
  const JA_FONT = { speech: "zenantique", whisper: "zenantique", thought: "zenantique", crowd: "zenantique", title: "zenantique",
    shout: "delagothic", sfx: "delagothic", caption: "zenkaku", phone: "zenkaku", ambient: "zenmaru" };
  // Japanese words are set in columns, top to bottom, the columns running right to left (縦書き); phone screens and sounds stay across
  const VERTICAL_KINDS = new Set(["speech", "shout", "whisper", "thought", "caption", "ambient", "crowd"]);
  const JA = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff01-\uff60\u3000-\u303f]/;
  const isJapanese = (text) => JA.test(String(text || ""));
  const FULL = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u2026\u2025\u2014\u2015]/; // takes a full square
  // 禁則: never at the head of a line or column / never at its end
  const NO_HEAD = new Set([..."、。，．・：；？！ー～…‥」』）］｝〉》】〕’”ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々ゝゞヽヾ!?)]}.,:;"]);
  const NO_TAIL = new Set([..."「『（［｛〈《【〔‘“([{"]);
  /** Japanese words cut into the smallest pieces a line may break between: a letter with the marks that may not start a line,
   *  and an opening bracket glued to what follows. A space (the writer's hint for a good break) is kept as a mark on the piece after it. */
  function jaUnits(text) {
    const out = []; let bold = false, gap = false;
    for (const part of String(text || "").split(/(\*\*)/)) {
      if (part === "**") { bold = !bold; continue; }
      for (const ch of part) {
        if (/\s/.test(ch)) { gap = out.length > 0; continue; }
        const last = out[out.length - 1];
        if (last && !gap && (NO_HEAD.has(ch) || NO_TAIL.has(last.w[last.w.length - 1]))) { last.w += ch; continue; }
        out.push({ w: ch, b: bold, gap }); gap = false;
      }
    }
    return out;
  }
  /** Lines (or columns) of Japanese pieces no longer than max: break at the writer's last space when that keeps the line at least a third full, else at a letter. */
  function jaBreak(units, len, max) {
    const lines = []; let cur = [], used = 0;
    units.forEach((u, i) => {
      if (cur.length && used + len[i] > max) {
        if (u.gap) { lines.push(cur); cur = []; used = 0; cur.push(i); used += len[i]; return; } // the new phrase simply starts the next line
        let cut = -1;
        for (let k = cur.length - 1; k > 0; k--) if (units[cur[k]].gap) { cut = k; break; }
        const head = cut > 0 ? cur.slice(0, cut) : cur, headLen = head.reduce((a, j) => a + len[j], 0);
        if (cut > 0 && headLen >= max * 0.3) { lines.push(head); cur = cur.slice(cut); used = cur.reduce((a, j) => a + len[j], 0); }
        else { lines.push(cur); cur = []; used = 0; }
      }
      cur.push(i); used += len[i];
    });
    return cur.length ? lines.concat([cur]) : lines;
  }
  /** Breaks that fall inside a writer's phrase (not at a space): fewer is better. */
  const midBreaks = (units, lines) => lines.slice(1).filter((ln) => ln.length && !units[ln[0]].gap).length;
  /** The narrowest measure that keeps the same number of lines and no more breaks inside phrases: even lines, whole phrases. */
  function jaBalance(units, len, max) {
    const first = jaBreak(units, len, max), n = first.length, mids = midBreaks(units, first);
    let lo = 0, hi = max;
    for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2, t = jaBreak(units, len, mid); if (t.length === n && midBreaks(units, t) <= mids) hi = mid; else lo = mid; }
    return jaBreak(units, len, hi);
  }

  // The 10 balloon types (SFX is drawn in the art, so it is not typeset here).
  const KINDS = {
    speech:  { label: "Speech",  hint: "Normal talking",              font: "playpen",   size: 30, floor: 28, lh: 1.2,  px: 20, py: 15, width: 0.27, shape: "oval" },
    shout:   { label: "Shout",   hint: "Loud: spiky burst",           font: "bangers",   size: 50, floor: 36, lh: 1.08, px: 22, py: 16, width: 0.34, shape: "burst", upper: true },
    whisper: { label: "Whisper", hint: "Quiet: small, dashed",        font: "playpen",   size: 25, floor: 22, lh: 1.2,  px: 16, py: 12, width: 0.2,  shape: "dashed" },
    thought: { label: "Thought", hint: "Cloud with bubble trail",     font: "playpen",   size: 30, floor: 28, lh: 1.2,  px: 24, py: 18, width: 0.27, shape: "cloud" },
    caption: { label: "Caption", hint: "Narration, time jumps",       font: "vollkorn",  size: 29, floor: 26, lh: 1.18, px: 15, py: 11, width: 0.4,  shape: "box" },
    ambient: { label: "Ambient", hint: "No balloon: breaths, glances, silence", font: "patrick", size: 30, floor: 22, lh: 1.1, px: 0, py: 0, width: 0.3, shape: "none", rotate: -6 },
    crowd:   { label: "Crowd",   hint: "Background voices, small",    font: "playpen",   size: 22, floor: 20, lh: 1.18, px: 14, py: 10, width: 0.18, shape: "thin" },
    phone:   { label: "Phone",   hint: "Screen or message text",      font: "comicneue", size: 26, floor: 22, lh: 1.2,  px: 18, py: 14, width: 0.3,  shape: "phone" },
    sfx:     { label: "Sound effect", hint: "Huge letters across the picture, no balloon", font: "bangers", size: 120, floor: 40, lh: 0.95, px: 0, py: 0, width: 0.7, shape: "none", upper: true, rotate: -8, sfx: true },
    title:   { label: "Title",   hint: "Chapter title, no balloon",   font: "vollkorn",  size: 44, floor: 30, lh: 1.1,  px: 0,  py: 0,  width: 0.8,  shape: "none", allBold: true },
  };
  const TAIL_KINDS = new Set(["speech", "shout", "whisper", "crowd", "phone", "thought"]);
  const LIMITS = { wordsBalloon: 24, lines: 7, wordsPage: 70, tail: 240 };
  const MARGIN = 40, GUTTER = 14, BORDER = 3;
  const PANEL_TYPES = { framed: "Framed", borderless: "No border", bleed: "Bleed to edge" };

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const plain = (t) => String(t || "").replace(/\*\*/g, "");
  const r1 = (v) => Math.round(v * 10) / 10;

  function tokens(text, upper) {
    const out = []; let bold = false;
    for (const part of String(text || "").split(/(\*\*)/)) {
      if (part === "**") { bold = !bold; continue; }
      for (const w of part.split(/\s+/).filter(Boolean)) out.push({ w: upper ? w.toUpperCase() : w, b: bold });
    }
    return out;
  }

  function styleFor(item, spec) {
    const kind = KINDS[item.kind] ? item.kind : "speech";
    const st = Object.assign({}, KINDS[kind], (spec.styles || {})[kind] || {});
    const voice = (spec.voices || {})[item.speaker] || {};
    let fontKey = FONTS[item.font] ? item.font : FONTS[voice.font] ? voice.font : st.font;
    if (isJapanese(item.text) && !FONTS[fontKey].ja) fontKey = JA_FONT[kind] || "zenantique";
    const mult = item.size != null ? item.size : voice.size != null ? voice.size : 1;
    return { kind, st, fontKey, mult, voice };
  }

  /** Is this item set in Japanese columns? item.dir "v" or "h" decides; else Japanese words in a kind that may stand up. */
  function isVertical(item, kind) {
    if (item.dir === "h") return false;
    if (item.dir === "v") return true;
    return VERTICAL_KINDS.has(kind) && isJapanese(item.text);
  }

  /** measureText(cssFont, string) -> width in u. */
  function measure(item, spec, measureText) {
    const { kind, st, fontKey, mult } = styleFor(item, spec);
    const f = FONTS[fontKey];
    const size = st.size * mult;
    const fontCss = (bold) => `${bold || st.allBold ? f.b : f.w} ${size}px ${f.family}`;
    if (isVertical(item, kind)) return measureColumns(item, kind, st, fontKey, f, size, fontCss, measureText);
    if (isJapanese(item.text)) return measureJaRows(item, kind, st, fontKey, f, size, fontCss, measureText);
    const toks = tokens(item.text, st.upper);
    const space = measureText(fontCss(false), " ");
    const wordW = toks.map((t) => measureText(fontCss(t.b), t.w));
    const lineW = (line) => line.reduce((a, i) => a + wordW[i], 0) + space * Math.max(0, line.length - 1);
    const greedy = (width) => {
      const lines = []; let cur = [];
      toks.forEach((_, i) => {
        if (cur.length && lineW(cur.concat(i)) > width) { lines.push(cur); cur = [i]; } else cur = cur.concat(i);
      });
      return cur.length ? lines.concat([cur]) : lines;
    };
    const maxW = (item.width != null ? item.width : st.width) * W;
    let lines = greedy(maxW);
    let lo = 0, hi = maxW; // same line count at the narrowest width, so balloons keep an even shape
    for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (greedy(mid).length === lines.length) hi = mid; else lo = mid; }
    lines = greedy(hi);
    if (!lines.length) lines = [[]];
    const widths = lines.map(lineW);
    const lh = size * st.lh, tw = Math.max(1, ...widths), th = lh * lines.length;
    let rx, ry;
    if (st.shape === "box" || st.shape === "phone") { rx = tw / 2 + st.px; ry = th / 2 + st.py; }
    else if (st.shape === "none") { rx = tw / 2 + 4; ry = th / 2 + 4; }
    else {
      const a = tw / 2 + st.px, b = th / 2 + st.py;
      let s = 1;
      widths.forEach((w, i) => [i, i + 1].forEach((j) => {
        s = Math.max(s, Math.pow(Math.pow(w / 2 / a, N) + Math.pow(Math.abs(-th / 2 + j * lh) / b, N), 1 / N));
      }));
      rx = a * s; ry = b * s;
    }
    return {
      item, kind, st, fontKey, f, size, fontCss, toks, lines, widths, lh, tw, th, rx, ry,
      cx: (item.at ? item.at[0] : 0.5) * W, cy: (item.at ? item.at[1] : 0.5) * H,
      hasTail: !!item.tail && TAIL_KINDS.has(kind),
      rotate: st.shape === "none" ? (item.rotate != null ? item.rotate : st.rotate || 0) : 0,
    };
  }

  function outer(L) {
    const k = { burst: 1.2, cloud: 1.08 }[L.st.shape] || 1;
    return [L.rx * k, L.ry * k];
  }

  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function bodyPoints(L) {
    const { cx, cy, rx, ry } = L, shape = L.st.shape;
    const sup = (t, kx = 1, ky = 1) => {
      const c = Math.cos(t), s = Math.sin(t);
      return [cx + kx * rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / N), cy + ky * ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / N)];
    };
    if (shape === "burst") {
      const rnd = seeded(plain(L.item.text));
      const spikes = Math.max(12, Math.round((rx + ry) / 32)), pts = [];
      for (let i = 0; i < spikes * 2; i++) {
        const t = 2 * Math.PI * (i + (rnd() * 0.44 - 0.22)) / (spikes * 2);
        const k = i % 2 === 0 ? 1.12 + rnd() * 0.12 : 1.0;
        pts.push(sup(t, k, k));
      }
      return pts;
    }
    if (shape === "cloud") {
      const bumps = Math.max(10, Math.round((rx + ry) / 24)), pts = [];
      for (let i = 0; i < 240; i++) {
        const k = 1 + 0.06 * Math.abs(Math.sin(Math.PI * bumps * i / 240));
        pts.push(sup(2 * Math.PI * i / 240, k, k));
      }
      return pts;
    }
    const pts = [];
    for (let i = 0; i < 180; i++) pts.push(sup(2 * Math.PI * i / 180));
    return pts;
  }

  function edgeDist(L, ux, uy) {
    return 1 / Math.pow(Math.pow(Math.abs(ux) / L.rx, N) + Math.pow(Math.abs(uy) / L.ry, N), 1 / N);
  }

  function tailPoints(L) {
    const tx = L.item.tail[0] * W, ty = L.item.tail[1] * H, { cx, cy, rx, ry } = L;
    const dist = Math.hypot(tx - cx, ty - cy) || 1, ux = (tx - cx) / dist, uy = (ty - cy) / dist;
    const edge = edgeDist(L, ux, uy);
    const half = Math.min(Math.min(rx, ry) * 0.3, 24);
    const bx = cx + ux * edge * 0.8, by = cy + uy * edge * 0.8;
    const a = [bx - uy * half, by + ux * half], b = [bx + uy * half, by - ux * half];
    const bend = 0.1 * (dist - edge);
    const ctrl = [cx + ux * (edge + (dist - edge) * 0.45) - uy * bend, cy + uy * (edge + (dist - edge) * 0.45) + ux * bend];
    const bez = (p, q, r, t) => [(1 - t) ** 2 * p[0] + 2 * (1 - t) * t * q[0] + t * t * r[0], (1 - t) ** 2 * p[1] + 2 * (1 - t) * t * q[1] + t * t * r[1]];
    const pts = [];
    for (let i = 0; i <= 16; i++) pts.push(bez(a, ctrl, [tx, ty], i / 16));
    for (let i = 1; i <= 16; i++) pts.push(bez([tx, ty], ctrl, b, i / 16));
    return pts;
  }

  function thoughtBubbles(L) {
    const tx = L.item.tail[0] * W, ty = L.item.tail[1] * H, { cx, cy } = L;
    const dist = Math.hypot(tx - cx, ty - cy) || 1, ux = (tx - cx) / dist, uy = (ty - cy) / dist;
    const edge = edgeDist(L, ux, uy) * 1.08;
    return [[0.3, 10], [0.65, 7], [1.0, 4.5]].map(([f, r]) => [cx + ux * (edge + (dist - edge) * f), cy + uy * (edge + (dist - edge) * f), r]);
  }

  const poly = (pts) => pts.map((p) => r1(p[0]) + "," + r1(p[1])).join(" ");

  /** The balloon's half sizes round a text block, from the corners of each line (or column). */
  function bodyFit(st, tw, th, corners) {
    if (st.shape === "box" || st.shape === "phone") return [tw / 2 + st.px, th / 2 + st.py];
    if (st.shape === "none") return [tw / 2 + 4, th / 2 + 4];
    const a = tw / 2 + st.px, b = th / 2 + st.py;
    let s = 1;
    for (const [x, y] of corners) s = Math.max(s, Math.pow(Math.pow(Math.abs(x) / a, N) + Math.pow(Math.abs(y) / b, N), 1 / N));
    return [a * s, b * s];
  }

  /** Japanese set across (a phone screen, a sound, or dir "h"): no spaces between words, breaks by 禁則. */
  function measureJaRows(item, kind, st, fontKey, f, size, fontCss, measureText) {
    const toks = jaUnits(st.upper ? String(item.text || "").toUpperCase() : item.text);
    const len = toks.map((t) => measureText(fontCss(t.b), t.w));
    const maxW = (item.width != null ? item.width : st.width) * W;
    let lines = jaBalance(toks, len, maxW);
    if (!lines.length) lines = [[]];
    const widths = lines.map((ln) => ln.reduce((a, i) => a + len[i], 0));
    const lh = size * st.lh, tw = Math.max(1, ...widths), th = lh * lines.length;
    const corners = []; widths.forEach((w, i) => [i, i + 1].forEach((j) => corners.push([w / 2, -th / 2 + j * lh])));
    const [rx, ry] = bodyFit(st, tw, th, corners);
    return {
      item, kind, st, fontKey, f, size, fontCss, toks, lines, widths, lh, tw, th, rx, ry, ja: true,
      cx: (item.at ? item.at[0] : 0.5) * W, cy: (item.at ? item.at[1] : 0.5) * H,
      hasTail: !!item.tail && TAIL_KINDS.has(kind),
      rotate: st.shape === "none" ? (item.rotate != null ? item.rotate : st.rotate || 0) : 0,
    };
  }

  /** Japanese in columns (縦書き): each column top to bottom, the first column on the right. Full-square letters take one square;
   *  latin letters and numbers lie on their side and take their width. The columns are balanced like lines across are. */
  function measureColumns(item, kind, st, fontKey, f, size, fontCss, measureText) {
    const toks = jaUnits(item.text);
    const len = toks.map((t) => [...t.w].reduce((a, ch) => a + (FULL.test(ch) || JA.test(ch) ? size : measureText(fontCss(t.b), ch)), 0));
    // the longest column, in letters: a manga balloon holds about 5 to 8 a column
    const per = item.width != null ? Math.max(2, Math.round(item.width * W / size)) : kind === "caption" ? 10 : kind === "shout" ? 6 : kind === "crowd" || kind === "whisper" ? 6 : kind === "ambient" ? 4 : 7;
    const maxH = per * size + 0.01;
    let cols = jaBalance(toks, len, maxH);
    if (!cols.length) cols = [[]];
    const heights = cols.map((c) => c.reduce((a, i) => a + len[i], 0));
    const pitch = size * Math.max(1.3, st.lh + 0.12);
    const tw = size + pitch * (cols.length - 1), th = Math.max(1, ...heights);
    const corners = [];
    cols.forEach((c, i) => { const x = tw / 2 - size / 2 - i * pitch; for (const dx of [-size / 2, size / 2]) for (const y of [-th / 2, -th / 2 + heights[i]]) corners.push([x + dx, y]); });
    // a column balloon is padded more at top and foot than at the sides
    const st2 = Object.assign({}, st, { px: st.py, py: st.px * 1.1 });
    const [rx, ry] = bodyFit(st2, tw, th, corners);
    return {
      item, kind, st, fontKey, f, size, fontCss, toks, lines: cols, widths: heights, lh: pitch, tw, th, rx, ry, ja: true, vertical: true,
      cx: (item.at ? item.at[0] : 0.5) * W, cy: (item.at ? item.at[1] : 0.5) * H,
      hasTail: !!item.tail && TAIL_KINDS.has(kind),
      rotate: st.shape === "none" ? (item.rotate != null ? item.rotate : st.rotate || 0) : 0,
    };
  }

  function rectPath(L, inset, radius) {
    const x0 = L.cx - L.rx + inset, y0 = L.cy - L.ry + inset, w = 2 * (L.rx - inset), h = 2 * (L.ry - inset);
    return `x="${r1(x0)}" y="${r1(y0)}" width="${r1(w)}" height="${r1(h)}" rx="${radius}" ry="${radius}"`;
  }

  function textSvg(L) {
    const { st, f, size, lines, widths, lh, th, cx, cy, tw } = L;
    const left = st.shape === "box";
    // a sound effect: solid letters with a thick edge in the other colour, so it reads over any picture; "hollow" swaps the two
    const ink = st.sfx && L.item.hollow ? "#fff" : L.item.ink || "#000";
    const halo = st.sfx ? ` stroke="${L.item.hollow ? esc(L.item.ink || "#000") : "#fff"}" stroke-width="${r1(size * 0.13)}" stroke-linejoin="round" paint-order="stroke"`
      : st.shape === "none" ? ` stroke="#fff" stroke-width="${r1(size * 0.22)}" stroke-linejoin="round" paint-order="stroke"` : "";
    let out = "";
    if (L.vertical) {
      // one <text> a column, standing up; the first column on the right
      lines.forEach((col, i) => {
        const x = cx + tw / 2 - size / 2 - lh * i, y = cy - th / 2;
        const spans = col.map((ti) => { const t = L.toks[ti]; return `<tspan font-weight="${t.b || st.allBold ? f.b : f.w}">${esc(t.w)}</tspan>`; }).join("");
        out += `<text x="${r1(x)}" y="${r1(y)}" writing-mode="vertical-rl" style="writing-mode:vertical-rl;text-orientation:mixed" font-family="${esc(f.family)}" font-size="${r1(size)}" font-weight="${f.w}" fill="${esc(ink)}"${halo}>${spans}</text>`;
      });
      if (L.rotate) out = `<g transform="rotate(${L.rotate} ${r1(cx)} ${r1(cy)})">${out}</g>`;
      return out;
    }
    lines.forEach((line, i) => {
      const y = cy - th / 2 + lh * i + lh * 0.76;
      const x = left ? cx - tw / 2 : cx;
      const spans = line.map((ti, k) => {
        const t = L.toks[ti];
        const wgt = t.b || st.allBold ? f.b : f.w;
        return `<tspan font-weight="${wgt}">${esc(t.w)}${k < line.length - 1 && !L.ja ? " " : ""}</tspan>`;
      }).join("");
      out += `<text x="${r1(x)}" y="${r1(y)}" text-anchor="${left ? "start" : "middle"}" font-family="${esc(f.family)}" font-size="${r1(size)}" font-weight="${f.w}" fill="${esc(ink)}"${halo} xml:space="preserve">${spans}</text>`;
    });
    if (L.rotate) out = `<g transform="rotate(${L.rotate} ${r1(cx)} ${r1(cy)})">${out}</g>`;
    return out;
  }

  /** Lettering layer for measured items. Outlines first, then fills, so joined balloons merge into one shape. */
  function letteringSvg(Ls) {
    const s = STROKE;
    let outl = "", fill = "", over = "", text = "";
    for (const L of Ls) {
      const shape = L.st.shape;
      if (shape === "none") continue;
      if (shape === "box") {
        over += `<rect ${rectPath(L, 0, 0)} fill="#fbf6e9" stroke="#000" stroke-width="${r1(1.2 * s)}"/>`;
        continue;
      }
      const thin = shape === "thin" ? 0.7 : 1;
      if (shape === "phone") {
        outl += `<rect ${rectPath(L, 0, 16)} fill="#000" stroke="#000" stroke-width="${r1(2 * s)}"/>`;
        fill += `<rect ${rectPath(L, 0, 16)} fill="#fff"/>`;
        over += `<rect ${rectPath(L, 6, 11)} fill="none" stroke="#000" stroke-width="${r1(0.6 * s)}"/>`;
      } else {
        const pts = poly(bodyPoints(L));
        if (shape !== "dashed") outl += `<polygon points="${pts}" fill="#000" stroke="#000" stroke-width="${r1(2 * s * thin)}" stroke-linejoin="round"/>`;
        fill += `<polygon points="${pts}" fill="#fff"/>`;
        if (shape === "dashed") over += `<polygon points="${pts}" fill="none" stroke="#000" stroke-width="${r1(1.5 * s)}" stroke-dasharray="9 7" stroke-linecap="round"/>`;
      }
      if (L.hasTail) {
        if (shape === "cloud") {
          for (const [x, y, r] of thoughtBubbles(L)) {
            outl += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r + s)}" fill="#000"/>`;
            fill += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="#fff"/>`;
          }
        } else {
          const tp = poly(tailPoints(L));
          outl += `<polygon points="${tp}" fill="#000" stroke="#000" stroke-width="${r1(2 * s * thin)}" stroke-linejoin="round"/>`;
          fill += `<polygon points="${tp}" fill="#fff"/>`;
        }
      }
    }
    for (const L of Ls) text += textSvg(L);
    return `<g class="ol">${outl}</g><g class="fl">${fill}</g><g class="ov">${over}</g><g class="tx">${text}</g>`;
  }

  function pageNumberSvg(page) {
    if (!page.number) return "";
    // a picture that runs to the foot of the page (a full-page panel with no border) carries no page number: it would sit on the art
    if (page.layout && layoutGeom(page.layout).cells.some((c) => c.panel.type === "bleed" && c.bbox[3] >= H - 1 && c.bbox[0] < 500 && c.bbox[2] > 500)) return "";
    return `<text x="500" y="${H - 12}" text-anchor="middle" font-family="${esc(FONTS.vollkorn.family)}" font-size="22" font-weight="500" fill="#333">${esc(page.number)}</text>`;
  }

  // ---------- composed pages: rows of panels (gutters may slant) plus inset panels, each with its own art ----------
  // Row gutter below row r tilts by rows[r].slant (fraction of page height, + = right end lower).
  // Column gutter right of panel k tilts by panels[k].slant (fraction of page width, + = bottom end further right).
  // Insets: layout.insets = [{id, box:[x0,y0,x1,y1] page fractions, image, focus, zoom, type}] drawn on top.

  /** Row bands inside an area [x0,y0,x1,y1]: each row panel gets a rectangle. */
  function bandsIn(rows, area) {
    const g = GUTTER, out = [], [ax0, ay0, ax1, ay1] = area;
    const avail = ay1 - ay0 - g * Math.max(0, rows.length - 1);
    const total = rows.reduce((a, r) => a + r.h, 0) || 1;
    let y = ay0;
    rows.forEach((row, r) => {
      const rh = r === rows.length - 1 ? ay1 - y : avail * row.h / total;
      const aw = ax1 - ax0 - g * Math.max(0, row.panels.length - 1);
      const wsum = row.panels.reduce((a, p) => a + (p.w || 1), 0) || 1;
      let x = ax0;
      row.panels.forEach((p, k) => {
        const pw = k === row.panels.length - 1 ? ax1 - x : aw * (p.w || 1) / wsum;
        out.push({ r, k, panel: p, box: [x, y, x + pw, y + rh], wPerU: wsum / aw, hPerU: total / avail });
        x += pw + g;
      });
      y += rh + g;
    });
    return out;
  }
  // Reading direction: layout.rtl = true is a page read right to left (manga). The order of `panels` in a row is still the
  // reading order; the row is laid out from the right, and slants mirror with it. Insets keep their place.
  const isRtl = (layout) => !!(layout && layout.rtl);
  const flipBox = (b) => [W - b[2], b[1], W - b[0], b[3]];
  function bands(layout) {
    const out = bandsIn(layout.rows || [], [MARGIN, MARGIN, W - MARGIN, H - MARGIN]);
    if (isRtl(layout)) for (const c of out) c.box = flipBox(c.box);
    return out;
  }

  // A "horizontal" line: y = y0 + kx * x.  A "vertical" line: x = x0 + ky * y.
  const hThrough = (xa, ya, xb, yb) => { const kx = (yb - ya) / (xb - xa); return { y0: ya - kx * xa, kx }; };
  const vLine = (xTop, yTop, xBot, yBot) => { const ky = (xBot - xTop) / (yBot - yTop); return { x0: xTop - ky * yTop, ky }; };
  const shiftH = (L, d) => ({ y0: L.y0 + d * Math.sqrt(1 + L.kx * L.kx), kx: L.kx });
  const shiftV = (L, d) => ({ x0: L.x0 + d * Math.sqrt(1 + L.ky * L.ky), ky: L.ky });
  function meet(h, v) { const x = (v.x0 + v.ky * h.y0) / (1 - v.ky * h.kx); return [x, h.y0 + h.kx * x]; }

  /** Clip a convex polygon to another convex polygon (Sutherland–Hodgman). */
  function clipConvex(subject, clip) {
    let out = subject;
    const area = clip.reduce((a, p, i) => { const q = clip[(i + 1) % clip.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
    const sgn = area >= 0 ? 1 : -1;
    for (let i = 0; i < clip.length && out.length; i++) {
      const A = clip[i], B = clip[(i + 1) % clip.length];
      const side = (P) => sgn * ((B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]));
      const inp = out; out = [];
      inp.forEach((P, j) => {
        const Q = inp[(j + 1) % inp.length], sp = side(P), sq = side(Q);
        if (sp >= 0) out.push(P);
        if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
      });
    }
    return out;
  }

  /** Geometry for one level of rows inside an area; recurses into panels that hold their own rows. */
  function geomRows(rows, area, path, clip, acc) {
    const cells = bandsIn(rows, area), g = GUTTER, [ax0, ay0, ax1, ay1] = area;
    const rowBox = (r) => cells.find((c) => c.r === r).box;
    const rowLines = [], colLines = [];
    for (let r = 0; r < rows.length - 1; r++) {
      const yc = (rowBox(r)[3] + rowBox(r + 1)[1]) / 2;
      const lim = Math.min(rowBox(r)[3] - rowBox(r)[1], rowBox(r + 1)[3] - rowBox(r + 1)[1]) * 0.45;
      const s = Math.max(-lim, Math.min(lim, (rows[r].slant || 0) * H));
      const line = hThrough(ax0, yc - s, ax1, yc + s);
      rowLines.push({ path, r, line, p0: [ax0, line.y0 + line.kx * ax0], p1: [ax1, line.y0 + line.kx * ax1], yc, s, hPerU: cells[0].hPerU });
    }
    for (const c of cells) {
      const row = rows[c.r];
      if (c.k >= row.panels.length - 1) continue;
      const next = cells.find((q) => q.r === c.r && q.k === c.k + 1);
      const xc = (c.box[2] + next.box[0]) / 2, [, y0, , y1] = c.box;
      const lim = Math.min(c.box[2] - c.box[0], next.box[2] - next.box[0]) * 0.45;
      const t = Math.max(-lim, Math.min(lim, (c.panel.slant || 0) * W));
      colLines.push({ path, r: c.r, k: c.k, line: vLine(xc - t, y0, xc + t, y1), p0: [xc - t, y0], p1: [xc + t, y1], xc, t, wPerU: c.wPerU });
    }
    for (const c of cells) {
      const above = rowLines.find((L) => L.r === c.r - 1), below = rowLines.find((L) => L.r === c.r);
      const top = above ? shiftH(above.line, g / 2) : { y0: ay0, kx: 0 };
      const bot = below ? shiftH(below.line, -g / 2) : { y0: ay1, kx: 0 };
      const leftL = colLines.find((L) => L.r === c.r && L.k === c.k - 1), rightL = colLines.find((L) => L.r === c.r && L.k === c.k);
      const left = leftL ? shiftV(leftL.line, g / 2) : { x0: ax0, ky: 0 };
      const right = rightL ? shiftV(rightL.line, -g / 2) : { x0: ax1, ky: 0 };
      let poly = [meet(top, left), meet(top, right), meet(bot, right), meet(bot, left)];
      if (clip) poly = clipConvex(poly, clip);
      c.poly = poly; c.path = path;
      if (c.panel.rows && c.panel.rows.length) {
        const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
        geomRows(c.panel.rows, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], path.concat([c.r, c.k]), poly, acc);
      } else acc.cells.push(c);
    }
    acc.rowLines.push(...rowLines);
    acc.colLines.push(...colLines);
  }

  const validShape = (s) => Array.isArray(s) && s.length >= 3 && s.length <= 64 && s.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const sh3 = (v) => Math.round(v * 1000) / 1000;
  /** Does this outline cross itself (two of its edges that are not neighbours cut each other)? Such a shape fills oddly and its border doubles back. */
  function crossesItself(poly) {
    const n = (poly || []).length; if (n < 4) return false;
    const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the last edge meets the first at a corner
      const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
      const d1 = side(a, b, c), d2 = side(a, b, d), d3 = side(c, d, a), d4 = side(c, d, b);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
    return false;
  }
  /** Ready-made shapes, as shares of the panel's box. Each is the same every time (nothing random), so a page looks the same on every screen. */
  const SHAPES = {
    slant: { label: "Slanted", make: () => [[0.1, 0], [1, 0], [0.9, 1], [0, 1]] },
    jagged: { label: "Jagged", make: () => { // straight sides broken into teeth, uneven on purpose
      const out = [], side = (a, b, n, nx, ny) => { for (let i = 0; i < n; i++) { const t = i / n, d = i === 0 ? 0 : (i % 2 ? -0.045 : 0.03) * (1 + ((i * 7) % 3) * 0.25); out.push([sh3(a[0] + (b[0] - a[0]) * t + nx * d), sh3(a[1] + (b[1] - a[1]) * t + ny * d)]); } };
      side([0, 0], [1, 0], 6, 0, -1); side([1, 0], [1, 1], 5, 1, 0); side([1, 1], [0, 1], 6, 0, 1); side([0, 1], [0, 0], 5, -1, 0); return out; } },
    burst: { label: "Burst", make: () => { const out = [], n = 14; for (let i = 0; i < n * 2; i++) { const a = Math.PI * i / n - Math.PI / 2, r = i % 2 ? 0.37 + ((i * 5) % 3) * 0.015 : 0.5; out.push([sh3(0.5 + Math.cos(a) * r), sh3(0.5 + Math.sin(a) * r)]); } return out; } },
    oval: { label: "Oval", make: () => { const out = [], n = 32; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n - Math.PI / 2; out.push([sh3(0.5 + Math.cos(a) * 0.5), sh3(0.5 + Math.sin(a) * 0.5)]); } return out; } },
  };

  /** Full geometry: leaf cells (in reading order) with polygons, gutter centre lines, and insets. */
  function layoutGeom(layout) {
    const acc = { cells: [], rowLines: [], colLines: [] };
    geomRows(layout.rows || [], [MARGIN, MARGIN, W - MARGIN, H - MARGIN], [], null, acc);
    const rtl = isRtl(layout);
    if (rtl) { // everything is worked out left to right, then mirrored about the page's centre line
      const mx = ([x, y]) => [W - x, y];
      for (const c of acc.cells) {
        c.box = flipBox(c.box);
        c.poly = c.poly.length === 4 ? [mx(c.poly[1]), mx(c.poly[0]), mx(c.poly[3]), mx(c.poly[2])] : c.poly.map(mx).reverse(); // corners stay top-left, top-right, bottom-right, bottom-left
      }
      for (const L of acc.rowLines) { // the knob end (p1) moves to the left edge with its slant, so dragging it reads the same
        L.p0 = mx(L.p0); L.p1 = mx(L.p1); L.line = hThrough(L.p1[0], L.p1[1], L.p0[0], L.p0[1]); L.flip = true;
      }
      for (const L of acc.colLines) { L.p0 = mx(L.p0); L.p1 = mx(L.p1); L.xc = W - L.xc; L.line = vLine(L.p0[0], L.p0[1], L.p1[0], L.p1[1]); L.flip = true; }
    }
    const insets = (layout.insets || []).map((p, i) => {
      const [a, b, cc, d] = p.box;
      return { inset: true, i, panel: p, poly: [[a * W, b * H], [cc * W, b * H], [cc * W, d * H], [a * W, d * H]] };
    });
    for (const c of acc.cells.concat(insets)) {
      if (c.panel.type === "bleed") {
        const e = MARGIN + 1;
        c.drawPoly = c.poly.map(([x, y]) => [x <= e ? 0 : x >= W - e ? W : x, y <= e ? 0 : y >= H - e ? H : y]);
      } else c.drawPoly = c.poly;
      const xs = c.drawPoly.map((p) => p[0]), ys = c.drawPoly.map((p) => p[1]);
      c.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      // A panel's own shape: corners placed by hand, as shares of the plain panel's box (its "frame"); a corner may sit outside
      // the frame, so a panel can break out of its place. On a right-to-left page a panel in the rows is mirrored with the page.
      if (validShape(c.panel.shape)) {
        const [x0, y0, x1, y1] = c.bbox, w = x1 - x0, h = y1 - y0, mir = rtl && !c.inset;
        c.frame = c.bbox; c.mirrored = mir; c.shaped = true;
        c.drawPoly = c.poly = c.panel.shape.map(([u, v]) => [Math.min(W, Math.max(0, mir ? x1 - u * w : x0 + u * w)), Math.min(H, Math.max(0, y0 + v * h))]);
        const sx = c.poly.map((p) => p[0]), sy = c.poly.map((p) => p[1]);
        c.bbox = [Math.min(...sx), Math.min(...sy), Math.max(...sx), Math.max(...sy)];
      }
    }
    return { cells: acc.cells, rowLines: acc.rowLines, colLines: acc.colLines, insets, rtl };
  }

  /** Every panel (row panels, then insets) with its id, polygon and bounding box. */
  function allPanels(layout) { const G = layoutGeom(layout); return G.cells.concat(G.insets); }
  const layoutBoxes = (layout) => bands(layout);

  /** Panel rectangles as page fractions, for the lettering checks (insets are drawn over panels, so they are left out). */
  function panelsFrac(page) {
    if (page.layout) return layoutGeom(page.layout).cells.map((c) => [c.bbox[0] / W, c.bbox[1] / H, c.bbox[2] / W, c.bbox[3] / H]);
    return page.panels || [];
  }

  /** The visible window of an image in a panel (cover-crop with focus and zoom), in image pixels. */
  function cropWindow(panel, boxW, boxH, size) {
    const iw = size ? size[0] : boxW, ih = size ? size[1] : boxH;
    const scale = Math.max(boxW / iw, boxH / ih) * (panel.zoom || 1);
    const cw = boxW / scale, ch = boxH / scale;
    const f = panel.focus || [0.5, 0.5];
    const x = Math.min(Math.max(f[0] * iw - cw / 2, 0), iw - cw), y = Math.min(Math.max(f[1] * ih - ch / 2, 0), ih - ch);
    return { x, y, cw, ch, iw, ih, scale };
  }

  /** Image fraction -> page u, and back, for one panel. */
  function artMap(c, size) {
    const [x0, y0, x1, y1] = c.bbox, w = x1 - x0, h = y1 - y0, cw = cropWindow(c.panel, w, h, size);
    return {
      toPage: (fx, fy) => [x0 + (fx * cw.iw - cw.x) * (w / cw.cw), y0 + (fy * cw.ih - cw.y) * (h / cw.ch)],
      toArt: (px, py) => [((px - x0) * (cw.cw / w) + cw.x) / cw.iw, ((py - y0) * (cw.ch / h) + cw.y) / cw.ih],
      crop: cw,
    };
  }

  /** Face zones (page fractions). Composed pages take them from each panel's art: lib = {src: {size, protect}}. */
  /** Where each break-out's figure stands, in page u: the middle of its box (the cut-out figure is fitted inside the box, so the
   *  outer rim is mostly empty). One not drawn yet counts too: its place is already chosen. Balloons keep off these. */
  function breakoutZones(page) {
    const out = [];
    for (const b of (page.layout && page.layout.breakouts) || []) {
      if (!b || !Array.isArray(b.box)) continue;
      const w = b.box[2] - b.box[0], h = b.box[3] - b.box[1];
      out.push([(b.box[0] + w * 0.12) * W, (b.box[1] + h * 0.05) * H, (b.box[2] - w * 0.12) * W, (b.box[3] - h * 0.05) * H]);
    }
    return out;
  }
  function protectBoxes(page, lib) {
    if (!page.layout) return page.protect || [];
    const out = [];
    for (const z of breakoutZones(page)) out.push([z[0] / W, z[1] / H, z[2] / W, z[3] / H]); // a break-out is key art: the Letterer and the checks keep balloons off it
    for (const c of allPanels(page.layout)) if (!c.panel.image) for (const hd of boardHeads(c)) out.push([hd.box[0] / W, hd.box[1] / H, hd.box[2] / W, hd.box[3] / H]);
    for (const c of allPanels(page.layout)) {
      const art = c.panel.image && lib[c.panel.image];
      if (!art || !art.protect) continue;
      const M = artMap(c, art.size), [x0, y0, x1, y1] = c.bbox;
      for (const z of art.protect) {
        const q = Array.isArray(z) ? z : z.box;
        const [a, b] = M.toPage(q[0], q[1]), [cc, d] = M.toPage(q[2], q[3]);
        const qx0 = Math.max(a, x0), qy0 = Math.max(b, y0), qx1 = Math.min(cc, x1), qy1 = Math.min(d, y1);
        if (qx1 > qx0 && qy1 > qy0) out.push([qx0 / W, qy0 / H, qx1 / W, qy1 / H]);
      }
    }
    return out;
  }

  const HEAD = { close: 0.24, medium: 0.13, wide: 0.07, tiny: 0.045 };
  /** Storyboard heads: where each named character's head sits in a board panel (page u). */
  function boardHeads(c) {
    const b = c.panel.board; if (!b || !b.who) return [];
    const [x0, y0, x1, y1] = c.bbox, w = x1 - x0, h = y1 - y0, m = Math.min(w, h);
    return b.who.map((q) => {
      const r = (HEAD[q.size] || HEAD.medium) * m, cx = x0 + q.at[0] * w, cy = y0 + q.at[1] * h;
      return { who: q.name, facing: q.facing, cx, cy, r, box: [cx - r, cy - r * 1.15, cx + r, cy + r * 1.15] };
    });
  }

  /** Labelled faces on a composed page, in page u, clipped to their panel: [{who, box, cell, guess?}]. */
  function faceZones(page, lib) {
    const out = [];
    allPanels(page.layout).forEach((c, ci) => {
      if (!c.panel.image) for (const hd of boardHeads(c)) out.push({ who: hd.who, box: hd.box, cell: ci }); // art brings its own labelled faces
      if (!c.panel.image) return;
      const art = lib[c.panel.image], seen = new Set();
      if (art && art.protect) {
        const M = artMap(c, art.size), [x0, y0, x1, y1] = c.bbox;
        for (const z of art.protect) {
          const q = Array.isArray(z) ? z : z.box, who = Array.isArray(z) ? null : z.who;
          const [a, b] = M.toPage(q[0], q[1]), [cc, d] = M.toPage(q[2], q[3]);
          const box = [Math.max(a, x0), Math.max(b, y0), Math.min(cc, x1), Math.min(d, y1)];
          if (box[2] > box[0] && box[3] > box[1]) { out.push({ who, box, cell: ci }); seen.add(who); }
        }
      }
      // someone the storyboard put here whose face nobody labelled on the picture: use the storyboard's head, as a guess
      for (const hd of boardHeads(c)) if (!seen.has(hd.who)) out.push({ who: hd.who, box: hd.box, cell: ci, guess: true });
    });
    return out;
  }

  /** The Letterer's plan: written on the page, or read from the storyboard panels' lines. */
  function planFor(page) {
    if (page.plan && page.plan.length) return page.plan;
    if (!page.layout) return [];
    const out = [];
    allPanels(page.layout).forEach((c, i) => { for (const l of (c.panel.board && c.panel.board.lines) || []) out.push(Object.assign({ panel: i + 1 }, l)); });
    return out;
  }

  /** Where a balloon sits to tie its panel to the next one in reading order: on the border between the two, as near as it can
   *  stay to where it is now. -> [x, y] in page units, or null (the last panel of the page has no next one). */
  function bridgeSpot(page, item) {
    if (!page.layout) return null;
    const cells = allPanels(page.layout), i = cells.findIndex((c) => c.panel.id === item.panel); if (i < 0 || !cells[i + 1]) return null;
    const a = cells[i].bbox, b = cells[i + 1].bbox, cx = item.at[0] * W, cy = item.at[1] * H, mid = (lo, hi, v) => (lo <= hi ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);
    const xs = [Math.max(a[0], b[0]), Math.min(a[2], b[2])], ys = [Math.max(a[1], b[1]), Math.min(a[3], b[3])];
    if (xs[1] - xs[0] > 60 && ys[1] - ys[0] <= 0) return [mid(xs[0] + 90, xs[1] - 90, cx), b[1] >= a[3] ? (a[3] + b[1]) / 2 : (b[3] + a[1]) / 2]; // one above the other
    if (ys[1] - ys[0] > 60 && xs[1] - xs[0] <= 0) return [b[0] >= a[2] ? (a[2] + b[0]) / 2 : (b[2] + a[0]) / 2, mid(ys[0] + 60, ys[1] - 60, cy)]; // side by side
    const near = (p, q, v) => Math.min(q, Math.max(p, v)), pa = [near(a[0], a[2], (b[0] + b[2]) / 2), near(a[1], a[3], (b[1] + b[3]) / 2)], pb = [near(b[0], b[2], pa[0]), near(b[1], b[3], pa[1])];
    return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]; // they only meet at a corner
  }

  /** The Letterer's placement pass: turns a plan (who says what, in which panel, as which type) into placed balloons.
   * Keeps balloons inside their panel, off faces and off each other, near and above the speaker, in reading order,
   * and aims each tail at the speaker's head. Lines marked join become one joined balloon with a single tail. */
  function autoPlace(page, spec, lib, measureText) {
    const cells = allPanels(page.layout), faces = faceZones(page, lib), figures = breakoutZones(page);
    const placed = [], items = [];
    const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inPoly = (poly, x, y) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    // the part of a face that must stay readable: eyes to chin, not the hair or the cheeks' edges
    const core = (b) => { const w = b[2] - b[0], h = b[3] - b[1]; return [b[0] + w * 0.15, b[1] + h * 0.3, b[2] - w * 0.15, b[3]]; };
    const sameChain = (a, b) => !!(a && b && a.join && b.join && a.panel === b.panel && (a.source_id ? a.source_id === b.source_id : true));
    // Reading order inside a panel: the next balloon is lower, or level with the last one and further along the reading
    // direction (to its right on a left-to-right page, to its left on a right-to-left page)
    const rtl = isRtl(page.layout), fwd = rtl ? -1 : 1;
    const outOfOrder = (cx, cy, prev) => cy < prev.cy - prev.oy * 0.5 || (Math.abs(cy - prev.cy) <= prev.oy * 0.5 && (cx - prev.cx) * fwd < 0);
    const SIZES = [1, 0.9, 0.82, 0.74]; // type shrinks a little before a balloon is allowed to cover anything
    /** A line cut in two at the pause nearest its middle (after , ; : . ! ? … or a dash), or null. The halves joined by a space are the line, word for word. */
    function splitAtPause(text) {
      const ws = String(text || "").split(/\s+/).filter(Boolean); if (ws.length < 6) return null;
      let best = -1;
      for (let i = 1; i < ws.length - 2; i++) { // cut after word i: both halves keep two words or more
        if (!/[,;:.!?…—–-]["”’')\]*]*$/.test(ws[i])) continue;
        if ((ws.slice(0, i + 1).join(" ").match(/\*\*/g) || []).length % 2) continue; // never inside a bold word
        if (best < 0 || Math.abs(i + 1 - ws.length / 2) < Math.abs(best + 1 - ws.length / 2)) best = i;
      }
      return best < 0 ? null : [ws.slice(0, best + 1).join(" "), ws.slice(best + 1).join(" ")];
    }

    /** Best spot for one balloon at one type size; `bad` counts what it still breaks there. */
    function fit(line, cell, ci, size, prev, chained, spill) { // spill: the balloon may hang over the panel's edge (its middle stays inside)
      const item = { kind: line.kind || "speech", speaker: line.speaker || "", source_id: line.source_id, text: line.text, at: [0.5, 0.5] };
      if (size < 1) item.size = size;
      const [bx0, by0, bx1, by1] = cell.bbox, pad = 12;
      if (line.width) item.width = line.width;
      else if (isVertical(item, item.kind)) {
        // Japanese columns: pick the column length (in letters): fits the panel, taller than wide, breaks between phrases, no lonely scrap of a column
        const sz = styleFor(item, spec).st.size * (item.size || 1);
        let pick = null;
        for (let per = 3; per <= 11; per++) {
          item.width = Math.round((per * sz / W) * 1000) / 1000;
          const M = measure(item, spec, measureText), [mx, my] = outer(M);
          const fits = 2 * (mx + 8) + 2 * pad < (bx1 - bx0) * 0.92 && 2 * (my + 8) + 2 * pad < (by1 - by0) * 0.9;
          const cols = M.lines, mids = midBreaks(M.toks, cols);
          const lonely = cols.length > 1 && cols.some((c) => c.reduce((a, i) => a + [...M.toks[i].w].length, 0) <= 1);
          const score = Math.abs(M.ry / M.rx - 1.6) * 0.6 + 0.1 * cols.length + 1.5 * mids + (lonely ? 1 : 0) + (cols.length > 5 ? 2 : 0) + (fits ? 0 : 10);
          if (!pick || score < pick.score) pick = { w: item.width, score };
        }
        item.width = pick.w;
      } else {
        // pick the balloon width: fits the panel, rounder than wide (about 1.3 : 1), at most 4 lines
        let pick = null;
        for (let w = 0.08; w <= 0.36; w += 0.02) {
          item.width = Math.round(w * 100) / 100;
          const M = measure(item, spec, measureText), [mx, my] = outer(M);
          const fits = 2 * (mx + 8) + 2 * pad < (bx1 - bx0) * 0.92 && 2 * (my + 8) + 2 * pad < (by1 - by0) * 0.9;
          const words = M.lines.map((ln) => ln.map((i) => M.toks[i].w));
          const lonely = M.lines.length > 1 && words.some((ln) => ln.length === 1 && ln[0].length <= 4); // "I" or "up." alone on a line
          const score = Math.abs(M.rx / M.ry - 1.3) + 0.12 * M.lines.length + (lonely ? 0.8 : 0) + (M.lines.length > 4 ? 2 : 0) + (fits ? 0 : 10);
          if (!pick || score < pick.score) pick = { w: item.width, score };
        }
        item.width = pick.w;
      }
      const L = measure(item, spec, measureText), [ox0, oy0] = outer(L), ox = ox0 + 8, oy = oy0 + 8, area = 4 * ox * oy;
      // a speaker the storyboard kept out of frame still gets a tail when the picture shows them (a labelled face, never a guess)
      const face = faces.find((f) => f.cell === ci && f.who === line.speaker && !(line.off && f.guess));
      const mine = spill ? faces : faces.filter((f) => f.cell === ci); // over the edge, every face on the page counts
      let best = null;
      const reach = spill ? 0.55 : -1, edge = 16; // how far past the panel the balloon's middle line may let it hang; and the page's own edge
      const yA = spill ? Math.max(by0 + oy * (1 - reach) , oy + edge) : by0 + oy + pad, yB = spill ? Math.min(by1 - oy * (1 - reach), H - oy - edge) : by1 - oy - pad;
      const xA = spill ? Math.max(bx0 + ox * (1 - reach), ox + edge) : bx0 + ox + pad, xB = spill ? Math.min(bx1 - ox * (1 - reach), W - ox - edge) : bx1 - ox - pad;
      for (let cy = yA; cy <= yB; cy += 8) {
        for (let sx = xA; sx <= xB; sx += 8) {
          const cx = rtl ? xA + xB - sx : sx; // scanned from the side read first, so a right-to-left page is the exact mirror of a left-to-right one
          const r = [cx - ox, cy - oy, cx + ox, cy + oy];
          const corners = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].filter(([x, y]) => inPoly(cell.drawPoly, x, y)).length;
          if (spill ? !inPoly(cell.drawPoly, cx, cy) || corners < 2 : corners < 4) continue;
          const out = spill ? 1 - overlap(r, cell.bbox) / area : 0; // the share of the balloon outside its panel
          if (out > 0.4) continue;
          const tr = [cx - L.tw / 2 - 10, cy - L.th / 2 - 8, cx + L.tw / 2 + 10, cy + L.th / 2 + 8];
          let cost = 900 * out, ovB = 0, ovT = 0, ovF = 0;
          for (const f of mine) { const c = overlap(r, core(f.box)) / area; ovF += c; cost += 9000 * c + 1500 * overlap(r, f.box) / area; }
          for (const z of figures) { const c = overlap(r, z) / area; ovF += c; cost += 9000 * c; } // a break-out lies over the panels: a balloon under or over it is lost
          placed.forEach((q, qi) => {
            if (chained && qi === placed.length - 1) { const o = overlap(tr, q.text) / area + overlap(r, q.text) / area * 0.5; ovT += o; cost += 20000 * o; } // joined balloons may touch; their words never (nor this balloon's edge)
            else { const o = overlap(r, q.rect) / area; ovB += o; cost += 14000 * o; }
          });
          if (chained) {
            // Japanese columns read sideways, so the next joined balloon sits beside the last (a little lower); lines across stack down the page
            const tx = L.vertical ? prev.cx + fwd * (prev.ox + ox) * 0.8 : prev.cx + fwd * (prev.ox + ox) * 0.62, ty = L.vertical ? prev.cy + (prev.oy + oy) * 0.25 : prev.cy + (prev.oy + oy) * 0.62;
            cost += 3 * Math.hypot(cx - tx, cy - ty);
          } else if (face) {
            const fx = (face.box[0] + face.box[2]) / 2;
            const above = [fx, face.box[1] - oy - 18];
            const roomAbove = above[1] - oy > by0 + pad;
            const roomL = face.box[0] - bx0, roomR = bx1 - face.box[2];
            const side = (rtl ? roomL > roomR - 0.5 : roomL > roomR) ? [face.box[0] - ox - 16, face.box[1] + oy] : [face.box[2] + ox + 16, face.box[1] + oy];
            const [tx, ty] = roomAbove ? above : side;
            cost += Math.hypot(cx - tx, cy - ty);
          } else cost += (cy - by0) * 0.6 + Math.abs(cx - (bx0 + bx1) / 2) * 0.2;
          const late = !!prev && outOfOrder(cx, cy, prev);
          if (late) cost += 2500 + 2 * Math.max(0, prev.cy - cy);
          const bad = (ovT > 0 ? 4 : 0) + (ovB > 0.02 ? 3 : 0) + (late ? 2 : 0) + (ovF > 0.06 ? 1 : 0);
          if (!best || cost < best.cost) best = { cost, bad, cx, cy, crosses: corners < 4, rect: r, text: [cx - L.tw / 2, cy - L.th / 2, cx + L.tw / 2, cy + L.th / 2] };
        }
      }
      if (!best) { const cx = (bx0 + bx1) / 2, cy = Math.min(by0 + oy + pad, (by0 + by1) / 2); best = { cost: 1e9, bad: 9, cx, cy, rect: [cx - ox, cy - oy, cx + ox, cy + oy], text: [cx - L.tw / 2, cy - L.th / 2, cx + L.tw / 2, cy + L.th / 2] }; }
      return Object.assign(best, { item, L, ox, oy, face });
    }

    const plan = planFor(page).map((l) => Object.assign({}, l));
    for (let n = 0; n < plan.length; n++) {
      const line = plan[n], cell = cells[(line.panel || 1) - 1]; if (!cell) continue;
      const ci = cells.indexOf(cell);
      const prevLine = n > 0 ? plan[n - 1] : null;
      const prev = placed.length && prevLine && prevLine.panel === line.panel ? placed[placed.length - 1] : null;
      const chained = !!prev && sameChain(prevLine, line);
      let best = null;
      for (const size of SIZES) { // the first size that breaks nothing wins; otherwise the one that breaks least
        const b = fit(line, cell, ci, size, prev, chained);
        if (!best || b.bad < best.bad) best = b;
        if (!best.bad) break;
      }
      // Short balloons (manga flow, 19 Nov 2026): a line that only fits by shrinking its type is first split at a pause into two
      // joined balloons at full size, when both halves then sit cleanly. The words are never changed.
      if ((best.bad || (best.item.size || 1) < 1) && !line.join && !line.width && !line.noSplit) {
        const parts = splitAtPause(line.text);
        if (parts) {
          const l1 = Object.assign({}, line, { text: parts[0], join: true, noSplit: true }), l2 = Object.assign({}, line, { text: parts[1], join: true, noSplit: true });
          const b1 = fit(l1, cell, ci, 1, prev, false);
          if (!b1.bad) {
            placed.push({ cx: b1.cx, cy: b1.cy, ox: b1.ox, oy: b1.oy, rect: b1.rect, text: b1.text });
            const b2 = fit(l2, cell, ci, 1, placed[placed.length - 1], true);
            placed.pop();
            if (!b2.bad) { plan.splice(n, 1, l1, l2); n--; continue; } // both halves are placed by the usual path
          }
        }
        line.noSplit = true;
      }
      // still covering a face or another balloon, or squeezed to small type: let it cross the panel's edge at full size, as a letterer would
      if (best.bad || (best.item.size || 1) < 0.9) {
        const over = fit(line, cell, ci, 1, prev, chained, true);
        if (over.cost < 1e9 && (over.bad < best.bad || (over.bad === best.bad && !over.bad))) best = over;
      }
      // a line split into joined balloons that cannot sit apart, in order, in this panel: say it in one balloon instead
      if (chained && best.bad >= 2 && !line.width) {
        prevLine.text = prevLine.text + " " + line.text;
        plan.splice(n, 1); placed.pop(); items.pop();
        const stillJoined = sameChain(plan[n - 2], prevLine) || sameChain(prevLine, plan[n]);
        if (!stillJoined) delete prevLine.join;
        n -= 2; continue; // place the merged line afresh
      }
      const item = best.item, L = best.L, face = best.face;
      item.at = [Math.round(best.cx / W * 1000) / 1000, Math.round(best.cy / H * 1000) / 1000];
      if (line.join) item.join = true;
      if (best.crosses) item.bleed = true; // "Crosses panel edge"
      const lastOfChain = !sameChain(line, plan[n + 1]);
      if (face && TAIL_KINDS.has(item.kind) && lastOfChain) {
        const mx = (face.box[0] + face.box[2]) / 2, my = face.box[1] + (face.box[3] - face.box[1]) * 0.55;
        let tx = best.cx, ty = best.cy;
        for (let s = 0; s <= 60; s++) {
          const x = best.cx + (mx - best.cx) * s / 60, y = best.cy + (my - best.cy) * s / 60;
          const inFace = x > face.box[0] - 10 && x < face.box[2] + 10 && y > face.box[1] - 10 && y < face.box[3] + 10;
          if (inFace) break;
          tx = x; ty = y;
        }
        const d = Math.hypot(tx - best.cx, ty - best.cy) || 1, ux = (tx - best.cx) / d, uy = (ty - best.cy) / d;
        const edge = 1 / Math.pow(Math.pow(Math.abs(ux) / L.rx, N) + Math.pow(Math.abs(uy) / L.ry, N), 1 / N);
        if (d < edge + 30) { tx = best.cx + ux * (edge + 30); ty = best.cy + uy * (edge + 30); } // tail always shows
        item.tail = [Math.round(tx / W * 1000) / 1000, Math.round(ty / H * 1000) / 1000];
      }
      item.panel = cell.panel.id;
      if (line.bridge && !line.join) { // the storyboard asks for this line to tie its panel to the next: onto the border, when no face is under it there
        const spot = bridgeSpot(page, item), hw = L.rx + 6, hh = L.ry + 6;
        if (spot) { const r = [spot[0] - hw, spot[1] - hh, spot[0] + hw, spot[1] + hh];
          const clear = r[0] > 8 && r[2] < W - 8 && r[1] > 8 && r[3] < H - 8 && !faces.some((fz) => overlap(r, core(fz.box)) > 0) && !placed.some((p) => overlap(r, p.rect) > 0);
          if (clear) { const dx = spot[0] - best.cx, dy = spot[1] - best.cy; item.at = [Math.round(spot[0] / W * 1000) / 1000, Math.round(spot[1] / H * 1000) / 1000]; item.bridge = true; item.bleed = true;
            best = Object.assign({}, best, { cx: spot[0], cy: spot[1], rect: r, text: [best.text[0] + dx, best.text[1] + dy, best.text[2] + dx, best.text[3] + dy] }); } }
      }
      placed.push({ cx: best.cx, cy: best.cy, ox: best.ox, oy: best.oy, rect: best.rect, text: best.text });
      items.push(item);
    }
    // A sound effect the storyboard asks for (panel.board.sfx): huge letters across the picture, no balloon. Sized to about
    // half its panel's width, and put where it covers the least of the faces, the balloons and the figures that stand above the borders.
    cells.forEach((cell, ci) => {
      const word = sfxWord((cell.panel.board || {}).sfx); if (!word || (cell.panel.inart && cell.panel.inart.sfx)) return; // the person had the Artist draw the sound into the picture instead
      const [bx0, by0, bx1, by1] = cell.bbox, bw = bx1 - bx0, bh = by1 - by0;
      const item = { kind: "sfx", speaker: "", text: word, at: [0.5, 0.5], panel: cell.panel.id, from: "board" };
      let L = measure(item, spec, measureText), [ox, oy] = outer(L);
      const k = Math.max(0.35, Math.min(3, Math.min(bw * 0.55 / (2 * ox), bh * 0.3 / (2 * oy)))); // letters about half the panel wide, never taller than a third of it
      if (Math.abs(k - 1) > 0.05) { item.size = Math.round(k * 100) / 100; L = measure(item, spec, measureText); [ox, oy] = outer(L); }
      let best = null;
      for (let gy = 0; gy <= 6; gy++) for (let gx = 0; gx <= 6; gx++) {
        const cx = bx0 + ox + 10 + (bw - 2 * ox - 20) * gx / 6, cy = by0 + oy + 10 + (bh - 2 * oy - 20) * gy / 6, r = [cx - ox, cy - oy, cx + ox, cy + oy];
        if (!inPoly(cell.drawPoly || cell.poly, cx, cy)) continue;
        let cost = 0;
        for (const f of faces) cost += overlap(r, f.box) * 6;
        for (const q of placed) cost += overlap(r, q.rect) * 4;
        for (const z of figures) cost += overlap(r, z) * 2;
        cost += (Math.abs(gy - 3) < 2 && Math.abs(gx - 3) < 2 ? 0.02 : 0) * 4 * ox * oy; // a little off the middle, where the picture's subject usually is
        cost += gy * 1e-3 + gx * 1e-4; // otherwise high in the panel
        if (!best || cost < best.cost) best = { cost, cx, cy, r };
      }
      if (!best) best = { cx: (bx0 + bx1) / 2, cy: by0 + bh * 0.25, r: [0, 0, 0, 0] };
      item.at = [Math.round(best.cx / W * 1000) / 1000, Math.round(best.cy / H * 1000) / 1000];
      placed.push({ cx: best.cx, cy: best.cy, ox, oy, rect: best.r, text: best.r });
      items.push(item);
    });
    return items;
  }
  /** A sound effect as the storyboard may ask for it: a word or two, at most 24 letters, in capitals. "" when there is none. */
  function sfxWord(v) { const t = String(v == null ? "" : v).replace(/[*_<>]/g, "").replace(/\s+/g, " ").trim().toUpperCase(); return t && t.split(" ").length <= 3 ? t.slice(0, 24) : ""; }

  const BLUE = "#4f7fe0", INKG = "#5b6370";
  function wrapApprox(text, maxW, size) {
    const cw = size * 0.5, out = []; let cur = "";
    for (const w of String(text).split(/\s+/)) {
      if ((cur + " " + w).trim().length * cw > maxW && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
    }
    if (cur) out.push(cur);
    return out;
  }
  /** A storyboard ("name") panel: shot label, head circles with names and facing, the action in small type. */
  function boardSvg(c) {
    const b = c.panel.board, [x0, y0, x1, y1] = c.bbox, w = x1 - x0, h = y1 - y0;
    let s = `<g class="board">`;
    const label = [b.shot, b.angle && b.angle !== "eye level" ? b.angle : ""].filter(Boolean).join(" · ").toUpperCase();
    s += `<text x="${r1(x0 + 10)}" y="${r1(y0 + 24)}" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="15" font-weight="700" fill="${BLUE}" letter-spacing="1">${esc(label)}</text>`;
    for (const hd of boardHeads(c)) {
      const d = hd.r;
      s += `<circle cx="${r1(hd.cx)}" cy="${r1(hd.cy)}" r="${r1(d)}" fill="#fff" stroke="${BLUE}" stroke-width="3"${hd.facing === "away" ? ' stroke-dasharray="7 6"' : ""}/>`;
      s += `<path d="M${r1(hd.cx - d * 1.5)} ${r1(hd.cy + d * 2.4)} Q${r1(hd.cx)} ${r1(hd.cy + d * 0.9)} ${r1(hd.cx + d * 1.5)} ${r1(hd.cy + d * 2.4)}" fill="none" stroke="${BLUE}" stroke-width="3"/>`;
      const dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[hd.facing];
      if (dir) s += `<line x1="${r1(hd.cx + dir[0] * d * 0.55)}" y1="${r1(hd.cy + dir[1] * d * 0.55)}" x2="${r1(hd.cx + dir[0] * d * 1.25)}" y2="${r1(hd.cy + dir[1] * d * 1.25)}" stroke="${BLUE}" stroke-width="4" stroke-linecap="round"/>`;
      else if (hd.facing !== "away") s += `<circle cx="${r1(hd.cx - d * 0.3)}" cy="${r1(hd.cy - d * 0.05)}" r="${r1(Math.max(2, d * 0.08))}" fill="${BLUE}"/><circle cx="${r1(hd.cx + d * 0.3)}" cy="${r1(hd.cy - d * 0.05)}" r="${r1(Math.max(2, d * 0.08))}" fill="${BLUE}"/>`;
      s += `<text x="${r1(hd.cx)}" y="${r1(hd.cy + 5)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${r1(Math.min(16, Math.max(11, d * 0.42)))}" font-weight="700" fill="${BLUE}">${esc(hd.who)}</text>`;
    }
    const fs = Math.max(12, Math.min(17, w / 22)), lines = wrapApprox(b.action || "", w - 24, fs), maxL = Math.max(1, Math.floor(h * 0.42 / (fs * 1.25)));
    const shown = lines.slice(0, maxL); if (lines.length > maxL) shown[maxL - 1] = shown[maxL - 1].replace(/\s*\S*$/, "") + "…";
    const top = y1 - 12 - shown.length * fs * 1.25;
    s += `<rect x="${r1(x0 + 6)}" y="${r1(top - 4)}" width="${r1(w - 12)}" height="${r1(shown.length * fs * 1.25 + 10)}" rx="6" fill="#f7f8fb" opacity="0.92"/>`;
    shown.forEach((ln, i) => { s += `<text x="${r1(x0 + 12)}" y="${r1(top + fs * (i + 1) * 1.25 - 3)}" font-family="Inter, system-ui, sans-serif" font-size="${r1(fs)}" fill="${INKG}">${esc(ln)}</text>`; });
    return s + "</g>";
  }

  /** href(src) -> URL to draw; sizes: {src: [w, h]}. */
  function layoutSvg(page, href, sizes) {
    let out = `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
    const G = layoutGeom(page.layout);
    G.cells.filter((c) => !c.shaped).concat(G.cells.filter((c) => c.shaped), G.insets).forEach((c, n) => { // a panel with a shape of its own may reach over its neighbours: it is drawn after the plain ones
      const p = c.panel, pts = poly(c.drawPoly), [x0, y0, x1, y1] = c.bbox, w = x1 - x0, h = y1 - y0;
      if (c.inset || c.shaped) out += `<polygon points="${pts}" fill="#fff" stroke="#fff" stroke-width="${GUTTER * 1.6}" stroke-linejoin="miter"/>`; // a white gutter of its own, over whatever is under it
      if (p.image && toneState(c) === "toned") { // the Toner's picture of this panel, made at the page's final size: placed dot for dot, never scaled
        const t = p.toned, k = (t.px || 2048) / W;
        out += `<clipPath id="pc${n}"><polygon points="${pts}"/></clipPath><g clip-path="url(#pc${n})"><image href="${esc(href(t.src))}" x="${t.box[0] / k}" y="${t.box[1] / k}" width="${(t.box[2] - t.box[0]) / k}" height="${(t.box[3] - t.box[1]) / k}" preserveAspectRatio="none"/></g>`;
      } else if (p.image) {
        const cw = cropWindow(p, w, h, sizes[p.image]);
        out += `<clipPath id="pc${n}"><polygon points="${pts}"/></clipPath><g clip-path="url(#pc${n})"><svg x="${r1(x0)}" y="${r1(y0)}" width="${r1(w)}" height="${r1(h)}" viewBox="${r1(cw.x)} ${r1(cw.y)} ${r1(cw.cw)} ${r1(cw.ch)}" preserveAspectRatio="none"><image href="${esc(href(p.image))}" x="0" y="0" width="${cw.iw}" height="${cw.ih}"/></svg></g>`;
      } else if (p.board) {
        out += `<polygon points="${pts}" fill="#f7f8fb"/><clipPath id="pc${n}"><polygon points="${pts}"/></clipPath><g clip-path="url(#pc${n})">${boardSvg(c)}</g>`;
      } else {
        out += `<polygon points="${pts}" fill="#f2f2f2"/>`;
      }
      if (!p.type || p.type === "framed") out += `<polygon points="${pts}" fill="none" stroke="#000" stroke-width="${BORDER}" stroke-linejoin="miter"/>`;
    });
    out += breakoutsSvg(page, href);
    return out;
  }
  /** Has the Toner toned this panel, and is its toned picture still right for it? "" (never toned) | "toned" | "stale"
   *  (the panel's picture, place on the page, or crop has changed since: the plain picture shows until the page is toned again).
   *  panel.toned = { src, box: the panel's box in final pixels, px: the page's width in those pixels, of: the picture toned, focus, zoom, layers, baked, strokes } */
  function toneState(c) {
    const p = c.panel, t = p.toned; if (!t || !p.image || !t.src || !Array.isArray(t.box)) return "";
    const k = (t.px || 2048) / W, f = p.focus || [0.5, 0.5], tf = t.focus || [0.5, 0.5];
    const same = t.of === p.image && c.bbox.every((v, i) => Math.round(v * k) === t.box[i]) && Math.abs(f[0] - tf[0]) < 1e-6 && Math.abs(f[1] - tf[1]) < 1e-6 && Math.abs((p.zoom || 1) - (t.zoom || 1)) < 1e-6;
    return same ? "toned" : "stale";
  }
  /** The same for a break-out: breakout.toned = { src, box, px, of, flip, layers, ... }. Moved, resized, flipped or drawn again = "stale". */
  function breakoutTone(b) {
    const t = b && b.toned; if (!t || !b.image || !t.src || !Array.isArray(t.box) || !Array.isArray(b.box)) return "";
    const k = (t.px || 2048) / W, box = [b.box[0] * W, b.box[1] * H, b.box[2] * W, b.box[3] * H];
    return t.of === b.image && !!t.flip === !!b.flip && box.every((v, i) => Math.round(v * k) === t.box[i]) ? "toned" : "stale";
  }
  /** And for a page that is one whole picture (no panels): page.toned = { src, of, px, ... }. -> the picture to show: the toned one while it is still of this picture. */
  function pageTone(page) { const t = page && page.toned; return !t || !page.art || !t.src ? "" : t.of === page.art ? "toned" : "stale"; }
  function pageArt(page) { return pageTone(page) === "toned" ? page.toned.src : page.art; }
  /** Every picture file a page shows (panel art or its toned picture, break-outs), for anything that must load them first. */
  function pictures(page) {
    const out = new Set(); if (!page.layout) { if (page.art) out.add(pageArt(page)); return [...out]; }
    for (const c of allPanels(page.layout)) if (c.panel.image) out.add(toneState(c) === "toned" ? c.panel.toned.src : c.panel.image);
    for (const b of page.layout.breakouts || []) if (b && b.image) out.add(breakoutTone(b) === "toned" ? b.toned.src : b.image);
    return [...out];
  }
  /** Break-outs: figures drawn as their own cut-out pictures, standing above the panel borders (and under the lettering).
   *  layout.breakouts = [{ id, box: [x0, y0, x1, y1] as shares of the page, image, flip, who, action, panel }]. One not drawn yet shows nothing here. */
  function breakoutsSvg(page, href) {
    let out = "";
    for (const b of (page.layout && page.layout.breakouts) || []) {
      if (!b || !b.image || !Array.isArray(b.box)) continue;
      if (breakoutTone(b) === "toned") { // the Toner's picture of this figure: made in its place at the final size (already turned round when flipped), placed dot for dot
        const t = b.toned, k = (t.px || 2048) / W;
        out += `<image href="${esc(href(t.src))}" x="${t.box[0] / k}" y="${t.box[1] / k}" width="${(t.box[2] - t.box[0]) / k}" height="${(t.box[3] - t.box[1]) / k}" preserveAspectRatio="none"/>`;
        continue;
      }
      const x = b.box[0] * W, y = b.box[1] * H, w = (b.box[2] - b.box[0]) * W, h = (b.box[3] - b.box[1]) * H;
      out += `<image href="${esc(href(b.image))}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="xMidYMid meet"${b.flip ? ` transform="translate(${r1(2 * x + w)} 0) scale(-1 1)"` : ""}/>`;
    }
    return out;
  }

  /** Layout checks, ported from letter_manga_page.py. Returns [{level, msg, i}]. */
  function check(page, Ls, protect) {
    const out = [];
    const add = (level, msg, i) => out.push({ level, msg, i });
    const words = Ls.filter((L) => L.kind !== "title" && L.kind !== "ambient" && L.kind !== "sfx").reduce((a, L) => a + plain(L.item.text).split(/\s+/).filter(Boolean).length, 0);
    if (words > LIMITS.wordsPage) add("warn", `${words} words on this page (limit ${LIMITS.wordsPage}). Move a beat to another page.`, -1);
    const panels = panelsFrac(page).map((b) => [b[0] * W, b[1] * H, b[2] * W, b[3] * H]);
    if (page.layout) allPanels(page.layout).forEach((c, n) => { // the Toner's work on this page
      const st = toneState(c);
      if (st === "stale") add("warn", `Panel ${n + 1} has changed since it was toned (its picture, its place or its crop), so its plain picture is showing. Tone the page again.`, -1);
      if (st === "toned" && c.panel.toned.baked) add("warn", `Panel ${n + 1}: dots are already drawn into its picture, under the Toner's dots. Two sets of dots can clash (moire). Draw it again with flat greys.`, -1);
    });
    if (page.layout) allPanels(page.layout).forEach((c, n) => { // a free shape whose outline crosses itself
      if (validShape(c.panel.shape) && crossesItself(c.panel.shape)) add("warn", `Panel ${n + 1}'s shape crosses itself: two of its edges cut each other, so part of the picture is lost and the border doubles back. In Layout, choose the panel, Edit corners, and drag a corner until no edges cross (or pick a ready-made shape).`, -1);
    });
    ((page.layout && page.layout.breakouts) || []).forEach((b, n) => { // and on its break-outs
      const st = breakoutTone(b), near = (page.layout ? allPanels(page.layout) : []).some((c) => toneState(c) === "toned");
      if (st === "stale") add("warn", `Break-out ${n + 1} has changed since it was toned (moved, resized, flipped or drawn again), so its plain picture is showing. Tone the page again.`, -1);
      else if (!st && b && b.image && near) add("warn", `Break-out ${n + 1} is not toned and the panels of this page are: plain grey beside dots. Tone the page again.`, -1);
      if (st === "toned" && b.toned.baked) add("warn", `Break-out ${n + 1}: dots are already drawn into its picture, under the Toner's dots. Two sets of dots can clash (moire). Draw it again with flat greys.`, -1);
    });
    if (!page.layout && pageTone(page) === "stale") add("warn", "This page's picture has changed since it was toned, so the plain picture is showing. Tone the page again.", -1);
    Ls.forEach((L, i) => {
      const text = plain(L.item.text);
      if (L.size < L.st.floor - 0.01) add("error", `Text is ${Math.round(L.size)}u, below the ${L.st.floor}u phone-size floor. Split the line or widen the balloon.`, i);
      const [ox, oy] = outer(L), m = 8;
      if (L.cx - ox < m || L.cx + ox > W - m || L.cy - oy < m || L.cy + oy > H - m) add("error", "Leaves the page.", i);
      if (L.lines.length > LIMITS.lines) add("warn", `${L.lines.length} lines. Split into two joined balloons.`, i);
      const n = text.split(/\s+/).filter(Boolean).length;
      if (L.kind !== "title" && n > LIMITS.wordsBalloon) add("warn", `${n} words in one balloon. Split it.`, i);
      if (L.kind === "sfx" && n > 4) add("warn", `${n} words in a sound effect. A sound is a word or two; use a caption for the rest.`, i);
      if (L.hasTail) {
        const d = Math.hypot(L.item.tail[0] * W - L.cx, L.item.tail[1] * H - L.cy) - Math.min(L.rx, L.ry);
        if (d > LIMITS.tail) add("warn", "Long tail. Move the balloon nearer its speaker.", i);
      } else if ((L.kind === "speech" || L.kind === "whisper") && !L.item.join) {
        add("warn", "No tail. Only right for an off-panel voice or a joined balloon.", i);
      }
      if (L.item.bridge) { // a balloon that ties two panels together sits ON the border between them
        const over = panels.filter(([x0, y0, x1, y1]) => L.cx + ox > x0 && L.cx - ox < x1 && L.cy + oy > y0 && L.cy - oy < y1).length;
        if (over < 2) add("warn", "A bridging balloon belongs across the border between two panels. Move it onto the border, or turn “Bridges to the next panel” off.", i);
      }
      if (L.kind !== "title" && L.kind !== "sfx" && !L.item.bleed && !L.item.bridge) {
        for (const [x0, y0, x1, y1] of panels) {
          if (L.cx >= x0 && L.cx <= x1 && L.cy >= y0 && L.cy <= y1) {
            if (L.cx - ox < x0 || L.cx + ox > x1 || L.cy - oy < y0 || L.cy + oy > y1) add("warn", "Spills out of its panel. Move it, or turn on “Crosses panel edge”.", i);
            break;
          }
        }
      }
      for (const b of protect || page.protect || []) {
        const x0 = b[0] * W, y0 = b[1] * H, x1 = b[2] * W, y1 = b[3] * H;
        if (L.cx + ox > x0 && L.cx - ox < x1 && L.cy + oy > y0 && L.cy - oy < y1) { add("error", "Covers a face or key prop (red zone).", i); break; }
      }
    });
    { // reading order: balloons of one panel are listed in speaking order, so each must sit after the one before it
      const rtl = isRtl(page.layout), fwd = rtl ? -1 : 1, last = new Map();
      Ls.forEach((L, i) => {
        const pid = L.item.panel; if (!pid || L.item.free || L.kind === "title" || L.kind === "sfx") return; // a sound effect is not read in turn
        const prev = last.get(pid); last.set(pid, L);
        if (!prev) return;
        const oy = outer(prev)[1] + 8;
        if (L.cy < prev.cy - oy * 0.5 || (Math.abs(L.cy - prev.cy) <= oy * 0.5 && (L.cx - prev.cx) * fwd < 0))
          add("warn", `Out of reading order: it is said after “${plain(prev.item.text).slice(0, 24)}” but sits ${L.cy < prev.cy - oy * 0.5 ? "above it" : rtl ? "to its right (this page reads right to left)" : "to its left"}.`, i);
      });
    }
    Ls.forEach((A, i) => {
      const [ax, ay] = outer(A);
      for (let j = 0; j < i; j++) {
        const B = Ls[j], [bx, by] = outer(B);
        if (A.item.join || B.item.join || A.kind === "sfx" || B.kind === "sfx") continue; // big letters may run behind a balloon on purpose
        if (Math.abs(A.cx - B.cx) < ax + bx && Math.abs(A.cy - B.cy) < ay + by) add("warn", `Overlaps “${plain(B.item.text).slice(0, 24)}”. Turn on “Joined” if that is on purpose.`, i);
      }
    });
    return out;
  }

  g.PageRender = { W, H, MARGIN, GUTTER, FONTS, KINDS, TAIL_KINDS, PANEL_TYPES, JA_FONT, isJapanese, isVertical, jaUnits, measure, outer, letteringSvg, pageNumberSvg, check, plain, esc, styleFor,
    layoutBoxes, layoutGeom, allPanels, isRtl, panelsFrac, cropWindow, artMap, layoutSvg, protectBoxes, faceZones, autoPlace, planFor, boardHeads, bridgeSpot, breakoutsSvg, breakoutZones, SHAPES, validShape, toneState, breakoutTone, pageTone, pageArt, pictures, sfxWord, crossesItself };
})(typeof window !== "undefined" ? window : globalThis);
