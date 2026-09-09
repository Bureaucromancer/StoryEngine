// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * What to call a session nobody has named — [03 §8](../../../../docs/design/03-data-model.md).
 *
 * A session may be started without a name and renamed whenever its owner knows
 * what to call it, so *unnamed* is an ordinary, first-class state rather than a
 * transient one on the way to a real name. That makes a label necessary: a list
 * of blank rows is a list nobody can use, and a `<Link>` whose only child is
 * `''` renders with no accessible name and nothing to click.
 *
 * **The convention is already the app's**, not something invented here. The
 * library renders *Untitled entry*, *Untitled folder*, *Untitled actor* and
 * *Untitled lorebook* for exactly this state, for exactly this reason
 * ([10 §11.1a](../../../../docs/design/10-ui-surfaces.md)): no portable schema constrains a
 * name's length, so `''` validates and stores everywhere. Sessions join that
 * convention rather than getting a second rule of their own.
 *
 * **Nothing underneath this is called *Untitled session*.** It is a label the
 * client puts on an empty string, which is why a rename control must open on
 * the stored name and not on what is displayed — seeding the box with the
 * placeholder is how a placeholder becomes somebody's actual session name on
 * the first Save.
 *
 * The `trim()` is load-bearing rather than defensive tidiness. The route trims
 * what it is sent, but `session.json` is hand-editable by design
 * ([03 §1](../../../../docs/design/03-data-model.md)), so a file with three spaces in its
 * name can reach this function without ever passing through the route that
 * would have cleaned it.
 *
 * When a turn-search surface lands, `TurnHit.sessionName` comes through here
 * too — it is the same denormalised field, and a search result labelled with a
 * blank is the same bug in a different place.
 */
export function sessionLabel(name: string | undefined): string {
  return name === undefined || name.trim() === '' ? 'Untitled session' : name;
}
