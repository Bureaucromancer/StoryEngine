// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 StoryEngine contributors

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChangelogDocument } from './ChangelogDocument.js';

/**
 * The renderer, over literal bodies — `views.test.tsx`'s style: no router, no
 * providers, no fixtures shared with anything else.
 *
 * Two jobs. The first is the claim the whole revision is about: the markup a
 * person was reading as characters is now structure. The second is the set of
 * defaults this file relies on and does not control — react-markdown drops raw
 * HTML, and its URL transform refuses dangerous protocols. Those are *library*
 * behaviour, so they are pinned here rather than trusted, and adding a rehype
 * plugin is what would undo them.
 */

describe('the changelog as a document', () => {
  it('turns a `###` into a heading rather than three characters', () => {
    render(<ChangelogDocument body={'### Added\n\nSomething happened.'} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Added' })).toBeTruthy();
    expect(screen.queryByText(/###/)).toBeNull();
  });

  it('turns a run of bullets into one list, joining each wrapped bullet', () => {
    render(
      <ChangelogDocument
        body={'- The first bullet, which\n  wraps onto a second line.\n- The second bullet.'}
      />,
    );

    const list = screen.getByRole('list');

    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByRole('listitem')[0]?.textContent).toBe(
      'The first bullet, which\nwraps onto a second line.',
    );
  });

  /**
   * The bold lead opens nearly every bullet in the file. Before this it was
   * four asterisks a person had to read past; the assertion is both halves —
   * that the emphasis is real markup, and that the syntax is gone.
   */
  it('renders a bold lead as emphasis, with the asterisks gone', () => {
    const { container } = render(<ChangelogDocument body={'- **Tags, and a registry.** Then.'} />);

    expect(container.querySelector('strong')?.textContent).toBe('Tags, and a registry.');
    expect(container.textContent).not.toContain('**');
  });

  it('renders inline code as code, with the backticks gone', () => {
    const { container } = render(<ChangelogDocument body={'It carried `inset-block-0`.'} />);

    expect(container.querySelector('code')?.textContent).toBe('inset-block-0');
    expect(container.textContent).not.toContain('`');
  });

  it('renders italics from both spellings', () => {
    const { container } = render(<ChangelogDocument body={'*one* and _two_.'} />);

    expect([...container.querySelectorAll('em')].map((node) => node.textContent)).toEqual([
      'one',
      'two',
    ]);
  });
});

describe('links, of which the file has two kinds', () => {
  it('makes an absolute link a real anchor that leaves the app', () => {
    render(<ChangelogDocument body={'Versions are [semantic](https://semver.org).'} />);

    const anchor = screen.getByRole('link', { name: 'semantic' });

    expect(anchor.getAttribute('href')).toBe('https://semver.org');
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noreferrer');
  });

  /**
   * Sixteen of the file's seventeen links are these. An anchor to a repository
   * path from `/` is a full navigation the SPA fallback answers with
   * `RouteErrorCard` — a link that looks real and lands on an error card.
   */
  it('renders a relative doc link as its own words, with no anchor at all', () => {
    const { container } = render(
      <ChangelogDocument
        body={'See [releases §7](docs/design/workplan/04-repo-and-releases.md).'}
      />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('See releases §7.');
  });

  it('declines a protocol-relative or rooted link too, not just a bare path', () => {
    const { container } = render(
      <ChangelogDocument body={'[a](//evil.test) [b](/library) [c](mailto:x@y.test)'} />,
    );

    expect(container.querySelector('a')).toBeNull();
  });
});

describe('what the declared grammar does with everything else', () => {
  it('unwraps a disallowed block to its own text rather than dropping it', () => {
    const { container } = render(
      <ChangelogDocument body={'> A quotation.\n\n#### A fourth-level heading'} />,
    );

    expect(container.querySelector('blockquote')).toBeNull();
    expect(container.querySelector('h4')).toBeNull();
    expect(container.textContent).toContain('A quotation.');
    expect(container.textContent).toContain('A fourth-level heading');
  });

  /**
   * `h1` and `h2` are absent from the allowed set on purpose: the parser has
   * already consumed both, so one here is a parse failure and rendering it
   * would drop page-title-sized type into the prose.
   */
  it('does not let a stray `##` become a heading in the middle of a body', () => {
    const { container } = render(<ChangelogDocument body={'## 1.0.0 — 1.0 — 2026-01-01'} />);

    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h2')).toBeNull();
    expect(container.textContent).toContain('1.0.0 — 1.0 — 2026-01-01');
  });

  it('degrades a fenced block to its content rather than to an unstyled `pre`', () => {
    const { container } = render(<ChangelogDocument body={'```\nconst x = 1;\n```'} />);

    expect(container.querySelector('pre')).toBeNull();
    expect(container.textContent).toContain('const x = 1;');
  });
});

/**
 * **These pin library defaults, not our own code.** There is no `rehype-raw`
 * and no sanitizer: raw HTML renders as its own text, and `defaultUrlTransform`
 * refuses dangerous protocols before this file's link rule ever sees them.
 * Adding a rehype plugin undoes both at once, which is why the undoing has to
 * fail here rather than pass quietly.
 */
describe('nothing is injected as markup', () => {
  /**
   * **Text, not silence** — which is worth asserting in both directions,
   * because the two failures look identical until you look for the element.
   * The markup never becomes markup; it stays the characters somebody typed, so
   * a stray tag in the changelog is visible to whoever wrote it.
   */
  it('renders raw HTML as its own text and never as an element', () => {
    const { container } = render(
      <ChangelogDocument body={'<script>alert(1)</script>\n\n<b>bold</b> and <em>real</em>.'} />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    // The `em` here is the typed tag, not markdown emphasis: no element either.
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<b>bold</b>');
  });

  it('renders no anchor for a javascript: url, from either guard', () => {
    const { container } = render(
      <ChangelogDocument body={'[click](javascript:alert(1)) [img](data:text/html,<b>x</b>)'} />,
    );

    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('renders no image, which is the one element that unwraps to nothing', () => {
    const { container } = render(<ChangelogDocument body={'![alt](https://example.test/x.png)'} />);

    expect(container.querySelector('img')).toBeNull();
  });
});
