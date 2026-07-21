import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from '../../config';
import { ITEMS } from '../../data/items';
import { BUILDABLES } from '../../data/buildables';
import type { BuildableDef } from '../../data/types';
import type { Inventory } from '../../systems/Inventory';
import { Button, Panel, arrangeColumn } from '../../ui';
import type { HudElement } from './types';

export interface BuildControlsDeps {
  /** The shared character Inventory (registry-held) — per-row build affordability. */
  inv(): Inventory | undefined;
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
}

/**
 * The top-right command column + BUILD palette (plans 012 / 037 / 037-2b): the BUILD toggle and its
 * centred buildable palette (+ per-row affordability), the placement ROTATE button, the DEMOLISH
 * toggle, the CANCEL button, the two bottom-centre mode hints (build / demolish), and the top-left
 * worker queue readout. Owns its own `build:*`/`demolish:*`/`tasks:*` update handlers; UIScene keeps
 * the bus wiring and dispatches here, and the shared ESC handler queries this widget's open/toggled
 * state.
 */
export class BuildControls {
  private buildButton!: Button;
  private modeIndicator!: Phaser.GameObjects.Text;
  private demolishButton!: Button;
  private demolishIndicator!: Phaser.GameObjects.Text;
  private cancelButton!: Button;
  private queueText!: Phaser.GameObjects.Text;
  private buildPalette!: Panel;
  private buildRows: Array<{ id: string; button: Button; cost: Record<string, number> }> = [];
  private rotateButton!: Button;
  private selectedBuildableId: string | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: BuildControlsDeps,
  ) {
    // Build toggle — a touch-sized button, top-right.
    const bw = 76;
    const bh = 26;
    this.buildButton = new Button(this.scene, BASE_WIDTH - bw / 2 - 8, 8 + bh / 2, {
      width: bw,
      height: bh,
      label: 'BUILD',
      onDown: () => this.onBuildButton(),
    });
    this.deps.addHudElement(this.buildButton);

    // Build-mode indicator — only visible while building.
    this.modeIndicator = this.scene.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 14, 'BUILD MODE — tap a tile · tap Build to cancel', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.deps.addHudElement(this.modeIndicator);

    // ROTATE — cycles the placement facing (plan 037), shown only in build mode with an orientable
    // buildable selected (see refreshRotateButton). Bottom-centre, just above the build-mode indicator.
    const rbw = 76;
    const rbh = 24;
    this.rotateButton = new Button(this.scene, BASE_WIDTH / 2, BASE_HEIGHT - 40, {
      width: rbw,
      height: rbh,
      label: 'ROTATE',
      fontSize: 10,
      onDown: () => this.scene.game.events.emit('build:rotate'),
    }).setVisible(false);
    this.deps.addHudElement(this.rotateButton);

    // Cancel button — clears the worker's task queue. Sits under the Build button, top-right.
    const cbw = 60;
    const cbh = 22;
    this.cancelButton = new Button(
      this.scene,
      BASE_WIDTH - cbw / 2 - 8,
      8 + bh / 2 + bh / 2 + cbh / 2 + 6,
      {
        width: cbw,
        height: cbh,
        label: 'CANCEL',
        variant: 'danger',
        fontSize: 10,
        onDown: () => this.scene.game.events.emit('tasks:cancel'),
      },
    ).setVisible(false);
    this.deps.addHudElement(this.cancelButton);

    // DEMOLISH toggle (plan 037 2b) — in the build column, under ITEMS (h 22). Flips demolish mode (tap
    // a finished wall to enqueue its unbuild); GameScene keeps it mutually exclusive with build mode.
    // Danger-styled since it destroys, mirroring the BUILD button's toggled-state affordance.
    const ibh = 22; // ITEMS button height (InventoryWidget) — the rung this button stacks below.
    const dmw = 76;
    const dmh = 22;
    this.demolishButton = new Button(
      this.scene,
      BASE_WIDTH - dmw / 2 - 8,
      8 + bh + cbh + ibh + dmh / 2 + 18,
      {
        width: dmw,
        height: dmh,
        label: 'DEMOLISH',
        variant: 'danger',
        fontSize: 10,
        onDown: () => this.scene.game.events.emit('demolish:toggle'),
      },
    );
    this.deps.addHudElement(this.demolishButton);

    // Demolish-mode hint — bottom-centre, sharing the build-mode indicator's slot (the two modes are
    // mutually exclusive, so only one is ever visible). Mirrors modeIndicator.
    this.demolishIndicator = this.scene.add
      .text(BASE_WIDTH / 2, BASE_HEIGHT - 14, 'DEMOLISH — tap a wall to unbuild', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.deps.addHudElement(this.demolishIndicator);

    // Queue indicator — current action + queued count, top-left.
    this.queueText = this.scene.add.text(10, 26, '', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#9a8f74',
    });

    this.buildBuildPalette();
  }

  /**
   * Build the BUILD-toggled palette: a centred, dismissible Panel with one row per BUILDABLES entry
   * (name + cost). Rows are nested Buttons that emit `build:select` and close the palette; only the
   * panel goes in hudElements (its bounds cover the rows for the world-tap gate). Sized to fit N rows.
   */
  private buildBuildPalette(): void {
    const entries = Object.values(BUILDABLES);
    const ROW_W = 200;
    const ROW_H = 30;
    const GAP = 8;
    const HEADER = 40; // title band above the first row
    const PAD = 16; // bottom breathing room
    const W = 224;
    const H = HEADER + entries.length * ROW_H + (entries.length - 1) * GAP + PAD;

    this.buildPalette = new Panel(this.scene, BASE_WIDTH / 2, BASE_HEIGHT / 2, {
      width: W,
      height: H,
      depth: 20,
      dismissible: true,
      onDismiss: () => this.setBuildPaletteOpen(false),
    });
    this.buildPalette.addText(16, { fontSize: '12px', color: '#e8dcc0' }).setText('BUILD');

    const buttons = entries.map((def) => {
      const button = new Button(this.scene, 0, 0, {
        width: ROW_W,
        height: ROW_H,
        label: this.buildableRowLabel(def),
        fontSize: 10,
        onDown: () => {
          this.scene.game.events.emit('build:select', { id: def.id });
          this.setBuildPaletteOpen(false);
        },
      });
      this.buildPalette.add(button);
      this.buildRows.push({ id: def.id, button, cost: def.cost });
      return button;
    });

    // Panel children are positioned relative to its centre; top edge is -H/2.
    arrangeColumn(buttons, { x: 0, startY: -H / 2 + HEADER, height: ROW_H, gap: GAP });

    this.deps.addHudElement(this.buildPalette);
  }

  /** "Wall   2 Wood" / "Campfire   10 Stone  10 Wood" — name plus each cost item as qty + name. */
  private buildableRowLabel(def: BuildableDef): string {
    const cost = Object.entries(def.cost)
      .map(([id, qty]) => `${qty} ${ITEMS[id]?.name ?? id}`)
      .join('  ');
    return `${def.name}   ${cost}`;
  }

  /** BUILD tapped: in build mode it exits (mirrors the old toggle-off); otherwise it toggles the palette. */
  private onBuildButton(): void {
    if (this.buildButton.isToggled()) {
      this.scene.game.events.emit('build:toggle');
      this.setBuildPaletteOpen(false);
      return;
    }
    this.setBuildPaletteOpen(!this.buildPalette.visible);
  }

  private setBuildPaletteOpen(open: boolean): void {
    if (open) {
      this.refreshBuildPalette(); // sync affordability before showing
      this.buildPalette.show();
    } else {
      this.buildPalette.hide();
    }
  }

  /** Dim each palette row the player can't currently afford (reads the shared Inventory). */
  refreshBuildPalette(): void {
    const inv = this.deps.inv();
    for (const row of this.buildRows) {
      row.button.setDimmed(!(inv?.canAfford(row.cost) ?? false));
    }
  }

  /** `build:modeChanged` handler: reflect build mode — the hint + BUILD toggle, drop the palette on
   *  entry (a picked buildable enters build mode), and re-evaluate ROTATE visibility (plan 037). */
  onBuildMode(active: boolean): void {
    this.modeIndicator.setVisible(active);
    this.buildButton.setToggled(active);
    if (active) this.setBuildPaletteOpen(false); // a picked buildable enters build mode → drop the palette
    this.refreshRotateButton(); // show/hide ROTATE with build mode (plan 037)
  }

  /** Reflect demolish mode (plan 037 2b): the DEMOLISH button's toggled state + its bottom-centre hint.
   *  GameScene owns the authoritative flag (and the mutual exclusion with build mode); this only mirrors. */
  onDemolishMode(active: boolean): void {
    this.demolishButton.setToggled(active);
    this.demolishIndicator.setVisible(active);
  }

  /** Reflect the worker's live task state: current action label + queued count, and Cancel visibility. */
  onTasks(state: { current: string | null; pending: number }): void {
    const busy = state.current !== null || state.pending > 0;
    this.queueText.setText(
      busy
        ? `▶ ${state.current ?? 'idle'}${state.pending ? ` · +${state.pending} queued` : ''}`
        : '',
    );
    this.cancelButton.setVisible(busy);
  }

  /** Remember which buildable the palette picked so ROTATE can key its visibility off it (plan 037).
   *  Refreshes the button now; `onBuildMode` (which fires right after `select` enters build mode) will
   *  also refresh, so the two converge on the right state regardless of listener order. */
  onBuildSelected({ id }: { id: string }): void {
    this.selectedBuildableId = id;
    this.refreshRotateButton();
  }

  /** Show ROTATE only in build mode with an `orientable` buildable selected (the wall). */
  private refreshRotateButton(): void {
    const selected = this.selectedBuildableId;
    const orientable = selected != null && (BUILDABLES[selected]?.orientable ?? false);
    this.rotateButton.setVisible(this.buildButton.isToggled() && orientable);
  }

  /** R (build mode only): rotate the placement facing — the keyboard mirror of the ROTATE button. */
  onRotateKey(): void {
    if (this.buildButton.isToggled()) this.scene.game.events.emit('build:rotate');
  }

  // ---- ESC-chain queries (the shared handler lives on UIScene) -------------

  /** Whether the build palette is currently open. */
  isPaletteOpen(): boolean {
    return this.buildPalette.visible;
  }

  /** Close the build palette (ESC step). */
  closePalette(): void {
    this.setBuildPaletteOpen(false);
  }

  /** Whether BUILD is toggled on (in build mode). */
  isBuildToggled(): boolean {
    return this.buildButton.isToggled();
  }

  /** Whether DEMOLISH is toggled on. */
  isDemolishToggled(): boolean {
    return this.demolishButton.isToggled();
  }
}
