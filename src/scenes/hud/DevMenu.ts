import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from '../../config';
import { Button, Panel, UI_THEME } from '../../ui';
import type { HudElement } from './types';

export interface DevMenuDeps {
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
  /** The day/night phase at build time — seeds the day/night button's initial action label. */
  initialPhase: 'day' | 'night';
}

/**
 * Dev menu (dev-only): a bottom-right DEV toggle opening a small olive Panel of build-testing helpers
 * — Spawn Enemy, Spawn NPC, a day/night flip, and Force Wave. Only the toggle button and the Panel go
 * in the HUD hit-region; the buttons nested in the Panel ride its bounds/visibility. The day/night
 * button's label tracks the current phase (kept live by UIScene.onTimeChanged → {@link setPhaseLabel}).
 */
export class DevMenu {
  private devButton!: Button;
  private devPanel!: Panel;
  private devTimeButton!: Button;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: DevMenuDeps,
  ) {
    // Dev menu (dev-only): a bottom-right DEV toggle opening a small olive Panel of build helpers.
    const dbw = 96;
    const dbh = 24;
    this.devButton = new Button(this.scene, BASE_WIDTH - dbw / 2 - 8, BASE_HEIGHT - dbh / 2 - 8, {
      width: dbw,
      height: dbh,
      label: 'DEV',
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.toggleDevMenu(),
    });
    this.deps.addHudElement(this.devButton);

    // The menu panel sits just above the DEV button, right-aligned to it. Its buttons are nested
    // children (like the Wellbeing eat-rows), so they show/hide and hit-test with the panel — only
    // the panel itself is pushed to hudElements. Hidden until DEV is tapped.
    const dpw = 124;
    const dph = 158; // fits four dev buttons (SPAWN ENEMY / SPAWN NPC / GO NIGHT / FORCE WAVE) + the label
    this.devPanel = new Panel(
      this.scene,
      BASE_WIDTH - dpw / 2 - 8,
      BASE_HEIGHT - dbh - 16 - dph / 2,
      {
        width: dpw,
        height: dph,
        fill: UI_THEME.olive.fill,
        stroke: UI_THEME.olive.stroke,
        strokeAlpha: UI_THEME.olive.strokeAlpha,
        depth: 20,
      },
    );
    this.devPanel.addText(14, { fontSize: '10px', color: UI_THEME.olive.text }).setText('DEV MENU');

    const spawnEnemyButton = new Button(this.scene, 0, -34, {
      width: 108,
      height: 24,
      label: 'SPAWN ENEMY',
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.scene.game.events.emit('debug:spawnEnemy'),
    });
    // Spawn the dev-/scenario-only companion Rogue by the player (plan 042) — the on-screen twin of the
    // console `window.game.events.emit('debug:spawnNpc')`, so the NPC is testable on a phone too.
    const spawnNpcButton = new Button(this.scene, 0, -4, {
      width: 108,
      height: 24,
      label: 'SPAWN NPC',
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.scene.game.events.emit('debug:spawnNpc'),
    });
    const initialTimeLabel = this.deps.initialPhase === 'day' ? 'GO NIGHT' : 'GO DAY';
    this.devTimeButton = new Button(this.scene, 0, 26, {
      width: 108,
      height: 24,
      label: initialTimeLabel,
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.scene.game.events.emit('debug:toggleTime'),
    });
    // Force-wave (plan 038 Step 6): jump to night AND kick off a wave now, for manual playtesting.
    const forceWaveButton = new Button(this.scene, 0, 56, {
      width: 108,
      height: 24,
      label: 'FORCE WAVE',
      variant: 'olive',
      fontSize: 11,
      onDown: () => this.scene.game.events.emit('debug:forceWave'),
    });
    this.devPanel.add([spawnEnemyButton, spawnNpcButton, this.devTimeButton, forceWaveButton]);
    this.deps.addHudElement(this.devPanel);
  }

  private toggleDevMenu(): void {
    const open = !this.devPanel.visible;
    if (open) this.devPanel.show();
    else this.devPanel.hide();
    this.devButton.setToggled(open);
  }

  /** Keep the day/night button showing the phase it'll switch *to* (so it reads as an action). */
  setPhaseLabel(phase: 'day' | 'night'): void {
    this.devTimeButton.setLabel(phase === 'day' ? 'GO NIGHT' : 'GO DAY');
  }
}
