# Torch Rename · Held-Item Overlay · Equipment Panel · Workbench Sprite (plan-049 polish)

> Status: planned — run /execute-plan to begin.

## Summary

Six follow-up fixes to the plan-049 equip slice, gathered on branch
`claude/torch-sprite-equipment-ui-mnp668`: rename the **brand → torch**; make **unequipping return the
(partial) torch to the pack** instead of destroying it; give an equipped torch an **in-hand overlay
sprite** on the player (it currently shows nothing); **suppress the browser's native image
context-menu** on long-press of pack items; add a **Diablo-style equipment panel** (paper-doll body
silhouette with the three live slots); and **generate a new, bigger workbench sprite**.

## Context & decisions

**Locked decisions (owner-confirmed — do NOT re-litigate):**

- **Torch, not brand.** Rename the `brand` item id + display name to `torch`, and the `BRAND_*` config
  consts to `TORCH_*`. This **intentionally overrides plan-049 decision #7** (which reserved `torch`
  for a future buildable perimeter light — that future light, if built, will need a different id).
- **Unequip = return to pack.** Reverses plan-049's equip-to-consume "unequip discards" for the torch:
  unequipping returns the torch to the bag **with its remaining durability preserved**, re-equipping
  resumes from that charge. Only **drain-to-0 destroys** it. Bag-slot durability was out of scope in
  049; here it's a **scene-side stash keyed by item id** (the torch is `maxStack:1`), NOT a change to
  the pure `Inventory`/`Slot` (still untouched).
- **Held torch = overlay sprite, not re-animation.** A single small torch sprite pinned to the player's
  hand, repositioned each frame, `flipX` with facing, carrying the existing raised light. No new
  per-pose player strips (full paper-doll stays deferred to plan 010). Built generic enough that a
  future main-hand/off-hand held item could reuse it, but only the torch is wired here.
- **Equipment panel = 3 live slots on a body.** A paper-doll silhouette showing only `mainHand`,
  `offHand`, `ranged` positioned over the body. No inactive/placeholder slots.
- **Workbench = new Gemini sprite.** Generate a bespoke, larger workbench prop via the Gemini pipeline
  (key pulled off guppi over Tailscale), rendered ~2 tiles tall.

**Patterns/files to mirror (scouted against the current tree):**

- **Item/config**: `src/data/items.ts` (`brand` def, imports `BRAND_DURABILITY`); `src/config.ts`
  (`BRAND_DURABILITY`/`BRAND_LIFETIME_SEC`/`BRAND_DRAIN_PER_SEC`/`BRAND_LIGHT_RADIUS`/
  `BRAND_DRAIN_EMIT_MS`); `src/data/weapons.ts` (no brand entry — melee is sword-only); brand refs in
  `GameScene.ts` (import line ~23, `playerLight()` `litBrand`, `tickBrand()`, `toggleEquip()`),
  `Equipment.ts` (data-agnostic — no brand string), `src/hud/lib/equip.ts` (reads `ITEMS[id].durability`,
  no literal), tests: `src/data/__tests__/data.test.ts`, `tests/e2e/equip.spec.ts` (uses `'brand'`),
  harness seams in `src/scenes/testApi.ts`.
- **Equip system**: `GameScene.toggleEquip()` (`GameScene.ts:1993`) owns bag↔slot bookkeeping;
  `tickBrand()` (`:1964`) drains + destroys; `emitEquipment()` (`:1944`) is the sole HUD forward;
  `Equipment.equip/unequip/drain/slotOf/get` (pure). Store mirror `equipment` + `setEquipment`
  (`store.ts`), bridge `equip:toggle` inbound / `equipment:changed` outbound (`bridge.ts`).
- **HUD**: `PackDrawer.tsx` `PackSlot` `<img>` (no `draggable`/context-menu guard — the bug);
  `Hotbar.tsx` already sets `draggable={false}` on its `<img>` (mirror its guard, add the rest);
  `CommandBar.tsx` scavenge rail (Build · Pack · Status buttons + `onPack`/`onStatus` callback props);
  `GameHud.tsx` owns the drawer open-state + wires the callbacks (mirror for a new Equip drawer/panel);
  `Sheet` primitive (`src/hud/ui/sheet.tsx`) is the drawer pattern.
