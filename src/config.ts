/**
 * Global game constants. Keep tunables here so they're easy to find and change from any device.
 */

import type { AttackShape, Hurtbox } from './data/types';

/**
 * Base render resolution. Mobile-first: a portrait canvas (9:16-ish) that Phaser's Scale.FIT
 * scales up to fill any screen (letterboxing on wider desktop displays). Design at this size.
 */
export const BASE_WIDTH = 360;
export const BASE_HEIGHT = 640;

/**
 * Device-pixel render scale — an integer supersample factor for the canvas backing store.
 *
 * The game is authored in the fixed BASE_WIDTH×BASE_HEIGHT design space above. On a high-DPI screen
 * the browser stretches that small backing store up to the physical display by a *fractional* factor,
 * and a NEAREST-sampled fractional upscale drops/doubles whole pixel rows — thin crawling seams along
 * tile edges (worst on mobile GPUs; this is what put the black lines on the doubled map). Rendering
 * the backing store at ~device density makes that final upscale ~1:1, so the seams vanish and
 * everything is sharper. Kept an integer so sprite pixels stay uniform (same reason zoom is integer —
 * see ZOOM_STEP). World and HUD stay authored in design units; each scene's camera zoom absorbs this
 * factor (see GameScene.setZoom and UIScene.create). Override for tuning/tests with `?ss=N`.
 */
export const RENDER_SCALE: number = (() => {
  if (typeof window === 'undefined') return 1; // unit tests run in plain Node — no DOM, no scaling
  try {
    const forced = Number(new URLSearchParams(window.location.search).get('ss'));
    if (Number.isFinite(forced) && forced >= 1 && forced <= 4) return Math.round(forced);
  } catch {
    // location unavailable — fall through to the DPR-derived default
  }
  return Math.min(3, Math.max(1, Math.ceil(window.devicePixelRatio || 1)));
})();

/** Pixel size of a world tile at base resolution. */
export const TILE_SIZE = 16;

/**
 * Ground is baked into RenderTextures stacked vertically, this many tile-rows tall each (see
 * groundRenderer.drawMapLayers). One map-tall texture (80 rows = 1280px after the map doubled) developed
 * faint, evenly-spaced dark horizontal lines that worsened toward the bottom — only on real mobile
 * GPUs, never on desktop/headless. Cause: NEAREST sampling of a tall texture at reduced fragment
 * precision (`mediump` where the GPU lacks `GL_FRAGMENT_PRECISION_HIGH`) rounds the texel coordinate
 * to the wrong row, and the absolute error grows with the texture's V extent — so the taller the
 * texture, the lower down (and more often) a row gets mis-sampled. Capping each chunk's height keeps
 * that error below half a texel (a 40-row/640px map showed no lines pre-doubling), so no row flips.
 * Chunks are tile-aligned and drawn 1:1, so their shared edges are just adjacent grass — no seam.
 */
export const GROUND_CHUNK_ROWS = 32;

/** Total inventory slots — the `Inventory` capacity (GameScene) + the DOM pack grid size. */
export const INVENTORY_SLOTS = 20;
/** Slots on the Field Kit HUD quick-swap hotbar (plan 046 — the DOM/React overlay's build/tool row).
 *  (The legacy Phaser `HOTBAR_SLOTS = 5` was removed at Step 13 with its only consumer, InventoryWidget.) */
export const HUD_HOTBAR_SLOTS = 6;
/** Fallback per-slot stack size for any item whose def omits `maxStack`. */
export const DEFAULT_MAX_STACK = 50;

/** How close (px) the player must be to a node to interact (chop). */
export const INTERACT_RANGE = TILE_SIZE * 1.4;

/** Milliseconds between chop hits while felling a node. */
export const CHOP_INTERVAL_MS = 400;

/**
 * Frame rate for the player's action swings (chop/attack). The strips are 8 frames, so this ≈ one
 * swing per CHOP_INTERVAL_MS (8 / 20 fps = 400 ms) — a chop reads as a continuous swing per hit,
 * and an attack is a single snappy swing. Locomotion (idle/walk) stays at the slower default (10).
 */
export const ACTION_ANIM_FRAMERATE = 20;

/**
 * Harvest node felling sequence (see NodeFxManager). A resource node sells getting chopped down in
 * three layers, each keyed off the node's remaining HP:
 *
 * 1. Per-hit recoil — a quick directional kickback away from the swing, sold with a squash pop.
 *    `CHOP_RECOIL_PX` is the kickback distance (world px), `CHOP_RECOIL_MS` its out-and-back
 *    duration, `CHOP_RECOIL_SQUASH` the squash fraction of scale at peak.
 * 2. Escalating tremble — a small shake that grows as HP drops toward 0, foreshadowing the fell.
 *    `CHOP_TREMBLE_PX`/`CHOP_TREMBLE_DEG` are the max shake amplitude (position/rotation) at ~0 HP;
 *    amplitude scales down toward 0 at full HP.
 * 3. Per-kind depletion payoff, once HP hits 0: a tree topples (`TREE_FELL_MS` to rotate — from its
 *    placement rotation, via the shortest path — down to the horizontal rest angle `TREE_FELL_REST_DEG`,
 *    then fades out over `TREE_FELL_FADE_MS`), a rock crumbles
 *    (`ROCK_CRUMBLE_MS`), a bush rustles and vanishes (`BUSH_RUSTLE_MS`).
 *
 * Every per-hit duration above is kept under `CHOP_INTERVAL_MS` (400ms) so consecutive hits can't
 * overlap their own recoil/tremble tween.
 */
