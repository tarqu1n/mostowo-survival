import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT } from '../../config';
import { Button, Panel, arrangeColumn } from '../../ui';
import { NPC_MENU_SECTIONS, isNpcMenuOptionActive, type NpcMenuOption } from '../npcMenu';
import type { NpcDayRole, NpcNightPosture } from '../../entities/NpcCharacter';
import type { HudElement } from './types';

export interface NpcAssignMenuDeps {
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
}

/**
 * Companion assignment menu (plan 042 Step 9): a small popover opened by tapping the NPC, with a DAY
 * section (Gather / Repair) and a NIGHT section (Guard here / Follow / Refuel lights). Built from the
 * pure NPC_MENU_SECTIONS model; each row emits a `npc:*` event GameScene routes to the SAME setter
 * path as the `__test` seams. A full-screen dim `npcMenuScrim` behind it both reads as a modal AND —
 * being a visible hudElement — gates every world tap while open (the "open dialog gates the world"
 * convention); tapping the scrim (outside the panel) closes it, as does Escape (UIScene.onEscape).
 */
export class NpcAssignMenu {
  private npcMenu!: Panel;
  private npcMenuScrim!: Phaser.GameObjects.Rectangle;
  private npcMenuButtons: Array<{ option: NpcMenuOption; button: Button }> = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: NpcAssignMenuDeps,
  ) {
    // Scrim: full-viewport, faintly dark, above the other panels (depth 24) but below this menu's
    // panel (25). Interactive so an outside tap closes the menu; visible only while the menu is open,
    // so hudHitTest ignores it otherwise (it never blocks a world tap when the menu is closed).
    this.npcMenuScrim = this.scene.add
      .rectangle(BASE_WIDTH / 2, BASE_HEIGHT / 2, BASE_WIDTH, BASE_HEIGHT, 0x000000, 0.35)
      .setDepth(24)
      .setInteractive()
      .setVisible(false);
    this.npcMenuScrim.on('pointerdown', () => this.close());
    this.deps.addHudElement(this.npcMenuScrim);

    const OPTION_W = 132;
    const OPTION_H = 28;
    const GAP = 6;
    const SECTION_HEADER_H = 18;
    const TITLE_H = 26; // "ASSIGN" band above the first section
    const PAD_X = 12;
    const PAD_BOTTOM = 12;
    const optionCount = NPC_MENU_SECTIONS.reduce((n, s) => n + s.options.length, 0);
    const H =
      TITLE_H +
      NPC_MENU_SECTIONS.length * SECTION_HEADER_H +
      optionCount * (OPTION_H + GAP) +
      PAD_BOTTOM;
    const W = OPTION_W + PAD_X * 2;

    this.npcMenu = new Panel(this.scene, BASE_WIDTH / 2, BASE_HEIGHT / 2, {
      width: W,
      height: H,
      depth: 25,
    });
    this.npcMenu.addText(TITLE_H / 2, { fontSize: '12px', color: '#e8dcc0' }).setText('ASSIGN');

    // Flow from the top edge (panel children are centre-relative, so top = -H/2): a section header
    // then its option buttons, section by section.
    let cursor = TITLE_H;
    for (const section of NPC_MENU_SECTIONS) {
      this.npcMenu
        .addText(cursor + SECTION_HEADER_H / 2, { fontSize: '10px', color: '#9a8f74' })
        .setText(section.title);
      cursor += SECTION_HEADER_H;
      const buttons = section.options.map((option) => {
        const button = new Button(this.scene, 0, 0, {
          width: OPTION_W,
          height: OPTION_H,
          label: option.label,
          fontSize: 11,
          onDown: () => this.onNpcMenuOption(option),
        });
        this.npcMenu.add(button);
        this.npcMenuButtons.push({ option, button });
        return button;
      });
      arrangeColumn(buttons, { x: 0, startY: -H / 2 + cursor, height: OPTION_H, gap: GAP });
      cursor += section.options.length * (OPTION_H + GAP);
    }

    this.deps.addHudElement(this.npcMenu);
  }

  /** GameScene: the NPC was tapped — highlight its live role/posture rows, then anchor the popover near
   *  the sprite's on-screen point (design space, clamped fully on screen) and show it over the scrim. */
  onMenuOpen(payload: {
    x: number;
    y: number;
    dayRole: NpcDayRole;
    nightPosture: NpcNightPosture;
  }): void {
    for (const { option, button } of this.npcMenuButtons) {
      button.setToggled(isNpcMenuOptionActive(option, payload));
    }
    const halfW = this.npcMenu.width / 2;
    const halfH = this.npcMenu.height / 2;
    // Prefer sitting just above the sprite; clamp the whole panel inside the viewport either way.
    const px = Phaser.Math.Clamp(payload.x, halfW + 4, BASE_WIDTH - halfW - 4);
    const py = Phaser.Math.Clamp(payload.y - halfH - 12, halfH + 4, BASE_HEIGHT - halfH - 4);
    this.npcMenu.setPosition(px, py);
    this.npcMenuScrim.setVisible(true);
    this.npcMenu.show();
  }

  /** A menu row was tapped: route to the companion setter it maps to (the shared GameScene path),
   *  then close. Day/night rows assign live; "Guard here" arms the one-tap place-the-point mode. */
  private onNpcMenuOption(option: NpcMenuOption): void {
    if (option.kind === 'dayRole') this.scene.game.events.emit('npc:assignDayRole', option.value);
    else if (option.kind === 'nightPosture')
      this.scene.game.events.emit('npc:assignNightPosture', option.value);
    else this.scene.game.events.emit('npc:beginPlaceGuard');
    this.close();
  }

  /** Hide the popover + its scrim (so hudHitTest stops gating the world). */
  close(): void {
    this.npcMenu.hide();
    this.npcMenuScrim.setVisible(false);
  }

  /** Whether the popover is currently open (ESC-chain query). */
  isOpen(): boolean {
    return this.npcMenu.visible;
  }
}
