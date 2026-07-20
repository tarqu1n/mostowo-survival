# Fire-Heart Claim & the Lit Sightline — the Fire's Light Is Both Base and Vision

> Status: planned — run /execute-plan to begin. **Depends on plan 038** (needs the fire-heart / lit
> hearth in place). Non-blocking for the first playable loop — sequence after 038's wave loop lands.

## Summary

The campfire's light now defines **two** things at once — *what you can build on* and *what you can
see*:

1. **Base claim (GAME-DESIGN staging (1)):** replace the fixed `BASE_ZONE_SIZE` rectangle that gates
   `baseOnly` building with a test against the campfire's **lit radius**
   (`CampfireManager.inLight`/`lightSources()`), so the claim *is* the fireline. The placement area
   shrinks from a 21×27 rect to a fuel-fluctuating ~8-tile disc, down to ~3 tiles near-empty, and
   carries a bootstrap chicken-and-egg (the first campfire is itself `baseOnly`).
2. **The lit sightline:** night becomes **fully dark** — light is the *only* thing that lets you see —
   and the reveal around each light **dims out to black in a soft gradient** instead of stopping at a
   hard circle. The player always emits a **tiny personal light** so they're never fully blind; a
   future off-hand **torch** raises that radius.

Both were peeled out of / prompted by plan 038's critique (#3) — orthogonal to the defend loop, real
feel-affecting changes worth playtesting on their own. The claim and the sightline share the same
"light source" seam, so they belong in one plan: **the fireline you hold is both your building ground
and your window on the dark.**

## Context & decisions

**Direction:** `docs/GAME-DESIGN.md` "Base claim — the campfire heart" (`:344-372`), settled in
`docs/decisions/gameplay.md:175-190` ([DECIDED] 2026-07-19, chosen over walls-enclosure). Staging
(`GAME-DESIGN.md:371-372`): **(1) base zone becomes the central hearth's radius, replacing the rect**;
(2) multiple fires union claims; (3) walls extend the boundary. **This plan does staging (1) only** for
the claim. The full-dark / light-only sightline is the natural companion to "fire-out = darkness"
(`gameplay.md:123-127`) and to torches as light sources (`gameplay.md:176`).

**Locked decisions:**

_Claim (base placement):_

1. **Claim = any lit hearth's radius.** A tile is claimable iff inside a lit fire's light disc (world-px
   granularity via `CampfireManager.inLight`).
2. **Bootstrap:** while **no lit hearth exists**, fall back to the existing `BASE_ZONE_SIZE` rect so the
   first (`baseOnly`) campfire can still be placed. Once a hearth is lit, the light-radius claim governs.
3. **Fuel-coupled placement is intended, not a bug** — the claim breathing with fuel is the fantasy
   ("hold the fireline"). Playtest the near-empty minimum so it doesn't get frustrating; the light-radius
   floor is `CAMPFIRE_LIGHT_MIN_FRAC` (`config.ts`).

_Sightline (rendering):_

4. **Night is fully dark (black).** Raise `NIGHT_MAX_ALPHA` (`config.ts:345`) 0.55 → **1.0** and take
   `COLORS.night` (`config.ts:474`, currently `0x0a1020`) to pure/near black, so away from any light you
   see nothing. `tintAlphaAt` still cross-fades at dusk/dawn — only the night plateau rises.
5. **Light reveals with a soft radial gradient, not a hard edge.** The current holes are **inverted
   _geometry_ masks** filling hard `fillCircle`s — geometry masks are binary (in/out), so a gradient is
   impossible with them. Swap to an inverted **bitmap/alpha mask** sourced from a **light field**: a
   `RenderTexture` into which a **baked radial-gradient light texture** (white centre → transparent rim,
   the same bake-once pattern as `render/glowTexture.ts`; **no frame-loop shader**, per
   `docs/RENDERING.md`) is blitted once per light source, scaled to that source's radius, additively so
   overlaps brighten. `setInvertAlpha(true)` ⇒ revealed at the bright centre, dimming to black at the rim.
6. **The player always emits a tiny personal light** (`PLAYER_LIGHT_RADIUS`, new — start small, ~1–1.5
   tiles) aggregated into the **render** light sources so full-dark night still leaves a small readable
   disc around them. This is separate from the day-relevant fog-of-war **vision radius**
   (`VISION_RADIUS` = 5 tiles): at night the full-black overlay dominates beyond the tiny light; by day
   the vision radius governs the subtle fog dim. A future off-hand **torch item** just raises the
   player's emitted radius (out of scope — see below; torch-as-buildable perimeter light already
   decided, `gameplay.md:176`; both add to the same seam).
