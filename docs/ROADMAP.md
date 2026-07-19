# Roadmap — to a first playable MVP

The path to the **smallest complete, *fun* day → night → defend loop**. Scope locked 2026-07-19.
Everything not on this path is deferred (see "Post-MVP" at the bottom); the full vision lives in
[GAME-DESIGN.md](GAME-DESIGN.md).

> **Framing:** most of the loop's *machinery* already exists (see [STATUS.md](STATUS.md)). The MVP is
> mostly **completing and de-clunking** what's there — reworking combat feel, turning the existing
> day/night clock into an actual defend phase, and reusing the worker/pathfinding spine for the NPC —
> not building four systems from scratch.

## The MVP loop (what "done" plays like)

By **day**, gather resources and keep hunger at bay; prep the base (walls + one trap). By **night**, a
wave of skeletons comes out of the treeline and attacks — **defend the campfire (and yourself)** until
dawn. Survive → the next night is harder. **Lose** if you die *or* the campfire is destroyed → restart.

## Scope decisions (locked 2026-07-19)

- **Defend target:** the **campfire** *and* the player. Lose condition = player dies **or** campfire
  destroyed. (Campfire gains HP + becomes an enemy target; we still keep the **fixed base rect** — the
  campfire-heart *claim* mechanic is post-MVP, so no fuel retune is required here.)
- **Hunger is IN the loop.** It's built and only non-lethal because the start map has no food — so this
  is *author food on the MVP map + flip `HUNGER_LETHAL` + retune drain to the 15-min cycle*, not a new system.
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
**skeleton's behaviour + a real attack** (today it has no attack strip — only contact damage + a coded
lunge). This is the verb repeated most, and the AI/feel the wave and NPC both reuse — so de-risk it first.
*Done when:* fighting a single skeleton feels responsive and fair (clear tells, hit feedback, readable
range, no mode-fighting). *Test:* scenario spawns one skeleton, fight it.

### 2. The night wave + loop-close (**first playable loop**)

- Spawn skeletons from the treeline at night, path them toward the **campfire / player**, attack; wave
  ends at dawn. Drives off the existing day/night **phase state**.
- **Campfire destructible** (HP) + enemies target it; **lose condition** = campfire destroyed or player dead.
- **Loop-close:** night survived → dawn → **day N+1**, with a small **escalation bump** each night
  (more/tougher spawns). This is what makes it a *game*, not a sandbox.
- **Debug trigger:** a "skip to night / force wave" dev hook for manual playtesting (the scenario API
  already gives deterministic clock control for automated tests).

*Done when:* night falls → a paced wave arrives → you defend the fire to dawn → the next night is harder.
*Test:* clock to dusk, assert spawns from the edge, step to dawn, assert survival + day increment.

### 3. One trap

A single trap buildable placed by day from gathered resources (walls already prove the build/blueprint
path). Ordered **after** the wave so it can be tuned as a funnel against real wave pathing.
*Done when:* you place it by day and watch it damage/stop the wave at night. *Test:* place via scenario,
run wave, assert trap damage.

### 4. Hunger live

Author food on the map (berry bushes → berries already exist as an edible), set `HUNGER_LETHAL = true`,
and **retune the drain** so hunger is a "range out for food across the day" pressure — not the current
~250s empty (way too fast for an 11-min day). Mostly reuse + tuning; can slot in flexibly once the map
(step 0) has food, but flip it lethal *late* so it doesn't harass earlier playtesting.
*Done when:* ignoring food across a day meaningfully threatens you; eating relieves it. *Test:* scenario
runs a day with/without eating, assert the hunger→health cascade.

### 5. The NPC (labour + muscle)

Spawn one companion (no recruit quest). **Movement reuses the worker A\* + task queue**; **combat reuses
the skeleton's** model. Give it one **day role** (gather or build) and one **night defend-posture** (hold
near the campfire / a wall segment), reassignable.
*Done when:* the NPC gathers by day and fights the wave by night, and you can switch its role.
*Test:* scenario spawns an NPC, assigns a day task then a night posture, runs a full cycle.

## After this = the full loop

With 0–5 done: **gather + eat by day → fortify (walls + trap) → defend the fire against an escalating
night wave, helped by an NPC → survive to a harder tomorrow.** That's the complete core loop; everything
else builds on a foundation that's already fun.

## Post-MVP (deferred — designed, not scheduled)

Full designs in [GAME-DESIGN.md](GAME-DESIGN.md) / [DECISIONS.md](DECISIONS.md). Not on the MVP path:

- **Crafting stations** (hybrid-tier tech tree) + deeper item recipes.
- **NPC recruitment quests** (Litrandil the drunk wizard) + traits, morale, permadeath nuance.
- **Campfire-heart base claim** (lit-area = base) + **torches** + the fuel retune it makes load-bearing.
- **Daily narrative events** + the structured **wave contract** (HUD card, invest-to-sharpen fidelity).
- **Multi-map world** + car/boat fast travel; the escape-arc campaign spine; endgame challenges.
- Richer enemy roster (beasts, cursed locals, named mini-bosses) beyond the skeleton.
