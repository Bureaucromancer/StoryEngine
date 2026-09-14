// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { FastifyInstance } from 'fastify';

import { requireAccount } from '../app.js';
import { DEFAULT_MODE_ID, modeById, presentMode, registeredModes } from '../mode-registry.js';

/**
 * What this install can play — [10 §8](../../../../docs/design/10-ui-surfaces.md),
 * [P7.4](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * **The route [P7.4]'s cell records as missing**, and it is missing in a wider
 * sense than the wizard: `registeredModes()` had no production reader at all, so
 * until now a client could not name the modes it was choosing between. The
 * session form offered *the mode's own preset* and had nothing to say about
 * modes.
 *
 * **It is what makes the stage's exit line possible.** *A wizard for a mode the
 * engine has no knowledge of, rendered from its declaration alone* requires the
 * declaration to reach the browser, and this is the only thing that carries it.
 * A client that knew about modes by having them compiled in would be the
 * hard-coded screen [06 §2] refuses.
 *
 * **Signed in, and not admin.** Which modes exist is not a secret and not an
 * operator's business: it is the vocabulary of the thing a person is about to
 * do. `requireAccount` rather than nothing at all, because a fresh install
 * answers `503 setup-required` for everything until an account exists and this
 * should not be the one exception.
 *
 * *No caching headers and no ETag. Modes are registered at startup and never
 * change while the process lives, but an extension host that installs one
 * mid-run is [P7.8]'s and a cache a later stage has to remember to invalidate is
 * worse than a read of a `Map`.*
 *
 * *No `services`, which is why the signature differs from every other
 * `register*Routes` in this directory: the registry is process-wide state
 * installed by the composition root, not a service handed to it. Taking one for
 * symmetry would be a parameter that documents a dependency that does not
 * exist.*
 */
export function registerModeRoutes(app: FastifyInstance): void {
  app.get('/modes', async (request, reply) => {
    if (!(await requireAccount(request, reply))) return;

    /**
     * **`defaultModeId` travels, because the client cannot know it and must
     * not guess** — [P7.4].
     *
     * `POST /api/sessions` plays the default when `mode` is absent, and a form
     * that fell back to *the first mode in the list* would render one mode's
     * wizard and create a session on another the moment registration order
     * stopped matching. Registration order is `installBuiltIns`' business, not a
     * contract.
     */
    return reply.send({
      modes: registeredModes().map(presentMode),
      defaultModeId: DEFAULT_MODE_ID,
    });
  });

  /**
   * One mode, by id — and a 404 rather than a fallback.
   *
   * The runner falls back to the default for a session *already playing* a mode
   * this build does not know, because that is somebody's story and it should
   * still open ([00 §3.3]). Asking about a mode by name is a different
   * question: answering with a different mode's declaration would render a
   * wizard for a mode the person is not choosing.
   */
  app.get('/modes/:modeId', async (request, reply) => {
    if (!(await requireAccount(request, reply))) return;

    const { modeId } = request.params as { modeId: string };
    const mode = modeById(modeId);
    if (mode === null) {
      return reply.code(404).send({ error: 'unknown-mode', message: 'No such mode.' });
    }
    return reply.send({ mode: presentMode(mode) });
  });
}
