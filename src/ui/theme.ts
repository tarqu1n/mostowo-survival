import { COLORS } from '../config';

/**
 * Shared visual tokens for the Phaser UI kit ({@link ./Button}, {@link ./Panel}, and future menus).
 * Centralises the colours / fonts the hand-rolled HUD used to repeat inline, so every button and
 * panel reads as one system and the whole UI look can be retuned from one place. Values are the
 * ones the HUD already shipped with — this is a lift-and-name, not a restyle.
 */
export const UI_FONT = 'monospace';

export const UI_THEME = {
  font: UI_FONT,
  panel: {
    fill: 0x1c1815,
    fillAlpha: 0.92,
    stroke: COLORS.ui,
    strokeAlpha: 0.8,
  },
  /** Default button skin. `fillActive` is the highlight for a toggled-on button. */
  button: {
    fill: 0x3a3730,
    fillActive: 0x5a5140,
    stroke: COLORS.ui,
    strokeAlpha: 0.6,
    text: '#e8dcc0',
    fontSize: 12,
  },
  /** Destructive / attack actions (Cancel, Attack). */
  danger: {
    fill: 0x3a2a2a,
    stroke: 0xb23b3b,
    strokeAlpha: 0.6,
    text: '#e8c0c0',
  },
  /** Debug / dev-only affordances. */
  olive: {
    fill: 0x2f3b26,
    stroke: 0x6f8a5a,
    strokeAlpha: 0.8,
    text: '#b9d29a',
  },
  /** Alpha applied to a dimmed (unaffordable / clamped) control. */
  disabledAlpha: 0.4,
} as const;

export type ButtonVariant = 'default' | 'danger' | 'olive';
