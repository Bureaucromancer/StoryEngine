# Pictures

StoryEngine can draw pictures of the story as you play — an **illustration** of a
turn, shown in the transcript, and in Scene a **backdrop** of where the story is, shown
above it. It can also show the model a picture of **your own**, attached to a move.

Pictures are made in the background after a turn's text is finished, so the story
never waits for one. An illustration that fails becomes a placeholder with **Try
again**; a backdrop that fails simply does not appear. Neither fails the turn.

## Before any picture

Three things have to be in place:

1. **A connection that makes pictures.** Its endpoint must answer OpenAI's image API
   (`/images/generations`) with the picture inline as base64 — an endpoint that answers
   with a link to the picture fails. The connection has to say it makes pictures: edit it,
   open **What this endpoint can do**, and under **Drawing pictures** set **Makes
   pictures** to **Yes** (see
   [Connections and models](connections-and-models.md#adding-a-connection)). Then **Test**
   on its row → **Ask for** *A picture* → **Try a picture** shows whether it really does,
   for the price of one picture. Pictures are requested from the **first** connection you
   may use that says so — your own before the install's — so mark only the connection you
   mean.
2. **The job *Making images* bound** to the image model — in Settings → **Which models
   your stories use**, or for the whole install in **What each job uses**.
3. **The job *Quick background jobs* bound**, for everything except **Set the scene**: a
   quick model writes the short description of the moment an illustration is drawn
   from, and automatic backdrops are left out without it too, though they make no
   quick call.

Until both jobs are bound, **Illustrate** answers *Nothing is set up to make pictures
yet.*, and automatic pictures are silently left out. A missing connection mark gives no
warning in advance: **Illustrate** still spends its quick call, and each picture,
pressed or automatic, fails with *Nothing is set up to make pictures.*

## Illustrations

### Choosing how a session illustrates

In the session panel (*Prompted with …*, or *How this session is prompted*) →
**Pictures** → **Illustrate the story**:

- **Never** — no illustrations, and no **Illustrate** buttons. The default for Freeform
  and the assistant. In Scene, backdrops follow **Stage a backdrop** and **Set the
  scene**, not this setting.
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
newest until you choose one under **Versions** — **1**, **2**, … — and your choice from
then on: a later **Illustrate** on that turn only adds a number, which you choose to see
its picture or its placeholder. The choice is kept with the session and shows in the
reading view too. (Past ten versions of one turn, the numbers sort out of order.)

Once a picture has started there is no way to cancel it from the app. Closing or
reloading the tab while the description is still being written cancels it; going to
another page of the app does not.

**Try again**, on a picture that did not come out, runs the same recipe again without
another description call:

| The placeholder says | Because |
| --- | --- |
| *Nothing is set up to make pictures.* | No connection you may use says it makes pictures. |
| *The image service refused this one.* | The endpoint refused it: a wrong key or model, a refused prompt, a field it does not accept (a seed, on an endpoint that takes none), or a picture sent as a link. |
| *That did not come out.* | The endpoint was busy or having trouble — a rate limit or a server error — or could not be reached. |
| *The server restarted while this was being made.* | The picture was cut off by a restart. |
| *The picture was cleared to save space.* | The picture's file is gone from the disk. |

A picture is asked for **once**. A rate limit or a server error is not retried for you,
however brief, so when a busy or paid service turns a picture away for a moment, the
placeholder appears straight away and **Try again** is how it is asked again.

The recipe records a seed, and the seed is sent to the endpoint **only when the connection
says the endpoint takes one**: **Sends a seed with a picture** set to **Yes** on the
connection, which appears under **Drawing pictures** once **Makes pictures** says yes (see
[Connections and models](connections-and-models.md#adding-a-connection)).
Without it — the default — **Try again** makes a new picture from the same prompt rather
than the same picture again. With it, **Try again** sends the same seed, and an endpoint
that honours seeds draws the same picture; nothing in the endpoint's answer says whether
it did. Set it only for an endpoint that accepts a `seed`: one that holds strictly to
OpenAI's image API refuses the unknown field, and every picture then fails with *The image
service refused this one.*

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
*the harbour master's office* are two backdrops. A backdrop that failed is not reused: it
is asked for again after every reply while the place stays the same — each a new image
request, with a *could not be made* notification when you are away.

**Set the scene** draws a new backdrop of the current place whenever no turn is being
written, even with **Stage a backdrop** off. It appears once **Stage a backdrop** has
been switched on or off earlier in the story than where you are now (rewinding to before
the first switch hides it again), and needs a known place: otherwise *The story has not
said where this is yet, so there is no place to draw.*

Turning **Stage a backdrop** off stops new backdrops but leaves the current one showing.
There is no control yet for choosing among earlier backdrops, for retrying one that failed
(**Set the scene** makes a new one), or for deleting pictures.

## Faces

*Scene only.* With **Show the scene** on, the same call that names the place picks an
**expression** for each character in the scene who has a set of expressions, from that set
only, and only when the reply shows it. The faces appear under each turn — every
character's *current* face. Turning **Show the scene** off leaves the last faces showing,
as it leaves the backdrop.

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

StoryEngine keeps **names** out of an illustration's prompt as far as it can: the model
that describes the moment is told not to use them, and wherever a cast member's full name
still appears, it becomes *someone*. Only the exact name on the card is caught — a first
name alone, a nickname, or someone outside the cast gets through. A backdrop's place goes
exactly as the model wrote it, so *Mara's cabin* reaches the image model with the name in
it.

A character is described only by their recorded appearance — build, hair, eyes, face,
clothing, accessories — and only characters imported from Aventuras have one: StoryEngine's
own editor has no appearance fields, and SillyTavern and CHARX cards carry none, so those
characters add nothing to a picture.

## Showing the model a picture

**Attach a picture**, in the composer, adds up to four pictures to a move — PNG, JPEG or
WebP; a large photo is fine, because the 8 MB limit applies to what your browser sends
after preparing the picture. A move can be pictures alone. Before uploading, your browser redraws
each one the right way up, removes its location and other metadata, and scales it to at
most 1,568 pixels on its longer side.

Each picture gets a caption, **What it shows**. Under it the composer says what will
happen:

- *The model will see this picture.* — the model answering is ticked under its connection's
  **Models that can see pictures**.
- *The model will get your caption instead: …* — with the reason: the model is not marked as
  seeing pictures, the picture is not on this server, the pack puts the move where a
  picture cannot go, and so on.

Only the move being sent carries pixels. One turn later the same picture travels as its
caption, and that is what search, lore matching and summaries see too. **Redo**, **Reroll**
and Scene's swipes and edits send a move's pictures again.

In the transcript, a move's pictures appear as thumbnails with their captions. A picture
uploaded but never sent is cleared from the server the next time you attach a picture in
that session, once a day has passed.

## The workbench

The workbench's **Pictures** section, over a turn, shows each picture's recipe: what it is
for, the model asked, the seed, the anchor sentence for an illustration, and every piece of
the prompt, with any that were dropped struck through. Beside the seed it says *Not sent: …*
when the connection did not say its endpoint takes a seed — re-creating that picture will
not reproduce it — and *Not recorded whether this reached the endpoint.* for a picture made
before the server began recording it. When a turn that was meant to make a
picture made none, it says why: the place had not changed, there was no moment worth a
picture, the story had not said where it is yet, or the place had been drawn before. A turn
left without pictures because a job is unbound has no **Pictures** section at all.

The block table marks a picture on a move as **Picture sent**, **Picture as words** or
**Picture dropped**.

## Good to know

- **Costs.** An illustration is one quick model call plus one picture; **Every turn** does
  that every turn. Staging the scene costs one call on *Writing the story* after **every**
  reply, to name the place, even when no picture is drawn. The description calls appear on
  the turn's record or in your usage log (`users/<handle>/usage.jsonl` in the data
  directory, which has no screen in the app); image calls are not counted anywhere,
  except a **Test** picture on a connection, which has a line there of its own.
- **No automatic retries.** An image request is sent once. A rate limit or a server
  error, even a passing one, fails that picture at once: an illustration becomes *That did
  not come out.*, and **Try again** is the retry — each press one more request, which a
  paid service may bill; a backdrop is asked for again after the next reply, as above.
- **No time limit.** Image requests in a story are not bound by the provider timeout (a
  **Test** picture on a connection is, and gives up when it runs out). A stalled image
  endpoint leaves *Making a picture of this…* until the server restarts, after which **Try
  again** works.
- **Notifications** say *A picture is ready* or *A picture could not be made* — but not
  while you have that session open, so a backdrop that fails while you watch fails quietly.
  The workbench says what happened.
- Pictures are stored with their session, and go to the trash and into backups with it. A
  session export carries the pictures' records and captions, not the pictures.
