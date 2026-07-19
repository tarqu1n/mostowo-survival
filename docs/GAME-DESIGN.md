# Game Design

Living document for what Mostowo Survival *is*. Rough now; sharpens as we play. Everything here
is design intent — keep it aligned with the objectives below whenever we plan a feature.

> **Ideas land here as they come.** Matt jots gameplay ideas into this doc (and lore into
> [LORE.md](LORE.md)) incrementally, often while other work runs. Capture them faithfully as they're
> shared — they get refined into concrete systems and MVP scope later, not necessarily built in order.

## Influences

- **Don't Starve** — the survival-needs model (hunger as a core, ticking pressure), grim-but-comic
  tone, and scavenge-by-day/danger-by-night rhythm are touchstones.

## Pitch

You're camped at **Mostowo** when the **old woods wake** — the dead don't stay down, and things you
can't name start coming out of the treeline. By day you range across the campsite, forest, and
surrounding areas scavenging resources; by night you hole up in your patch of the camp and defend it
as skeletons, beasts, and worse come through the map. Build, fortify, craft, and survive night after
night. Pixel-art, browser, single-player.

Tone: **dark-fantasy, slightly grotty, but funny** — a grim setting undercut by humorous items,
enemies, and visual gags.

## Objectives (the north star — plan features against these)

- Four intertwined pillars: **base building · survival · crafting · base defense**.
- A **day/night cycle** that creates a real risk/reward rhythm (explore vs fortify vs defend).
- A world **grounded in the real Mostowo** — its geography, people, stories, and local colour.
- Readable, characterful pixel art with a dark-but-comic identity.
- **Mobile-first**: primarily played on a phone (portrait, touch), scaling up to larger screens later.

## Platform & controls

**Phone-first, portrait orientation, touch controls** are the primary target; the game must **scale
to any screen size** (letterbox/fit on desktop now; showing more of the world on big screens is a
later enhancement). Design UI, tap targets, and framing for a phone first. Input abstraction should
not assume mouse/keyboard — touch is the baseline, pointer/keys are conveniences.

## Setting & theme

A **dark-fantasy** take on the real place: the woods around the camp are old, and something in them
has woken. The map is **based on the real place** the project is named after (a camping spot —
reference image from Google Maps to be added, see "Map" below). Locations, landmarks, and flavour draw
on the **people, stories, and themes of that place**: named areas, local characters reimagined as
survivors/NPCs/monsters, in-jokes and site-specific detail. This is what makes it *ours* rather than
a generic fantasy-survival game.

> TODO: capture the specific Mostowo people/stories/landmarks to draw on — add them to
> [LORE.md](LORE.md) as they're shared so any session can theme content consistently.

## Story intro

A **short story** sets it up: an ordinary camping trip at Mostowo, then the night the woods turn.
Delivered as an intro sequence (text + simple stills) before the first day begins. Draft to live in
[LORE.md](LORE.md).

## Core gameplay loop (day / night cycle)

Runs on a **continuous real-time clock** (built, plan 004) through four beats. Crucially, **the base
phase is not a separate timed phase** — fortifying/crafting shares the same daylight budget as
scavenging, so every minute spent prepping is a minute not spent ranging out, and vice versa. That
trade *is* the day's core decision. (Pacing targets for the clock: see "Pacing & the clock" below.)

**Dawn — the day's setup.** Opens with a narrative event (see "Daily narrative events"): flavour + a
buff/debuff/risk, and ideally a **scouting report on tonight's threat** so the player can prep
deliberately. Natural save/pause seam for a phone session.

**Day — scavenge & fortify (one budget).** Leave base and gather across camp/forest/surrounds (wood,
stone, scrap, food, water, components); roaming threats exist but are dodgeable. Return to spend the
haul — **build** walls/gates/defensive structures, place & **re-arm traps**, **craft** tools/weapons/
consumables, unlock **crafting stations** (deeper tiers — a progression gate), assign companions. You
budget daylight between exploring, prepping, and the trip home.

