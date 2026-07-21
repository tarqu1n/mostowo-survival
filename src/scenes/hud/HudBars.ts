import Phaser from 'phaser';

/**
 * Always-on top-left HUD meters: compact HP + food bars, the campfire fire-heart fuel bar, and the
 * base-supply wood/rock counts — so survival state is readable at a glance without opening the STATUS
 * panel. The HP + food bars are passive views fed by the same value updates as the Wellbeing panel
 * (see `UIScene.updateHealthBar`/`updateHungerBar`, which drive both in lockstep via {@link setHealth}
 * /{@link setHunger}); the fire + supply readouts own their own `fire:changed`/`supply:changed`
 * handlers here. None of these are interactive, so nothing is registered as a HUD hit element.
 */
export class HudBars {
  private hudHealthBarFg!: Phaser.GameObjects.Rectangle;
  private hudHealthLabel!: Phaser.GameObjects.Text;
  private hudHungerBarFg!: Phaser.GameObjects.Rectangle;
  private hudHungerLabel!: Phaser.GameObjects.Text;
  // Fire-heart fuel bar (plan 038 Step 6) — the campfire's light/life meter, fed by `fire:changed`.
  // Whole group hidden when no hearth exists; orange while lit, dim red when knocked out (fuel 0).
  private hudFireBarFg!: Phaser.GameObjects.Rectangle;
  private hudFireLabel!: Phaser.GameObjects.Text;
  private hudFireGroup: Phaser.GameObjects.Components.Visible[] = [];
  // Base-supply pool readout (plan 042 Step 3) — the shared wood/rock stockpile the companion gathers
  // into / repairs from, fed by `supply:changed`. Always visible (the pool is global); counts, not a
  // bar, so it's a label + value like FIRE/FOOD rather than a scaled meter.
  private hudSupplyWoodLabel!: Phaser.GameObjects.Text;
  private hudSupplyRockLabel!: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene) {
    this.build();
  }

  /**
   * Build the compact top-left HP + food bars: a short text label, a dark-bg / coloured-fg meter, and
   * a value readout overlaid on the fill. They live in the free strip above the queue readout and left
   * of the zoom controls, stay visible in every mode, and are fed by setHealth/setHunger (shared with
   * the Wellbeing panel). Value seeding happens in UIScene, once the panels are built.
   */
  private build(): void {
    const LABEL_X = 8;
    const BAR_X = 40;
    const BAR_W = 96;
    const BAR_H = 9;
    const healthY = 10;
    const hungerY = 21;
    const fireY = 32;

    // Dark bg rect + left-anchored coloured fg (origin 0,0.5 keeps the left edge fixed as scaleX
    // shrinks), plus a centred value label with a black stroke so numbers stay legible over any fill.
    const makeBar = (
      yc: number,
      colour: number,
    ): {
      bg: Phaser.GameObjects.Rectangle;
      fg: Phaser.GameObjects.Rectangle;
      value: Phaser.GameObjects.Text;
    } => {
      const bg = this.scene.add
        .rectangle(BAR_X + BAR_W / 2, yc, BAR_W, BAR_H, 0x2a2a2a)
        .setStrokeStyle(1, 0x000000, 0.5);
      const fg = this.scene.add.rectangle(BAR_X, yc, BAR_W, BAR_H, colour).setOrigin(0, 0.5);
      const value = this.scene.add
        .text(BAR_X + BAR_W / 2, yc, '', {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setStroke('#000000', 2);
      return { bg, fg, value };
    };

    this.scene.add
      .text(LABEL_X, healthY, 'HP', { fontFamily: 'monospace', fontSize: '8px', color: '#e8dcc0' })
      .setOrigin(0, 0.5);
    const health = makeBar(healthY, 0x4caf50);
    this.hudHealthBarFg = health.fg;
    this.hudHealthLabel = health.value;

    this.scene.add
      .text(LABEL_X, hungerY, 'FOOD', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#e8dcc0',
      })
      .setOrigin(0, 0.5);
    const hunger = makeBar(hungerY, 0xd8a24a);
    this.hudHungerBarFg = hunger.fg;
    this.hudHungerLabel = hunger.value;

    // Fire-heart fuel bar (plan 038 Step 6): the campfire's light/life. The whole group hides until a
    // hearth exists (fed null on none) — see onFireChanged. Warm-orange fill, red when knocked out.
    const fireLabel = this.scene.add
      .text(LABEL_X, fireY, 'FIRE', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#e8dcc0',
      })
      .setOrigin(0, 0.5);
    const fire = makeBar(fireY, 0xffb066);
    this.hudFireBarFg = fire.fg;
    this.hudFireLabel = fire.value;
    this.hudFireGroup = [fireLabel, fire.bg, fire.fg, fire.value];
    this.setFireHudVisible(false); // no hearth until one is built / a scenario places it

    // Base-supply pool counts (plan 042 Step 3): the shared wood/rock stockpile below the FIRE bar.
    // Label + value rows (like FIRE/FOOD), not a bar — counts have no max to scale against. Always
    // visible (the pool is global); seeded to 0 here and fed by `supply:changed` (see onSupplyChanged).
    const woodY = fireY + 11;
    const rockY = woodY + 11;
    const countRow = (yc: number, label: string): Phaser.GameObjects.Text => {
      this.scene.add
        .text(LABEL_X, yc, label, { fontFamily: 'monospace', fontSize: '8px', color: '#e8dcc0' })
        .setOrigin(0, 0.5);
      return this.scene.add
        .text(BAR_X, yc, '0', { fontFamily: 'monospace', fontSize: '8px', color: '#e8dcc0' })
        .setOrigin(0, 0.5);
    };
    this.hudSupplyWoodLabel = countRow(woodY, 'WOOD');
    this.hudSupplyRockLabel = countRow(rockY, 'ROCK');
  }

  /** Scale + tint the always-on HP bar and update its label (driven by `UIScene.updateHealthBar`). */
  setHealth(ratio: number, colour: number, text: string): void {
    this.hudHealthBarFg.scaleX = ratio;
    this.hudHealthBarFg.setFillStyle(colour);
    this.hudHealthLabel.setText(text);
  }

  /** Scale + tint the always-on food bar and update its label (driven by `UIScene.updateHungerBar`). */
  setHunger(ratio: number, colour: number, text: string): void {
    this.hudHungerBarFg.scaleX = ratio;
    this.hudHungerBarFg.setFillStyle(colour);
    this.hudHungerLabel.setText(text);
  }

  /** `supply:changed` handler (plan 042 Step 3): render the shared base-supply pool's wood/rock counts. */
  onSupplyChanged(payload: { wood: number; rock: number }): void {
    this.hudSupplyWoodLabel.setText(`${payload.wood}`);
    this.hudSupplyRockLabel.setText(`${payload.rock}`);
  }

  /** Show/hide the whole fire-bar group (label + bg + fg + value) — hidden when there's no hearth. */
  private setFireHudVisible(visible: boolean): void {
    for (const o of this.hudFireGroup) o.setVisible(visible);
  }

  /** `fire:changed` handler (plan 038 Step 6): render the fire-heart fuel bar, or hide it when there's
   *  no hearth. Orange while lit; dim red at 0 (knocked out — dark, but not a loss). */
  onFireChanged(payload: { fuel: number; maxFuel: number; lit: boolean } | null): void {
    if (!payload) {
      this.setFireHudVisible(false);
      return;
    }
    this.setFireHudVisible(true);
    const ratio = Math.max(0, Math.min(1, payload.fuel / payload.maxFuel));
    this.hudFireBarFg.scaleX = ratio;
    this.hudFireBarFg.setFillStyle(payload.lit ? 0xffb066 : 0xc0392b);
    this.hudFireLabel.setText(`${Math.round(payload.fuel)}/${payload.maxFuel}`);
  }
}
