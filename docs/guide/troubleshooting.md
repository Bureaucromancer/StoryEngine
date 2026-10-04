# Troubleshooting

What the common refusals and failures mean, and what to do about them, roughly in the order
people meet them. Two places tell you most of what is going on:

- **The workbench** (**Workbench** in the header, or **Ctrl+`** when the keyboard is not in a
  text box) — over a turn, every step with what it did, every model call with what was sent
  and how it ended, and why each lore entry that went in fired. The entries that did *not*
  fire, and why, are listed only in its preview while you type a move.
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
| Signing in seems to work and you are still signed out | `server.cookieSecure` is on while the site is reached over plain HTTP from another machine, so the browser drops the sign-in. Turn it off in `config.json` and restart. |
| *Your sign-in has ended.* | It expired (sign-ins last 14 days), you signed out in another tab of this browser, or an administrator turned the account off. Copy anything unsaved before you leave the page or switch tabs, then **Sign in again**. |
| *The server could not be reached.* | The app loaded but the server did not answer — it has stopped or is restarting. **Try again** once it is back. (If the server is not running at all, the browser shows its own error page instead.) |
| Nobody can sign in as an administrator | Reset a password from the server's console: see [Lost passwords](settings-and-accounts.md#lost-passwords). |

## A turn did not finish

A failed turn stays in the story as *This turn did not finish.* with a sentence saying why.
That sentence is worked out from the kind of failure alone; the notification for the turn —
sent only if you were not on the session's page — can say more. Fix the cause, then **Redo**
the turn. For anything that names the endpoint, the key or the model, **Test** on the
connection's row (Settings → **Administration** → **Connections**, or Settings → **Your
connections** for your own) tries it without taking a turn and says which of the three it is —
see [Trying a connection](connections-and-models.md#trying-a-connection).

| The sentence | Check |
| --- | --- |
| *No connection is set up for the model this step needs.* | Settings → **Which models your stories use**: *Writing the story* needs a model. If the row names one now, it was set after this turn failed: **Redo** the turn. If it says *Nothing — this will fail*, or that the connection has been removed, choose another model there. |
| *Nothing answered at the model endpoint. Check that it is running and that the address is right.* | Start Ollama, LM Studio or whatever serves the model, and check the connection's **Address**, including `/v1`. In a container, `localhost` is the container: use the host's address — and the model server must listen beyond its own machine (Ollama does only with `OLLAMA_HOST=0.0.0.0`; LM Studio needs its **Serve on Local Network** setting). |
| In the notification: *Nothing answered at the model endpoint on this network. The model server is probably not running.* | As above, for an address on your own network. |
| In the notification: *The model endpoint did not answer, though this server's internet is working. Check the address in Settings.* | The connection's **Address**, including `/v1`. |
| In the notification: *This server appears to have no internet access* | The server cannot reach the internet; a model on your own network would still work. |
| *The model endpoint refused the request. Check the key, the model name and the permissions in Settings.* | A wrong key, or a model name the endpoint does not serve — **Ask the endpoint what it offers** lists the ones it does. A stalled call reads like this in the story too; the notification says which it was. |
| *The model endpoint is busy or having trouble. Try again in a moment.* | Rate-limited or failing at the provider's end, after two retries. |
| In the notification: *The model endpoint accepted the request and then went quiet.* | Nothing arrived for `limits.providerTimeoutMs` (five minutes). A slow local model may need it raised, or `0` for no limit. |
| *The model's context window is too small to hold anything beside its reply.* | Raise the connection's **Context window**, or lower the session's **Maximum reply length**. |
| *The server could not finish the turn. Nothing is wrong with your connection.* | Also what a turn you stopped yourself says. Otherwise, the workbench and the log say what failed. |

If no model is set up at all, the play page says *No model is set up to write with yet, so a
move cannot be sent.* before you even try. See [Connections and models](connections-and-models.md).

## The story will not move

| You see | Why |
| --- | --- |
| *This session already has a turn in flight.* | A turn is running — perhaps started in another tab or on another device. Wait for it, or **Stop** it. |
| *A turn is running. Try again when it has finished.* | The same, for a change made from a panel. |
| *The session has moved on since this was composed.* | Another tab or device moved the story on. Your text is still in the box, but a reload empties it: copy it first, or switch to another tab and back, which brings the page up to date without losing it. Then send again. |
| *This server is restarting. Your next turn will go through once it is back.* | Wait a few seconds. |
| *Nobody here can reply: everyone is muted or gone.* | In a Scene, unmute someone in the cast, or name somebody with **Who speaks next** or **Speak**. A line you type now is recorded, but nobody answers it either. |
| Your line is recorded and nobody answers | In a Scene with **Who replies** set to **Only who I ask, or one at random when I let them talk**, a typed line gets no reply; use **Speak** or **Who speaks next**. |
| *That turn changed no channel state.* | **Undo** reverses a turn's changes to the story's state, not its text. To drop a reply, use **Continue from here** on the turn before. |
| *Something has written those channels since. Branch instead.* | A later turn changed the same state. In Scene every turn moves the clock on, so **Undo** works only on the newest turn there. |

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
connection marked as making pictures (**Makes pictures** on the connection, and **Test** →
**Try a picture** on its row to check it does), *Making images* bound, and *Quick background
jobs* bound — for automatic backdrops as well as illustrations. Automatic pictures that cannot be
made are skipped without a message. Over the turn, the workbench's **Pictures** section says why a
picture that was meant to be made was not; a turn with no **Pictures** section at all usually
means one of those two jobs is unbound. *Nothing is set up to make pictures.* on a placeholder
means no connection you may use is marked as making pictures.

*Making a picture of this…* that never ends means the image endpoint stalled. Image requests
have no time limit; restart the server, then **Try again**.

*That did not come out.* can be a rate limit or a server error as well as an endpoint that
could not be reached: picture requests are asked once and never retried for you, so wait a
moment and press **Try again**. If every picture fails with *The image service refused
this one.* after you set **Sends a seed with a picture** to **Yes** on the connection, the
endpoint does not accept a seed — set it back.

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
- **The lorebook changed while you were editing** and the like mean something else wrote the
  file after your page loaded it: load the newer version and reapply your edits, or save yours
  as a copy. **The connection file changed on disk** offers only **Load what is on disk**, which
  drops what you typed, or **Overwrite with mine**.
- **A second server on the same data directory** stops at once with *Another StoryEngine server
  is using …*. Give each server its own data directory.
