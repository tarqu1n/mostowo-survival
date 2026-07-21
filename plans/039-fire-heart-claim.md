# Fire-Heart Claim & the Lit Sightline — the Fire's Light Is Both Base and Vision

> Status: deployed

## Summary

The campfire's light now defines **two** things at once — *what you can build on* and *what you can
see*:

1. **Base claim (GAME-DESIGN staging (1)):** replace the fixed `BASE_ZONE_SIZE` rectangle that gates
   `baseOnly` building with a test against the campfire's **lit radius**
   (`CampfireManager.inLight`/`lightSources()`), so the claim *is* the fireline. The placement area
   shrinks from a 21×27 rect to a fuel-fluctuating ~8-tile disc, down to ~3 tiles near-empty, and
   carries a bootstrap chicken-and-egg (the first campfire is itself `baseOnly`).
2. **The lit sightline:** night becomes **fully dark** — light is the *only* thing that lets you see,
   and **darkness genuinely conceals** (approaching enemies and their attack tells are unreadable away
   from light). The reveal around each light **dims out to black in a soft gradient** instead of
   stopping at a hard circle. The player always emits a **tiny personal light** so they're never fully
   blind; a future off-hand **torch** raises that radius.

The design line is **"light is a must — don't let the lights go out."** Both halves were peeled out
of / prompted by plan 038's critique (#3), and they share the same "light source" seam, so they belong
in one plan: **the fireline you hold is both your building ground and your window on the dark.**

## Context & decisions

**Direction:** `docs/GAME-DESIGN.md` "Base claim — the campfire heart" (`:344-372`), settled in
`docs/decisions/gameplay.md:175-190` ([DECIDED] 2026-07-19, chosen over walls-enclosure). Staging
(`GAME-DESIGN.md:371-372`): **(1) base zone becomes the central hearth's radius, replacing the rect**;
(2) multiple fires union claims; (3) walls extend the boundary. **This plan does staging (1) only** for
the claim. The full-dark / light-only sightline is the natural companion to "fire-out = darkness"
(`gameplay.md:123-127`) and to torches as light sources (`gameplay.md:176`).

**Locked decisions:**

*Claim (base placement):*

1. **Claim = any lit hearth's bright light.** A tile is claimable iff inside a lit fire's **bright core**
   (world-px granularity via `CampfireManager.inLight`) — see decision #7 for why the claim uses the
   bright core, not the full geometric radius.
2. **Bootstrap:** while **no lit hearth exists**, fall back to the existing `BASE_ZONE_SIZE` rect so the
   first (`baseOnly`) campfire can still be placed. Once a hearth is lit, the light-radius claim governs.
3. **Fuel-coupled placement is intended, not a bug** — the claim breathing with fuel is the fantasy
   ("hold the fireline"). Playtest the near-empty minimum so it doesn't get frustrating; the light-radius
   floor is `CAMPFIRE_LIGHT_MIN_FRAC` (`config.ts`).

*Sightline (rendering):*