export const CHOP_RECOIL_PX = 3;
export const CHOP_RECOIL_MS = 120;
export const CHOP_RECOIL_SQUASH = 0.06;
export const CHOP_TREMBLE_PX = 1.5;
export const CHOP_TREMBLE_DEG = 2;
export const TREE_FELL_MS = 600;
export const TREE_FELL_REST_DEG = 82;
export const TREE_FELL_FADE_MS = 200;
export const ROCK_CRUMBLE_MS = 320;
export const BUSH_RUSTLE_MS = 220;

/** Hold time (ms) that turns a tap into a queued order rather than an act-now order. */
export const LONGPRESS_MS = 350;

/** On-site work time (ms) for a worker to finish one wall from its blueprint. */
export const BUILD_MS = 2500;

/**
 * Deconstruct refund (plan 037 chunk 2b, decision #6). Unbuilding a finished wall via a worker
 * deconstruct order credits back this fraction of its buildable `cost`, floored per resource (the
 * wall's `{ wood: 2 }` → 1 wood back). A partial refund so demolish-and-rebuild churn isn't free, but
 * a misplacement isn't fully punished either. Tuning knob — playtest-tune.
 */
export const DECONSTRUCT_REFUND_FRACTION = 0.5;

/** Pointer travel (px, base res) above which a press is treated as a drag, not an order. */
export const DRAG_PX = 12;

/** Camera zoom bounds + default. The map (MAP_*) is larger than the viewport, so the camera scrolls
 * and follows the player at every level (higher = more zoomed in); tune to taste. */
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 2;
/**
 * Zoom change per UI button press. Kept at whole integers so every zoom stop (100/200/300%) is an
 * integer camera scale: pixel-art sprites nearest-sample cleanly only at integer zoom — a fractional
 * zoom (e.g. 150%) gives some source texels 1px and others 2px, reading as "stretched"/clipping.
 * setZoom() rounds every path (buttons, pinch, restored preference) to enforce this.
 */
export const ZOOM_STEP = 1;
/** localStorage key the current zoom is persisted under (best-effort — see GameScene.setZoom). */
export const ZOOM_STORAGE_KEY = 'mostowo:zoom';

/** Radius (world px) of the character's line of sight — everything beyond it is fogged. */
export const VISION_RADIUS = TILE_SIZE * 5;

/**
 * Radius (world px) of the tiny personal light the player always emits (plan 039 Step 3). Fed into the
 * night light-layer's RENDER light sources (SurvivalClock's erase list) so full-dark night still leaves
 * a small readable disc around the player — never fully blind. Deliberately SMALL (~1.25 tiles) so
 * fires/torches clearly matter and enemy tells stay unreadable beyond its reach (decision #4). Distinct
 * from `VISION_RADIUS` (the day fog-of-war reach, 5 tiles) and from the base CLAIM (fires only, decision
 * #7): the player's light reveals but never grants `baseOnly` placement. A future off-hand torch just
 * raises this radius.
 */
export const PLAYER_LIGHT_RADIUS = TILE_SIZE * 1.25;

/** Starting player combat stats (see plan 003 Context & decisions' cast table). */
export const PLAYER_MAX_HP = 10;
export const PLAYER_START_SPEED = 90;
export const PLAYER_START_VISION = VISION_RADIUS;

/**
 * Player body extent for combat targeting (see `Hurtbox` in data/types). The character sprite is
 * ~1 tile wide and ~2 tall, so its torso occupies the tile above its feet — an enemy touching that
 * tile still connects. Footprint/occupancy stays the single feet tile.
 */
export const PLAYER_HURTBOX: Hurtbox = { width: 1, height: 2 };

/** Base damage of an unarmed hit — shared by an unarmed attack and an enemy's bite via resolveMeleeAttack. */
export const UNARMED_BASE_DAMAGE = 1;

/** Melee footprint of an unarmed swing (plan 036): today's single front tile — a `reach:1` thrust
 *  with no spread. The default `PlayerCharacter.meleeShape()` returns when no weapon is equipped, so
 *  bare-handed combat is unchanged (no regression) until a weapon overrides the shape. */
export const UNARMED_MELEE_SHAPE: AttackShape = { reach: 1, arc: 'single' };

/**
 * Attack commitment: while a swing is in progress (the attack-lock window, see GameScene.playAttackSwing)
 * the player's move speed drops to this fraction of normal, so attacking has weight — you plant and
 * commit rather than gliding through the swing at full pace. Applied to both movepad and pathfinder
 * movement via GameScene.effectiveMoveSpeed.
 */
export const ATTACK_MOVE_SLOW = 0.2;

