import Phaser from 'phaser';
import { Button, arrangeRow } from '../../ui';
import type { HudElement } from './types';

export interface ModeControlsDeps {
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
}

/**
 * Mode toggle (Command/Combat/Inspect — see plan 003): the COMBAT + INSPECT buttons, left side below
 * the wood/queue readout. Command is the default (no button). GameScene owns the authoritative mode;
 * this widget just mirrors it for button highlighting (UIScene.onModeChanged → {@link reflect}).
 */
export class ModeControls {
  private modeCombatButton!: Button;
  private modeInspectButton!: Button;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: ModeControlsDeps,
  ) {
    // Laid out in a row via the kit's arrangeRow helper.
    const mbw = 64;
    const mbh = 20;
    this.modeCombatButton = new Button(this.scene, 0, 0, {
      width: mbw,
      height: mbh,
      label: 'COMBAT',
      fontSize: 9,
      onDown: () => this.scene.game.events.emit('mode:combatToggle'),
    });
    this.modeInspectButton = new Button(this.scene, 0, 0, {
      width: mbw,
      height: mbh,
      label: 'INSPECT',
      fontSize: 9,
      onDown: () => this.scene.game.events.emit('mode:inspectToggle'),
    });
    arrangeRow([this.modeCombatButton, this.modeInspectButton], {
      startX: 8,
      y: 48,
      width: mbw,
      gap: 8,
    });
    this.deps.addHudElement(this.modeCombatButton, this.modeInspectButton);
  }

  /** Reflect the authoritative mode from GameScene: highlight the matching toggle. */
  reflect(mode: 'command' | 'combat' | 'inspect'): void {
    this.modeCombatButton.setToggled(mode === 'combat');
    this.modeInspectButton.setToggled(mode === 'inspect');
  }
}