**Dusk — the hard countdown.** A visible, unforgiving timer. **There is no fallback:** caught away
from a defensible position at nightfall is *meant* to be a desperate scramble with a real chance of
death — the emotional spine of greed (one more node) → panic (the light going) → the run home. For
that to feel *fair* rather than cheap, two things are non-negotiable:
- **The day must be legible** — always know how much daylight is left *and* whether you can still make
  it home from where you stand (a "time-to-home vs. time-to-dusk" read). You should die because you
  knew and pushed one node too far, never because the clock was ambiguous.
- **Range must scale with capability both ways** — fast travel that takes you far has to bring you back
  just as fast. The car/boat are your dusk **lifeline**, not just explore tools; a far map is only safe
  to scavenge once you can exit it fast, and a cut-off fast-travel node (broken car, enemy-held boat
  launch) becomes a genuine "stranded out here at night" horror beat.

**Night — defend.** **Skeletons, beasts, and worse** come out of the treeline. Hold the fireline (see
"The night wave — shape" below). The player is heavily incentivised to be home defending, not caught out.

## Progression — three nested time horizons

What you're playing *toward*, at three scales that **reinforce rather than compete**:

|Horizon|Spine|The question|Failure|
|---|---|---|---|
|**Tonight** (moment-to-moment)|Escalating siege|"Can I hold *this* wave?"|Die at the fireline|
|**This stretch of days** (session)|Settlement growth|"Is my camp outgrowing the nights?"|Stall — outscaled, ground down|
|**The campaign** (meta)|Map unlock / escape|"Where is this going — can I get out?"|(win condition, not a fail)|

They interlock: you **grow the settlement** because the siege escalates; you **push into new maps**
because growth outstrips the home map; each new map is fresh scavenging **and** raises the ceiling on
what the nights throw at you. Unlocking the car doesn't just open fast travel — it advances the
escalation curve. So the escape arc and the siege arc are the same tension pulling opposite ways.

**The nightly wave escalates on a time ramp — keep up or die — with progress as the accelerant.**
Waves harden on a schedule (a treadmill that speeds up); pushing into new maps throws nastier types
into the pool, speeding the ramp further. This is *fair* because the base wave is **predictable** (you
know night N+1 is worse), **telegraphed** (the wave contract — see "Daily narrative events"), and
faced from **home** — you die because you didn't keep pace, not on a dice roll. (The earlier concern
about unfair deaths was really about *roaming* danger while you're out scavenging — a different threat
from the predictable base wave; that's what mustn't spike arbitrarily.) The escape story is the finish
line the other two spines don't provide alone — a growth sandbox fizzles, a pure siege is just a
high-score. Mostowo's premise hands us the arc: **understand what woke the woods, and get out — or put
it back down.**

**Endgame valve:** once you've out-paced the wave curve, the world opens into **optional authored
challenges** — hunt a named beast on a far map, clear a haunted location, arena/boss fights, timed
hunts — rewarding rare mats, blueprints, lore, or new recruits. This is what keeps a stabilised
settlement from fizzling, and feeds the escape arc.

## Pacing & the clock

Slow enough for a real scavenge run, tight enough to stay tense, short enough for a phone session.

