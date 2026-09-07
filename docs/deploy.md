# Running a built StoryEngine

**Status: as built at P6A.4.** This describes the image, the compose file and the
unraid template that [P6A](design/workplan/23-p6a-alpha-1.md) ships — what exists,
not what is planned.

**Alpha 1 is a build this project made for itself.** The repository is private,
the registry package is private, and the unraid template is committed rather than
submitted. That is a deliberate position rather than a stage on the way to
something: publishing the image is a decision to publish the repository at the
same instant, because AGPL §13's source link has to resolve for whoever is
running it ([04 §7](design/04-server-multiuser-deployment.md)). See
[P6A §4](design/workplan/23-p6a-alpha-1.md) for what else travels with that
decision.

So the first thing to know is that **the package will not pull until you are
logged in**:

```bash
docker login ghcr.io          # a token that can read packages
docker compose up -d
```

Without it, the pull fails with a 404 that reads like a typo in the image name.

---

## First run

The container binds `0.0.0.0`, because a container's own `127.0.0.1` is its own
loopback and would be unreachable however you mapped the port
([04 §5.3](design/04-server-multiuser-deployment.md)). That is done by setting
`SE_HOST` — the same variable a bare-metal install would use, not a different
build ([P10 §1.2](design/workplan/21-p10-implementation.md)) — so you can read it
in the Dockerfile and override it.

Binding beyond loopback means the create-the-first-admin screen is reachable from
your network the moment the container starts, so **it asks for a setup token**:

```bash
docker compose logs storyengine | grep 'setup token'
```

The line is written on every start until an administrator exists, and it ends
with the token. The token is also kept in the volume, at `state/setup.token`,
so a container recreated while you were reading its log has not lost it: read
the file, or start it again and read the line. The setup form says so too,
under the token field. It is required only until an administrator exists;
after that the field is gone and the file is inert.

The console is the channel on purpose. Only somebody with host access reads it,
and that is exactly the audience entitled to claim an unclaimed install
([04 §5.1](design/04-server-multiuser-deployment.md)).

## The volume

Everything the install is — accounts, library, sessions, `config.json` — is under
`/data` ([02 §5](design/02-data-model.md)). Back that up; there is nothing else
to back up.

`compose.yaml` uses a named volume because the container runs as uid 1000 and a
**bind-mounted host directory owned by root fails to write**. Docker creates a
missing bind-mount source as root, and Alpha 1's first install met that as an
`EACCES` stack trace out of `mkdir /data/state`; the server now refuses in one
line that names the directory, the uid it runs as and the fix. If you want a
bind mount, make the directory writable by that uid first — once, on the host:

```bash
mkdir -p /srv/storyengine && chown 1000:1000 /srv/storyengine
```

## Configuration

Four settings can be given as environment variables, because they are the ones
needed before the config file can be read — the file lives *inside* the data
directory, which is empty on a first run:

| Variable          | Sets                | In the image     |
| ----------------- | ------------------- | ---------------- |
| `SE_DATA_DIR`     | `dataDir`           | `/data`          |
| `SE_HOST`         | `server.host`       | `0.0.0.0`        |
| `SE_PORT`         | `server.port`       | `8080`           |
| `SE_CLIENT_ROOT`  | `server.clientRoot` | `/app/client`    |

Everything else is `config.json` in the volume, or the settings page. **The file
wins over the environment**, because the file is what the settings page writes:
changing a value in the UI and finding a variable had outranked it would be a bug
([13 §4](design/13-internal-contracts.md)). The server logs a warning when a
variable is set and the file speaks for the same key.

**There is no HTTPS.** On a LAN it cannot be done well without a real domain or a
private CA, and self-signed certificates train people to click through warnings.
Put a reverse proxy in front if you want TLS, and then set `server.trustProxy`
and `server.cookieSecure` in `config.json` — both default to off, and
`cookieSecure` without TLS in front makes signing in fail silently, because a
`Secure` cookie is never sent back over plain HTTP.

## What this build is

The running server reports its version and commit on the startup line, on
`GET /api/auth/state` and `GET /api/admin/notices`, and in the UI — the footer
on every page names the build (*1.0-alpha 2*), and the About block at the top
of Settings adds the string and the commit:

```bash
docker compose logs storyengine | head -n 5
```

**An older build will not open a data directory a newer one has written.** It
refuses and says both versions; it does not migrate. There is no compatibility
promise between alpha builds — [13](design/13-internal-contracts.md) licenses the
storage tier to change without migration for as long as nothing leaves the
install, and nothing does ([P6A §1.7](design/workplan/23-p6a-alpha-1.md)).

## unraid

`deploy/unraid/storyengine.xml` is a template you can drop into
`/boot/config/plugins/dockerMan/templates-user/`. It declares the port, the
`/data` volume, the WebUI address and the bind variable, and its description
opens by saying the package is private — because a template that only half-works
is worse than none ([04 §5.3](design/04-server-multiuser-deployment.md)).

It is **submitted to no store**. Every package format is a recurring cost rather
than a one-time build ([04 §5.4](design/04-server-multiuser-deployment.md)), and
a Community Applications listing adds a moderated presence and a support thread
to a project with one maintainer and no users yet.

**What the first install found, 2026-09-07.** The appdata folder Docker created
for `/data` was root-owned, so the first start failed the way the volume
section above describes; `chown -R 1000:1000 /mnt/user/appdata/storyengine` on
the host fixes it, and the template's Data field says so now. The container
list shows no icon, as the template's comment predicts: unraid fetches the icon
over HTTP and the repository is private. And the setup token was not found in
the log on the first try — the line is written on every start until an admin
exists, it carries the token in its text now, and the token is also the
contents of `state/setup.token` under the appdata folder.

---

## Cutting a release

1. Bump `version` in the root `package.json`.
2. Give it a `CHANGELOG.md` entry, and replace **unreleased** with the date.
   The heading opens with the bare version, then the build's name, then the
   date — `## 1.0.0-alpha.1 — 1.0-alpha 1 — 2026-…` — because the workflow looks
   for the version at the start of the line. The names, and how they follow
   from the string, are [releases §7.1](design/workplan/11-repo-and-releases.md)'s.
3. Commit, then tag `v<version>` and push the tag.

`.github/workflows/release.yml` fires on `v*` — filtered, because the only other
tag in this repository is `p1` and phase tags are a habit here. It builds the
image, passing the tag and the commit, and `tools/write-build-info.mjs` refuses
if the tag and `package.json` disagree. So the three places a version is written
agree, or the release stops.
