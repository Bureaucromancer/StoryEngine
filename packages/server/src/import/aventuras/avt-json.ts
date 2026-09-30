// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * ***JSON, read once, with the pictures left where they lie*** —
 * [P13.15](../../../../../docs/design/workplan/30-p13-aventuras-import.md).
 *
 * **Why the platform's `JSON.parse` is not enough for a `.avt`.** An `.avt` is
 * one JSON object whose bulk is base64: every picture Aventuras drew into the
 * story, every character's portrait, and the snapshots its checkpoints keep
 * of the whole world, portraits included. `JSON.parse(decode(bytes))` holds
 * that bulk three times at once — the bytes as they arrived, the decoded
 * string, and every base64 value again as a string in the parsed graph — and
 * then the importer decodes each picture a fourth time. Aventuras met the same
 * wall from the other side, and for the same reason: its WebView ran out of
 * heap on Android, and its importer now reads a `.avt` in Rust in two passes,
 * the first skipping each `imageData` "without ever allocating it"
 * (`src-tauri/src/avt_import.rs`).
 *
 * This is that first pass, written for this server. It walks the bytes it is
 * given — **the one copy of the file there is** — and asks a policy, for every
 * value, what the caller wants of it:
 *
 * - **`value`**: parse it, as `JSON.parse` would. Almost everything.
 * - **`lazy`**: a string whose content is left in the bytes. The answer is a
 *   {@link LazyText} — where it starts and ends — so its length is known
 *   without reading it (which is what a bound is checked against, as SQLite's
 *   `octet_length` is for the database's pictures), and it is decoded later,
 *   one at a time, by {@link lazyText}. A picture.
 * - **`count`**: an array whose elements are checked and not kept; the answer
 *   is how many there were. A checkpoint, whose snapshots are the largest thing
 *   in a `.avt` after its pictures and nothing this server reads.
 * - **`skip`**: checked and not kept at all. Aventuras' working state.
 *
 * ***Bounded in depth, and by its caller in size.*** A document nested past
 * {@link DEFAULT_MAX_DEPTH} is refused `too-deep` rather than walked, since
 * the walk recurses and a file somebody wrote to be hostile could otherwise
 * take the process's stack with it. The size is the transport's — a folder
 * read stops at `maxFileBytes`, an upload at `limits.maxUploadMb` — and this
 * never makes a second copy of what it was handed, so the bound the transport
 * set is the bound in memory.
 *
 * ***Strict where it keeps, lenient only where it skips.*** A kept value is
 * parsed to the grammar — control characters in strings, stray commas,
 * leading zeros and invalid UTF-8 all refuse `not-json`, as `JSON.parse`
 * would. A skipped or counted one is walked for its structure — brackets,
 * strings and their escapes — without decoding what it holds, so a `\u` escape
 * inside a checkpoint is not checked for four hex digits, nor a lazy string
 * for control characters. Nothing skipped
 * reaches an import, so nothing an import holds rests on that leniency.
 *
 * ***A key named `__proto__` is a key***, as it is to `JSON.parse`: objects
 * are built with `Object.fromEntries`, which defines own properties, so a
 * file cannot reach a prototype by naming one.
 */

/** What a caller wants of one value. See the file header. */
export type JsonTreatment = 'value' | 'lazy' | 'count' | 'skip';

/**
 * Asked once per value, with the keys that lead to it — `'*'` for an array's
 * element. The array is the reader's own and changes as it walks: read it,
 * never keep it.
 */
export type JsonPolicy = (path: readonly string[]) => JsonTreatment;

/**
 * ***A string left in the bytes*** — its content's span, between the quotes,
 * and whether it holds an escape, which decides how it is read back.
 */
export class LazyText {
  /** The first byte of the content, after the opening quote. */
  readonly start: number;
  /** One past the last byte of the content: the closing quote. */
  readonly end: number;
  readonly escaped: boolean;

  constructor(start: number, end: number, escaped: boolean) {
    this.start = start;
    this.end = end;
    this.escaped = escaped;
  }

  /**
   * ***The stored length in bytes*** — the measure a bound is held to before
   * anything is read. For base64, which is ASCII and never escaped by any
   * writer that wrote a `.avt`, this is its length in characters, as SQLite's
   * `octet_length` is for the same text in the database.
   */
  get octets(): number {
    return this.end - this.start;
  }
}

/** An array asked to be counted: how many elements it had. */
export class JsonCount {
  readonly count: number;

  constructor(count: number) {
    this.count = count;
  }
}

export type JsonRead =
  | { ok: true; value: unknown }
  /**
   * `not-json`: not JSON, or bytes that are not UTF-8 where a value was kept.
   * `too-deep`: nested past the bound, and not walked further.
   */
  | { ok: false; reason: 'not-json' | 'too-deep' };

/**
 * How deep a document may nest. Aventuras' deepest at the pin is a
 * checkpoint's snapshot of an entry's world-state delta — ten or so levels —
 * so this is several times anything real, and far short of a stack.
 */
export const DEFAULT_MAX_DEPTH = 64;

/** Read `bytes` as one JSON document, asking `policy` what to keep. */
export function readJson(
  bytes: Uint8Array,
  policy: JsonPolicy,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): JsonRead {
  const walk = new Walk(bytes, policy, maxDepth);
  try {
    walk.space();
    const value = walk.value(1, policy(walk.path));
    walk.space();
    if (walk.pos !== bytes.byteLength) return { ok: false, reason: 'not-json' };
    return { ok: true, value };
  } catch (error) {
    if (error instanceof Stop) return { ok: false, reason: error.reason };
    // The strict decoder's refusal of bytes that are not UTF-8.
    if (error instanceof TypeError) return { ok: false, reason: 'not-json' };
    throw error;
  }
}

/**
 * ***A lazy string, read now*** — the one decode of it there will be. A span
 * with no escape is its bytes as UTF-8; one with an escape is walked as the
 * string it is. `null` for a span that is not what {@link readJson} said it
 * was, which only a caller handing in the wrong bytes could cause.
 */
export function lazyText(bytes: Uint8Array, text: LazyText): string | null {
  try {
    if (!text.escaped) return UTF8.decode(bytes.subarray(text.start, text.end));
    const walk = new Walk(bytes, () => 'value', 1);
    walk.pos = text.start - 1;
    return walk.string();
  } catch {
    return null;
  }
}

/** The strict decoder: bytes that are not UTF-8 are a refusal, never a replacement character. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });

class Stop extends Error {
  readonly reason: 'not-json' | 'too-deep';

  constructor(reason: 'not-json' | 'too-deep') {
    super(reason);
    this.reason = reason;
  }
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const COLON = 0x3a;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const MINUS = 0x2d;
const PLUS = 0x2b;
const DOT = 0x2e;
const ZERO = 0x30;
const NINE = 0x39;

/** The single-character escapes, by the byte after the backslash. */
const ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x22, '"'],
  [0x5c, '\\'],
  [0x2f, '/'],
  [0x62, '\b'],
  [0x66, '\f'],
  [0x6e, '\n'],
  [0x72, '\r'],
  [0x74, '\t'],
]);

