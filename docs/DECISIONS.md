# Decision Log

Newest at the top. Each entry: what we decided, and *why*. Mark open questions clearly so a
future session knows what's still up for grabs.

Format: `YYYY-MM-DD — [DECIDED|PROPOSED|OPEN] Title` then a short rationale.

---

## 2026-07-12 — [DECIDED] Queued-tree highlight via a custom WebGL PostFX outline pipeline (plan 006)

Replaced the tile-sized stroked-rectangle marker on queued harvest targets with a **crisp silhouette
outline** drawn by a custom WebGL PostFX pipeline (`src/render/OutlinePipeline.ts`, key `OutlineFX`).
Why a shader, not a GameObject: an alpha-edge outline *hugs the sprite's actual shape* (a box can't),
stays crisp under the fractional zoom (authored in render-target texels, `uThickness = 1.5`, verified
by eye at 200%), and the pipeline is **reusable by any Image/Sprite** — enemies/companions can opt in
later without new marker plumbing. The **head-of-queue** tree (first alive `harvest` in queue order)
**pulses**; the rest hold a static outline — the pulse *is* the "this one's next" signal. Registered
once in `BootScene` (registry outlives GameScene death-restarts). **Graceful degradation:** it's
WebGL-only, so `registerOutlinePipeline` no-ops on Canvas and `refreshQueueHighlights` keeps the old
stroke-rect marker for that path. **Smoke coupling:** trees are outlined via the pipeline now, so the
smoke asserts through `debugState().outlinedTreeIds`/`pulsingTreeId` instead of the marker rect, and
its zero-console-error gate doubles as the shader-compile check. Pattern + a "when to reach for a
shader" heuristic live in `docs/RENDERING.md`.

## 2026-07-12 — [DECIDED] Toward isolated test setups, not one live-game end-to-end smoke

The headless smoke drives the whole running game start-to-finish. That's already fragile and won't
scale as content grows — one linear playthrough can't cover every action/animation/interaction. Case
in point: the Punch step relied on a real-time movepad walk landing the player exactly one tile from a
chasing zombie; it flaked ~50% (the player walked *through* the collisionless zombie and co-located,
so Punch's single facing-adjacent tile was empty). Reworked to *aggro-then-settle* (walk only until
the zombie aggros, hold still, let it stop one tile below, then punch) — stable, but still indirect.
Direction: prefer **isolated, deterministic scenarios** — place the player + entities on known tiles,
set facing, trigger the one action under test, assert the result — over navigating there through live
play. The end-to-end smoke stays as a broad boot/core-loop sanity check; specific behaviours get their
own focused setups. **[OPEN]** harness shape: a debug scenario API on GameScene vs a dedicated test
scene vs a query-param scenario loader — to be specced.

## 2026-07-12 — [DECIDED] Workers chop/build from a resource's base tile, facing the target

Harvest prefers a *base* stand tile (the trunk row + the row below — `TREE_BASE_STAND_OFFSETS`; never
the canopy tiles directly above), falling back to any reachable adjacent tile if the base is walled
off. While working in place the worker turns to face the target (`faceTile`), so the chop/build swing
points at the tree/blueprint regardless of approach direction or a stale facing. Fixes: (a) chopping
from a canopy tile ~2 squares above the trunk, and (b) chopping while facing away when already stood
next to the tree. `reachableAdjacent` gained an optional candidate-offsets arg for (a). Rationale: a
tall sprite (2.6-tile pine) overhangs upward but only blocks its trunk tile, so "any adjacent" read
wrong — the base is where you'd actually chop. (Answers "do interactables need a target coordinate?":
yes, in effect — encode where the worker stands + which way it faces, per resource.)

## 2026-07-12 — [DECIDED] Player action swings: chop = Slice, punch = Crush (reskinnable stand-ins)

The player now plays directional action animations: **chop** = Pixel Crawler `Slice_Base` (loops
while felling in place), **punch** = `Crush_Base` (one-shot per Punch press). Wired as two extra
`PlayerState`s (`chop`/`punch`) alongside `idle`/`walk`, sharing the same `playerAnimKey`/render
footprint; action swings run at `ACTION_ANIM_FRAMERATE` (20 fps ⇒ ≈ one chop per `CHOP_INTERVAL_MS`).
A one-shot punch owns the sprite via a `punchLockUntil` time-gate in `updatePlayerAnim`; the swing
fires on every press (even a whiff) so input always feels heard. Rationale: the Body_A rig ships no
literal chop/punch strip, so Slice (axe-like side swing) and Crush (overhead smash) are the closest
melee motions — consistent with the plan-005 "fantasy mobs/actions as reskinnable stand-ins" stance.
The Skeleton mob has no attack strip (Idle/Run/Death only), so the enemy side of "fighting" is still
just contact damage with no dedicated attack pose — a future add.

