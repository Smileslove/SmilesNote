# Heynote

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/heyman/heynote)](https://github.com/heyman/heynote/releases)
[![Build Status](https://github.com/heyman/heynote/workflows/Tests/badge.svg)](https://github.com/heyman/heynote/actions?query=workflow%3ATests)

<img src="https://heynote.com/img/logo.png" style="width:79px;">

## General Information

- [Website](https://heynote.com)
- [Documentation](https://heynote.com/docs/)
- [Changelog](https://heynote.com/docs/changelog/)

Heynote is a scratchpad and note-taking app for developers and power users. It functions as a large persistent text buffer where you can write down anything you like. Works great for that Slack message you don't want to accidentally send, a JSON response from an API you're working with, notes from a meeting, your daily to-do list, etc. 

Heynote buffers are divided into blocks, and each block can have its own Language set (e.g. JavaScript, JSON, Markdown, etc.). This gives you syntax highlighting and lets you auto-format that JSON response. Just hit `Ctrl/Cmd + Enter` to create a new block.

Available for Mac, Windows, and Linux.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://heynote.com/img/dark/screenshot3.png">
  <img src="https://heynote.com/img/light/screenshot3.png" width="851" alt="New sidebar buffer tree feature">
</picture>

## Features

-   Persistent text buffers
-   Block-based
-   Inline images
-   Multiple buffers in tabs
-   Search (single and multi buffer)
-   Math/Calculator mode
-   Currency conversion
-   Syntax highlighting:

    C, C++, C#, Clojure, CSS, Dockerfile, Elixir, Erlang, Dart, Go, GraphQL, Groovy, HTML, Java, JavaScript, JSON, JSONC, JSX, Kotlin, Less, Lezer, Markdown, Mermaid, Objective-C, PHP, Protobuf, Python, Ruby, Rust, Scala, SCSS, Shell, SQL, Swift, TOML, TSX, TypeScript, Vue, XML, YAML
    
-   Language auto-detection (rule-based, 43 block languages, no downloads)
-   Auto-formatting (Prettier, wasm formatters, and dprint; 27 block languages)
-   Multi-cursor editing
-   Dark & Light themes
-   Option to set a global hotkey to show/hide the app
-   Default, Emacs-like or custom key bindings
-   Spellchecking


## Documentation

[Documentation](https://heynote.com/docs/) is available on the Heynote website.

## Development

To develop Heynote you need Node.js and you should (hopefully) just need to check out the code and then run:

```
> npm install
> npm run dev
```

### Run Tests

To run the tests:

```
> npm run test
```

To run the tests in the Playwright UI:

```
> npm run test:ui
```


### Contributions

I'm happy to merge contributions that fit my vision for the app. Bug fixes are always welcome. 


## FAQ

### Where is the buffer data stored?

See the [documentation](https://heynote.com/docs/#user-content-the-notes-library).

### Can you make a mobile app?

No, at the moment this is out of scope, sorry.

### What are the default keyboard shortcuts?

See the [documentation](https://heynote.com/docs/#user-content-default-key-bindings).


## Thanks!

Heynote is built upon [CodeMirror](https://codemirror.net/), [Vue](https://vuejs.org/), [Electron](https://www.electronjs.org/), [Math.js](https://mathjs.org/), [Prettier](https://prettier.io/) and other great open-source projects.

