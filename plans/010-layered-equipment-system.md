# Layered Equipment System + Anchor-Stamp Tooling

> Status: planned, but **gate 2 open** — a fresh-eyes critique flagged a High sequencing question
> (see `## Critique`). Do NOT run /execute-plan until Matt resolves finding #1 (equipment vs. the
> survival slice). Code anchors re-verified against current tree on the plan-feature rerun.
>
> **Partially superseded by plan 011 (2026-07-12):** monster weapons shipped via **runtime
> anchor-pinning** (`AttachPoint` + `weaponTransform` — see docs/DECISIONS.md), piloting this plan's
> own critique finding #3. That **supersedes Step 4's anchor-stamp tool and the rigid-slot baked
> strips** (helmet/mainHand/offHand below) — do not resume building the stamp tool. This plan now
> stays live **only** for the **deformable `chest`/`legs` slots** (route 2 matching-pack strips or
> hand-drawn art — the one thing pinning can't do) and the layering spine (Steps 1–3); both remain
> deferred pending finding #1. `AttachPoint`/`weaponTransform` are shared primitives — a future rigid
> slot adopts pinning as a refactor of them, not a rewrite.

## Critique

Fresh-eyes review (independent sub-agent, source-only) run on the plan-feature rerun.

**Verdict:** Well-researched and its code anchors check out, but it builds an equipment rendering +
bespoke authoring pipeline that **no gameplay consumes**, ahead of the project's stated next milestone
(day/night + hunger, already drafted as unexecuted plan 004) — so the top question is *why now*, not
*how*.

|#|Finding|Lens|Severity|Suggested action|
|-|-------|----|--------|----------------|
|1|Builds equipment rendering/authoring while the stated next milestone (day/night + hunger — plan 004 written but unexecuted) and the MVP slice's remaining items are unbuilt; the plan's own "Out of scope" confirms *no equip gameplay* consumes any of it|Roadmap / strategic fit|**High**|Defer to after the survival slice, or get an explicit steer from Matt that equipment jumps the queue before executing|
|2|Over-built for a pipeline with zero consumer: full 5-slot model + rotation-capable anchor tool + auto-seeding + previewer + docs, yet only one rigid slot is proven and the tool admittedly can't produce 2 of the 5 slots (deformable chest/legs)|Right-sizing / scope|Medium|If built at all, cut to schema + render spine + one hand-made slot; defer the stamp tool/seeder/previewer until a real custom piece is needed|
|3|Commits per-frame *derived PNG strips* via a bespoke tool when route 2 (packs) is the stated primary supply; the runtime already tracks the body via child sprites + setProgress, so anchors could pin a *single icon* at runtime instead of pre-stamping 26-frame strips|Alternative approaches|Medium|Consider runtime anchor-pinning of one icon (anchors stay data, no committed derived art) before committing to a stamp-and-bake tool|
|4|Whole-pipeline acceptance (Step 6) is a manual screenshot eyeball, but Steps 4/5/7 are `[delegate sonnet]`; a delegated agent cannot self-verify per-frame alignment — the crucial gate depends on a human|Executability & sequencing|Medium|Lean on the per-step review gate; make Step 5's "wrong anchor is visibly off" the machine-checkable proxy and state Step 6 needs Matt's eye|
|5|The Python previewer partly re-implements `compose.py`'s `preview()` grid helper (plan already hedges "or a sibling compose_equip.py")|Cross-cutting consistency|Low|Reuse `compose.py`/`objects.py` helpers rather than a parallel compositor path|

**#1 detail:** README, CLAUDE.md ("Next: survival systems"), and GAME-DESIGN's MVP item 4 all point at
day/night + hunger next, and `plans/004-day-night-hunger-survival.md` is already written and unexecuted
(alongside queued 008/009). Equipment appears nowhere in the MVP slice; this plan scopes out equip
gameplay/stat-effects/inventory, so its only in-game artifact is one statically-wired piece that does
nothing. Not a "how" defect (seams clean, anchors accurate, invariant sound) — a sequencing one. Start
here: resolve #1 (go/no-go on timing). If deferred, the rest are moot; if greenlit anyway, apply #2/#3
to cut scope to schema + render spine + one slot and drop the tool until a custom piece exists.

## Summary

Give the naked **Body_A** player character equippable **helmet · chest armour · leggings · main-hand
weapon · off-hand item/shield** by rendering each as its own sprite **layer** stacked on the body and
animated **frame-for-frame in lockstep** with it (the "paper-doll" technique). This lands in two
halves:

1. **The layering spine (built regardless of art source):** extend the `TilesetManifest` player actor
   with an optional 5-slot `equipment` map (each slot = a full idle/walk/chop/punch × down/side/up
   strip set, authored on the **same 64px canvas** as the body); load those strips in `PreloadScene`;
   render them in `GameScene` as child sprites that copy the body's transform + play the matching
   anim key each tick, so they stay pixel-aligned and in-sync. Plus a Python **previewer** that
   flattens body + layer strips into a preview sheet / GIF so alignment is eyeballable without
   launching the game.
2. **The anchor-stamp tool (route 1 — for custom pieces):** a Python tool that turns a **single
   static icon** (a helmet/weapon/shield cropped from the pack, or a bespoke one) into a per-frame
   equipment strip, by stamping the icon onto every body frame at a defined **anchor (position +
   rotation)**. Anchors are a property of the **body rig** (authored once per slot, reused for every
   icon), auto-seeded from the body silhouette and overridable per-frame.

Both halves converge on the **same artifact** — a per-frame equipment strip aligned to Body_A — so
"buy a matching pack" (route 2, the primary long-term supply) and "stamp a custom icon" (route 1)
are interchangeable inputs to the same manifest slot. Proven end-to-end this plan by stamping one
real pack helmet onto the walk cycle and rendering it in-game. Verified by `npm run build` +
`npm run smoke` + a manual screenshot eyeball (smoke cannot validate per-frame layer alignment).

## Context & decisions

**Locked with Matt (do NOT re-litigate):**
- **Layering, not full-sprite-swap or hand-pinned children.** True paper-doll layers, so gear is
  mix-and-match.
- **Two supply routes, both supported, converging on one artifact.** Primary = **matching-pack
  strips** (route 2 — buy Anokolisa's equipment packs later; they're pre-drawn per-frame on the same
  Body_A 64px grid, so they drop straight into a manifest slot with zero art work and are the only
  route that does genuinely *deformable* cloth/plate properly). **Also build the anchor-stamp tool**
  (route 1) because "there will always be times when I'll want to add something custom." The spine
  must accept either; the stamp tool must *produce* the same strip shape a pack ships.
- **5 equipment slots:** `helmet`, `chest` (armour), `legs` (leggings), `mainHand` (weapon),
  `offHand` (item/shield). This is the fixed slot model for the main character.
- **The stamp tool defines per-frame ROTATION as well as position** at each anchor — Matt's call. So
  an anchor is `{x, y, rot}`, not just a coordinate.

**Honest scope boundary on the stamp tool (state this in the plan, not a surprise later):** stamping
a *static* icon per frame gives a **rigid attach** — the icon translates/rotates to follow an anchor
but does **not deform**. That reads correctly for **helmet / mainHand / offHand** (and passably for a
stiff chestplate or a tabard that barely bends). It does **not** convincingly animate cloth/mail that
should flex with the torso/legs across the walk/swing. So: **route 1 (stamp) is the path for the
rigid slots**; **deformable `chest`/`legs` come from route 2 (matching-pack strips) or hand-drawn
per-frame art.** The manifest models all 5 slots identically (a slot doesn't care which route filled
it); the tool just isn't the right *producer* for the deformable two. Anchors are still defined for
all 5 slots (Matt asked for 5 coordinates) so a stiff chest/legs piece *can* be stamped if wanted.

**The core alignment invariant (why per-frame strips "just work"):** every equipment strip is
authored on the **identical 64px frame canvas** as the body, with the **same frame count per state**
(idle 4 · walk 6 · chop/Slice 8 · punch/Crush 8) and the **same directions** (down/side/up, side art
faces right). Rendered at the body's **exact `render` (scale 1, origin 0.5/0.78)** and playing the
**same-length anim at the same frameRate started on the same tick**, layer frame *N* overlays body
frame *N* pixel-perfectly. Keep this invariant and layering is trivial; break it (different canvas,
frame count, origin, or frameRate) and gear floats. Everything below serves this invariant.

**Schema decision — extend the existing role-based manifest (advisor shape to implement):**

```ts
// src/data/tileset.ts — additions (existing Facing/PlayerState/StripAnim/ActorRender unchanged)

/** The 5 fixed equipment attach points on the main character. */
export type EquipSlot = 'helmet' | 'chest' | 'legs' | 'mainHand' | 'offHand';

/**
 * One equipment layer: the SAME per-state directional strips as the body (so it animates
 * frame-for-frame in lockstep), plus a draw-order offset. `z` is added to the player's depth:
 * negative = behind body (e.g. a back-slung shield), positive = in front (e.g. a helmet, a
 * held weapon). Strips MUST match the body's frame counts + 64px canvas (the alignment invariant).
 */
export interface EquipLayer {
  z: number;
  idle: Record<Facing, StripAnim>;
  walk: Record<Facing, StripAnim>;
  chop: Record<Facing, StripAnim>;
  punch: Record<Facing, StripAnim>;
}

// On the player actor, alongside render/idle/walk/chop/punch:
//   equipment?: Partial<Record<EquipSlot, EquipLayer>>;
// Omitted / empty = today's naked character (no behaviour change). Populated per-slot as gear is
// authored. Draw order = sort equipped slots by `z` then a stable slot order.

/** Texture/anim key for an equipment layer strip, e.g. `equip-helmet-walk-side`. */
export const equipAnimKey = (slot: EquipSlot, state: PlayerState, facing: Facing): string =>
  `equip-${slot}-${state}-${facing}`;
```

- `equipment` is **optional and per-slot partial** so the manifest stays valid with zero gear (the
  current state) and grows one slot at a time — no big-bang art requirement.
- Reuses `StripAnim` / `Facing` / `PlayerState` verbatim, so the loader + anim-create loops
  generalise by iterating slots rather than gaining new shapes.

**Runtime layering decision — child sprites tracking the body (NOT a container):** keep `this.player`
as the physics sprite + camera target exactly as today (minimal blast radius — a container would
re-wire physics/`fitActorBody`/camera-follow). Maintain `this.playerLayers: Phaser.GameObjects.Sprite[]`
(one per equipped slot, depth = `player.depth + z`, same `scale`/`origin`, **no physics body**). Each
render tick, after the body's anim is chosen: copy `player.x/y` + `player.flipX` to every layer and
play the **same** `equipAnimKey(slot, state, facing)`. To guarantee zero drift regardless of when a
layer was added, sync the frame explicitly after playing —
`layer.anims.setProgress(this.player.anims.getProgress())` (or match `currentFrame.index`) — rather
than relying on shared start ticks alone. The one-shot **punch** is driven from the same handler that
plays the body punch, so layers start together.

**Anchor-stamp tool decision — anchors belong to the body rig, authored once, reused per icon:**
the laborious part of route 1 is *where does the head/hand sit in each of the 26 frames per direction
set*. That is a property of **Body_A**, not of any particular helmet — so it's captured **once** in a
committed **anchor file** and every icon for that slot reuses it. Shape:

```jsonc
// scripts/pixel-crawler/equip/anchors.body_a.json
{
  "body": "Body_A",
  "frameSize": 64,
  "slots": {
    "helmet": {
      "pivot": [16, 30],                 // the pixel IN THE ICON that lands on the anchor
      "strips": {
        "walk_side": {                   // one entry per state_facing that this slot appears in
          "default": { "x": 32, "y": 18, "rot": 0 },   // applied to every frame...
          "frames": { "2": { "y": 16, "rot": -3 }, "5": { "rot": 2 } }  // ...with per-frame overrides
        }
        // walk_down, walk_up, idle_*, chop_*, punch_* ...
      }
    }
    // chest, legs, mainHand, offHand ...
  }
}
```

- **Auto-seed** (`--seed <slot>`): analyse each body strip PNG and write a *candidate* `default`
  anchor per state_facing — for `helmet`, the **top-centre of the silhouette** per frame (topmost
  non-transparent run, centre-x); for `mainHand`/`offHand`, a hand heuristic (lower-side extremum) or
  a hand-placed constant to refine. Rotation seeds to 0. This turns anchoring from "author 300 numbers
  by hand" into "accept the seed, nudge the few frames that look off in the previewer."
- **Stamp** (`--stamp --icon <png> --slot <slot>`): for each `state_facing`, build a strip matching
  the body strip's dims; on each frame, paste the icon **rotated `rot`° about its `pivot`** so the
  pivot lands on `{x,y}` (default merged with per-frame override); transparent elsewhere. Write to
  `public/assets/tilesets/pixel-crawler/_derived/equipment/<slot>/<State>_<Facing>-Sheet.png`.
- **Preview** (`--preview --slot <slot> [--icon <png>]`): flatten body strip + the slot's stamped (or
  pack-supplied) strip into a side-by-side sheet **and** an animated GIF per state_facing, under
  `docs/assets/pixel-crawler/equipment-previews/`, for a fast alignment eyeball. Also works on a
  route-2 pack strip (no icon) to check a bought layer lines up before wiring it.

