// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { expect, test, type Page } from '@playwright/test';

/**
 * ***The seven journeys [testing §3.5](../docs/design/workplan/03-testing.md)
 * names*** — [P11 §3](../docs/design/workplan/28-p11-implementation.md)'s row 8.
 *
 * *"Playwright, kept deliberately thin — a handful of journeys that would be
 * catastrophic to break: first-run setup, create an actor, import a card, start
 * a session, take a turn, branch, open the workbench."*
 *
 * ***One test rather than seven, and that is §3.5's own shape.*** The list is
 * what a person does in order on a fresh install, and each step needs the one
 * before it: there is no session to take a turn in until one is started, and
 * nothing to start it with until an account exists. Splitting them would mean
 * seven first-run setups — Playwright gives each test its own browser context,
 * so *signed in* does not survive a test boundary — which is slower and tests
 * the fixture rather than the journey.
 *
 * ***What this tier is for, and what it is not.*** Every claim below is asserted
 * somewhere else more precisely — the route tests know what a turn record
 * contains, the component tests know what the composer does. **What only this
 * tier can say is that the pieces are connected**: a built client, served by a
 * built server, over HTTP, against an endpoint reached through the real adapter.
 * The failures it catches are the ones where every part works and the wiring
 * does not, which is the class that survives a green unit suite.
 *
 * *Selectors are roles and names*, never classes or test ids, because the thing
 * this tier is protecting is what a person can find on the page — and a test
 * that can only find a control by a hook nobody can see would keep passing
 * through a redesign that made the app unusable.
 */

const HANDLE = 'ned';
const PASSWORD = 'correct horse battery staple';
const FAKE_BASE = 'http://127.0.0.1:4599/v1';
const FAKE_MODEL = 'fake-hi';

/**
 * ***A state-changing request from inside the page, CSRF token and all.***
 *
 * The server checks double-submit on every state-changing API call that carries
 * a session ([09 §4.1](../docs/design/09-server-multiuser-deployment.md)): the
 * value of the script-readable `se_csrf` cookie, echoed in `x-csrf-token`. The
 * shipped client does it in one place, `api.ts`'s `request()`; a raw `fetch` in
 * an evaluated function inherits none of that and gets a 403 with `error:
 * "csrf"` — which is how this helper came to exist rather than by reading the
 * middleware first.
 *
 * ***Re-stated by hand rather than imported from the client***, and that is the
 * point of the tier: this file is a caller from outside, like any other, and a
 * test that reached into `api.ts` for the header could pass against a build
 * whose own requests had stopped carrying it.
 */
async function send(
  page: Page,
  method: string,
  url: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async (call: { method: string; url: string; body: unknown }) => {
      const prefix = 'se_csrf=';
      const cookie = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix));
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (cookie !== undefined) {
        headers['x-csrf-token'] = decodeURIComponent(cookie.slice(prefix.length));
      }
      const response = await fetch(call.url, {
        method: call.method,
        headers,
        body: JSON.stringify(call.body),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    { method, url, body },
  );
}

/**
 * ***One connection, made through the API rather than through the form.***
 *
 * A journey for *configuring a provider* is not on §3.5's list, and adding one
 * here would be this file growing by a journey nobody asked for — the failure
 * its own header warns about. What the list **does** need is a session that can
 * take a turn, which needs a bound role, so this is arrangement rather than
 * assertion: it goes through the API, in one place, where it reads as setup.
 *
 * **`/api/me/*` rather than `/api/connections`**: the admin routes configure the
 * *install*, and what a turn resolves against is the account's own binding.
 */
async function bindAProvider(page: Page): Promise<void> {
  const created = await send(page, 'POST', '/api/me/connections', {
    label: 'The double',
    provider: 'openai-compatible',
    baseUrl: FAKE_BASE,
    models: [FAKE_MODEL],
  });
  expect(created.status, `the connection was created: ${JSON.stringify(created)}`).toBe(201);

  const id = (created.body as { connection?: { id?: string } }).connection?.id ?? '';
  expect(id, `the connection has an id: ${JSON.stringify(created.body)}`).not.toBe('');

  // **The hash first.** The binding writer takes the whole document under an
  // optimistic hash, because [10 §4] says editing this file by hand works — so
  // there is no way to write one binding without having read the rest, and a
  // test that hard-coded a hash would be asserting that the file starts empty
  // rather than that the write lands.
  const roles = await page.evaluate(async () => {
    const response = await fetch('/api/me/roles');
    return (await response.json()) as { contentHash?: string };
  });
  expect(roles.contentHash, `the roles page carries a hash: ${JSON.stringify(roles)}`).toBeTruthy();

  const bound = await send(page, 'PUT', '/api/me/bindings', {
    bindings: { prose: { connectionId: id, modelId: FAKE_MODEL } },
    contentHash: roles.contentHash,
  });
  expect(bound.status, `the role was bound: ${JSON.stringify(bound)}`).toBe(200);
}

