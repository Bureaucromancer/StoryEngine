// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { createInterface } from 'node:readline';

/**
 * The stdin side of `--reset-password` — see `main.ts` for the flow and
 * `Accounts.resetPassword` for the authority argument.
 *
 * The password is never accepted as a command-line argument: argv leaks into
 * shell history and process listings, and a reset is exactly the moment the
 * new secret should not be lying around. It arrives on stdin instead, two
 * ways:
 *
 * - **A terminal** gets a masked prompt, asked twice, because a typo in a
 *   password nobody can see locks the account right back.
 * - **A pipe** (`echo "pass" | …`, a container exec, a script) gets a plain
 *   line read, once — the caller is a machine and confirmation theatre would
 *   only complicate it. A pipe that closes without delivering a line is the one
 *   case refused; see {@link readNewPassword}.
 *
 * Messages here are developer/operator-facing console output, deliberately
 * untranslated ([20 §12.7](../../../../docs/design/20-tech-stack.md)).
 */

export class ResetAborted extends Error {}

/** The slice of a read stream this needs — a seam for tests. */
export interface PromptInput extends NodeJS.EventEmitter {
  isTTY?: boolean | undefined;
  setRawMode?: (mode: boolean) => unknown;
  setEncoding: (encoding: BufferEncoding) => unknown;
  resume: () => unknown;
  pause: () => unknown;
}

export interface PromptOutput {
  write: (text: string) => unknown;
}

/**
 * Asks for the new password, confirmed when interactive.
 *
 * **This path enforces no minimum length, and that is the design rather than an
 * omission.** `auth.minPasswordLength` is what the API refuses on; this is the
 * console, and console access is already the highest authority this software
 * recognises ([09 §5.1](../../../../docs/design/09-server-multiuser-deployment.md))
 * — someone who can run this binary against the data directory can already read
 * it. A break-glass path that argued with the person holding the machine would
 * only teach them to edit `accounts.json` by hand, which is worse in every way.
 * Whoever runs this may set a one-character password, or an empty one, on
 * purpose and on an install whose configured minimum is twelve.
 *
 * Throws {@link ResetAborted} with a readable message on mismatch, on Ctrl-C, or
 * when stdin closed without an answer — the caller prints it and exits non-zero.
 */
export async function readNewPassword(
  input: PromptInput,
  output: PromptOutput,
  handle: string,
): Promise<string> {
  return input.isTTY ? await readInteractively(input, output, handle) : await readPipedLine(input);
}

async function readInteractively(
  input: PromptInput,
  output: PromptOutput,
  handle: string,
): Promise<string> {
  const first = await readMasked(input, output, `New password for ${handle}: `);
  const second = await readMasked(input, output, 'Repeat it: ');
  if (first !== second) {
    throw new ResetAborted('The two entries did not match. Nothing was changed.');
  }
  return first;
}

/**
 * One line, no echo. Raw mode so the terminal does not print what is typed;
 * backspace works; Ctrl-C aborts cleanly rather than leaving the terminal raw.
 */
function readMasked(input: PromptInput, output: PromptOutput, prompt: string): Promise<string> {
  output.write(prompt);

  return new Promise((resolve, reject) => {
    input.setRawMode?.(true);
    input.setEncoding('utf8');
    input.resume();

    let value = '';

    const finish = (outcome: () => void): void => {
      input.removeListener('data', onData);
      input.setRawMode?.(false);
      input.pause();
      output.write('\n');
      outcome();
    };

    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          finish(() => {
            resolve(value);
          });
          return;
        }
        // Ctrl-C — raw mode swallows the signal, so it is honoured by hand.
        if (character === '\u0003') {
          finish(() => {
            reject(new ResetAborted('Cancelled. Nothing was changed.'));
          });
          return;
        }
        // Backspace: DEL from most terminals, BS from some.
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };

    input.on('data', onData);
  });
}

/** The first line from a pipe, without the trailing newline. */
function readPipedLine(input: PromptInput): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = createInterface({ input: input as NodeJS.ReadableStream });
    let settled = false;
    reader.once('line', (line) => {
      settled = true;
      reader.close();
      resolve(line);
    });
    reader.once('close', () => {
      /**
       * **Nothing at all is not an empty password.**
       *
       * A pipe that ends without a newline still delivers its content as a
       * final 'line' before closing, and `echo "" | …` delivers one empty line
       * and means it — both are answers, and both are honoured, because this
       * path enforces no minimum. A pipe that closes having delivered no line
       * gave no answer: a redirect from `/dev/null`, a script whose variable
       * was unset, a truncated heredoc.
       *
       * Until the minimum became configurable the length check happened to
       * catch this. With no minimum left to enforce, resolving `''` here would
       * silently blank a live account's password and report success, which is
       * the worst outcome available on a recovery path. Same distinction
       * `main.ts` draws for a flag with no value.
       */
      if (!settled) reject(new ResetAborted('No password was given. Nothing was changed.'));
    });
  });
}