**Concrete Body_A rig facts (already gathered — use directly):**
- Player strips live under `Entities/Characters/Body_A/Animations/<State>_Base/<State>_<Dir>-Sheet.png`,
  all **64×64** frames. Frame counts: **Idle 4 · Walk 6 · Slice(chop) 8 · Crush(punch) 8**. Dirs
  Down/Side/Up; Side faces right (mirror `flipX` for left). Current mapping in `tileset.ts:100-122`.
- Player `render` = `{ scale: 1, originX: 0.5, originY: 0.78 }` (`tileset.ts:99`) — **layers must use
  the identical render.**
- Weapon **icons** to stamp from: `Weapons/{Wood,Bone,Hands}.png` are multi-object sheets (swords,
  axes, hammers, clubs, shields, spears). Extract a single icon via the existing
  `scripts/pixel-crawler/extract.py` (same pipeline as the tree) before stamping. There is **no
  ready-made helmet icon in the free pack** — for the end-to-end proof (Step 6), extract a plausible
  head-ish prop, OR hand-make a tiny 12–16px helmet PNG, OR stamp a `Weapons` shield into `offHand`
  (guaranteed available). Decide in Step 6; the tool is icon-agnostic.

**Codebase seams (current anchors — reconfirm before editing):**
- `src/data/tileset.ts` — schema + `PIXEL_CRAWLER_TILESET`. Player actor `:95-123` (`render` `:99`,
  strips `:100-122`). Helpers: `playerAnimKey` `:155`. **Add** `EquipSlot`/`EquipLayer`/optional
  `player.equipment`/`equipAnimKey`; keep everything else. Module doc `:1-13` — note equipment layers
  as new behaviour.
