// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

/**
 * **Renumber the design corpus, and repoint every citation to it.**
 *
 * Kept in the repository rather than run once and discarded, which is the whole
 * finding this migration came out of: `3532f10` renumbered eleven notes, wrote
 * "a link checker reports 1279 links, 0 broken", committed neither the checker
 * nor the script, and the convention it had just verified then rotted in five
 * hundred places with nothing able to notice. `tools/doc-links.test.ts` is the
 * checker. This is the script.
 *
 * It exists to be run again. Reading order is only maintainable if renumbering
 * is a scripted twenty-minute operation rather than a week nobody will spend,
 * and the corpus provably grows by insertion — seven design notes arrived after
 * the original run, each carrying a header explaining that its number was
 * whatever was free that day.
 *
 * Usage:
 *   node tools/renumber-docs.mjs --plan      report the map and the residue
 *   node tools/renumber-docs.mjs --rename    git mv, two-phase, no content change
 *   node tools/renumber-docs.mjs --rewrite   repoint every citation
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

const DESIGN = 'docs/design/';
const PLAN = 'docs/design/workplan/';

/**
 * Design notes, in the order the README's own table already reads them.
 *
 * `randomizers` sits after `tech-stack` because the README says "22 reads after
 * 03, 07 and 05" — numbering it earlier would encode the exact dependency
 * inversion this exercise removes. `open-questions` reads last: it is consulted
 * rather than read through, and its own header orders its contents by how
 * expensive they are to answer late.
 */
const DESIGN_ORDER = [
  'stance',
  'source-survey',
  'infinite-worlds',
  'data-model',
  'schemas',
  'tagging',
  'modes-and-turn-pipeline',
  'branching',
  'cross-session-memory',
  'server-multiuser-deployment',
  'ui-surfaces',
  'lorebooks-as-a-format',
  'account-gallery',
  'write-mode',
  'writing-samples',
  'world',
  'authoring',
  'character-studio',
  'session-import',
  'tech-stack',
  'client-loading',
  'internal-contracts',
  'extensions',
  'randomizers',
  'roadmap',
  'open-questions',
];

/**
 * Work-plan documents in execution order, standing references first, with the
 * name each is cited by.
 *
 * The lettered phases interleave — P2A after P2, P6A after P6 — which is the
 * single biggest legibility win here. The letters existed so a phase could
 * follow P2 without renumbering P3; that constraint was about the *phase* label
 * and never about the document's filing position.
 */
const PLAN_ORDER = [
  ['work-plan', 'work plan'],
  ['triage', 'triage'],
  ['testing', 'testing'],
  ['repo-and-releases', 'releases'],
  ['manual-testing', 'manual testing'],
  ['polish', 'polish'],
  ['p1-implementation', 'P1'],
  ['p2-implementation', 'P2'],
  ['p2a-configuration-surface', 'P2A'],
  ['p2b-provider-configuration', 'P2B'],
  ['p2-manual-gate', 'manual gate'],
  ['p2c-first-real-run', 'P2C'],
  ['p2c-brief', 'P2C brief'],
  ['p2c-log', 'P2C log'],
  ['p3-implementation', 'P3'],
  ['p4-implementation', 'P4'],
  ['p5-implementation', 'P5'],
  ['p6-implementation', 'P6'],
  ['p6a-alpha-1', 'P6A'],
  ['p6b-playable', 'P6B'],
  ['playable-log', 'playable log'],
  ['walkthrough-refinements', 'refinements'],
  ['p7-implementation', 'P7'],
  // Filed at 28 until P7's branch merges; this entry is what moves it to 24.
  ['p7b-presets-and-prompts', 'P7B'],
  ['p8-implementation', 'P8'],
  ['p9-implementation', 'P9'],
  ['p10-implementation', 'P10'],
  ['p11-implementation', 'P11'],
  ['p12-implementation', 'P12'],
  ['p12a-the-look', 'P12A'],
];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const tracked = () => git('ls-files', '-z').split('\0').filter(Boolean);
const pad = (n) => String(n).padStart(2, '0');

/** old repo-relative path → { path, number, name|null } */
function buildMap() {
  const files = tracked();
  const map = new Map();

  const find = (dir, slug) => {
    const hit = files.find(
      (f) =>
        f.startsWith(dir) &&
        /^\d{2}-/.test(f.slice(dir.length)) &&
        f
          .slice(dir.length)
          .replace(/^\d{2}-/, '')
          .replace(/\.md$/, '') === slug,
    );
    if (!hit) throw new Error(`no file for ${dir}${slug}`);
    return hit;
  };

  DESIGN_ORDER.forEach((slug, index) => {
    map.set(find(DESIGN, slug), {
      path: `${DESIGN}${pad(index)}-${slug}.md`,
      number: pad(index),
      name: null,
    });
  });

  PLAN_ORDER.forEach(([slug, name], index) => {
    map.set(find(PLAN, slug), {
      path: `${PLAN}${pad(index + 1)}-${slug}.md`,
      number: pad(index + 1),
      name,
    });
  });

  return map;
}

