# Skeleton Attack Animation

> Status: planned — run /execute-plan to begin.

## Summary

Give the skeleton mob a **real attack animation** (the Pixel Crawler pack ships none for any
skeleton variant — every variant has only Idle/Run/Death; the mob currently fakes its attack with a
coded lunge + weapon-swing tween from plan 011).

**Delivery path — retarget the player's Slice strip into a skeleton.** The skeleton and the player
rig (`Body_A`) share the same chibi proportions, 64px frame canvas, scale, and anchor conventions.
Repaint `Body_A`'s `Slice_Side-Sheet.png` (8 frames of 64px) into bone (flesh→bone-white, drop hair,
hollow eyes, hint ribcage, paint out the hero's held weapon so the runtime-pinned bone weapon shows)
→ a new **side-only** one-shot attack anim, flipped for left, matching how the skeleton's
Run/Idle/Death already work. Wired as a new `enemyAttackKey` StripAnim, triggered on the mob's
existing attack cadence, with the body animation **replacing** the coded weapon-swing tween (the
weapon rides per-frame anchors through the swing instead).

**In parallel, a standalone R&D spike — PixelLab.** Trial the `bitforge` model with a skeleton frame
as `--style-image` (the untested lever flagged in `docs/ASSET-EXPERIMENTS.md`) to discharge that TODO
and learn whether PixelLab can match the pack's look. This is a **decoupled spike** — it outputs to
`docs/assets/ai-tests/pixellab/` and its verdict is logged in ASSET-EXPERIMENTS; it does **not** gate
or wire into the game. If it proves surprisingly good, adopting it is a separate future effort.

Supports the base-defense pillar (enemies visibly attacking the base) and makes the coming enemy
night-waves read better (`CLAUDE.md` → Next).

## Context & decisions

