import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from '../../config';
import { ITEMS } from '../../data/items';
import { iconKey } from '../../data/tileset';
import type { CombatantStats } from '../../data/types';
import type { Inventory } from '../../systems/Inventory';
import { Button, Panel } from '../../ui';
import type { HudElement } from './types';

export interface WellbeingPanelDeps {
  /** The shared character Inventory (registry-held) — edible stock counts + the eat guard. */
  inv(): Inventory | undefined;
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
}

/**
 * Health & Wellbeing screen (plan 004): a STATUS-toggled Panel with a hunger + health meter, the
 * player's stat rows, and a tap-to-eat edible list, plus the STATUS toggle button itself. Only the
 * button + panel go in the HUD hit-region — the panel's bounds cover the edible rows for the
 * world-tap gate (same as the inventory panel). The bars are passive views driven by
 * `UIScene.updateHealthBar`/`updateHungerBar` (which also feed the always-on {@link HudBars}) via
 * {@link setHealth}/{@link setHunger}.
 */
export class WellbeingPanel {
  private statusButton!: Button;
  private wellbeingPanel!: Panel;
  private hungerBarFg!: Phaser.GameObjects.Rectangle;
  private hungerLabel!: Phaser.GameObjects.Text;
  private healthBarFg!: Phaser.GameObjects.Rectangle;
  private healthLabel!: Phaser.GameObjects.Text;
  private eatRows: Array<{ itemId: string; button: Button; nutrition: number }> = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: WellbeingPanelDeps,
  ) {
    // STATUS — opens the Health & Wellbeing screen. Left column, below the mode row (clear of the
    // combat movepad/Attack corners and the centre day/night stack). 64×20 mirrors the mode-row buttons.
    this.statusButton = new Button(this.scene, 8 + 64 / 2, 72, {
      width: 64,
      height: 20,
      label: 'STATUS',
      fontSize: 9,
      onDown: () => this.toggleWellbeing(),
    });
    this.deps.addHudElement(this.statusButton);

    this.build();
  }

  /**
   * Build the STATUS-toggled Wellbeing Panel: a hunger + health two-rect meter, the player's stat
   * rows (from the registry's `playerStats`), and a tap-to-eat list of every edible item. Meters are
   * left-anchored fg rects scaled by value; the edible rows are kit Buttons that emit `needs:eat`.
   */
  private build(): void {
    const W = 220;
    const H = 384;
    const halfH = H / 2;
    const top = (offsetY: number): number => -halfH + offsetY;
    const BAR_W = 176;
    const BAR_H = 12;

    this.wellbeingPanel = new Panel(this.scene, BASE_WIDTH / 2, BASE_HEIGHT / 2, {
      width: W,
      height: H,
      depth: 20,
      dismissible: true,
      onDismiss: () => this.setWellbeingOpen(false),
    });
    this.wellbeingPanel
      .addText(16, { fontSize: '12px', color: '#e8dcc0' })
      .setText('HEALTH & WELLBEING');

    // A left-anchored two-rect meter (dark bg + coloured fg scaled by value). Returns the fg rect;
    // callers set `fg.scaleX = value/max` and re-tint it. Origin (0, 0.5) keeps the left edge fixed.
    const makeBar = (offsetY: number, colour: number): Phaser.GameObjects.Rectangle => {
      const bg = this.scene.add
        .rectangle(0, top(offsetY), BAR_W, BAR_H, 0x2a2a2a)
        .setStrokeStyle(1, 0x000000, 0.5);
      const fg = this.scene.add
        .rectangle(-BAR_W / 2, top(offsetY), BAR_W, BAR_H, colour)
        .setOrigin(0, 0.5);
      this.wellbeingPanel.add([bg, fg]);
      return fg;
    };

    this.hungerLabel = this.wellbeingPanel.addText(44, { fontSize: '10px', color: '#e8dcc0' });
    this.hungerBarFg = makeBar(60, 0xd8a24a);
    this.healthLabel = this.wellbeingPanel.addText(86, { fontSize: '10px', color: '#e8dcc0' });
    this.healthBarFg = makeBar(102, 0x4caf50);

    // Player stats — read once from the registry (combat's private stat bag, surfaced by GameScene).
    const s = this.scene.registry.get('playerStats') as CombatantStats | undefined;
    const statLine = (label: string, value: number | string): string =>
      `${label.padEnd(9)}${value}`;
    const statsText = s
      ? [
          statLine('Max HP', s.maxHp),
          statLine('Armour', s.armour),
          statLine('Speed', s.speed),
          statLine('Vision', s.vision ?? '-'),
          statLine('Strength', s.strength),
          statLine('Dex', s.dex),
          statLine('Dodge', s.dodge),
        ].join('\n')
      : '(stats unavailable)';
    this.wellbeingPanel.addText(126, { fontSize: '11px', color: '#9a8f74' }).setText('— STATS —');
    this.wellbeingPanel
      .addText(140, { fontSize: '10px', color: '#9a8f74', align: 'left' }, 0)
      .setText(statsText);

    // Edible list — one interactive row per item with `nutrition`. The row emits needs:eat (guarded to
    // count > 0). Rows live inside the panel, so the panel's bounds cover them for the world-tap gate.
    this.wellbeingPanel
      .addText(248, { fontSize: '11px', color: '#9a8f74' })
      .setText('— AVAILABLE TO EAT —');
    const edibles = Object.values(ITEMS).filter((it) => it.nutrition != null);
    edibles.forEach((it, i) => {
      const rowY = top(272 + i * 30);
      if (this.scene.textures.exists(iconKey(it.id))) {
        const icon = this.scene.add
          .image(-BAR_W / 2 + 6, rowY, iconKey(it.id))
          .setDisplaySize(18, 18);
        this.wellbeingPanel.add(icon);
      }
      const button = new Button(this.scene, 14, rowY, {
        width: 150,
        height: 24,
        label: it.name,
        fontSize: 10,
        onDown: () => {
          if ((this.deps.inv()?.get(it.id) ?? 0) > 0)
            this.scene.game.events.emit('needs:eat', { itemId: it.id });
        },
      });
      this.wellbeingPanel.add(button);
      this.eatRows.push({ itemId: it.id, button, nutrition: it.nutrition! });
    });

    this.deps.addHudElement(this.wellbeingPanel);
  }

  /** The registry's seeded max HP (for UIScene's health-bar seed), or 0 when stats are unavailable. */
  seedMaxHp(): number {
    return (this.scene.registry.get('playerStats') as CombatantStats | undefined)?.maxHp ?? 0;
  }

  private toggleWellbeing(): void {
    this.setWellbeingOpen(!this.wellbeingPanel.visible);
  }

  private setWellbeingOpen(open: boolean): void {
    if (open) {
      this.refreshEatRows(); // sync counts before showing
      this.wellbeingPanel.show();
    } else {
      this.wellbeingPanel.hide();
    }
    this.statusButton.setToggled(open);
  }

  /** Scale + tint the panel's hunger bar and update its label (driven by `UIScene.updateHungerBar`). */
  setHunger(ratio: number, colour: number, text: string): void {
    this.hungerBarFg.scaleX = ratio;
    this.hungerBarFg.setFillStyle(colour);
    this.hungerLabel.setText(text);
  }

  /** Scale + tint the panel's health bar and update its label (driven by `UIScene.updateHealthBar`). */
  setHealth(ratio: number, colour: number, text: string): void {
    this.healthBarFg.scaleX = ratio;
    this.healthBarFg.setFillStyle(colour);
    this.healthLabel.setText(text);
  }

  /** Refresh each edible row's label (live count + nutrition) and dim rows with no stock. */
  refreshEatRows(): void {
    const inv = this.deps.inv();
    for (const row of this.eatRows) {
      const count = inv?.get(row.itemId) ?? 0;
      const name = ITEMS[row.itemId]?.name ?? row.itemId;
      row.button.setLabel(`${name}  x${count}  +${row.nutrition}`);
      row.button.setDimmed(count <= 0);
    }
  }
}