const MAP = buildMap();

if (process.argv.includes('--plan')) {
  for (const [from, to] of MAP) {
    if (from !== to.path) console.log(`${from}\n  -> ${to.path}`);
  }
  console.log(
    `\n${String(MAP.size)} documents, ${String([...MAP].filter(([f, t]) => f !== t.path).length)} moving`,
  );
}

/**
 * **Two phases, through temp names.** The map is a permutation and the ranges
 * overlap — design 02 becomes 03 while 03 becomes 06 — so a single ordered pass
 * silently overwrites, and `git mv` on Windows will not always stop you.
 *
 * Renames land in their own commit at 100% similarity, so git records every one
 * and `git log --follow` survives.
 */
if (process.argv.includes('--rename')) {
  const moving = [...MAP].filter(([from, to]) => from !== to.path);
  for (const [from] of moving) {
    const dir = from.slice(0, from.lastIndexOf('/') + 1);
    const base = from.slice(dir.length);
    git('mv', from, `${dir}.renumber-${base}`);
  }
  for (const [from, to] of moving) {
    const dir = from.slice(0, from.lastIndexOf('/') + 1);
    const base = from.slice(dir.length);
    git('mv', `${dir}.renumber-${base}`, to.path);
  }
  console.log(`renamed ${String(moving.length)} document(s) in two phases`);
}

/**
 * The content pass. Run after the rename commit, which is where the
 * old-to-new map comes from — git already recorded every rename, so the map is
 * read back rather than restated and cannot drift from what actually moved.
 */
