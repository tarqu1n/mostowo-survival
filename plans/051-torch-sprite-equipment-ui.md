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
  + PIL post-process pattern), `scripts/gen-icons/` (prompt-manifest convention). Gemini key + guppi
  recipe: `CLAUDE.md` "Home server: guppi" + `docs/MOBILE-EDITOR-ACCESS.md`.

**Direction fit** (`CLAUDE.md`/`docs/GAME-DESIGN.md`/`docs/ROADMAP.md`): crafting is the current post-MVP
thrust; equip is its spine. The equipment panel is the first real inventory-management surface (049 left
equip implicit); a relightable/stashable torch matches survival-loop expectations (a torch you can pocket
and re-use); held-item rendering is the first sliver of the deferred paper-doll. All incremental, on-theme.

## Steps

- [ ] **Step 1: Rename brand → torch (data, config, refs, tests)** `[inline]`
  - `items.ts`: `brand` → `torch` (id + `name: 'Torch'` + `icon: 'torch.png'`); keep `equip:'offHand'`
    + `durability`. Rename the icon file `public/assets/icons/brand.png` → `torch.png` (`git mv`) and
    the prompt entry in `scripts/gen-icons/prompts.py` if one exists.
  - `config.ts`: `BRAND_DURABILITY`→`TORCH_DURABILITY`, `BRAND_LIFETIME_SEC`→`TORCH_LIFETIME_SEC`,
    `BRAND_DRAIN_PER_SEC`→`TORCH_DRAIN_PER_SEC`, `BRAND_LIGHT_RADIUS`→`TORCH_LIGHT_RADIUS`,
    `BRAND_DRAIN_EMIT_MS`→`TORCH_DRAIN_EMIT_MS` (keep values). Update the doc-comments that say "brand".
  - Update all importers/refs: `GameScene.ts` (import, `playerLight()` `litBrand`→`litTorch` + id check
    `=== 'torch'`, `tickBrand`→`tickTorch`, `brandEmitAccumMs`→`torchEmitAccumMs`, `toggleEquip` comments),
    `data.test.ts`, `tests/e2e/equip.spec.ts` (`'brand'`→`'torch'`, test titles/comments), `testApi.ts`
    seams, and any `docs/` prose that names the brand item (leave the *history* in `plans/049` intact).
  - Side effects: grep `-ri brand src public scripts tests docs` to catch every ref; recipe outputs
    (`recipes.ts`) — if a recipe yields `brand`, rename its output id too.
  - Docs: none new here (Step 7 does the doc pass); just keep inline comments truthful.
  - Done when: `grep -ri "\bbrand\b" src scripts tests` returns only plan-049 history; `npm run build`
    + `npm test` green; the item shows as "Torch" with `torch.png`.

- [ ] **Step 2: Unequip returns the torch to the pack (partial durability persists)** `[inline]`
  - `GameScene`: add a scene field `equipCharge: Record<string, number>` (itemId → remaining
    durability), reset in `resetWorld`/on (re)start. In `toggleEquip`:
    - **Unequip a durability item**: read the slot's `durability` BEFORE `unequip`, store it in
      `equipCharge[id]`, then `this.inv.add(id, 1)` (return to bag) for ALL items (drop the
      `durability === undefined` gate on the return path). Same for a **displaced** durability item.
    - **Equip a durability item**: seed the slot from `equipCharge[id] ?? def.durability` (resume from
      stash if present), then delete `equipCharge[id]`.
  - `tickTorch` (renamed in Step 1): on `'destroyed'`, `delete this.equipCharge[id]` (a burnt-out torch
    leaves no stash) and do NOT add to bag — destroy still removes it entirely.
  - Side effects: `bridge.test.ts` equip round-trip; the pack already merges equipped ids, and now an
    unequipped torch reappears as a normal stack — verify the durability bar shows on re-equip. Guard
    the `equipCharge` seed against a `null` durability (permanent items ignore it).
  - Docs: none (Step 7).
  - Done when: equip torch → drain partway → unequip → torch back in pack; re-equip resumes at the
    reduced charge (bar not full); drain-to-0 still destroys with no bag return. Build + tests green.

- [ ] **Step 3: Suppress the native image context-menu / drag on HUD item slots** `[delegate]`
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

- [ ] **Step 4: Diablo-style equipment panel (paper-doll, 3 live slots)** `[inline]`
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
    default, depth just above the player (11). Per-frame in `GameScene.update()` (beside the existing
    player-anim step): if a torch is in the off-hand, position it at the player's hand — `player.sprite.x
    + handOffsetX`, `player.sprite.y + handOffsetY` — `setFlipX` to match the player's facing (mirror
    `lastFacing.dCol < 0` on side; sensible fixed offset for up/down), and `setVisible(true)`; else hide.
    Offsets are small tunable consts (add to `config.ts`, e.g. `HELD_TORCH_OFFSET_X/Y`).
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
    Flip this plan's Status to `deployed`.
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
