# Changelog

Every release tag has an entry here — [releases §7](docs/design/workplan/11-repo-and-releases.md).
The reason is not bookkeeping: [04 §7](docs/design/04-server-multiuser-deployment.md)
makes _what am I running_ a user-facing question rather than a maintainer's one,
and the About surface planned at [P11.6](docs/design/workplan/22-p11-implementation.md)
links here to answer it.

Versions are [semantic](https://semver.org), with the caveat
[releases §7](docs/design/workplan/11-repo-and-releases.md) states plainly: before
1.0 they mean little, and **the data formats carry the real compatibility
story**. Package and card schema versions are independent of the application's
([02 §7](docs/design/02-data-model.md)).

## 0.1.0-alpha.1 — unreleased

**The first build you can go back to.** Until now the only record of a working
state was the commit graph, which makes _the version where lorebooks worked
before I touched the budgeter_ an act of archaeology rather than something you
can run. This is that state, frozen and named.

**It is an artifact, not a distribution.** The repository is private, the
registry package is private, and the unraid template is committed rather than
submitted — so [releases §0](docs/design/workplan/11-repo-and-releases.md)'s
deferral of release engineering to beta stands untouched, and AGPL §13 does not
attach ([P6A §0.1](docs/design/workplan/23-p6a-alpha-1.md)). Nobody else is
running it, which is the property that carries every obligation.

**No compatibility promise between alpha builds.**
[13](docs/design/13-internal-contracts.md) licenses the storage tier to change
without migration for exactly as long as nothing leaves the install. What this
build ships instead of migration machinery is a refusal: a data directory
carries the build that wrote it, and an older build will not open a directory a
newer one has touched
([P6A §1.7](docs/design/workplan/23-p6a-alpha-1.md)).

### Added

- **The server can be told where to bind.** `SE_HOST`, `SE_PORT`, `SE_DATA_DIR`
  and `SE_CLIENT_ROOT` override the config file's defaults, resolved between the
  defaults and the file so a value written in the file still wins. Before this
  the server read one environment variable in the whole codebase and it was
  dev-only, so a container bound its own loopback and was unreachable however
  its port was mapped.
- **The server serves the web client.** `server.clientRoot` points at a built
  client and one process on one port serves both halves. Unset by default:
  development stays two processes with Vite proxying `/api`.
- **A setup token that something checks.** On an install bound beyond loopback
  with no account yet, creating the first administrator requires a token printed
  to the server's console — `docker logs`, for a container. Stored, so a restart
  does not invalidate one you have already copied out.
- **`server.cookieSecure`**, for an install with TLS in front of it. Off by
  default, because plain HTTP on a LAN you trust is supported and a `Secure`
  cookie is not sent back over it.
- **A version and a commit the running server reports**, on
  `GET /api/admin/notices` and on the startup line.
- **A container image, a compose file and an unraid template**, with an on-tag
  workflow that publishes to a private registry. See
  [docs/deploy.md](docs/deploy.md) — starting with the fact that the package is
  private, so nothing pulls until you have logged in.

### Fixed

- Comments in `config.example.json`, `config.ts` and `main.ts` described a
  container that could not have worked. They describe one that can.