- **Day is the long, breathing beat; night is shorter and denser** (Don't-Starve rhythm). **Current
  starting values (2026-07-19): day 11 min, night 4 min** (`DAY_MS`/`NIGHT_MS` in `config.ts`), full
  cycle 15 min — to tune by feel. A day must comfortably fit *leave → travel out → work a few nodes →
  travel home → prep*, or "no fallback" is unfair. **Knock-on:** hunger drain and campfire fuel were
  tuned against the old ~3.5-min cycle and now drain far faster *relative to a day* — retune alongside.
- **These are `config.ts` knobs, tuned by playtest** — the clock is already continuous + real-time
  (plan 004), so pacing is dawn/dusk-ramp + period tuning, not new architecture.
- **Travel time is the pacing pressure on exploration** — farther maps eat more daylight, so fast
  travel's real job is **buying daylight back** for actual scavenging on far maps (ties pacing to the meta spine).
- **Session-friendly:** the whole cycle wants to be completable in a sitting; **dawn** is the clean
  pause/save seam (localStorage MVP — save at dawn).
- **Playtest tell:** if "one more node" is never tempting, the day has slack; if you never get to range
  out before the light goes, it's too short.

## Enemy design — roaming vs attacking (the core tension)

- **Roaming** enemies wander and **won't attack unless aggro'd**. Blundering into them (or making
  noise/getting close) pulls aggro and can snowball into a pack chasing you.
- **Attacking** enemies actively push toward the base / the player.
- Design intent: **staying out at night is punished** — the longer you're away from your fortified
  base, the more roaming aggro you risk dragging into a fight you're not set up for. This is what
  makes "get home and hold the line" the emotionally correct play, not just a suggestion.

Enemy variety leans into the humour: undead campsite critters, cursed local characters, absurd
woodland beasts — grotty but funny.

> **First enemy in (plan 003):** the first enemy (rendered as a skeleton; legacy data id `kidZombie`)
> has a deliberately minimal stub AI — one state machine, `idle`/`chasing` on a vision-radius check,
> no deaggro. It's a proof of the combat/AI plumbing (stats schema, `resolveMeleeAttack`,
> pathfind-based chase), not the roaming/attacking model above — noise-based aggro, deaggro,
> pack-pulling, and additional enemy types are still to design.

## The night wave — shape, not just spawns

The wave is the biggest missing organ (night is tint-only today). The mistake to avoid is "N enemies
spawn and beeline the player." The roaming/attacking distinction above should be the wave's *structure*:

**A night comes in beats, not a blob:**

1. **The pressure ramp (early night).** A trickle of **attackers** test the walls — few, slow,
   readable. Traps do their quiet work; you learn where tonight's pressure is coming from. Almost
   relaxing — deliberately, so the player exhales right before the push.
2. **The push (mid night).** The main wave: attackers in enough number to *commit* to a wall gap,
   plus **roaming** enemies drawn in by the *noise of the fight* — the aggro system means combat
   itself escalates the wave (fighting is loud). This is the "hold the line" peak.
3. **The lull / dawn creep.** Numbers thin, a straggler or two still roams. The danger: the player
   relaxes, chases loot past the fireline, and gets caught by a leftover pack. **The lull is a trap.**

Layered on top, keyed to the **escalation curve** (a time-driven ramp accelerated by how far you've
pushed — see Progression):

- **Composition escalates, not just count.** Early: skeletons. Later: beasts, cursed local characters,
  a **named mini-boss** that a dawn narrative event foreshadowed. This is where dark-fantasy-comic
  lives — a specific horrible thing, not +3 generic skeletons.
- **Directionality.** The wave comes from the **treeline** (a map edge / the woods), so base
  *orientation* matters — you fortify the wood-facing side heavier. Later maps may attack from two
  edges, forcing you to split defense (or split companions).
- **A "wave contract" telegraphs tonight** so a hard-death night stays fair — delivered as hints woven
  into the dawn event (full treatment in "Daily narrative events + the wave contract" below). You die
  from a threat you *chose* to under-prepare for, never a surprise.

Technically friendly: the same FSM + spawn system, spawning attackers-from-treeline on a paced schedule
tied to the night phase, with the existing radius aggro doing the roaming-pull for free.

## Traps — the day's prep made physical

Walls alone make night a stationary punch-fest. Traps turn "defend" from *reacting* into *having
planned*. The design job: make trap placement a **spatial puzzle over your fireline**, not a resource dump.

**Core idea: traps aren't standalone, they're multipliers on your walls.** Walls make enemies *path
around* — so you already control where they walk. Traps punish the corridors your walls create. You're
not scattering traps, you're **funnelling the wave through a kill-channel and lining it.**

Starter palette (grotty-but-funny, reuses systems we have):

