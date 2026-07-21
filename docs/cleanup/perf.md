# Cleanup: Performance lens (`GameScene.update()` hot path)

Per-frame allocation / iteration / redundant-work audit of the `update()` path
(`src/scenes/GameScene.ts:979-1073`) and every manager it ticks each frame.

Behavior-risk: **safe** = behavior-preserving; **needs-review** = could change behavior.
Only `safe` + `[fix]` items are applied in Phase 4 Step 15.

## Seeded-claim verification

|Seed claim|Reality|Verdict|
|---|---|---|
|`enemyManager.all()` returns a fresh array each call|`EnemyManager.ts:157-159` returns raw backing array `this.enemies`; no copy|FALSE — no allocation, no fix|
|`syncEnemyHealthBars` iterates all enemies each frame|Confirmed (`CombatFxManager.ts:395-471`, called `GameScene.ts:1020`)|TRUE — see item 1|
|`syncGlowTransforms` runs unconditionally|Call is unconditional (`GameScene.ts:981`) but loop is over `glowSprites` (empty when idle)|TRUE but low cost — see item 3|

## Findings

|#|Item|file:line|Cost (what / how often)|Proposed safe fix|Behavior-risk|Tag|
|---|---|---|---|---|---|---|
|1|`syncEnemyHealthBars` per-frame array/Set/sort churn|`CombatFxManager.ts:395-471`; call `GameScene.ts:1020`|Every frame (above early-return): `live=filter` array + full-live near-death loop + `candidates` filter array + `.sort` + `.slice` + `.map` + `new Set` + 3 closures. Scales with live-enemy count (night waves)|Reuse preallocated scratch arrays; skip candidate/Set build when no target and no recent-hit; avoid re-sorting when ≤1 candidate|safe|[log]|
|2|`syncEnemyHealthBars` no-work guard|`CombatFxManager.ts:400-401`|Runs full body even with zero enemies|Early-return `if (enemies.length === 0 && this.hpBars.size === 0) return;` (must also gate on `hpBars.size` — else stale bars from enemies that died this frame are never destroyed, see `:432-438`)|safe|[fix] ✅ applied (Step 15)|
|3|`syncGlowTransforms` unconditional call|`TaskGlowRenderer.ts:187-195`; call `GameScene.ts:981`|Called every frame; Map-iterator allocation even when no harvest is queued (0 iterations)|`if (this.glowSprites.size === 0) return;`|safe|[fix] ✅ applied (Step 15)|
|4|`EnemyManager.update` rebuilds env + ~11 closures every frame|`EnemyManager.ts:192-243`; call `GameScene.ts:1042,1072`|Every frame: new `threats` array + `hurtboxTiles()` alloc + `MonsterTickEnv` object with ~11 arrow closures re-created regardless of enemy count|Cache the stable closures (`isBlocked`/`rng`/`lungeAt`/…) in an env built once per (re)start; mutate only per-frame fields (`nowMs`, `threats`, `fire`) each tick|needs-review|[log]|
|5|`MonsterCharacter.update` per-enemy object churn|`MonsterCharacter.ts:248-273` (+ `253,254`)|Per enemy per frame: `stepMonster` ctx literal + `{col,row}`/`{x,y}` literals; scales with enemy count|Reuse a per-monster scratch ctx object; hoist invariant fields|needs-review|[log]|
|6|Companion combat snapshot rebuilt every frame|`GameScene.ts:513-523` (`enemies()` dep) via `CompanionManager.ts:557`|While a spawned companion is in a night combat/guard/follow posture: `all().filter().map()` builds a full snapshot array + per-enemy `hurtboxTiles` arrays/objects every frame|Reuse a scratch buffer, or share one snapshot with `EnemyManager.update`'s threat build|needs-review|[log]|
|7|`litHearth()` allocates result object each call|`GameScene.ts:1495-1503`|Called each frame in `EnemyManager` env build (`EnemyManager.ts:231`) + wave `defendCentre`; `campfire.all().find` + new nested object when a fire is lit|Memoize once per frame (compute in `update()`, pass down)|needs-review|[log]|
|8|`structureManager.lightSources()` allocates + spreads each call|`StructureManager.ts:103-107`|1×/frame via `VisionController.update`; +1× at night via `SurvivalClock.composite` (which also spreads + allocs `playerLight`) — small (one campfire module)|Low value; could reuse a buffer. Leave unless profiling shows cost|safe|[log]|
|9|Duplicated tail in `update()`|`GameScene.ts:1041-1042` vs `1071-1072`|`visionController.update()` + `enemyManager.update()` duplicated across both branches (only one runs — not a perf cost, a DRY/readability note)|Hoist the two calls below the branch|safe|[log]|

## Not hot (verified, no action)

- `WaveDirector.tick` (`WaveDirector.ts:135-150`) — cheap timer increments; the spiral spawn search
  (`:203-205`) only runs on spawn beats, not per frame.
- `VisionController.update` (`VisionController.ts:89-98`) — per-frame `fogShape.clear()` + `fillCircle`
  is inherent to fog tracking the moving player; not redundant.
- `SurvivalClock.composite` (`SurvivalClock.ts:251-267`) — early-returns before the light loop during
  full daylight (`:260`); only touches `lightSources()` at night/twilight.
- `updateCombatActive` (`GameScene.ts:1792-1809`) / `syncBowTarget` (`GameScene.ts:1641-1652`) —
  one `.some`/`.find` with a single closure each; no array allocation (`some` short-circuits).