/**
 * NPC companion (the Rogue, plan 042) — a named constants block mirroring the player block above,
 * NOT a data catalogue (the companion is one hand-built actor, like the player). `NpcCharacter`
 * assembles its `CombatantStats` from these; the day/night role + posture behaviour that reads the
 * timings lands in later steps.
 *
 * ALL NUMBERS ARE PLACEHOLDER TUNING (un-playtested), flagged per plan 040's convention — expect to
 * retune once the companion's gather/repair/guard loop is actually playable:
 *  - HP a notch below the player (a helper you must protect, not a second tank);
 *  - SPEED a touch under the player so it trails rather than races ahead;
 *  - VISION shorter than the player's day fog reach (it reacts to what's near, not the whole screen);
 *  - CARRY_CAP deliberately LOW (it ferries a little, it isn't a warehouse);
 *  - WINDUP/REPAIR in the low hundreds of ms; REVIVE_HP the HP it stands back up with at dawn.
 */
export const NPC_MAX_HP = 8;
export const NPC_SPEED = 80;
export const NPC_VISION = TILE_SIZE * 4;
export const NPC_STRENGTH = 1;
export const NPC_CARRY_CAP = 5;
export const NPC_ATTACK_WINDUP_MS = 300;
/**
 * Companion night-combat cadence (plan 042 Step 7). Between directed strikes the companion waits
 * `NPC_ATTACK_COOLDOWN_MS`; the strike itself is telegraphed by `NPC_ATTACK_WINDUP_MS` of wind-up
 * first (the acquire→chase→telegraphed-contact shape reused from the monster, not its FSM). While
 * chasing the nearest live enemy it refreshes its path to a stand-adjacent tile at most every
 * `NPC_COMBAT_REPATH_MS` (the gather/repair loop's stuck-guard still applies). PLACEHOLDER tuning
 * (un-playtested), flagged per plan 040's convention — retune vs wave DPS once the loop is playable.
 */
export const NPC_ATTACK_COOLDOWN_MS = 700;
/**
 * Playback rate of the companion's one-shot attack strip (plan 043). Deliberately SLOWER than a
 * generic `ACTION_ANIM_FRAMERATE` (20fps) swing: at 6 frames this is ~600ms, so the dagger slash
 * reads as a deliberate telegraph and fits inside the strike cadence (windup + cooldown ≈ 1s) rather
 * than blowing through in 300ms. Keep the GIF-preview fps in `process_gemini.py` in sync with this.
 */
export const NPC_ATTACK_ANIM_FRAMERATE = 10;
export const NPC_COMBAT_REPATH_MS = 300;
export const NPC_REPAIR_MS = 400;
/**
 * Per-repair-tick economy for the `repair` day role (plan 042 Step 5). On each `NPC_REPAIR_MS` cadence
 * the companion withdraws `NPC_REPAIR_WOOD_PER_TICK` wood from the shared base supply and restores
 * `NPC_REPAIR_HP_PER_TICK` hp to the wall it's mending; an empty supply stops the repair (goes idle).
 * This ties the two day roles together economically — gather fills the pool, repair drains it. A wall
 * (maxHp 12) fully mends from rubble in ~6 ticks / 6 wood at these values. PLACEHOLDER tuning
 * (un-playtested), flagged per plan 040's convention — retune vs wave DPS + wall maxHp once playable.
 */
export const NPC_REPAIR_WOOD_PER_TICK = 1;
export const NPC_REPAIR_HP_PER_TICK = 2;
export const NPC_REVIVE_HP = 3;
/**
 * Companion `follow` night posture (plan 042 Step 8). While following the player the companion holds
 * station within this Chebyshev radius (tiles) and only (re)paths once the player steps beyond it — so
 * a still player never makes it path-thrash. The `guard` posture leashes to its `guardPoint` and
 * engages within the shared `NPC_VISION`; the `refuel` posture feeds the lit hearth one base-supply
 * wood per `CAMPFIRE_FEED_INTERVAL_MS` (adding `CAMPFIRE_FUEL_PER_WOOD` fuel — the same wood→fuel
 * exchange the player's refuel order uses), holding at the last-known hearth tile when no fire is lit.
 * PLACEHOLDER tuning (un-playtested), flagged per plan 040's convention.
 */
export const NPC_FOLLOW_RADIUS_TILES = 3;
/**
 * NPC body extent for combat targeting (see `Hurtbox`) — same ~1-wide, 2-tall silhouette as the
 * player (the Rogue is a humanoid of the same rough size). Occupancy stays the single feet tile.
 */
export const NPC_HURTBOX: Hurtbox = { width: 1, height: 2 };
/**
 * The melee weapon id the companion carries (plan 042) — keys BOTH its gameplay stats
 * (`MELEE_WEAPONS[NPC_MELEE_WEAPON_ID]` in data/weapons.ts) AND its held-blade art
 * (`ACTIVE_TILESET.actors.npc.weapons[...]`), exactly as a skeleton's weapon id joins the two
 * catalogues. `cleaver` = a short reach:1 swing that suits a close-in rogue. Placeholder — the
 * directed swing that consumes it is plan 042 Step 7.
 */
export const NPC_MELEE_WEAPON_ID = 'cleaver';

