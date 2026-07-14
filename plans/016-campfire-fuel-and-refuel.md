# Campfire — fuel-scaled flame/light + queueable refuel

> Status: executed on branch `plan-016-campfire` (worktree, alongside concurrent sessions), 2026-07-14.
> Build/typecheck clean, unit 297/297, campfire e2e 8/8 (full e2e green single-worker; 2 known
> MainMenu-tap parallel-load flakes). Advisor-reviewed (2026-07-13).
>
> **Deviation from Step 3 (flame rendering):** the planned sheet-swap across Bonfire_01..08 was
> abandoned mid-execution — a screenshot showed those sheets are NOT a clean intensity ramp (01/02/04
> braziers, 06/08 bare flames), so swapping morphed the fire's *structure*. Replaced with **one
> consistent sprite (Bonfire_07) scaled by `fuelFrac`**; the advisor's objections to scaling were moot
> given the column-pick + stroked-rect choices already made. Light-radius lerp, refuel-as-order, and
> the pick fix all landed as planned. See DECISIONS.md 2026-07-14.

## Summary
Three playtest issues with the plan-012 campfire, all fixed by one interlocking change:

1. **The flame and light are static.** The fire renders `Bonfire_05` at a fixed scale and casts a
   fixed `light * TILE_SIZE` radius regardless of fuel — so it reads as "no flame" and never grows.
   **Fix:** the flame **intensity** and the **light radius** both scale with fuel (embers → roaring).
2. **Refuel is an instant tap.** Tapping the fire spends 1 wood *instantly, from anywhere* — no walk,
   no queue, no outline. **Fix:** refuel becomes a **queued worker order** exactly like chop/mine —
   the worker walks adjacent, tends the fire over time, and the target shows the yellow queued outline.
3. **Tapping the fire sometimes just walks the worker into it and jams.** When the tap misses (no wood,
   or a transparent flame pixel) it falls through to a move order onto the `blocksPath` fire tile.
   **Fix:** a tap on the fire *always* resolves to a refuel action (never a move), and the fire is
   hit-tested on its whole 2-tile column so the pick can't miss.

## Context & decisions

**Advisor review (2026-07-13)** — the shape (new `refuel` Action + fuel-scaled render) was endorsed
with three load-bearing amendments, all folded into the steps below:

- **A — resolve refuel in `ScenePicker.actionAt`, not a special-case in `onTap`.** `actionAt` returns
  `{kind:'refuel',campfireId}` when the raycast lands on a campfire (before the move fallback). This
  *deletes* `campfireAt` + the onTap pre-check, gives paint-drag the same behaviour for free, and
  **structurally eliminates** the fall-through-to-move bug instead of patching around it.
- **B — sheet-swap the flame, lerp the light.** Do **NOT** `setScale` the sprite by fuel: every
  `Bonfire_0x` frame draws the **log base too**, so scaling shrinks the logs (reads wrong), fights
  `flare()` (which resets scale from the def), and destabilises `alphaHit` picking. Assets
  `Bonfire_01..08` are authored as 8 flame-intensity levels — swap the sheet by a fuel bucket. Light
  radius is pure math → lerp it continuously.
- **C — outline with a stroked rect, not a baked glow.** `bakeGlowTexture` reads
  `getSourceImage()` = the **whole 128×32 sheet**, so a tree-style halo bakes around all 4 frames
  side-by-side (a 4-tile-wide smear). The fire also animates / flares / swaps textures — three sync
  problems the static tree halo never has. A yellow **stroked rect** over the fire's tile column
  (pushed into `queueMarkers` so `reset()` cleans it) matches the queued-*site* stroke style with zero
  traps.

**Refuel is a persistent order — it must self-terminate on conditions, not on entity death** (a fire,
unlike a felled tree, persists):
- Complete when **a full wood no longer fits**: `CAMPFIRE_FUEL_MAX - fuel < CAMPFIRE_FUEL_PER_WOOD`,
  checked *before* each feed. Do **NOT** test `fuel >= MAX` — `tick()` drains every frame, so strict-
  full is never observable and the order would spin forever. This "no-waste" rule wastes no wood
  (never feeds a unit that would overflow the clamp).
- Complete when **`spend({wood:1})` fails** mid-order (bag ran dry) — abort with a visible flash, don't
  idle-wait. Mirrors `runHarvest`'s bag-full abort (plan-003 critique #1: an order that can't progress
  must abort, not jam the queue head).