- **Spike pit / caltrops** — cheap, damage-over-tile, the bread-and-butter. Degrade per night (re-arm cost).
- **Snare / bear trap** — *stops* one enemy dead for a few seconds; a snared attacker is a sitting target
  for you + companions. Single-use, dramatic.
- **Bait / lure** — leans on the aggro system: drop something that *pulls roaming aggro* away from your
  gap. Misdirection as defense (a haunch of dubious meat, a music box). Very Mostowo.
- **Fire trap** — ties to the campfire/light theme; gathered oil ignites a tile-line. Big payoff, real
  risk of catching your own wooden walls (a placement tension).

Two rules I'd commit to:

1. **Traps degrade / trigger-once and are re-armed by a queued worker order each morning** — reusing the
   `refuel`-style order pattern. This is the important one: it makes traps *part of the daily loop*
   (gather → craft → re-arm) instead of set-and-forget, keeping a real job in the day phase.
2. **Traps are placed in the base phase and cost the day's scarce inputs** — every trap is "this, or
   another wall segment, or a weapon." That scarcity *is* the fortify minigame.

Mobile: traps + walls share the existing build palette; the cheap ones want a **directional/line paint**
(drag a row of caltrops), not tile-by-tile taps.

## Maps & world structure

The world is **multiple discrete maps**, not one giant continuous map:

- **Starting map** — the camp and its immediate surroundings, where the base is. Built from a
  **Google Maps screenshot of the real Mostowo site** (to be provided): trace the real pitches,
  tracks, treeline, water, and buildings into a tile map, base in a plausible camping spot.
- **Unlockable adjacent areas** — surrounding areas open up as the game progresses. Think of each as
  a **new map "bolted on"** to the existing world (reached from an edge/exit of an unlocked map).
- **Special maps via fast travel** — reachable once the player unlocks transport:
  - **Car** — unlocked by **repairing** it → fast-travel to certain maps.
  - **Boat** — unlocked by **building** it → fast-travel to water-reachable maps.

**Architecture implication:** treat maps as **data-driven, independently-loaded scenes/definitions**
registered in a **map registry**, with defined **connections** (edge transitions + fast-travel
nodes) and **unlock gates**. Persist which maps/connections/transport are unlocked in the save.
Don't hard-wire a single world; build the map-loading + travel system to add maps cheaply.

> When the screenshot arrives, save it under `docs/assets/reference/` and record what each real
> area maps to in-game here, plus how areas connect and what gates each unlock.

## Pillars in more detail

- **Base building** — claim and shape your camp area; walls/gates define a defensible perimeter.
- **Survival** — need meters tick with time; **hunger is a core mechanic** (Don't Starve-style — a
  constant pressure that pushes you out to scavenge food and punishes hoarding time). Alongside it:
  health and other wellbeing needs (e.g. warmth, energy). See "Survival & inventory systems" below.
- **Crafting** — data-driven items/recipes/stations; scavenged inputs → tools, weapons, defenses.
- **Base defense** — traps + walls + player combat vs the nightly wave; the payoff for the day's prep.

## Crafting & stations

No crafting system exists yet — greenfield. The gate *is* the progression, not difficulty bolted on later.

**Stations are buildables** (reuse `BUILDABLES` + `BuildManager` + the build palette). A recipe declares
the station (and tier) it needs; the crafting UI shows only recipes whose station exists in the base —
an unmet recipe is **invisible** until you can see the thing that makes it.

**Tiering is hybrid (decided 2026-07-19):** distinct station *kinds* (e.g. workbench → forge →
alchemy/arcane bench), each unlocking a band of recipes, **and** each **upgradeable a level or two** in
place for deeper outputs. Distinct kinds give visible in-base progression; in-place upgrades add depth
without a whole new station per tier.

**The tree reaches across maps.** Higher stations / upgrades need lower-station outputs *plus* materials
that only appear on maps you haven't unlocked — so the crafting tree and the map-unlock spine are the
**same climb**. You can't out-tech the nights without pushing outward, and pushing outward raises the
night ceiling.