/**
 * Bow-fire commitment (plan 035a Steps 2/5). Loosing an arrow locks the player into a brief
 * draw/release for `BOW_DRAW_MS`, during which move speed drops only to `BOW_MOVE_SLOW` of normal —
 * far lighter than the melee `ATTACK_MOVE_SLOW`, so you can keep kiting while you shoot. The
 * melee-vs-bow move-slow gap is where "ranged is safer" lives (melee roots you; the bow lets you
 * back-pedal). The arrow/auto-target/anim land in Step 5; Step 2 wires the lock + move-slow so the
 * Bow button already has weight via `PlayerCharacter.effectiveMoveSpeed`/`bowLockUntil`. Starting
 * values — playtest-tune.
 */
export const BOW_MOVE_SLOW = 0.75;
export const BOW_DRAW_MS = 450;

/**
 * Attack cadence gate (playtest fix). A melee swing / bow loose can only re-fire once this cooldown
 * has elapsed since the last one — a press inside the window is ignored, so mashing the button can't
 * machine-gun hits or restart the swing mid-animation. Distinct from the move-slow *commit* windows
 * above (which govern movement during an action); this governs when the NEXT action is allowed. Kept
 * roughly in step with each action's animation (melee swing ≈ 400ms, bow draw = BOW_DRAW_MS) so "you
 * finish the action before you can start another" reads honestly. Playtest-tune.
 */
export const ATTACK_COOLDOWN_MS = 400;
export const BOW_COOLDOWN_MS = 450;

/**
 * The bow itself (plan 035a Step 5). Loosing an arrow auto-targets the nearest live enemy within
 * `BOW_RANGE_TILES` (Euclidean tiles), biased toward the player's current facing, and deals
 * `BOW_BASE_DAMAGE` through the shared ranged formula (base + the attacker's `dex`; the player's dex
 * is 0 today). Range/damage are the ranged↔melee trade: the bow reaches farther and lets you kite
 * (light `BOW_MOVE_SLOW`), so it hits a touch harder per shot than an unarmed melee (1) to reward the
 * commitment. Unlimited ammo for now. Starting values — playtest-tune.
 *
 * The shot is sold with a coded arrow tracer: a thin `BOW_ARROW_LEN_PX`-long dash that flies
 * player→target over `BOW_ARROW_MS` (no projectile physics — a pure visual, like the enemy lunge/
 * weapon-swing are coded FX). The pack ships no bow spritesheet, so the release *body* pose reuses the
 * existing Pierce (attack) strip as a coded stand-in during the draw window (see
 * PlayerCharacter.updateAnim) — a dedicated bow rig/art is a later polish pass.
 */
export const BOW_RANGE_TILES = 6;
export const BOW_BASE_DAMAGE = 2;
export const BOW_ARROW_MS = 140;
export const BOW_ARROW_LEN_PX = 10;

/**
 * Monster HP bars (plan 035a Step 6) — a thin floating bar above an enemy's hurtbox, deliberately
 * attention-scoped so a swarm doesn't drown the screen in bars:
 *  - the **bow's current target** (Step 5) shows its bar **persistently** (you're aiming at it);
 *  - any other enemy shows a **brief** bar for `HP_BAR_SHOW_MS` after it's hit, then it fades out;
 *  - at most `HP_BAR_MAX_VISIBLE` bars render at once — the target first, then the nearest others.
 * `HP_BAR_WIDTH_PX`/`HP_BAR_HEIGHT_PX` size it; `HP_BAR_GAP_PX` lifts it above the hurtbox top.
 * Below `HP_BAR_NEAR_DEATH_FRAC` HP an enemy also gets a **sprite tell** — a slow alpha throb
 * (`HP_BAR_NEAR_DEATH_ALPHA_MIN`..1 over `HP_BAR_NEAR_DEATH_PERIOD_MS`) — so "almost dead" reads even
 * when it has no bar (alpha is free on enemies: VisionController hides only the player, and the flash/
 * wind-up/flinch FX use pipeline/tint/scale, never alpha). Starting values — playtest-tune.
 */
export const HP_BAR_SHOW_MS = 2500;
export const HP_BAR_MAX_VISIBLE = 5;
export const HP_BAR_WIDTH_PX = 16;
export const HP_BAR_HEIGHT_PX = 2;
export const HP_BAR_GAP_PX = 3;
export const HP_BAR_NEAR_DEATH_FRAC = 0.34;
export const HP_BAR_NEAR_DEATH_ALPHA_MIN = 0.5;
export const HP_BAR_NEAR_DEATH_PERIOD_MS = 480;

/** Minimum time (ms) between an enemy's contact-damage attempts on the player. */
export const CONTACT_DAMAGE_COOLDOWN_MS = 1000;

/**
 * Telegraphed enemy attack (plan 035a Step 1). Before a bite lands, the enemy freezes in a readable
 * **wind-up** for `ENEMY_ATTACK_WINDUP_MS`, tinting toward `ENEMY_WINDUP_TINT` as it "loads" — the
 * player's cue to disengage. The wind-up is carved out of the *end* of the existing bite cadence
 * (weapon `attackMs` / `CONTACT_DAMAGE_COOLDOWN_MS`), so it telegraphs the strike without changing an
 * enemy's overall DPS: the strike still lands on the cadence, just now with a warning. Leaving contact
 * during the wind-up cancels the strike (a whiff), so reacting to the tell actually saves you.
 * Starting value ~350ms — playtest-tune.
 */
