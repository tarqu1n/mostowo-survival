import { useState, type ComponentProps } from 'react';

/**
 * A numeric `<input>` you can actually clear and retype.
 *
 * A plain controlled number input bound straight to a clamped value fights you: the moment you
 * delete the last digit the value coerces back to its minimum, so replacing "1" with "3" forces the
 * "type 13, then delete the 1" dance. This keeps a local DRAFT string while focused, so every
 * character can be deleted (the field can sit empty) and the min is only applied once you commit:
 *
 * - While focused it shows your raw keystrokes; an empty field stays empty rather than snapping.
 * - `onValue` fires live for any entry already at/above `min`, so a canvas/preview keeps tracking
 *   keystrokes. An entry BELOW `min` (e.g. a lone "0" in a min-1 field) is held in the draft and
 *   not pushed — the min is enforced on blur, where it commits as the clamped value.
 * - Blurring an empty field pushes nothing, so the value simply reverts to its current one.
 * - Enter blurs (commit), matching the rest of the editor's numeric fields.
 *
 * `value` is the canonical number to display; run whatever additional clamping your state needs
 * inside `onValue` (this component only owns the lower `min` bound + the empty-while-typing state).
 */
export function NumberInput({
  value,
  onValue,
  min,
  onBlur,
  onKeyDown,
  ...rest
}: {
  value: number;
  onValue: (n: number) => void;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null);
  const lo = min === undefined ? -Infinity : Number(min);

  // Commit a raw string to the value, enforcing the lower bound. Empty/non-numeric = no-op (the
  // display reverts to the current `value` when the draft clears on blur).
  const commit = (raw: string): void => {
    if (raw === '') return;
    const n = Number(raw);
    if (Number.isFinite(n)) onValue(Math.max(lo, n));
  };

  return (
    <input
      {...rest}
      type="number"
      min={min}
      value={draft ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        // Live-update only for entries already at/above the min, so a below-min intermediate
        // (a lone "0", or clearing on the way to a new number) never snaps. Blur applies the min.
        if (raw !== '' && Number(raw) >= lo) commit(raw);
      }}
      onBlur={(e) => {
        commit(draft ?? '');
        setDraft(null);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        onKeyDown?.(e);
      }}
    />
  );
}
