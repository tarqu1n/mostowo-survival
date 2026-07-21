// Shared constants for the editor's Phaser scene (plan 043 mechanical split out of EditorScene.ts).
// Zoom clamp, the parked two-finger-gesture flag, ghost/underlay tuning, render depths, overlay
// colours, and the eyedropper cursor — imported by the scene composition root and its controllers/
// renderers. Behaviour-preserving move only: values + comments are verbatim from EditorScene.ts.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const PAN_MARGIN_TILES = 6;

/** Master switch for the two-finger camera gesture (pinch-zoom + two-finger pan). Disabled for now:
 *  on touch it was intermittently hijacking single taps into a zoom (a stranded phantom finger faking
 *  a two-finger gesture), so every touch is treated as a plain single-finger tool interaction until
 *  toolbar zoom buttons land. Flip back to `true` to restore the gesture; all the gesture code below
 *  stays intact behind this flag. Wheel-zoom (desktop) is unaffected. */
export const TWO_FINGER_GESTURE_ENABLED = false;

// Neighbour ghost strips (step 9): how deep into each placed neighbour to render, and at what alpha.
export const GHOST_STRIP_TILES = 12;
export const GHOST_ALPHA = 0.4;
export const BRUSH_GHOST_ALPHA = 0.6; // translucent preview of the armed (optionally rotated) brush tile

// Reference-underlay tracing image (plan 022): a single fixed texture key (one underlay at a time),
// removed + reloaded whenever the picked image changes (Phaser errors on a duplicate key).
export const UNDERLAY_TEXTURE_KEY = '__underlay';

// Render depths. Tile layers occupy 0..layers.length-1; everything else sits above them.
export const DEPTH_UNDERLAY = 200; // trace-over reference image — an OVERLAY: ABOVE the tile layers (so it's
// never hidden by opaque tiles you've painted — trace + check coverage through its ~0.5 alpha), but
// below the ghost strips + editor guide overlays (void/objects/walkability/zones/grid) so those stay
// legible on top.
export const DEPTH_GHOST = 250; // dimmed neighbour strips — above tile layers, below the void hatch/objects
export const DEPTH_GHOST_NOTICE = 9200;
export const DEPTH_VOID = 500;
export const DEPTH_OBJECTS = 1000;
export const DEPTH_WALKABILITY = 1500;
export const DEPTH_ZONES = 1550;
export const DEPTH_ZONE_LABELS = 1560;
export const DEPTH_GRID = 9000;
export const DEPTH_SHAPE_BOUNDARY = 9100;
export const DEPTH_HOVER = 9500;
export const DEPTH_SELECTION = 9550;
/** The Select tool's marquee region highlight — above the object-selection outline, below the live
 *  rect-drag preview (so an in-progress marquee draws over a committed region box). */
export const DEPTH_REGION = 9560;
export const DEPTH_RECT_PREVIEW = 9600;

// Void checker — two near-black shades per cell plus a faint diagonal, reads as "out of bounds".
export const VOID_COLOUR_A = 0x0a0807;
export const VOID_COLOUR_B = 0x181113;
export const VOID_HATCH = 0x2a2320;
export const GRID_COLOUR = 0x4a3f38;
export const HOVER_COLOUR = 0xf0d890;
export const SELECTION_COLOUR = 0x5fd0ff;
/** Marquee region highlight/preview — a warm amber, distinct from the cyan single-object outline so a
 *  drawn box reads as "a whole area", not "an object". */
export const REGION_COLOUR = 0xffb454;
export const PORTAL_PREVIEW_COLOUR = 0x7aa6ff;
export const COLLISION_PREVIEW_COLOUR = 0xd06a5a;
export const ZONE_PREVIEW_COLOUR = 0x8fd67a;
export const SHAPE_PREVIEW_COLOUR = 0xfff05a;
export const TERRAIN_PREVIEW_COLOUR = 0x7ec87e;

// Step 8 overlays.
export const WALKABILITY_TINT = 0xd04040;
export const WALKABILITY_HATCH = 0xffffff;
export const SHAPE_BOUNDARY_COLOUR = 0xfff05a;

// Node/portal marker fallback (used when a node ref is unknown, or its tile texture isn't resident —
// real tile-role sprite rendering is the step-7 default; portals are always a labelled outline).
export const NODE_MARKER = 0x66bb66;
export const PORTAL_MARKER = 0x7aa6ff;

/** Cursor shown while the eyedropper is armed (the `eyedropper` tool, or Alt held over a tile-paint
 *  tool). A hand-drawn pipette as an inline SVG data-URI (tapered tip→bulb, white halo so it reads on
 *  any tile), hotspot at the tip `(3,21)`, falling back to `crosshair` if the data-URI cursor is
 *  unsupported. `#` is `%23`-encoded (a raw `#` would start a URL fragment). */
export const EYEDROPPER_CURSOR =
  "url(\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M3 21 8 16' stroke='%23fff' stroke-width='5'/><path d='M8 16 16 8' stroke='%23fff' stroke-width='7'/><path d='M16 8 20 4' stroke='%23fff' stroke-width='9'/><path d='M3 21 8 16' stroke='%23000' stroke-width='2.5'/><path d='M8 16 16 8' stroke='%23000' stroke-width='4.5'/><path d='M16 8 20 4' stroke='%23000' stroke-width='6.5'/></svg>\") 3 21, crosshair";
