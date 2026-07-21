import Phaser from 'phaser';
import { BASE_WIDTH, BASE_HEIGHT, HOTBAR_SLOTS, INVENTORY_SLOTS } from '../../config';
import { ITEMS } from '../../data/items';
import { iconKey } from '../../data/tileset';
import { Button, Panel, SlotGrid, type SlotData, type SlotVisual } from '../../ui';
import type { HudElement } from './types';

export interface InventoryWidgetDeps {
  /** Register an interactive element in UIScene's world-tap hit-region. */
  addHudElement(...els: HudElement[]): void;
}

/**
 * Inventory (plan 008): an always-visible hotbar (first HOTBAR_SLOTS slots, hidden in combat) plus a
 * button-toggled full grid Panel of all INVENTORY_SLOTS. Both are SlotGrid views over the shared
 * Inventory's slots(), repainted on its 'change' (UIScene fans that into {@link refresh}).
 */
export class InventoryWidget {
  private hotbar!: SlotGrid;
  private inventoryButton!: Button;
  private inventoryPanel!: Panel;
  private inventoryGrid!: SlotGrid;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly deps: InventoryWidgetDeps,
  ) {
    // Inventory toggle — top-right, in the same stack under BUILD (h 26) / CANCEL (h 22). Opens the
    // full grid Panel. Constants mirror the build-column button heights so the stack stays flush.
    const bh = 26;
    const cbh = 22;
    const ibw = 72;
    const ibh = 22;
    this.inventoryButton = new Button(
      this.scene,
      BASE_WIDTH - ibw / 2 - 8,
      8 + bh + cbh + ibh / 2 + 12,
      {
        width: ibw,
        height: ibh,
        label: 'ITEMS',
        fontSize: 10,
        onDown: () => this.toggleInventory(),
      },
    );
    this.deps.addHudElement(this.inventoryButton);

    // Hotbar — always-visible row of the first HOTBAR_SLOTS slots, bottom-centre. Hidden in combat
    // mode (see UIScene.refreshCombatControls) so it never clashes with the movepad/Attack controls.
    this.hotbar = new SlotGrid(this.scene, BASE_WIDTH / 2, BASE_HEIGHT - 70, {
      slotCount: HOTBAR_SLOTS,
      cols: HOTBAR_SLOTS,
    });
    this.deps.addHudElement(this.hotbar);

    // Full inventory — a centred Panel holding a SlotGrid of every slot, toggled by the ITEMS button
    // (and dismissible by tapping it, like the inspect panel). The grid is nested in the Panel so it
    // shows/hides and positions with it.
    this.inventoryPanel = new Panel(this.scene, BASE_WIDTH / 2, BASE_HEIGHT / 2, {
      width: 180,
      height: 172,
      depth: 20,
      dismissible: true,
      onDismiss: () => this.setOpen(false),
    });
    this.inventoryPanel.addText(16, { fontSize: '12px', color: '#e8dcc0' }).setText('INVENTORY');
    this.inventoryGrid = new SlotGrid(this.scene, 0, 14, {
      slotCount: INVENTORY_SLOTS,
      cols: HOTBAR_SLOTS,
    });
    this.inventoryPanel.add(this.inventoryGrid);
    this.deps.addHudElement(this.inventoryPanel);
  }

  /** Resolve an item id to its icon texture key + fallback colour for the slot grids. */
  private readonly itemVisual = (id: string): SlotVisual | undefined =>
    ITEMS[id] ? { iconKey: iconKey(id), color: ITEMS[id].color } : undefined;

  /** Repaint the hotbar + full grid from the shared Inventory's slots. */
  refresh(slots: ReadonlyArray<SlotData>): void {
    this.hotbar.update(slots.slice(0, HOTBAR_SLOTS), this.itemVisual);
    this.inventoryGrid.update(slots, this.itemVisual);
  }

  private toggleInventory(): void {
    this.setOpen(!this.inventoryPanel.visible);
  }

  setOpen(open: boolean): void {
    if (open) this.inventoryPanel.show();
    else this.inventoryPanel.hide();
    this.inventoryButton.setToggled(open);
  }

  /** Show/hide the always-on hotbar (hidden while the fighting controls are up). */
  setHotbarVisible(visible: boolean): void {
    this.hotbar.setVisible(visible);
  }
}