## 2026-07-12 — [DECIDED] Ground baked into one RenderTexture (fixes fractional-zoom tile seams)

`drawGround()` bakes all ground tiles into a single `RenderTexture` instead of ~900 separate
`add.image` tiles. Symptom it fixes: at fractional camera zoom (notably 150%) thin dark vertical
seams crawled across the grass while scrolling horizontally. Cause: individually-placed frames of a
shared spritesheet **bleed** at non-integer scale — a 16px source tile drawn at 24px samples just
past its atlas cell and picks up a neighbouring (dark) frame. At 100%/200% (integer scale) the
sampling lands cleanly, so it only showed at 150%. Baked side-by-side at integer 1:1, each tile's
neighbour is the real adjacent grass (no cross-frame bleed) and it's one object (no inter-tile gaps);
the camera then nearest-samples one opaque texture. Rationale: robust at any zoom, and collapses ~900
draw objects to one. (Alternative — extruding tile edges — is more work for the same result here.)

## 2026-07-12 — [DECIDED] Swap active art to Pixel Crawler; zombie pack retired (plan 005)

Committed the swap proposed below: `ACTIVE_TILESET` now points to `PIXEL_CRAWLER_TILESET`
(`src/data/tileset.ts`). The old `ZOMBIE_APOCALYPSE_TILESET` const is removed (git history +
[docs/ASSETS.md](ASSETS.md#zombie-apocalypse-tileset--retired-reference-fallback-2026-07-11) retain
the record); its files stay under `public/assets/` as retired reference/fallback art, not deleted.
Manifest reshaped to a role-based schema (`TileSource` union — `image`/`sheetFrame` — plus
`StripAnim`/`ActorRender`), replacing the old approach, since the new schema is strip-only.

**Skeleton (Base)** mob is the sprite stand-in for the kid zombie — enemy data id `kidZombie` /
`name: 'Kid Zombie'` unchanged, only the sprite changed, consistent with the "reskinnable
stand-ins" call below.

Added **3-way directional facing for the player** (Down/Side/Up idle+walk strips; Side art faces
right, `flipX` mirrors left, driven by `lastFacing`). The **enemy stays single-orientation** (Run
strip only, frame 0 = idle, flips by movement-x) — mob sheets in this pack ship no directional
variants.

**Escape hatch (deferred, not done):** the zombie pack doesn't need to stay runnable (Matt's call
mid-plan), but could be made to fit the new strip-only schema by montaging its per-frame PNGs into
horizontal strips.

**Deferred primitive:** the new `sheetFrame` `TileSource` (a single fixed frame per tile) is also
the right shape for future adjacency-mask → frame **autotiling** — intentionally left as a
door-opener; only single fill frames are wired today (grass weighted-random, wall single fill).

Supersedes the [PROPOSED] entry directly below (Pixel Crawler is now committed/wired, not just the
leading candidate). Full narrative:
[docs/ASSETS.md](ASSETS.md#active-tileset--pixel-crawler-wired-in-plan-005).

## 2026-07-11 — [OPEN] Want a map editor; Pixel Crawler autotiler + demo polish gaps

Matt's steer after reviewing the autotiled demos: they're good enough for evaluation, but the real
need going forward is a **map editor so he can build/edit maps himself** rather than tuning a Python
compositor — that's the next tooling to plan (in-browser tile painter over the same
`Floors`/`Wall`/blob data the offline autotiler already understands;
[`scripts/pixel-crawler/autotile.py`](../scripts/pixel-crawler/autotile.py)'s 8-neighbour key logic is
the thing to port into the engine).

Known demo/autotiler polish gaps (deferred, not blocking the art decision):

- **`demo3_ruins` dirt corners** — the walled-enclosure floor still shows missing/!clean corner tiles.
- **Dirt has no surface texture** — the dirt fill reads flat; wants variation like the grass has.
- **Grass variation is too uniformly random** — the 6-fill random scatter looks noisy/even rather than
  naturally clustered; needs weighting/patchiness, not a flat random pick.

## 2026-07-11 — [PROPOSED] Adopt Pixel Crawler as the base art (re-theme to fantasy), darken later