- Keep **CampfireManager the sole fuel/sprite writer**: it exposes `feedOne(c)` (spend → top up →
  relight → flare); the executor and the `__test.feedCampfire` hook both route through it (so
  `feedAt` becomes a thin delegate, not a parallel path).

**The residual bug a queued refuel does NOT fix — one required companion change (Step 2):** pick
reliability. `alphaHit` samples the *current anim frame*, and low-fuel ember sheets have a tiny opaque
region, so alpha picks would flicker-miss and fall back to move again — issue 3 would partially
regress, *worse* with intensity sheets. So `pickSpriteAt` must hit-test the fire's **full `tilesTall`
column** — `(col,row)` **and** `(col,row-1)` — like an enemy hurtbox, so the fire is always tappable
on its two logical tiles regardless of frame/intensity.

**Out-of-scope residual (follow-up, not this plan):** the *physical* jam can still happen for a move
order beside any wall — `BuildManager` wires a player↔walls static collider and `advancePath` has no
stall watchdog, so a corner-cutting path can stall with velocity pinned into a body. Refuel removes the
campfire trigger; a general fix (stall watchdog in `advancePath`: no waypoint progress for N ms →
repath/complete) is logged for later.

**Tuning defaults (all new constants live in `src/config.ts`, all tunable):**
- `CAMPFIRE_FEED_INTERVAL_MS = 1000` — one wood consumed per this interval while tending (own knob,
  not reused `CHOP_INTERVAL_MS`); an empty fire refills in ~4s (4 wood).
- `CAMPFIRE_LIGHT_MIN_FRAC = 0.4` — light radius at near-empty is 40% of full; `radius = light *
  TILE_SIZE * lerp(0.4, 1, fuel/MAX)`. At full → 8 tiles (128px), near-empty → ~3.2 tiles.
- Flame bucket = `clamp(ceil(8 * fuel/CAMPFIRE_FUEL_MAX), 1, 8)` → `Bonfire_0{bucket}-Sheet.png`
  (~15s of burn per bucket at 1 fuel/s). Native render kept at `tilesTall: 2` (crisp, no upscale).

## Key findings (files/patterns to mirror)

- **Action union + queue** — `src/systems/tasks.ts`: `Action = move | harvest | build`. `TaskQueue`
  is generic over the match fn (`removeWhere`), so a new variant needs **no queue-logic change**.
- **onTap / order / enqueue / toggle** — `GameScene.ts`: `onTap` (~L307) currently pre-checks
  `campfireAt`→`feedAt` then `actionAt`; `enqueue` (~L653) toggles a re-tapped harvest via
  `isHarvestQueued`/`toggleHarvest` (~L664-676); `beginCurrent` (~L588) computes the stand tile per
  action kind; `runHarvest` (~L697) is the walk-then-swing template; `harvestSwing` drives the tend
  anim (`'gather'` = forage/Collect). `chopElapsed` is the shared per-action timer (reset in
  `beginCurrent`).
- **ScenePicker** — `actionAt` (tree→harvest, else move), `campfireAt` (to be deleted), `pickSpriteAt`
  (the raycast; campfire loop at L142 currently foot-tile-OR-alphaHit). Enemies already column/hurtbox
  hit-test — the pattern to copy for the fire column.
- **CampfireManager** — `materialise`/`tick`/`feedAt`/`lightSources`/`douse`/`light`/`flare`;
  `campfireAt(col,row)` exists, **no `campfireById`** yet. Sole writer of anim/tint; SHUTDOWN drops
  refs only (never `.destroy()`).
- **TaskGlowRenderer** — `refreshQueueHighlights` outlines trees (baked halo) + sites (rect stroke) +
  move pips (`queueMarkers` rects, depth 4, torn down in `reset()`); **no campfire case**, no
  `campfireById` dep.
- **Flame asset** — `Bonfire_01..08-Sheet.png` all 128×32 = 4 frames of 32×32 (verified on disk);
  only `_05` is wired. `tileset.ts stations.campfire` is a single `StripAnim`; `campfireAnimKey()`
  returns `'campfire'`; anim registered once in `actorAnims.ts`.
- **Test seams** — `testApi.feedCampfire(index)` calls `feedAt` (keep green by delegating `feedAt` →
  `feedOne`); `campfire.spec.ts` drain/relight test asserts `feedCampfire` spends exactly 1 wood +
  relights. `DebugState.campfires` = `{col,row,fuel,lit}` (frozen contract — do **not** add fields).

