# Backups, restore and the trash

Three ways to get something back, for three sizes of mistake:

- **The trash** catches a deleted character, lorebook or session. Put it back from
  Settings for as long as the install keeps deleted things — 30 days unless an
  administrator changed it.
- **Version history** catches a bad edit: every library object keeps its recent
  versions (the newest 50 by default). See [The library](library.md#history).
- **Backups** catch the rest — a lost disk, a bad import across your whole library,
  moving to a new machine. A backup is one `.tar.gz` file; every account can take
  them of its own work, and administrators can take them of the whole install.

Everything here is on the **Settings** page. Running the server — where its data
directory is, and backing it up from outside — is in
[Running a built StoryEngine](../deploy.md#backing-up).

## Backing up your own work

Settings → **Backups** → **What to include** → **Back up now**.

| What to include | What the file holds |
| --- | --- |
| **Everything, including my provider keys** (the default) | Your library — every object with its pictures and version history — your sessions, tags, preferences, picture, and your own model connections with their keys. |
| **My work, without my provider keys** | The same without your connections. Use this for a copy you will keep somewhere less private. |

Neither holds your trash or your other backups. The file is kept **on the server**,
under your account's folder: for it to be a real backup, use **Download** and keep
the copy somewhere else.

The list shows each backup with when it was taken, what it includes and its size,
newest first, with **Download** and **Delete**. Deleting a backup asks once more
(**Delete this file**) and removes the file for good — backups do not go to the
trash.

Nobody else can list or download your backups, administrators included.

### On a schedule

If an administrator has turned on **May schedule automatic backups** for your
account, the section also has **Automatically**:

- **How often** — **Never**, **Every day** or **Every week**.
- **Also whenever the server starts** — for a machine that is not on all the time.
  It is skipped if your newest backup is less than an hour old.
- **What to include** — as above.

Each change saves at once, and a sentence underneath says what will happen. The
server checks about once an hour whether your newest backup is older than the
schedule, so a backup that falls due while the machine is off is taken shortly
after the server next starts. Any backup counts as the newest, including one you
took by hand.

**Nothing deletes old backups.** Scheduled ones accumulate until you delete them; the
list shows how much space they take between them.

## Backing up the whole install

*Administrators only.* Settings → **Administration** → **Backups** → **What to
include** → **Back up now**.

| What to include | What the file holds |
| --- | --- |
| **Everything, including accounts and keys** (the default) | The whole data directory: every account's work, the accounts with their password hashes, the sign-in key, the configuration, every connection with its key, and the operational store. |
| **Work only, no accounts or keys** | Every account's work and the settings, without the accounts, the sign-in key or any connection. |

An install backup never holds the search index (it is rebuilt from the files on the
next start), anyone's trash, or any backups. It does hold the data of removed
accounts, minus their trash, backups and — in a work-only archive — their keys.

A full install backup can sign anyone in and use every key on the install. Keep it
as carefully as the server itself; use **Work only, no accounts or keys** for copies
that leave your hands.

You can take one while the server is running. A session being written at that
moment may lose its last, incomplete turn. Only one backup is written at a time,
whoever asked for it; a second request waits for the first.

> **Known problem.** An install backup taken while the server is running carries the
> server's operational store twice, and a restore keeps the wrong copy: one that can
> be missing the store's most recent changes. That store holds notifications, the
> import panel's **Earlier imports**, and the records of turns and pictures in
> progress — not stories, the library or accounts, which are files of their own.
> The panel's note that the store is copied consistently is not true yet. For an
> archive you mean to restore from, stop the server and use
> [`pnpm backup create`](#the-command-line).

Before writing, the server checks there is room for the backup — counting every
file at its full, uncompressed size, so it can refuse a backup that would have fitted
once compressed. If there is not, you see *There was not enough room on the disk for
that backup.*

### The install's schedule

The install's own schedule is three settings under Settings → **Administration** →
**This install**:

| Key | Default | Meaning |
| --- | --- | --- |
| `backup.frequency` | `off` | `daily` or `weekly` install backups. |
| `backup.onStart` | off | Also take one when the server starts (skipped if the newest is under an hour old). The form lists this key as one nothing reads yet; in fact it is read at the next start. |
| `backup.contents` | `full` | `full` or `redacted` (work only) for scheduled archives. |

They take effect without a restart. When a scheduled backup fails — usually because
the disk is full — every administrator gets the notification *A scheduled backup did
not happen*, once for each run of failures, and again after the server restarts.
(For your own schedule, the notification comes to you.) A backup you take by hand that fails says so on the spot instead.

## Getting things back: import or restore

There are two ways back from a backup, and they are different on purpose:

- **Import** merges what is in a backup into the running server, beside what is
  already here. Nothing is replaced wholesale, nobody is signed out, and every
  account can do it with its own backups.
- **Restore** replaces the whole data directory with an install backup, across a
  restart. From the browser only administrators can, and only on an install that
  something restarts; [the command line](#the-command-line) restores any stopped
  install.

### Importing from your own backup

Settings → **Backups** → **Import from a backup** (it appears once you have a backup
on the server):

1. **Which backup** — choose one. A summary appears: when it was taken and by which
   version, how many files it holds, and whether it carries provider keys. (It also
   lists what every backup leaves out, for now as raw keys such as
   `backup.omitted.index` and `backup.omitted.trash`.)
2. **When something is already here**:
   - **Leave what is here, and bring in only what is missing** — the default.
     Nothing already in your library is touched.
   - **Bring everything in, keeping both copies of anything that clashes** — a
     clashing object arrives beside yours as a second copy with the **same name** and
     a new identity; only its folder on disk gets a number. (The panel's hint says
     *renamed*; it is not.)
   - **Let the backup win, and keep what is here in its history** — your current
     version goes into the object's history first, so nothing is lost.
3. **Also bring across** (both off by default):
   - **Provider connections** — only from a backup that has them. A connection
     already set up here is kept, never re-pointed.
   - **Preferences** — merged one at a time; a preference already set here wins.
4. **Import from this backup**, then **Import it** to confirm.

The review afterwards, **What the import did**, counts what was imported, what was
already here and what was skipped, with a sentence for anything worth knowing. The
import also appears in the library's import panel under **Earlier imports**.

What an import does and does not do:

- **Library objects** come in with their pictures, matched by their identity. A
  backup from an earlier version brings its packages in as worlds.
- **Tags** come in; where a tag already exists here, the existing one is kept.
- **Sessions** come in with their turns and pictures, and are **never replaced**,
  whatever you chose above: a session already here, or one that is in your trash, is
  skipped. Importing the same backup twice brings each session back once.
- An import of your own backup never touches accounts, sign-ins or the install's
  settings, and no import brings back version history, your picture, or your backup
  schedule.
- An import reads at most 65,536 files, 64 MB per file and 512 MB in all. A larger
  archive — a library heavy with pictures, say — is refused with *That archive holds
  more than an import reads in one go.*; [restoring](#restoring-the-whole-install)
  has no such limit.

To get back something you deleted, use the trash first: an import with the default
choice brings back library objects you deleted after the backup was taken, and the
trash then refuses to put the deleted copy back, because something with that name
is already there.

### Importing someone's work from an install backup

*Administrators only.* Settings → **Administration** → **Backups** → **Import from a
backup** works on install backups and adds **Whose work in the backup**: the work
lands in the account with the same handle here. An import never creates an account;
create it first if it does not exist.

**Install settings** also brings the archive's `config.json` across, except the keys
that describe the machine rather than the install — the data directory, client
folder, address, port and the cookie and proxy switches — which keep this install's
values. Settings that need a restart raise the usual restart banner.

### Restoring the whole install

*Administrators only.* Settings → **Administration** → **Backups** → **Restore this
install**. The section appears once the install has at least one install backup on
the server.

1. **Which archive to become** — choose one; it says when it was taken, by which
   version, and how many files it holds.
2. **Restore this install…** opens *Replace everything with this archive?*
3. Type `restore` to confirm, and press **Stop the server and restore**.

Before anything changes, the server checks that the archive is an install backup
that reads end to end, that it holds as many files as its manifest says and nothing
outside the data directory, and that there is room for it beside the current install.
Then it stops — running turns get up to thirty seconds — and restores as it starts
again. The page says *The server is stopping. It will restore this archive as it
starts again, and the page will come back on its own.*

What a restore keeps and changes:

- **The install being replaced is kept**, in the data directory's `.restore` folder,
  and never deleted. That is the undo: stop the server and move its contents back by
  hand. It takes as much disk as the install did, until you delete it.
- **Backups stay where they are**: the install's backups are untouched, and each
  person's own backups move into their restored account if that account is in the
  archive.
- **Accounts, passwords and the sign-in key become the archive's.** Anyone whose
  account or key differs is signed out. A work-only archive has no accounts at all,
  so restoring one leaves an install nobody can sign in to, which is set up from
  scratch like a new one — on a server reachable from other machines, with the setup
  token from its log (or `state/setup.token` in the data directory). The page warns
  you when you pick such an archive, before you confirm.
- **The configuration becomes the archive's**, address and port included. Restoring
  an archive from another machine can bring that machine's `server.host` or
  `server.port` with it; check `config.json` before you rely on the restored server
  being reachable.
- The search index is rebuilt on the restored install's first start.

Afterwards every administrator of the restored install gets the notification *This
install was restored from a backup*. If the restore could not happen, the install is
left as it was and administrators get *A restore did not happen* with the reason.

A restore that failed is not tried again. Until you press **Call it off** — under
*A restore is waiting for the next start* — every start repeats the notice.

On an install that nothing would restart — the server started by hand, or with
`pnpm dev` — the browser cannot restore. The section says so and points to the
command line below.

An archive written by a newer build than the one you restore it with will not
start: the older server refuses to open a data directory a newer one has written.
Restore with the same or a newer build.

### Moving an archive to another install

There is no upload control for backups. Copy the archive file into the other
install's data directory, keeping its file name: an install backup goes in
`backups/`, an account backup in `users/<handle>/backups/`. It is then listed, and
can be imported or restored from there.

An account backup belongs to its handle. It can be imported only by an account
with the same handle on the other install; under any other handle the import says
*That archive does not hold the account you asked for.*, and an administrator's
import lists install backups only.

## The command line

A source checkout has a backup command, for when the server is stopped:

```bash
pnpm backup create <data-dir> <archive.tar.gz>
pnpm backup restore <archive.tar.gz> <data-dir>
```

- It is not in the container image or the release tarball; it needs a checkout of
  the repository with its dependencies installed.
- Both refuse while a server is using the directory. Stop the container or service
  first.
- `create` always includes keys, and writes no summary file into the archive, so its
  archives cannot be imported or restored from the browser — only with
  `pnpm backup restore`.
- `restore` reads the whole archive before writing anything and deletes nothing.
  Into an empty directory it writes the files; over an existing install it stages the
  archive, and the server performs the swap on its next start, keeping the old
  install in `.restore` as above. It refuses an account backup.

To put one account's backup into place by hand, unpack it into the data directory
with `tar`, as [Running a built StoryEngine](../deploy.md#backing-up) shows.

## The trash

Deleting a library object you own (**Delete**, then **Delete** again to answer *Move
to trash?*) or a session
(the session's panel → **Delete this session** → **Move it to trash**) moves it to
your trash. Shipped objects cannot be deleted, and a session cannot be deleted while
a turn is running in it.

Settings → **Trash** lists what you have deleted, newest first, with when it was
deleted and when it will be removed. Sessions appear by their id, and objects by
their folder name — the name of the object's folder on disk, which is not
necessarily its current name — under the kind, such as *actor* or *session*.
**Put it back** returns the item under its old name, with its
version history, and it shows up in search again. If something has taken that name
since, you see *Something with that name is already there. Rename it first, then put
this one back.*

A package deleted under an earlier version, before worlds were called worlds, is listed
as a *world*. **Put it back** returns it as one, in the worlds folder — under a numbered
folder name if a world has taken its name since, rather than refusing.

Deleted things are removed once they are older than `trash.retentionDays` (30 by
default; `0` keeps them for ever). The sweep runs about a minute after the server
starts and then daily, so removal can come a day after the date shown. There is no
"empty the trash" or "delete permanently": things leave the trash when the window
passes, or when somebody removes them from the disk by hand.

Your trash is yours alone; administrators cannot see it. It is never included in a
backup, so neither an import nor a restore brings back what was in the trash when
the backup was taken.