Evaluated **Pixel Crawler — Free Pack v2.11** (Anokolisa) and made it the **leading replacement** for
the Zombie Apocalypse pack: better art quality and a style we prefer. Accepted trade-off — it's
**medieval-fantasy** (knights/orcs/skeletons/anvils/bonfires), not zombie/modern. Matt's call: keep
this art despite it **not being grim-dark enough yet**, and darken it *later* via grimmer
tiles/props/recolours + a lighting pass (proven viable by `demo2_camp_night.png`). So this swaps the
*art* and treats fantasy mobs as reskinnable stand-ins — **not** a story change, and **not yet wired
into `src/data/tileset.ts`** (evaluation only; still PROPOSED). If it pans out, buy more of Anokolisa's
paid packs (same grid/conventions). Full index + demos: pack
[`README.md`](../public/assets/tilesets/pixel-crawler/README.md) and
[`docs/ASSETS.md`](ASSETS.md#leading-replacement--pixel-crawler-2026-07-11). Zombie pack stays the
wired-in default until this is committed.

## 2026-07-11 — [DECIDED] Shared stats via typed adapters, not a class hierarchy

`InspectableStats` (the Inspect-mode panel's shape) is produced by small pure adapter functions
(`treeStats`/`wallStats`/`zombieStats`/`playerCombatStats` in `systems/stats.ts`) that read from
each runtime type's existing fields, rather than a shared base class or interface all entities
must implement. Rationale: trees/walls/zombies/the player already have different runtime shapes
(`TreeNode`/`BuildSite`/`ZombieUnit`/scene fields) built by different systems; forcing a common
class hierarchy across them would ripple through code that has nothing to do with inspection, for
a UI concern that only needs a read-only view.

## 2026-07-11 — [DECIDED] Object inspection scope: trees + walls only, no new placeholder entity

Inspect mode (plan 003) covers trees, walls, zombies, and the player — no new crate/box entity was
added just to have a third kind of inspectable object. Rationale: nothing in the game creates such
an entity yet; adding one purely for the inspector would be speculative scaffolding.

## 2026-07-11 — [DECIDED] Tap-on-entity resolution: a dedicated Inspect mode, not tap/long-press overload

Viewing an entity's stats is a distinct HUD-toggled mode (tap anything while in Inspect mode), not
an overload of Command mode's existing tap (act now) / long-press (queue) semantics. Rationale:
Command-mode tap behaviour needed to stay exactly as-is (trees/build-sites/move), and overloading a
third meaning onto the same gesture would make it ambiguous which one fires.

## 2026-07-11 — [DECIDED] Three mutually-exclusive input modes: Command / Combat / Inspect

One HUD toggle pair switches between **Command** (default tap-to-pathfind, unchanged), **Combat**
(virtual movepad + Punch button, direct real-time control, bypasses the pathfinder/task queue), and
**Inspect** (tap anything for a stats panel, issues no commands). Only one non-Command mode is
active at a time; toggling one on flips the other off. Rationale: Combat's direct real-time control
and Command's tap-to-pathfind are fundamentally different input schemes that shouldn't both be live
at once — letting both interpret the same tap would fight over the player's movement.

## 2026-07-11 — [DECIDED] Direct tweaks auto-push on green; review gates stay on the plan loop only

For small changes Matt requests directly (tweaks/fixes/debug helpers, not plan steps): implement →
verify green (`npm run build` + `npm run smoke` where relevant) → commit → push to `master` without
stopping to ask. The stop-for-review checkpoints below apply to `plan-feature`/`critique-plan`/
`execute-plan` work, **not** to these one-off tweaks. Pause only if it's not green, ambiguous/
hard-to-reverse, or actually plan-scale. Rationale: ends the commit-then-ask friction on small live-test
iterations while keeping human review where it matters (the plan loop). Detail in WORKFLOW.md.

## 2026-07-11 — [DECIDED] Stop for Matt's review at plan / critique / each step (no unattended sweep)

The plan→critique→execute loop must **pause for Matt's input** at three gates: after a plan is written
(before critique), after the critique (before executing), and at the end of **every** executed step (per
the `execute-plan` skill's check-ins). Do not run the whole loop autonomously, even when told to "build
it" — that authorises the work, not skipping review. Rationale: Matt wants to review/steer before code
lands; a fully autonomous sweep robbed him of that. Detail in WORKFLOW.md → Review checkpoints.

## 2026-07-11 — [DECIDED] Genre & platform: browser pixel-art survival base-builder

Single-player, runs in the browser, no server. Themed around Mostowo (camping destination).
Rationale: fun personal project; browser = zero-install, shareable by link; no backend keeps
it cheap and simple to host and reason about.

## 2026-07-11 — [DECIDED] Engine: Phaser 3

User's pick. Mature, huge tutorial/ecosystem base, first-class 2D + pixel-art support
(`pixelArt: true`, nearest-neighbour scaling), scene system suits a game with menus + world + UI.

## 2026-07-11 — [DECIDED] Build workflow: Hermes plan → critique → execute skills

Use the `hermes-ai-tooling` dev skills for every non-trivial feature so work is structured and
resumable across devices. See docs/WORKFLOW.md.

## 2026-07-11 — [DECIDED] Record-everything-in-repo rule

All reusable decisions/preferences/workflows are committed to the repo, never left only in chat,
because sessions hop between devices. This log is part of that.

## 2026-07-11 — [DECIDED] Trunk-based solo workflow: commit each stage, push to `master`, auto-deploy

Solo project — no feature branches, no PRs. Work on `master`; commit each completed stage and push
straight to `master`. Every push to `master` triggers the GitHub Pages Action to build + deploy, so
"ship" = `git push`. Rationale: minimises ceremony for a one-person project and gives a live URL that
always reflects trunk. (Set `master` as the GitHub default branch in Settings — one-time.)

## 2026-07-11 — [DECIDED] Language: TypeScript; Build tool: Vite

A survival/crafting game grows complex fast; types pay off in inventory/recipe/save code and make
cold-resuming on another device far easier. Vite gives instant HMR and a trivial static `dist/`
build that drops straight onto a static host.

## 2026-07-11 — [DECIDED] Hosting: GitHub Pages via GitHub Actions

Push to the deploy branch → Action runs `vite build` → publishes. Deploy config lives in-repo (no
external accounts), which fits the cross-device rule. itch.io kept in mind as an optional *second*
distribution target later for reaching players.

## 2026-07-11 — [DECIDED] Art pipeline: programmatic placeholders first

Start with generated/coloured-rect placeholder art so we can build and feel the mechanics quickly
(ideal for on-the-go sessions), then swap in real pixel art (free CC0 tileset and/or hand-drawn)
once the slice is fun. Keeps art off the critical path.

## 2026-07-11 — [DECIDED] Premise & core loop: zombie apocalypse at Mostowo, day/night cycle

Camping at Mostowo when a zombie apocalypse hits (intro short story). Four pillars: base building,
survival, crafting, base defense. **Day** = scavenge camp/forest/surroundings for resources;
**base phase** = fortify (walls/traps), craft, unlock crafting stations; **night** = zombie animals,
humans, creatures come through the map. **Enemies are roaming (don't attack unless aggro'd) or
attacking** — this deliberately punishes staying out at night and makes "get home and defend" the
correct play. Full detail in GAME-DESIGN.md. Rationale: gives the day/night cycle real risk/reward
teeth and a clear emotional arc each cycle.

## 2026-07-11 — [DECIDED] Mobile-first, portrait, touch — scales to larger screens

Primary target is playing on a phone (portrait, touch). Must scale to any screen size (fit/letterbox
on desktop now; richer big-screen framing later). Scaffold: Phaser `Scale.FIT` from a fixed portrait
base resolution, `pixelArt: true`, touch as the baseline input. Rationale: Matt plays on his phone;
designing mobile-first avoids a painful retrofit.

## 2026-07-11 — [DECIDED] Multi-map world: bolt-on areas + fast-travel special maps

World is many discrete maps, not one continuous map. Start map = camp + surroundings; adjacent areas
unlock as new bolt-on maps; special maps reached via fast travel once **car (repaired)** or **boat
(built)** is unlocked. Build a **data-driven map registry** with connections + unlock gates, persisted
in the save — don't hard-wire one world. Rationale: cheap content expansion and a clear progression/
exploration hook; decided early because it shapes the scene/loading architecture.

## 2026-07-11 — [DECIDED] Map is based on the real Mostowo site

The playable map traces a Google Maps screenshot of the actual camping spot; people, stories, and
landmarks of the place theme the content (LORE.md). Rationale: site-specific identity is what makes
this ours, not a generic zombie game.

## 2026-07-11 — [DECIDED] Art identity: dark & grotty, but humorous

Grimy survival-horror palette with comic items/enemies/visual gags. Rationale: distinctive tone,
and humour keeps a grim premise fun.

## 2026-07-11 — [DECIDED] Asset pipeline: free CC0 tilesets + Gemini "Nano Banana" (via guppi)

Start with CC0 tilesets (Kenney first) for a coherent base; generate bespoke on-theme items/enemies
with `gemini-2.5-flash-image` mirroring `guppi/house-helper/catalog_icons.py`. Key lives on the home
server (`GEMINI_API_KEY`, gitignored, LAN-only) so generation runs from a guppi-reachable machine and
processed sprites get committed. Detail in ASSETS.md.

---

## Open questions

- **[OPEN] Skill loading across devices:** install the `hermes-dev` plugin via the `hermes-skills`
  marketplace vs vendoring skills into `.claude/skills/`. (Tracked in WORKFLOW.md.)
- **[OPEN] MVP vertical slice details:** exact mechanics/scope for the first playable — to be nailed
  down by a `plan-feature` plan. Draft slice is in GAME-DESIGN.md.
- **[OPEN] Plan the testing rework — TODO:** run `plan-feature` for isolated, deterministic test
  scenarios (place player + entities on known tiles, set facing, trigger one action, assert) to
  replace the fragile live-game end-to-end smoke. See the 2026-07-12 "isolated test setups" decision
  above; pick the harness shape (debug scenario API vs test scene vs query-param loader). The current
  smoke stays as a boot/core-loop sanity check until then.
