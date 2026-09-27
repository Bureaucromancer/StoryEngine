# Running a built StoryEngine

**Status: as built at P6A.4.** This describes the image, the compose file and the
unraid template that [P6A](design/workplan/19-p6a-alpha-1.md) ships — what exists,
not what is planned.

**Alpha 1 is a build this project made for itself.** The repository is private,
the registry package is private, and the unraid template is committed rather than
submitted. That is a deliberate position rather than a stage on the way to
something: publishing the image is a decision to publish the repository at the
same instant, because AGPL §13's source link has to resolve for whoever is
running it ([09 §7](design/09-server-multiuser-deployment.md)). See
[P6A §4](design/workplan/19-p6a-alpha-1.md) for what else travels with that
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
([09 §5.3](design/09-server-multiuser-deployment.md)). That is done by setting
`SE_HOST` — the same variable a bare-metal install would use, not a different
build ([P10 §1.2](design/workplan/27-p10-implementation.md)) — so you can read it
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
([09 §5.1](design/09-server-multiuser-deployment.md)).

## Reaching it by name

Once the server is bound beyond loopback it advertises itself on the local
network as **`storyengine.local`**, so a household reaches
`http://storyengine.local:8080` instead of an IP address somebody read out over
the phone ([09 §5.1](design/09-server-multiuser-deployment.md)). Change the name
with `server.mdnsName`, or set it to `""` to advertise nothing.

**Two installs on one network need two names** — `attic` and `study`. The server
checks whether a name is already claimed before it takes one, so the second
install would otherwise simply go unnamed, and it says so in its log.

Two things that are not faults and are reported as log lines rather than
failures:

- **macOS and most Linux desktops already run an mDNS daemon** (mDNSResponder,
  Avahi) which holds the port. Those machines are usually reachable by their own
  hostname already, which is a better answer than this one.
- **A container often has no multicast route to the LAN.** Under the default
  bridge network, `.local` will not reach the rest of the house; `network_mode:
  host` is what makes it work, at the cost of the port mapping being the host's
  whole port. That is a trade rather than a fix, and the IP address keeps
  working either way.

## The volume

Everything the install is — accounts, library, sessions, `config.json` — is under
`/data` ([03 §5](design/03-data-model.md)). Back that up; there is nothing else
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

**One server per data directory.** A running server holds a lock on
`instance.lock` at the data directory's root, and a second one started on the
same directory stops at once with *Another StoryEngine server is using …*.
Before the lock (2026-09-27), a second one took the directory over before it
had even listened: it finished the first one's turn in flight as failed and
deleted its backup half way. The lock is the operating system's, so a server
that crashed leaves nothing to clean up, and the file itself is empty and never
in a backup. Two containers, a service and a copy started by hand, or two
installs pointed at one NAS share: give each its own directory.

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

**And one more that is not a setting at all**: `SE_SUPERVISED`. It says that
something will start this server again if it stops — `compose.yaml`'s
`restart: unless-stopped`, the `--restart=unless-stopped` in the unraid
template's Extra Parameters, the tarball's systemd unit — which is what lets the
settings page offer **Restart now** instead of explaining that StoryEngine does
not restart itself. Nothing inside a container can work this out for itself: a
container is told nothing about its own restart policy, and every test that
looks like it would work (PID 1, `/.dockerenv`, a cgroup path) is equally true of
a `docker run` with no policy at all — which is exactly the case where the button
would leave you with no server. So it is set beside the restart policy rather
than baked into the image, and it is defaulted off: a wrong *no* costs you one
manual restart, a wrong *yes* costs you the server. `SE_SUPERVISED=0` is also an
answer, and it outranks the detection below.

unraid's own **Autostart** is not a restart policy: it starts containers when
the array starts and restarts nothing that exits. The template's
`--restart=unless-stopped` is what brings the container back. A container
created from a copy of the template older than 2026-09-27 does not have it, so
add `--restart=unless-stopped --stop-timeout=30` to its Extra Parameters
(Advanced view), or set `SE_SUPERVISED` to 0.

A systemd unit is detected rather than declared, but only on systemd 248 or
later, which is the first to name the process it started (`SYSTEMD_EXEC_PID`).
`INVOCATION_ID` alone is handed down to everything a unit starts — a shell in a
tmux a user unit started, a CI job — so it no longer counts on its own. The
tarball's unit sets `SE_SUPERVISED=1` anyway; a unit you write yourself should
too if its systemd is older.