- **Player render**: `PlayerCharacter` (`src/entities/PlayerCharacter.ts`) — sprite depth 10, scale from
  `ACTIVE_TILESET.actors.player.render` (`tileset.ts:337`, `scale:1, originX:0.5, originY:0.78`);
  `lastFacing`/`facingDir()` drive `flipX`; `update()` in `GameScene` steps the player each frame
  (where the overlay follow-tick hangs). `playerLight()` (`GameScene.ts:1767`) already reads the
  off-hand for the light radius.
- **Workbench**: `buildables.ts` `workbench.objectSprite` (`asset` + `region {x:0,y:84,w:32,h:28}`,
  `tilesTall:1`, `originY:1`); `PreloadScene.ts:205` loads the object-sprite sheet; `WorkbenchBehavior.ts`
  bakes/renders + carries the default bottom-anchor/height fallback.
- **Asset pipeline**: `docs/ASSETS.md` (routing), `docs/AI-SPRITE-PIPELINE.md` (§ Static world-prop
  sprites playbook), `scripts/pixel-crawler/gen_*_gemini.py` + `process_gemini.py` (the image-to-image
  - PIL post-process pattern), `scripts/gen-icons/` (prompt-manifest convention). Gemini key + guppi
  recipe: `CLAUDE.md` "Home server: guppi" + `docs/MOBILE-EDITOR-ACCESS.md`.

**Direction fit** (`CLAUDE.md`/`docs/GAME-DESIGN.md`/`docs/ROADMAP.md`): crafting is the current post-MVP
thrust; equip is its spine. The equipment panel is the first real inventory-management surface (049 left
equip implicit); a relightable/stashable torch matches survival-loop expectations (a torch you can pocket
and re-use); held-item rendering is the first sliver of the deferred paper-doll. All incremental, on-theme.

## Steps

