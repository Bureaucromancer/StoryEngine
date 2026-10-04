# Getting started

From a running server to your first turn. It takes a model endpoint — a local Ollama or LM
Studio is enough — and about ten minutes.

## 1. Run the server

[Running a built StoryEngine](../deploy.md) covers the three ways a built StoryEngine runs:
the container image with `compose.yaml`, the unraid template, and a tarball with a systemd
unit. The [README](../../README.md#running-it) covers running it from source.

**Today, from source is the only one of these open to anyone but the maintainer.** The image is
not published and no tarball has been built; the repository is public, but nothing in it has been
released ([releases §0.1a](../design/workplan/04-repo-and-releases.md)).

By default the server is at port 8080: `http://localhost:8080` on the machine itself, or —
once it listens beyond its own machine — that machine's address and port 8080 from elsewhere
on your network. It also advertises `http://storyengine.local:8080`, though a container on
Docker's default network usually cannot reach the rest of the house with that name. (Run from
source with `pnpm dev`, the page is at `http://127.0.0.1:5173`; port 8080 is the API alone.)

## 2. Create the first account

The first time you open StoryEngine it asks for the first administrator: a **Handle** (lowercase
letters, digits and hyphens; it can never be changed), a **Display name (optional)**, and a
**Password**. If the server can be reached from your network, it also asks for the **Setup
token**, which the server prints in its log on every start until an account exists — for the
container, `docker compose logs storyengine | grep 'setup token'`.

**Create account** signs you in.

## 3. Connect a model

Settings → **Administration** → **Connections** → **Add a connection**:

- **Name** — anything, such as *Ollama*.
- **Address** — the endpoint's OpenAI-compatible base, including `/v1`: for Ollama usually
  `http://localhost:11434/v1`, for LM Studio `http://localhost:1234/v1`. If StoryEngine runs in
  a container, `localhost` means the container: use the address of the machine the model runs
  on instead — and make the model server listen beyond its own machine, which neither does by
  default (Ollama with `OLLAMA_HOST=0.0.0.0`, LM Studio with its **Serve on Local Network**
  setting).
- **Key** — only if the endpoint needs one.
- **Models** — press **Ask the endpoint what it offers** and tick the models you want, or type
  their names.

**Save**. Because nothing is set up yet, StoryEngine offers **Use this for everything?**: choose
**The good one** — the model you want to write the story — and **The cheap one**, and press **Use
these**. **Test** on the connection's row sends it one short message and says whether the key,
the address and the model work — or which of them to fix.

Settings → **Which models your stories use** should now show a model against **Writing the
story**. That is the one job a turn cannot do without. See
[Connections and models](connections-and-models.md).

## 4. Find someone to talk to

Your library starts empty, apart from a few shipped objects. Either:

- **Import a character** you already have: **Library** → **Import…** → **Choose a file…**, pick a
  SillyTavern character card (`.png` or `.json`), then **Import**. To bring in a whole
  SillyTavern, Marinara or Aventuras library, see [Importing and exporting](importing-and-exporting.md).
- **Make one**: **Library** → **New actor**, give it a **Name** and fill in its sections — at least
  the **Summary** — then **Save**.

## 5. Start a story

**Play**, in the header:

1. Under **Characters**, tick your character.
2. Optionally give the session a name in **Name it now, or later**.
3. Press **Start**. The new session appears at the top of the list — click it to open it.

That starts a **Scene**, a chat with the character. If the card has a greeting, it is already
the story's first turn.

## 6. Take a turn

Type in the box at the bottom and press **Enter**. The reply streams in.

Then try the controls under each turn, which appear when you point at the turn (or move to it
with the keyboard; on a touch screen they are always shown):

- **Redo**, under the reply, for another attempt. The page moves to the new attempt and keeps the
  first; **‹ 2 of 2 ›** steps between them.
- **Continue from here**, on an earlier turn, to take the story another way from there. Nothing is
  lost.
- **Workbench**, in the header, to see exactly what was sent to the model and why. (**Ctrl+`**
  toggles it too, but not while the keyboard is in the message box.)

## Where next

- [Playing a session](playing.md) — everything on the play page, branching and rewinding, the
  panels, reading and searching.
- [Modes](modes.md) — group chats, who replies, the agents that keep track of the story, and
  Freeform stories.
- [Lorebooks and memory](lorebooks-and-memory.md) — giving the story a world it can remember.
- [Pictures](pictures.md) — illustrations and backdrops, which need a little more setting up.
- [Settings, accounts and the install](settings-and-accounts.md) — adding accounts for other
  people (Settings → Administration → **Accounts** → **Add someone**).
- [Backups, restore and the trash](backups-and-trash.md) — before you have anything you would
  hate to lose.
