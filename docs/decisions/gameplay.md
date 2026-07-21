# Gameplay decisions

Combat/hurtbox, campfire, day/night + hunger, monster AI, input modes, and worker/action behaviour.

Part of the [decision log index](../DECISIONS.md). Newest first.

---

## 2026-07-21 — [DECIDED] NPC companion (plan 042): separate baseSupply, repair-consumes-supply, mobs-aggro-NPC downed then auto-revive-at-dawn, Rogue sprite, dev-spawn-only, full scope

The MVP NPC (plan 042, ROADMAP Step 5) settled several calls; full detail in
[plan 042](../../plans/042-npc-companion.md):

- **Separate `baseSupply` stockpile, not the player `Inventory`.** The companion economy runs on a new
  pure counts-only store (`wood`/`rock`, `src/systems/baseSupply.ts`) with **no withdraw UI** — chosen
  over reusing the slot-backed player bag so gather/repair are decoupled from carried loot.
- **Repair consumes stockpile supply.** The Repair day-role drains `baseSupply` wood to mend walls (idles
  when empty), tying Gather and Repair economically through the one stockpile — not a free mend.
- **Mobs can aggro the NPC → downed → auto-revive at dawn.** The monster FSM target was generalised from
  **player-only** to **nearest-of-{player, NPC}**; a killed NPC is **downed** (inert on its Death strip,
  not removed) and **auto-revives the next dawn**. Chosen so downed/revive is reachable in real play
  without a permadeath/rescue system (post-MVP).
- **Rogue sprite; dev-/scenario-spawned only.** The companion uses the **Rogue** Pixel Crawler actor; the
  **recruit quest (Litrandil) stays post-MVP** — the NPC is spawned directly via dev/scenario for MVP.
- **Full Step-5 scope retained** (not trimmed): one assignable day role (Gather↔Repair), 3 night postures
  (Guard here / Follow / Refuel lights), tap-to-assign HUD popover. **All `NPC_*` tuning is flagged
  placeholder** in `config.ts` for a later feel pass.

## 2026-07-20 — [DECIDED] Base-defence walls: mob-destructible + thorns archetype, deconstruct-not-combat, 4-way rotate (plan 037)

Base-defence walls (plan 037, chunks 2a–2c) settled four gameplay calls; full rationale in
[plan 037](../../plans/037-base-defence-structures.md) (locked decisions #1/#6/#7):

- **Walls are destructible by *mobs*, not players.** A mob walled off from its objective sieges the
  blocking wall (telegraphed strike → wall HP → destroyed → paths through). **Players never damage walls
  with weapons** — a wall is removed by a **worker `deconstruct` order** (DEMOLISH mode) with a **partial
  refund** (`floor(cost × 0.5)`), mirroring the build/refuel order. Explicit intent over accidental
  weapon damage.
- **Spiked wall = thorns + low-HP early-game archetype.** The D_2 stake palisade deals a little
  retaliation damage to a mob attacking it (`thorns` data field), and is cheap + low `maxHp` — it chips
  the horde but won't hold long. Sets up a later **solid high-HP, no-thorns wall** as the tradeoff, so
  wall choice is a real decision. Thorns fire **only on a mob's attack**, never passively (keeps it
  distinct from the step-on-tile spike trap).
- **Walls are 4-way, facing chosen by player-rotate at placement** — neighbour auto-orient stays
  deferred. Reverses the original front-facing-only MVP note.
- **The gate is deferred** into later *upgraded-walls* work (not built in plan 037).

## 2026-07-20 — [DECIDED] Melee hit detection is tile-space reach/arc, not physics/geometric hitboxes (plan 036)

Melee was one hardcoded front tile (`feet + facing`). Plan 036 makes it a data-driven **attack shape** —
`AttackShape = { reach; arc: 'single' | 'wide' | 'line' }` on a weapon, resolved by pure
`attackTiles(feet, facing, shape)` (`src/systems/hurtbox.ts`) into a set of target tiles hit-tested
against enemy hurtboxes. The prompting question was "how should a weapon express reach/area?" — a spear
that reaches 2, a cleave that hits a crowd, and (falls out) melee that connects with a wide/tall enemy's
whole hurtbox, not just its feet tile.

- **Chosen: stay grid-native — one source of truth on `col`/`row`.** Physics/AABB/pixel hitboxes
  (Arcade overlap, geometric collision) were **explicitly rejected**: the whole combat/targeting stack
  already keys off tiles (footprint, hurtbox, pathfinding), so a shape in the same space is deterministic
  and unit/scenario-testable via the existing Tier-1/2 harness — no float geometry, no frame-timing
  flake. This is the **attacker-shape vs defender-hurtbox** split: the attacker projects a tile set, the
  defender owns a tile extent, and a hit is set-membership.
