// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import type { BuildInfo } from './build-info.js';
import type { Config } from './config.js';
import type { Connection } from './providers/connections.js';

/**
 * The update check, and the connectivity signal it pays for —
 * [09 §6.5](../../../docs/design/09-server-multiuser-deployment.md),
 * [P10 §1.7](../../../docs/design/workplan/27-p10-implementation.md), [P10.3].
 *
 * ***§1.7 said pick one, and this is the lean it named***: build the check here
 * rather than ship a panel reading a source that is always *unknown*. The two
 * config keys had already shipped ahead of it — `config.ts` marked
 * `updates.checkEnabled` and `updates.channel` `'unread'`, the tier that means
 * *nothing consumes this* — which is *shipping dark by default*, the version
 * §1.7 exists to prevent.
 *
 * ---
 *
 * ## It is an update check, not telemetry
 *
 * [09 §6.5] states this firmly *"because the slide from one to the other is
 * well-trodden and this audience is rightly sensitive to it"*, and the code has
 * to be checkable against it rather than merely intending it:
 *
 * - **A plain GET of a public release feed.** No headers this build invents, no
 *   query parameters, no body. `updates.test.ts` asserts on the whole request,
 *   so anything added to it fails a test that says why.
 * - **Nothing about the install crosses.** No install id, no counts, no
 *   configuration, no anonymised anything — *"anything that would later want to
 *   be added to it is telemetry, and the answer is no."*
 * - **Disableable in one obvious place**, which is `updates.checkEnabled` on the
 *   settings page, and disabled means *no request is made*.
 *
 * ## The connectivity signal, and the distinction §6.5 did not have to make
 *
 * §6.5's observation is right — nearly every install has internet access anyway,
 * because that is where the models are — so a failed check is a free signal that
 * this server is offline. But *failed* is two things, and only one of them is
 * about the network:
 *
 * - **A transport failure** — DNS, TLS, a refused connection, a timeout. Nothing
 *   answered. That is the signal.
 * - **An HTTP answer this build cannot use** — a 404, an empty list, a feed with
 *   no release for the configured channel. ***Something answered, so the
 *   internet demonstrably works***, and reporting *offline* here would be
 *   exactly wrong.
 *
 * **That second case is this project's own present state rather than a
 * hypothetical.** The repository is private and
 * [releases §4](../../../docs/design/workplan/04-repo-and-releases.md) says
 * `latest` *"names nothing and stays that way until a release is actually
 * cut"* — so the default channel has no release to compare against, the feed
 * answers 404, and the honest report is {@link UpdateState} `unknown` with
 * connectivity **fine**. A check that conflated the two would tell every alpha
 * operator their server had no internet.
 */

export type UpdateState =
  /** `updates.checkEnabled` is off. No request is made. */
  | 'disabled'
  /** Never run yet, or the feed had nothing for this channel. Not a fault. */
  | 'unknown'
  /** The newest release for this channel is the one running. */
  | 'current'
  /** There is a newer one. A badge, never a notification — [09 §6.5]. */
  | 'behind'
  /** Nothing answered. **The connectivity signal**, and the only one. */
  | 'unreachable';

export interface UpdateStatus {
  state: UpdateState;
  /** The newest version the feed named for this channel, when it named one. */
  latest: string | null;
  /** When the check last ran, or null if it never has. */
  checkedAt: number | null;
  /**
   * Whether this server could reach the internet at the last check.
   *
   * *Null until a check has run*, which is a third state rather than an
   * optimistic default: *we have not looked* and *we looked and it was fine*
   * are different things to tell an admin.
   */
  online: boolean | null;
}

export const UNCHECKED: UpdateStatus = {
  state: 'unknown',
  latest: null,
  checkedAt: null,
  online: null,
};

/**
 * ***Daily, cached, never on page load*** — [09 §6.5]'s own three words.
 *
 * The cadence is the whole of the privacy posture's practical half: a check per
 * page load would be a request per navigation from every browser on the install,
 * which is a traffic pattern that *looks* like telemetry whatever it carries.
 */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The feed.
 *
 * **A constant rather than a config key**, and the reason is
 * [work plan §2.3]'s: *which server do you ask about updates to this program* is
 * not a question an operator has an opinion about, and a field for it is a field
 * for pointing an install at somebody else's feed. The channel **is**
 * configurable, because that is a choice about what counts as an update.
 */
export const RELEASES_URL = 'https://api.github.com/repos/Bureaucromancer/StoryEngine/releases';

interface FeedEntry {
  tag_name?: unknown;
  prerelease?: unknown;
  draft?: unknown;
}

/**
 * Runs the check once.
 *
 * **Never throws.** It is called from a timer and from a boot path, and an
 * unhandled rejection in either is a process that logs a stack trace about a
 * release feed.
 */
