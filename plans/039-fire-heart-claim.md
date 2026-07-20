# Fire-Heart Claim — Lit Radius Replaces the Base Rect

> Status: planned — run /execute-plan to begin. **Depends on plan 038** (needs the fire-heart / lit
> hearth in place). Non-blocking for the first playable loop — sequence after 038's wave loop lands.

## Summary

Complete GAME-DESIGN staging (1) of the campfire-heart: **your base is where your fire's light reaches**.
Replace the fixed `BASE_ZONE_SIZE` rectangle that gates `baseOnly` building with a test against the
campfire's **lit radius** (`CampfireManager.inLight`/`lightSources()`), so the claim *is* the fireline.
This was peeled out of plan 038 (critique #3): it's orthogonal to the defend loop, it's a real
feel-affecting design change (the placement area shrinks from a 21×27 rect to a fuel-fluctuating ~8-tile
disc, down to ~3 tiles near-empty), and it carries a bootstrap chicken-and-egg (the first campfire is
itself `baseOnly`). Keeping it separate lets it be playtested on its own without gating the wave.

## Context & decisions

**Direction:** `docs/GAME-DESIGN.md` "Base claim — the campfire heart" (`:344-372`), settled in
`docs/decisions/gameplay.md:175-190` ([DECIDED] 2026-07-19, chosen over walls-enclosure). Staging
(`GAME-DESIGN.md:371-372`): **(1) base zone becomes the central hearth's radius, replacing the rect**;
(2) multiple fires union claims; (3) walls extend the boundary. **This plan does staging (1) only.**

**Locked decisions:**

1. **Claim = any lit hearth's radius.** A tile is claimable iff inside a lit fire's light disc (world-px
   granularity via `CampfireManager.inLight`).
2. **Bootstrap:** while **no lit hearth exists**, fall back to the existing `BASE_ZONE_SIZE` rect so the
   first (`baseOnly`) campfire can still be placed. Once a hearth is lit, the light-radius claim governs.
3. **Fuel-coupled placement is intended, not a bug** — the claim breathing with fuel is the fantasy
   ("hold the fireline"). Playtest the near-empty minimum so it doesn't get frustrating; the light-radius
   floor is `CAMPFIRE_LIGHT_MIN_FRAC` (`config.ts`).

**Key files & patterns (from repo sweep):**

- `BASE_ZONE_SIZE={w:21,h:27}` (`config.ts:382`) around `SPAWN_TILE` (`:376`); pure math `systems/base.ts`
  (`isInBase`, `baseZoneFromSpawn`). **Only runtime consumer:** `BuildManager` — `baseZoneRect`
  (`BuildManager.ts:79`) gating `baseOnly` in `tilePlaceable` (`:143-144`). **No base-rect rendering
  anywhere** (`baseZoneTileRect` was intended for an outline never built).
- `CampfireManager.inLight(x,y)` (`CampfireManager.ts:248`) + `lightSources()` (`:233`) already implement
  the lit-disc test at world-px granularity; radius scales with fuel. Thread these into BuildManager via a
  **dep closure** (scene mediates — no manager↔manager edge), matching the manager convention.
- Vision already reveals the lit area (SurvivalClock night mask + VisionController), so the claim is
  visually legible without new rendering; an explicit claim outline is optional (see Step 2).

## Steps

- [ ] **Step 1: Swap the `baseOnly` placement gate to the lit-radius test (with bootstrap)** `[inline]`
  - In `BuildManager.tilePlaceable` (`:143-144`), replace `isInBase(baseZoneRect, col, row)` for `baseOnly`
    buildables with an "inside any lit hearth's radius" test, using a threaded dep (e.g. `deps.inClaim(col,row)`
    → the scene calls `campfireManager.inLight(worldX, worldY)` for the tile centre). **Bootstrap branch:**
    if no lit hearth exists, fall back to `isInBase(baseZoneRect,…)` so the first campfire is placeable.
  - Side effects: `BuildManager` (new dep + bootstrap branch); `GameScene` wires the dep; confirm nothing
    else reads `baseZoneRect` for gameplay (sweep confirmed only BuildManager does). Tile→world-px
    conversion must match how `inLight` expects coordinates.
  - Docs: `docs/decisions/gameplay.md` (mark staging (1) done); `docs/STATUS.md`.
  - Done when: Tier-2 scenario — with a lit hearth, a `baseOnly` buildable places only within the lit
    radius and is rejected just outside it; with no hearth, the bootstrap rect still allows the first
    campfire; draining fuel shrinks the placeable area (assert a tile flips from placeable to rejected as
    fuel drops).

- [ ] **Step 2: Claim legibility + tests + docs** `[inline]`
  - Optional but recommended: a subtle claim-edge cue so players understand *why* placement is rejected
    (e.g. reuse the build-preview invalid tint at the claim boundary, or a faint outline at the lit-radius
    edge — reuse `render/` baked-texture or the existing placement-preview path; do NOT add a frame-loop
    shader). If it proves fiddly, ship Step 1 alone and note the deferral.
  - `DebugState`: if a claim field helps tests, append it **at END** (`testApi.ts` + `harness.ts` +
    `refactor-tripwire` golden together). Tier-1 test for any pure claim helper; confirm `npm run smoke`.
  - Docs: `docs/GAME-DESIGN.md`/`docs/DECISIONS.md` touch-ups if behaviour refines the design; STATUS.
  - Done when: the claim boundary is legible in-game (or deferral noted), all three test tiers green.

## Out of scope

- **Staging (2) multiple hearths / unioned claims** and **(3) walls extending the claim** — later.
- **Storage/vision tied to claim** beyond what already exists — this plan is the *placement* gate only.
- **Removing `BASE_ZONE_SIZE`** — retained as the bootstrap claim; don't delete it.