**Crafting is a queued station task, not an instant menu** (matches the "work reads as work" ethos —
harvest/refuel are worker orders). Assign a recipe → a worker or **companion** walks over and crafts it
over `craftMs`. This gives companions a real day job beyond gathering (station operators): a mature base
is a production line.

**Blueprint discovery is a second, optional gate:** some recipes must be *found* (exploration / a dawn
narrative event), pacing reveals independently of resources and giving narrative events mechanical teeth.

**Cost that keeps it honest:** stations take base space and sit *inside the fireline* — more stations =
bigger base = more to defend (see "Base claim" below). Crafting depth is paid in defensibility.

Data shape to firm at plan time: `Recipe { inputs, output, station, stationTier?, craftMs, blueprintId? }`;
stations carry a kind + level; the UI filters recipes by which stations/levels are present.

## Base claim — the campfire heart

Replaces the placeholder fixed base rect (`BASE_ZONE_SIZE` centred on spawn — plan 018 A8, always a
stopgap). **Decided 2026-07-19: your base is everywhere your fire's light reaches** — the hearth *is*
the claim. This collapses base-building + survival + defense into one object and reuses the already-built
campfire light/vision/fuel systems (`CampfireManager`, `lightSources()`, fuel-scaled radius).

- **Claim = lit area.** Standing in it grants auto-access to base storage (the "being home opens the bag"
  rule → "being in the light"), buildable/station placement, and vision.
- **Expansion is costed.** Bigger fire = bigger claim = room for more stations/walls — but more fuel drain
  **and** more perimeter to defend. Growth has a *running* cost (fuel) + a defense cost (perimeter), not
  just a build price. Light a **second hearth** to push the claim toward the treeline you must hold — a
  network of fires, each its own fuel sink.
- **Torches — cheap perimeter/wall lighting.** A small-radius light source (its own buildable) that also
  needs refuelling. Hearths are the expensive *anchors* of the claim; torches cheaply light the walls,
  perimeter, and gaps the fires don't reach — so you light a wall line without paying for a whole hearth.
  Both fires and torches are what NPCs keep lit at night (the fire-tending night role).
- **The dark reclaims ground.** A fire that burns out at night → that area goes dark → vision lost →
  enemies pour through the unlit gap. "Hold the fireline" is literal; night refuelling is a live
  defensive task (a companion job), and the fuel economy becomes the base's load-bearing strategic resource.
- **Resolves the deferred enemy fog-gating** (plan 012): enemies are hidden in darkness, revealed in the
  light — the natural partner to the treeline-directional night wave.

**Knock-on:** fire = base means the campfire fuel numbers (flagged mis-tuned for the 15-min cycle) are now
**critical** — fuel governs the whole claim, so it must be tuned as a strategic resource, not a chore. The
retune is no longer optional under this model.

**Staging (not a cliff):** (1) base zone becomes the central hearth's radius, replacing the rect;
(2) multiple fires union their claims; (3) walls shape/extend the boundary as long as it stays fire-connected.

## Survival & inventory systems (draft)

Ideas captured as they land; to be firmed into real systems later.

### Inventory & base storage

- **Two inventories:** a limited **character inventory** (what you carry into the field) and a larger
  **base inventory / storage**.
- **In the base, you have auto-access to the base inventory** — no walking to a specific chest;
  being "home" opens it. You freely **transfer items to and from your character inventory** there.
- Implication: the field is constrained by carry space (choose what to haul back); the base is where
  you offload, stockpile, and load up for the next run. Carry limits make the day's route a decision.

### Health & wellbeing view

- A dedicated **Health & Wellbeing screen** showing the player's status — the need meters (hunger,
  health, and later warmth/energy/etc.) and any conditions/effects.
- It includes a **"what's available to eat" section** — surfacing edible items (from character and/or
  base inventory) so the player can manage hunger deliberately rather than digging through raw inventory.