export const ENEMY_ATTACK_WINDUP_MS = 350;
export const ENEMY_WINDUP_TINT = 0xffcc33;

/**
 * The boar's wind-up (plan 035b Step 3). A `dir4` mob with a real Attack sheet plays that animation AS
 * the tell (richer than the skeleton's coded tint ramp), so its wind-up is sized to the anim: the boar
 * Attack strip is 5 frames at `ACTION_ANIM_FRAMERATE` (20fps) ≈ 250ms, so the strike lands as the lunge
 * completes. Punchier (quicker) than the skeleton's 350ms — the boar is a fast, committed charger.
 * Playtest-tune. Carved from the tail of the bite cadence (`CONTACT_DAMAGE_COOLDOWN_MS`) like 035a.
 */
export const BOAR_ATTACK_WINDUP_MS = 250;

/**
 * Auto-surfacing combat controls (plan 035a Step 3). The fighting HUD (left-thumb movepad + the
 * right-thumb Melee/Bow cluster) reveals itself — and the movepad becomes authoritative — whenever
 * combat is *active*: a live enemy within this Chebyshev tile radius of the player, OR the night
 * phase. No manual Combat-mode toggle needed (though it stays as an override). Deliberately NOT tied
 * to `setMode('combat')`, which would cancel the worker task queue. Starting radius — playtest-tune.
 */
export const COMBAT_ACTIVE_RADIUS_TILES = 7;

/**
 * Hysteresis band for the auto-surface predicate above (playtest fix). The controls ENGAGE when an
 * enemy is within `COMBAT_ACTIVE_RADIUS_TILES`, but only RETRACT once every enemy is beyond
 * `COMBAT_ACTIVE_RADIUS_TILES + this`. Without the wider release band a boar hovering at the exact
 * trigger range flicked the fighting HUD on/off every frame it crossed the line. Playtest-tune.
 */
export const COMBAT_ACTIVE_HYSTERESIS_TILES = 3;

/**
 * Hit feedback (see render/hitFlashPipeline.ts + GameScene.flashHit). When an actor takes damage it
 * flashes red and does a quick squash "flinch". `HIT_FLASH_MS` is how long the reaction lasts;
 * `HIT_FLASH_PEAK` is the max red mix (0..1) at impact — near 1 so the hit is unmistakable, a shade
 * under so a sliver of the sprite's own colour survives. `HIT_FLASH_SQUASH` is how hard the flinch
 * squashes (fraction of scale: wider by this, shorter by ~0.8× this, at impact). `HIT_FLASH_TINT` is
 * the Canvas-fallback fill colour (no shader).
 *
 * On top of the per-sprite flash, a **camera kick** sells the impact: getting bitten gives a firm
 * shake (`PLAYER_HIT_SHAKE_*`) plus a red **damage vignette** pulse round the screen edges
 * (`DAMAGE_VIGNETTE_*`, drawn by UIScene on a `player:hit` event); landing an attack gives a lighter
 * shake (`ENEMY_HIT_SHAKE_*`). Shake intensity is a fraction of the viewport, durations are ms.
 *
 * The enemies ship no attack strip, so an enemy's attack is a coded lunge toward its target:
 * `ENEMY_LUNGE_PX` is the reach (world px) and `ENEMY_LUNGE_MS` the time for each leg of the
 * out-and-back — kept well under the contact cooldown so a lunge always settles before the next bite.
 */
export const HIT_FLASH_MS = 260;
export const HIT_FLASH_PEAK = 0.9;
export const HIT_FLASH_SQUASH = 0.28;
export const HIT_FLASH_TINT = 0xff2a2a;
export const PLAYER_HIT_SHAKE_MS = 100;
export const PLAYER_HIT_SHAKE_INTENSITY = 0.005;
export const ENEMY_HIT_SHAKE_MS = 55;
export const ENEMY_HIT_SHAKE_INTENSITY = 0.003;
export const DAMAGE_VIGNETTE_MS = 460;
export const DAMAGE_VIGNETTE_ALPHA = 0.72;
export const DAMAGE_VIGNETTE_COLOR = 0xe01818;
export const ENEMY_LUNGE_PX = 7;
export const ENEMY_LUNGE_MS = 120;

/**
 * Monster weapon swing feel (Phase B — see GameScene.enemyLungeAt / systems/attachment.ts). The
 * enemy pack ships no mob attack strip, so the bite's weapon "swing" is coded: rotate the held
 * weapon about its grip through `WEAPON_SWING_ARC_DEG`, with a brief `WEAPON_SWING_SCALE_POP` pop,
 * over `WEAPON_SWING_MS` (yoyo). Swing *feel* only — weapon damage/cadence live in data/weapons.ts.
 */
export const WEAPON_SWING_ARC_DEG = 75;
export const WEAPON_SWING_SCALE_POP = 1.12;
export const WEAPON_SWING_MS = 140;

