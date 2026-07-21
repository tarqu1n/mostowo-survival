import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from '../../config';
import type { InspectableStats } from '../../data/types';
import { Panel } from '../../ui';
import type { HudElement } from './types';

export interface InspectPanelDeps {
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
}

/**
 * Inspect mode: a simple stats panel, centered, shown on `inspect:show` / hidden on `inspect:hide` or
 * leaving Inspect mode (UIScene routes those bus events + the mode change here). `inspectPanelBg` is
 * the Panel container itself, so its `visible` reflects open/closed; the three text rows live inside
 * it. Tapping the panel dismisses it (dismissible Panel → `inspect:hide`).
 */
export class InspectPanel {
  private inspectPanelBg!: Panel;
  private inspectPanelTitle!: Phaser.GameObjects.Text;
  private inspectPanelHp!: Phaser.GameObjects.Text;
  private inspectPanelExtra!: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: InspectPanelDeps,
  ) {
    // Inspect-mode stats panel — centered, clear of the always-on HUD zones. Hidden until
    // 'inspect:show'; tapping the panel itself dismisses it (dismissible Panel → 'inspect:hide').
    const iph = 150;
    this.inspectPanelBg = new Panel(this.scene, BASE_WIDTH / 2, BASE_HEIGHT / 2 - 40, {
      width: 200,
      height: iph,
      depth: 20,
      dismissible: true,
      onDismiss: () => this.scene.game.events.emit('inspect:hide'),
    });
    this.inspectPanelTitle = this.inspectPanelBg.addText(16, {
      fontSize: '13px',
      color: '#e8dcc0',
    });
    this.inspectPanelHp = this.inspectPanelBg.addText(38, { fontSize: '11px', color: '#e8dcc0' });
    this.inspectPanelExtra = this.inspectPanelBg.addText(
      58,
      { fontSize: '10px', color: '#9a8f74', align: 'center' },
      0,
    );
    this.deps.addHudElement(this.inspectPanelBg);
  }

  show(stats: InspectableStats): void {
    this.inspectPanelTitle.setText(stats.name);
    this.inspectPanelHp.setText(
      stats.currentHp !== undefined
        ? `HP: ${stats.currentHp}/${stats.maxHp}`
        : `Max HP: ${stats.maxHp}`,
    );
    this.inspectPanelExtra.setText(
      (stats.extra ?? []).map((e) => `${e.label}: ${e.value}`).join('\n'),
    );
    this.inspectPanelBg.show();
  }

  hide(): void {
    this.inspectPanelBg.hide();
  }
}
