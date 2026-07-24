#!/usr/bin/env python3
"""Prompt manifest for the item-icon generator (see generate.py + README.md).

Consistency across the whole icon set comes from ONE shared style preamble that is
prepended verbatim to every item — so all icons share silhouette weight, palette,
framing and background treatment. Per-item prompts are a single subject line each.

Adding a new item icon = add one line to SUBJECTS (keyed by the item id from
src/data/items.ts, which is also the output filename `<id>.png`). Do NOT fork the
preamble per item — tweak the subject line; only change the preamble when the whole
set needs to shift.
"""

# The item's `color` in items.ts is only the fallback rect; these prompts are the
# reproducible source of the real icon art. Change wording here, re-run generate.py.

STYLE_PREAMBLE = (
    "Pixel-art game item icon for a dark, grotty survival-horror game that is still "
    "a little funny and cartoonish. Draw ONE single item, centred, filling most of "
    "the frame, seen from a slight top-down three-quarter angle as a clean inventory "
    "icon. Chunky, bold, instantly readable silhouette that still reads when shrunk "
    "to 32x32 pixels. Limited, muted, slightly grimy colour palette, strong dark "
    "outline, simple flat shading — no fine detail, no gradients, no photorealism. "
    "Absolutely no text, no letters, no numbers, no border, no frame, no drop shadow, "
    "no ground or floor. The background is a single flat, uniform, solid chroma-key "
    "colour (pure magenta, hex #FF00FF) with no gradient, texture or shadow, so it "
    "can be keyed out to full transparency."
)

# item id -> subject line. Keys must match ITEMS[*].id in src/data/items.ts.
SUBJECTS = {
    "wood": (
        "a small bundle of chopped wooden logs / firewood tied together, rough dark "
        "bark, freshly cut pale timber ends"
    ),
    "stone": (
        "a chunk of rough grey rock / stone with a couple of smaller chipped pebbles, "
        "craggy and cracked"
    ),
    "berries": (
        "a small cluster of dark forest berries on a short sprig with one or two green "
        "leaves, plump and juicy, faintly ominous"
    ),
    "cloth": (
        "a folded stack of rough torn fabric / rags, frayed ragged edges and a loose "
        "hanging thread, muted grimy off-white, beige and grey tones"
    ),
    "cannedFood": (
        "a single stubby tin can of food, metal lid, a worn part-peeling paper label with "
        "no readable text, faint dents and specks of rust"
    ),
}


def compose(item_id: str) -> str:
    """Full prompt for `item_id` = shared preamble + that item's subject line."""
    if item_id not in SUBJECTS:
        raise KeyError(
            f"no prompt for item {item_id!r}; known ids: {', '.join(sorted(SUBJECTS))}"
        )
    return f"{STYLE_PREAMBLE}\n\nThe item to draw: {SUBJECTS[item_id]}."