/**
 * Monster AI tuning (see systems/monsterAI.ts). The FSM is idle → wander|patrol → chase.
 * Aggro is radius-only, using the enemy's own `EnemyDef.vision` as the acquire radius (no separate
 * const). De-aggro is distance-only: as the player nears the outer edge of chase range the monster
 * keeps chasing but veers off (path noise ramping with distance) as if losing the scent, then gives
 * up past the hard drop radius.
 *
 * `MONSTER_CHASE_DROP_RADIUS_PX` — hard de-aggro distance; past it the monster returns to a calm state.
 * `MONSTER_VEER_BAND_PX` — width of the outer band (just inside the drop radius) where chase degrades.
 * `MONSTER_VEER_MAX_TILES` — max tiles the chase target is perturbed by at the band's outer edge.
 * `MONSTER_REPATH_MS` — min time between A* repaths while chasing (replaces the old inline `300`).
 * `MONSTER_IDLE_MS_MIN`/`MAX` — random pause length in the `idle` state before the next roam.
 * `MONSTER_WANDER_RADIUS_TILES` — how far a wander picks its next random reachable tile.
 * `MONSTER_PATROL_PAUSE_MS` — pause at each patrol waypoint before advancing to the next.
 */
export const MONSTER_CHASE_DROP_RADIUS_PX = 200;
export const MONSTER_VEER_BAND_PX = 60;
export const MONSTER_VEER_MAX_TILES = 3;
export const MONSTER_REPATH_MS = 300;
export const MONSTER_IDLE_MS_MIN = 700;
export const MONSTER_IDLE_MS_MAX = 2000;
export const MONSTER_WANDER_RADIUS_TILES = 4;
export const MONSTER_PATROL_PAUSE_MS = 1000;

/**
 * Death animation timing (see GameScene.killPlayer / killEnemy). Both actors play a one-shot
 * collapse strip on death: `DEATH_ANIM_FRAMERATE` is slower than an action swing so the collapse
 * reads as a fall, not a twitch (player 8f ≈ 0.67s, enemy 12f ≈ 1.0s). `DEATH_HOLD_MS` is the
 * beat the downed last frame is held before the payoff — the player's scene restart, the enemy's
 * corpse removal.
 */
export const DEATH_ANIM_FRAMERATE = 12;
export const DEATH_HOLD_MS = 300;

/**
 * Day/night cycle timing (see systems/daynight.ts). A full cycle is DAY_MS + NIGHT_MS of real time,
 * looping continuously. TWILIGHT_MS is the length of the dusk/dawn cross-fade at each boundary —
 * kept short relative to DAY_MS/NIGHT_MS so full day and full night both read as distinct plateaus.
 */
export const DAY_MS = 660_000; // 11 min — long, breathing day (leave → scavenge → return → prep)
export const NIGHT_MS = 240_000; // 4 min — shorter, denser night
export const TWILIGHT_MS = 8_000;
/**
 * Darkest the night tint gets (alpha of the COLORS.night light layer). Full opacity (1.0): away from
 * any light the world is BLACK and darkness *conceals* — approaching enemies and their telegraphed
 * attack tells are invisible until a fire's soft light reveals them (plan 039 Step 2, decision #1).
 * The light layer (render/lightTexture.ts + SurvivalClock) erases a soft radial hole around each lit
 * fire, so "fully dark" is playable: you see the firelit ground, not a black screen. `tintAlphaAt`
 * still cross-fades to this plateau at dusk/dawn.
 */
export const NIGHT_MAX_ALPHA = 1.0;

/**
 * Hunger (see systems/needs.ts). HUNGER_DRAIN_PER_SEC empties a full HUNGER_MAX in ~667s (100 / 0.15)
 * ≈ one day (DAY_MS 660s), the "one food run per day" pace: a day of neglect leaves you starving right
 * as night falls, so eating has to become habitual. Feel-tunable — soften toward ~0.13/s (~770s) if a
 * neglected-day-into-wave proves an unrecoverable spiral rather than clawback-able (see plan 041). The
 * remaining Step-4 work beyond this drain is flipping `HUNGER_LETHAL` (below). While starving
 * (hunger <= 0), the player takes STARVE_DAMAGE every STARVE_DAMAGE_INTERVAL_MS (1 HP / 2s).
 *
 * `HUNGER_LOW_FRACTION` is the "near-empty" cutoff (fraction of HUNGER_MAX): below it the HUD hunger
 * bars turn red AND a steady yellow edge vignette fades in (UIScene, same baked-texture approach as
 * the red damage vignette). Unlike the damage flash it doesn't pulse — its alpha ramps smoothly from
 * 0 at the cutoff up to HUNGER_VIGNETTE_MAX_ALPHA as hunger reaches 0, a persistent "you're starving"
 * cue round the screen edges.
 */
export const HUNGER_MAX = 100;
export const HUNGER_DRAIN_PER_SEC = 0.15;
export const STARVE_DAMAGE = 1;
export const STARVE_DAMAGE_INTERVAL_MS = 2_000;
export const HUNGER_LOW_FRACTION = 0.2;
export const HUNGER_VIGNETTE_COLOR = 0xe0b020;
export const HUNGER_VIGNETTE_MAX_ALPHA = 0.5;

/**
 * Dev toggle — starvation reduces HP (via SurvivalClock) only when true. Default on for the MVP
 * survival loop (plan 041); set `false` to disable starvation death during playtesting.
 */
