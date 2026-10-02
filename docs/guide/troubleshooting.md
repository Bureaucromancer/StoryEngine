# Troubleshooting

What the common refusals and failures mean, and what to do about them, roughly in the order
people meet them. Two places tell you most of what is going on:

- **The workbench** (**Ctrl+`**) — over a turn, every step with what it did, every model call
  with what was sent and how it ended, and why lore did or did not fire.
- **The server's log** — `docker compose logs storyengine` for the container, `journalctl -u
  storyengine` for the systemd install. A provider's own error messages go here, never to the
  page. Setting `log.level` to `debug`, under Settings → Administration → **This install**,
  makes it chattier, at once.

When you report a problem, Settings shows the **Version** and **Commit** at the top.

## Signing in

| You see | What to do |
| --- | --- |
| *That handle and password were not recognised.* | Check the handle, which is lowercase. The same words are shown for a wrong password and for an account that has been turned off. |
| *This install needs the setup token from the server console.* | Copy the token from the server's log, or from `state/setup.token` in the data directory. See [Running a built StoryEngine](../deploy.md#first-run). |
| Signing in seems to work and you are still signed out | `server.cookieSecure` is on while the site is reached over plain HTTP, so the browser drops the sign-in. Turn it off in `config.json` and restart. |
| *Your sign-in has ended.* | It expired (sign-ins last 14 days), or you signed out elsewhere, or an administrator turned the account off. Copy anything unsaved, then **Sign in again**. |
| *The server could not be reached.* | The server is not running, or not at that address. **Try again** once it is. |
| Nobody can sign in as an administrator | Reset a password from the server's console: see [Lost passwords](settings-and-accounts.md#lost-passwords). |

## A turn did not finish

A failed turn stays in the story as *This turn did not finish.* with a sentence saying why.
Fix the cause, then **Redo** the turn.

| The sentence | Check |
| --- | --- |
| *No connection is set up for the model this step needs.* | Settings → **Which models your stories use**: *Writing the story* needs a model. If it shows one, its connection may be gone or barred to you. |
| *Nothing answered at the model endpoint on this network. The model server is probably not running.* | Start Ollama, LM Studio or whatever serves the model. In a container, `localhost` is the container: use the host's address in the connection. |
| *The model endpoint did not answer, though this server's internet is working. Check the address in Settings.* | The connection's **Address**, including `/v1`. |
| *This server appears to have no internet access* | The server cannot reach the internet; a model on your own network would still work. |
| *The model endpoint refused the request. Check the key, the model name and the permissions in Settings.* | A wrong key, or a model name the endpoint does not serve — **Ask the endpoint what it offers** lists the ones it does. In the transcript a stalled call can read like this too; the notification says which it was. |
| *The model endpoint is busy or having trouble. Try again in a moment.* | Rate-limited or failing at the provider's end, after two retries. |
| *The model endpoint accepted the request and then went quiet.* | Nothing arrived for `limits.providerTimeoutMs` (five minutes). A slow local model may need it raised, or `0` for no limit. |
| *The model's context window is too small to hold anything beside its reply.* | Raise the connection's **Context window**, or lower the session's **Maximum reply length**. |
| *The server could not finish the turn. Nothing is wrong with your connection.* | Also what a turn you stopped yourself says. Otherwise, the workbench and the log say what failed. |

If no model is set up at all, the play page says *No model is set up to write with yet, so a
move cannot be sent.* before you even try. See [Connections and models](connections-and-models.md).

## The story will not move

| You see | Why |
| --- | --- |
| *This session already has a turn in flight.* | A turn is running — perhaps started in another tab or on another device. Wait for it, or **Stop** it. |
| *A turn is running. Try again when it has finished.* | The same, for a change made from a panel. |
| *The session has moved on since this was composed.* | Another tab or device moved the story on. Your text is kept: reload, then send again. |
| *This server is restarting. Your next turn will go through once it is back.* | Wait a few seconds. |
| *Nobody here can reply: everyone is muted or gone.* | In a Scene, unmute someone in the cast, name somebody with **Who speaks next**, or type a line. |
| Your line is recorded and nobody answers | In a Scene with **Who replies** set to **Only who I ask…**, a typed line gets no reply; use **Speak** or **Who speaks next**. |
| *That turn changed no channel state.* | **Undo** reverses a turn's changes to the story's state, not its text. To drop a reply, use **Continue from here** on the turn before. |

## The model seems not to see something

- **It ignores your latest message.** If the session plays from a preset imported from
  SillyTavern or Marinara, that preset has no slot for your move — a known problem with a hand
  fix in [Presets and prompts](presets.md#imported-presets).
- **A lorebook entry never fires.** Work through
  [When an entry never fires](lorebooks-and-memory.md#when-an-entry-never-fires); the workbench's
  preview, while you type a move, lists every entry that did not fire and why.
- **It has forgotten what happened long ago.** Turns older than the last 20 are sent as a
  summary; see [The running summary](lorebooks-and-memory.md#the-running-summary). Something
  that must not be forgotten belongs in a lorebook or a memory.
- **A character's card prompt is missing.** Card prompts are sent only when characters speak
  in their own voices, and each can be switched off in **How this chat plays** → **What each
  card sends**.
- **It cannot see an attached picture.** The composer says why under the picture; the model
  must be ticked under its connection's **Models that can see pictures**. See
  [Pictures](pictures.md#showing-the-model-a-picture).

The workbench, over the turn, shows every block that was sent and every one that was dropped
for space.

## Starting a session

| You see | What to do |
| --- | --- |
| *That is not what this mode asked for.* | A Freeform start with a question unanswered. Write the premise, and in each of the two lists pick another option and then the one you want — they show a choice before you make one, but record nothing until you change them. |
| You pressed **Start** and nothing opened | The new session is at the top of the list; click it. |
| *No such preset.* | The preset you chose has been deleted since the page loaded. Reload. |

## Pictures

If no pictures appear, work through [Before any picture](pictures.md#before-any-picture): a
connection marked as making pictures (a hand edit), *Making images* bound, and *Quick background
jobs* bound — for automatic backdrops as well as illustrations. Automatic pictures that cannot be
made are skipped without a message. Over the turn, the workbench's **Pictures** section says why a
picture that was meant to be made was not; a turn with no **Pictures** section at all usually
means one of those two jobs is unbound. *Nothing is set up to make pictures.* on a placeholder
means no connection you may use is marked as making pictures.

*Making a picture of this…* that never ends means the image endpoint stalled. Image requests
have no time limit; restart the server, then **Try again**.

## Importing

The panel's review says what happened to every file. For refusals — upload limits, a reverse
proxy's own limit, a running application, a full disk — see
[When an import is refused](importing-and-exporting.md#when-an-import-is-refused).

## Backups and restoring

| You see | What to do |
| --- | --- |
| *There was not enough room on the disk for that backup.* | Free space, or delete old backups: nothing deletes them for you. The check counts files at full size, so it can refuse a backup that would have fitted compressed. |
| *A scheduled backup did not happen* | Usually a full disk, as above. The log has the reason. |
| *A restore did not happen* | The install is as it was. Read the reason, then press **Call it off** under **Restore this install**, or every start repeats the notice. |
| The server will not start after a restore — *written by a newer build* | Restore with the same or a newer build than the one that took the archive. |
| The server cannot be reached after a restore | The restored `config.json` came from the archive, address and port included. Check `server.host` and `server.port` in it. |

See [Backups, restore and the trash](backups-and-trash.md).

## In the browser

- **Copy buttons say *This browser would not copy*, and the operating system's notifications
  will not turn on.** Both need a secure connection, which plain HTTP to a network address is
  not. Select the text by hand, or put StoryEngine behind HTTPS — see
  [Running a built StoryEngine](../deploy.md#notifications-and-what-plain-http-costs-you).
- **No notification for a turn that finished.** No notification is raised for a session you
  have open in any tab or device. Leave the session's page to be told.
- **The first chime is silent.** Browsers play no sound until you have clicked or typed on the
  page.
- **A session's link shows *Nothing answered at the model endpoint … (not-found)*.** The session
  does not exist — it was deleted, or belongs to another account. The message is misleading; the
  model endpoint is fine.
- **The transcript stops at the 100th turn back.** Play shows the most recent 100 turns of the
  line; read further back in the reading view (**Read it as a story**) or find it with **Search**.
- ***This page could not be rendered.*** A page failed; **Back to the library**, and report it
  with the version and commit from Settings.

## Files on disk

- **Files the library could not read**, above the library list, names files that are not valid
  objects — usually a hand edit gone wrong. Nothing was deleted: fix the file, or delete the
  object, and the panel clears itself. See [The library](library.md#files-on-disk).
- **The connection file changed on disk**, **The lorebook changed while you were editing** and
  the like mean something else wrote the file after your page loaded it. Reload and reapply your
  edits, or save as a copy.
- **A second server on the same data directory** stops at once with *Another StoryEngine server
  is using …*. Give each server its own data directory.
