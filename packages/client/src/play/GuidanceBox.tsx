// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * The guidance box — [05 §10](../../../../docs/design/05-ui-surfaces.md), [03 §5.1].
 *
 * **Collapsed by default and empty by default.** It is the supported home for
 * the thing people otherwise do by typing `(OOC: keep this short)` into their
 * action — a habit whose costs all follow from the meta-instruction being
 * *inside the story text*: it lands in history permanently, is summarised as
 * though it were narrative, is scanned by keyword matching, can be read back as
 * dialogue, and appears in exports.
 *
 * So it is its own field all the way down: its own body field on submit, its own
 * preset slot, its own `BlockSource`. Nothing concatenates it into the action.
 *
 * **One-shot**: cleared after the turn it was written for. Standing instructions
 * are a different feature with a different home, and conflating them produces
 * the accumulating meta-instruction this box exists to prevent.
 */
export function GuidanceBox({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">
        Guidance for this turn
      </summary>
      <label className="mt-2 block">
        <span className="sr-only">Guidance for this turn</span>
        <textarea
          className="w-full rounded border border-neutral-700 bg-neutral-900 p-2"
          rows={2}
          value={value}
          disabled={disabled}
          placeholder="Keep this short. Not part of the story."
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </label>
    </details>
  );
}
