# Settings, accounts and the install

Everything you configure lives on one page, **Settings**, reached from the header.
Its first half is yours and every account has it: your name and picture, your
password, your theme, which models your stories use, your notifications, your
trash and your backups. Its second half, **Administration**, appears only for
administrators and holds the install itself: the accounts on it, the shared model
connections, the configuration, and install-wide backups.

This page covers signing in, the parts of Settings that are about you, and the
administration of accounts and configuration. Model connections, backups and the
trash have pages of their own: [Connections and models](connections-and-models.md)
and [Backups, restore and the trash](backups-and-trash.md). Running the server
itself — containers, the unraid template, the systemd tarball, HTTPS — is
[Running a built StoryEngine](../deploy.md).

## Signing in

You sign in with a **handle** and a password. A handle is lowercase letters, digits
and hyphens, up to 63 characters; it names your folder on the server's disk
(`users/<handle>/`), and **it can never be changed**, by you or by an
administrator. What other people see is your **display name**, which you can change
whenever you like.

An install shows one of two sign-in screens, chosen by its administrator:

- **The form** — **Handle**, **Password**, **Sign in**. This is the default.
- **The gallery** — a grid of faces (an uploaded picture, or coloured initials) with
  each person's display name. Picking a face opens the form with that handle filled
  in and the cursor in **Password**; **Back to the faces** returns to the grid, and
  **Sign in by name** skips it. A face never signs you in by itself. Anyone who can
  reach the server sees the names and faces on this screen before signing in, so it
  suits a household better than a shared network. You can take yourself off it
  (see [You](#you)) and still sign in by name.

A sign-in lasts **14 days from the moment you signed in**. Using the app does not
extend it. **Sign out**, at the right of the header, signs out this browser only:
any other browser signed in to your account stays signed in.

If your sign-in ends while a page is open — it expired, you signed out in another
tab, or an administrator turned your account off — a banner appears above the page:
*Your sign-in has ended. Copy anything unsaved on this page, then sign in again.*
The page is left exactly as it was so you can copy what you were writing. **Sign in
again** takes you to the sign-in screen.

If the server cannot be reached when the app first loads, you see *The server could
not be reached. Check that it is running, then try again.* with **Try again**. If
the server goes away while the app is already open — a restart, for instance — the
app keeps the page you are on and carries on when the server comes back.

### The first account

A new install has no accounts. Whatever address you open shows **Welcome to
StoryEngine** and a form to create the first administrator: **Handle**, **Display
name (optional)**, **Password** and **Create account**. If the server is reachable
from your network rather than only from its own machine, the form also asks for a
**Setup token**. The server prints the token in its log on every start until an
account exists, and keeps it in the data directory at `state/setup.token`;
[Running a built StoryEngine](../deploy.md#first-run) shows where to find it for
each way of installing. Once the first account exists the token is no longer asked
for and the file is inert.

## Around the app

Every page has the same header:

| Control | What it does |
| --- | --- |
| **StoryEngine** | Home. Today this shows the release notes of the newest release in this build's changelog; **All releases…** lists every one. |
| **Play** | Your sessions — see [Playing a session](playing.md). |
| **Library** | Your characters, lorebooks, presets and the rest — see [The library](library.md). |
| **Search** | Searches your library and every line of every session, including lines you branched away from. |
| **Workbench** | Opens the workbench beside the page: what a turn was built from and what it sent. **Ctrl+`** toggles it too, and whether it is open is remembered for your account. |
| **Assistant** | Opens the assistant, which can answer questions about StoryEngine and help with the object on screen — see [Modes](modes.md#the-assistant). |
| **Notifications** | Your notifications, with the unread count — see [Notifications](#notifications). |
| **Settings** | This page. |
| Your display name, **Sign out** | Who is signed in, and signing out. |

The first press of Tab on any page focuses **Skip to the page**, which jumps past
the header. On a narrow screen an open workbench or assistant takes over the whole
screen.

The footer of every page names the build — *StoryEngine 1.0-alpha 4*, or
*StoryEngine development build* — and, where the build records where its source
lives, carries a **Source** link to the exact source this install is running.

## Your settings

Settings is one long page. Its sections, in order:

| Section | Who sees it | What is in it |
| --- | --- | --- |
| The build line (for example *StoryEngine 1.0-alpha 4*) | Everyone | Version and commit, and the licence. Administrators also see whether a newer build exists. |
| **You** | Everyone | Your picture, display name, language, whether you appear on the sign-in gallery, and your password. |
| **Which models your stories use** | Everyone | Which model does each job in your own stories — see [Connections and models](connections-and-models.md). |
| **Preferences** | Everyone | Theme. |
| **Notifications** | Everyone | Sounds, and which notifications you get — see [Notifications](#notifications). |
| **Your connections** | Accounts allowed their own connections | See [Connections and models](connections-and-models.md). |
| **Trash** | Everyone | What you deleted, and restoring it — see [Backups, restore and the trash](backups-and-trash.md). |
| **Backups** | Everyone | Archives of your own account — see [Backups, restore and the trash](backups-and-trash.md). |
| **Administration** | Administrators | **Accounts**, **Connections**, **This install** and install **Backups**. |

### You

- **Your picture** — a PNG, JPEG or WebP under 2 MB. It uploads as soon as you choose
  the file; **Remove it** goes back to coloured initials. The picture is what the
  sign-in gallery shows. (The small preview on this page currently keeps showing
  your initials even after an upload.)
- **Display name** — what other people on the install see, 1 to 200 characters.
- **Language and formats** — **Use my browser's**, one of the regional Englishes,
  or **Français (machine translation, unreviewed)**. The Englishes change how dates
  and numbers are written. The French is partial: it covers some labels in play,
  the reading view, the workbench and a few other places, and the rest of the app
  stays in English.
- **Save** stores the display name and language together, and says *Saved.*
- **Shown on the sign-in screen** — only on an install that uses the gallery. It
  saves the moment you click it. Turning it off hides your face; you still sign in
  by typing your handle.
- **Password** — **Current password**, **New password**, **Change password**. The
  install sets a minimum length (eight characters unless an administrator changed
  it). Changing your password does **not** sign out other browsers already signed
  in; those sign-ins last until they expire.

### Preferences

**Theme**: **Match my system** (the default — it follows your device's light or dark
setting as that changes), **Light** or **Dark**. It applies the moment you choose
it. The theme is stored with your account, and each browser also remembers the last
one it showed so the page does not flash the wrong colours while loading. It is the
only appearance setting today.

### The build and the licence

The top of Settings says which build this is (**Version** and **Commit**; a
development build says it has neither) and states the licence: StoryEngine is free
software under the GNU Affero General Public License, version 3 or later. **What
you write is yours**: actors, treatments, lorebooks, presets, sessions and packages
are data the program produced, not derivative works of it.

Administrators also see an update note here: whether a newer build exists on the
install's update channel, that the check is turned off, or that no release has been
published for the channel yet. The check is a plain request to the project's public
release list, once a day, sending nothing about the install; turn it off with
`updates.checkEnabled`. Nothing in the app updates the server — how you update
depends on how you installed it ([Running a built StoryEngine](../deploy.md)).

## Notifications

StoryEngine tells you when something you are not watching finishes or goes wrong:

| Notification | When |
| --- | --- |
| *Your turn is ready* | A turn finished. |
| *A turn could not finish* | A turn failed, with the reason. Not for a turn you stopped yourself. |
| *A picture is ready* / *A picture could not be made* | An illustration or backdrop finished, or failed. |
| *A setting needs a restart*, *A scheduled backup did not happen*, *This install was restored from a backup*, *A restore did not happen* | Server notices. The restart and restore notices go to administrators; a failed scheduled backup goes to whoever's schedule it was. |

**You are not notified about a session you have open.** While that session's page is
open in any tab or on any device — even a tab in the background — its turns and
pictures raise no notification at all. To be told when a long turn is done, leave
the session's page.

A notification arrives as a chime (a different one for each kind), a message in the
corner of the page for a few seconds, the unread count on **Notifications** in the
header, and the same count in the browser tab's title. Arrivals of the same kind for
the same session within two minutes fold into one row with a count. **Notifications**
opens the list of the 50 newest, where a row's title links to its session; **Mark
read**, **Mark all read** and **Mute sounds** (for this visit only) are there too.
Notifications are kept until you read them, and read is the same on every device.

Settings → **Notifications** holds your standing choices:

- **Mute sounds**, and **Start muted every time** — for a shared room: each new page
  starts silent until you turn sound back on.
- For each of **A turn finishes**, **A turn fails**, **A picture is ready** and **The
  server needs attention**: **Sound and a toast** (the default), **A toast, no sound**,
  or **Only the unread count**.

Browsers will not play a sound until you have clicked or typed on the page, so the
first chime after loading a page can be silent.

**Notifications from the operating system** — the kind that appear when the tab is in
the background — are a browser feature that needs a secure connection. **Turn on**, in
the notification list, asks your browser's permission where it can. It works on the
server's own machine over `localhost` and over HTTPS, and not over plain HTTP to a
network address, which is how a default install is reached; the list says which case
you are in. [Running a built
StoryEngine](../deploy.md#notifications-and-what-plain-http-costs-you) explains the
reverse proxy that fixes it, and the same rule is why the **Copy** buttons cannot
copy over plain HTTP.

## Lost passwords

- **An administrator can set a new one**: Settings → **Administration** →
  **Accounts**, the person's row, **Set a new password**. Type it, **Set password**,
  and tell them what it is. This neither turns a disabled account back on nor signs
  the person out anywhere.
- **From the server's console**, for when no administrator can sign in. The
  server can keep running while you do it:

  ```bash
  # From a source checkout:
  node packages/server/dist/main.js --reset-password <handle> --data ./data
  # Inside the container image:
  node dist/main.js --reset-password <handle>
  ```

  It asks for the new password twice without echoing it, and never takes it as an
  argument. It turns the account back on if it was off, and it applies no minimum
  length. A running server picks the change up at the next sign-in.

Never delete `accounts.json` to get back in: that removes every account and returns
the install to first-run setup.

## Administering accounts

*Administrators only.* Settings → **Administration** → **Accounts** lists every
account in the order it was created. Changes to a row apply as you make them —
there is no Save — and a refused change snaps back with the reason beside it.

For each account:

- **Role** — **User** or **Administrator**.
- **Signed in** — whether the account can sign in at all. Turning it off keeps
  everything the person made and cuts them off at their next request.
- **In force now**:
  - **May use their own connections** — on by default. Off means their turns use
    the install's connections only; their own connection files stay on disk and
    work again if you turn it back on.
  - **May schedule automatic backups** — off by default. It lets the person set a
    backup schedule for their own account, which uses disk on the server.
  - **Import from a folder on this machine** — **No — cannot read this machine**
    (the default), **May import from a folder**, or **May import from a folder,
    and edit their own files**. Importing from a folder lets the person have the
    server read *any* directory it can reach, outside the data directory too, so
    grant it only to someone you would trust with a shell on that machine. (The
    third option behaves like the second today; editing files in place is not
    built yet.)
  - **Shown on the sign-in screen** — whether the person appears on the gallery.
- **Recorded for later**: **May enable extensions**. Extensions have not shipped;
  the setting is kept for when they do.
- **Set a new password** — see [Lost passwords](#lost-passwords). The box shows the
  password as you type it.
- **Remove …** — asks you to type the handle to confirm. The person's library and
  sessions are **moved** to `data/removed/<handle>-<id>` on the server, never
  deleted; delete that folder yourself when you are sure. The handle is free to use
  again at once, and a new account with that handle sees none of the old one's
  data.

**Add someone** creates an account: **Handle**, **First password** (shown as you
type it), **Role**, **Create**. The new account's display name starts as its handle,
and its permissions start at the defaults above. There are no invitations and no
self-registration: an administrator creates every account.

The heading warns when an account has **no usable connection** and so cannot send
a message — meaning nothing resolves the job *Writing the story* for it (see
[Connections and models](connections-and-models.md#jobs)). On a new install with
no connections, that is everybody.

Two rules worth knowing:

- **The permissions above are not implied by being an administrator.** A new
  install's first administrator cannot import from a folder or schedule backups
  until those switches are turned on for their own row.
- **The last administrator who can sign in cannot be demoted, turned off or
  removed.** Make somebody else an administrator first.

## Configuring the install

*Administrators only.* Settings → **Administration** → **This install** is a form
over the install's configuration file, `config.json` in the data directory. Each
control is labelled with the key it sets (for example `limits.providerTimeoutMs`);
keys that take effect only after a restart say **(needs a restart)**. `dataDir`
cannot be changed here, because changing it would write to the old location.

**Save** checks the whole configuration the way the next start will read it, and
refuses what that start could not use: an address this machine does not have, a
port it cannot listen on, a client directory with no `index.html`, or turning on
`server.cookieSecure` from a page that did not arrive over HTTPS. Only the keys you
changed are written to the file.

### When a setting needs a restart

Most keys apply the moment you save. The ones marked **(needs a restart)** — the
address, port, client directory, cookie and proxy settings, the mDNS name, the log
format and a few others — wait, and every administrator sees a banner under the
header naming them.

- **On a supervised install** — the container, the unraid template and the
  systemd tarball are all set up this way — the banner offers **Restart now**. The
  dialog says how many people have a turn running and warns that they may be
  interrupted. The server stops accepting new turns, gives running ones up to
  thirty seconds to finish, records anything still running as a failed turn rather
  than losing it, and restarts. The banner says *Restarting to apply …* and the
  page reconnects on its own. Nobody is signed out by a restart.
- **On an install nothing supervises** — the server started by hand or with
  `pnpm dev` — there is no button: the banner tells you to stop and start the server
  yourself.

### Editing `config.json` by hand

Editing the file directly is supported; it is the same file the form writes. The
server reads it **only when it starts**, so a hand edit takes effect at the next
restart, and it does not raise the restart banner. If you save the form after the
file changed underneath it, the form says *The file changed on disk since this page
loaded* and offers **Load what is on disk** or **Overwrite with mine**.

Settings come from four places, each overriding the one before:

1. the built-in defaults;
2. the environment variables `SE_DATA_DIR`, `SE_HOST`, `SE_PORT` and
   `SE_CLIENT_ROOT`;
3. `config.json`;
4. the `--data` option on the command line.

**The file outranks the environment.** If `config.json` sets a key that an `SE_*`
variable also sets, the file wins and the server's log says so. An install that
saved its settings before 27 September 2026 may have the address, port or client
directory written into the file without anyone choosing them; delete those lines to
let the variables speak again.

### The configuration keys

| Key | Default | What it does | Applies |
| --- | --- | --- | --- |
| `server.host` | `127.0.0.1` (the container image: `0.0.0.0`) | The address the server listens on. Anything but loopback makes it reachable from your network — over plain HTTP. | restart |
| `server.port` | `8080` | The port. In a container, change the port mapping too. | restart |
| `server.trustProxy` | off | Trust a reverse proxy's forwarded headers. Only behind a proxy you run. | restart |
| `server.cookieSecure` | off | Mark the sign-in cookie secure. Only with HTTPS in front: over plain HTTP it makes signing in fail silently. | restart |
| `server.clientRoot` | empty (the image: `/app/client`) | Where the web app's files are. | restart |
| `server.mdnsName` | `storyengine` | The name advertised on the local network (`storyengine.local`); empty advertises nothing. | restart |
| `auth.minPasswordLength` | `8` | Minimum password length, checked when a password is set. `0` allows an empty password. | at once |
| `auth.loginScreen` | `form` | `form` or `gallery`. | at once |
| `log.level` | `info` | `silent`, `error`, `warn`, `info` or `debug`. | at once |
| `log.format` | `json` | The only format. | restart |
| `index.rebuildOnStart` | off | Rebuild the search index from disk on every start. | restart |
| `sessions.snapshotEveryNTurns` | `10` | How often a session's state is checkpointed. You should not need to change it. | at once |
| `sessions.streamKeepaliveMs` | `15000` | How often a live stream is kept alive. | new connections |
| `sessions.streamCoalesceMs` | `250` | How long streamed text gathers before it is saved. | at once |
| `limits.maxUploadMb` | `64` | The largest single upload: a file to import, a picture. | at once |
| `limits.maxImportUploadMb` | `1024` | The largest archive or database the one-file import takes (an Aventuras backup, a zip). | at once |
| `limits.contextTokens` | `8192` | The context window a turn assembles into when the connection does not say. | at once |
| `limits.reservedCompletionTokens` | `1024` | Room held back for the reply when a call does not say how long it may be. | at once |
| `limits.providerTimeoutMs` | `300000` | How long a model call may make no progress before it is abandoned. `0` turns it off. | at once |
| `trash.retentionDays` | `30` | How long deleted things stay in the trash. | at once |
| `backup.frequency` | `off` | Scheduled install backups: `off`, `daily` or `weekly`. | at once |
| `backup.onStart` | off | Take a backup when the server starts. | next start |
| `backup.contents` | `full` | `full`, or `redacted` to leave secrets out of scheduled archives. | at once |
| `history.keepPerObject` | `50` | Versions kept per library object; `0` keeps every one. | at once |
| `updates.checkEnabled` | on | The daily check for a newer build. | at once |
| `updates.channel` | `latest` | `latest`, `testing` or `nightly`. | at once |

`limits.extensionStorageQuotaMb` and `dev.enabled` are stored but nothing uses them
yet.

### Reaching the install by name

When the server listens beyond loopback it advertises itself on the local network,
so people can open `http://storyengine.local:8080` instead of typing an address.
Two installs on one network need two names (`server.mdnsName`). Containers on
Docker's default network usually cannot advertise to the rest of the house;
[Running a built StoryEngine](../deploy.md#reaching-it-by-name) has the details.

## Good to know

- The install's configuration, accounts and every account's files all live in the
  data directory. Backing that up is backing up the install.
- Administrators cannot change another person's display name or picture, and
  nobody can change a handle.
- Raising the minimum password length never locks anyone out: it is checked when a
  password is set, not when someone signs in.
- An administrator can turn off or demote their own account as long as another
  administrator who can sign in remains.
- Turning an account off, or removing it, ends its sign-ins at once. Changing a
  password does not, and there is no "sign out everywhere".