export const HUNGER_LETHAL = true;

/** Map ID to load at game start (must match a key in maps/manifest.json). */
export const START_MAP_ID = 'the-moon';

/** Player spawn location within the start map, in tile coordinates (col, row). Must sit inside the
 *  map's authored area — the-moon's camp is around col 112–118 / row 132–151, so spawn on the
 *  walkable ground by the main bonfire. (The old {21,33} was empty void ~100 tiles away, so the
 *  world rendered all-black around the player — the map was fine, the spawn just missed it.) */
export const SPAWN_TILE = { col: 118, row: 140 };

/**
 * Base zone size in tiles (width, height). The runtime base zone is a rect of this size centred on
 * the spawn tile — see `baseZoneFromSpawn` (plan 018 A8, which replaced the old fixed-bounds BASE_ZONE).
 */
export const BASE_ZONE_SIZE = { w: 21, h: 27 };

/**
 * Campfire fuel (see plan 014 Context & decisions; retuned for the 15-min cycle in plan 038 Step 2).
 * The fire is always burning once built, draining fuel continuously at `CAMPFIRE_FUEL_BURN_PER_SEC` —
 * a full tank (`CAMPFIRE_FUEL_MAX`) now lasts **~300s** (120 / 0.4). Sized so a full fire **just
 * outlasts a whole night** (NIGHT_MS 240s) on natural burn alone, leaving ~20% headroom — which the
 * night wave's fire attacks (`CampfireBehavior.damageFire`, plan 038) eat into, so keeping it lit
 * through a defended night takes a refuel or two but isn't constant babysitting. Over a full 900s
 * cycle that's ~3 tanks (~3 refuels) instead of the old 120s tank's ~7 — the "too punishing" tuning
 * the pre-038 comment flagged. **Exact feel-tuning (fuel vs wave DPS vs night length) is plan 038 Step
 * 5**, once the live wave exists; these are the baseline. The fire is NOT a loss condition (plan 038
 * decisions #1/#2) — a fire that burns out just goes dark; relight it by feeding wood.
 * Refuelled by feeding wood: each unit adds `CAMPFIRE_FUEL_PER_WOOD` fuel (4 wood refuels an empty
 * fire). Starts full on completion.
 */
export const CAMPFIRE_FUEL_MAX = 120;
export const CAMPFIRE_FUEL_BURN_PER_SEC = 0.4;
export const CAMPFIRE_FUEL_PER_WOOD = 30;

/**
 * Refuel-as-worker-order tuning (plan 016). Tapping a fire queues a `refuel` order: the worker walks
 * adjacent and feeds one wood per `CAMPFIRE_FEED_INTERVAL_MS` (an empty fire tops up in ~4s / 4 wood),
 * stopping when a full wood no longer fits or the bag runs dry. `CAMPFIRE_LIGHT_MIN_FRAC` is what the
 * light radius shrinks to at near-empty, as a fraction of full — it lerps `MIN_FRAC..1` with fuel, so a
 * well-fed fire casts a bigger hole and a dying one dims (full light = the buildable's `light` tiles).
 */
export const CAMPFIRE_FEED_INTERVAL_MS = 1000;
export const CAMPFIRE_LIGHT_MIN_FRAC = 0.4;

/**
 * Base-claim bright core (plan 039). The fire-heart's light now *is* the base zone: a `baseOnly`
 * buildable places only inside a lit hearth's **bright core** — `lightSources()` radius ×
 * `CLAIM_LIGHT_FRAC` — NOT the full geometric radius, whose soft gradient rim (plan 039 Step 2) has
 * faded to near-invisible; claiming there would let you build in a fringe you can't see. Kept inside
 * the clearly-lit core so the placeable area reads as "the firelit ground". Fires only (never the
 * player's personal light) — see plan 039 decisions #1/#7.
 */
export const CLAIM_LIGHT_FRAC = 0.7;

/**
 * Flame/smoke rendering (plan 016 follow-up). The flame is a TWO-sheet swap keyed on fuel fraction: at
 * or above `CAMPFIRE_FLAME_LARGE_MIN_FRAC` the larger `Fire_01` sheet burns, scaled a touch by fuel
 * (`CAMPFIRE_FLAME_LARGE_SCALE_MIN`..1 across the top band) so a well-fed fire is visibly bigger; below
 * the threshold the smaller `Fire_02` sheet takes over at native size — so a fire running low steps
 * down. The flame is lifted `CAMPFIRE_FLAME_RISE_PX` above the stone base (reads as rising out of the
 * ring, not sitting in it); a smoke plume always drifts `CAMPFIRE_SMOKE_RISE_PX` above the base centre.
 */
export const CAMPFIRE_FLAME_LARGE_MIN_FRAC = 0.5;
export const CAMPFIRE_FLAME_LARGE_SCALE_MIN = 0.85;
export const CAMPFIRE_FLAME_RISE_PX = 2;
export const CAMPFIRE_SMOKE_RISE_PX = 22;