- [x] **Step 1: Rename brand → torch (data, config, refs, tests)** `[inline]`
  - Outcome: renamed item id/name/icon (`items.ts`), recipe key/id/name (`recipes.ts`), all 5 `BRAND_*`→`TORCH_*`
    consts (`config.ts`), runtime refs in `GameScene.ts` (`litTorch`/`tickTorch`/`torchEmitAccumMs`/`=== 'torch'`),
    plus `testApi.ts`, `Equipment.ts`, `types.ts`, `entities/testTypes.ts`, `hud/bridge.ts`, `Hotbar.tsx`,
    `PackDrawer.tsx`, and tests (`data.test.ts`, `orders.test.ts`, `Equipment.test.ts`, `bridge.test.ts`,
    `equip.spec.ts`, `workbench.spec.ts`, `harness.ts`, `refactor-tripwire.spec.ts`). `git mv brand.png torch.png`
    (rename preserved) + `craft-items-art.mjs` output path. CraftMenu/WorkbenchBehavior read `RECIPES` dynamically
    — no literals to change. Final grep: 7 residual "brand" hits, all legitimate English ("brand-new" / "branded
    type"). `npm run build` green; full vitest unit suite green (1010 passed / 74 files). E2e literals renamed,
    left for CI. Nothing outside plan-049/051 history references the old id.
  - `items.ts`: `brand` → `torch` (id + `name: 'Torch'` + `icon: 'torch.png'`); keep `equip:'offHand'`
    - `durability`. Rename the icon file `public/assets/icons/brand.png` → `torch.png` (`git mv`) and
    update its origin in `scripts/craft-items-art.mjs` (the actual generator of `brand.png` — it writes
    the file + carries `brand` comments; there is NO `brand` entry in `scripts/gen-icons/prompts.py`, so
    don't touch that manifest).
  - **Recipe rename (explicit, not just via grep):** `recipes.ts` `RECIPES.brand` — rename the object
    KEY + the entry's `id` + `name` to `torch`; then fix every `recipeId`/id ref: `orders.test.ts`
    (`craft('b1','brand')` → `'torch'`), `tests/e2e/workbench.spec.ts` (`recipeId:'brand'` → `'torch'`),
    and any `CraftMenu`/`WorkbenchBehavior` literal.
  - `config.ts`: `BRAND_DURABILITY`→`TORCH_DURABILITY`, `BRAND_LIFETIME_SEC`→`TORCH_LIFETIME_SEC`,
    `BRAND_DRAIN_PER_SEC`→`TORCH_DRAIN_PER_SEC`, `BRAND_LIGHT_RADIUS`→`TORCH_LIGHT_RADIUS`,
    `BRAND_DRAIN_EMIT_MS`→`TORCH_DRAIN_EMIT_MS` (keep values). Update the doc-comments that say "brand".
  - Update all importers/refs: `GameScene.ts` (import, `playerLight()` `litBrand`→`litTorch` + id check
    `=== 'torch'`, `tickBrand`→`tickTorch`, `brandEmitAccumMs`→`torchEmitAccumMs`, `toggleEquip` comments),
    `data.test.ts`, `tests/e2e/equip.spec.ts` (`'brand'`→`'torch'`, test titles/comments), `testApi.ts`
    seams, and any `docs/` prose that names the brand item (leave the *history* in `plans/049` intact).
  - Side effects: grep `-ri brand src public scripts tests docs` as a final catch-all after the explicit
    renames above; verify no ref survives outside plan-049 history.
  - Docs: none new here (Step 7 does the doc pass); just keep inline comments truthful.
  - Done when: `grep -ri "\bbrand\b" src scripts tests` returns only plan-049 history; `npm run build`
    - `npm test` green; the item shows as "Torch" with `torch.png`.

- [x] **Step 2: Unequip returns the torch to the pack (partial durability persists)** `[inline]`
  - Outcome: `GameScene` gains an `equipCharge: Record<string,number>` stash (reset each (re)start beside
    the `Equipment` rebuild). `toggleEquip` is now add-first/commit-after: unequip does `inv.add(id,1)` and
    **denies (leaves worn, writes nothing) if it returns <1** (bag full) — same guard refuses an incoming
    equip whose displaced item can't be re-stashed; on success it `unequip`s and stashes the slot's
    pre-unequip durability. Equip seeds the slot from `equipCharge[id] ?? def.durability` then clears the
    stash; guarded to `def.durability != null` so permanents are untouched. `tickTorch` deletes the stash on
    `'destroyed'` (burnt-out torch leaves nothing, no bag return). `emitEquipment` now also emits
    `equipCharge:changed` (a copy). HUD: `store.ts` gains `equipCharge` + `setEquipCharge`; `bridge.ts`
    mirrors `equipCharge:changed`; `PackDrawer` draws the gold durability bar for a **bagged** partial torch
    via a new `baggedFrac` (frac = `equipCharge[id]/ITEMS[id].durability`, suppressed while equipped).
    Verified `Inventory.add` returns the amount placed (so `<1` ⇒ full bag). Tests: `bridge.test.ts` gains an
    `equipCharge:changed` round-trip (set + clear); the bag-full primitive the guard checks is already
    covered by `Inventory.test.ts:153` (add returns 0 / leftover on a full bag). NB: `toggleEquip`'s guard
    isn't unit-tested in isolation — `GameScene` is a Phaser scene with no unit-instantiation seam; the
    end-to-end unequip-returns-to-pack + deny path is exercised by `equip.spec.ts` (updated in Step 7).
    `npm run build` green; full vitest suite green (1010 passed).
    NB2: recovered from a mid-step sub-agent hang — the agent completed the `GameScene`+`store` logic; the
    bridge listener, PackDrawer bar, and the test were finished inline.
  - `GameScene`: add a scene field `equipCharge: Record<string, number>` (itemId → remaining
    durability), reset in `resetWorld`/on (re)start. In `toggleEquip`:
    - **Unequip a durability item — BAG-FULL GUARD (finding #1):** `Inventory.add` caps at `maxStack`
      (torch = 1) and RETURNS the leftover it couldn't fit. So return-to-bag must be add-first,
      commit-after: if `this.inv.add(id, 1)` returns leftover > 0 (bag already holds a torch — e.g. one
      worn + one crafted), the bag is full → **DENY the unequip: leave the item worn, do NOT clear the
      slot, do NOT write `equipCharge`**, and no-op (optionally surface a brief "pack full" hint). Only
      when `add` fully succeeds do we `unequip` + stash `equipCharge[id] = <slot durability read before
      unequip>`. This prevents the orphaned-charge item-loss the critique flagged. Same add-first guard
      for a **displaced** durability item (if it can't fit the bag, refuse the incoming equip).
    - **Equip a durability item**: seed the slot from `equipCharge[id] ?? def.durability` (resume from
      stash if present), then delete `equipCharge[id]`.
  - `tickTorch` (renamed in Step 1): on `'destroyed'`, `delete this.equipCharge[id]` (a burnt-out torch
    leaves no stash) and do NOT add to bag — destroy still removes it entirely.
  - **Bagged-charge indicator (finding #5):** forward `equipCharge` to the HUD so a partially-drained
    torch sitting in the pack shows its remaining charge (not a bare "×1"). Extend the
    `equipment:changed` payload (or add a sibling `equipCharge` field to the store), and have
    `PackDrawer`'s `PackSlot` draw the durability bar for a NON-equipped item when `equipCharge[id]` is
    present (reuse the same gold bar; fraction = `equipCharge[id] / ITEMS[id].durability`). The Diablo
    panel (Step 4) does not need this (it only shows worn slots).
  - Side effects: `bridge.test.ts` equip round-trip + a **bag-full unequip-denied** unit test; the pack
    already merges equipped ids, and now an unequipped torch reappears as a normal stack — verify the
    durability bar shows on re-equip. Guard the `equipCharge` seed against a `null` durability (permanent
    items ignore it — the guard/stash logic runs only for `def.durability != null`).
  - Docs: none (Step 7).
  - Done when: equip torch → drain partway → unequip → torch back in pack showing its reduced charge;
    re-equip resumes at that charge (bar not full); a bag-already-full unequip is denied (item stays
    worn, nothing lost); drain-to-0 still destroys with no bag return. Build + tests green.

- [x] **Step 3: Suppress the native image context-menu / drag on HUD item slots** `[inline]`
  - Outcome: added a shared `noImageCallout` class (`select-none [-webkit-touch-callout:none]`) + a
    `preventImageCallout` onContextMenu guard to `src/hud/lib/utils.ts`. Applied to every long-pressable
    item-art site: `PackDrawer` PackSlot (the reported bug — now `draggable={false}` + guard on both the
    `<img>` and its `<button>`), `Hotbar` SlotContent img + its slot button, and the shared `BuildableIcon`
    (covers BuildCatalog/CommandBar/Hotbar buildable art). `ResourceChips` (lucide SVG, no `<img>`) and
    `CraftMenu` (no icon art) correctly needed nothing. Only the browser default is stopped — the app's
    `useLongPress` pin still fires; no global `contextmenu` blocker (would break the editor). Done inline
    rather than delegated (plan tag was `[delegate]`) — tiny mechanical edit. Typecheck green; `npm run smoke`
    (against the prod preview, pinned chromium) BOOT CANARY PASSED.
  - `PackDrawer.tsx` `PackSlot`: add `draggable={false}` to the `<img>` (mirror `Hotbar`'s
    `SlotContent`), and add `onContextMenu={(e) => e.preventDefault()}` + the CSS
    `[-webkit-touch-callout:none] select-none` to the slot `<button>` (and the img) so a long-press
    can't open the browser's "Open/Save image" sheet (the reported bug — screenshot shows `bow.png`).
  - Audit other HUD `<img>`s that a user can long-press: `Hotbar.tsx` (add the same context-menu guard +
    touch-callout, it only has `draggable={false}` today), and any icon `<img>` in `CraftMenu`/
    `BuildCatalog`/`ResourceChips`. Apply a shared class (e.g. add `select-none
    [-webkit-touch-callout:none]` where item art is long-pressable). Prefer a small shared className
    constant in `src/hud/lib/utils.ts` or a class on the images rather than repeating the string.
  - Side effects: purely presentational; the existing `useLongPress` (pin) still fires — we're only
    stopping the *browser default*, not the app gesture. Do not add a global document-level
    `contextmenu` blocker (would break the editor / dev tooling) — scope to HUD item art.
  - Docs: none.
  - Done when: long-pressing a pack/hotbar item pins it (app gesture) with NO browser image menu;
    `npm run smoke` green.

- [x] **Step 4: Diablo-style equipment panel (paper-doll, 3 live slots)** `[inline]`
  - Outcome: new `src/hud/components/EquipPanel.tsx` — a bottom `Sheet` (mirrors `PackDrawer`) holding an
    inline-SVG humanoid silhouette with three absolutely-positioned slot boxes (`ranged` top-centre/back,
    `mainHand` right hand, `offHand` left hand). Each `SlotBox` reads `store.equipment[slot]`, shows the
    worn icon + a gold durability bar (via `equipViewOf`) or a dimmed dashed glyph/label when empty; a
    filled box taps to emit `equip:toggle` (unequip → torch returns to pack per Step 2), an empty box is
    inert. No new bridge event/store field — reads the already-mirrored `equipment`. Wired via a compact
    icon-only **Gear** (`Shield`) button appended to `CommandBar`'s scavenge rail (`onEquip` prop, kept
    icon-only so the 3 text buttons don't overflow) + a new `'equip'` member of `GameHud`'s `OpenDrawer`
    union rendering `<EquipPanel>` (mirrors Pack/Status). Icons carry the Step-3 no-callout guard.
    Typecheck + `npm run build` green; smoke canary PASSED; visually verified the empty paper-doll via a
    Playwright screenshot (silhouette + 3 placed slots read clearly). Filled state (icon+ring+bar) reuses
    proven pack markup; its equip/unequip round-trip gets an e2e in Step 7. NB: `window.game.__test` isn't
    exposed in the prod preview build, so the screenshot showed the empty panel only.
  - New `src/hud/components/EquipPanel.tsx`: a `Sheet` (bottom drawer, mirror `PackDrawer`) OR a
    centred panel, containing a **body silhouette** with three slot boxes positioned over the body —
    `mainHand` (right hand), `offHand` (left hand), `ranged` (across the back/shoulder). Each box:
    reads `store.equipment[slot]`; shows the equipped item's icon (`iconUrl(ITEMS[id].icon)`) + a
    durability bar for a consumable (reuse `equipViewOf` from `lib/equip.ts`); empty = a dimmed slot
    glyph/label. Tapping a filled box emits `equip:toggle` (unequip); tapping empty is inert (equip is
    driven from the pack). Guard the icons with the Step-3 no-callout treatment.
  - Body silhouette: a simple CSS/inline-SVG humanoid outline (no art-gen needed) sized to the panel;
    slot boxes absolutely-positioned over hand/hand/back anchors. Keep it theme-token styled
    (`--color-gold` for the equipped ring, existing surface tokens).
  - Wire opening: add an **Equip** (or "Gear") button to `CommandBar.tsx` scavenge rail beside
    Pack/Status (or repurpose a slot), calling a new `onEquip?` callback; `GameHud.tsx` owns the
    open-state + renders `<EquipPanel>` (mirror how `PackDrawer` is wired). No new bridge event — the
    panel reads the already-mirrored `equipment` and reuses `equip:toggle`.
  - Side effects: `store.ts`/`bridge.ts` already carry `equipment`; no new plumbing. Keep the scavenge
    rail from overflowing on narrow screens (it's a 3-button row today — a 4th must still fit; consider
    an icon-only button).
  - Docs: none (Step 7).
  - Done when: tapping Equip opens the paper-doll; equipping from the pack fills the matching body box
    with icon (+ torch durability bar); tapping a filled box unequips (torch returns to pack per Step 2);
    build + smoke green.

- [ ] **Step 5: In-hand torch overlay sprite on the player** `[inline]`
  - New small `world/` manager (e.g. `src/scenes/world/HeldItemOverlay.ts`) OR a private field-cluster
    on `GameScene`: owns a single Phaser sprite (`heldSprite`) created once, `setVisible(false)` by
    default, depth just above the player (11). **Tick placement (finding #4):** `GameScene.update()` has
    a death early-return (~1089) and TWO `updateAnim` sites (the movepad-return path ~1151 and the
    normal path ~1167). To avoid the torch un-following on one movement path, run the overlay
    position/flip update ONCE per non-death frame at a single point ABOVE that branch — right after the
    `tickTorch` call (~1104), not next to either `updateAnim`. Behaviour: if a torch is in the off-hand,
    position it at the player's hand (`player.sprite.x + handOffsetX`, `player.sprite.y + handOffsetY`),
    `setFlipX` to match facing (mirror `lastFacing.dCol < 0` on side; fixed offset for up/down),
    `setVisible(true)`; else hide. Offsets are small tunable consts (`config.ts`: `HELD_TORCH_OFFSET_X/Y`).
  - Art: a small held-torch sprite. Reuse the `torch.png` icon at first for a working overlay; if it
    reads poorly at hand-scale, generate a dedicated `held_torch` sprite in Step 6's Gemini pass
    (a vertical torch with flame). Load it in `PreloadScene` (a static image, like an icon). Keep the
    existing raised light (`playerLight()` unchanged) — the overlay is the *visible* torch, the light is
    the glow.
  - Side effects: destroy/recreate cleanly across `scene.restart()` (mirror how player sprites are
    rebuilt — the death-restart clears held tweens/sprites; ensure `heldSprite` is nulled + remade in
    `buildWorld`, not leaked). Hide immediately when the torch is unequipped or destroyed (drive off the
    same `equipment.get('offHand')` read as the light). It must not block taps or physics (no body).
  - Docs: none (Step 7).
  - Done when: equipping the torch shows it in the player's hand, following movement + flipping with
    facing; unequip/burn-out hides it; no leak across a death restart; build + smoke green.

- [ ] **Step 6: Generate the new (bigger) workbench sprite** `[inline]`
  - Pull `GEMINI_API_KEY` off guppi over Tailscale (see `CLAUDE.md` guppi section +
    `docs/MOBILE-EDITOR-ACCESS.md`); keep it in-memory only, never commit/echo it.
  - Follow the **static world-prop playbook** (`docs/AI-SPRITE-PIPELINE.md` § Static world-prop sprites;
    `scripts/pixel-crawler/gen_*_gemini.py` + `process_gemini.py` pattern): generate an on-theme wooden
    workbench (dark-grotty pixel-art, matches Pixel Crawler), post-process (keyout → downscale →
    outline/quantise) to a transparent PNG sized to read at ~2 tiles. Commit the derived PNG under
    `public/assets/tilesets/pixel-crawler/.../_derived/` (or an `icons`-style location) **plus** the
    reproducible origin (a prompt entry/script), per the pipeline's commit convention.
  - Wire it: point `buildables.ts` `workbench.objectSprite.asset` at the new PNG with a `region`
    covering the full image; bump `tilesTall: 1 → 2` (and re-check `originY`); load the new asset in
    `PreloadScene.ts` (adjust the object-sprite load if the path changed); confirm `WorkbenchBehavior`'s
    bake/anchor still centres it (adjust the default height fallback if needed).
  - Side effects: the workbench footprint is still ONE logical tile (`blocksPath`/occupancy unchanged) —
    only the *render* grows; verify it doesn't visually swallow neighbouring tiles or the craft-tap
    column. If guppi is unreachable, STOP and report (don't fake the asset) — the rest of the plan
    doesn't depend on this step.
  - Docs: note the new origin in `docs/ASSETS.md`/`wired-art.md` (Step 7 folds this in).
  - Done when: the placed workbench renders visibly larger (~2 tiles) with the new sprite; build green;
    e2e `workbench.spec.ts` still passes (mechanics unchanged).

- [ ] **Step 7: Tests + docs** `[inline]`
  - Tests: update `equip.spec.ts` for the rename + the **unequip-returns-to-pack** behaviour (equip →
    drain → unequip → still in pack at reduced charge → re-equip resumes); a unit/e2e check that the
    **equipment panel** reflects + toggles slots; a smoke check that the **held overlay** appears/hides
    with the torch (via a debug seam if needed — mirror `DebugState.equipment`/`playerLightRadius`).
    Update `data.test.ts` torch assertions.
  - Docs (terse, high-signal): `docs/STATUS.md` (equip subsystem: torch rename, stashable durability,
    held overlay, equip panel), `docs/DECISIONS.md` + its gameplay shard (torch id now the hand-torch —
    supersedes 049 #7; unequip-returns-with-durability reverses 049's discard; overlay = held-item
    render sliver, full paper-doll still deferred), `docs/GAME-MECHANICS.md` (torch equip/relight),
    `CLAUDE.md` Status one-liner, `docs/ASSETS.md`/`wired-art.md` (new workbench + held-torch origins).
  - **Free the `torch` name in the design docs (finding #2):** `docs/GAME-DESIGN.md` (~L372-375, the
    "Torches" buildable) and `docs/ROADMAP.md` (~L179) still call the FUTURE perimeter light "torch",
    which now collides with the hand item. Rename that future buildable in the design text to
    `torch_post` (perimeter light post) so the id isn't double-booked, and add a one-line note that the
    hand item took the `torch` id (plan 051, superseding 049 #7).
  - Flip this plan's Status to `deployed`.
  - Done when: `npm run check:all` green; docs match shipped behaviour.

## Out of scope

- **Full paper-doll player rendering** (per-pose held-item layers for sword/bow, armour on the body) —
  still deferred to plan 010; only the single torch overlay is built here.
- **Inactive/placeholder equipment slots** (head/chest/legs/etc.) — the panel shows only the three live
  slots.
- **The future buildable perimeter `torch` light** — the id is now the hand item; a perimeter light, if
  built later, takes a new id (e.g. `torch_post`/`lamp`).
- **Durability on non-torch equippables / a generic bag-durability model** — the stash is a minimal
  per-id scene map for the torch; `Inventory`/`Slot` stay pure and count-only.
- **Re-animating the player** with torch-in-hand strips — the overlay replaces that.

## Critique

> Fresh-eyes review (uncontaminated sub-agent). All six findings folded into the steps above; kept here
> for the execution record.

**Verdict:** Sound and largely well-scouted follow-up plan with no hard blockers — but the return-to-bag
durability stash has an unguarded item-loss edge, and taking the `torch` id collides with the design
doc's own "Torches" buildable, both fixed during execution.

|#|Finding|Severity|Resolution in plan|
|-|-------|--------|------------------|
|1|Step 2 `inv.add(id,1)` is unguarded but `Inventory.add` caps at `maxStack:1` and returns leftover → equip torch + craft a 2nd + unequip drops the returned torch, orphaning its `equipCharge`.|Medium|Step 2 now add-first/commit-after: deny unequip when the bag can't fit; + bag-full test.|
|2|`torch` is the design doc's canonical name for the planned buildable perimeter light (GAME-DESIGN.md:372-375, ROADMAP:179); Step 7 omitted those docs.|Medium|Step 7 now renames the future buildable to `torch_post` in GAME-DESIGN.md + ROADMAP.md.|
|3|Step 1 named `gen-icons/prompts.py` as the icon origin, but `brand.png` is generated by `scripts/craft-items-art.mjs`.|Low|Step 1 now points at `craft-items-art.mjs`.|
|4|Held-overlay "beside the player-anim step" is ambiguous — `update()` has two `updateAnim` sites; wiring one leaves the torch un-following on the other path.|Low|Step 5 pins the tick above the branch (after `tickTorch` ~1104), once per non-death frame.|
|5|A partially-drained torch returned to the pack shows "×1" with no charge indication.|Low|Step 2 forwards `equipCharge` so the pack draws the bar for a bagged torch.|
|6|The `RECIPES.brand` key/id/name + refs (`orders.test.ts`, `workbench.spec.ts`) need renaming, not just a grep.|Low|Step 1 now calls out the full recipe rename explicitly.|
