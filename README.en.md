# ⏳ Time Buyer (time-buyer)

English · [简体中文](./README.md)

> My time, my call. — Your lifespan is the currency.
> 我的时间，由我支配 —— 人生三万天

**An open-source life simulator.** You're born with 30,000 days — that's your only currency. Buy a relationship, a trip, a skill: everything has a price. Live a whole life in a real-time 15 minutes, and at the end your "life statement" tells you exactly where your days — your *life* — actually went, and whether it was worth it.

## Quick start

Requires Node.js 18+ (check with `node -v`; npm ships with Node, no separate install).

```bash
git clone https://github.com/TThoney512/time-buyer.git
cd time-buyer
npm install
npm run dev
# the terminal prints a URL (usually http://localhost:5173) — open it in your browser
# you're buying your third thing within 5 minutes
```

No git? Click **Code → Download ZIP** on the repo page, unzip, then start from `npm install`.
Prefer a frozen archive? Grab `Source code (zip)` from the [**Releases page**](https://github.com/TThoney512/time-buyer/releases).

> `npm install` pulls in exactly one dev server (Vite) — **the game itself has zero dependencies** (pure ES Modules, no build step). It can be served by any static file server.

**Closed the browser? Lost the tab?** Just `cd` back into the project and run `npm run dev` again, then revisit the printed URL. Cross-run data (achievements, rebirth points, your life list, language, BYOK config) lives in browser `localStorage` and survives — but **a round in progress is not saved**: closing the tab ends that 15-minute life (your next life starts from the welcome screen). On purpose: quitting mid-life is itself an ending 🙂 Clearing browser data or switching browsers starts you from zero. Tired of the terminal? `npm run build` outputs `dist/` — drop it on any static host (GitHub Pages, etc.) and you have a permanent URL.

> Heads-up: **the in-game interface is bilingual (EN/中文), but the 160 items, events and buffs are currently Chinese-only text.** UI chrome, HUD, modals and the milestone dialogues switch with your browser language. See [About language](#about-language-en--中文) for why, and how to contribute a content pack.

<p align="center">
  <img src="docs/screenshots/01-home.png" width="23%" alt="Home: rebirth / echo of past lives" />
  <img src="docs/screenshots/02-shop-ai-roast.png" width="23%" alt="Shop: AI roasts you for slacking" />
  <img src="docs/screenshots/04-budget-modal.png" width="23%" alt="Budget exhausted: two exits" />
  <img src="docs/screenshots/05-settlement.png" width="23%" alt="Settlement: life statement & epitaph" />
</p>

## Gameplay

- 🧠 **8 life categories × 160 items**: cognition / experience / career / family / social / health / fun / lifestyle, four rarity tiers (common → legendary) that unlock as you go.
- ⏱️ **Two clocks**: your days drain on their own, *and* real-time 15 minutes ends the run — spending and living both burn your life.
- 🛤️ **3 crossroads**: hit 1,500 / 8,000 / 15,000 days spent and you must choose — double down on strengths or patch weaknesses? Each choice reshapes the whole run's pricing.
- 🎲 **10 birth buffs + random events + fate encounters**: every run is a different opening.
- 🏅 **Epitaph settlement**: a 4-layer comment engine (insight / reflection / contrast / one-liner) + 8 hidden easter eggs write one sentence about "this life", based on your spending structure.
- 🗣️ **Someone talks to you before every choice** (v0.3): your Father, an Old Friend, your Mirror self — see below.
- 🔁 **Rebirth & the Life List**: finish a run, earn Rebirth Points (RP), and collect 160 lives across runs — "some habits, you can't break even dead."
- 📜 **Life replay export**: one tap on the settlement screen turns your run into a Markdown timeline — download it or copy it straight into chat.

## What this project proves

One codebase of **pure Canvas, zero-framework** game logic (native ES Modules), running on two platforms through a single `platform-web.js` adapter:

| Platform | Entry | Status |
|---|---|---|
| Douyin mini-game | `game.js` (official `tt.*` API) |  preparing for release |
| Browser | `src/web-main.js` (this shim) | ✅ playable right now |

Every platform call in the game (cloud, ads, friend leaderboard, share) was written with a fallback — in the browser they degrade to **offline mode** automatically: local template comments, daily free revive, PNG-download sharing. **Remove the platform and the game gets more complete, not less.**

```
src/
├─ platform-web.js   # ← the only "new code": browser tt-shim (~190 lines)
├─ i18n.js / dialogue.js / llm.js   # ← bilingual shell, milestone dialogue, BYOK
├─ logic.js / db.js / settlement.js / lifetime.js / state.js / ui.js
│                    # ← reused verbatim from the Douyin build (~9,500 lines)
```

## Roadmap

- [x] v0.1 Playable in the browser (offline mode)
- [x] v0.2 **BYOK — bring your own LLM**: OpenAI / Claude / Gemini / DeepSeek / Ollama compatible; your model writes your epitaph
- [x] v0.3 **Milestone AI dialogue + bilingual shell (EN/中文)**: before each of the three crossroads, someone speaks to you first
- [x] v0.4 **Life replay export (Markdown)** — one tap on the settlement screen turns your whole life into a shareable timeline (file download + clipboard) — **archived as [`v0.4.0`](https://github.com/TThoney512/time-buyer/releases)**
- [ ] v0.5 → v1.0 — see [**`docs/ROADMAP.md`**](./docs/ROADMAP.md)

> **From v0.5 onward we ship in order**: narrative threads + resonance → derived age & life stages → time visualization → world packs → code-only director.
> The ranking rationale is in [`docs/AI导演系统-评估与优化.md`](./docs/AI导演系统-评估与优化.md).

> Backlog (unscheduled, uncommitted — community contributions welcome): Seed sharing (reproducible runs), Prompt Pack (content localization).

## Three voices at the crossroads (v0.3)

Life has three decision points (1,500 / 8,000 / 15,000 days spent). Before each one, *someone* talks to you first:

- **First · your Father** — taciturn; every word lands.
- **Second · an Old Friend** — jokes around, but reads you.
- **Third · your Mirror self** — calm, and not polite.

With BYOK configured, lines are generated live by **your** model from *this run's* spending structure. If the AI call fails or times out, hand-written local lines are used silently — **the dialogue always happens; AI only makes it know you better**. Local lines are bilingual too and follow the UI language.

After each choice, it gets distilled into a one-line **life creed** (deterministic local templates without BYOK; AI-named with it) — it shows up in your life replay and feeds the epitaph prompt: **the AI remembers what you said**.

## Connect your model (BYOK)

By default the epitaph is written by the local 4-layer template engine — **no key, no network; that's the offline default**. Connect your own LLM and the sentence about "this life" is written by your model — plus the AI will: distill each crossroads choice into a one-line **life creed** (feeding your replay and the epitaph prompt), retell encounters and adventures through the lens of *this* run, pile on a snarky one-liner when you slack off, and whisper an **echo of your past lives** at rebirth. **Every one of these has a local fallback — AI is seasoning, never the meal.**

**Where**: in-game, bottom-right "🧭 Open Source" → "🔑 Connect your model (BYOK)".

Three fields, with one-click presets:

| Preset | Base URL | Notes |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | recommended; browser-CORS friendly (V4 models default to "deep thinking" — this repo auto-sends `thinking:{type:"disabled"}`, otherwise the reasoning trace eats the output budget and returns HTTP 200 with empty content) |
| Ollama | `http://localhost:11434/v1` | fully local — not even a key needed |
| OpenAI | `https://api.openai.com/v1` | direct browser calls are usually CORS-blocked; use a reverse proxy or Ollama |
| Custom | any OpenAI-compatible endpoint | Claude / Gemini via one-api-style gateways work too |

**Four promises, enforced in code rather than in this README**:

1. **The key lives only in your browser's localStorage** — no middle server, no telemetry.
2. **Requests go straight from your browser to your provider** — this repo proxies nothing.
3. **Failures degrade silently** — 25s timeout, HTTP errors, missing config all fall back to the local engine; the game never hangs on AI.
4. **You cap the spend** — set a token budget in the BYOK panel (cumulative across runs). When it runs out there's no silent downgrade and no upsell nudge: the settlement screen offers two exits — "add more" or "switch to templates". Your call.

Want to verify? All AI code lives in `src/llm.js` (~600 lines, budget gate + BYOK panel included). Audit it.

## On ads

The Douyin edition has rewarded video ads (revive / pouch refresh) — that's the platform's business model. **The open-source edition has zero ad code.** Revive is one free per day; pouch refresh is one free per run. The smoke test runs a regex over the whole project and fails loudly if any `createRewardedVideoAd` string ever reappears. Even the footprints of a business model deserve to be pinned to the floor by tests.

## About language (EN / 中文)

- **The UI shell is bilingual**: buttons, modals, HUD, settlement frame, category names, milestone dialogue lines. First launch follows `navigator.language`; afterwards flip anytime with the "🌐 EN / 🌐 中文" button in the home top bar (persisted to localStorage).
- **Content (160 items, events, buffs, epitaph templates) is Chinese-only for now.** The shell is engineering; the content is ~800 strings, many of them Chinese internet jokes (e.g. "the blessed privilege of 996") that die in literal translation. That layer is meant to ship as a **community-localized Prompt Pack / content pack**, not my machine translations. With BYOK connected, the AI-generated epitaph and dialogues already follow your UI language.
- Want to own a content pack? Open an issue — the repo will keep a directory warm for you.

## Local development

```bash
npm install
npm run dev        # Vite dev server
npm run build      # outputs dist/ (GitHub Pages-ready)
npm test           # smoke tests (Node mocks the Douyin API — no browser needed)
```

## License

MIT — use it, fork it, change it. A credit back is nice, not required.
