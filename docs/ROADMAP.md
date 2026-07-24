# Roadmap — to a first playable MVP

The path to the **smallest complete, *fun* day → night → defend loop**. Scope locked 2026-07-19.
Everything not on this path is deferred (see "Post-MVP" at the bottom); the full vision lives in
[GAME-DESIGN.md](GAME-DESIGN.md).

> **Framing:** most of the loop's *machinery* already exists (see [STATUS.md](STATUS.md)). The MVP is
> mostly **completing and de-clunking** what's there — reworking combat feel, turning the existing
> day/night clock into an actual defend phase, and reusing the worker/pathfinding spine for the NPC —
> not building four systems from scratch.

## The MVP loop (what "done" plays like)

By **day**, gather resources and keep hunger at bay; prep the base (walls + one trap). Your **campfire
is the heart** — its light *is* your base/claim. By **night**, a wave of skeletons comes out of the
treeline and **targets the fire to knock the light out** (as well as coming for you) — keep it lit, or
fight on in the dark. Survive → the next night is harder. **Lose** only if *you die* → restart. The fire
being knocked out is a dire, recoverable setback (relight it), **not** a loss (owner call, 2026-07-20).

## Scope decisions (locked 2026-07-19)

- **Campfire-heart is IN (stage 1).** The central fire's **lit radius is the base/claim** (replaces the
  fixed base rect for the one starting fire). Its light is **sustained by fuel and reduced by mob
  attacks** — mobs target the fire to **knock the light out**. *(Multiple hearths, walls extending the
  claim, and torches stay post-MVP.)*
- **Defend target = keep yourself alive; keep the fire lit if you can.** Lose = **player dies only**
  (the 2026-07-19 open detail settled 2026-07-20, owner): the fire being knocked out is **not** a loss
  but a dire dark-flooded-in state you claw back from by relighting. Mobs still target the fire — knocking
  the light out is real pressure (you fight the rest of the night in the dark) — it just isn't a fail state.
- **The campfire-fuel retune is now ON the MVP path** (reverses the earlier "no fuel retune" note): with
  the fire load-bearing — light = claim, plus mob damage on top of fuel burn — the fuel numbers (sized
  for the old ~3.5-min cycle) must be retuned for the 15-min cycle.
- **Hunger is IN the loop.** ✅ Now live (plan 041): food authored on the MVP map, `HUNGER_LETHAL` flipped,
  drain retuned to the 15-min cycle — done as reuse + tuning, not a new system.
- **NPC recruitment is skipped for MVP** — spawn a companion directly; Litrandil's quest is post-MVP.

## Build order

Each step ends in something you can **feel** and **test** (leaning on the DEV scenario API —
`applyScenario`/`step` — see [testing.md](testing.md)). Steps are sequenced by dependency + risk:
combat is the verb everything reuses, the night wave is the riskiest missing piece and the earliest
"feel the loop" milestone, the trap needs the wave's pathing to tune against, and the NPC is the most
composite (it reuses everything before it).

### 0. MVP arena map

A small authored map: a base spot with the campfire, resource nodes (trees + rock + **berry bushes for
food**), and a **treeline edge** to spawn the wave from. Built in the Map Builder editor.
*Done when:* the game boots into it with gatherable nodes and a clear base + wood-facing edge.

### 1. Combat feel rework

Combat exists but is clunky. Rework **both sides**: player attack responsiveness/readability, and the
**skeleton's behaviour + a real telegraphed attack** (today it has none — only contact damage + a coded
lunge — which is the core clunk). The foundation the wave and NPC both reuse, so de-risk it first.
**Tuned to the thesis** ([GAME-DESIGN.md](GAME-DESIGN.md) "Player combat — the danger verb"): personal
combat is the *dangerous* verb — the player is fragile, melee is committal and something you're relieved
to avoid, **not a power fantasy**. Traps + NPCs are the intended answer; you melee in emergencies.
*Done when:* fighting a single skeleton — with **melee and the bow** — is **tense, readable, and fair**
(clear tells, hit feedback, readable range, no mode-fighting) — you feel *exposed*, not dominant.
*Test:* scenario spawns one skeleton, fight it.
*Scope:* MVP combat = **melee + a basic bow** (adds an arrows/ammo resource + auto-target-nearest aiming).
*Controls (settled — see GAME-DESIGN "Fighting controls"):* movepad + an auto-surfacing action cluster
(Melee + Bow, room for a later Spell slot); melee slows you a lot / bow only a little while firing;
facing-biased auto-target with a **highlighted target**; **telegraphed** enemy wind-ups; minimal
attention-scoped monster HP bars; **no dodge in MVP** (kite instead). This step also adds: the bow +
arrows, the target highlight, HP-bar rendering, and a real telegraphed skeleton attack.