**User decisions (this session):**
- **Motion source:** body anim **replaces** the coded swing — weapon pinned to the `mainHand` anchor
  through the attack frames (arcs with the arm); drop the coded `WEAPON_SWING` rotation tween during
  an anim-driven attack. (Gate it, don't delete — see reversibility note below.)
- **Directionality:** **side-only, flipped** — matches the skeleton's single-orientation
  Run/Idle/Death (the pack ships no directional mob frames). *(Revised from an earlier 3-way call
  after the critique: 3-way would triple the manual anchor authoring + art for the lone directional
  state while movement stays single-orientation. Revisit 3-way if/when movement goes 3-way.)* The
  attack flips toward the target at attack-start (from the attacker→target x), independent of the
  movement flip.
- **PixelLab:** **standalone, decoupled R&D spike** *(revised from an in-game compare candidate after
  critique #1 — the plan predicted its own frame-coherence failure, so building throwaway in-game
  compare scaffolding around it was over-built)*. Run-when-reachable (needs `PIXELLAB_API_KEY`);
  verdict logged, no game wiring.
- **Compare harness:** none needed now (PixelLab decoupled). Keep a small reusable DEV-menu **"spawn
  attacker"** button as the acceptance-check tool for the real attack.

**Art source-of-truth (resolves critique #3):** the committed final `Attack_Side-Sheet.png` is
**hand-authored** (the skeletal detail is what sells "skeleton, not pale hero"). An optional
palette-remap **scaffold** (script or Aseprite's own recolour) may seed it, but it writes to a raw
scratch path and is never the source of truth — re-running it must not clobber the hand-cleaned final.

**Art location (decided):** `public/assets/tilesets/pixel-crawler/_derived/skeleton/Attack_Side-Sheet.png`.
`url(strip.path)` in `PreloadScene` resolves paths under the pixel-crawler pack dir, so `_derived/`
is the zero-surprise home (mirrors the bone weapons at `_derived/weapons/*.png`). This art is
genuinely **derived from** the pack's `Body_A` Slice, so `pack.json`'s `selfMade:['_derived/**']`
tag is accurate here.

**Key files/patterns to mirror (verified against source in research + critique):**
- Enemy manifest interface (add `attack: StripAnim`): `src/data/tileset.ts:160-169`; data entry:
  `:347-441`; anim-key consts: `:483-489` — add `export const enemyAttackKey = 'enemy-attack';` as a
  **plain string const** alongside `enemyWalkKey`/`enemyIdleKey`/`enemyDeathKey` (side-only ⇒ no
  facing function; unlike the player's `playerAnimKey(state,facing)`). No existing callers to break.
- Strip types: `StripAnim` (`:51-71`; `anchors` arrays MUST have length == `frames`, asserted in
  `data.test.ts`), `AttachPoint` (`:38-42`, frame-pixel space).
- Load: `PreloadScene.ts:92-114` (`loadStrip(key, strip)`; enemy strips at `:112-114`) — add
  `loadStrip(enemyAttackKey, enemy.attack)`.
- Register anims: `src/scenes/world/actorAnims.ts:48-82` (enemy block; Death `:72-82` is the
  one-shot `repeat:0` template). Register attack as one-shot at `ACTION_ANIM_FRAMERATE=20`
  (`config.ts:80`), like the player action anims (`:28-47`).
- **One-shot→resume precedent (time-lock, not `animationcomplete`):** `PlayerCharacter.ts:84-92`
  (`attackLockUntil`), `CombatFxManager.playAttackSwing():235-246`.
  **⚠ critique #6 — do NOT copy the player's early `return` verbatim:** the player returns at `:86`
  *before* any attachment pinning, but the mob pins its weapon every tick in `syncAttachments`
  (`MonsterCharacter.ts:271`). The mob's attack branch must still run `syncAttachments` against the
  attack strip each frame, or the pinned weapon/fists freeze mid-swing.
- Enemy state selection: `MonsterCharacter.updateAnim():255-272` (velocity/mode → key; flip-by-x
  `:263-265`). **Attack trigger:** the bite/cadence gate `:198-217` (fires `:208-213`, `env.lungeAt`
  `:210`; cadence from `MONSTER_WEAPONS` `weapons.ts:21-24`). `syncAttachments():281-333` reads the
  **active strip's** anchors — the `activeStrip` union is `'idle'|'walk'` today (`:283`); **extend it
  to include `'attack'`** (don't overload the existing values).
- Coded swing to gate: `CombatFxManager.ts:180-233` (`lungeAt` body-lunge + weapon-swing tween to
  `WEAPON_SWING_ARC_DEG`). Consts: `config.ts:172-174`, `ENEMY_LUNGE_PX/MS` `:163-164`.
  `weaponTransform` `extraRot` (`attachment.ts:52-68`) is the coded swing angle — keep it 0 during an
  anim attack (no double-swing).
- Dev harness: DEV menu `UIScene.ts:424-467` (mirror the Randomise action `:455`); programmatic spawn
  `window.game.__test.addEnemy(id,col,row,opts)` (`GameScene.ts:438`, `testApi.ts:105`, DEV-only
  `:420-421`); `MonsterSpawnOpts = {patrolRoute?, mode?, weaponId?}`.
- PixelLab tooling: `scripts/gen-art/pixellab.mjs` — `--model bitforge` (auto when `--style-image`
  set), `--style-image <png>` + `--style-strength`, `--description`, `--width/--height` (free-tier
  min 32), `--no-background`, `--out`; auth `PIXELLAB_API_KEY` via `.env` (`requireEnv` throws a
  redacted error, never echoes the key). Outputs default under `scripts/.gen-art/`.
- Self-made / derived art: `pixel-crawler/_derived/` (tagged self-made); catalog via
  `npm run assets:catalog` (`scripts/asset-catalog.mjs`). Art-pipeline rules: `docs/ASSETS.md`.
  Existing **PIL** pipeline lives at `scripts/gen-icons/` (Python) — site any recolour scaffold there
  to reuse its runtime rather than adding a Node image dep to the all-`.mjs` `scripts/gen-art/`
  (critique #8).

**Contradiction flagged by research:** `pixel-crawler/pack.json`'s `overrides.frames` is
**catalog-only**; runtime frame slicing lives solely in `src/data/tileset.ts`. The attack strip must
declare its slicing (`frameSize:64, frames:8`) in `tileset.ts` regardless of the catalog.

**Reversibility (verified sound):** the manifest `attack` field is additive; Step 7 **gates** the
coded swing rather than deleting it and keeps the `WEAPON_SWING_*` consts — so an unarmed/anim-less
mob still falls back to the old behaviour. No one-way doors.

## Steps

### Stage A — Art

- [ ] **Step 1: Prep source + working dir** `[inline]`
  - Confirm `Body_A` `Slice_Side-Sheet.png` dims (expected 8×64):
    `public/assets/tilesets/pixel-crawler/Entities/Characters/Body_A/Animations/Slice_Base/Slice_Side-Sheet.png`.
  - Extract a clean skeleton reference frame (frame 0 = leftmost 64px of
    `Entities/Mobs/Skeleton Crew/Skeleton - Base/Run/Run-Sheet.png`) → `docs/assets/ai-tests/pixellab/skeleton-ref.png`
    (64×64) — serves both the PixelLab spike (`--style-image`) and the repaint reference.
  - Create `public/assets/tilesets/pixel-crawler/_derived/skeleton/` (add `.gitkeep`).
  - Side effects: new files only; never modify the pack's own PNGs (load-in-place rule).
  - Done when: `skeleton-ref.png` (64×64) exists, `Slice_Side` confirmed 8×64, `_derived/skeleton/` exists.

- [ ] **Step 2: Retarget Slice_Side → bone `Attack_Side` (delivery art)** `[inline]` *(hand-art step — not delegable)*
  - Produce `public/assets/tilesets/pixel-crawler/_derived/skeleton/Attack_Side-Sheet.png` (8×64):
    repaint the hero into a skeleton — flesh→bone-white/grey, drop hair, hollow eye sockets, hint
    ribcage, thin the limbs, and **null out the hero's held weapon** (the runtime pins the bone
    weapon). Preserve the 8-frame layout, pivots, swing arc, and transparency.
  - Optional scaffold: a quick palette-remap (a small PIL script sited beside `scripts/gen-icons/` to
    reuse its Python env, **or** Aseprite's built-in recolour) may seed the file, writing to a raw
    scratch path only. The committed final is **hand-authored** and is the source of truth — a
    re-run of any scaffold must not overwrite it.
  - Side effects: new PNG (+ optional scaffold script). Run `npm run assets:catalog` after it lands.
  - Docs: ASSETS derived-manifest row deferred to Step 9.
  - Done when: `Attack_Side-Sheet.png` reads as a recognisable skeleton mid-swing at game scale, 8×64,
    weapon area cleared.

- [ ] **Step 3: PixelLab bitforge `style_image` spike (decoupled R&D)** `[inline]` *(gated: needs `PIXELLAB_API_KEY`; independent of all other steps)*
  - `scripts/gen-art/pixellab.mjs --model bitforge --style-image
    docs/assets/ai-tests/pixellab/skeleton-ref.png --style-strength <tune> --no-background --width 64
    --height 64 --description "pixel-art skeleton mid side-swing melee attack, bone white, ..."`.
    Generate a few attack poses; assess style-match vs the ref.
  - Outputs + a short `skeleton-attack-notes.md` verdict under `docs/assets/ai-tests/pixellab/`.
    **No game wiring, no `_derived/` copy** — this only informs the ASSET-EXPERIMENTS write-up (Step 9).
  - Gate: if `PIXELLAB_API_KEY` is absent/unreachable, skip and note it; re-run when reachable. This
    never blocks the delivery path (Steps 1–2, 4–9).
  - Side effects: none in `src/`. Never echo the key.
  - Done when: either candidate poses + a verdict exist under `docs/assets/ai-tests/pixellab/`, or a
    note records the key was unreachable.

### Stage B — Wire the attack (side-only, real)

- [ ] **Step 4: Author per-frame anchors for the attack strip** `[inline]`
  - Author `anchors.mainHand[8]` + `anchors.offHand[8]` (`AttachPoint`, frame-pixel space) for
    `Attack_Side-Sheet.png`, tracking the gripping/free fist through the swing so the pinned bone
    weapon arcs with the arm (matches idle/walk anchor style at `tileset.ts:357-403`). `mainHand.rot`
    can lean the weapon along the arc. Use the Step-6 DEV button + a temporary marker overlay, or
    visual pixel inspection.
  - Side effects: array lengths MUST equal `frames` (8) or `data.test.ts` fails. Author against the
    final Step-2 art.
  - Done when: mainHand + offHand arrays (8 each) are ready to paste into the manifest.

- [ ] **Step 5: Manifest + load + register the attack anim** `[delegate sonnet]`
  - `src/data/tileset.ts`: add `attack: StripAnim` to the enemy interface (`:160-169`) and data entry
    (`:347-441`) — `path` `_derived/skeleton/Attack_Side-Sheet.png`, `frameSize:64`, `frames:8`,
    `anchors` from Step 4, default `render`. Add `export const enemyAttackKey = 'enemy-attack';` near
    `:483-489` (plain const, like the other enemy keys).
  - `src/scenes/PreloadScene.ts:112-114`: `loadStrip(enemyAttackKey, enemy.attack)`.
  - `src/scenes/world/actorAnims.ts:48-82`: register `enemy-attack` as **one-shot** (`repeat:0`) at
    `ACTION_ANIM_FRAMERATE`, guarded by `anims.exists` — mirror the Death block but action-framerate.
  - Side effects: enemy-interface change is caught by `npm run build` (tsc). Run `npm run assets:catalog`.
  - Done when: `npm run build` clean; the `enemy-attack` texture + one-shot anim exist at runtime.

- [ ] **Step 6: Attack state — trigger, flip-to-target, time-lock, weapon tracking** `[inline]`
  - `src/entities/MonsterCharacter.ts`:
    - Extend the `activeStrip` union (`:283`) to `'idle'|'walk'|'attack'`.
    - Add an `attackLockUntil` field. When the bite fires (`:208-213`): `setFlipX(targetX < this.x)`
      (face the target), play `enemyAttackKey`, set `attackLockUntil = now + anim.duration` (mirror
      `CombatFxManager.playAttackSwing():243-245`).
    - `updateAnim()` (`:255-272`): while `now < attackLockUntil`, select the attack strip **and still
      run `syncAttachments` against it every tick** — do NOT early-return before the pin (critique
      #6); the weapon must keep tracking the swing. After the lock, normal idle/walk selection
      resumes.
    - `syncAttachments()` (`:281-333`): read the attack strip's anchors when active. Footprint: reuse
      the 64px default (attack canvas is 64px) — no new `setFootprint` case.
  - Add a DEV-menu **"Spawn attacker"** button (`UIScene.ts:439-467`, mirror Randomise `:455`) that
    spawns a skeleton next to the player via `__test.addEnemy('kidZombie', col, row, {mode:'chase'})`
    so it walks in and attacks. Keep it (DEV-gated, reusable).
  - Side effects: verify the lock doesn't wedge movement (attack fires only in the melee-contact
    branch) and the mob resumes run/idle after the swing.
  - Done when: via the DEV button, a spawned skeleton faces the player, plays the one-shot attack on
    each bite with the weapon tracking the swing, then resumes moving.

- [ ] **Step 7: Retire the coded weapon-swing during anim attacks** `[inline]`
  - `CombatFxManager.ts:180-233`: gate the **weapon-swing rotation tween** (`:210-232`) so it does
    NOT run when the anim attack plays (`extraRot` stays 0 → no double-swing). Keep or fold in the
    small positional lunge (`ENEMY_LUNGE_PX/MS`); default: keep the lunge, drop the rotation tween.
    Leave the `WEAPON_SWING_*` consts (`config.ts:172-174`) in place as the fallback for anim-less mobs.
  - Side effects: the "two systems fighting" risk — verify one clean swing, no jitter/double-arc, and
    that a mob without an attack anim still uses the old coded behaviour.
  - Done when: the attack shows a single clean anim-driven swing, no residual coded arc.

### Stage C — Tests & docs

- [ ] **Step 8: Tests** `[delegate sonnet]` (parallel: A)
  - Extend `tests/**/data.test.ts` anchor-length assertions to cover the attack strip
    (`anchors.mainHand.length === 8 && anchors.offHand.length === 8`).
  - If the flip-to-target logic is extracted as a pure helper, add a small unit for it.
  - `npm run smoke` must stay green (33/33, no console errors).
  - Side effects: `tests/` only.
  - Done when: assertions pass, smoke green.

- [ ] **Step 9: Docs** `[delegate sonnet]` (parallel: A)
  - `docs/ASSETS.md`: add the skeleton attack to the "concrete frames wired" narrative + a
    derived-file manifest row (`_derived/skeleton/Attack_Side-Sheet.png` ← origin: retargeted +
    hand-authored from `Body_A` `Slice_Side`, side-only, flipped). Update the "pack ships no skeleton
    attack strip" lines (`:159-160`, `:200-202`) to point at the new anim.
  - `docs/ASSET-EXPERIMENTS.md`: write up the **PixelLab bitforge `style_image` spike** (the untested
    lever `:73`) — settings, verdict on style-match/frame-coherence, decision (not adopted / worth
    revisiting via its animation API).
  - `docs/DECISIONS.md`: log "skeleton attack = real side-only anim replacing the coded weapon-swing"
    and "PixelLab kept as a decoupled R&D spike, recolour is the delivery path".
  - `docs/STATUS.md` + `CLAUDE.md` Status line: note the skeleton attack anim landed. Terse edits.
  - Side effects: docs only; write-disjoint from Step 8.
  - Done when: docs reflect the shipped anim, the recolour pipeline, and the spike verdict.

## Out of scope

- **3-way (Down/Side/Up) attack** and directional **Run/Idle/Death** movement — the pack ships no
  directional mob frames; side-only stands. Revisit together if movement ever goes 3-way.
- **Warrior/Rogue/Mage** attack anims — the side art recolours to them later; wiring is a follow-up.
- **Adopting PixelLab** as a production art path (incl. its dedicated animation API) — the spike only
  informs a future call; `pixellab.mjs` wires only the single-image `bitforge`/`pixflux` endpoints.
- Moving self-made art to `mostowo-custom/` (needs strip-path-resolution work) — `_derived/` is
  correct for this pack-derived recolour.
- Attack **balance/AI** (damage, cadence, telegraph) — cadence stays `MONSTER_WEAPONS`; this feature
  is the animation.

## Critique

> Independent fresh-eyes review (2026-07-14). Addressed in this revision — kept for the record.

**Verdict:** Solid, convention-aware plan whose wiring will work — but it's over-built for "one
attack animation": the PixelLab compare arm + throwaway in-game shim should be decoupled from the
delivery path, and a PixelLab win logically strands the 3-way completion stage. *(Resolved: PixelLab
decoupled to a standalone spike; attack scoped to side-only; delivery = recolour.)*

|#|Finding|Severity|Resolution in this revision|
|-|-------|--------|---------------------------|
|1|Two parallel art pipelines + throwaway `?attack=` in-game shim built around a candidate the plan predicts will fail|High|PixelLab is now a decoupled R&D spike (Step 3, no game wiring); recolour is the delivery path; `?attack=` shim + teardown removed|
|2|Side-only compare, but a PixelLab Side win demands the doubted coherent Down/Up|Medium|Moot — side-only delivery, no 3-way completion stage|
|3|Recolour "reproducibility" illusory; hand-cleanup isn't reproducible and re-runs clobber it|Medium|Final art is hand-authored (source of truth); scaffold is optional, writes to a scratch path only|
|4|3-way attack over single-orientation movement triples anchor/art work for one state|Medium|Adopted side-only, flipped (matches the skeleton rig)|
|5|Adjacent to the stated Next (night-waves/equipment); polishes an already-working coded tell|Medium|Accepted — deliberate fidelity polish for the base-defense pillar; user confirmed the spend|
|6|Copying the player's early `return` skips `syncAttachments`, freezing the pinned weapon mid-swing; `activeStrip` union needs an explicit `attack` state|Medium|Step 6 keeps `syncAttachments` running against the attack strip each tick and extends the union to `'attack'`|
|7|AI-gen art in `_derived/` would be mislabelled self-made-from-pack|Low|Moot — delivery art is genuinely derived from `Body_A` Slice, so the tag is accurate; PixelLab output stays under `docs/assets/ai-tests/`|
|8|Python+PIL script in all-`.mjs` `scripts/gen-art/` mixes runtimes|Low|Any recolour scaffold sited beside the existing PIL pipeline (`scripts/gen-icons/`)|