7. **Claim light ≠ render light — never conflate.** The base **claim** keys off `campfireManager.inLight`
   (**fires only, binary** — you must not claim base merely by standing somewhere). The **render** light
   field = fires **+** the player's personal light (soft gradient). The claim boundary sits at the fire's
   `lightSources()` outer radius — exactly where the render gradient fades to zero — so they stay visually
   consistent without being the same code path.

**Key files & patterns (from repo sweep):**

- **Claim:** `BASE_ZONE_SIZE={w:21,h:27}` (`config.ts:382`) around `SPAWN_TILE` (`:376`); pure math
  `systems/base.ts` (`isInBase`, `baseZoneFromSpawn`). **Only runtime consumer:** `BuildManager` —
  `baseZoneRect` (`BuildManager.ts:79`) gating `baseOnly` in `tilePlaceable` (`:143-144`). **No base-rect
  rendering anywhere.** Thread the claim test in via a **dep closure** (scene mediates, no
  manager↔manager edge), matching the manager convention.
- **Light seam:** `CampfireManager.inLight(x,y)` (`:288`) + `lightSources()` (`:273`) implement the
  lit-disc test at world-px granularity; radius scales with fuel. Both `SurvivalClock` (night overlay,
  `world/SurvivalClock.ts`) and `VisionController` (fog, `fx/VisionController.ts`) already consume
  `lightSources()` via a **scene closure** and each build an **inverted geometry mask** from filled
  circles (`lightShape`/`fogShape`). Those two circle-mask sites are what Step 3 replaces.
- **Baked-texture precedent:** `render/glowTexture.ts` (canvas bake, cached across scene restarts) is the
  model for the new radial-gradient light texture.
- Vision already reveals the lit area (night mask + `VisionController`), so the claim is visually legible
  without new rendering; the gradient work (Steps 3–4) makes *why* placement stops far clearer.

## Steps

