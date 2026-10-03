# Connections and models

StoryEngine has no model of its own. Every word it writes comes from a model
endpoint you point it at, and two ideas decide which one answers:

- A **connection** is one endpoint: an address, a key if it needs one, and the
  names of the models it serves.
- A **job** — *Writing the story*, *Making images* and so on — is bound to one
  model on one connection. The install sets a default for each job, and each
  person can choose differently for their own stories.

Nothing in StoryEngine names a model directly. A turn asks for the job *Writing
the story*, and whatever is bound to that job answers. In the code and in the API
a job is called a **role**.

## What can be connected

StoryEngine speaks the **OpenAI-compatible** chat API, and only that. In practice
that covers most things people run:

- a model on your own machine or network — Ollama, LM Studio, llama.cpp's server,
  vLLM, KoboldCpp's OpenAI-compatible endpoint;
- hosted services with an OpenAI-compatible API;
- OpenAI itself.

There is no native adapter for other APIs, and no raw text-completion mode.

The address is the API's base, **including** any `/v1`: StoryEngine appends
`/chat/completions`, `/models` and `/images/generations` to it. For Ollama that is
usually `http://localhost:11434/v1`, for LM Studio `http://localhost:1234/v1`. If
StoryEngine runs in a container, `localhost` is the container itself; use the
host's address instead.

## Adding a connection

*Administrators only, for the install's connections.* Settings → **Administration**
→ **Connections** → **Add a connection**. The install's connections are shared by
everybody; keys stay on the server and are never sent back to a browser.

| Field | What to put |
| --- | --- |
| **Name** | Anything that tells you which endpoint this is. Every account sees the names of the install's connections when choosing models, though not their addresses or keys. |
| **Kind** | **OpenAI-compatible** — the only kind. |
| **Address** | The base URL. Blank means OpenAI itself. |
| **Key** | The API key, if the endpoint needs one. Most local runtimes do not. |
| **Models** | Model names, separated by commas. |

**Ask the endpoint what it offers**, under Models, fetches the endpoint's model list
(it gives up after ten seconds) and shows a checkbox for each, with **Use all of
them** and **Use none of them**. Ticking writes the names into Models; you can
always type names yourself, which matters when the list an endpoint gives is not
what it actually serves. The button uses the
address and key as typed in the form. When you edit a connection the stored key is
not sent, so an endpoint that needs one answers *That endpoint refused the key*
unless you type the key again.

**What this endpoint can do**, a disclosure below Models, holds three things you
set only if you know them:

