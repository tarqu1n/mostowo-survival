import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, COLORS, RENDER_SCALE } from '../../config';
import { Button } from '../../ui';
import type { HudElement } from './types';

export interface CombatControlsDeps {
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
}

/**
 * Combat mode controls (plan 035a Step 2): a left-thumb virtual movepad + a right-thumb action
 * cluster (Melee + Bow, with a reserved-but-disabled Spell slot — the cluster is designed to grow).
 * The movepad is a bespoke joystick (drag tracked here, not GameScene, via scene-level
 * pointermove/up gated by which pointer id pressed the base — GameScene only needs the resulting
 * normalized {dx, dy}); the cluster buttons are kit Buttons. UIScene owns the show/hide predicate
 * (see `refreshCombatControls`), calling {@link setControlsVisible}.
 */
export class CombatControls {
  private movepadBase!: Phaser.GameObjects.Arc;
  private movepadKnob!: Phaser.GameObjects.Arc;
  private readonly movepadCenter = { x: 60, y: 540 };
  private readonly movepadRadius = 40;
  private movepadPointerId: number | null = null;
  private combatMeleeButton!: Button;
  private combatBowButton!: Button;
  private combatSpellButton!: Button;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: CombatControlsDeps,
  ) {
    // Combat mode controls — hidden until shown (UIScene.refreshCombatControls). The movepad stays a
    // bespoke joystick; only the cluster comes from the kit.
    this.movepadBase = this.scene.add
      .circle(this.movepadCenter.x, this.movepadCenter.y, this.movepadRadius, 0x3a3730, 0.4)
      .setStrokeStyle(1, COLORS.ui, 0.6)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.movepadKnob = this.scene.add
      .circle(this.movepadCenter.x, this.movepadCenter.y, 14, COLORS.ui, 0.85)
      .setVisible(false);
    this.movepadBase.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.movepadPointerId = pointer.id;
      this.updateMovepad(pointer);
    });
    this.deps.addHudElement(this.movepadBase);

    // Right-thumb action cluster, stacked bottom-right: Melee (primary, bottom) → Bow → Spell
    // (reserved, dimmed + no handler). Hidden until shown (UIScene toggles all three).
    const clw = 70;
    const clh = 38;
    const clGap = 6;
    const clx = BASE_WIDTH - 8 - clw / 2;
    // Stack up from just above the bottom-right DEV button (dbh 24 + 8 margin) so MELEE never sits
    // under it — the cluster keeps the right-thumb corner without the dev toggle stealing its taps.
    const meleeY = BASE_HEIGHT - 8 - 24 - 6 - clh / 2;
    const bowY = meleeY - clh - clGap;
    const spellY = bowY - clh - clGap;
    this.combatMeleeButton = new Button(this.scene, clx, meleeY, {
      width: clw,
      height: clh,
      label: 'MELEE',
      variant: 'danger',
      onDown: () => this.scene.game.events.emit('combat:attack'),
    }).setVisible(false);
    this.combatBowButton = new Button(this.scene, clx, bowY, {
      width: clw,
      height: clh,
      label: 'BOW',
      onDown: () => this.scene.game.events.emit('combat:bow'),
    }).setVisible(false);
    // Reserved Spell slot — present so the cluster visibly has room to grow, but disabled this MVP:
    // dimmed and wired to no handler (a tap is a no-op). Filled in post-MVP.
    this.combatSpellButton = new Button(this.scene, clx, spellY, {
      width: clw,
      height: clh,
      label: 'SPELL',
      fontSize: 9,
    })
      .setDimmed(true)
      .setVisible(false);
    this.deps.addHudElement(this.combatMeleeButton, this.combatBowButton, this.combatSpellButton);

    // Movepad drag tracking: scoped to whichever pointer id pressed the base, so a second finger
    // (e.g. a pinch-zoom on GameScene) doesn't hijack it.
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.movepadPointerId) this.updateMovepad(pointer);
    });
    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.movepadPointerId) return;
      this.movepadPointerId = null;
      this.movepadKnob.setPosition(this.movepadCenter.x, this.movepadCenter.y);
      this.scene.game.events.emit('combat:moveEnd');
    });
  }

  /** Show/hide the movepad + action cluster. On hide, release any live drag and recentre the knob
   *  (UIScene owns the hotbar/inventory side of the reveal — see refreshCombatControls). */
  setControlsVisible(show: boolean): void {
    this.movepadBase.setVisible(show);
    this.movepadKnob.setVisible(show);
    this.combatMeleeButton.setVisible(show);
    this.combatBowButton.setVisible(show);
    this.combatSpellButton.setVisible(show);
    if (!show) {
      this.movepadPointerId = null;
      this.movepadKnob.setPosition(this.movepadCenter.x, this.movepadCenter.y);
    }
  }

  /** True while a finger is held on the movepad (any pointer id — the pad tracks by id, so this is
   *  reliable even when the pinch-count heuristic in PointerInputController undercounts a 3rd pointer). */
  isHeld(): boolean {
    return this.movepadPointerId !== null;
  }

  /** Drag the movepad knob toward the pointer (clamped to the base radius) and emit the
   * normalized {dx, dy} vector for GameScene to drive the player's velocity directly. */
  private updateMovepad(pointer: Phaser.Input.Pointer): void {
    // Raw pointer coords are backing-store px (device-scaled); the movepad geometry is design-space.
    const dx = pointer.x / RENDER_SCALE - this.movepadCenter.x;
    const dy = pointer.y / RENDER_SCALE - this.movepadCenter.y;
    const dist = Math.min(this.movepadRadius, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    this.movepadKnob.setPosition(
      this.movepadCenter.x + Math.cos(angle) * dist,
      this.movepadCenter.y + Math.sin(angle) * dist,
    );
    const norm = dist / this.movepadRadius;
    this.scene.game.events.emit('combat:move', {
      dx: Math.cos(angle) * norm,
      dy: Math.sin(angle) * norm,
    });
  }
}