## Steps

- [ ] **Step 1: `refuel` Action variant + queue unit tests** `[delegate sonnet]`
  - `src/systems/tasks.ts`: add `| { kind:'refuel'; campfireId:string }` to `Action` (doc: "path
    adjacent to the fire, feed wood until topped up or out"). No `TaskQueue` change.
  - `src/systems/__tests__/tasks.test.ts` (or wherever queue is tested): add a case that
    `removeWhere` over a `refuel` action handles current-vs-pending correctly (mirror the existing
    harvest removeWhere case).
  - Done when: build/typecheck clean; unit green.

- [ ] **Step 2: Pick reliability — campfire column hit-test + `actionAt`→refuel** `[inline]`
  - `src/scenes/input/ScenePicker.ts`:
    - `pickSpriteAt` campfire loop: hit when `col===c.col && (row===c.row || row===c.row-1)` (the full
      `tilesTall:2` column, like the enemy hurtbox) **OR** `alphaHit(...)`. Load-bearing — without the
      column test, low-fuel ember frames flicker-miss and issue 3 regresses.
    - `actionAt`: after the tree→harvest branch, `if (pick?.kind==='campfire') return {kind:'refuel',
      campfireId: pick.campfire.id}` (before the move fallback).
    - **Delete** `campfireAt` (no longer called once onTap is simplified in Step 4).
  - Done when: a tap anywhere on the fire's two tiles resolves to a refuel action (verified in Step 6).

- [ ] **Step 3: CampfireManager — `campfireById`, `feedOne`, fuel-bucket flame, fuel-lerped light** `[inline]`
  - `src/data/tileset.ts`: make `stations.campfire` a **leveled** entry — a path template
    `Bonfire_0{n}-Sheet.png` + `levels: 8` (or 8 explicit paths), `frameSize:32, frames:4`. Add a
    `campfireLevelKey(n)` accessor (`campfire-1`..`campfire-8`). Keep `campfireAnimKey()` as an alias
    for the default/base if still referenced.
  - `src/scenes/PreloadScene.ts`: load all 8 sheets. `src/scenes/world/actorAnims.ts`: register one
    looping anim per level (guarded by `anims.exists`), same 4-frame cadence.
  - `src/scenes/world/CampfireManager.ts`:
    - Track current render `level` on the unit (manager-owned render state).
    - `materialise`: start at the bucket for full fuel (level 8), play that level's anim. Keep native
      scale (`tilesTall:2`).
    - `tick`: after draining, compute `bucket = clamp(ceil(8*fuel/MAX),1,8)`; **only on change**
      `sprite.play({key: campfireLevelKey(bucket), startFrame: sprite.anims.currentFrame.index})` so
      the loop doesn't visibly restart. `douse`/`light` stop/resume at the current bucket.
    - `lightSources`: `radius = light * TILE_SIZE * lerp(CAMPFIRE_LIGHT_MIN_FRAC, 1, fuel/MAX)` per
      lit fire (read per-frame by SurvivalClock + VisionController → animates for free; fog reveal is
      one-way so a shrinking radius never un-reveals).
    - `campfireById(id)`: find by id (guards the executor against a future destructible fire).
    - `feedOne(c): boolean`: `if(!spend({wood:1})) return false;` → `feedFuel` → relight-if-out →
      `flare` → true. `feedAt(col,row)` becomes `const c=campfireAt(col,row); return c?this.feedOne(c):false`.
    - `flashNoFuel(c)` (or similar): a brief distinct flash (not the success flare) for the "can't
      refuel" abort.
  - `src/config.ts`: add `CAMPFIRE_FEED_INTERVAL_MS = 1000`, `CAMPFIRE_LIGHT_MIN_FRAC = 0.4`.
  - Done when: in `npm run dev` a full fire roars (level 8) and visibly steps down through the ember
    sheets as it burns; the lit hole/vision reveal shrinks with fuel.

- [ ] **Step 4: GameScene — onTap simplification, refuel executor, toggle** `[inline]`
  - `onTap` (+ `onPaint` gets it for free): drop the `campfireAt`/`feedAt` pre-check. `const action =
    scenePicker.actionAt(...)`; `if (action.kind==='harvest' || action.kind==='refuel' ||
    pointer.getDuration()>=LONGPRESS_MS) enqueue(action); else order(action);`
  - `enqueue`: add `if (a.kind==='refuel' && isRefuelQueued(a.campfireId)) { toggleRefuel(...); return; }`.
  - `isRefuelQueued(id)` / `toggleRefuel(id)`: mirror `isHarvestQueued`/`toggleHarvest` keyed on
    `campfireId`.
  - `beginCurrent` refuel branch: `campfireById(id)` (undefined → complete); pre-check
    `inv.canAfford({wood:1})` **and** capacity `MAX-fuel >= PER_WOOD` (else `flashNoFuel` + complete);
    `reachableAdjacent` to the fire's foot tile (all-adjacent, no standOffsets) → `pathTo`.
  - `update` switch: add `case 'refuel': this.runRefuel(action, delta); break;`.
  - `runRefuel`: re-resolve `campfireById` (gone → complete); complete when `MAX-fuel < PER_WOOD`;
    `if (advancePath()) { velocity 0; faceTile(fire); harvestSwing='gather'; chopElapsed += delta; if
    (chopElapsed >= CAMPFIRE_FEED_INTERVAL_MS) { chopElapsed=0; if(!feedOne(c)){ flashNoFuel; complete; } } }`.
  - Done when: tapping a fire queues a refuel with the yellow outline; the worker walks over, tends it
    ('gather' anim), tops it up, then goes idle; re-tapping toggles the order off; never a move-into-fire.

- [ ] **Step 5: TaskGlowRenderer — refuel outline** `[inline]`
  - Add `campfireById(id)` to `TaskGlowRendererDeps` (closure over CampfireManager).
  - `refreshQueueHighlights`: add a `refuel` branch → push a **stroked** `Rectangle` (fillAlpha 0,
    `setStrokeStyle(2, COLORS.queued, 1)`, depth 4) over the fire's tile column (centre
    `x=tileToWorldCenter(col)`, `y=tileToWorldCenter(row)-TILE_SIZE/2`, `w=TILE_SIZE`, `h=2*TILE_SIZE`)
    into `queueMarkers` so `reset()` tears it down. Static (no pulse) — matches the queued-site stroke.
  - Done when: a queued refuel shows a yellow box around the fire; clears when the order completes/toggles.