1. **Night is fully dark (black), and darkness conceals.** Raise `NIGHT_MAX_ALPHA` (`config.ts:345`)
   0.55 → **1.0** and take `COLORS.night` (`config.ts:474`, currently `0x0a1020`) to pure/near black, so
   away from any light you see **nothing** — including approaching enemies and their telegraphed attack
   tells. This is the point, not a problem to soften: **there is no ambient floor and no combat-readability
   concession.** The night overlay already sits above actors (depth 15 > player 10), so unlit sprites and
   FX are hidden for free; execution must confirm every enemy tell/telegraph renders **below** the overlay
   (depth < 15) so the dark actually hides it. `tintAlphaAt` still cross-fades at dusk/dawn — only the
   night plateau rises. **Sequencing:** the full-black change and the soft-light reveal (#5) ship as one
   unit — full black with no soft reveal would be worse than today, so they land together (Step 2).
2. **Light reveals with a soft radial gradient — via ERASE, not a mask, not a shader.** The current holes
   are inverted **geometry** masks (binary in/out, so a gradient is impossible). The fix is **not** a
   bitmap/alpha mask (two full-screen framebuffer passes/frame — the expensive Phaser primitive) and
   **not** a fragment/PostFX shader (a full-viewport per-pixel pass every frame — the retired
   `OutlinePipeline` mistake; `docs/RENDERING.md`). Instead: a **screen-space, camera-fixed
   (`setScrollFactor(0)`) `RenderTexture`** sized to the viewport, each frame `clear()` → fill the night
   colour at `tintAlphaAt()` alpha → for each render light `rt.erase(brushKey, screenX, screenY)` using a
   **baked radial-gradient brush** (white centre α=1 → transparent rim α=0, baked once like
   `render/glowTexture.ts`) → the RT draws once. `erase` subtracts destination alpha by the brush's alpha
   (`destination-out`), punching a **soft** hole; it works on WebGL **and** Canvas, keeping the repo's
   no-feature-detect property. Zero mask passes; the per-pixel falloff is a baked per-light *constant*,
   the per-frame work is ~2 textured-quad blits.
3. **The player always emits a tiny personal light** (`PLAYER_LIGHT_RADIUS`, new — start small, ~1–1.5
   tiles) aggregated into the **render** light sources so full-dark night still leaves a small readable
   disc around them. Separate from the day-relevant fog-of-war **vision radius** (`VISION_RADIUS` = 5
   tiles): at night the full-black overlay dominates beyond the tiny light; by day the vision radius
   governs the subtle fog dim. A future off-hand **torch item** just raises the player's emitted radius
   (out of scope; torch-as-buildable perimeter light already decided, `gameplay.md:176`; both add to the
   same seam).
4. **Claim light ≠ render light — never conflate; and claim uses the BRIGHT CORE.** The base **claim**
   keys off `campfireManager.inLight` (**fires only, binary** — you must not claim base merely by standing
   somewhere). The **render** light = fires **+** the player's personal light (soft gradient). Critically,
   the claim tests the fire's **bright core** (`radius × CLAIM_LIGHT_FRAC`, new config, e.g. ~0.7), **not**
   the full geometric radius where the gradient has already faded to ~invisible — otherwise placement
   would be allowed in a near-black fringe you can't see. So the claim boundary sits inside clearly-visible
   light; the two systems stay legibly consistent without sharing a code path.

**Key files & patterns (from repo sweep):**

- **Claim:** `BASE_ZONE_SIZE={w:21,h:27}` (`config.ts:382`) around `SPAWN_TILE` (`:376`); pure math
  `systems/base.ts` (`isInBase`). **Only runtime consumer:** `BuildManager` — `baseZoneRect`
  (`BuildManager.ts:79`) gating `baseOnly` in `tilePlaceable` (`:143-144`). **No base-rect rendering.**
  Thread the claim test via a **dep closure** (scene mediates, no manager↔manager edge).
- **Light seam:** `CampfireManager.inLight(x,y)` (`:288`) + `lightSources()` (`:273`) — world-px, radius
  scales with fuel. Today both `SurvivalClock` (night overlay) and `VisionController` (fog) consume
  `lightSources()` and build an **inverted geometry mask**. **Only `SurvivalClock`'s night overlay is
  rewired** (Step 2). `VisionController`'s fog (depth 5, below actors, α 0.2, a day mechanic) is left on
  its cheap geometry mask — at full-black night it's invisible under the overlay anyway, so converting it
  is out of scope (keeps this to one rewired manager).
- **Baked-texture precedent:** `render/glowTexture.ts` (canvas bake, cached across scene restarts) is the
  model for the new radial-gradient brush.
- **Mobile-texture caution:** `GROUND_CHUNK_ROWS=32` exists because a map-tall baked texture caused
  mediump texel seams on real phones — so the light RT **must be screen-space**, never world-sized
  (the-moon is 245×280 tiles ≈ 3920×4480 px ≈ 70 MB / full-map clear every frame — banned).

## Steps

- [x] **Step 1: Swap the `baseOnly` placement gate to the lit-radius test (with bootstrap)** `[inline]`
  - Outcome: `baseOnly` placement now gates on a lit hearth's **bright core**, with the `BASE_ZONE`
    rect kept as the no-hearth bootstrap. Files: **`config.ts`** — new `CLAIM_LIGHT_FRAC = 0.7`;
    **`CampfireBehavior.ts`** — new `hasLitHearth()` + `inClaim(x,y)` (mirrors `inLight` but tests
    `radius × CLAIM_LIGHT_FRAC`, the clearly-lit core not the gradient rim); **`BuildManager.ts`** —
    two new deps (`hasLitClaim()`, `inClaim(col,row)`) and the `tilePlaceable` `baseOnly` branch now
    picks `inClaim` when a hearth is lit else `isInBase(baseZoneRect)`; **`GameScene.ts`** — wired both
    deps as closures over `this.campfire` (resolved at call time, so live despite BuildManager being
    constructed before StructureManager; tile centre → world-px via `tileToWorldCenter`, the same space
    `lightSources()` casts in — no origin offset). **Post-037 note:** the plan's `CampfireManager`
    pointers are now `CampfireBehavior` (light seam) unioned by `StructureManager`; `litHearth()` already
    exists on GameScene from plan 038. Docs: `docs/decisions/gameplay.md` (staging (1) marked DONE),
    `docs/STATUS.md` (new "Fire-heart base claim" note). Tests: **`tests/e2e/campfire.spec.ts`** — fixed
    the pre-existing stale-coords `tryPlace` test (repurposed as the bootstrap-path test, correct
    `SPAWN_TILE` coords) and added a claim-path test (bright-core accept/reject + fuel-shrink flip);
    header comment corrected. **Verified:** typecheck + lint clean (no errors; only pre-existing
    unbound-method warnings at 635-644); 836/836 unit; campfire e2e **9/9** (incl. the 2 new/fixed);
    prod `npm run build` clean. Deviation: also fixed the pre-existing `tryPlace` failure (plan 038
    flagged it as plan-039 base-claim territory) since it directly tests the gate I reworked. `inClaim`
    read-side `DebugState`/pure-predicate helpers are deferred to Step 4 per the plan.
  - In `BuildManager.tilePlaceable` (`:143-144`), replace `isInBase(baseZoneRect, col, row)` for `baseOnly`
    buildables with an "inside any lit hearth's **bright core**" test, via a threaded dep (e.g.
    `deps.inClaim(col,row)` → scene calls a fire bright-core check at the tile centre). Add
    `CLAIM_LIGHT_FRAC` to config; the check tests `distance ≤ radius × CLAIM_LIGHT_FRAC` (fires only).
    **Bootstrap branch:** if no lit hearth exists, fall back to `isInBase(baseZoneRect,…)`.
  - Side effects: `BuildManager` (new dep + bootstrap branch); `GameScene` wires the dep; confirm nothing
    else reads `baseZoneRect` for gameplay (sweep confirmed only BuildManager does). Tile→world-px must
    match how `inLight` expects coords. **Fires only — not the render light (decision #7).**
  - Docs: `docs/decisions/gameplay.md` (mark staging (1) done); `docs/STATUS.md`.
  - Done when: Tier-2 scenario — with a lit hearth, a `baseOnly` buildable places only within the bright
    core and is rejected just outside it; with no hearth, the bootstrap rect allows the first campfire;
    draining fuel shrinks the placeable area (assert a tile flips placeable→rejected as fuel drops).

- [x] **Step 2: Fully-dark night via an erase-composited, screen-space light layer** `[sub-agent]`
  - Outcome: night is now fully dark, revealed only by a **soft radial-gradient disc** per lit fire.
    Files: **`config.ts`** — `NIGHT_MAX_ALPHA` 0.55 → **1.0**, `COLORS.night` `0x0a1020` → `0x04060e`
    (near-black); **`src/render/lightTexture.ts`** (NEW) — `bakeLightBrush()` bakes a cached 256px
    radial-gradient brush (white core α1 → transparent rim α0) via 2D-canvas `createRadialGradient`,
    mirroring `glowTexture.ts` (module cache, `addCanvas`, survives death-restarts); **`SurvivalClock.ts`**
    — replaced the `Rectangle` + `lightShape` Graphics + inverted geometry mask + `redrawLight()` with a
    **world-space viewport-sized `RenderTexture`** (`nightRT`, depth 15, re-centred on `cam.midPoint`
    each frame) + a hidden erase-brush Image; new `composite(cycleMs)`: `clear()` → `fill(COLORS.night,
    tintAlphaAt())` → per lit fire `erase(brush, l.x-left, l.y-top)` scaled `2·radius/brushSize` (early-
    returns during the day when alpha ≤ 0); `destroy()` drops both refs (never `.destroy()` — the RT
    restart trap); **`testApi.ts`/`GameScene.ts`** — dropped the now-invalid `nightOverlay` (Rectangle)
    testApi dep; `nightAlpha` now computes `tintAlphaAt(getClockMs() % cycleLengthMs())` (byte-identical
    to the old `.alpha` read); **`docs/RENDERING.md`** — new "Light layer" section.
  - **Deviation (approved reasoning):** used a **world-space RT centred on `cam.midPoint`**, NOT the
    plan's `setScrollFactor(0)` + `(x-scrollX)·zoom`. The naive screen-space formula omits the
    `(viewport/2)(1-zoom)` term and mis-scales at zoom≠1; a world-space RT lets the camera's own
    transform draw it 1:1 at every zoom, so the erase math is plain texture-local coords. Sized
    `BASE_WIDTH+2·TILE × BASE_HEIGHT+2·TILE` (392×672) — the visible world extent at MIN_ZOOM equals
    `BASE_WIDTH` regardless of `RENDER_SCALE`, so this always covers the viewport; **never map-sized**
    (the banned 70MB case). Depth check: all gameplay sprites/FX are < 15 (enemy 9, player 10, combat FX
    11-14), so the overlay conceals them for free — no tell needed lowering.
  - **Verified (independently re-run):** typecheck clean; lint clean (only pre-existing GameScene
    unbound-method warnings); 836/836 unit (daynight auto-tracked the `NIGHT_MAX_ALPHA` constant — no
    edit); e2e **12/12 serial** (`survival-daynight` 2/2 with the new 1.0 plateau, `campfire` 9/9 incl.
    the night `inLight` holes, `refactor-tripwire`); prod build clean; **boot canary: "game booted" ✓ +
    "no console/page errors" ✓** (the RT-teardown-trap gates). The smoke scene-activation FAIL is
    pre-existing (`smoke.mjs`'s single-tap boot race — confirmed identical with Step 2 stashed; the
    retried-tap e2e specs render the night composite fine). **Deferred to human playtest:** the brush
    falloff tuning (core brightness / shoulder softness vs `CLAIM_LIGHT_FRAC 0.7`) and an on-device look
    at the gradient under NEAREST at 300% zoom. Two stale "nightOverlay" comments remain in
    `VisionController.ts` (left untouched per "VisionController unchanged").
  - `config.ts`: `NIGHT_MAX_ALPHA` 0.55 → 1.0; `COLORS.night` → pure/near black. Confirm `tintAlphaAt`
    (`systems/daynight.ts`) still cross-fades to the new plateau (no math change); update the Tier-1
    `daynight` assertion for the 1.0 plateau.
  - **New `render/lightTexture.ts`:** bake a cached radial-gradient brush (white centre α=1 → transparent
    rim α=0) via a 2D-canvas `createRadialGradient`, mirroring `glowTexture.ts` (cache map, survives
    GameScene death-restarts, `addCanvas`). Tune the falloff for a pleasing "dim to black".
  - **Rewire `SurvivalClock`'s night overlay** from `Rectangle` + inverted geometry mask + `lightShape`
    to a **screen-space `RenderTexture`**: `setScrollFactor(0)`, sized to the camera viewport (× render
    resolution), depth 15. Each `tick`/`applyClock`: `clear()` → fill `COLORS.night` at `tintAlphaAt()`
    alpha → for each **render** light (`deps.lightSources()`, fires + player) `erase(brushKey, sx, sy)`
    with the brush scaled to that light's radius. Delete the dead `lightShape`/`redrawLight()` geometry-mask
    path. **World→screen transform (the flagged risk):** `sx=(x-cam.scrollX)*cam.zoom`,
    `sy=(y-cam.scrollY)*cam.zoom`, brush scale `= (2·radius·cam.zoom)/brushSize`; verify against
    `RENDER_SCALE`/zoom (1–3) and camera scroll. **No world-sized RT; no bitmap mask; no shader.**
  - **Darkness conceals (decision #4):** confirm enemy sprites/telegraph FX render **below** depth 15 so
    the overlay hides them away from light; lower any tell that currently draws above it.
  - Side effects: `render/` (+1 file), `SurvivalClock` (overlay type + per-frame composite; keep it sole
    writer; keep the SHUTDOWN "drop stale ref only" rule for the RT). `VisionController` **unchanged**.
    `docs/RENDERING.md` note ("light layer: baked gradient brush erased into a screen-space RT").
  - Done when: at night, the world is black except a **soft** disc around each lit fire that **fades to
    black at its rim** (no hard ring); overlapping fires brighten in the seam; a shrinking-fuel fire's
    disc shrinks and stays soft; an enemy outside the light (and its tells) is **not visible**; mid-day is
    fully lit; dusk/dawn cross-fade smoothly; boot canary green (RT is the restart-teardown trap).

- [x] **Step 3: Tiny player personal light** `[inline]`
  - Outcome: the player now emits a tiny personal RENDER light so full-dark night isn't blinding.
    Files: **`config.ts`** — new `PLAYER_LIGHT_RADIUS = TILE_SIZE * 1.25` (~1.25 tiles, small so
    fires/torches matter); **`GameScene.ts`** — new `playerLight()` helper returning `{x,y,radius}` at
    the player sprite's live world pos, and the **SurvivalClock** `lightSources` closure now returns
    `[...structureManager.lightSources(), playerLight()]` (the RENDER seam only). Crucially NOT wired
    into the claim path (`CampfireBehavior.inClaim` stays fires-only, decision #7) and NOT into
    VisionController's closure (it keeps fires-only + its own `VISION_RADIUS` fog, unchanged). Test:
    **`tests/e2e/campfire.spec.ts`** — new guard "the player's personal light does not grant baseOnly
    placement (render ≠ claim)": a tile on the player, ~25 tiles from the only (far) lit hearth, is
    still rejected for a `baseOnly` build. **Verified:** typecheck + lint clean (0 errors); 836/836
    unit; campfire e2e **10/10** (incl. the new guard); prod build clean. **Deferred to playtest:** the
    visual reveal (that the disc reads well / moves with the player / is tuned to the right size) is not
    headlessly checkable; flagged for the iterate-phase playtest alongside Step 2's brush tuning.
  - `config.ts`: add `PLAYER_LIGHT_RADIUS` (~1–1.5 tiles). Aggregate a player-centred light disc into the
    scene's **render** light-source closure (feeding Step 2's erase list) — **not** the claim path
    (decision #7). It tracks the player each frame.
  - Side effects: `GameScene` light-source aggregation; the player light moves with the sprite. Confirm it
    does **not** appear in the claim test (`campfireManager.inLight`).
  - Done when: at full-dark night, away from any fire, the player sees a small soft disc that moves with
    them; that disc does **not** let `baseOnly` buildables be placed; tuned tiny enough that fires/torches
    clearly matter, big enough not to walk blind. (Deliberately, it does **not** make enemy tells readable
    beyond its small reach — decision #4.)

- [x] **Step 4: Legibility + tests + docs** `[inline]`
  - Outcome: wrap-up — tests + docs finalised. **Claim legibility:** DEFERRED (per the plan's "optional,
    only if playtest shows confusion") — the full-dark gradient + bright-core claim should read naturally
    ("placement stops where the light dims"); no extra build-preview tint cue added, revisit at playtest.
    **DebugState:** NO new field (and NO tripwire bump) — the claim is already testable via `tryPlace`
    (bool) and fuel/lit via `campfires[]`; an `inClaim` readout wasn't worth the golden churn (the plan
    made it optional). **Tier-1 tests:** added `campfire.test.ts` "claim bright-core (CLAIM_LIGHT_FRAC)"
    (2 tests) pinning decision #7's invariant — the claim core is a *strict subset* of the light radius
    (guards `CLAIM_LIGHT_FRAC ∈ (0,1)` against drift) and *breathes with fuel*. Note: the plan also
    imagined pure tests for the gradient/world→screen transform, but Step 2's world-space-RT deviation
    ELIMINATED the transform math (texture-local coords) and the gradient is a canvas bake — no pure
    surface to test there; the claim predicate + fuel-shrink are covered by the Step 1/3 Tier-2 e2e.
    **Docs:** `STATUS.md` (new "Light-only night" para + the day/night line rewritten), `GAME-DESIGN.md`
    (base-claim section delivered-note + `CampfireBehavior` fix), `docs/decisions/gameplay.md` (light-only
    sightline landed sub-note), `RENDERING.md` (light-layer section — landed in Step 2). **Verified (full
    sweep):** typecheck + lint clean; **unit 838/838** (61 files, incl. the 2 new); prod build clean;
    **e2e 80 passed / 4 failed — all 4 pre-existing** (confirmed by error signature: `survival-hunger`
    HUNGER_LETHAL-false, `death` stale respawn coords, `menu-start`/`campfire-feed` headless single-tap
    race — identical to plan 038 Step 7's documented reds on clean master, none touching the light layer);
    boot canary booted + zero-console-error gates green. **Deferred to playtest:** brush-falloff feel,
    player-light size, claim-edge legibility, on-device gradient look at 300% zoom.
  - Claim legibility: with the gradient + bright-core claim, the dimming edge reads as "why placement
    stops". Optional extra cue only if playtest shows confusion (reuse the build-preview invalid tint at
    the claim boundary; **no** frame-loop shader). Note any deferral.
  - `DebugState`: if a claim/light field helps tests, append it **at END** (`testApi.ts` + `harness.ts` +
    `refactor-tripwire` golden together). Tier-1 test for pure helpers (bright-core claim predicate,
    gradient falloff / world→screen transform math); confirm `npm run smoke`.
  - Docs: `docs/GAME-DESIGN.md` (day/night + light-only, dark-conceals sightline), `docs/DECISIONS.md` /
    `docs/decisions/gameplay.md` (light-only night + gradient + player light landed), `docs/STATUS.md`,
    `docs/RENDERING.md` (light layer).
  - Done when: claim boundary + light edge are legible in-game, and all three test tiers green.

## Out of scope

- **Off-hand torch item** (held light raising the player's radius) and **torch buildable** (perimeter
  lighting, `gameplay.md:176`) — later; both add sources to the render light seam.
- **Converting `VisionController`'s fog to the erase layer** — its geometry mask stays (day mechanic,
  subtle, invisible under full-black night); revisit only if the hard fog edge reads badly by day.
- **Staging (2) unioned claims** / **(3) walls extending the claim** — later. (The erase layer already
  unions multiple lights *visually*; the *claim* union is staging (2).)
- **Removing `BASE_ZONE_SIZE`** — retained as the bootstrap claim; don't delete it.
- **Coloured/flickering firelight, per-tile light levels, normal-mapped lighting** — the layer is a single
  white-gradient erase; richer lighting is a separate future effort.

## Critique

*Fresh-eyes review (2026-07-20). Verdict + severity table below; the plan above has been revised to
resolve findings 1, 2, 5, 6, 7 and to adopt finding 4 as intended design ("darkness conceals — light is
a must"). Finding 3's split was declined (kept as one plan per direction) but the lighting scope was cut
to a single rewired manager to right-size it.*

**Verdict:** Claim work (Step 1) is sound and roadmap-aligned; the original lighting approach was the
wrong Phaser primitive — a screen-space RenderTexture that ERASEs soft light holes (no mask, no shader)
is strictly cheaper, lower-memory, and honours "bake, don't shade". Resolved before executing.

|#|Finding|Severity|Resolution in plan|
|---|---------|----------|--------------------|
|1|Inverted bitmap mask on two objects = two full-screen framebuffer passes/frame; erase-composited screen-space RT needs zero mask passes.|High|**Adopted** — decision #5 rewritten to erase-composited RT; only the night overlay rewired.|
|2|World-sized RT on the-moon ≈ 70 MB + full-map clear/frame; the tall-texture class `GROUND_CHUNK_ROWS` was added to avoid.|High|**Adopted** — screen-space camera-fixed RT mandated; world-sized branch forbidden.|
|3|Rendering rework folded into a plan billed "small & playtestable".|Medium|**Partially** — kept one plan (per direction) but cut lighting to one rewired manager (`VisionController` untouched).|
|4|Full-black night may make combat tells unreadable away from fire.|Medium|**Adopted as design** — tells are *meant* to be hidden; decision #4 = darkness conceals, no ambient floor.|
|5|Claim boundary at gradient-fade-to-zero allows placement in invisible fringe.|Medium|**Adopted** — decision #7/#1: claim uses the **bright core** (`radius × CLAIM_LIGHT_FRAC`).|
|6|Don't build a multi-light engine for N≈2; a fragment shader is correctly rejected.|Low|**Adopted** — no new `LightField` manager; `SurvivalClock` owns its RT; shader rejected.|
|7|Screen-space RT must scale radius by camera zoom + align with `RENDER_SCALE`.|Low|**Adopted** — world→screen transform specified as a Step 2 acceptance check.|
