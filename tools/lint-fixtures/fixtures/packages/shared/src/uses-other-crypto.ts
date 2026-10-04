// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

// Every way of reaching a draw that the first selector could not see
// (2026-10-01): through `globalThis.crypto`, through a computed key, through
// a default import under another name, through `webcrypto`, and by
// destructuring an import. Six reports: one per draw, and the `webcrypto`
// line twice — the object it reaches through, and the draw itself.

import nodeCrypto from 'node:crypto';

export const viaGlobalThis = (): string => globalThis.crypto.randomUUID();
export const viaComputed = (): string => crypto['randomUUID']();
export const viaRename = (): number => nodeCrypto.randomInt(6);
export const viaWebcrypto = (bytes: Uint8Array): Uint8Array =>
  nodeCrypto.webcrypto.getRandomValues(bytes);

export async function viaDestructuring(): Promise<number> {
  const { randomInt } = await import('node:crypto');
  return randomInt(6);
}