### Hunger (core mechanic — Don't Starve-like)

- **Hunger is central**, not a side stat. It ticks down constantly with time/activity and creates the
  core survival pressure: keep fed or suffer (health drain / penalties when starving).
- Drives the whole scavenge loop — you range out for food, and hunger is a big reason you can't just
  turtle in the base forever. Food is a managed resource: gather, cook/craft, store, ration.
- To design out later: food types & spoilage, cooking/crafting food at stations, hunger→health
  cascade, and how night danger trades off against the need to forage.

## Daily narrative events + the wave contract

**Each dawn opens with a short authored vignette + 2–4 multiple-choice options** — the day's setup
(tone, stakes, variety, so no two days feel identical) and, crucially, **how tonight's threat is
telegraphed** (see "the wave contract" below). Themed with Mostowo lore ([LORE.md](LORE.md)).

**Outcomes are mostly deterministic, with occasional gambles** (decided 2026-07-19). Most choices carry
known-ish consequences so a choice is a *decision*, not a dice roll — fair under hard-death "no
fallback" — with the odd explicit "press your luck" option for spice.

**Event pool** — a weighted draw from an authored pool, gated by state (day count, unlocked maps,
recruited NPCs, prior choices); some **one-shot** (story beats, recruit hooks like Litrandil), some
**repeatable** (flavour). Types:

- **Threat foreshadow** — carries the wave contract (below).
- **Opportunity** — a cache, a scavenge lead, a passing trader.
- **Encounter** — an NPC: a recruit hook, a threat, or a moral choice.
- **Pressure** — a companion crisis, a curse, weather turning.
- **Story** — advances the escape arc / a map unlock.

**Consequences carry into the day and night** — a day buff/debuff, resources gained/lost, a modifier on
tonight's wave, a revealed map node, a companion's mood.

### The wave contract

Because dusk is a hard countdown with no fallback and the wave hardens over time (see Progression), the
player must *see tonight coming* to prep fairly — you die from a threat you chose to under-prepare for,
never a surprise. The contract is that morning read.

**For now: hints only** (decided 2026-07-19). Delivered as **atmospheric foreshadowing woven into the
dawn event** — "a survivor staggers in raving about lights in the north woods" (≈ big, from the north) —
not a precise stat readout. Enough to steer prep (roughly which wall, roughly how hard), short of
spelling it out.

