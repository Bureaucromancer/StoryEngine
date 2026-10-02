// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useRef, type RefObject } from 'react';

/**
 * ***A control that reveals a field puts the keyboard in it*** (2026-10-01,
 * polish 10).
 *
 * Three controls in the client reveal a box to type into — the shelf's
 * *Search*, a session's *Rename*, a tag's *Rename* — and each left the keyboard
 * where it was: on the button that had just been replaced, which drops focus
 * to the page, or on a button far from a prompt that opened below a long
 * table. A person who pressed *Search* and started typing typed into nothing.
 *
 * The ref goes on a container rather than on the input because the field is
 * `Field`, which owns its control and its label, and a container's first
 * control is the field it was revealed for. On the flip from hidden to shown,
 * and only then: a field that is already open is somebody's to move out of.
 * **A string is what the field was revealed for**, so a prompt that moves from
 * one thing to another without closing — the tag manager's rename, pressed on a
 * second row — is a second reveal.
 */
export function useFocusOnReveal<T extends HTMLElement>(
  revealed: boolean | string | null,
): RefObject<T | null> {
  const container = useRef<T>(null);
  useEffect(() => {
    if (!revealed) return;
    container.current?.querySelector<HTMLElement>('input, textarea, select')?.focus();
  }, [revealed]);
  return container;
}
