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

You're camping at **Mostowo** when a **zombie apocalypse** breaks out. By day you range across the
campsite, forest, and surrounding areas scavenging resources; by night you hole up in your patch of
the camp and defend it as zombie animals, humans, and worse come through the map. Build, fortify,
craft, and survive night after night. Pixel-art, browser, single-player.

Tone: **slightly dark and grotty, but funny** — grim setting undercut by humorous items, enemies,
and visual gags.

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

The map is **based on the real place** the project is named after (a camping spot — reference image
from Google Maps to be added, see "Map" below). Locations, landmarks, and flavour draw on the
**people, stories, and themes of that place**: named areas, local characters reimagined as
survivors/NPCs/zombies, in-jokes and site-specific detail. This is what makes it *ours* rather than
a generic zombie game.

> TODO: capture the specific Mostowo people/stories/landmarks to draw on — add them to
> [LORE.md](LORE.md) as they're shared so any session can theme content consistently.

## Story intro

A **short story** sets it up: an ordinary camping trip at Mostowo, then the outbreak. Delivered as
an intro sequence (text + simple stills) before the first day begins. Draft to live in
[LORE.md](LORE.md).

## Core gameplay loop (day / night cycle)

**Daytime — scavenge.** The player leaves base and moves through the camp, forest, and surrounding
areas gathering resources (wood, stone, scrap, food, water, crafting components). Roaming threats
exist even by day but can often be avoided.

**Base phase — fortify & craft.** Return to your area of the camp to spend the day's haul:
- **Build:** walls, gates, defensive structures.
- **Traps:** placed defenses that damage/slow enemies at night.
- **Craft:** tools, weapons, consumables.
- **Crafting stations:** new stations unlock deeper crafting tiers (progression gate).

**Nighttime — defend.** Zombie **animals, humans, and other creatures** come through the map. The
player is heavily incentivised to be back at base defending, not caught out in the open.

## Enemy design — roaming vs attacking (the core tension)

- **Roaming** enemies wander and **won't attack unless aggro'd**. Blundering into them (or making
  noise/getting close) pulls aggro and can snowball into a pack chasing you.
- **Attacking** enemies actively push toward the base / the player.
- Design intent: **staying out at night is punished** — the longer you're away from your fortified
  base, the more roaming aggro you risk dragging into a fight you're not set up for. This is what
  makes "get home and hold the line" the emotionally correct play, not just a suggestion.

Enemy variety leans into the humour: zombie campsite animals, zombified local characters, absurd
creatures — grotty but funny.

> **First enemy in (plan 003):** the kid zombie's AI is a deliberately minimal stub — one state
> machine, `idle`/`chasing` on a vision-radius check, no deaggro. It's a proof of the combat/AI
> plumbing (stats schema, `resolveMeleeAttack`, pathfind-based chase), not the roaming/attacking
> model above — noise-based aggro, deaggro, pack-pulling, and additional enemy types are still to
> design.

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

## Daily narrative events (draft)

- **Each day opens with a narrative event** — a short bit of story presented with **multiple-choice
  options**. Choices carry consequences: **some good, some bad** (resources, risks, NPC encounters,
  map/story developments, buffs/debuffs for the day).
- Sets the tone and stakes for the day before the player heads out, and injects variety + story so
  no two days feel identical. Themed with Mostowo lore (see [LORE.md](LORE.md)).
- To design later: are outcomes deterministic or partly chance? Do prior choices/state gate which
  events appear? How authored vs. randomised is the pool?

## NPC companions (draft)

> **Foundation in place (plan 002):** the worker/task/pathfinding core — A* movement around
> obstacles, a per-worker `TaskQueue` of move/harvest/build orders, and timed on-site construction —
> is built and driving the player unit. NPC companions become *additional units* over the same
> machinery, not a new system.

- **Recruitable NPC characters** the player can **send out to do tasks during the day** (e.g.
  scavenging/gathering, and later other jobs) — extending what you can accomplish beyond the player alone.
- **They must be fed** — companions consume food, tying directly into the **hunger/food economy**:
  more helpers = more mouths, so there's a real trade-off between labour and food pressure.
- **At night they fight alongside you defending the base** — bolstering base defense against the wave.
- Themed as Mostowo people/survivors (see [LORE.md](LORE.md)); a natural home for named characters.
- To design later: recruitment, individual needs/traits/skills, task assignment UI, morale/loyalty,
  what happens if they starve, and how they behave in the night defense (positioning, orders).

## MVP vertical slice (first playable) — proposed

Smallest thing that captures the day→fortify→night→defend *feel*:

1. ~~Tile-grid slice of the Mostowo map, player movement.~~ ✅ (scaffold + core-loop slice, plan 001)
2. ~~**Day:** one or two resource nodes to harvest → items into an inventory.~~ ✅ tap-to-chop trees →
   wood into a character `Inventory` (plan 001).
3. **Fortify:** ~~place a wall segment~~ ✅ (walls, plan 001) · and one trap from gathered resources (todo).
4. **Night:** a short timed wave of a couple of roaming/attacking zombies; base + trap + player can
   repel them; day/night tint + a survival meter ticking through it. **Partially done (plan 003):**
   Combat mode (movepad + Punch), a shared stats/damage-resolution model, and one fixed-spawn kid
   zombie with idle/chasing AI + contact damage are in. Still todo: wave-spawning/pacing, day/night
   tint, and traps.

Weather, deep crafting trees, full map, save system, richer AI layer on *after* the slice is fun.

## Persistence

Single-player, client-side saves — `localStorage` for the MVP, IndexedDB if the save grows.

## Art direction

Dark, grotty, grimy palette with **comic timing** — funny item icons, characterful zombies, visual
gags. Placeholder/programmatic art first; real pixel art via free CC0 tilesets and Gemini-generated
assets (see [ASSETS.md](ASSETS.md)).

## Not doing (for now)

Multiplayer, backend, accounts, monetisation. Keep it a self-contained static site.