**Progress — largely delivered by [plan 035a](../plans/035a-combat-feel-skeleton-controls-bow.md):**
telegraphed skeleton wind-up, the left-movepad + Melee/Bow/Spell cluster, auto-surface, the
facing-biased auto-target bow with highlight + hitscan arrow, and the attention-scoped monster HP bars
all landed (see [STATUS.md](STATUS.md)). **Flagged stand-ins:** the bow release anim is a coded
placeholder (reuses the Pierce strip — no bow rig/art yet), and **arrows are unlimited** (the ammo
resource in the scope line above is deferred). The **boar + the 4-way directional-actor pipeline** are
split out to **[plan 035b](../plans/035b-boar-directional-enemy.md)** (still to do).

### 2. The night wave + loop-close (**first playable loop**)

- Spawn skeletons from the treeline at night, path them toward the **fire / player**, attack; wave
  ends at dawn. Drives off the existing day/night **phase state**.
- **Fire-heart defense:** the campfire's **light = the base claim** (its lit radius). Mobs **target the
  fire to knock the light out** — attacks drain its **fuel** (the same meter feeding wood restores — no
  separate integrity meter; owner, 2026-07-20). **Lose** = **player dead only**; a knocked-out fire
  floods darkness (relight to recover), not a game-over. **Retune campfire fuel for the 15-min cycle
  here** (now load-bearing — the fire is what stands between you and the dark).
- **Loop-close:** night survived → dawn → **day N+1**, with a small **escalation bump** each night
  (more/tougher spawns). This is what makes it a *game*, not a sandbox.
- **Debug trigger:** a "skip to night / force wave" dev hook for manual playtesting (the scenario API
  already gives deterministic clock control for automated tests).

*Done when:* night falls → a paced wave arrives → you defend the fire to dawn → the next night is harder.
*Test:* clock to dusk, assert spawns from the edge, step to dawn, assert survival + day increment.