- **`arc` is a small preset set** (`single`/`line`/`wide`) over a numeric width or an offset list —
  authorable and a fully-testable combo space. **Facing snaps to the dominant cardinal axis** inside the
  generator (mirrors combat-move's snap); true 8-way arcs are out of scope.
- **Cleave hits every enemy in the shape, flat damage each** (one swing = N independent hits), not a
  split or falloff — base-defense crowds (the night wave) are the motivating use.
- **Shape is data, so it travels.** Weapons carry their shape (`MELEE_WEAPONS` demo map); a type-only
  `attackShape?` seam exists on `MonsterWeapon` so mobs *could* later carry one. **Enemy bite stays
  proximity** (Chebyshev ≤1, telegraphed) — unchanged this plan; the seam is unconsumed.
- **No player equipment system** — demo weapons (spear/cleaver) are data + a dev/test seam
  (`setPlayerMelee`), not inventory/economy items. Unarmed = `{reach:1, arc:'single'}`, byte-for-byte
  today's behaviour (regression anchor). No `DebugState` field, so the `refactor-tripwire` golden is
  untouched. Mechanic numbers in [GAME-MECHANICS.md](../GAME-MECHANICS.md).

## 2026-07-20 — [DECIDED] Enemy rendering is a data discriminator (`EnemyDef.actorKind`), not a subclass

Adding the boar (plan 035b) generalized the enemy actor pipeline from the single flip-mirrored skeleton
to two render paths chosen by data: `actorKind: 'flip3'` (default — one Run strip mirrored by `setFlipX`)
vs `'dir4'` (a distinct strip per facing, `Facing4` down/up/left/right, no flip, keyed by id under
`ACTIVE_TILESET.actors.directional`, art allowed from its own pack). One `MonsterCharacter` branches on
the discriminator (facing from velocity, weapon/hand rig only on flip3, single footprint on dir4) rather
than growing a per-creature subclass. Rationale: keeps "add a creature" a data + manifest edit, matches
the codebase's data-driven / behaviour-classes-not-data-hierarchy stance (see CONVENTIONS.md), and leaves
the skeleton path byte-for-byte unchanged as a regression anchor. The boar's telegraph reuses 035a's
caller-side wind-up but plays its **real Attack sheet** as the tell (a richer, per-creature telegraph the
skeleton's coded tint can't give). Trade-off: a dir4 def needs a complete manifest entry (all 6 states ×
4 facings) — guarded by a data-time lockstep test rather than discovered as a missing-texture box in-game.

## 2026-07-19 — [DECIDED] Combat controls (mobile): movepad + auto-surfacing Melee/Bow cluster; facing-biased auto-target w/ highlight; telegraphed enemies; minimal HP bars; no dodge

Settles the fighting controls (ROADMAP step 1); full write-up in
[GAME-DESIGN.md](../GAME-DESIGN.md#fighting-controls-mobile).

- **Layout:** left-thumb movepad (move + facing) + a right-thumb **action cluster** (Melee + Bow in MVP,
  **designed to grow** — a Spell slot post-MVP; dodge if ever added).
- **Controls auto-surface** when a threat is near / at night — no manual mode toggle to fumble mid-wave
  (a likely source of the current clunk). Command-mode resumes when safe.
- **Movement-while-attacking is the risk lever:** melee slows you **significantly but never stops**
  (`ATTACK_MOVE_SLOW`); bow slows you **only a little** (kite-able). This is where "ranged is safer" lives.
- **Bow = facing-biased auto-target-nearest**, no manual aim; the current target is **highlighted**
  (marker/outline, can reuse baked-glow tech); face to switch, tap to loose.
- **Enemy attacks telegraphed** — a readable wind-up (coded tween + pose/flash for the strip-less
  skeleton) before the strike; makes melee a fair reaction game, retires the contact-damage clunk.
- **Monster HP: minimal, attention-scoped** — targeted enemy shows its bar persistently; others show a
  brief on-hit bar that fades; thin/colour-only; cap the count rendered; backed by sprite feedback
  (hit-flash + stagger/near-death tell). Chosen to avoid mobile clutter.
- **No dedicated dodge in MVP** — kiting (bow) + spacing is the survivability skill; melee stays raw.
  Revisit only if melee emergencies feel unfair; the cluster leaves room.

**Execution notes (plan 035a — where the build diverged from / pinned the above):**

- **Bow release anim = coded stand-in, not a pinned bow sprite.** The plan wanted "a held bow sprite
  pinned via `attachment.ts`", but the player rig carries **no per-frame hand anchors** (only the
  skeleton does) and the pack ships **no bow art**, so the release body-pose reuses the existing
  Pierce (`attack`) strip for the draw window; the **arrow tracer + target highlight** carry the ranged
  read. A real bow rig/art + arrow-nock anchors is a later polish pass.
- **Arrow = hitscan + coded tracer** (the "projectile vs hitscan" open question → hitscan; damage
  resolves instantly, the flying dash is pure FX). **Arrows unlimited** — no ammo resource yet
  (deferred from ROADMAP step 1's scope line).
- **Auto-surface never flips input `mode`.** It drives a separate `combatActive` predicate; calling
  `setMode('combat')` would `cancelAll()` the worker queue. **Precedence:** while surfaced the movepad
  drives, but command-mode taps still queue orders and a pending order survives the reveal.
- **Near-death tell = alpha throb** (not tint/scale): alpha is the one sprite channel free of the
  hit-flash (pipeline/tint-fill), wind-up tint, and flinch-squash, and VisionController hides only the
  player — so it can't fight any existing FX.

## 2026-07-19 — [DECIDED] Player combat is the "danger verb" — avoid it; push danger to traps/NPCs/ranged; melee most dangerous

Design thesis steering the combat rework (ROADMAP step 1). Player combat is a **fallback, not the main
verb** — you should want to avoid fighting in person.

- **Risk gradient (safest → riskiest for the player):** traps → NPCs → ranged/spells → melee. The combat
  economy is pushing danger off your own body.
- **"Good combat feel" = tense / exposed / relieved-to-escape, NOT a power fantasy** — reframes step 1's
  success criteria away from the satisfying-brawler default.
- **Melee is deliberately dangerous:** player fragile (a few hits kill), being surrounded = death, enemy
  attacks telegraphed (the skeleton's *missing* attack is the core clunk), and fighting is **loud**
  (pulls roamers; traps are silent → doubly better).
- **Melee keeps a niche:** free (no ammo/mana), the emergency button, and the only early option — so the
  first ranged weapon/spell is the first real relief/power step, and early-night risk pushes you to get it.
- **Ranged = ammo-gated (scavenge/craft), auto-target-nearest on mobile (skill = positioning); spells =
  mana + rarity-gated AoE/utility, Litrandil's domain.** Both post-MVP.
- **MVP combat = melee + a basic bow** (decided 2026-07-19; the bow adds an arrows/ammo resource +
  auto-target-nearest aiming, and can move-while-shooting where melee roots you). Fighting **controls**
  (mobile) are the next thing to design; the player-survivability choice (dodge/backstep vs
  positioning+fragility vs block) falls out of the control scheme, so it's deferred to that.
  **[OPEN]** player-casts-spells vs wizard-NPC-only (post-MVP).

## 2026-07-19 — [DECIDED] MVP scope + build order (see ROADMAP.md)

The first-playable target and the order to build it, captured in [ROADMAP.md](../ROADMAP.md). Key calls:

- **MVP = the smallest complete, fun day→night→defend loop**, mostly completing/de-clunking built
  machinery rather than new systems.
- **Build order (dependency + risk sequenced):** 0 MVP arena map → 1 combat feel rework (player +
  skeleton attack/AI) → 2 night wave + campfire-defense + loop-close (first playable) → 3 one trap →
  4 hunger live → 5 one NPC. Rationale: combat is the reused verb (de-risk first); the night wave is the
  riskiest missing piece and earliest loop-feel (promoted above "buildings"); the trap comes *after* the
  wave so it's tuned against real wave pathing; the NPC is most composite (reuses everything).
- **Campfire-heart is IN the MVP (stage 1):** the single central fire's **lit radius is the base/claim**
  (replaces the fixed base rect). Mobs **target the fire to knock the light out** — attacks drain its
  **fuel** (the same meter feeding wood restores — **no separate integrity meter**; owner, 2026-07-20),
  fuel sustains it. **Defend target = the player; keep the fire lit if you can**; **lose = player dead
  only** (the earlier "instant-loss vs relight-to-recover" open detail settled 2026-07-20: NOT
  instant-loss — a knocked-out fire floods darkness and you relight to recover; kept fully dark, no
  ambient floor).
  **Consequence: the campfire-fuel retune is now ON the MVP path** (fire is load-bearing) — reverses an
  earlier draft of this entry that kept the fixed rect + deferred the retune.
- **Hunger is IN the MVP loop** (chosen over deferring): reuses the built needs/eat systems — author food
  on the map + flip `HUNGER_LETHAL` + retune drain to the 15-min cycle.
- **NPC recruitment skipped for MVP** — spawn a companion directly; Litrandil's quest is post-MVP.
- **Explicitly OUT of MVP:** crafting stations, recruit quests, campfire-heart *extensions* (multiple
  hearths, walls extending the claim, torches — MVP has only the single central hearth), narrative events
  - structured wave contract, multi-map/fast-travel, richer enemy roster.

## 2026-07-19 — [DECIDED] Daily narrative events + wave contract; time-driven escalation (progress = accelerant); endgame challenge valve

Designs the dawn beat and refines the escalation model.

- **Escalation is time-driven — "keep up or die" — with progress as the accelerant** (refines the
  progress-keyed framing in the core-loop entry below). The nightly *base* wave hardens on a schedule;
  pushing into new maps throws nastier types into the pool, speeding the ramp. Fair because the base
  wave is predictable, telegraphed (the contract), and faced from home — you die from not keeping pace,
  not a dice roll. The "no unfair death" concern applies to *roaming* danger while scavenging out, a
  distinct threat from the predictable base wave.
- **Endgame valve:** once you've out-paced the curve, optional authored challenges open up (hunt a
  named beast, clear a haunted location, arena/boss/timed fights) for rare mats/blueprints/lore/recruits
  — stops a stabilised settlement fizzling; feeds the escape arc.
- **Daily narrative events:** each dawn = a short authored vignette + 2–4 choices, weighted draw from a
  state-gated pool (day count / maps / NPCs / prior choices), one-shot + repeatable; types = threat-
  foreshadow / opportunity / encounter / pressure / story; consequences carry into day + night.
- **Event outcomes are mostly deterministic with occasional explicit gambles** (chosen over fully
  deterministic or chance-based) — a choice is a decision not a dice roll, fair under no-fallback, with
  spice.
- **The wave contract is delivered via the dawn event; hints only for now** (custom call, not the full
  invest-for-clarity system): atmospheric foreshadowing ("lights in the north woods" ≈ big/north), not
  a stat readout. The structured version (scale/composition/direction/modifier on a HUD card, fidelity
  sharpened by scout/watchtower/wizard-divination) is deferred.

## 2026-07-19 — [DECIDED] Companion recruitment-as-quest + day/night hot-swap roles; torches as cheap perimeter lighting

Concrete companion + lighting mechanics (design direction; first named NPC → LORE.md).

- **Recruitment is per-character, first pattern is a fetch-and-deliver quest:** talk → accept → gather/
  craft the ask → deliver → join. First NPC: **Litrandil the drunk wizard** (wants cigarettes + vodka).
  His ask doubles as a crafting-chain example — cigs crafted from tobacco (forageable plant node) +
  paper (scavenged loot); vodka scavenged/found. Character + quest live in
  [LORE.md](../LORE.md#litrandil-the-drunk-wizard).
- **Companion assignment = a day-role AND a night-role, hot-swappable any time.** Day roles are
  worker-queue tasks (arm/re-arm traps, cook, gather, operate a station); night roles are defense
  postures (feed fires/torches, hold a named wall segment, or follow as a mobile squad). Reuses the
  worker task queue (day) + the hold-segment posture (night) — supersedes the vaguer "night posture"
  sketch in the core-loop framing entry below.
- **Torches: a small-radius, refuelable light source (own buildable)** complementing campfire hearths
  under the base-claim model — hearths anchor the claim, torches cheaply light walls/perimeter/gaps.
  Both are what companions keep lit at night (fire-tending role).
- **[OPEN]** whether an NPC's recruitment desire (Litrandil's vodka/cigs) is a one-time entry price or
  an ongoing upkeep/morale need. Ongoing → morale economy; one-time → clean gate. Deferred.

## 2026-07-19 — [DECIDED] Crafting via hybrid stations gate; base claim = the campfire heart (lit area)

Two greenfield systems given shape (design direction; firm into systems at plan time). Both fold the
four pillars into single objects and reuse built machinery.

**Crafting-station progression — hybrid tiering** (chosen over distinct-only or upgrade-only):

- **Stations are buildables** (reuse `BUILDABLES`/`BuildManager`/palette). A recipe declares the station
  (+ tier) it needs; the crafting UI shows only recipes whose station is present — unmet recipes are
  **invisible**, so the gate *is* the progression.
- **Hybrid tiering:** distinct station *kinds* (workbench → forge → alchemy/arcane), each unlocking a
  recipe band, **and** each upgradeable a level or two in place. Distinct kinds = visible in-base
  progression; in-place upgrades = depth without a station per tier.
- **The tree reaches across maps** — higher stations/upgrades need lower-station outputs + materials only
  found on not-yet-unlocked maps, so the crafting tree and the map-unlock spine are the same climb
  (pushing outward raises the night ceiling).
- **Crafting is a queued station task**, not instant (matches the harvest/refuel "work reads as work"
  pattern) — a worker/companion crafts over `craftMs`, giving companions a day job beyond gathering
  (a mature base = a production line).
- **Blueprint discovery** is an optional second gate: some recipes must be *found* (exploration / dawn
  event), pacing reveals independently of resources.
- Cost: stations take base space inside the fireline — crafting depth is paid in defensibility.
- Data shape to firm at plan time: `Recipe { inputs, output, station, stationTier?, craftMs, blueprintId? }`.

**Base claim = the campfire heart** (chosen over walls-enclosure or a fire-seeds-walls-extend hybrid):

- **Your base is everywhere your fire's light reaches** — replaces the placeholder fixed base rect
  (`BASE_ZONE_SIZE`, plan 018 A8). Reuses the built campfire light/vision/fuel (`CampfireManager`,
  `lightSources()`, fuel-scaled radius).
- **Claim = lit area** grants base-storage auto-access ("being in the light" ⇒ "being home"),
  buildable/station placement, and vision.
- **Expansion is costed** — bigger/second fire = bigger claim = more room BUT more fuel drain + more
  perimeter to defend (a running cost + a defense cost, not just a build price).
- **The dark reclaims ground** — a fire out at night = that area goes dark = enemies pour through the
  unlit gap; night refuelling is a live defensive task (companion job). **Resolves plan 012's deferred
  enemy fog-gating**: enemies hidden in darkness, revealed in light — partner to the treeline night wave.
- **Knock-on:** fuel now governs the whole claim, so the campfire fuel numbers (already flagged mis-tuned
  for the 15-min cycle) become critical to retune — no longer optional.
- **Staging:** (1) base zone = central hearth radius replacing the rect **[DONE — plan 039 Step 1]**;
  (2) multiple fires union claims; (3) walls shape/extend the boundary while fire-connected.
  - **(1) landed 2026-07-21:** `baseOnly` placement now gates on a lit hearth's **bright core**
    (`lightSources()` radius × `CLAIM_LIGHT_FRAC`, config — the clearly-lit core, not the soft-gradient
    rim), via `CampfireBehavior.inClaim`/`hasLitHearth` threaded into `BuildManager.tilePlaceable`.
    `BASE_ZONE` is retained as the **no-hearth bootstrap** so the first campfire can still be placed. The
    claim breathes with fuel. Post-037, the light seam lives on `CampfireBehavior` (unioned by
    `StructureManager`), not the old `CampfireManager`.
  - **Light-only sightline landed 2026-07-21 (plan 039 Steps 2/3), decision #4 = darkness conceals.**
    Night is now **fully dark** (`NIGHT_MAX_ALPHA` 1.0, near-black `COLORS.night`) with **no ambient
    floor** — away from light you see nothing, enemies and their attack tells included. Light reveals via
    a **soft radial gradient** (dims to black at the rim, no hard ring) composited by erasing a baked
    brush (`render/lightTexture.ts`) into a screen-space `RenderTexture` — no bitmap mask, no frame-loop
    shader (honours "bake, don't shade"). The **player always emits a tiny light** (`PLAYER_LIGHT_RADIUS`
    ~1.25 tiles, render-only — never the claim) so they're not blind. This delivers the "light is a must
    — don't let the lights go out" line and **resolves plan 012's deferred enemy fog-gating for free**
    (unlit actors are simply unrendered under the depth-15 overlay). Torch item/buildable still deferred.

## 2026-07-19 — [DECIDED] Core-loop framing: three-horizon progression, hard-countdown-no-fallback dusk, progress-keyed escalation, pacing targets

A brainstorm pass that pinned the connective tissue the design doc was missing (the *why do I play
tomorrow?* layer). Framing calls decided; the detailed trap/wave/companion *shapes* are captured as
design intent in [GAME-DESIGN.md](../GAME-DESIGN.md), to firm into systems at plan time.

- **Progression is three nested time horizons that reinforce, not compete** (Matt chose all three):
  **tonight** = escalating siege ("can I hold this wave?"); **this stretch of days** = settlement
  growth ("is my camp outgrowing the nights?"); **the campaign** = map-unlock/escape ("can I get
  out?"). Growth is driven by the siege; map-pushes are driven by growth; each new map is fresh
  scavenging *and* raises the night ceiling. The escape story is the finish line the growth-sandbox
  and pure-siege spines don't provide alone.
- **Dusk is a hard countdown with NO fallback** (chosen over a rough-camp fallback or path-locking):
  caught away from a defensible position at nightfall is a desperate scramble with a real chance of
  death — the game's emotional spine. Accepted cost: this makes two things non-negotiable, or it reads
  as unfair — (1) **the day must be legible** (always know daylight-left *and* can-I-get-home), and
  (2) **range must scale both ways** (fast travel that takes you far must return you fast; car/boat are
  the dusk lifeline, and a cut-off travel node is a "stranded at night" beat).
- **The escalation curve keys off player progress (what's unlocked / how far pushed), not just the day
  counter.** Forced by "no fallback": a purely time-based spike night + a far-scavenge run = an
  unavoidable death (unfair). Progress-keyed escalation keeps difficulty something the player chose into.
  *(Refined 2026-07-19 — see the narrative-events/wave-contract entry above: the nightly **base** wave
  IS time-driven ("keep up or die") with progress as an accelerant; it's fair because it's predictable +
  telegraphed + faced from home. This "no unfair death" point stands for **roaming** danger while
  scavenging out, which is the threat that mustn't spike arbitrarily.)*
- **The base phase is NOT a separate timed phase** — fortify/craft shares the same daylight budget as
  scavenging, so prep vs. explore is a live opportunity-cost decision (the day's core trade).
- **Pacing targets (config-tunable, no new architecture over plan 004's clock):** day long & breathing
  ~6–10 min, night short & dense ~3–5 min, full cycle ~10–15 min; **dawn** is the pause/save seam;
  travel time is the pressure that makes fast travel's real job "buying daylight back."

Design intent captured in GAME-DESIGN.md (not yet decided-in-detail): the **night wave** as a
three-beat shape (pressure ramp → push, with fight-noise pulling roaming aggro → lull-is-a-trap) with
composition (not just count) escalating from a treeline direction and a dawn "wave contract";
**traps** as multipliers on walls (funnel-and-line a kill-channel), re-armed by a daily worker order,
paid from scarce day inputs; **companions** as a labour/mouths/muscle triangle with night-defense
postures, one trait axis to start, permadeath, and a weaken-before-death starvation warning.

## 2026-07-14 — [DECIDED] Campfire fixes (plan 016): refuel is a worker order, flame scales (not sheet-swaps), outline is a rect

Post-playtest fixes to the plan-012 campfire. Four boundary calls (advisor-consulted before build):

- **Refuel is a queued `refuel` worker order, not an instant tap.** Tapping the fire enqueues an order
  (walk adjacent → tend one wood per `CAMPFIRE_FEED_INTERVAL_MS`), mirroring harvest, with the yellow
  queued outline and toggle-off-on-re-tap. Chosen over the old instant tap-to-feed so refuelling reads
  as work (and shares the task-queue spine). The order self-terminates on *conditions* (topped up: a
  full wood won't fit; or bag empty) since a fire persists — never on entity death.
- **Tap→action resolves in `ScenePicker.actionAt` (campfire → `refuel`), and the fire is column-hit-
  tested over its whole tile stack.** This structurally kills the "tap falls through to a move and the
  worker walks into the blocking fire tile" bug — a tap on the fire can never become a move — and the
  column test keeps it tappable regardless of the flickering flame's opaque pixels.
- **Flame grows/shrinks by SCALING one consistent sprite, not swapping the Bonfire_0x sheets.** Those
  sheets aren't a clean embers→roaring ramp (01/02/04 are braziers, 06/08 bare flames), so swapping
  them morphs the fire's *structure*. One sprite (Bonfire_07) scaled by `fuelFrac` reads coherently.
  The advisor's original objections to scaling (alpha-pick instability, glow re-sync) don't apply here
  because picking is column-based and the outline is a rect, not a sprite-following glow.
- **Queued outline is a stroked rect, not a baked-glow silhouette like queued trees.** `bakeGlowTexture`
  reads the whole multi-frame sheet (a 4-tile-wide smear) and the fire animates/scales — a rect over
  the tile column matches the queued-*site* style with none of that. The tree's soft glow was **not**
  reused for the fire.

**Deferred (logged, not done):** a general path-stall watchdog in `advancePath` — a move order beside
any wall can still corner-cut into a static collider and stall. Refuel removes the campfire trigger;
the general fix (no waypoint progress for N ms → repath/complete) is out of scope for plan 016.

## 2026-07-13 — [DECIDED] Buildable campfire + generalised build/palette (plan 012): four boundary calls

- **Base zone is a fixed rect for now.** `BASE_ZONE` (`config.ts`) is a hardcoded tile rectangle,
  explicitly a placeholder — expected to move to a dynamic/player-claimed base later.
- **Buildable selection via a build palette**, chosen over a cycle-through-buildables control or a
  dedicated button per buildable — scales cleanly as more buildables are added, and reuses the
  existing UI kit (`Panel`/`Button`/`arrangeColumn`).
- **Campfires get their own `CampfireManager`**, per the 013/015 world-manager pattern (a built
  campfire is a live, per-frame-simulated object — fuel drain, lit flips — not a placement-lifecycle
  concern like `BuildManager`). Lighting is wired via a single scene-mediated `lightSources()` closure
  (renamed from `litCampfires()` — see the de-ossification entry above) handed to both `SurvivalClock`
  (night-overlay mask) and `VisionController` (fog reveal) — no manager↔manager edge.
- **Enemy fog-gating is deferred** to the night-waves plan. This plan's "reveal" is purely the
  night-overlay hole the lit campfire cuts — enemies aren't vision-gated at all today (only the
  player is), so nothing new is hidden/shown about them.

Full mechanic write-up: [GAME-MECHANICS.md](../GAME-MECHANICS.md).

## 2026-07-12 — [DECIDED] Generic monster AI (pure FSM) + weapons via runtime anchor-pinning — supersedes plan 010's stamp tool for rigid slots (plan 011)

Turned the single-behaviour kid zombie into a data-driven monster, in two parts.

**AI** is a pure, unit-tested FSM (`src/systems/monsterAI.ts`: `stepMonster`) with four modes —
`idle`/`wander`/`patrol`/`chase` — driven by **radius-only aggro** (`EnemyDef.vision`, no
line-of-sight/wall occlusion) and **distance-only de-aggro** (no timeout): past
`MONSTER_CHASE_DROP_RADIUS_PX` the monster gives up, with a "losing the scent" **veer band** just
inside that radius (`MONSTER_VEER_BAND_PX`/`MONSTER_VEER_MAX_TILES`) that injects growing path noise
as the chase gets marginal, rather than a hard binary snap. `wander` = aimless roam with pauses
(`MONSTER_WANDER_RADIUS_TILES`/`MONSTER_IDLE_MS_MIN/MAX`); `patrol` = a fixed route with a pause at
each waypoint (`MONSTER_PATROL_PAUSE_MS`) — real content authoring a route is future work,
test/scenario-only for now. Zero Phaser imports in the FSM; `GameScene` just persists the returned
`.mode`/`targetTile`/`repath` onto each zombie.

**Weapons** are held via **runtime anchor-pinning**, not baked per-frame strips — the live pilot of
plan 010's own critique finding #3 (which floated pinning a single icon at runtime instead of
committing 26-frame stamped strips). An `AttachPoint {x,y,rot?}` per animation frame lives on
`StripAnim.anchors.mainHand` (co-located with the strip it's relative to); the pure
`weaponTransform` (`src/systems/attachment.ts`) resolves it through the strip's render footprint
into a world offset **every tick** — not on `animationupdate`, since lunge/veer tweens slide the
sprite between frame changes. One weapon sprite is pinned per monster and swapped/randomised at zero
art cost; the attack "animation" is a coded tween swing (rotate about the grip) since the pack ships
no mob attack strip. Each skeleton spawns with a **club** (2 dmg, ~1500ms) or **knife** (1 dmg,
~750ms) rolled from `EnemyDef.weaponPool`, stats owned solely by `src/data/weapons.ts`
(`MONSTER_WEAPONS`) — art (source/pivot/z) stays in the manifest, joined by a shared id, the same
art-vs-gameplay split the codebase already uses elsewhere.

**Supersedes, not merely diverges from, plan 010's anchor-stamp tool + rigid-slot baked strips**
(its critique findings #2/#3): runtime pinning is now the chosen path for *rigid* attachments
generally — the monster weapon today, and 010's player rigid slots (helmet/mainHand/offHand) later.
The stamp-and-bake tool and per-frame committed strips for rigid slots are now **redundant**; only
010's **deformable `chest`/`legs`** (cloth/mail that must bend with the body) still need
matching-pack or hand-drawn strips, since a pinned rigid icon can't deform. The two approaches
deliberately **share their low-level primitives** (`AttachPoint`, `weaponTransform`), so 010's rigid
slots can adopt pinning later as a **refactor**, not a rewrite. `plans/010-layered-equipment-system.md`'s
header is updated to record this so a future session doesn't resume the dead stamp tool.

## 2026-07-12 — [DECIDED] Day/night + hunger survival slice (plan 004): real-time cycle, hunger→health cascade, inventory reuse defers "Equipped"

**Day/night** is a continuous real-time clock (not tied to player action), driving a smooth tint
overlay + a queryable phase. **Night this slice is tint + phase state only** — no enemy waves; waves
layer on later off the same phase state, so the clock doesn't need revisiting when they land.

**Hunger** is a core ticking pressure (Don't-Starve-style) that, at zero, drains **combat-owned
`playerHp`** via plan 003's `damagePlayer` rather than a parallel health system — starvation death
reuses the existing scene-restart path for free. **Survival state (hunger/clock/phase) is not
persisted** — resets on every restart/reload, consistent with there being no save system yet.

**Eating happens via the Health & Wellbeing screen**, which also surfaces read-only player stats — a
deliberate superset of the design doc's "meters + eat list." **The inventory view is unchanged**,
reusing plan 008's existing panel/hotbar; the "Equipped" section from the original design sketch is
**deferred entirely to plan 010** rather than shipping a throwaway shell now.

**Bushes forage, trees/rocks chop/mine:** a new `gather` player state (`Collect_Base` strips) plays
for berry bushes, distinct from the existing chop/mine swings. `ResourceNodeDef` gained a required
`blocksPath` flag (bushes: `false`, non-blocking — the worker routes through and forages from an
adjacent tile; trees/rocks stay blocking) so build-placement and pathing gate on data, not a
tile-role special case.

## 2026-07-12 — [DECIDED] Data-driven hurtbox (footprint ≠ hurtbox); world props sized to the actor

Follow-on from the native-scale decision below. With the character now ~2 tiles tall, two problems
surfaced: (1) it dwarfed the trees, and (2) tall sprites + single-tile hit-testing meant you could be
next to an enemy's *drawn* torso yet whiff, because targeting only matched its feet tile.

**Decided:** separate a creature's **footprint** (movement/occupancy — always the single feet tile,
unchanged) from its **hurtbox** (combat targeting — a data-driven tile extent). `Hurtbox { width,
height }` on `CombatantStats` (`src/data/types.ts`), anchored at the feet tile, centred horizontally
and rising upward to match the drawn silhouette; pure helpers in `src/systems/hurtbox.ts`
(`hurtboxContains`/`hurtboxTiles`, `DEFAULT_HURTBOX = {1,1}`). Player and kid-zombie both declare
`{1,2}`. Consumed by `GameScene.zombieAt` (Punch + Inspect hit-tests) and by contact damage (a zombie
in melee reach of any player-body tile connects). For a `{1,1}` hurtbox every path reduces to the old
exact-tile behaviour, so it's a clean generalisation. Chosen over hardcoding "+1 tile" so future large
(`{2,3}` ogre) or small (`{1,1}` critter) monsters just declare their size — no targeting-code change.

Also bumped `TREE_TILES_TALL` 2.6 → 5 so a pine towers over the ~2-tile character (scaling the *world*
up, never the crisp actor down). Rule captured in [CONVENTIONS.md](../CONVENTIONS.md) ("Footprint vs
hurtbox"). Verified: 8 new Tier-1 hurtbox unit tests + a Tier-2 "punch the overhang tile" regression.

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

## 2026-07-11 — [DECIDED] Premise & core loop: zombie apocalypse at Mostowo, day/night cycle

Camping at Mostowo when a zombie apocalypse hits (intro short story). Four pillars: base building,
survival, crafting, base defense. **Day** = scavenge camp/forest/surroundings for resources;
**base phase** = fortify (walls/traps), craft, unlock crafting stations; **night** = zombie animals,
humans, creatures come through the map. **Enemies are roaming (don't attack unless aggro'd) or
attacking** — this deliberately punishes staying out at night and makes "get home and defend" the
correct play. Full detail in GAME-DESIGN.md. Rationale: gives the day/night cycle real risk/reward
teeth and a clear emotional arc each cycle.