**What a restart looks like to whatever restarts it.** *Restart now* and a
restore exit with status **75**; a stop (`SIGTERM`, `docker stop`,
`systemctl stop`) exits 0. Docker's `unless-stopped` and `always` both bring
back the first, and a `docker stop` stays stopped under either. A systemd unit
needs `Restart=on-failure`
(which restarts on anything but 0) or, as the tarball's has,
`RestartForceExitStatus=75`, which restarts on it whatever `Restart=` says. Give
it time to stop, too: the server bounds its own shutdown at about twenty seconds
(requests still open, then pictures still being made), which is longer than
Docker's default of ten, so every shipped wrapper allows thirty.

Everything else is `config.json` in the volume, or the settings page. **The file
wins over the environment**, because the file is what the settings page writes:
changing a value in the UI and finding a variable had outranked it would be a bug
([21 §4](design/21-internal-contracts.md)). The server logs a warning when a
variable is set and the file speaks for the same key.

**A settings save writes only what you changed.** Before 2026-09-27 it wrote
back every value the page showed, including the ones your `SE_*` variables set,
so an install that has saved its settings once may have `server.host`,
`server.port` or `server.clientRoot` in `config.json` that you never chose, and
those outrank the variables. The start-up warning above names them; delete them
from the file to let the variables speak again.

**There is no HTTPS.** On a LAN it cannot be done well without a real domain or a
private CA, and self-signed certificates train people to click through warnings.
Put a reverse proxy in front if you want TLS, and then set `server.trustProxy`
and `server.cookieSecure` in `config.json` — both default to off, and
`cookieSecure` without TLS in front makes signing in fail silently, because a
`Secure` cookie is never sent back over plain HTTP. The settings page will only
turn `cookieSecure` on from a page it can see arrived over HTTPS, directly or
through a proxy it is told to trust, and it refuses an address, a port or a
client root the next start could not use.

## Updates

StoryEngine checks once a day whether there is a newer build on your channel,
and shows the answer in **Settings → About**. It is a plain fetch of the public
release feed and nothing else: no install id, no usage counts, no configuration,
nothing anonymised. Turn it off with `updates.checkEnabled` in the settings form
and no request is made at all.

The same request doubles as a connectivity check, because a server that cannot
reach the release feed usually cannot reach a remote model provider either. That
warning only appears when one of your connections actually points at a remote
provider — a fully local setup (Ollama, llama.cpp, a box on your LAN) is a
perfectly good deployment and is not told its server is broken for failing to
reach something it never needed.

An HTTP answer of any kind counts as *the internet works*, including a refusal.
Only a connection that goes nowhere is read as offline.

## Notifications, and the one thing plain HTTP costs you

StoryEngine tells you when a turn finishes, when one fails, when a picture is
ready, and when a saved setting needs a restart. Four of those reach you in the
page itself — a chime, a toast, the unread count on **Notifications** in the
header, and the same count in the browser tab's title — and all four work
however you reach the install.

**Browser notifications — the kind your operating system shows when the tab is
in the background — need a secure context, and a LAN address over plain HTTP is
not one.** This is a browser rule rather than a setting: `http://localhost:8080`
counts as trustworthy and `http://192.168.1.50:8080` does not, so on the default
install the browser refuses the permission prompt no matter what the page asks
for ([09 §3.6](design/09-server-multiuser-deployment.md)).

| How you reach it | What you get |
| --- | --- |
| The server box itself, over `localhost` | Everything |
| **A LAN address over plain HTTP — the default** | Chime, toast, unread badge, tab title. No background notifications |
| HTTPS through a reverse proxy, or Tailscale | Everything |

The notification list says which of these you are in, in one sentence, rather
than showing a switch that would not work. If you want the background ones, the
reverse proxy above is the fix — and Tailscale gets HTTPS more or less for free.

Nothing is lost either way: a notification is stored until you read it, so the
count is there when you come back even if the browser was closed.

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
promise between alpha builds — [21](design/21-internal-contracts.md) licenses the
storage tier to change without migration for as long as nothing leaves the
install, and nothing does ([P6A §1.7](design/workplan/19-p6a-alpha-1.md)).

## The source

