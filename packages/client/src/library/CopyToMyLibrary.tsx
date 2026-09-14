// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useNavigate } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { uuidv7 } from '@storyengine/shared';

import type { LibraryKind } from '../api.js';
import { useCreateObject } from '../queries.js';
import { Alert } from '../ui/Alert.js';
import { Button } from '../ui/Button.js';

/**
 * *Copy to my library* — [10 §5](../../../../docs/design/10-ui-surfaces.md),
 * [09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md), built at
 * [P7B.0].
 *
 * **The first fork in the application, and it took a phase to become possible
 * rather than to become hard.** The action has been specified since P1 —
 * *"Read-only system objects show a Copy to my library action in place of
 * edit"* — and could not be built, because the system scope was shipped empty
 * and there was nothing in the app to copy. P7B.0 materialises each mode's
 * prompt pack there, so the button now has a subject.
 *
 * **It is also the pinning mechanism**, which is why it matters more than a
 * convenience: [09 §4.3](../../../../docs/design/09-server-multiuser-deployment.md)
 * says *"if you need something never to change, copy it"*. A shipped object is
 * rewritten by the build that ships it; a copy is the user's and no update can
 * reach it.
 *
 * ---
 *
 * **A new id, and nothing else changed.** The copy is the object verbatim with
 * a fresh `uuidv7` — not a re-created object, because `applyForm`'s rule about
 * unknown fields applies with more force here than anywhere: a system object may
 * carry fields this build has never heard of, and a copy that dropped them would
 * be a lossy fork of the thing a user asked to keep exactly.
 *
 * ***What it deliberately does not record, and the reason is not laziness.***
 * [P7B §1.2](../../../../docs/design/workplan/28-p7b-presets-and-prompts.md) wants
 * a fork to eventually say *copied from which object, at which content hash*, so
 * that a later *your copy is behind the shipped one* is answerable — and then
 * says it is **not built here**. `Provenance` has no field for it, `metadata` is
 * an escape hatch rather than a schema, and inventing either shape in the stage
 * that first needs a button is how a format acquires a field nobody designed.
 * So the copy is honest about being a copy and silent about its parent, and the
 * silence is recoverable: the ids and hashes it would have recorded are still
 * on the shipped object, which does not move.
 *
 * **The name is left alone.** A *Scene (copy)* would be this component deciding
 * what the user's object is called, in a build where renaming it means opening
 * the editor the copy exists to make reachable. Two objects may share a name —
 * the slug de-duplicates and nothing resolves by either.
 */
export function CopyToMyLibrary(props: {
  kind: LibraryKind;
  object: Record<string, unknown>;
  className?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const create = useCreateObject();
  const [failed, setFailed] = useState<string | null>(null);

  async function copy(): Promise<void> {
    setFailed(null);
    try {
      const made = await create.mutateAsync({
        kind: props.kind,
        object: { ...props.object, id: uuidv7() },
      });
      // To the copy, not back to the list: the whole point of the action is
      // that the user now has one they can open, and leaving them on the
      // read-only original would make them find it.
      await navigate({ to: '/library/$kind/$id', params: { kind: props.kind, id: made.id } });
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          void copy();
        }}
        disabled={create.isPending}
        {...(props.className === undefined ? {} : { className: props.className })}
      >
        Copy to my library
      </Button>
      {failed === null ? null : <Alert tone="error">{failed}</Alert>}
    </>
  );
}
