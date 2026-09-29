// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { MessagePart } from '@storyengine/shared';

import type { ProviderCapabilities, RenderedMessage } from '../providers/types.js';
import type { AssembledBlock } from './types.js';

/**
 * Step 4 — blocks become provider messages
 * ([06 §5](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [21 §2](../../../../docs/design/21-internal-contracts.md)).
 *
 * **The only place that knows what a chat API looks like.** That is what makes
 * [19 §5.5](../../../../docs/design/19-tech-stack.md)'s chat-only decision cheap
 * to unmake: a completion renderer would be a second implementation of this one
 * function, not a rewrite, because the core representation stays structured.
 *
 * It carries one decision worth naming: **adjacent blocks with the same role**.
 * Six consecutive `system` blocks are one message or six, providers differ, and
 * some reject the unmerged form outright — so it is a provider capability
 * rather than a global choice. SillyTavern ships `squash_system_messages` as a
 * user-facing setting, which is what a project does after discovering the
 * answer varies by endpoint.
 *
 * Two rules follow, and both are load-bearing:
 *
 * - **Merging is the last step**, after budgeting. The verdict is per block and
 *   must stay so.
 * - **A merged message is never re-split.** If a provider changes its mind the
 *   next assembly renders differently; the record shows what was actually sent.
 */

export interface RenderOptions {
  /** Only `mergeSameRole` is read, but the whole record is the honest input. */
  capabilities: Pick<ProviderCapabilities, 'mergeSameRole'>;
  /** What joins two merged blocks. A blank line, unless a mode says otherwise. */
  separator?: string;
}

/**
 * Renders the included blocks.
 *
 * Dropped blocks are on the record and not in the request — which is the whole
 * point of the verdict being separate from the messages.
 */
export function render(
  blocks: readonly AssembledBlock[],
  options: RenderOptions,
): RenderedMessage[] {
  const included = blocks.filter((block) => block.included);
  const messages: RenderedMessage[] = [];
  const separator = options.separator ?? '\n\n';

  for (const block of included) {
    const previous = messages.at(-1);
    const mergeable =
      options.capabilities.mergeSameRole !== 'never' && previous?.role === block.role;

    if (mergeable) {
      previous.content = `${previous.content}${separator}${block.text}`;
      // **The requirement merging must not break.** The workbench maps every
      // sent byte back to the block that produced it, and a merge that
      // concatenated six blocks into one string without recording which six
      // would destroy that mapping quietly — noticeable only when somebody is
      // already debugging.
      previous.fromBlocks.push(block.id);
      appendParts(previous, `${separator}${block.text}`, block);
      continue;
    }

    const message: RenderedMessage = {
      role: block.role,
      content: block.text,
      fromBlocks: [block.id],
    };
    appendParts(message, block.text, block);
    messages.push(message);
  }

  return messages;
}

/**
 * Keeps a message's ordered parts, once it has a picture in it — [25 E15].
 *
 * ***The text parts joined are always `content`***, which is the property that
 * keeps `content` the frozen contract's whole text rendering: a message only
 * grows `parts` at its first sent picture, and it is seeded then with the text
 * it already had, so nothing that went before is lost from the ordering. After
 * that every block's text is appended as it is to `content` — separator and
 * all — and a sent picture follows the words that introduce it.
 */
function appendParts(message: RenderedMessage, text: string, block: AssembledBlock): void {
  const sent =
    block.image?.sent === true && block.image.digest !== null && block.image.mime !== null;
  if (message.parts === undefined && !sent) return;

  // Seeded with everything but this block's text, which is appended below.
  const parts: MessagePart[] = message.parts ?? [
    { kind: 'text', text: message.content.slice(0, message.content.length - text.length) },
  ];
  const last = parts.at(-1);
  if (last?.kind === 'text') last.text = `${last.text}${text}`;
  else parts.push({ kind: 'text', text });

  if (sent && block.image?.digest != null && block.image.mime != null) {
    parts.push({
      kind: 'image',
      blockId: block.id,
      digest: block.image.digest,
      mime: block.image.mime,
    });
  }
  message.parts = parts.filter((part) => part.kind !== 'text' || part.text !== '');
}