Every page carries a **Source** link in its footer, and it resolves to the tag
this build was cut at rather than to a branch — AGPL §13 obliges an offer of the
source for the version you are actually running, which is a different thing from
the newest source ([09 §7](design/09-server-multiuser-deployment.md)).

The link comes from the build, not from this program: `tools/write-build-info.mjs`
writes the `origin` remote of whatever repository the build was cut from. **If
you fork this and ship your own image, your image links to your source**, with
no code change and nothing to remember. A build made from a clone with no remote
carries no link, which is honest — it cannot say where its source is.

Settings → About states the licence boundary in the same words for everybody:
the program and anything that imports its SDK are AGPL-3.0; **what you write is
yours**. Actors, treatments, lorebooks, presets, sessions and packages are data
this program produced, not derivative works of it.

## Channels

Every tagged build is pushed under two tags: its version, which never moves,
and `testing`, which every tagged alpha moves
([releases §4](design/workplan/04-repo-and-releases.md) — *a chosen commit on
main, gated on a human deciding*, which a tag on main is). The unraid template
follows `testing`, so unraid's update check offers each new alpha;
`compose.yaml` pins the version, because it is the build you can go back to. To
follow the channel from compose, change the tag to `testing`; to hold unraid on
one build, change the template's repository tag to that build's version. There
is no `latest`: unraid's auto-update and watchtower track that alias, and an
alpha is not something to hand an auto-updater.

## unraid

`deploy/unraid/storyengine.xml` is a template you can drop into
`/boot/config/plugins/dockerMan/templates-user/`. It declares the port, the
`/data` volume, the WebUI address and the bind variable, and its description
opens by saying the package is private — because a template that only half-works
is worse than none ([09 §5.3](design/09-server-multiuser-deployment.md)).

It is **submitted to no store**. Every package format is a recurring cost rather
than a one-time build ([09 §5.4](design/09-server-multiuser-deployment.md)), and
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

## A tarball, and a systemd unit

*Added at [P11.9](design/workplan/28-p11-implementation.md).* The image is the
distribution and everything else is a convenience
([09 §5.4](design/09-server-multiuser-deployment.md)) — but the convenience that
matters is this one. §5.4 decides its packaging list on a single question,
**does it start on boot and come back after a reboot**, and calls the tarball
*"the single highest-value non-container artifact, and the one most easily
skipped"*: it answers that question for every Linux that is not Debian or Arch.

Every `v*` tag builds `storyengine-<version>-linux.tar.gz` beside the image. It
contains the same tree the image runs — `dist/`, the resolved `node_modules/`,
the built client and `build-info.json` — with a systemd unit and an install
script beside it.

```bash
tar xzf storyengine-1.0.0-alpha.2-linux.tar.gz
sudo ./storyengine/install.sh
journalctl -u storyengine -n 50      # the setup token is in here
```

The script creates a `storyengine` service user, copies the tree to
`/opt/storyengine`, creates `/var/lib/storyengine` for the data, installs and
enables the unit, and starts it. It needs Node 26 or newer and **checks** rather
than assuming — an unpacked tarball has no equivalent of the build's
`engine-strict`, and a service that installs, enables and then dies on a syntax
error is the failure worth one `if`.

**It listens on `127.0.0.1`, where the container listens on `0.0.0.0`.** That is
a deliberate difference rather than an oversight, and it is written into both
artifacts so it is not a surprise in either: a container's network namespace
makes `0.0.0.0` a statement about the container, and your `-p` is the explicit
act that exposes it. A systemd service has no such boundary, so the same value
would put a fresh install on the LAN before anybody had read the setup token.
To reach it from another machine, edit `SE_HOST` in
`/etc/systemd/system/storyengine.service`, then
`systemctl daemon-reload && systemctl restart storyengine`.

**Upgrading is running the script again.** Unpack the new tarball, run
`install.sh`, and it rewrites `/opt/storyengine` and the unit and restarts the
service. `/var/lib/storyengine` is created once and never touched again — there
is no separate upgrade path to get out of step with the install one.

**The archive is reproducible**, which is
[work plan §8](design/workplan/01-work-plan.md)'s requirement and is checked in
the workflow rather than claimed: it is packed twice from one tree and the two
files are compared. Entries are sorted, timestamps and ownership are zero, and
the gzip container carries no time of its own — which are the three places an
otherwise identical build stops being identical.

---

## Cutting a release

