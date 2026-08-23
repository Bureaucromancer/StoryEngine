// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// The appearance layer's two bans, one of each. The `+` join is what the
// assembly rule would otherwise report as untranslatable prose — `rounded
// border` is two plain words in a row — with a message about word order that
// has nothing to do with what is wrong.
const SPLIT_CLASS = 'rounded border border-line ' + 'bg-surface px-3 py-2';

const PHYSICAL_CLASS = 'rounded-md border border-line ml-2 px-2';

export function Button() {
  return <button type="button" className={SPLIT_CLASS + PHYSICAL_CLASS} />;
}