/**
 * ***Import a card*** — §3.5's third journey, and it is third here too.
 *
 * *It was briefly a second test*, on the reasoning that a card starts from a
 * file rather than from the journey before it. That reasoning was wrong in the
 * way that matters: it still needs an account, and a second Playwright test gets
 * a fresh browser context, so the split bought independence it did not have and
 * paid for it with a sign-in. §3.5's own list puts *import a card* between
 * *create an actor* and *start a session*, so the sequence is where it goes.
 *
 * *A minimal PNG with a `chara` chunk is the fixture*, built in the browser: the
 * suite's own fixtures are Node-side, and reaching for one here would make this
 * tier depend on a path the browser cannot take.
 */
async function importACard(page: Page): Promise<void> {
  await page.goto('/library');
  const before = await page.evaluate(async () => {
    const response = await fetch('/api/library/actors');
    const body = (await response.json()) as { objects: { source: string }[] };
    return body.objects.filter((row) => row.source !== 'system').length;
  });

  const imported = await page.evaluate(async () => {
    /** The smallest PNG with a `chara` text chunk a reader will accept. */
    function crc(bytes: Uint8Array): number {
      let c = 0xffffffff;
      for (const byte of bytes) {
        c ^= byte;
        for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    }
    function chunk(type: string, data: Uint8Array): Uint8Array {
      const name = new TextEncoder().encode(type);
      const body = new Uint8Array(name.length + data.length);
      body.set(name);
      body.set(data, name.length);
      const out = new Uint8Array(8 + data.length + 4);
      new DataView(out.buffer).setUint32(0, data.length);
      out.set(body, 4);
      new DataView(out.buffer).setUint32(8 + data.length, crc(body));
      return out;
    }

    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: 'Ilse Brandt', description: 'A dockside fixer.', first_mes: 'You again.' },
    };
    const text = new TextEncoder().encode(
      `chara\0${btoa(unescape(encodeURIComponent(JSON.stringify(card))))}`,
    );
    const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const idat = new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
    const pieces = [
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('tEXt', text),
      chunk('IDAT', idat),
      chunk('IEND', new Uint8Array()),
    ];
    const size = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const png = new Uint8Array(size);
    let at = 0;
    for (const piece of pieces) {
      png.set(piece, at);
      at += piece.length;
    }

    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'Ilse.png');
    // The CSRF token, by hand again — `send` above cannot carry this one,
    // because a multipart body is the whole reason this call exists.
    const prefix = 'se_csrf=';
    const cookie = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    const headers: Record<string, string> = {};
    if (cookie !== undefined) {
      headers['x-csrf-token'] = decodeURIComponent(cookie.slice(prefix.length));
    }
    // `/import/file` — the single-file door. The library's own panel posts here
    // too, which is the point: one write path, and this is a caller from outside
    // taking it rather than a second one built for a test.
    const response = await fetch('/api/import/file', {
      method: 'POST',
      headers,
      body: form,
    });
    return { status: response.status, body: (await response.json()) as unknown };
  });

  // **201 is *converted*** — the route answers 200 for a file it read and did
  // not have to convert, so the code is the assertion that a v2 card came in
  // through the card reader rather than through some passthrough.
  expect(imported.status, JSON.stringify(imported.body)).toBe(201);

  await page.reload();
  const after = await page.evaluate(async () => {
    const response = await fetch('/api/library/actors');
    const body = (await response.json()) as { objects: { source: string }[] };
    return body.objects.filter((row) => row.source !== 'system').length;
  });
  expect(after).toBe(before + 1);
  await expect(page.getByText('Ilse Brandt').first()).toBeVisible();
}

