// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import { ChatSettingsPanel } from '../../play/ChatSettingsPanel.js';
import { DialPanel } from '../../play/DialPanel.js';
import { LorePanel } from '../../play/LorePanel.js';
import { isSwitch, ModeActions, ModeRegion } from '../../play/ModeRegion.js';
import { SessionPanel } from '../../play/SessionPanel.js';
import { useLiveTurn, useSession } from '../../queries.js';

/**
 * ***How this session is set up*** — the play subject's first section,
 * 2026-10-13, [P12A](../../../../../docs/design/workplan/35-p12a-the-look.md)
 * P12A.5, under the decisions its §0.4 records.
 *
 * **What is here is what the play column held that is not a fact about the
 * story now.** The stage sorted every block above the prose by one rule: a
 * fact about *the story right now* stays on Play, in the strip; a fact about
 * *how this session is configured* comes here. So: how a chat plays (and the
 * mode's own settings, its *Agents*, which that panel holds), what the session
 * retrieves from, its pack and its parameters with the verbs that panel
 * carries — read it, export it, archive it, delete it, update it from its
 * source, its memories and its pictures — the two dials, what a person may run
 * between turns, and the switches a mode put in its `panel` region
 * (`isSwitch`). The cast, the goal, the hooks and a mode's readings are the
 * strip's; the stage record in [P12A §2](../../../../../docs/design/workplan/35-p12a-the-look.md)
 * says where each block went and why.
 *
 * **Reused, not rewritten.** Each panel is the component the column drew, with
 * the props it had, in the order it had them — and each reads the session
 * through `useSession`, the key Play holds, so drawing them here issues no new
 * request for the session and a write in one refreshes the other. The order's
 * reasons travel with the panels: lore before the pack because it is the one
 * reached for more often, a mode's additions after the engine's own.
 *
 * ***What moved with them, and what did not.*** `ModeActions` waited on
 * `running || send.isPending` in the column; the dock cannot see the composer,
 * so it waits on the live turn the page mirrors into the cache, which covers a
 * turn from its stream's first frame. A run asked for in the moment before
 * that is the route's to refuse as `busy`, and the actions say a refusal in
 * their own words (`WriteFailed`). *The dials lose their neighbour*: the third
 * dial, hook pacing, is in the strip's hook item, so the three are no longer
 * a line apart; [06 §7.3.2]'s argument for reading them together is now a
 * sentence in the guide rather than a layout.
 *
 * **It writes**, which is what makes the play subject [10 §3]'s second that is
 * not a reader; that section's dated note and its new subsection say why that
 * is a definition rather than an exception.
 */
export function SessionSection({
  sessionId,
  block,
}: {
  sessionId: string;
  /** `?block=` — a block of the session's pack to open the editor on ([P7B.4]). */
  block: string | undefined;
}): JSX.Element {
  const session = useSession(sessionId);
  const live = useLiveTurn(sessionId);
  const running = live.data?.live?.state === 'running';
  const switches = (session.data?.surfaces ?? []).filter(isSwitch);

  return (
    <div className="flex flex-col gap-3">
      <ChatSettingsPanel sessionId={sessionId} />
      <LorePanel sessionId={sessionId} />
      <SessionPanel sessionId={sessionId} {...(block === undefined ? {} : { block })} />
      <DialPanel sessionId={sessionId} />
      <ModeActions sessionId={sessionId} actions={session.data?.actions} busy={running} />
      <ModeRegion sessionId={sessionId} surfaces={switches} region="panel" />
    </div>
  );
}
