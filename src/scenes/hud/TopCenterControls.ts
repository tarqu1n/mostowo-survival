import Phaser from 'phaser';
import { BASE_WIDTH, DEFAULT_ZOOM, ZOOM_STEP, MIN_ZOOM, MAX_ZOOM } from '../../config';
import { Button } from '../../ui';
import type { HudElement } from './types';

export interface TopCenterControlsDeps {
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
}

/**
 * The top-centre HUD stack: the zoom controls ([−] 100% [+]), the FOLLOW button just below them, and
 * the passive day/night readout + night-wave banner under those. Zoom/follow only emit deltas +
 * mirror the value back (GameScene owns the camera); the day/night readout is seeded from the registry
 * and kept in sync by UIScene.onTimeChanged → {@link setTime}. The two text readouts are passive (not
 * registered as hit elements); the zoom + follow buttons are.
 */
export class TopCenterControls {
  private zoomText!: Phaser.GameObjects.Text;
  private zoomOutButton!: Button;
  private zoomInButton!: Button;
  private followButton!: Button;
  private timeText!: Phaser.GameObjects.Text;
  private waveText!: Phaser.GameObjects.Text;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: TopCenterControlsDeps,
  ) {
    // Zoom controls — top-center: [−] 100% [+]. GameScene owns the actual camera zoom (and the
    // pinch-gesture path to it); this only emits deltas + mirrors the current value back as text.
    const zbSize = 24;
    const zGap = 34;
    const zY = 8 + zbSize / 2;
    this.zoomOutButton = new Button(this.scene, BASE_WIDTH / 2 - zGap, zY, {
      width: zbSize,
      height: zbSize,
      label: '−',
      fontSize: 16,
      onDown: () => this.scene.game.events.emit('zoom:delta', -ZOOM_STEP),
    });
    const initialZoom = (this.scene.registry.get('zoom') as number | undefined) ?? DEFAULT_ZOOM;
    this.zoomText = this.scene.add
      .text(BASE_WIDTH / 2, zY, `${Math.round(initialZoom * 100)}%`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5);
    this.zoomInButton = new Button(this.scene, BASE_WIDTH / 2 + zGap, zY, {
      width: zbSize,
      height: zbSize,
      label: '+',
      fontSize: 16,
      onDown: () => this.scene.game.events.emit('zoom:delta', ZOOM_STEP),
    });
    this.deps.addHudElement(this.zoomOutButton, this.zoomInButton);
    this.updateZoomButtons(initialZoom);

    // Follow button — grouped with zoom (top-center, just below it): snaps the camera back to the
    // player and re-engages the follow-lock a manual drag (GameScene.onPointerMove) breaks. Teal
    // fill while locked on.
    const fbh = 22;
    const initialFollowing = (this.scene.registry.get('following') as boolean | undefined) ?? true;
    this.followButton = new Button(this.scene, BASE_WIDTH / 2, zY + zbSize / 2 + 6 + fbh / 2, {
      width: 64,
      height: fbh,
      label: 'FOLLOW',
      fontSize: 10,
      activeFill: 0x2f4a45,
      onDown: () => this.scene.game.events.emit('camera:center'),
    }).setToggled(initialFollowing);
    this.deps.addHudElement(this.followButton);

    // Day/night readout — passive (not interactive, not a hit element), top-centre just below the
    // zoom/follow stack. ASCII form (not the ☀/☾ glyphs) to avoid tofu boxes at 12px in the monospace
    // HUD font. Seeded from the registry (GameScene seeds 'dayPhase'/'dayCount' in its own create());
    // kept in sync via 'time:changed' → setTime.
    const initialPhase =
      (this.scene.registry.get('dayPhase') as 'day' | 'night' | undefined) ?? 'day';
    const initialDayCount = (this.scene.registry.get('dayCount') as number | undefined) ?? 1;
    this.timeText = this.scene.add
      .text(
        BASE_WIDTH / 2,
        zY + zbSize / 2 + 6 + fbh + 10,
        `Day ${initialDayCount} [${initialPhase}]`,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#e8dcc0',
        },
      )
      .setOrigin(0.5);

    // Night/wave indicator (plan 038 Step 6) — a small red banner just under the day/night readout,
    // shown while a wave is on (the night phase). Passive; toggled in setTime.
    this.waveText = this.scene.add
      .text(BASE_WIDTH / 2, this.timeText.y + 13, 'NIGHT WAVE', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e5533a',
      })
      .setOrigin(0.5)
      .setVisible(initialPhase === 'night');
  }

  onZoomChanged(zoom: number): void {
    this.zoomText.setText(`${Math.round(zoom * 100)}%`);
    this.updateZoomButtons(zoom);
  }

  /** Dim a zoom button once its direction is exhausted (mirrors the Build button's afford-dimming). */
  private updateZoomButtons(zoom: number): void {
    this.zoomOutButton.setDimmed(zoom <= MIN_ZOOM);
    this.zoomInButton.setDimmed(zoom >= MAX_ZOOM);
  }

  onFollowChanged(following: boolean): void {
    this.followButton.setToggled(following);
  }

  /** Keep the passive day/night readout + wave banner in sync with GameScene's clock. */
  setTime(phase: 'day' | 'night', dayCount: number): void {
    this.timeText.setText(`Day ${dayCount} [${phase}]`);
    // Night/wave indicator (plan 038 Step 6): a wave runs the whole night, so show it during night.
    this.waveText.setVisible(phase === 'night');
  }
}
