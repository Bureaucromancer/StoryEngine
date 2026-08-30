// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { ImportReport } from '@storyengine/shared';

import { classifyRoot } from './detect.js';
import type { FileSource, SourceRefusal } from './source.js';

/**
 * The entry point the whole phase converges on, declared at P4.0 and filled in
 * at P4.2 ([P4 §2](../../../../docs/design/workplan/06-p4-implementation.md)).
 *
 * **A signature before an implementation, on purpose.** The fixture-pair
 * assertion ([testing §5.1]) is wired as a named CI step in this stage and is
 * *expected to fail* until the converters exist — a gate written after the code
 * is a gate written to pass. Declaring the shape now is what lets that assertion
 * say something specific rather than being a placeholder: it names the function,
 * the arguments and the return, so P4.2's job is to make an existing test go
 * green rather than to invent both halves at once.
 */

export class ImportNotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} lands at P4.2; P4.0 built the seam it plugs into.`);
    this.name = 'ImportNotImplementedError';
  }
}

export interface SweepRequest {
  /** Whose library the objects land in. */
  handle: string;
  /** The root, already opened as a source. Transport is the caller's business. */
  files: FileSource;
}

export type SweepOutcome =
  | { ok: true; report: ImportReport }
  /** Refused before anything was written, which is the only safe way to refuse. */
  | { ok: false; refusal: SourceRefusal };

/**
 * Reads a root and writes what it finds into the library, returning the review.
 *
 * The pre-flight survey is real already, because it is the half that must not
 * wait: a refusal after the first object is written is a half-import, and a
 * half-import is worse than none. What is missing is everything after it.
 */
export async function sweep(request: SweepRequest): Promise<SweepOutcome> {
  const classification = await classifyRoot(request.files);
  if (!classification.ok) {
    return { ok: false, refusal: classification.refusal };
  }

  throw new ImportNotImplementedError(`reading a ${classification.kind} root`);
}
