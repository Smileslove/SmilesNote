# Automatic language detection

Blocks can follow the content the user types: a block in **auto** mode asks the
detector for a language and rewrites only its header when the answer is
confident. Detection never touches the block body or its `created` metadata, and
it never overrides a language the user picked by hand.

This replaces the previous guesslang (TensorFlow.js) detector. Detection is now a
pure, rule-based scorer with no model download and no external assets.

## Turning it on

- New blocks are created in auto mode when *Settings → Auto-detection* is on
  (the default). Such blocks are stored as `∞∞∞<language>-a`.
- The language selector's **Auto-detect** entry switches an existing block to
  auto mode without changing its current language.
- Picking a language explicitly turns auto mode off (`∞∞∞<language>` without
  `-a`). That block will never be re-detected.

## What happens on an edit

1. Any user edit bumps the document's detection sequence and schedules a check
   after 500 ms of inactivity. The editor's own header rewrites, `created`
   metadata refreshes, cursor changes and image resizes are ignored.
2. **All** auto blocks of the note are sent in one batch to a dedicated worker —
   not just the block under the cursor. Pasting a multi-block note therefore
   detects every pasted block.
3. The worker scores each block (see below) and returns one result per block.
4. A result is applied only when:
   - the request is still the newest one, the document sequence is unchanged and
     the block still contains exactly the text that was analyzed;
   - the engine reports the winner as `stable` (it leads the runner-up by at
     least `MIN_MARGIN`, or the evidence is overwhelming);
   - the block is still in auto mode;
   - hysteresis allows it: a block that already has a language keeps it while
     the text is shorter than `MIN_SWITCH_LENGTH` unless the confidence reaches
     `STRONG_CONFIDENCE`.
5. Replacing a block's whole body (paste, undo into a block) may clear stale
   syntax back to plain text. Deleting all content resets the block to the
   default block language instead.
6. Language rewrites are annotated, so they cannot re-trigger detection. One
   transaction rewrites every changed header, and the rewrite is undoable like
   any other edit.

## How a block is scored

Three layers, strongest first (`src/editor/language-detection/`):

| layer | file | idea |
| --- | --- | --- |
| signatures | `signatures.js` | shapes only one language produces: shebangs, `<?php`, `<!doctype html>`, `diff --git`, protobuf `syntax =`, Mermaid headers, Lezer `@top`, Erlang `-module(...)`, ... |
| structure | `structural.js` | per-language shape checks: `SELECT ... FROM`, `interface X {`, JSX tag + code context, Vue `<template>` + `<script setup>`, YAML nesting/typed values, TOML typed literals, ... |
| signals / keywords | `signals.js` | weak regexes and keyword lists. They only add weight when a structure, a code shape or strong literals support them, and they are capped so one long block cannot dominate. |

The engine (`detect.js`) sums the evidence, requires `MIN_CONFIDENCE` (1.5) to
propose anything, and computes the margin against the runner-up. The result is
`{language, confidence, runnerUp, stable}`.

Everything is a pure function, so the whole scoring corpus runs in unit tests
(`tests/main/language-detection.test.js`): one positive sample per block language
plus prose, schedules, SQL-in-English and other false-positive traps.

## Adding a new block language

1. Add the language to `src/editor/languages.js` (token, parser, `aliases`).
2. Add it to `signals.js` (a few representative regexes and keywords) and, when
   the language has a distinctive shape, to `structural.js`.
3. If the language has an unmistakable marker, add it to `signatures.js`.
4. Add a positive sample to `tests/main/language-detection.test.js`.

`tests/main/language-detection.test.js` fails when a block language has no way to
be detected, when the engine proposes an id that is not a block language, or when
a detectable language has no parser (detection must result in real
highlighting).

## Limitations and trade-offs

- Detection is conservative by design: short snippets stay plain text, and an
  already-typed block keeps its language until the evidence is strong. Guessing
  wrong is worse than not guessing.
- There is no machine-learned fallback any more. Rare or structurally vague
  snippets (a single `println`, a bare SQL fragment) will not be classified;
  the user can pick the language once and the block stays manual.
- The worker is a bundled classic worker, so it also works in the packaged
  Electron app (`file://`); nothing is downloaded at runtime.
