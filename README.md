# Ibasho

**An open-source studio for making manga and anime, built for creators who don't have powerful computers.**

Give Ibasho a script or a whole book. It takes the story through the same steps a real studio uses: storyboard → character sheets → art → lettering → finished pages. Then it can carry on into anime: shot list → animatic → video. AI "crew members" do the first pass of each step. You check their work, fix it by hand, and stay in charge.

> **Status: early and changing fast.** Ibasho is being built and tested in daily use on one creator's own series. It works end to end for manga. The anime side is mostly pre-production (planning, stills and animatics). Expect rough edges.

---

## What it does

### Manga

- **Start from a script or a book.** Paste a chapter script, or import a whole book (`.txt`, `.md`, `.docx`, `.epub`). Ibasho numbers every paragraph and finds the chapters.
- **Paneler (storyboard).** Turns the text into pages and panels. It keeps every spoken line word for word and in order, and keeps pages readable (at most 6 panels, 5 spoken lines and 70 words a page). For books, every panel links back to the paragraphs it draws.
- **People and places.** Reads a book and lists its characters and locations. Each look is built only from quotes that are checked against the text.
- **Series settings.** Pick an art style (six built in, or write your own) and give each character a look and a character sheet. Sheets are attached to every panel that character is in, so faces stay the same from panel to panel.
- **Artist.** Draws each panel. You can read and edit the prompt, add reference pictures, or redraw one panel or a whole page. The Artist checks its own pictures for common faults (stray text, extra people, broken hands) as a first filter.
- **Letterer.** Places speech balloons in reading order, keeps them off faces, and points each tail at the speaker. Every balloon, panel and gutter can be dragged and edited by hand.
- **Export.** Single pages, a whole chapter as high-resolution PNGs, or JPEG sets ready to post on X (20 images per post).

### Anime (in progress)

