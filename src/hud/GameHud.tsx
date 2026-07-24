import { useEffect, useRef, useState } from 'react';
import {
  BASE_WIDTH,
  BASE_HEIGHT,
  DAMAGE_VIGNETTE_ALPHA,
  DAMAGE_VIGNETTE_MS,
  DAMAGE_VIGNETTE_COLOR,
  HUNGER_VIGNETTE_COLOR,
  HUNGER_VIGNETTE_MAX_ALPHA,
  HUNGER_LOW_FRACTION,
  BUILD_DIM_COLOR,
  BUILD_DIM_ALPHA,
  BUILD_DIM_MS,
} from '@/config';
import { useCanvasRect } from './hooks/useCanvasRect';
import type { CanvasRect } from './hooks/useCanvasRect';
import { useBridge, hudBridge } from './hooks/useBridge';
import { useHudStore } from './store';
import { MeterBars } from './components/MeterBars';
import { DayNightDial } from './components/DayNightDial';
import { ResourceChips } from './components/ResourceChips';
import { Hotbar } from './components/Hotbar';
import { CommandBar } from './components/CommandBar';
import type { CommandBarMode } from './components/CommandBar';
import { BuildCatalog } from './components/BuildCatalog';
import { LineToolFab } from './components/LineToolFab';
import { CommitBar } from './components/CommitBar';
import { PackDrawer } from './components/PackDrawer';
import { StatusDrawer } from './components/StatusDrawer';
import { InspectCard } from './components/InspectCard';
import { CompanionMenu } from './components/CompanionMenu';
import { CraftMenu } from './components/CraftMenu';
import { DevMenu } from './components/DevMenu';

/** `0xRRGGBB` (config colour) → a CSS hex string. The vignette configs are shared with the (now
 *  retired) Phaser bake, which stored them as numbers. */
const cssHex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/**
 * Root of the DOM/React HUD overlay (plan 046, Field Kit). Lives at the page level over the Phaser
 * canvas (mounted into #hud-root by main.tsx), NOT inside any Phaser scene — it persists across
 * GameScene death→restart. The root itself is click-through (pointer-events:none, set on #hud-root
 * in index.html); interactive controls opt back in as they are added.
 *
 * Layering:
 *  - `Vignettes` — full-canvas-rect screen effect (damage flash + starving tint), NOT design-scaled.
 *  - `.hud-design` — positioned over the live canvas rect and CSS-scaled so children author in fixed
 *    360×640 design units (same space Phaser draws in).
 *  - `.hud-safe` — an inset sublayer carrying `env(safe-area-inset-*)` for interactive clusters.
 *    Holds the top cluster (Step 9): MeterBars (top-left), DayNightDial (top-centre), ResourceChips
 *    (top-right); the bottom `ActionLayer` (hotbar + command bar + drawers, Steps 10–11); and the
 *    `Overlays` (inspect / companion / dev, Step 12). Each self-positions, needing only a positioned
 *    ancestor (the sheet-based overlays portal out to the body regardless).
 */
