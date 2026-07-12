/**
 * Phaser UI kit — small, Container-based primitives for the HUD and menus. Build new panels
 * (inventory, build palette) from these instead of hand-placing rectangles + text. See the
 * per-file docs; the HUD (`src/scenes/UIScene.ts`) is the first consumer.
 */
export { Button } from './Button';
export type { ButtonConfig } from './Button';
export { Panel } from './Panel';
export type { PanelConfig } from './Panel';
export { SlotGrid } from './SlotGrid';
export type { SlotGridConfig, SlotData, SlotVisual, SlotVisualLookup } from './SlotGrid';
export { UI_THEME, UI_FONT } from './theme';
export type { ButtonVariant } from './theme';
export { arrangeRow, arrangeColumn, arrangeGrid } from './layout';