const LITERALS: readonly (readonly [string, unknown])[] = [
  ['true', true],
  ['false', false],
  ['null', null],
];

/**
 * One walk over one document. Recursive descent, one method per production,
 * each told whether its value is kept — so a skipped subtree costs a scan and
 * no allocation beyond the keys of its objects.
 */
class Walk {
  pos = 0;
  /** The keys leading to the value being read — the policy's argument. */
  readonly path: string[] = [];

  readonly bytes: Uint8Array;
  readonly policy: JsonPolicy;
  readonly maxDepth: number;

  constructor(bytes: Uint8Array, policy: JsonPolicy, maxDepth: number) {
    this.bytes = bytes;
    this.policy = policy;
    this.maxDepth = maxDepth;
  }

  #at(): number {
    const byte = this.bytes[this.pos];
    if (byte === undefined) throw new Stop('not-json');
    return byte;
  }

  #expect(byte: number): void {
    if (this.#at() !== byte) throw new Stop('not-json');
    this.pos += 1;
  }

  space(): void {
    for (;;) {
      const byte = this.bytes[this.pos];
      if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return;
      this.pos += 1;
    }
  }

  value(depth: number, asked: JsonTreatment): unknown {
    if (depth > this.maxDepth) throw new Stop('too-deep');
    const byte = this.#at();
    if (byte === QUOTE) {
      if (asked === 'lazy') return this.#lazy();
      if (asked === 'value') return this.string();
      this.#skipString();
      return undefined;
    }
    // `lazy` means a string; anything else asked for lazily is read as it is.
    const treatment = asked === 'lazy' ? 'value' : asked;
    if (byte === OPEN_BRACE) return this.#object(depth, treatment);
    if (byte === OPEN_BRACKET) return this.#array(depth, treatment);
    if (byte === MINUS || (byte >= ZERO && byte <= NINE)) {
      const start = this.pos;
      this.#number();
      if (treatment !== 'value') return undefined;
      return Number(latin1(this.bytes, start, this.pos));
    }
    for (const [word, literal] of LITERALS) {
      if (this.#matches(word)) {
        this.pos += word.length;
        return treatment === 'value' ? literal : undefined;
      }
    }
    throw new Stop('not-json');
  }

  #matches(word: string): boolean {
    for (let i = 0; i < word.length; i += 1) {
      if (this.bytes[this.pos + i] !== word.charCodeAt(i)) return false;
    }
    return true;
  }

  #object(depth: number, treatment: JsonTreatment): unknown {
    this.pos += 1;
    const kept = treatment === 'value';
    const entries: [string, unknown][] = [];
    this.space();
    if (this.#at() === CLOSE_BRACE) {
      this.pos += 1;
      return kept ? {} : undefined;
    }
    for (;;) {
      this.space();
      if (this.#at() !== QUOTE) throw new Stop('not-json');
      // A key is always decoded, even in a skipped object: it is short, and
      // the policy may need it for the value beneath.
      const key = this.string();
      this.space();
      this.#expect(COLON);
      this.space();
      this.path.push(key);
      const child: JsonTreatment = kept ? this.policy(this.path) : 'skip';
      const value = this.value(depth + 1, child);
      this.path.pop();
      if (kept && child !== 'skip' && value !== undefined) entries.push([key, value]);
      this.space();
      const next = this.#at();
      this.pos += 1;
      if (next === CLOSE_BRACE) break;
      if (next !== COMMA) throw new Stop('not-json');
    }
    return kept ? Object.fromEntries(entries) : undefined;
  }

  #array(depth: number, treatment: JsonTreatment): unknown {
    this.pos += 1;
    const kept = treatment === 'value';
    const items: unknown[] = [];
    let count = 0;
    this.space();
    if (this.#at() === CLOSE_BRACKET) {
      this.pos += 1;
      return kept ? items : treatment === 'count' ? new JsonCount(0) : undefined;
    }
    for (;;) {
      this.space();
      this.path.push('*');
      const child: JsonTreatment = kept ? this.policy(this.path) : 'skip';
      const value = this.value(depth + 1, child);
      this.path.pop();
      if (kept && child !== 'skip') items.push(value);
      count += 1;
      this.space();
      const next = this.#at();
      this.pos += 1;
      if (next === CLOSE_BRACKET) break;
      if (next !== COMMA) throw new Stop('not-json');
    }
    if (kept) return items;
    return treatment === 'count' ? new JsonCount(count) : undefined;
  }

  /** A string, decoded. `pos` is on its opening quote, and ends past its closing one. */
  string(): string {
    this.pos += 1;
    let from = this.pos;
    let text = '';
    for (;;) {
      const byte = this.#at();
      if (byte === QUOTE) {
        text += UTF8.decode(this.bytes.subarray(from, this.pos));
        this.pos += 1;
        return text;
      }
      if (byte < 0x20) throw new Stop('not-json');
      if (byte !== BACKSLASH) {
        this.pos += 1;
        continue;
      }
      text += UTF8.decode(this.bytes.subarray(from, this.pos));
      this.pos += 1;
      const escape = this.#at();
      const simple = ESCAPES.get(escape);
      if (simple !== undefined) {
        text += simple;
        this.pos += 1;
      } else if (escape === 0x75) {
        const hex = latin1(this.bytes, this.pos + 1, this.pos + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Stop('not-json');
        // A lone surrogate is kept as one, as `JSON.parse` keeps it.
        text += String.fromCharCode(Number.parseInt(hex, 16));
        this.pos += 5;
      } else {
        throw new Stop('not-json');
      }
      from = this.pos;
    }
  }

  /** A string left in place: its span, and whether an escape is in it. */
  #lazy(): LazyText {
    this.pos += 1;
    const start = this.pos;
    let escaped = false;
    /**
     * *By `indexOf`, a quote at a time*, because this is the loop the bulk of
     * a `.avt` goes through — megabytes of base64 per picture — and a byte at
     * a time through a method is the slow way to find the end of one. The
     * backslash is looked for only between here and that quote, so a file
     * with none costs one scan of each string and not one of the whole file.
     * Control characters are not looked for: this walks a string's structure,
     * and a picture with one in it fails its own decode.
     */
    for (;;) {
      const quote = this.bytes.indexOf(QUOTE, this.pos);
      if (quote === -1) throw new Stop('not-json');
      const slash = this.bytes.subarray(this.pos, quote).indexOf(BACKSLASH);
      if (slash === -1) {
        this.pos = quote + 1;
        return new LazyText(start, quote, escaped);
      }
      escaped = true;
      // Past the backslash and the character it escapes, which may be the quote.
      this.pos += slash + 2;
    }
  }

  #skipString(): void {
    this.#lazy();
  }

  /** A number to the grammar: `-`, an integer with no leading zero, a fraction, an exponent. */
  #number(): void {
    if (this.bytes[this.pos] === MINUS) this.pos += 1;
    const first = this.#at();
    if (first === ZERO) {
      this.pos += 1;
    } else if (first > ZERO && first <= NINE) {
      this.#digits();
    } else {
      throw new Stop('not-json');
    }
    if (this.bytes[this.pos] === DOT) {
      this.pos += 1;
      this.#digits();
    }
    const exponent = this.bytes[this.pos];
    if (exponent === 0x65 || exponent === 0x45) {
      this.pos += 1;
      const sign = this.bytes[this.pos];
      if (sign === PLUS || sign === MINUS) this.pos += 1;
      this.#digits();
    }
  }

  /** One or more digits. */
  #digits(): void {
    const start = this.pos;
    for (;;) {
      const byte = this.bytes[this.pos];
      if (byte === undefined || byte < ZERO || byte > NINE) break;
      this.pos += 1;
    }
    if (this.pos === start) throw new Stop('not-json');
  }
}

/** ASCII bytes as a string — a number's or an escape's, never text somebody wrote. */
function latin1(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < end && i < bytes.byteLength; i += 1) {
    out += String.fromCharCode(bytes[i] ?? 0);
  }
  return out;
}