export function GameHud() {
  useBridge();
  const rect = useCanvasRect();
  const sceneActive = useHudStore((s) => s.sceneActive);

  // Render nothing until the Game scene is live (so the overlay never paints over the loading/title
  // screens) and until the canvas is measured (avoids a flash at the wrong place). Hooks above always
  // run — the bridge stays wired across scenes so it catches `sceneActive` flipping true.
  if (!sceneActive || !rect) return null;

  return (
    <div className="hud-root" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <BuildDim rect={rect} />
      <Vignettes rect={rect} />

      <div
        className="hud-design"
        style={{
          position: 'absolute',
          left: rect.left,
          top: rect.top,
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
          transform: `scale(${rect.scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        {/* Interactive-safe sublayer: everything tappable lives inside these safe-area insets. */}
        <div
          className="hud-safe"
          style={{
            position: 'absolute',
            inset: 0,
            paddingTop: 'env(safe-area-inset-top)',
            paddingRight: 'env(safe-area-inset-right)',
            paddingBottom: 'env(safe-area-inset-bottom)',
            paddingLeft: 'env(safe-area-inset-left)',
          }}
        >
          <MeterBars />
          <DayNightDial />
          <ResourceChips />
          <ActionLayer />
          <Overlays />
        </div>
      </div>
    </div>
  );
}

/**
 * Bottom action layer (plan 046 Step 10): the persistent 6-slot `Hotbar` above the morphing
 * `CommandBar`, anchored to the bottom of the design space. The bar's morph is derived here from the
 * store — build mode wins, then the combat auto-surface / manual combat mode, else scavenge (mirrors
 * the old `UIScene` precedence). The movepad's held-state is pushed to the registry `movepadHeld` flag
 * via the bridge so `PointerInputController` suppresses world pan/tap while the pad is dragged.
 *
 * The scavenge morph's Build/Pack/Status buttons open the Tier-2 bottom-sheet drawers (Step 11); only
 * one is open at a time, tracked here. Build additionally toggles build mode (handled in CommandBar).
 */
type OpenDrawer = 'build' | 'pack' | 'status' | null;

function ActionLayer() {
  const gameMode = useHudStore((s) => s.mode);
  const buildMode = useHudStore((s) => s.buildMode);
  const combatActive = useHudStore((s) => s.combatActive);
  const hasPendingRun = useHudStore((s) => s.runTally.tileCount > 0);
  const [openDrawer, setOpenDrawer] = useState<OpenDrawer>(null);

  const barMode: CommandBarMode = buildMode
    ? 'build'
    : gameMode === 'combat' || combatActive
      ? 'fight'
      : 'scavenge';

  const toggle = (which: NonNullable<OpenDrawer>) => (open: boolean) =>
    setOpenDrawer(open ? which : null);

  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col items-stretch gap-1.5 px-2 pb-2">
      {/* Build line-tool FAB (plan 050 Step 6) — right-aligned at the top of the thumb cluster, shown
          only in build mode. Toggles the run-paint gesture; the CommandBar's build morph below carries
          the rest of the placement controls (Rotate/Place/Demolish/Cancel). */}
      {buildMode && <LineToolFab />}
      {/* Commit bar (plan 050 Step 7) — shown only while build mode has a non-empty pending run painted
          by the line tool; Confirm/Cancel commit or drop the run. */}
      {buildMode && hasPendingRun && <CommitBar />}
      <div className="flex justify-center">
        <Hotbar />
      </div>
      <CommandBar
        mode={barMode}
        onBuild={() => setOpenDrawer('build')}
        onPack={() => setOpenDrawer('pack')}
        onStatus={() => setOpenDrawer('status')}
        onMoveHeldChange={(held) => hudBridge()?.setMovepadHeld(held)}
      />
      <BuildCatalog open={openDrawer === 'build'} onOpenChange={toggle('build')} />
      <PackDrawer open={openDrawer === 'pack'} onOpenChange={toggle('pack')} />
      <StatusDrawer open={openDrawer === 'status'} onOpenChange={toggle('status')} />
    </div>
  );
}

/**
 * Deep overlays (plan 046 Step 12) — the DOM replacements for the last three Phaser HUD widgets,
 * grouped here since none belong to the persistent top/action clusters:
 *  - `InspectCard` — a pure mirror of `store.inspectTarget` (open iff non-null); its own dismiss emits
 *    `inspect:hide`, which the bridge clears back into the store, so no local open flag can drift.
 *  - `CompanionMenu` — opened by the `npc:menuOpen` game event (held in the store's `companionMenu`,
 *    wired in the bridge); each row emits the same `npc:*` bus event the legacy popover fired, and
 *    "Guard here" arms the one-tap `npc:beginPlaceGuard` place-the-point flow (unchanged in GameScene).
 *  - `DevMenu` — whole render gated on `import.meta.env.DEV`, dead-code-eliminated from prod builds.
 *
 * `InspectCard`/`CompanionMenu` are Radix sheets that portal to `document.body` (viewport-fixed, not
 * design-scaled); `DevMenu` self-positions bottom-right inside this design-space layer. All three own
 * their own pointer-events, so the click-through HUD root does not gate them.
 */
function Overlays() {
  const menu = useHudStore((s) => s.companionMenu);
  const closeCompanionMenu = useHudStore((s) => s.closeCompanionMenu);
  const craftMenu = useHudStore((s) => s.craftMenu);
  const closeCraftMenu = useHudStore((s) => s.closeCraftMenu);

  return (
    <>
      <InspectCard />
      <CompanionMenu
        open={menu.open}
        dayRole={menu.dayRole}
        nightPosture={menu.nightPosture}
        // Dismiss only closes the sheet — it must NOT emit `npc:cancelPlaceGuard`, or picking "Guard
        // here" (which arms placement, then calls onClose) would immediately disarm itself. The ESC
        // guard-cancel stays in UIScene until the Step 13 cutover.
        onClose={closeCompanionMenu}
      />
      <CraftMenu
        open={craftMenu.open}
        benchId={craftMenu.benchId}
        hp={craftMenu.hp}
        maxHp={craftMenu.maxHp}
        onClose={closeCraftMenu}
      />
      <DevMenu />
    </>
  );
}

/**
 * Blueprint-Mode dim (plan 050 Step 4) — a flat full-canvas dark wash faded in while build mode is
 * active, so the world recedes and attention falls on placement (paired with the Phaser snap grid).
 * Gated purely on the store's `buildMode` flag, which the bridge mirrors from `build:modeChanged`;
 * demolish mode never sets it (build↔demolish are mutually exclusive in GameScene), so demolish
 * shows NEITHER this dim nor the grid. Covers the live canvas rect (a screen effect, so NOT inside
 * the design-scaled layer) and is always click-through — taps fall straight through to the world.
 */
function BuildDim({ rect }: { rect: CanvasRect }) {
  const buildMode = useHudStore((s) => s.buildMode);
  return (
    <div
      data-testid="hud-build-dim"
      style={{
        position: 'absolute',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        pointerEvents: 'none',
        opacity: buildMode ? BUILD_DIM_ALPHA : 0,
        transition: `opacity ${BUILD_DIM_MS}ms linear`,
        background: cssHex(BUILD_DIM_COLOR),
      }}
    />
  );
}

/**
 * Screen-edge vignettes (plan 046 Step 9) — the DOM replacement for the two Phaser vignette images.
 * A red DAMAGE flash pulsed on each `player:hit` (the store's monotonic `hitNonce`) and a steady
 * yellow STARVING tint ramping in as hunger drops below `HUNGER_LOW_FRACTION`. Covers the live canvas
 * rect (a screen effect, so NOT inside the design-scaled layer); always click-through.
 */
function Vignettes({ rect }: { rect: CanvasRect }) {
  const hitNonce = useHudStore((s) => s.hitNonce);
  const hunger = useHudStore((s) => s.hunger);
  const maxHunger = useHudStore((s) => s.maxHunger);
  const damageRef = useRef<HTMLDivElement>(null);

  // Pulse the damage flash on each hit: snap to peak then fade to 0. The Web Animations API gives the
  // instant-rise-then-ease-out the old Cubic.easeIn tween did, and a fresh call restarts it cleanly on
  // back-to-back hits (fill:none → opacity returns to the element's base 0 when it ends). Skip nonce 0
  // (initial mount) so the HUD doesn't flash on load.
  useEffect(() => {
    if (hitNonce === 0 || !damageRef.current) return;
    const anim = damageRef.current.animate([{ opacity: DAMAGE_VIGNETTE_ALPHA }, { opacity: 0 }], {
      duration: DAMAGE_VIGNETTE_MS,
      easing: 'cubic-bezier(0.55, 0.055, 0.675, 0.19)',
    });
    return () => anim.cancel();
  }, [hitNonce]);

  const ratio = maxHunger > 0 ? hunger / maxHunger : 1;
  const hungerAlpha =
    ratio < HUNGER_LOW_FRACTION ? HUNGER_VIGNETTE_MAX_ALPHA * (1 - ratio / HUNGER_LOW_FRACTION) : 0;

  const layer: React.CSSProperties = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    pointerEvents: 'none',
  };

  return (
    <>
      <div
        data-testid="hud-vignette-hunger"
        style={{
          ...layer,
          opacity: hungerAlpha,
          transition: 'opacity 300ms linear',
          background: `radial-gradient(ellipse at center, transparent 55%, ${cssHex(HUNGER_VIGNETTE_COLOR)} 115%)`,
        }}
      />
      <div
        ref={damageRef}
        data-testid="hud-vignette-damage"
        style={{
          ...layer,
          opacity: 0,
          background: `radial-gradient(ellipse at center, transparent 50%, ${cssHex(DAMAGE_VIGNETTE_COLOR)} 115%)`,
        }}
      />
    </>
  );
}