- [ ] **Step 1: Swap the `baseOnly` placement gate to the lit-radius test (with bootstrap)** `[inline]`
  - In `BuildManager.tilePlaceable` (`:143-144`), replace `isInBase(baseZoneRect, col, row)` for `baseOnly`
    buildables with an "inside any lit hearth's radius" test, using a threaded dep (e.g. `deps.inClaim(col,row)`
    → the scene calls `campfireManager.inLight(worldX, worldY)` for the tile centre). **Bootstrap branch:**
    if no lit hearth exists, fall back to `isInBase(baseZoneRect,…)` so the first campfire is placeable.
  - Side effects: `BuildManager` (new dep + bootstrap branch); `GameScene` wires the dep; confirm nothing
    else reads `baseZoneRect` for gameplay (sweep confirmed only BuildManager does). Tile→world-px
    conversion must match how `inLight` expects coordinates. **Use `campfireManager.inLight` (fires only),
    NOT the render light field** (decision #7).
  - Docs: `docs/decisions/gameplay.md` (mark staging (1) done); `docs/STATUS.md`.
  - Done when: Tier-2 scenario — with a lit hearth, a `baseOnly` buildable places only within the lit
    radius and is rejected just outside it; with no hearth, the bootstrap rect still allows the first
    campfire; draining fuel shrinks the placeable area (assert a tile flips from placeable to rejected as
    fuel drops).

- [ ] **Step 2: Fully-dark night** `[inline]`
  - `config.ts`: `NIGHT_MAX_ALPHA` 0.55 → 1.0; `COLORS.night` → pure/near black. Confirm `tintAlphaAt`
    (`systems/daynight.ts`) still ramps continuously at dusk/dawn to the new plateau (it references the
    constant, so no math change — add/adjust a Tier-1 assertion that the night plateau is now 1.0).
  - Side effects: purely the darkness ceiling — do **not** touch masks here (Step 3). Sanity-check the HUD
    (UIScene, above the overlay) stays readable at full black.
  - Done when: at the night plateau with **no** lit light, the world is black; the mid-day plateau is
    still fully lit; dusk/dawn still cross-fade smoothly. Tier-1 `daynight` test updated.

- [ ] **Step 3: Soft-gradient light field (baked radial gradient → inverted bitmap mask)** `[sub-agent]`
  - **New `render/lightTexture.ts`:** bake a cached radial-gradient texture (white centre α=1 → transparent
    rim α=0) via a 2D-canvas `createRadialGradient`, mirroring `glowTexture.ts` conventions (cache map,
    survives GameScene death-restarts, `addCanvas`). Tune the falloff curve for a pleasing "dim to black".
  - **New light-field owner (main architectural decision — flag for critique):** a scene-owned
    `RenderTexture` (recommend a small new `fx/LightField.ts` manager, same narrow-deps/SHUTDOWN pattern as
    the other fx managers) updated once per frame in the scene loop from the **aggregated** render light
    sources (campfire `lightSources()` **+** the player light from Step 4). Each source is blitted as the
    baked light texture scaled to `2×radius`, additively. This is the single source of truth for "where is
    light".
  - **Rewire both masked overlays to it:** `SurvivalClock.nightOverlay` and `VisionController`'s fog rect
    stop building `lightShape`/`fogShape` geometry masks and instead take an **inverted bitmap mask** off
    the shared light field (`createBitmapMask` + `setInvertAlpha(true)`). Delete the now-dead
    `redrawLight()`/`fogShape` circle-fill paths. VisionController's fog reveal still includes the player's
    **vision** radius (a soft disc in the field is fine) so day fog is unchanged.
  - **Coordinate-space care (the likely-bug spot, mirrors Step 1's caution):** the bitmap-mask source must
    align with the camera exactly as the current geometry masks do — decide world-sized RT at world origin
    (draw at world coords) vs screen-sized RT following the camera (draw at screen coords), and verify
    scroll alignment. **No frame-loop shader** — a per-frame RT blit of a few images only.
  - Side effects: `render/` (+1 file), `fx/` (+1 manager + scene wiring + SHUTDOWN), `SurvivalClock` &
    `VisionController` (mask source swapped, dead circle paths removed), `GameScene` (owns/updates the
    light field, passes it to both consumers). `docs/RENDERING.md` note ("light field: baked radial
    gradient → inverted bitmap mask").
  - Done when: a lit fire reveals a disc that **fades smoothly to black at its rim** (no hard ring);
    overlapping fires brighten in the seam; a shrinking-fuel fire's disc shrinks *and* stays soft; boot
    canary green (masks are the classic restart-teardown trap).

- [ ] **Step 4: Tiny player personal light** `[inline]`
  - `config.ts`: add `PLAYER_LIGHT_RADIUS` (start ~1–1.5 tiles). Aggregate a player-centred light disc into
    the scene's **render** light-source closure (the one feeding the LightField / Step 3) — **not** the
    claim path (decision #7). It tracks the player each frame.
  - Side effects: `GameScene` light-source aggregation; the player light must move with the sprite.
    Confirm it does **not** appear in `campfireManager.inLight` / the claim test.
  - Done when: at full-dark night, standing away from any fire, the player still sees a small soft disc
    around them that moves with them; that disc does **not** let `baseOnly` buildables be placed (claim
    stays fire-only). Playtest: tiny enough that fires/torches clearly matter, big enough to not walk blind.

- [ ] **Step 5: Legibility + tests + docs** `[inline]`
  - Claim legibility: with the gradient in place, the dimming edge already reads as "why placement stops".
    Optional extra cue only if playtest shows confusion (reuse the build-preview invalid tint at the claim
    boundary; **no** frame-loop shader). Note any deferral.
  - `DebugState`: if a claim/light field helps tests, append it **at END** (`testApi.ts` + `harness.ts` +
    `refactor-tripwire` golden together). Tier-1 test for any pure helper (claim predicate, gradient
    falloff math); confirm `npm run smoke`.
  - Docs: `docs/GAME-DESIGN.md` (day/night + light-only sightline), `docs/DECISIONS.md` /
    `docs/decisions/gameplay.md` (light-only night + gradient + player light landed), `docs/STATUS.md`,
    `docs/RENDERING.md` (light field).
  - Done when: claim boundary + light edge are legible in-game, and all three test tiers green.

## Out of scope

- **Off-hand torch item** (held light that raises the player's emitted radius) and **torch buildable**
  (perimeter lighting, `gameplay.md:176`) — later; both just add sources to the render light seam.
- **Staging (2) multiple hearths / unioned claims** and **(3) walls extending the claim** — later. (The
  render light field already unions multiple sources visually; the *claim* union is still staging (2).)
- **Storage/vision tied to claim** beyond what already exists — this plan is the *placement* gate + the
  *sightline* rendering only.
- **Removing `BASE_ZONE_SIZE`** — retained as the bootstrap claim; don't delete it.
- **Coloured/flickering firelight, normal-mapped lighting, per-tile light levels** — the field is a single
  white-gradient alpha mask; richer lighting is a separate future effort.