export async function checkForUpdate(
  context: {
    fetch: typeof globalThis.fetch;
    config: Config;
    build: BuildInfo | null;
  },
  now: number = Date.now(),
): Promise<UpdateStatus> {
  if (!context.config.updates.checkEnabled) {
    return { state: 'disabled', latest: null, checkedAt: now, online: null };
  }

  let payload: unknown;
  try {
    /**
     * **The whole request, and there is nothing else in it.** No `user-agent`
     * this build invents, no token, no install id — *"indistinguishable from
     * someone loading the releases page"*. The timeout is here rather than
     * absent because a hung check would hold a timer's callback open for as
     * long as the socket lasted.
     */
    const response = await context.fetch(RELEASES_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      // **Something answered**, so the network is fine and this build simply
      // cannot use the answer — a private repository, or a feed that moved.
      return { state: 'unknown', latest: null, checkedAt: now, online: true };
    }
    payload = await response.json();
  } catch {
    // Nothing answered. This is the signal, and it is the only thing that is.
    return { state: 'unreachable', latest: null, checkedAt: now, online: false };
  }

  const latest = newestFor(payload, context.config.updates.channel);
  if (latest === null) {
    // An empty feed, or none for this channel. The internet works.
    return { state: 'unknown', latest: null, checkedAt: now, online: true };
  }

  const running = context.build?.version ?? null;
  return {
    /**
     * ***`unknown` for an unidentified build, not `behind`.*** A development run
     * has no version ([P6A §1.5] reports that as an absence rather than as
     * `0.0.0`), and telling a developer their working tree is out of date
     * against a release is noise about a comparison that was never meaningful.
     */
    state: running === null ? 'unknown' : compare(latest, running) > 0 ? 'behind' : 'current',
    latest,
    checkedAt: now,
    online: true,
  };
}

/**
 * The newest release the channel admits.
 *
 * `latest` takes released versions only; `testing` and `nightly` take
 * prereleases too, because that is what those channels *are*
 * ([releases §4](../../../docs/design/workplan/04-repo-and-releases.md)) — and
 * an alpha operator following `testing` who was told they were current because
 * the newest thing is a prerelease would be told something false.
 *
 * **Drafts are never taken, on any channel.** A draft is a release nobody can
 * download.
 */
function newestFor(payload: unknown, channel: Config['updates']['channel']): string | null {
  if (!Array.isArray(payload)) return null;

  let best: string | null = null;
  for (const one of payload as FeedEntry[]) {
    if (one.draft === true) continue;
    if (channel === 'latest' && one.prerelease === true) continue;
    const tag = typeof one.tag_name === 'string' ? one.tag_name.replace(/^v/, '') : '';
    if (tag === '') continue;
    if (best === null || compare(tag, best) > 0) best = tag;
  }
  return best;
}

/**
 * Semver-ish comparison, prereleases included.
 *
 * ***Hand-written rather than a dependency***, which is `versionName`'s
 * precedent in `shared`: what has to be ordered is *this project's own tags*,
 * whose shape [releases §7.1](../../../docs/design/workplan/04-repo-and-releases.md)
 * fixes — `1.0.0-alpha.4` and `1.0.0` — and a general semver library is a
 * supply-chain edge for a comparison that is twenty lines.
 *
 * **A prerelease sorts below its own release**, which is the one rule that is
 * not lexical and the one that matters here: `1.0.0-alpha.4` is older than
 * `1.0.0`, and a string compare says the opposite.
 */
export function compare(a: string, b: string): number {
  const [aCore, aPre] = splitVersion(a);
  const [bCore, bPre] = splitVersion(b);

  const byCore = compareParts(aCore.split('.'), bCore.split('.'));
  if (byCore !== 0) return byCore;

  // Neither has a prerelease, or both do; one having one makes it the older.
  if (aPre === bPre) return 0;
  if (aPre === '') return 1;
  if (bPre === '') return -1;
  return compareParts(aPre.split('.'), bPre.split('.'));
}

function splitVersion(version: string): [string, string] {
  const at = version.indexOf('-');
  return at === -1 ? [version, ''] : [version.slice(0, at), version.slice(at + 1)];
}

function compareParts(a: readonly string[], b: readonly string[]): number {
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    const one = a[at] ?? '';
    const two = b[at] ?? '';
    const asNumbers = /^\d+$/.test(one) && /^\d+$/.test(two);
    const order = asNumbers ? Number(one) - Number(two) : one.localeCompare(two);
    if (order !== 0) return order < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Whether any connection points somewhere this server needs the internet for —
 * [09 §6.5]'s conditionality, and *"it must be conditional on configuration, or
 * it nags exactly the wrong people"*.
 *
 * ***A fully local setup is a legitimate, fully-functional deployment, and its
 * operator chose it deliberately.*** Ollama, llama.cpp, an LLM box on the LAN:
 * telling that person their server is broken because it cannot reach a release
 * feed *"would be both wrong and irritating"*.
 *
 * **A connection with no `baseUrl` counts as remote**, because the adapter's
 * own default is `api.openai.com` — an omitted field is the most remote
 * endpoint there is, and reading it as local would silence the warning for the
 * one install that most needs it.
 */
export function needsInternet(connections: readonly Connection[]): boolean {
  return connections.some((one) => !isLocalEndpoint(one.baseUrl));
}

/**
 * Loopback, a private range, or a `.local` name.
 *
 * **Names are not resolved**, deliberately: this runs to decide whether to show
 * a sentence, and a DNS lookup per connection would make a settings read depend
 * on the very network it is asking about. A hostname that is not obviously local
 * is treated as remote, which errs towards *say something* for the case where
 * saying something is useful.
 */
export function isLocalEndpoint(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.trim() === '') return false;

  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    // Not a URL at all. Nothing can be claimed about it, and *remote* is the
    // answer that does not hide a real problem.
    return false;
  }

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  if (host === '::1' || host === '[::1]') return true;
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.')) return true;
  // 172.16.0.0/12 — the range people get wrong by writing `172.*`.
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // Link-local, and the IPv6 unique-local prefix.
  if (host.startsWith('169.254.') || /^\[?f[cd]/.test(host)) return true;
  return false;
}