1. Bump `version` in the root `package.json`, and the image tag in
   `compose.yaml` with it. Those are the two places a version is typed; the
   unraid template needs nothing, because it follows `testing`.
   `tools/release.test.ts` fails on either one missed, which is how this step
   is enforced rather than remembered.
2. Give it a `CHANGELOG.md` entry, and replace **unreleased** with the date.
   The heading opens with the bare version, then the build's name, then the
   date — `## 1.0.0-alpha.1 — 1.0-alpha 1 — 2026-…` — because the workflow looks
   for the version at the start of the line. The names, and how they follow
   from the string, are [releases §7.1](design/workplan/04-repo-and-releases.md)'s.
3. Commit, then tag `v<version>` and push the tag. The tag moves `testing` too.

`.github/workflows/release.yml` fires on `v*` — filtered, because the only other
tag in this repository is `p1` and phase tags are a habit here. It builds the
image, passing the tag and the commit, and `tools/write-build-info.mjs` refuses
if the tag and `package.json` disagree. So the three places a version is written
agree, or the release stops.

## Backing up

**The data directory is the whole of it, and `rsync` is a legitimate strategy** —
[25 E6](design/25-open-questions.md). Everything StoryEngine keeps is files under
the data directory: cards, lorebooks, sessions, turns, connections and accounts.

**Stop the server first.** There is no way to quiesce writes from outside the
process, and a copy taken mid-write catches a half-written session — which is a
corrupt story rather than a corrupt cache. `POST /api/admin/restart` drains the
turns in flight and refuses new ones, which is the supported way to get there.
The bundled command checks: it takes the server's own lock for as long as it
runs, so it refuses a directory a server is using, and a server cannot start on
one it is halfway through. `rsync` cannot check, so stopping is up to you.

**Leave `index.sqlite` out.** It is derived from the files
([03 §5.1](design/03-data-model.md)) and it carries a schema version — an archive
containing it restores a *stale belief about a newer tree* the first time it is
restored across an upgrade, silently, because a stale index still answers
queries. The server rebuilds it on the next start.

```sh
# The whole directory, without the derived index.
rsync -a --exclude 'index.sqlite*' /path/to/data/ /path/to/backup/

# Or the bundled command, which excludes it for you.
pnpm backup create /path/to/data backup.tar.gz
pnpm backup restore backup.tar.gz /path/to/data
```

***The bundled command did not, in fact, exclude it, from 2026-09-17 until
2026-09-22.*** Its rule was a filename test applied at the data root and the
index lives one directory down, so every archive it wrote carried the index —
the exact failure the paragraph above describes. Fixed at
[P12.0](design/workplan/29-p12-implementation.md); if you are holding an archive
taken before then, delete `index/` out of the restored directory before starting
the server. The `rsync` line was always correct, because its pattern matches at
any depth.

**An untested restore is not a backup.** Restore into a clean directory, start
the server, and **run a search** — a search answering is the only observable
proof the index was rebuilt rather than carried.

### From the browser, without a shell

*Added at [P12](design/workplan/29-p12-implementation.md).* The two deployment
paths above both hand a person a web UI and nothing else, so **Settings →
Backups** takes one, lists what is stored, and hands it over as a download.
Administrators get the same for the whole install, and three `backup.*` settings
turn it into a schedule — a frequency, and an independent *also on every server
start* for a machine that is not on all the time.

**A backup taken from inside a running server is more consistent than one taken
from outside it, not less.** `state/state.sqlite` is snapshotted with
`VACUUM INTO` rather than copied; every other write is already temp-and-rename.
A session being written at that instant may lose its last, incomplete turn,
which the turn reader already drops.

**The archives are files in the data directory** — `data/backups/` for the
install's, `data/users/<handle>/backups/` for a person's own — and they are
**excluded from every archive**, so a backup never contains the backups. Nothing
removes old ones yet: delete them from the same panel.

**They are ordinary `.tar.gz` files**, so `pnpm backup restore` reads one:

```sh
# An install archive, into a stopped server's data directory. Name one archive:
# a pattern that matches two is refused.
pnpm backup restore data/backups/install-full-2026-09-22-0199….tar.gz /path/to/data

# An account archive is a subset of an install one, so it unpacks in place.
tar -xzf data/users/ned/backups/account-ned-full-*.tar.gz -C /path/to/data
```