- **Animate manga pages.** Each panel becomes a shot with its lines, action and length.
- **Shot list and plan check.** Edit shots on your phone. A built-in craft check flags problems with staging and timing.
- **Blocking pass.** An AI pass turns the rough list into a real plan: movement, camera choices and timing.
- **Animatics.** A still animatic with camera moves and subtitles, and a grey 3D animatic of the scene at real scale (uses [StageFlow](https://github.com/taruma/stageflow)).
- **Looks, sheets and shows.** A "look" says how the anime is drawn. Shows group scenes into episodes.
- **Sound and export.** Voice, music and sound-effect layers; export a scene or a whole episode to MP4.

---

## The idea behind it

- **Light app, heavy work elsewhere.** Ibasho runs comfortably on an old laptop. Heavy AI work runs wherever you can afford it: a subscription you already pay for, a pay-per-use cloud GPU, or your own GPU if you have one.
- **Bring your own models.** Right now pictures and writing go through the [Codex CLI](https://github.com/openai/codex), using your own Codex/ChatGPT subscription. More sources are planned.
- **Agents propose, people decide.** Each production role (Paneler, Artist, Letterer, Blocking, Previs, Writer) is a plain-text role file in `agents/` with its rules and the lessons learned from real runs. Every result can be edited by hand.
- **Your work stays yours.** Projects, pictures and exports are saved in folders on your computer and are never uploaded to this repository.

---

## Getting started

### You need

- **Node.js 20 or newer** (no `npm install` needed; the server uses only Node's built-in modules)
- **Python 3** with **Pillow** and **NumPy** (some tools also use SciPy)
- **Codex CLI**, signed in (`codex login`). This is what draws pictures and writes storyboards.
- Optional, for the anime side: **ffmpeg** (video export), **StageFlow** (grey 3D animatic; set `STUDIO_STAGEFLOW` to its folder), **Blender** (detailed previs)

### Run it

```bash
git clone https://github.com/SprowtD/ibasho-studio.git
cd ibasho-studio/page-editor
node server.mjs            # then open http://localhost:5178
```

To use a different port, run `node server.mjs 5200`. When Ibasho starts it prints an **access code**: the computer that runs it is let straight in, and every other device (your phone, a laptop) is asked for the code once and then remembered. To reach it from your phone on the same Wi-Fi, open `http://<your computer's address>:5178`.

### First steps

1. Ibasho starts empty: there are no projects until you make one.
2. Click **New project from a script** and paste a short scene, or open **Books** and import a book.
3. In **Series**, pick an art style and approve a sheet for each main character.
4. On the Chapter screen, click **Draw the missing pictures**. Each picture takes about 3 minutes, and two are drawn at a time.
5. Click **Letterer: letter every page**, adjust anything by hand, then **Export**.

### Let your agent run it (MCP)

Ibasho comes with its own MCP server, `page-editor/mcp.mjs`, so Claude Code, Codex, Gemini CLI or any MCP client running on the same computer can work the studio for you: storyboard a script, change layouts, draw panels, letter, check and export pages, and plan and run anime shots. It drives the running app through the same routes the screens use, so you see every change on screen, paid jobs still show their price and wait for your yes, the monthly cap still holds, and nothing deletes saved work unless the call says so.

With Ibasho running, from the `ibasho-studio` folder:

```bash
claude mcp add ibasho -- node "$PWD/page-editor/mcp.mjs"   # Claude Code
codex mcp add ibasho -- node "$PWD/page-editor/mcp.mjs"    # Codex
gemini mcp add ibasho node "$PWD/page-editor/mcp.mjs"       # Gemini CLI
```

Apps that run in the cloud (the Gemini app, Meta's Muse) can only reach an MCP server on the internet, so they cannot connect to Ibasho on your computer yet.

Claude Code also finds it by itself when opened in the `ibasho-studio` folder (the repo's `.mcp.json`). Then ask in plain words, for example: "Storyboard chapter 3 from script.md, draw the missing panels and letter every page." If Ibasho runs on another port or computer, set `IBASHO_URL` (and `IBASHO_CODE`, the access code, for another computer).

---

## Settings

| Variable | What it does | Default |
| --- | --- | --- |
| `STUDIO_SAVED` | Where your saved work, uploads and exports go | `page-editor/saved/` |
| `STUDIO_SERIES` | Where books and their shared settings live | `page-editor/series/` |
| `STUDIO_DRAWERS` | How many pictures are drawn at the same time (1 to 4) | `2` |
| `STUDIO_STAGEFLOW` | StageFlow folder for the grey 3D animatic | — |

> **Testing?** Point `STUDIO_SAVED` at a scratch folder and use another port, so test runs never touch real work. Copy book chapters with `cp -rL`, because chapters link to their book's shared style and character bank.

---

## What's in the repo

```
page-editor/   the app: index.html, editor.js, render.js (drawing + lettering engine),
               server.mjs (local server + the picture queue), fonts/, styles/, templates.json (page layouts)
core/          script reader, storyboard checks, art prompts, the built-in styles
tools/         command-line helpers: book import, storyboards, picture placement
agents/        role files for the manga crew: paneler, artist, letterer, checker
anime/         the anime side: shot plans, checks, animatic player, export, its agents
tests/         automated tests (`node --test tests/*.test.mjs`)
```

Your own work lives in `page-editor/saved/`, `projects/`, `series/`, `anime-scenes/` and `anime-looks/`. These folders are listed in `.gitignore` and never committed.

---

## Known limits

- Only Codex is connected as a picture and writing source so far.
- Pictures take about 3 minutes each. How many a Codex subscription allows in a long run is still being measured.
- Codex sometimes ignores the requested picture size; the editor crops to fit.
- The anime side stops before video generation. Clips made elsewhere can be loaded into a scene.
- Not yet tested on Windows or macOS outside WSL / Linux.

---

## Model licences

Ibasho does not include any AI model. The models you connect or download (through a service, or from Hugging Face to run on your own or a rented computer) each have their own licence and terms, and **you are responsible for following them**.

Some open models need their maker's permission in certain countries; for example, MiniMax H3 needs MiniMax's permission in the United States, the EU, the UK and South Korea. Ibasho never blocks these: it shows a notice with a link to apply, and once you have permission you switch on "I have permission". Switching it on means you confirm you have that permission. Ibasho does not check it, and keeps your confirmation (with its date and time) only on your own computer.

---

## License

Ibasho is free software under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)). You can use, change and share it. If you change it and let other people use your version, including over a network as a hosted service, you must share your changed source code under the same licence.

The fonts and StageFlow keep their own licences (below).

---

## Credits

- Lettering fonts: Bangers, Comic Neue, Kalam, Patrick Hand, Playpen Sans and Vollkorn; for Japanese, Zen Antique Soft, Dela Gothic One, Zen Kaku Gothic New and Zen Maru Gothic. All under the SIL Open Font License (licence files in `page-editor/fonts/`).
- Grey 3D animatics: [StageFlow](https://github.com/taruma/stageflow) (MIT).
