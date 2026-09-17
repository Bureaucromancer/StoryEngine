// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { labels } from '../i18n/catalogue.js';

/**
 * ***What the assistant can see, worked out from the address*** —
 * [06 §7.4](../../../../docs/design/06-modes-and-turn-pipeline.md)'s *ambient
 * context, disclosed*, [10 §7](../../../../docs/design/10-ui-surfaces.md),
 * [P11.3](../../../../docs/design/workplan/28-p11-implementation.md).
 *
 * §7.4: *"The assistant should know what you are looking at — the actor you have
 * open, the session you were in — or every request starts with the user
 * re-describing their own screen."*
 *
 * ***Derived from the route rather than from a registry every page writes
 * into***, and the difference is who has to remember. A context each surface
 * pushed would be a thing thirty components can forget to do and one can get
 * wrong; the address is already the app's statement of where you are, and it is
 * maintained by the router whether anybody thinks about the assistant or not.
 *
 * **The cost, stated:** what this can say is what the URL says — a kind and an
 * id. The object's *name* comes from whatever the page already loaded, because
 * this file does not fetch: an ambient context that made a request per
 * navigation would be paying for a sentence nobody may ask for.
 */

const WHERE = labels('assistant.where', {
  library: 'the library',
  session: 'a session',
  settings: 'their settings',
  home: 'the home page',
  reading: 'a session, as prose',
  search: 'search results',
});

export interface AmbientContext {
  /** What kind of thing — `actors`, `lorebooks`, `session`. */
  kind: string;
  id: string;
  /** What it is called, when the page knew. */
  name?: string;
  /** Where in the app, in a phrase the prompt can use. */
  where: string;
}

/**
 * The context a path implies, or null where there is nothing to disclose.
 *
 * *Null rather than a vague one.* A person on the settings page is not looking
 * at an object, and *"they are in their settings"* with no object is a sentence
 * that costs tokens on every turn to tell the model something it cannot use.
 */
export function contextFor(pathname: string): AmbientContext | null {
  const library = /^\/library\/([a-z]+)\/([^/]+)/.exec(pathname);
  if (library !== null) {
    return { kind: library[1] ?? '', id: library[2] ?? '', where: WHERE.library };
  }

  const reading = /^\/sessions\/([^/]+)\/read/.exec(pathname);
  if (reading !== null) {
    return { kind: 'session', id: reading[1] ?? '', where: WHERE.reading };
  }

  const session = /^\/sessions\/([^/]+)/.exec(pathname);
  if (session !== null) {
    return { kind: 'session', id: session[1] ?? '', where: WHERE.session };
  }

  return null;
}

/**
 * Whether two contexts say the same thing.
 *
 * *Used to decide whether to write the channel at all.* A channel write is an
 * **effect**, carried by a turn ([06 §4]), so re-writing the same context on
 * every navigation within one object would put a line in the record each time
 * somebody switched tabs. The comparison is the whole of the reason this is a
 * function rather than an inline `!==`.
 */
export function sameContext(left: AmbientContext | null, right: AmbientContext | null): boolean {
  if (left === null || right === null) return left === right;
  return left.kind === right.kind && left.id === right.id && left.name === right.name;
}
