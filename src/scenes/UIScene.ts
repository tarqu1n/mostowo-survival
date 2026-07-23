import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, RENDER_SCALE } from '../config';
import { InspectPanel } from './hud/InspectPanel';
import { DevMenu } from './hud/DevMenu';
import { NpcAssignMenu } from './hud/NpcAssignMenu';
import type { HudElement } from './hud/types';

/**
 * HUD overlay, run in parallel over GameScene (never replaces it). UI is decoupled from world logic:
 * it talks to GameScene only over `this.game.events` (`inspect:*`, `mode:*`, `npc:*`, …).
 *
 * This scene is the **composition root** for the REMAINING Phaser HUD widgets: each self-contained
 * group lives in a `scenes/hud/` module (inspect panel, dev menu, NPC assign menu). `create()`
 * constructs them, keeps their `game.events` bus wiring here, and dispatches each event to the owning
 * widget's handler. Cross-widget state (the HUD hit-region list, the input mode) stays on the scene.
 *
 * Migration (plan 046): the always-on bars + top-centre stack + vignettes were retired at Step 9;
 * the build controls, combat controls (movepad/attack/bow), and mode toggles at Step 10; the
 * Wellbeing panel + Inventory widget at Step 11 — all now in the DOM HUD (`src/hud/`), which owns the
 * `movepadHeld` registry gate, the survival meters, the status/pack drawers, and the hotbar. The
 * remaining widgets (Inspect, Dev, NPC-assign) migrate at Step 12; this scene is deleted at Step 13.
 *
 * Cross-scene input arbitration: GameScene's world tap handler ignores pointers inside the HUD
 * hit-region ({@link hudHitTest}) so tapping a button never also moves/chops/places underneath.
 */
export class UIScene extends Phaser.Scene {
  /** Interactive HUD elements GameScene must treat as UI, not world — tested live so a hidden
   * button (the panel when closed) never swallows a world tap. Kit widgets are Containers; a
   * Container's getBounds() is the union of its children's bounds. Widget modules push their own
   * interactive elements here through the `addHudElement` closure passed at construction. */
  private hudElements: HudElement[] = [];

  // Per-widget groups (each owns its own builder + update handlers — see scenes/hud/).
  private inspectPanel!: InspectPanel;
  private devMenu!: DevMenu;
  private npcAssignMenu!: NpcAssignMenu;

  constructor() {
    super('UI');
  }

  create(): void {
    // The backing store is BASE×RENDER_SCALE (rendered at device density to kill tile-edge seams —
    // see config RENDER_SCALE). Zoom the HUD camera by that factor and recentre it on the design-space
    // midpoint, so every widget below stays authored in plain BASE_WIDTH×BASE_HEIGHT units yet renders
    // crisply at device resolution. (No-op at RENDER_SCALE 1.)
    if (RENDER_SCALE !== 1) {
      this.cameras.main.setZoom(RENDER_SCALE);
      this.cameras.main.centerOn(BASE_WIDTH / 2, BASE_HEIGHT / 2);
    }

    const addHudElement = (...els: HudElement[]): void => {
      this.hudElements.push(...els);
    };
    const initialPhase = (this.registry.get('dayPhase') as 'day' | 'night' | undefined) ?? 'day';

    this.inspectPanel = new InspectPanel(this, { addHudElement });
    this.devMenu = new DevMenu(this, { addHudElement, initialPhase });
    // Companion assignment menu (plan 042 Step 9) — hidden until GameScene emits `npc:menuOpen`.
    this.npcAssignMenu = new NpcAssignMenu(this, { addHudElement });

    // ESC bails out of any armed guard-point placement (the companion menu's documented Escape cancel);
    // build/demolish exit + rotate are DOM buttons now (plan 046 Step 10). Keyboard is scene-scoped.
    this.input.keyboard?.on('keydown-ESC', this.onEscape, this);

    this.game.events.on('mode:changed', this.onModeChanged, this);
    this.game.events.on('inspect:show', this.inspectPanel.show, this.inspectPanel);
    this.game.events.on('inspect:hide', this.inspectPanel.hide, this.inspectPanel);
    this.game.events.on('time:changed', this.onTimeChanged, this);
    this.game.events.on('npc:menuOpen', this.npcAssignMenu.onMenuOpen, this.npcAssignMenu);

    // Teardown so a future scene restart doesn't double-register on stale listeners.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('mode:changed', this.onModeChanged, this);
      this.game.events.off('inspect:show', this.inspectPanel.show, this.inspectPanel);
      this.game.events.off('inspect:hide', this.inspectPanel.hide, this.inspectPanel);
      this.game.events.off('time:changed', this.onTimeChanged, this);
      this.game.events.off('npc:menuOpen', this.npcAssignMenu.onMenuOpen, this.npcAssignMenu);
    });
  }

  /** True if (x, y) in game coords lands on a *visible* interactive HUD element. */
  hudHitTest(x: number, y: number): boolean {
    return this.hudElements.some((el) => el.visible && el.getBounds().contains(x, y));
  }

  /** Mirror the day/night phase onto the DEV day/night button's action label. The passive day/night
   *  readout + wave banner now live in the DOM HUD (DayNightDial — plan 046 Step 9). */
  private onTimeChanged({ phase }: { phase: 'day' | 'night'; dayCount: number }): void {
    this.devMenu.setPhaseLabel(phase);
  }

  /** Hide the Phaser inspect panel when leaving inspect mode. Mode-toggle highlighting + the combat
   *  controls' visibility moved to the DOM HUD (CommandBar) at plan 046 Step 10. */
  private onModeChanged(mode: 'command' | 'combat' | 'inspect'): void {
    if (mode !== 'inspect') this.inspectPanel.hide();
  }

  /** ESC: close the companion menu if open, else bail out of any armed guard-point placement in
   *  GameScene (a harmless no-op when nothing is armed) — the assignment menu's documented Escape
   *  cancel (plan 042 Step 9). Build/demolish exit + rotate are DOM buttons now (plan 046 Step 10). */
  private onEscape(): void {
    if (this.npcAssignMenu.isOpen()) this.npcAssignMenu.close();
    else this.game.events.emit('npc:cancelPlaceGuard');
  }
}
