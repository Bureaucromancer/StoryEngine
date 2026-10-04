// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * A notification as the client sees it — [22 §8](../../../../docs/design/22-internal-contracts.md),
 * [P10.2].
 *
 * **Declared here rather than imported from `@storyengine/shared`**, which is
 * the same choice `ImportItem` makes in `api.ts` and for the same reason: a
 * notification is not a portable object, so it has no business in the package
 * that owns those. What crosses is a JSON shape, and this is the client's
 * reading of it.
 *
 * *`class` is a bare `string` rather than the server's union*, deliberately. A
 * newer server can send a class this build has never heard of, and the honest
 * rendering is [`summary()`](./labels.js)'s fallback rather than a type error
 * at a boundary that cannot enforce it anyway.
 */
export interface NotificationView {
  id: string;
  class: string;
  actionable: boolean;
  params: Record<string, string | number | boolean>;
  sessionId: string | null;
  turnId: string | null;
  /** How many arrivals this row stands for. One unless something coalesced. */
  folded: number;
  createdAt: number;
  updatedAt: number;
  readAt: number | null;
}

export interface NotificationList {
  notifications: NotificationView[];
  unread: number;
  /**
   * The server's clock when a stream's snapshot was read — absent on the list
   * route, which nothing announces from. See `useNotifications`' `onSnapshot`.
   */
  at?: number;
}
