# Game Design

Living document for what Mostowa Survival *is*. Rough now; sharpens as we play.

## Pitch

A cosy-but-tense pixel-art **survival base-builder** set at Mostowa. You arrive at a wild
campsite, gather what the land gives (wood, stone, water, food), build and upgrade a base, and
survive the passing of days (and whatever the environment throws at you).

## Theme

Grounded in the real place: a lakeside / woodland camping spot. Lean into what's actually there —
forest, water, campfire, tent → cabin progression, weather, day/night. (Confirm real-world details
of Mostowa to flavour the map, resources, and events.)

## Core loops (draft)

1. **Gather** — harvest resource nodes (trees, rocks, water, forageables) into an inventory.
2. **Craft / build** — spend resources to place structures and craft tools that unlock more gathering.
3. **Survive** — manage need meters (e.g. hunger, warmth, energy) across a day/night cycle.
4. **Progress** — upgrade the base (tent → shelter → cabin) and expand what's survivable (weather, night).

## MVP vertical slice (first playable) — proposed

Smallest thing that *feels* like the game:

- Tile-grid world, player movement.
- One or two resource nodes you can harvest → items land in an inventory.
- Place one building from gathered resources.
- One survival meter ticking with time (+ a simple day/night tint).

Everything else (weather, complex crafting trees, enemies, saves) layers on after the slice is fun.

## Persistence

Single-player, client-side saves — `localStorage` for the MVP, IndexedDB if the save grows.

## Not doing (for now)

Multiplayer, backend, accounts, monetisation. Keep it a self-contained static site.