**Eventually** (deferred design) it aims to convey four things via a glanceable "tonight" HUD card:
**scale** (rising with the time ramp), **composition** (escalating types; a named boss on spike nights),
**direction** (which treeline ⇒ which wall to fortify — "hold the north wall"), and an occasional
**modifier** (a fog night that kills vision, a wave targeting a structure, a fast rush) — with fidelity
you can **sharpen by investing** (a scout companion / watchtower / Litrandil's divination). Not built
now; hints first.

## NPC companions (draft)

> **Foundation in place (plan 002):** the worker/task/pathfinding core — A* movement around
> obstacles, a per-worker `TaskQueue` of move/harvest/build orders, and timed on-site construction —
> is built and driving the player unit. NPC companions become *additional units* over the same
> machinery, not a new system.

**A companion is one resource seen three ways — and you can't optimise all three at once.** This is
the triangle that makes them a *mechanic*, not just "more units":

- **Day: labour.** Send them to gather/chop/build on the existing worker task queue (they're just more
  units on it). More companions = more done per day = you can range further yourself.
- **Always: a mouth.** Each eats from the hunger/food economy. More helpers = more food pressure = you
  *must* range further. The self-tightening screw: the labour that lets you explore also forces you to.
- **Night: muscle.** They fight at the fireline — where the food you spent pays back.

These fight over the *same* companion's time and your *same* food stockpile. A big camp is a stronger
night defense **and** a bigger daily food deficit — settlement-growth spine and survival pillar pulling
against each other, exactly as wanted.

Design calls to stake out:

- **Recruitment is per-character, often a quest.** You acquire companions different ways; the first
  concrete pattern is a **fetch-and-deliver quest** — talk to an NPC, accept their ask, gather/craft
  what they want, deliver it, and they join. First example: **Litrandil the drunk wizard**, who wants
  **cigarettes + vodka** before he'll join (see [LORE.md](LORE.md)). This makes recruitment a hook for
  crafting chains and exploration (cigs = tobacco + paper; vodka = scavenged), and a natural home for
  named Mostowo characters.
- **Assignment is a day-role AND a night-role, hot-swappable at any time.** Each companion holds a
  standing job per phase that you can reassign on the fly. **Day roles** are worker-queue tasks (arm/
  re-arm traps, cook food, gather, operate a crafting station). **Night roles** are defense postures
  (feed the fires/torches, **hold the north wall** or a named segment, or follow you as a mobile squad).
  Getting the night assignment right — bodies on the segments your walls funnelled toward — is the payoff
  of the whole prep phase. Reuses the worker task queue (day) + the hold-segment posture (night).
- **Start with one trait axis, not a matrix.** Each companion is *better at one thing* (a strong fighter
  who's a mediocre gatherer vs. a forager who folds in a fight). That alone creates "who do I send out
  vs. who holds the wall tonight." Themed as named Mostowo locals.
- **Permadeath, and it should hurt.** Consistent with "no fallback": a companion who dies at the wall,
  starves, or is caught out is *gone*. Makes sending them out a real gamble and recruitment beats matter;
  feeds the grotty-but-funny tone (locals meeting absurd ends).
- **Starvation gives a warning turn, not instant death.** They get **weak first** (worse at everything,
  may refuse orders) — a moral/resource choice (feed them the last berries, or feed yourself) with a
  window to act, which matters more under permadeath.
- **[OPEN] Are recruitment desires one-time or ongoing?** Is Litrandil's vodka/cigs a one-off entry
  price, or an ongoing upkeep/morale need (a drunk wizard who works worse sober)? Ongoing ties into the
  hunger/morale economy; one-time keeps recruitment a clean gate. To decide.
- Themed as Mostowo people/survivors (see [LORE.md](LORE.md)); a natural home for named characters.
- Still to design: task-assignment UI, morale/loyalty, deeper trait/skill systems.

## MVP vertical slice (first playable) — proposed

Smallest thing that captures the day→fortify→night→defend *feel*:

1. ~~Tile-grid slice of the Mostowo map, player movement.~~ ✅ (scaffold + core-loop slice, plan 001)
2. ~~**Day:** one or two resource nodes to harvest → items into an inventory.~~ ✅ tap-to-chop trees →
   wood into a character `Inventory` (plan 001).
3. **Fortify:** ~~place a wall segment~~ ✅ (walls, plan 001) · and one trap from gathered resources (todo).
4. **Night:** a short timed wave of a couple of roaming/attacking monsters; base + trap + player can
   repel them; ~~day/night tint + a survival meter ticking through it~~ ✅ (plan 004 — real-time
   day/night cycle, hunger→health cascade, Health & Wellbeing screen as the eat surface; night is
   tint+phase only so far, no waves yet). **Partially done (plan 003):** Combat mode (movepad +
   Punch), a shared stats/damage-resolution model, and one fixed-spawn enemy (skeleton) with
   idle/chasing AI + contact damage are in. Still todo: the short timed wave itself (spawning/pacing)
   and traps.

Weather, deep crafting trees, full map, save system, richer AI layer on *after* the slice is fun.

## Persistence

Single-player, client-side saves — `localStorage` for the MVP, IndexedDB if the save grows.

## Art direction

Dark, grotty, grimy palette with **comic timing** — funny item icons, characterful monsters, visual
gags. Medieval-fantasy pixel art (see [ASSETS.md](ASSETS.md)); real pixel art via free CC0 tilesets
and Gemini-generated assets.

## Not doing (for now)

Multiplayer, backend, accounts, monetisation. Keep it a self-contained static site.
