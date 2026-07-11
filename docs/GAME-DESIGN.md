# Game Design

Living document for what Mostowa Survival *is*. Rough now; sharpens as we play. Everything here
is design intent — keep it aligned with the objectives below whenever we plan a feature.

## Pitch

You're camping at **Mostowa** when a **zombie apocalypse** breaks out. By day you range across the
campsite, forest, and surrounding areas scavenging resources; by night you hole up in your patch of
the camp and defend it as zombie animals, humans, and worse come through the map. Build, fortify,
craft, and survive night after night. Pixel-art, browser, single-player.

Tone: **slightly dark and grotty, but funny** — grim setting undercut by humorous items, enemies,
and visual gags.

## Objectives (the north star — plan features against these)

- Four intertwined pillars: **base building · survival · crafting · base defense**.
- A **day/night cycle** that creates a real risk/reward rhythm (explore vs fortify vs defend).
- A world **grounded in the real Mostowa** — its geography, people, stories, and local colour.
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

> TODO: capture the specific Mostowa people/stories/landmarks to draw on — add them to
> [LORE.md](LORE.md) as they're shared so any session can theme content consistently.

## Story intro

A **short story** sets it up: an ordinary camping trip at Mostowa, then the outbreak. Delivered as
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

## Maps & world structure

The world is **multiple discrete maps**, not one giant continuous map:

- **Starting map** — the camp and its immediate surroundings, where the base is. Built from a
  **Google Maps screenshot of the real Mostowa site** (to be provided): trace the real pitches,
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
- **Survival** — need meters (e.g. hunger, warmth, energy, health) tick with time; day/night tint.
- **Crafting** — data-driven items/recipes/stations; scavenged inputs → tools, weapons, defenses.
- **Base defense** — traps + walls + player combat vs the nightly wave; the payoff for the day's prep.

## MVP vertical slice (first playable) — proposed

Smallest thing that captures the day→fortify→night→defend *feel*:

1. Tile-grid slice of the Mostowa map, player movement.
2. **Day:** one or two resource nodes to harvest → items into an inventory.
3. **Fortify:** place a wall segment and one trap from gathered resources.
4. **Night:** a short timed wave of a couple of roaming/attacking zombies; base + trap + player can
   repel them; day/night tint + a survival meter ticking through it.

Weather, deep crafting trees, full map, save system, richer AI layer on *after* the slice is fun.

## Persistence

Single-player, client-side saves — `localStorage` for the MVP, IndexedDB if the save grows.

## Art direction

Dark, grotty, grimy palette with **comic timing** — funny item icons, characterful zombies, visual
gags. Placeholder/programmatic art first; real pixel art via free CC0 tilesets and Gemini-generated
assets (see [ASSETS.md](ASSETS.md)).

## Not doing (for now)

Multiplayer, backend, accounts, monetisation. Keep it a self-contained static site.