- `src/scenes/PreloadScene.ts` — `loadStrip(key, strip)` `:79-81` already generalises; the player
  loop `:84-86` iterates state×facing. **Add** an inner loop over `manifest.actors.player.equipment`
  entries calling `loadStrip(equipAnimKey(slot,state,facing), layer[state][facing])`.
- `src/scenes/GameScene.ts` — anim-create loop `:291-303` (build equip anims alongside player anims,
  same `generateFrameNumbers`/frameRate/repeat rules keyed by `equipAnimKey`; `ACTION_ANIM_FRAMERATE`
  is imported from `src/config.ts:26` and `=20`, locomotion default `10`); player create `:314-320`
  (spawn `playerLayers[]` after, same scale/origin, depth `+z`, no physics); the player anim driver
  `updatePlayerAnim` at `:485-491` (core `anims.play` at `:490`) and the swing player `playPunchSwing()`
  at `:495-501` (plays `playerAnimKey('punch',…)` at `:498`; note the separate `punch()` event handler
  lives at `:877-890`) — **both** the driver and the swing must also drive the layers (copy transform +
  flipX, play matching key, sync progress). `fitActorBody` `:319` stays body-only.
- **Blast radius = these 3 files + 2 new Python scripts + 1 anchor JSON + derived strips.** No system,
  test, or data-id change. `enemies.ts`/`buildables.ts`/`nodes.ts` untouched.

