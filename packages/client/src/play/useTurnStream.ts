// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { useEffect, useReducer, useRef } from 'react';

import { INITIAL, reduce, type PlayAction, type PlayState } from './reducer.js';
import { openTurnStream } from './stream.js';

/**
 * Subscribes to a session's stream for as long as the surface is on screen.
 *
 * **The reattach-on-reload behaviour lives here and is one line**: the effect
 * opens a stream with no cursor, and the server answers with a snapshot of
 * whatever is happening now — an in-flight turn with its accumulated text, or
 * nothing at all. A client that had to *ask* whether a turn was running, and
 * then decide whether to catch up, would have a race where this has a request.
 */
export function useTurnStream(sessionId: string): {
  state: PlayState;
  dispatch: (action: PlayAction) => void;
} {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  // Held in a ref so the effect below does not re-run when the dispatch
  // identity changes — reopening the socket on every render would be a
  // reconnect loop that looks like a slow server.
  const sink = useRef(dispatch);
  sink.current = dispatch;

  useEffect(() => {
    const handle = openTurnStream(sessionId, {
      onFrame: (frame) => {
        sink.current({ kind: 'frame', frame });
      },
      onReconnecting: () => {
        sink.current({ kind: 'status', status: 'reconnecting' });
      },
      // The class travels — [P6B.0]. It was dropped here, so every fatal close
      // reached the screen as the same sentence whatever had happened.
      onFatal: (error) => {
        sink.current({ kind: 'status', status: 'failed', error });
      },
    });

    return () => {
      handle.close();
    };
  }, [sessionId]);

  return { state, dispatch };
}
