# Contributing to KITE Local

Issues and pull requests are welcome. This page says how to report a problem
and how to prepare a change so it can be merged without back-and-forth.

## Reporting a problem

Open an [issue](https://github.com/ifsnop/kite/issues) with:

- the browser and its version;
- a minimal sample file that shows the problem;
- what you expected and what happened instead (with the console error, if
  there is one).

**Do not attach operational, confidential or personally identifiable
geospatial data to a public issue.** Cut the file down to a few placemarks, or
replace names and coordinates, before you upload it.

If what you hit is a freeze or a slowdown rather than a wrong result, the
[`debug` branch](https://github.com/ifsnop/kite/tree/debug) carries an
instrumented build that answers questions a console error cannot — see
[Diagnosing a freeze or a slowdown](README.md#diagnosing-a-freeze-or-a-slowdown-debug-branch).
Its output pastes straight into an issue.

## Setting up

```bash
git clone https://github.com/ifsnop/kite.git
cd kite
npm install
ln -s ../../scripts/hooks/pre-commit .git/hooks/pre-commit   # once per clone
chmod +x scripts/hooks/pre-commit
npm run browser   # optional: Chromium for the browser test suites
```

**The pre-commit hook.** `.git/hooks/` isn't tracked by git, so the symlink has
to be created once per clone; the script itself lives at
`scripts/hooks/pre-commit`, a normal tracked file, reviewable like anything
else. Once linked, any commit that touches `src/` or `package.json` bumps
`BUILD` (`src/js/10-map.js`) to the current timestamp, runs `npm run build`,
and stages the regenerated `kitelocal.html`/`kitelocal.min.html` before the
commit is created; a commit that only touches `docs/`, `tests/` or the
documentation is left untouched. If the hook's own build or syntax check
fails, the commit is aborted and the working tree is restored to exactly how it
was, so the actual error is the only thing left to look at. Without the
symlink nothing breaks: `BUILD` just stays where it was, and `npm run check` and
the CI still catch a stale artifact.

## Making a change

- **Edit `src/`, never the generated files.** `kitelocal.html`,
  `kitelocal.min.html` and `sw.js` are built from `src/` by `npm run build` (a
  plain concatenation: no framework, no bundler). An edit made to them by hand
  is lost at the next build, and the tests fail when they don't match `src/`.
- **Reuse before writing.** Check whether Leaflet or another stable library
  already solves it. A new library is pinned to an exact version.
- **Treat every file and every network answer as hostile.** Validate before
  building layers, isolate errors per feature, cap sizes, and tell the user
  what was loaded and what was skipped, and why.
- **No backward-compatibility code.** Stored data is versioned; what doesn't
  match the current version is dropped, not migrated, unless a migration was
  explicitly agreed.
- **Run the whole battery before a pull request**: `npm run build`, then
  `node tests/run-all.js` (or `npm test`). A change to covered behaviour updates
  its suite in the same change; new behaviour adds a test. What each suite
  covers is described in [`tests/README.md`](tests/README.md), which is
  updated with the suite.
- **Keep the documents in step.** A change a user can see updates the user
  manual (`docs/manual-usuario-kite-local.md`, with its screenshot regenerated
  by `npm run capturas`, never taken by hand), adds one plain sentence to the
  `"next"` entry of the «Novedades» window (`src/js/68-whats-new.js`) and, when
  it applies, the README and the security study (a new server contacted, a new
  data transformation). Known gaps and ideas live in a single list,
  [`docs/pendientes-y-propuestas-kite-local.md`](docs/pendientes-y-propuestas-kite-local.md):
  what a change does is removed from it, what it leaves pending is added.
- **Every new keyboard shortcut** goes in the cheat sheet (`?`) and in
  section 8 of the manual, with the same words.

The project's working rules, one file per subsystem, are in
[`.claude/rules/`](.claude/rules/), indexed by [`CLAUDE.md`](CLAUDE.md);
`00-principles.md` holds the ones that always apply. They are written for AI
coding agents and humans alike.

## Language

- **English** for everything another contributor reads: code comments,
  commit messages, pull request titles and descriptions, review comments,
  branch names and developer documentation. Older Spanish comments are not
  translated in bulk, but a comment or paragraph that a change edits is
  rewritten in English in that change.
- **Spanish** for the interface text, written inside `tr("…")`, and for the two
  documents written for end users and auditors (the user manual and the
  security study in `docs/`).

## Translations

The interface is available in Spanish (the source language) and English, and
picks the browser's language by default (Properties → Preferences → Language
overrides it). The Spanish text in the code *is* the translation key
(`tr("Cancelar")`), so there is no separate catalogue to keep in step; each
language is one dictionary file, `src/js/04-i18n-<code>.js`. Interface text is
never concatenated: variables go in `{braces}` so a translation can reorder
them. To add a language:

```bash
node i18n-tool.js new fr "Français"   # creates src/js/04-i18n-fr.js with every key empty
# add "04-i18n-fr.js", to the JS manifest in build.js, before "04-i18n-init.js"
npm run i18n                          # how much of each language is translated
node i18n-tool.js sync fr             # after the code changes: keep what is translated, add new keys
```

An empty value falls back to English, then to Spanish, so a partial
translation is fine; English must stay complete (`npm test` checks it, along
with placeholders and that no Spanish literal is left outside `tr()`).
Right-to-left languages are not supported yet. The details are in
[`.claude/rules/i18n.md`](.claude/rules/i18n.md).

## Pull requests

- Branch from `main`; one topic per pull request.
- Say what changed for the user and how it was tested; the CI runs the full
  battery, browser suites included.
- Releases are prepared by the maintainer (see
  [Releasing](README.md#releasing) in the README).

By contributing you agree that your contribution is licensed under the
project's [license](LICENSE).