- **Context window** — how many tokens the endpoint accepts in one request. Blank
  uses the install's default (`limits.contextTokens`, 8192 unless changed). If your
  model takes more, saying so gives stories more room; saying more than it really
  takes makes the endpoint cut the prompt short, or refuse it — which reads as
  *The model endpoint refused the request…*, not as a window problem. See
  [Context window and reply length](#context-window-and-reply-length).
- **Reports token counts** — **Use the default for this kind** (which is yes),
  **Yes** or **No**. With **No**, the workbench shows estimated counts.
- **Models that can see pictures** — appears once **Models** holds at least one
  name. Tick the models that accept images. A picture
  a player attaches to a move is sent as a picture only to a ticked model; every
  other model gets the player's description of it instead. Nothing is ticked by
  default.

**Save** stores the connection on the server. The list then shows each connection
with **Edit**, **Remove** *name*… and a line saying whether a key is stored.

### Use this for everything?

When an administrator saves a connection and nothing on the install is bound to
any job yet, StoryEngine offers to set everything up at once: pick **The good one**
and **The cheap one** from the connection's models and press **Use these**.

| Pick | Bound to |
| --- | --- |
| **The good one** | *Writing the story*, *Working things out* |
| **The cheap one** | *Quick background jobs*, *Reading images*, *Searching your library* |

*Making images*, *Making video* and *Speech* are left alone. **Not now** leaves
everything unbound, and the offer comes back after the next save. It appears
whenever nothing at all is bound on the install, so setting every job back to
**Nothing** brings it back too.

### Editing and removing

**Edit** reopens the form. The **Key** box is always empty: leave it blank to keep
the stored key, or type a new one to replace it. (A stored key cannot be cleared
from the form; remove the connection and add it again.) Blanking **Address** points
the connection back at OpenAI.

If the connection's file was changed on the server since the page loaded, saving
says *The connection file changed on disk since this page loaded* and offers **Load
what is on disk** or **Overwrite with mine**.

**Remove** *name*… asks first, saying how many people's job choices point at the
connection, and **Remove it** removes it. Those choices fall back to the install's
default, or stop working if there is none. Removing a connection stops its key
being used here at once, but revokes nothing at the provider — do that there too
if the key has leaked.

## Your own connections

Settings → **Your connections**, on any account an administrator has not barred
from keeping its own (accounts may by default). The form is the same, and so is
editing. Four differences:

- The connection and its key are yours alone.
- There is no *Use this for everything?* offer.
- **Remove** *name*… does not say what points at the connection.
- **Adding a connection does not use it.** It is used only once you choose one of
  its models under [Which models your stories use](#choosing-models-for-your-own-stories)
  — with one exception: a connection of yours whose file says it makes pictures
  takes your picture requests ahead of the install's (see
  [Which model answers](#which-model-answers)).

If an administrator turns off **May use their own connections** for your account,
your connections stay on disk but are not used, and your choices that named them
fall back to the install's defaults.

## Jobs

Each job, what it is called on screen, and what uses it today:

| On screen | Role name | Used for |
| --- | --- | --- |
| **Writing the story** | `prose` | Almost everything: the narration and characters in every mode, the assistant, summaries, memory extraction, choosing plot hooks, judging goals, suggested actions, scene direction, choosing who speaks next, **Draft my next message**, and help writing library fields. |
| **Quick background jobs** | `fast` | Writing the short description a picture is drawn from. Help writing library fields, if you choose it. |
| **Working things out** | `reasoning` | Help writing library fields, if you choose it. |
| **Making images** | `image` | Pictures — see [Pictures](pictures.md). |
| **Reading images** | `vision` | Nothing yet. |
| **Searching your library** | `embedding` | Nothing yet. |
| **Making video** | `video` | Nothing yet. |
| **Speech** | `speech` | Nothing yet. |

*Writing the story* is the one that matters: a turn cannot run without it. Binding
a cheaper model to *Quick background jobs* saves very little today, because the
background work — summaries, memory, judging — also runs on *Writing the story*.

### The install's defaults

*Administrators only.* Settings → **Administration** → **Connections** → **What each
job uses**: one row per job, with **Model**, **Where it comes from** and a picker
under **Change it**. Pick **Nothing** or one of "*connection* · *model*". It saves
the moment you choose.

### Choosing models for your own stories

Settings → **Which models your stories use** has the same rows. Each job starts at
**Use this install's default**; choose any model on a connection you may use —
your own first, then the install's — and it applies to your stories only. You need
no key of your own to choose a different model on one of the install's
connections. It saves as you choose.

**Writing help in the library** chooses which job's model writes when you ask for
help with a field: **Writing the story** (the default), **Quick background jobs** or
**Working things out**. The line under it says which model that is right now.

### Which model answers

For each call, StoryEngine takes the first of these that leads to a connection you
may use:

1. your own choice for that job;
2. the install's default for that job.

**Pictures are the exception.** The *Making images* choice decides whether a picture
is attempted and which model is asked for, but the request goes to the first
connection you may use that is marked as making pictures — your own before the
install's — whichever connection the choice names. See
[Pictures](pictures.md#before-any-picture).

A choice whose connection has been removed, or that you are no longer allowed to
use, falls through to the next without a warning. If nothing resolves, a turn
fails with *No connection is set up for the model this step needs. Bind one in
Settings.*; **Draft my next message** and writing help in the library say the same
in their own words. The **Where it comes from** column says which layer won: *This
install's default, on …*, *Your own setting, on …*, or, when nothing resolves, that
nothing is set or that *The connection this was set to has been removed.* An
unbound *Making images*, *Making video* or *Speech* reads *Nothing can do this yet,
and nothing needs to.*

(The API can also override a job for one session or one step of a turn; there is
no control for it in the app.)

On the play page, a session whose *Writing the story* resolves to nothing says *No
model is set up to write with yet, so a move cannot be sent.* with a link to
**Choose one in Settings**. Administrators see a warning on Settings →
Administration → **Accounts** for every account in that state.

## Context window and reply length

How much of the story fits in a prompt is worked out per call:

1. **The window** is the connection's **Context window**, or `limits.contextTokens`
   (8192) if the connection does not say.
2. **The preset uses a share of it.** All three shipped presets use 75%.
3. **Room is held back for the reply**: the call's own length, then the preset's
   reserve, then `limits.reservedCompletionTokens` (1024). The shipped Scene and
   Freeform presets ask for replies of up to 800 tokens, the assistant's for 900.

What does not fit is dropped by priority — the oldest history and the least
important lore first — and the workbench says what was dropped and why. If the
window is too small to hold anything beside the reply, nothing is sent and the
turn fails with *The model's context window is too small to hold anything beside
its reply.* With the shipped Scene and Freeform presets that happens below about
1,070 tokens.

## Sampler settings that reach the model

A preset can carry many sampler settings, often from an imported SillyTavern
preset, but only these are sent to an OpenAI-compatible endpoint: temperature,
top-p, frequency and presence penalty, maximum tokens, stop sequences, and a seed
of zero or more. Top-k, top-a, min-p and repetition penalty are kept with the
preset but never sent. See [Presets and prompts](presets.md).

## Timeouts and retries

- **`limits.providerTimeoutMs`** (five minutes by default) is how long a call may go
  **without progress** before it is abandoned. Every streamed piece of text resets
  the clock, so a long reply is fine; a call that does not stream is bounded as a
  whole. `0` turns it off, leaving only **Stop**. Picture requests are not bound by
  it.
- **Retries**: a call that got no answer at all, or an HTTP 429 or 5xx, is tried up
  to twice more, after a quarter of a second and then a second — but only if no
  text has streamed yet and you have not pressed **Stop**. Any other refusal (a bad
  key, an unknown model) is not retried. The workbench shows how many retries a
  call took. Picture requests are not retried at all: each is sent once (see
  [Pictures](pictures.md#good-to-know)).

## When a call fails

You are never shown the provider's raw error; it goes to the server's log. You see
a sentence that names what to fix:

| What happened | What you see |
| --- | --- |
| Nothing is bound for the job | *No connection is set up for the model this step needs. Bind one in Settings.* |
| The window cannot hold the prompt and the reply | *The model's context window is too small to hold anything beside its reply. Raise the context window in the connection's settings, or lower the reply length.* |
| HTTP 429 or a 5xx, after retries | *The model endpoint is busy or having trouble. Try again in a moment.* |
| Any other refusal — wrong key, unknown model name, a bad request | *The model endpoint refused the request. Check the key, the model name and the permissions in Settings.* |
| The call stalled past the timeout | *The model endpoint accepted the request and then went quiet.* |
| Nothing answered, at a local address | *Nothing answered at the model endpoint on this network. The model server is probably not running.* |
| Nothing answered, at a remote address, and the server's last check found no internet | *This server appears to have no internet access, so it could not reach the model endpoint.* |
| Nothing answered, at a remote address, with internet working | *The model endpoint did not answer, though this server's internet is working. Check the address in Settings.* |

A failed turn stays in the story with *This turn did not finish.* and the sentence;
the notification for it carries the most precise version. (The transcript's
sentence is worked out from the kind of failure alone, so a stalled call can read
there as a refusal, and every unanswered call reads *Nothing answered at the model
endpoint. Check that it is running and that the address is right.*, local or not;
the notification tells them apart.) The workbench over the
turn names the step that failed. See [Troubleshooting](troubleshooting.md) for the
order to check things in.

"Local" means `localhost`, a `.local`, `.lan` or `.home.arpa` name, or a private
address such as `192.168.x.x`, `172.16.x.x`–`172.31.x.x` or `10.x.x.x`. Any other
name counts as remote — including `host.docker.internal` and a Compose service name
such as `ollama` — so a stopped model server at one of those gets the remote
sentences rather than *probably not running*. The internet check is the daily
update check; with it turned off, an unanswered remote endpoint gets *Nothing
answered at the model endpoint. Check that it is running and that the address is
right.*

## Editing connection files by hand

Connections are JSON files on the server — the install's in
`data/system/connections/`, yours in `data/users/<handle>/connections/` — and job
bindings are `data/system/bindings.json` and `data/users/<handle>/bindings.json`.
Editing them by hand is supported and takes effect at the next call; no restart is
needed. A connection file looks like this:

```json
{
  "id": "0199c0de-0000-7000-8000-000000000001",
  "label": "Ollama on the desk",
  "provider": "openai-compatible",
  "baseUrl": "http://192.168.1.20:11434/v1",
  "models": ["llama3.1:8b", "qwen2.5:14b"],
  "imageModels": [],
  "capabilities": { "maxContextTokens": 32768 }
}
```

Any file name ending in `.json` will do. A file that does not parse, or has no `id`
or `provider`, is ignored, and nothing says so. A key goes in `"apiKey"`; keys are
stored in these files as plain text, a full backup includes them, and a redacted
one leaves every `connections/` folder out.

A few capabilities have no control in the app and are set by editing the file (or
through the API). The one you are most likely to need is `"rendersImages": true`,
which says the endpoint can make pictures. It goes **inside** `"capabilities"`, as
in `"capabilities": { "maxContextTokens": 32768, "rendersImages": true }`; at the top
level it is ignored. See [Pictures](pictures.md#before-any-picture).

Beside it, `"supportsImageSeed": true` says the endpoint accepts a `seed` with a picture
request, so each picture's seed is sent and **Try again** can redraw the same picture.
It is off unless you set it, because an endpoint that holds strictly to OpenAI's image
API refuses the unknown field, and every picture would then fail. See
[Pictures](pictures.md#illustrating-a-turn).

If two files in one folder claim the same `id`, the one whose **Name** (`label`)
sorts first is used; the file name plays no part, so renaming either connection can
change which copy wins. The other row says so and has no **Edit** or **Remove**
button. Delete the extra file by hand: removing the connection in the app removes
every file with that id.

## Good to know

- Changes to connections and bindings apply to the next call, from the app or from
  a file.
- Removing a model name from a connection does not unbind jobs that use it; they
  go on asking for that model, and the picker marks it — *no connection offers
  this any more* under **What each job uses**, and *on a connection that is gone*
  under **Which models your stories use**, although the connection is still there.
- The workbench shows which **model** answered each call, not which connection.
- Money is never counted. Token counts are shown where the endpoint reports them.
- A connection whose file names any other kind — `"provider": "anthropic"`, or
  even `"openai"` — is listed, but every call to it fails, and a turn reports it
  misleadingly as *The server could not finish the turn. Nothing is wrong with your
  connection.* Only `"openai-compatible"` works, for OpenAI itself too.
