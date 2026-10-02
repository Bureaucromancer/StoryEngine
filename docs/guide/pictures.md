# Pictures

StoryEngine can draw pictures of the story as you play — an **illustration** of a
turn, shown in the transcript, and in Scene a **backdrop** of where the story is, shown
above it. It can also show the model a picture of **your own**, attached to a move.

Pictures are made in the background after a turn's text is finished, so the story
never waits for one. A picture that fails becomes a placeholder with **Try again**; it
never fails the turn.

## Before any picture

Three things have to be in place, and the first can only be done by editing a file:

1. **A connection that makes pictures.** Its endpoint must answer OpenAI's image API
   (`/images/generations`) with the picture inline as base64 — an endpoint that answers
   with a link to the picture fails. The connection has to say it makes pictures, and
   there is no control for that in Settings yet: add `"rendersImages": true` to the
   `capabilities` in the connection's file (see
   [Connections and models](connections-and-models.md#editing-connection-files-by-hand)).
   Pictures are requested from the **first** connection you may use that says so — your
   own before the install's — so mark only the connection you mean.
2. **The job *Making images* bound** to the image model — in Settings → **Which models
   your stories use**, or for the whole install in **What each job uses**.
3. **The job *Quick background jobs* bound**, for illustrations: a quick model writes the
   short description of the moment a picture is drawn from.

Until then, **Illustrate** answers *Nothing is set up to make pictures yet.*, and
automatic pictures are silently left out.

## Illustrations

### Choosing how a session illustrates

In the session panel (*Prompted with …*) → **Pictures** → **Illustrate the story**:

- **Never** — no pictures, and no **Illustrate** buttons. The default for Freeform and the
  assistant.
- **Only when I ask** — **Illustrate** works; nothing runs on its own. The default for
  Scene.
- **Every turn** — after each turn, a picture of its moment, if it has one worth a picture.
  That costs one quick model call per turn, plus the picture.

The setting is part of the story's state: rewinding past a change puts it back.

### Illustrating a turn

**Illustrate**, under any turn with text, draws that turn — as it was **then**: its
moment, who was in the room at the time (not anyone dead, departed or muted), and where it
happened. *Making a picture of this…* holds the picture's place until it arrives. In
Freeform the picture goes after the sentence it shows; in Scene, at the end of the turn.

Each press makes a **new version**; nothing is replaced. A turn with several shows the
newest, with **Versions** — **1**, **2**, … — under it to choose another; the choice is
kept with the session and shows in the reading view too.

Once a picture has started there is no way to cancel it from the app. Leaving the page
before the server has accepted the request cancels it.

**Try again**, on a picture that did not come out, runs the same recipe again without
another description call:

| The placeholder says | Because |
| --- | --- |
| *Nothing is set up to make pictures.* | No connection you may use says it makes pictures. |
| *The image service refused this one.* | The endpoint refused it: a wrong key or model, a refused prompt, a picture sent as a link, or — after repeated tries — a rate limit. |
| *That did not come out.* | The endpoint could not be reached. |
| *The server restarted while this was being made.* | The picture was cut off by a restart. |
| *The picture was cleared to save space.* | The picture's file is gone from the disk. |

The recipe records a seed, but this build does not send the seed to the endpoint, so
**Try again** makes a new picture from the same prompt rather than the same picture again.

## Backdrops

*Scene only.* **Stage a backdrop**, among the switches above the transcript, keeps a
picture of where the story is above the transcript. It is off by default.

While it is on — or while **Show the scene** is — a model call after each reply names the
place in a few words. The place shows as **Place** in the strip at the top, and the narrator
is told it. When the place changes, a backdrop is drawn from the place and the treatment's
tone (no characters, no moment), and shown as soon as it arrives.

A place you have been before is not drawn again: if a finished backdrop was made from the
same recipe — the same words for the place, the same tone, the same image model — it is
shown again instead. The place is in the model's words, so *the harbourmaster's office* and
*the harbour master's office* are two backdrops.

**Set the scene** draws a new backdrop of the current place at any time, even with **Stage
a backdrop** off. It appears once **Stage a backdrop** has been switched on or off at least
once in the session, and needs a known place: otherwise *The story has not said where this
is yet, so there is no place to draw.*

Turning **Stage a backdrop** off stops new backdrops but leaves the current one showing.
There is no control yet for choosing among earlier backdrops, for retrying one that failed
(**Set the scene** makes a new one), or for deleting pictures.

## Faces

*Scene only.* With **Show the scene** on, the same call that names the place picks an
**expression** for each character in the scene who has a set of expressions, from that set
only, and only when the reply shows it. The faces appear under each turn — every
character's *current* face.

Expressions come with imported CHARX cards; see
[Modes](modes.md#time-place-and-the-stage). Each speaker's round **portrait**, beside their
lines and in the cast, is the character's reference picture or card image — or their
initial — and does not change with expression. Nothing in StoryEngine draws portraits or
expressions.

## What the image model is told

An illustration's prompt is built from the turn's moment, the characters in it, the
treatment's tone, the place and the time — in that order of importance, with the least
important dropped first if the endpoint limits prompt length. A backdrop's is the place and
the tone.

Characters' **names never reach the image model**: each becomes *someone*. A character is
described only by their recorded appearance — build, hair, eyes, face, clothing,
accessories — and characters imported from SillyTavern or CHARX cards have none, so they
add nothing to a picture. Aventuras characters bring theirs.

## Showing the model a picture

**Attach a picture**, in the composer, adds up to four pictures to a move — PNG, JPEG or
WebP, up to 8 MB each. A move can be pictures alone. Before uploading, your browser redraws
each one the right way up, removes its location and other metadata, and scales it to at
most 1,568 pixels on its longer side.

Each picture gets a caption, **What it shows**. Under it the composer says what will
happen:

- *The model will see this picture.* — the model answering is ticked under its connection's
  **Models that can see pictures**.
- *The model will get your caption instead: …* — with the reason: the model is not marked as
  seeing pictures, the picture is not on this server, the budget left it out, and so on.

Only the move being sent carries pixels. One turn later the same picture travels as its
caption, and that is what search, lore matching and summaries see too. **Redo**, **Reroll**
and Scene's swipes and edits send a move's pictures again.

In the transcript, a move's pictures appear as thumbnails with their captions. A picture
uploaded but never sent is cleared from the server after a day.

## The workbench

The workbench's **Pictures** section, over a turn, shows each picture's recipe: what it is
for, the model asked, the seed, the anchor sentence for an illustration, and every piece of
the prompt, with any that were dropped struck through. When a turn made no picture it says
why: the place had not changed, there was no moment worth a picture, nothing is bound for
*Making images*, or the place had been drawn before.

The block table marks a picture on a move as **Picture sent**, **Picture as words** or
**Picture dropped**.

## Good to know

- **Costs.** An illustration is one quick model call plus one picture; **Every turn** does
  that every turn. Staging the scene costs one call on *Writing the story* after **every**
  reply, to name the place, even when no picture is drawn. The description calls appear on
  the turn's record or in your usage log; image calls are not counted anywhere.
- **Hidden retries.** An image request that the endpoint answers with a rate limit or a
  server error is retried up to twice by the underlying library before it is reported —
  and each attempt may be billed by a paid service.
- **No time limit.** Image requests are not bound by the provider timeout. A stalled image
  endpoint leaves *Making a picture of this…* until the server restarts, after which **Try
  again** works.
- **Notifications** say *A picture is ready* or *A picture could not be made* — but not
  while you have that session open, so a backdrop that fails while you watch fails quietly.
  The workbench says what happened.
- Pictures are stored with their session, and go to the trash and into backups with it. A
  session export carries the pictures' records and captions, not the pictures.