**Verification reality:** `npm run smoke` boots the real bundle over HTTP and catches load 404s /
boot exceptions (a missing/mis-keyed equip strip → console error or thrown), but — as with plan 005 —
it does **NOT** validate per-frame *alignment* (Phaser slicing mismatches surface as filtered
`console.warn`). So render acceptance = **smoke green + manual screenshot eyeball** (the layer sits on
the body through the walk cycle, doesn't float/detach, correct draw order, mirrors on left-facing).
The Python **previewer** is the cheaper first-line alignment check before ever building. Optionally add
`this.textures.exists(equipAnimKey(...))` guards in GameScene create.

## Steps

- [ ] **Step 1: Extend the manifest schema (spine, no art yet)** `[inline]`
  - In `src/data/tileset.ts`: add `EquipSlot`, `EquipLayer`, the optional
    `equipment?: Partial<Record<EquipSlot, EquipLayer>>` field on the player actor, and `equipAnimKey`
    (exact shapes in Context). Leave `PIXEL_CRAWLER_TILESET.actors.player.equipment` **absent** for now
    (naked character unchanged). Update the module doc to note equipment layers.
  - Side effects: none at runtime (optional field, unset). PreloadScene/GameScene still compile
    (they don't yet read the field).
  - Docs: module doc block only.
  - Done when: `tileset.ts` type-checks; `equipAnimKey('helmet','walk','side') === 'equip-helmet-walk-side'`;
    `ACTIVE_TILESET` unchanged in behaviour.

- [ ] **Step 2: Load equipment strips (PreloadScene)** `[inline]`
  - Extend the actor-load block (`PreloadScene.ts:82-87`) to iterate
    `manifest.actors.player.equipment ?? {}` and, for each `[slot, layer]`, load all
    state×facing strips via the existing `loadStrip(equipAnimKey(slot,state,facing), layer[state][facing])`.
    No-op while `equipment` is unset.
  - Side effects: consumes Step 1's schema; adds load calls only when gear is present.
  - Docs: none.
  - Done when: PreloadScene type-checks; with a stub equipment entry, every layer strip gets an
    `encodeURI`'d `load.spritesheet` call. (Runtime verify in Step 6.)

- [ ] **Step 3: Render + sync layers (GameScene)** `[inline]`
  - **Anim create** (`:291-303`): after the player loop, for each equipped slot build
    `equipAnimKey(slot,state,facing)` anims with the **same** `generateFrameNumbers`/frameRate
    (`ACTION_ANIM_FRAMERATE`=20 from `src/config.ts` for chop/punch, 10 otherwise)/repeat rules as the
    body, so timelines match.
  - **Create layers** (after `:320`): `this.playerLayers = equippedSlots.map(...)` — each an
    `add.sprite` at the player's spawn, `setScale(render.scale)`, `setOrigin(render.originX, originY)`,
    `setDepth(player.depth + z)`, **no physics body**. Store `{ slot, sprite, z }`.
  - **Drive layers**: in `updatePlayerAnim` (`:485-491`) and the swing player `playPunchSwing()`
    (`:495-501`), after the body picks `(state, facing)` and plays/flips, loop the layers: `sprite.setPosition(player.x,
    player.y)`, `sprite.setFlipX(player.flipX)`, `anims.play(equipAnimKey(slot,state,facing), true)`,
    then `anims.setProgress(this.player.anims.getProgress())` to lock frame-sync (punch: play without
    ignoreIfPlaying, same as body, so it restarts together).
  - Guard the whole thing on `equipment` being present so the naked character path is unchanged.
  - Side effects: adds `playerLayers` state; touches only the player render/anim path.
  - Docs: none (Step 7).
  - Done when: `npm run build` clean; with a stub layer, the code plays `equip-*` anims stacked on the
    body. (Visual verify Step 6.)

- [ ] **Step 4: Anchor-stamp tool — model, seed, stamp** `[delegate sonnet]`
  - Add `scripts/pixel-crawler/equip/anchors.py` + a CLI `scripts/pixel-crawler/equip_stamp.py`
    (sibling to `extract.py`, reuse `objects.py`/PIL where useful):
    - **anchor file** `scripts/pixel-crawler/equip/anchors.body_a.json` — the shape in Context
      (`pivot` per slot; per `state_facing`: a `default {x,y,rot}` + optional per-`frames` overrides).
    - `--seed <slot>` — analyse each Body_A strip and write candidate `default` anchors: `helmet` =
      top-centre of the silhouette per frame; `mainHand`/`offHand` = a hand heuristic or documented
      constant; `chest`/`legs` = torso/leg centroid. `rot` seeds 0. Writes/updates the JSON.
    - `--stamp --icon <png> --slot <slot> [--anchors <json>]` — for each `state_facing` in the slot,
      emit a strip matching the body strip's dims; per frame paste the icon **rotated `rot`° about its
      `pivot`** so the pivot lands on `{x,y}` (default⊕override); transparent elsewhere. Out →
      `public/assets/tilesets/pixel-crawler/_derived/equipment/<slot>/<State>_<Facing>-Sheet.png`.
    - Expose `--gap`/`--alpha-thresh` passthroughs where relevant; nearest-neighbour only (no
      resampling blur).
  - Side effects: new scripts + one JSON; writes only under `_derived/equipment/` (pack-safe, like the
    tree). No pack files renamed.
  - Docs: Step 7 owns the ASSETS.md pipeline section; this step just needs `--help`-level usage in the
    script docstrings.
  - Done when: `--seed helmet` writes plausible per-frame anchors; `--stamp` on any test icon produces
    correctly-sized `_derived/equipment/helmet/Walk_Side-Sheet.png` etc. (frame count + 64px verified via
    `sips`/PIL), icon visible on each frame near the seeded anchor.

- [ ] **Step 5: Previewer (alignment eyeball without the game)** `[delegate sonnet]`
  - Add `--preview --slot <slot> [--icon <png>]` to `equip_stamp.py` (or a sibling `compose_equip.py`,
    matching `compose.py` style): flatten body strip + the slot's stamped **or** pack-supplied strip
    into (a) a side-by-side static sheet and (b) an animated GIF per `state_facing`, written under
    `docs/assets/pixel-crawler/equipment-previews/`. Runs on a route-2 pack strip too (skip `--icon`)
    to vet a bought layer before wiring.
  - Side effects: writes preview art under `docs/assets/` only.
  - Docs: none (Step 7 links these).
  - Done when: preview GIF/sheet renders body+layer composited; a deliberately-wrong anchor is visibly
    off in the preview (proving it's a real alignment check).

- [ ] **Step 6: Prove end-to-end — one real slot in-game** `[inline]`
  - Pick the proof slot/icon (Context lists options; **`offHand` shield from `Weapons/*` is the safe
    default** since it's guaranteed in-pack — or a hand-made helmet if preferred). Extract the icon via
    `extract.py`; `--seed` + hand-tune its anchors in the JSON using the Step-5 previewer; `--stamp`
    the full state×facing set into `_derived/equipment/<slot>/`.
  - Wire it: add the `equipment.<slot>` `EquipLayer` (all 4 states × 3 facings, `z` for draw order) to
    `PIXEL_CRAWLER_TILESET.actors.player` in `tileset.ts`.
  - Verify: `npm run build` → `npm run preview` → `npm run smoke` (fix any 404/boot error), then
    **eyeball** the smoke screenshots — the layer sits on the body through idle/walk, follows facing +
    left-mirror, correct draw order, no float/detach. Tune anchors/`z` and re-stamp if off.
  - Side effects: first real `_derived/equipment/` strips + one manifest slot populated.
  - Docs: none (Step 7).
  - Done when: smoke green and the screenshots show the equipped layer correctly animated on the
    player. This is the acceptance for the whole pipeline.

- [ ] **Step 7: Docs** `[delegate sonnet]`
  - `docs/ASSETS.md` — new **"Equipment layering pipeline"** section: the alignment invariant, the
    5-slot model, the anchor-file shape + `--seed`/`--stamp`/`--preview` commands, the rigid-vs-
    deformable boundary (route 1 = rigid slots; route 2 matching-packs / hand-drawn = deformable
    `chest`/`legs`), and a derived-strip manifest row for the Step-6 slot. Cross-link (don't duplicate)
    the existing "Sprite extraction pipeline" section.
  - `docs/DECISIONS.md` — log: layering chosen over swap/hand-pin; two converging supply routes
    (matching-pack primary, stamp for custom); 5 fixed slots; anchors carry rotation + belong to the
    body rig (author-once); rigid-vs-deformable boundary; child-sprite (not container) runtime.
  - `CLAUDE.md` Status — one lean line that equipment layering + the anchor-stamp tool landed.
  - `scripts/pixel-crawler/README.md` — one-line rows for the new scripts.
  - Side effects: docs only.
  - Done when: docs describe the pipeline consistently with the shipped code + tools.

## Out of scope

- **Inventory/equip *gameplay*** — actually equipping/unequipping gear from an inventory, stat
  effects (armour → defence, weapon → damage), item data in `ITEMS`. This plan is the **rendering +
  authoring pipeline** only; gear is wired statically in the manifest for now.
- **Per-facing draw-order swaps** (e.g. a weapon behind the body when facing up) — fixed `z` per slot
  this pass; note as a future refinement.
- **Deformable `chest`/`legs` art** — the pipeline *accepts* such strips (route 2 / hand-drawn) but
  this plan does not author bending cloth/mail; the stamp tool is proven on a rigid slot only.
- **Buying/importing Anokolisa's paid equipment packs** — route 2 is designed-for but the purchase +
  wiring of a real pack is its own later task; only the free-pack proof is in scope.
- **Equipment on the enemy/NPCs** — player character only (matches the 5-slot "main char" decision).
- **AI-generated per-frame layers** (route 3) — not built; `gen-art/` remains the future experiment
  home.
- **Carry/Run/Fishing/Watering/Collect body states** — layering targets the wired
  idle/walk/chop/punch states only (same set the body currently animates).
