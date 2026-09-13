// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { JSX } from 'react';

import type { ModeSurface } from '../api.js';
import { useWriteChannel } from '../queries.js';

/**
 * What a mode asked to have shown, in the region it asked for —
 * [06 §9](../../../../docs/design/06-modes-and-turn-pipeline.md),
 * [10 §8](../../../../docs/design/10-ui-surfaces.md), built at
 * [P7.11](../../../../docs/design/workplan/23-p7-implementation.md).
 *
 * ***This component knows no channel and no mode***, which is the whole of what
 * 10 §8 decides and the same claim `ChannelHud` beside it makes. Extensions do
 * not ship UI; they declare a widget from a versioned vocabulary and the host
 * renders it. **There is no `if (channelId === …)` here and there must never be
 * one** — the day a mode's channel needs special handling in this file is the
 * day the vocabulary was too narrow, and 10 §8's answer is *"ask what widget
 * would let it, and add that."*
 *
 * **A `kind` it does not recognise is skipped, not broken**, and so is a
 * `region`. That is what makes widening either vocabulary additive: a session
 * opened against a newer build renders what this one understands and silently
 * omits the rest, which is the posture the collector takes toward a preset slot
 * kind from the future.
 *
 * **Rendered by the server, down to the value.** A label, a string, a URL or a
 * boolean — never a template, never a media manifest, never a registry. A
 * client that resolved a `MediaSelection` itself would be a second
 * implementation of [04 §3] living in a browser.
 *
 * *Nothing when there is nothing*, which for one region in particular is a
 * requirement rather than tidiness: [10 §2.3] on the backdrop — *"with the
 * backdrop off Play is the surface it was before, not a surface with an empty
 * frame in it. The temptation this feature brings is a placeholder where the
 * picture would go, and there should not be one."*
 */
export function ModeRegion(props: {
  sessionId: string;
  /**
   * ***Handed down rather than read here***, which is not a style preference.
   * The message region renders **once per turn**, so a component that called
   * `useSession` itself would mount one query observer per turn in the
   * transcript — and an observer mounting against stale data refetches, which
   * `PlayPage.test.tsx`'s *does not keep refetching afterwards* caught the
   * moment this was written the other way. One read, many renderings.
   */
  surfaces: readonly ModeSurface[] | undefined;
  region: 'hud' | 'panel' | 'message' | 'stage';
  /**
   * Which scope key to show, for an actor-scoped channel — a sprite beside the
   * line its speaker said. Absent shows every key the region has.
   */
  scopeKey?: string | null;
  className?: string;
}): JSX.Element | null {
  const surfaces = (props.surfaces ?? []).filter(
    (surface) =>
      surface.region === props.region &&
      (props.scopeKey === undefined || surface.scopeKey === props.scopeKey),
  );

  if (surfaces.length === 0) return null;

  const rendered = surfaces
    .map((surface) => ({ surface, node: widgetFor(surface, props.sessionId) }))
    .filter((one) => one.node !== null);

  // Every widget in the region was a kind this build does not know. Rendering
  // an empty wrapper would put a gap in the layout for a feature that is not
  // there — the same reason the filter above is not enough on its own.
  if (rendered.length === 0) return null;

  return (
    <div className={props.className ?? 'flex flex-col gap-2'}>
      {rendered.map((one) => (
        <div key={one.surface.key}>{one.node}</div>
      ))}
    </div>
  );
}

/**
 * One widget, or `null` for an arm this build has not heard of.
 *
 * *A function rather than a component per arm*, because the arms are small and
 * what matters about them is that they are exhaustive and additive — three
 * one-line files would make the skip harder to see, and the skip is the load-
 * bearing part.
 */
function widgetFor(surface: ModeSurface, sessionId: string): JSX.Element | null {
  switch (surface.kind) {
    case 'text':
      return surface.text === undefined ? null : (
        <p className="text-sm text-ink-muted">
          <span className="text-ink-faint">{surface.label}</span> {surface.text}
        </p>
      );

    case 'image':
      return surface.image === undefined ? null : (
        // `alt` from the widget's own label, which is authored content
        // travelling with the mode. An empty alt would make a sprite invisible
        // to a reader who is not looking at it, and a filename would be worse.
        <img
          src={surface.image.url}
          alt={surface.image.alt}
          className="max-w-full rounded-control"
        />
      );

    case 'toggle':
      return <Toggle surface={surface} sessionId={sessionId} />;

    default:
      return null;
  }
}

/**
 * ***The vocabulary's first writable widget***, and the write is the ordinary
 * channel write.
 *
 * A mode gains a control and gains no new authority: `PUT /sessions/:id/
 * channels/:key` already refuses a channel the session's mode does not own, and
 * the channel's own `update` policy still decides whether a person may set it.
 * A toggle over an `engine-computed` channel produces a recorded refusal rather
 * than a change, which is the refusal ladder doing what it is for.
 */
function Toggle(props: { surface: ModeSurface; sessionId: string }): JSX.Element {
  const write = useWriteChannel(props.sessionId);

  return (
    <label className="flex items-center gap-2 text-sm text-ink-muted">
      <input
        type="checkbox"
        checked={props.surface.on ?? false}
        disabled={write.isPending}
        onChange={(event) => {
          write.mutate({ key: props.surface.key, value: event.target.checked });
        }}
      />
      <span>{props.surface.label}</span>
    </label>
  );
}