if (process.argv.includes('--rewrite')) {
  const after = process.argv[process.argv.indexOf('--rewrite') + 1];
  const RENAME_COMMIT = after && !after.startsWith('-') ? after : 'HEAD';
  const DRY = process.argv.includes('--dry');

  // ---- old path -> new path -------------------------------------------------
  const OLD_TO_NEW = new Map();
  for (const line of git(
    'diff',
    '--name-status',
    '--find-renames',
    `${RENAME_COMMIT}~1`,
    RENAME_COMMIT,
  ).split('\n')) {
    const p = line.split('\t');
    if (p[0]?.startsWith('R') && p[1] && p[2]) OLD_TO_NEW.set(p[1], p[2]);
  }
  const ALL = git('ls-files', '-z').split('\0').filter(Boolean);
  for (const f of ALL) {
    if (/^docs\/design\/(workplan\/)?\d{2}-/.test(f) && !OLD_TO_NEW.has(f)) OLD_TO_NEW.set(f, f);
  }

  const numberOf = (p) => /(?:^|\/)(\d{2})-/.exec(p)?.[1] ?? null;
  const isPlan = (p) => p.includes('design/workplan/');
  const slugOf = (p) =>
    p
      .slice(p.lastIndexOf('/') + 1)
      .replace(/^\d{2}-/, '')
      .replace(/\.md$/, '');

  /**
   * The work-plan names, **from `PLAN_ORDER` rather than beside it**.
   *
   * ~~A second literal spelling out the same slug-to-name pairs.~~ *It had
   * already drifted by the time anybody ran this* (corrected 2026-09-14 at
   * P7B.5): `p7b-presets-and-prompts` was added to `PLAN_ORDER` when the
   * document was filed and never to this copy, so the first real run would have
   * rewritten every `[28 §x]` citation of it to `undefined §x` — a defect
   * visible only on the one day the script is used, which is the worst schedule
   * a defect can have. One source, and the drift cannot recur.
   */
  const NAMES = Object.fromEntries(PLAN_ORDER);
  const labelFor = (next) => (isPlan(next) ? NAMES[slugOf(next)] : numberOf(next));

  /**
   * Was this href written from the repository root rather than from its file?
   *
   * ~~`!href.startsWith('.')`~~ ***and that is wrong for the form this corpus
   * actually uses*** (corrected 2026-09-14 at P7B.5, on the run that would have
   * shipped it). A work-plan document cites its sibling as
   * `[P7]` + `(23-p7-implementation.md)` — no leading `./`, and unambiguously
   * relative — so the old test called every one of those root-relative and
   * rewrote **3142 links** into `docs/design/workplan/23-…` from inside
   * `docs/design/workplan/`. Those resolve from the repository root and nowhere
   * else, so GitHub renders every one of them as a 404, and
   * [`doc-links.test.ts`](./doc-links.test.ts) does not catch it: it tries both
   * bases deliberately, because both forms appear in the corpus for good
   * reasons.
   *
   * The honest question is not how the href is spelled but **which base it
   * resolved against**, which `oldTarget` already has to work out. A link is
   * root-relative only when the file's own directory does not explain it.
   */
  function wasRootRelative(file, href) {
    const [p] = href.split('#');
    if (!p) return false;
    return !OLD_TO_NEW.has(posix.normalize(posix.join(posix.dirname(file), p)));
  }

  /** Resolve an href written from `file` against the OLD tree, textually. */
  function oldTarget(file, href) {
    if (/^(https?:|mailto:|#)/.test(href)) return null;
    const [p] = href.split('#');
    if (!p || !p.endsWith('.md')) return null;
    for (const cand of [posix.normalize(posix.join(posix.dirname(file), p)), posix.normalize(p)]) {
      if (OLD_TO_NEW.has(cand)) return cand;
    }
    return null;
  }

  const FILES = ALL.filter((f) =>
    /\.(md|ts|tsx|mjs|cjs|js|json|yml|yaml|css|html|xml)$/.test(f),
  ).filter((f) => f !== 'pnpm-lock.yaml' && !f.startsWith('tools/renumber-docs'));

  // ---- what each number meant, from linked citations only -------------------
  const CITEMAP = new Map();
  const PERFILE = new Map();
  for (const file of FILES) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\[([^\]\n]*)\]\(([^)\s]+)\)/g)) {
      const lead = /^(\d{2})(?:\s+(§[0-9.]+))?/.exec(m[1] ?? '');
      if (!lead) continue;
      const target = oldTarget(file, m[2] ?? '');
      if (!target) continue;
      if (!PERFILE.has(file)) PERFILE.set(file, new Map());
      const pf = PERFILE.get(file);
      for (const key of [lead[2] ? `${lead[1]} ${lead[2]}` : null, lead[1]]) {
        if (!key) continue;
        if (!CITEMAP.has(key)) CITEMAP.set(key, new Set());
        CITEMAP.get(key).add(target);
        if (!pf.has(key)) pf.set(key, new Set());
        pf.get(key).add(target);
      }
    }
  }

  const OVERRIDES = existsSync('tools/renumber-docs.overrides.json')
    ? JSON.parse(readFileSync('tools/renumber-docs.overrides.json', 'utf8'))
    : {};

  const unresolved = [];
  const byConvention = [];

  /** Section numbers a document actually has, keyed by its OLD path. */
  const SECTIONS = new Map();
  function sectionsOf(oldPath) {
    if (!SECTIONS.has(oldPath)) {
      const now = OLD_TO_NEW.get(oldPath) ?? oldPath;
      const text = existsSync(now) ? readFileSync(now, 'utf8') : '';
      SECTIONS.set(
        oldPath,
        [...text.matchAll(/^#{2,6}\s+(\d+(?:\.\d+)*|\d+[A-Z])/gm)].map((m) => m[1]),
      );
    }
    return SECTIONS.get(oldPath);
  }

  /** One `NN` or `NN §S…` citation atom. */
  function rewriteAtom(atom, file) {
    const m = /^(\d{2})(\s+§§?[0-9.]+(?:\s*[,–-]\s*[0-9.]+)*)?([\s\S]*)$/.exec(atom);
    if (!m) return atom;
    const num = m[1];
    const sec = m[2] ?? '';
    const rest = m[3] ?? '';
    const key = sec ? `${num} ${sec.trim().split(/[,–-]/)[0].trim()}` : num;

    let target = OVERRIDES[`${file}::${atom.trim()}`] ?? OVERRIDES[atom.trim()] ?? null;
    if (!target) {
      const pf = PERFILE.get(file) ?? new Map();
      const candidates = [pf.get(key), pf.get(num), CITEMAP.get(key), CITEMAP.get(num)];
      let set = candidates.find((c) => c && c.size === 1) ?? candidates.find(Boolean);

      /**
       * **The second, independent signal**, used only when the link evidence is
       * ambiguous: does the section actually exist in the candidate?
       *
       * `[02 §8]` is design-02 or workplan-02 depending on where it was written,
       * and one of the two has no §8 at all. Weak alone — good as a tiebreaker,
       * and a disagreement with the link evidence is worth an override rather
       * than a guess.
       */
      if (set && set.size > 1 && sec) {
        const want = sec.replace(/[§\s]/g, '').split(/[,–-]/)[0];
        const has = [...set].filter((old) =>
          sectionsOf(old).some((s) => s === want || s.startsWith(`${want}.`)),
        );
        if (has.length === 1) set = new Set(has);
      }

      /**
       * **Last, the convention itself — which is a rule, not a majority guess.**
       *
       * Both READMEs say a design document is cited by bare number and a
       * work-plan document by name. So an *unlinked* `[NN §x]` that the evidence
       * above cannot separate is, by the stated rule, the design document. Where
       * that is wrong the file's own linked citations say so, and those were
       * consulted first.
       */
      if (set && set.size > 1) {
        const design = [...set].filter((old) => !isPlan(old));
        if (design.length === 1) {
          byConvention.push(`[${atom.trim()}] in ${file} -> ${design[0]}`);
          set = new Set(design);
        }
      }

      if (!set || set.size !== 1) {
        unresolved.push(`[${atom.trim()}]  in ${file}  (${set ? set.size : 0} candidates)`);
        return atom;
      }
      target = [...set][0];
    }
    const next = OLD_TO_NEW.get(target);
    return next ? `${labelFor(next)}${sec}${rest}` : atom;
  }

  const PATTERN = new RegExp(
    [
      String.raw`\[([^\]\n]*)\]\(([^)\s]+)\)`,
      String.raw`(?<![.\w/])((?:\.\.\/)*)docs\/design\/((?:workplan\/)?\d{2}-[a-z0-9-]+\.md)`,
      String.raw`(docs\/design\/(?:workplan\/)?)(\d{2})(?![\w.-])`,
      String.raw`^(#[ ]+)(\d{2})([ ]+—)`,
      String.raw`\[(\d{2}(?!\d)(?:\s+(?:§|[A-Z])[^\]\n]*)?)\](?!\()`,
    ].join('|'),
    'gm',
  );

  let changed = 0;
  for (const file of FILES) {
    const before = readFileSync(file, 'utf8');
    const after = before.replace(
      PATTERN,
      (whole, label, href, up, tail, folder, folderNum, h1, h1num, h1dash, bare) => {
        // markdown link
        if (href !== undefined) {
          const target = oldTarget(file, href);
          if (!target) return whole;
          const next = OLD_TO_NEW.get(target);
          const frag = href.includes('#') ? `#${href.slice(href.indexOf('#') + 1)}` : '';
          const newHref = wasRootRelative(file, href)
            ? next + frag
            : posix.relative(posix.dirname(file), next) + frag;
          let newLabel = label;
          if (/^\d{2}(?=[\s\]\-—.]|$)/.test(label)) {
            newLabel = `${labelFor(next)}${label.slice(2)}`;
          } else if (/^\d{2}-[a-z0-9-]+(\.md)?$/.test(label)) {
            const base = next.slice(next.lastIndexOf('/') + 1);
            newLabel = label.endsWith('.md') ? base : base.replace(/\.md$/, '');
          }
          return `[${newLabel}](${newHref})`;
        }
        // bare path, with its `../` run preserved
        if (tail !== undefined) {
          const next = OLD_TO_NEW.get(`docs/design/${tail}`);
          return next ? `${up}${next}` : whole;
        }
        // folder + number, no filename
        if (folderNum !== undefined) {
          const wantPlan = folder.endsWith('workplan/');
          const old = [...OLD_TO_NEW.keys()].find(
            (k) => isPlan(k) === wantPlan && numberOf(k) === folderNum,
          );
          const next = old ? OLD_TO_NEW.get(old) : null;
          return next ? `${folder}${numberOf(next)}` : whole;
        }
        // H1
        if (h1num !== undefined) {
          const next = OLD_TO_NEW.get(file) ?? file;
          return `${h1}${numberOf(next) ?? h1num}${h1dash}`;
        }
        // unlinked citation, atoms split on commas
        if (bare !== undefined) {
          // A bare [NN] with no section is a documentation reference in prose and
          // an ARRAY INDEX in code. ihdr[10] is not a citation of the schemas
          // note. Outside markdown, require a section or an item id.
          if (!file.endsWith('.md') && !/^\d{2}\s+(§|[A-Z])/.test(bare)) return whole;
          const out = bare
            .split(/(,\s*)/)
            .map((a, i) => (i % 2 === 0 && /^\d{2}/.test(a) ? rewriteAtom(a, file) : a));
          return `[${out.join('')}]`;
        }
        return whole;
      },
    );
    if (after !== before) {
      if (!DRY) writeFileSync(file, after);
      changed += 1;
    }
  }

  console.log(`${DRY ? 'would rewrite' : 'rewrote'} ${String(changed)} file(s)`);
  console.log(
    `${String(byConvention.length)} unlinked citation(s) fell through to the convention:`,
  );
  {
    const c = new Map();
    for (const b of byConvention) {
      const k = b.slice(0, b.indexOf(']') + 1) + ' -> ' + b.slice(b.lastIndexOf(' ') + 1);
      c.set(k, (c.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...c].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n)}x ${k}`);
  }

  if (unresolved.length) {
    const counts = new Map();
    for (const u of unresolved) counts.set(u, (counts.get(u) ?? 0) + 1);
    console.log(`\n${String(unresolved.length)} unresolved, ${String(counts.size)} distinct:`);
    for (const [u, n] of [...counts].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n)}x ${u}`);
  }
}