test('the seven journeys, in the order a person walks them', async ({ page }) => {
  // ***1. First-run setup.*** A fresh data directory, nobody signed in, and the
  // install asks for an account rather than for a password.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to StoryEngine' })).toBeVisible();
  // Loopback, so no setup token — [09 §5.1]'s own rule, and the absence is worth
  // asserting because a build that demanded one here would be exposing the
  // token check to a case it was never for.
  await expect(page.getByLabel('Setup token')).toHaveCount(0);

  await page.getByLabel('Handle').fill(HANDLE);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  // The header is the signed-in frame: the wordmark, and the account's name.
  await expect(page.getByRole('link', { name: 'StoryEngine' })).toBeVisible();

  await bindAProvider(page);

  // ***2. Create an actor.*** §3.5's own footnote: *"'create an actor' meant
  // through the API when this was written, because the browser had no way to.
  // Since P4.5 it does, so the journey is a journey: name it on the library
  // page, land in the editor, save."*
  await page.goto('/library');
  await page
    .getByRole('button', { name: /New actor|New/ })
    .first()
    .click();
  const name = page.getByRole('textbox', { name: 'Name' });
  await expect(name).toBeVisible();
  await name.fill('Vera Solano');
  await page.getByRole('button', { name: 'Save' }).click();
  // **The settled state rather than a toast.** The editor answers a save by
  // disabling the control and saying there is nothing left to write, which is a
  // claim about what is on disk; a flash of *Saved.* would be a claim about the
  // last few hundred milliseconds, and asserting one is how a test comes to
  // depend on a message somebody is free to remove.
  await expect(page.getByText('No changes to save.')).toBeVisible();

  // **And it is on the shelf**, which is the journey's actual claim and the one
  // the editor's own state cannot make.
  await page.goto('/library');
  await expect(page.getByText('Vera Solano').first()).toBeVisible();

  // ***3. Import a card.***
  await importACard(page);

  // ***4. Start a session.*** `/play` is the session list and `/play/$id` is one
  // session — the naming is [10 §12]'s, and it is worth a sentence because
  // *sessions* is what the surface is called everywhere else in these documents.
  await page.goto('/play');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  // **Start lists rather than navigates**, which is the surface's own choice and
  // not a miss: creating a session is a different act from sitting down in one,
  // and [08 §6]'s replay warning needs a page to appear on that is not the page
  // you were about to leave. So the journey has two clicks, and the second is
  // the one a person makes.
  const opened = page.getByRole('link', { name: 'Untitled session' }).first();
  await expect(opened).toBeVisible({ timeout: 20_000 });
  await opened.click();
  await expect(page).toHaveURL(/\/play\/[0-9a-f-]+$/);

  // ***5. Take a turn.*** The prose comes back through the real adapter from
  // the fake endpoint, streamed in two chunks — so a reader that only handled
  // the first would show half a sentence here and nowhere else.
  const composer = page.getByRole('textbox').first();
  await composer.fill('Look around.');
  /**
   * ***Sent with Enter, from the box***, which is both how a person sends a
   * turn and the only way to walk the two things a browser has and jsdom does
   * not.
   *
   * The composer became a `<textarea>` in this pass, and a textarea's own
   * default for Enter is to insert a newline — so *Enter still sends* is a
   * claim about a keydown handler that a component test can assert and a real
   * browser has to confirm, because the handler runs against the browser's
   * default rather than beside it.
   *
   * And the composer is `disabled` while the turn runs. A browser moves focus
   * to `<body>` when the element holding it is disabled; jsdom does not, which
   * is why the assertion below lives here. Without the restoration effect the
   * keyboard is left outside the box after every single turn.
   */
  await composer.press('Enter');
  await expect(page.getByText(/pushed the ledger across the desk/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(composer).toBeFocused();

  /**
   * ***6. Branch.*** **A second turn from the same parent**, which is what makes
   * the transcript a tree rather than a list, and [07 §3]'s claim is that
   * nothing is lost by taking one.
   *
   * *This step used to be a second Send*, and a second Send is not a branch — it
   * continues the line, from the head. The gesture that branches is **Redo**
   * ([07 §7]): *that turn again*, same parent, same words. The difference does
   * not show up in a request count, which is why it survived until the journey
   * was actually walked.
   */
  await page.getByRole('button', { name: 'Redo', exact: true }).first().click();
  /**
   * The sibling strip is the whole of [07 §6]'s *there are others*: a count, and
   * a way to step between them. **Two of two** is the assertion — the attempt
   * that was replaced is still addressable — and stepping back to one is the
   * other half, because a count nobody can act on would be a label rather than
   * an affordance.
   *
   * ***On the message, since P14*** (corrected 2026-10-01): a chat's
   * alternatives are counted where they differ — [P14 §1.6]'s *"swipes surface
   * on the message, not the turn"* — so the step is the message's *Previous
   * reply*, not the turn strip's *Previous version*, which keeps only the
   * siblings that answer a different move. And the fake endpoint now varies its
   * later replies, because two identical answers are one alternative there.
   */
  await expect(page.getByText('2 of 2')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Previous reply' }).click();
  await expect(page.getByText('1 of 2')).toBeVisible();

  // ***7. Open the workbench.*** The panel over the turn that just happened —
  // and the assertion is that it has something to show, because a workbench that
  // opened empty would be the wiring failure this tier exists for.
  await page.getByRole('button', { name: 'Workbench' }).click();
  const workbench = page.getByRole('complementary');
  await expect(workbench).toBeVisible();
  /**
   * **Something to show, and specifically the right something.** *The dock is
   * open* is a claim `complementary` alone would make about an empty panel, and
   * an empty workbench over a turn that happened is precisely the wiring failure
   * this tier exists for.
   *
   * *The model id is the assertion*, because it closes the loop the rest of the
   * test opened: the connection bound in arrangement is the one the turn
   * resolved against, the record kept which it was, and the panel reads it back
   * out. Four components, one string, and no other step can say it.
   */
  await expect(workbench.getByText(FAKE_MODEL).first()).toBeVisible({ timeout: 20_000 });
});