**The command deletes nothing.** It reads every header and the manifest before
it writes a byte, and refuses an account archive (restoring one as the install
would leave that one person's tree and nothing else). Into a directory with no
install in it, it writes the archive straight in. Over an install, it stages the
archive in `.restore/<id>/staging` and leaves the install alone: the server's
next start swaps it in exactly as a restore from the admin panel would, keeping
what it replaces in `.restore/<id>/replaced`. *Until 2026-09-27 it began by
emptying the data directory*, stored backups included, before it had read a
single header.

**A `full` archive contains credentials** — the account's provider keys, and for
an install archive `accounts.json` and the session signing key. That is what
makes it restorable. Choose `redacted` for a file you are going to put somewhere
you would not put those, and know that restoring one produces an install nobody
can sign into.

### Getting data back: import, or restore

*Added at [P12](design/workplan/29-p12-implementation.md).* **Two operations,
named apart, because conflating them is how somebody loses a week.**

| | **Import** | **Restore** |
|---|---|---|
| Does what | Merges an archive's content into what is here | Replaces the data directory with the archive |
| Server | Running | Stops, and restores as it starts again |
| Touches | Library, sessions and tags; provider connections, preferences and settings only if ticked | Everything |
| Refuses | Nothing structural — a clash is a policy you choose | An account archive; an unsupervised install; an archive that will not read end to end |
| Undo | History keeps what each replaced object was | The previous directory, moved aside and never deleted |
| Who | Anybody, for their own; an administrator, per account | An administrator |

**Import** is **Settings → Backups → Import from a backup**, and for the whole
install under Administration. It never touches accounts, the operational store
or the system library — that line is what keeps the two verbs distinct rather
than two positions on a slider, and it is why clicking the wrong one loses
nothing. Clashes default to *leave what is here*, which is the opposite of the
file-import default and deliberate: a backup meeting a live account is the past
meeting the present.

A session is never replaced, whatever the clash policy says. One that is still
here, one in the trash (restore it from there), and one an earlier import
already brought back are all left alone, so importing the same backup twice
brings each session back once. Pictures come with what they belong to: an
actor's portrait and expressions, a book's gallery, and a session's
illustrations and backdrops.

**Restore** is **Settings → Administration → Backups → Restore this install**,
and it is only offered where something will start the server again — compose's
`restart:`, a systemd unit, the unraid template's `--restart`, or
`SE_SUPERVISED=1`. Everywhere else the
panel gives the shell command instead, because a server that stopped and stayed
stopped is worse than one that never offered.

What happens is a handoff across a restart. The server checks everything while
it is still answering — the archive reads end to end, it is an install archive,
a `redacted` one has been confirmed, and there is disk for it — writes
`state/restore.pending`, drains the turns in flight, and exits. On the next
start, **before anything opens the data directory**, it unpacks the archive into
`.restore/<id>/staging` inside the data directory, and then swaps it in one
entry at a time: `users/`, `state/`, `config.json` and the rest move into
`.restore/<id>/replaced`, and the archive's move into their places.

*Until 2026-09-27 it staged beside the data directory and renamed the whole
directory aside*, which needs to write in the data directory's parent. Docker,
unraid and the systemd unit all make that parent unwritable, so a restore
failed everywhere but a bare checkout. Everything now happens inside the data
directory.

```sh
# After a restore, inside the data directory:
ls -d /path/to/data/.restore/*/replaced
```

***That directory is the undo and StoryEngine will not delete it.*** Remove it
yourself when you are sure — the same promise `data/removed/` makes about an
account that was removed. A notice on that boot names it, which is the one place
in this build that deliberately puts a filesystem path in front of a person.
**Your stored backups are not in it**: `backups/` never moves, and each
person's own archives are carried across to their restored account (an account
the archive does not bring back keeps its archives in the undo, and the log
says whose).

**A restore that fails changes nothing.** Everything is unpacked before anything
moves, and the swap writes a journal first, so a move that fails part way is
moved back, and a start that was interrupted part way finishes the swap. The
marker is kept so the next start refuses the restore rather than trying again,
and **Call it off** in the same panel clears it. A bad archive must not become a
restart loop. *If a move fails and so does moving it back*, the server will not
start on a directory that is half of each: it says where both halves are, and
tries again on each start.

**And the archive carries no index**, so the restored install rebuilds it on
that same boot. Run a search afterwards: a search answering is the only
observable proof it was rebuilt rather than carried.