- [ ] **Step 6: Tests + docs** `[delegate sonnet]`
  - e2e `tests/e2e/campfire.spec.ts` (+ harness/testApi as needed):
    - **Refuel-as-order:** scenario with a near-empty fire + wood + player adjacent; `enqueue`/`order`
      a `{kind:'refuel'}` (or a new `tryRefuel` seam); `step` past the walk+feed; assert fuel rose and
      wood decremented by the number of feeds, then the order **self-completed** (queue idle).
    - **Terminate — full:** seed `campfireFuel` just under MAX; refuel; assert it completes feeding
      ≤1 wood and never spins (queue idle after a bounded `step`).
    - **Terminate — out of wood:** seed low wood; refuel a near-empty fire; assert it aborts (queue
      idle) rather than jamming, wood floored at 0.
    - Keep the existing drain/relight `feedCampfire` test green (now routes through `feedOne`).
  - `src/config.ts` already documents the new constants; update `docs/GAME-MECHANICS.md` campfire
    section: refuel is now a **worker order** (walk + tend, `CAMPFIRE_FEED_INTERVAL_MS`), and flame
    intensity + light radius scale with fuel (`CAMPFIRE_LIGHT_MIN_FRAC`). One line in `docs/STATUS.md`;
    a `docs/DECISIONS.md` entry (refuel-as-order over instant-tap; sheet-swap over sprite-scale;
    stroked-rect over baked-halo; stall-watchdog deferred).
  - Done when: `npm test` + `npm run e2e` green; `npm run build` clean; md-lint clean.

## Out of scope
- **General path-stall watchdog** in `advancePath` (the wall-adjacent jam) — logged follow-up.
- Proximity/tool requirements for tending; auto-refuel by idle workers; a haul-wood job.
- Any campfire secondary use (cooking/warmth); additive/Lights2D lighting (mask + baked textures stay
  the house style).
- Bumping the fire's physical size (`tilesTall`) — native 2-tile render kept; a knob if wanted later.

## Critique
Advisor-reviewed (2026-07-13) — recommendation folded in wholesale (Decisions A/B/C + the refuel
self-termination semantics + the load-bearing Step-2 column hit-test). No open blocking findings; the
one residual (physical wall-jam) is explicitly deferred with a named fix.
