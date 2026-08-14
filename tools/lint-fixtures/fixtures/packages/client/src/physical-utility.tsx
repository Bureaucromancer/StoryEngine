// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

declare function clsx(...parts: string[]): string;
declare const wide: boolean;

// One report per className expression, not per offending class — so each form
// under test gets its own element.
export function Bad() {
  return (
    <div>
      <span className="ml-4">plain literal</span>
      <span className="border-l-2 text-left">several in one literal</span>
      <span className={clsx('pr-2')}>literal inside a helper call</span>
      <span className={`float-right ${wide ? 'w-full' : ''}`}>template literal</span>
      <span className="md:hover:rounded-r-lg">behind variant prefixes</span>
    </div>
  );
}