**Progress — DELIVERED by [plan 038](../plans/038-night-wave-loop-close.md):** the `WaveDirector` paces
a night wave from the "treeline" (trickle→push→lull), skeletons **seek + attack the fire's fuel** (new
`seek` FSM state) with player-acquire preempting, the loop **closes** (survive → day N+1) and
**escalates** per night (bigger rush, denser pacing, boars from night 2), plus the fire-fuel HUD bar, a
night/wave indicator, and a **FORCE WAVE** dev hook. The roadmap acceptance test above passes end-to-end.
**Two owner scope changes at execution (see the plan):** the fire is **not a loss condition** (only
player death loses — a knocked-out fire floods darkness, relight to recover) and there's **no integrity
meter** (mob attacks drain the existing fuel). **Deferred to the arena map (Step 0):** spawns anchor to
the defended centre, not a real map treeline edge (the-moon's grid perimeter is void).

### 3. One trap ✅

A single trap buildable placed by day from gathered resources (walls already prove the build/blueprint
path). Ordered **after** the wave so it can be tuned as a funnel against real wave pathing.
*Done when:* you place it by day and watch it damage/stop the wave at night. *Test:* place via scenario,
run wave, assert trap damage.

> **✅ Delivered — [plan 040](../plans/040-spike-trap.md)** (the "one trap", carved out of plan 037). The
> **spike trap** ships as the third `TrapBehavior` module on the StructureManager registry landed below:
> an armed floor tile that **triggers once** on an enemy standing on it, then is **re-armed each morning**
> by a queued worker order (dawn auto-enqueue + tap). Acceptance met — a Tier-2 spec drives the **live
> wave** (`beginWave()`) and asserts a real wave mob crossing the trap takes its hit. **Numeric tuning
> deferred:** damage / build cost / re-arm economy vs wave DPS are flagged placeholders in `config.ts`
> for a later feel pass. See [docs/STATUS.md](STATUS.md#spike-trap-plan-040).
>
> **Landed ahead of this step — base-defence walls + StructureManager ([plan 037](../plans/037-base-defence-structures.md)).**
> Not a numbered MVP step (walls "already prove the build path"), but pulled in early: **destructible
> 4-way palisade walls** the player rotates + deconstructs (partial refund), which mobs **siege** when
> walled off from the fire/player and take **thorns** damage from; the campfire + wall runtimes are now
> unified under a **`StructureManager` + behavior-module registry**, which plan 040's trap plugs into as
> the third behavior. The **gate** (ally-permeable barrier) is deferred into later *upgraded-walls* work.

### 4. Hunger live ✅

Author food on the map (berry bushes → berries already exist as an edible), set `HUNGER_LETHAL = true`,
and **retune the drain** so hunger is a "range out for food across the day" pressure — not the current
~250s empty (way too fast for an 11-min day). Mostly reuse + tuning; can slot in flexibly once the map
(step 0) has food, but flip it lethal *late* so it doesn't harass earlier playtesting.
*Done when:* ignoring food across a day meaningfully threatens you; eating relieves it. *Test:* scenario
runs a day with/without eating, assert the hunger→health cascade.

> **Progress — DELIVERED (plan 041).** Drain retuned `0.4 → 0.15`/s (a full bar ≈ one 660s day, the "one
> food run per day" pace); `HUNGER_LETHAL` flipped to `true` and reframed as a dev toggle; the starve→HP
> cascade ratio left untouched. Berry bushes authored on `the-moon` near the camp resources (the food
> gate). Acceptance: `tests/e2e/survival-hunger.spec.ts` runs a day with/without eating — the previously
> known-red "a starving player loses HP" now passes, plus new full-day drain, without-eating cascade, and
> eating-relieves-it specs.

### 5. The NPC (labour + muscle) ✅

Spawn one companion (no recruit quest). **Movement reuses the worker A\* + task queue**; **combat reuses
the skeleton's** model. Give it one **day role** (gather or build) and one **night defend-posture** (hold
near the campfire / a wall segment), reassignable.
*Done when:* the NPC gathers by day and fights the wave by night, and you can switch its role.
*Test:* scenario spawns an NPC, assigns a day task then a night posture, runs a full cycle.

**Progress — DELIVERED by [plan 042](../plans/042-npc-companion.md):** one dev-/scenario-spawned
companion (the **Rogue** sprite — new `NpcCharacter`, the 3rd `Character` subclass; owned by
`src/scenes/world/CompanionManager.ts` with its own `TaskQueue`+executor, combat stepper, and postures).
**Day** = one assignable role, **Gather** (harvest nearest wood/rock into a low carry cap, deposit at the
hearth) ↔ **Repair** (mend the most-damaged wall, consuming stockpile wood; idle when empty) — tied through
the new **`baseSupply`** store (pure `systems/baseSupply.ts`, counts-only `wood`/`rock`, **separate from the
player `Inventory`** — no withdraw UI, shown in the HUD; gather fills it, repair drains it). **Night** = 3
postures — **Guard here** (hold a placed point, engage in range, return to post), **Follow**, **Refuel
lights** (feed the fire from base supply) — fighting the wave via the shared melee model
(`systems/companionCombat.ts`). **Mobs can aggro the NPC** (the monster FSM target generalised from
player-only to nearest-of-{player, NPC}) → it can be **downed** (inert on its Death strip, not removed) →
**auto-revives at the next dawn** (what makes downed/revive reachable in play). Tap-the-NPC HUD assignment
popover (Guard-here arms a one-tap place-point mode), same setters on the scenario/test API. **All `NPC_*`
tuning in `config.ts` is flagged placeholder** (later feel pass); the **recruit quest is post-MVP**. This
**closes the MVP path** — Steps 0–5 all delivered. See [STATUS.md](STATUS.md#npc-companion-plan-042).

## After this = the full loop

With 0–5 done: **gather + eat by day → fortify (walls + trap) → defend the fire against an escalating
night wave, helped by an NPC → survive to a harder tomorrow.** That's the complete core loop; everything
else builds on a foundation that's already fun.

## Post-MVP (deferred — designed, not scheduled)

Full designs in [GAME-DESIGN.md](GAME-DESIGN.md) / [DECISIONS.md](DECISIONS.md). Not on the MVP path:

> **Post-MVP progress:** **crafting** is underway (✅ workbench station plan 048 → ✅ equippable items +
> brand/durability plan 049), and the **build experience** is the chosen next focus — the **Blueprint
> Mode overhaul** (✅ plan 050: pointer-up placement, a drag-to-paint line-tool run + commit bar,
> per-buildable build time, rotation ring; buildable-icon art deferred). Directions explored in
> [build-ui-options.html](build-ui-options.html); see [STATUS.md](STATUS.md#blueprint-mode--build-experience-overhaul-plan-050).

- **Crafting stations** (hybrid-tier tech tree) + deeper item recipes.
- **NPC recruitment quests** (Litrandil the drunk wizard) + traits, morale, permadeath nuance.
- **Campfire-heart extensions:** multiple hearths + unioned claims, walls extending the claim, and
  **torches** (MVP has only the single central hearth — stage 1; see step 2).
- **Daily narrative events** + the structured **wave contract** (HUD card, invest-to-sharpen fidelity).
- **Multi-map world** + car/boat fast travel; the escape-arc campaign spine; endgame challenges.
- Richer enemy roster (beasts, cursed locals, named mini-bosses) beyond the skeleton.