/**
 * Trap tuning (placeholder — tune vs wave DPS). The spike trap (plan 040) is an ARMED floor tile that
 * triggers ONCE when an enemy stands on it, deals flat `SPIKE_TRAP_DAMAGE` through the normal kill
 * path, then goes spent until re-armed (a dawn worker order + a tap).
 *  - `SPIKE_TRAP_DAMAGE` 2: meaningfully hurts a skeleton (`kidZombie` maxHp 3 → 1, survives) but
 *    doesn't one-shot a boar (maxHp 5 → 3) — decision #2. The #1 knob once felt vs the live wave.
 *  - `SPIKE_TRAP_TRIGGER_MS` 120: the extend/strike anim beat (armed frame → peak) on trigger.
 * The build COST is content, not a tunable, so it lives inline on the `spike_trap` BUILDABLES entry
 * beside `wall`/`campfire` (plan 043 Step 16 — data-driven cost consolidation), not here. Re-arm
 * consumes worker-time only for MVP (no resource — decision #6); a material cost is a later tuning
 * decision.
 */
export const SPIKE_TRAP_DAMAGE = 2;
export const SPIKE_TRAP_TRIGGER_MS = 120;

/**
 * Night wave (plan 038 Step 3 — `scenes/world/WaveDirector.ts`). At night, skeletons spawn from the
 * "treeline": a fixed direction (`WAVE_SPAWN_DIR`, north) off the **defended centre** (the nearest lit
 * hearth, else the player) at ~`WAVE_SPAWN_RADIUS` tiles, spread laterally up to `WAVE_SPAWN_SPREAD`,
 * landing on a walkable tile. NOTE: decision #3 planned a literal *grid*-perimeter spawn; on the-moon
 * (245×280, camp near centre) that perimeter is ~140 tiles of void from the base, so spawns anchor to
 * the defended centre instead — same "code-side, directional, no authoring" intent, playable now.
 * Switch to a real map/treeline edge when the MVP arena map lands (roadmap Step 0).
 *
 * `NIGHT_WAVE_BEATS` is the pacing curve over normalized night progress (0 = dusk, 1 = dawn): the
 * spawn interval by beat gives a trickle → push → lull shape. Placeholder numbers — the real
 * fuel-vs-DPS-vs-pacing tuning is plan 038 Step 5; per-night escalation scales these there too.
 */
export const WAVE_SPAWN_DIR = { dCol: 0, dRow: -1 } as const; // north — the "treeline" side of camp
export const WAVE_SPAWN_RADIUS = 14; // tiles from the defended centre to the spawn ring
export const WAVE_SPAWN_SPREAD = 10; // lateral half-width along the edge (± perpendicular to DIR)
export const NIGHT_WAVE_BEATS: readonly { untilNorm: number; intervalMs: number }[] = [
  { untilNorm: 0.25, intervalMs: 20_000 }, // trickle — first quarter of the night, sparse
  { untilNorm: 0.7, intervalMs: 14_000 }, // push — the bulk of the assault
  { untilNorm: 1.0, intervalMs: 26_000 }, // lull — taper before dawn ("the lull is a trap")
];

/**
 * Fuel a wave mob drains from the fire per fire-strike (plan 038 Step 4 — the objective-target AI's
 * `attackFire`). The fire has no armour/dodge, so this is a flat drain on the same `fuel` meter burn +
 * feeding use (decision #2). Tuned (Step 5) against a deterministic anchor rather than by raw feel: a
 * LONE mob on the ~1s contact cadence should knock a full fire (`CAMPFIRE_FUEL_MAX`) out in a
 * *tense-but-reactable* window — >15s (not a blink; you can notice + respond) and well under a night —
 * which at 120 fuel / ~1 strike-per-second lands around 5/strike (~24s). A crowd stacks, so several
 * undefended mobs still douse it fast; feeding wood (30/wood) lets you claw back vs a mob or two.
 * `wave.test.ts` guards this window. This is the #1 feel knob for playtest (raise = fire more fragile).
 */
export const WAVE_FIRE_ATTACK_DAMAGE = 5;

/** Semantic colour palette (dark & grotty). Expand as the art identity firms up. */
export const COLORS = {
  background: 0x14100f,
  water: 0x24384a,
  ui: 0xe8dcc0,
  ghostValid: 0x4caf50, // build ghost when a tile is placeable + affordable
  ghostInvalid: 0xb23b3b, // build ghost when blocked or unaffordable
  blueprint: 0x5a7a9a, // placed-but-unbuilt construction site (drawn translucent)
  queued: 0xffd500, // outline / marker for targets currently in the worker's task queue
  night: 0x04060e, // near-black night light-layer tint (plan 039 Step 2: full dark that conceals; a faint blue, not clinical black)
  fireLight: 0xffb066, // warm campfire glow tint (later step: light/reveal radius rendering)
  bowTarget: 0xff5a4d, // stroked highlight round the bow's current auto-target (plan 035a Step 5)
  arrow: 0xf4e2b8, // coded arrow-tracer dash colour (plan 035a Step 5)
  hpBarBg: 0x1c1410, // floating monster HP-bar backing (plan 035a Step 6)
  hpBarHigh: 0x4caf50, // HP-bar fill when healthy (matches the player bar's green)
  hpBarLow: 0xc0392b, // HP-bar fill when low (matches the player bar's red)
} as const;
