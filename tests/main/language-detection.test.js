import { describe, expect, it } from "vitest"

import { LANGUAGES } from "../../src/editor/languages.js"
import {
    MIN_CONFIDENCE,
    MIN_LENGTH,
    PLAIN_LANGUAGE,
    STRONG_CONFIDENCE,
    detectLanguage,
    detectableLanguages,
} from "../../src/editor/language-detection/detect.js"
import { detectBlocks } from "../../src/editor/language-detection/detect-blocks.js"
import { hasCompleteFencedBlock } from "../../src/editor/language-detection/structural.js"

/** One representative snippet per block language (except plain text/math). */
const POSITIVES = {
    json: '{"user": {"id": 1, "name": "x"}, "items": [1, 2, 3]}',
    jsonc: '{\n  // account settings\n  "name": "x", /* note */\n  "theme": "dark",\n}',
    javascript: "const nums = [1, 2, 3]\nconst doubled = nums.map(n => n * 2)\nconsole.log(doubled)",
    jsx: 'function App() {\n  return <div className="x">{value}</div>\n}',
    typescript: "interface User { id: number; name: string }\nexport const f = (u: User): string => u.name",
    tsx: "type Props = { n: number }\nexport const C = (p: Props) => <div>{p.n}</div>",
    html: "<!DOCTYPE html>\n<html><body><h1>Hi</h1><p>text</p></body></html>",
    vue: '<template>\n  <div>{{ msg }}</div>\n</template>\n<script setup>\nconst msg = "hi"\n</script>',
    css: ".card {\n  color: red;\n  margin: 0 auto;\n}",
    scss: "$primary: #333;\n.card {\n  color: $primary;\n  &:hover { color: red; }\n}",
    less: "@primary: #333;\n.card {\n  color: @primary;\n  .mixin() { color: red; }\n}",
    xml: '<?xml version="1.0"?>\n<root><item id="1">one</item><item id="2">two</item></root>',
    graphql: "query GetUser {\n  user(id: 1) {\n    id\n    name\n  }\n}",
    sql: "SELECT id, name FROM users WHERE age > 18 ORDER BY name;",
    python: "import math\n\ndef area(r):\n    return math.pi * r ** 2\n\nprint(area(2))",
    yaml: "name: test\nversion: 1\nitems:\n  - a\n  - b",
    toml: '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"',
    markdown: "# Title\n\nSome **bold** text and a list:\n- one\n- two",
    shell: '#!/bin/bash\nset -e\necho "start"\nfor f in *.txt; do\n  cat "$f"\ndone',
    powershell: 'param($Name)\nWrite-Host "hello $Name"\nGet-ChildItem | Where-Object { $_.Length -gt 0 }',
    dockerfile: 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "index.js"]',
    diff: "diff --git a/a.txt b/a.txt\nindex 111..222 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-old\n+new",
    rust: 'fn main() {\n    let mut x = 1;\n    println!("{}", x);\n}',
    golang: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}',
    java: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  }\n}',
    c: '#include <stdio.h>\nint main(void) {\n  printf("hi\\n");\n  return 0;\n}',
    cpp: '#include <iostream>\nint main() {\n  std::cout << "hi" << std::endl;\n}',
    csharp:
        'using System;\nnamespace Demo {\n  public class P {\n    static void Main() { Console.WriteLine("hi"); }\n  }\n}',
    objectivec: "#import <Foundation/Foundation.h>\n@interface Foo : NSObject\n@end\n@implementation Foo\n@end",
    protobuf: 'syntax = "proto3";\nmessage User {\n  int32 id = 1;\n  string name = 2;\n}',
    php: "<?php\nclass User {\n  public function name() { return $this->name; }\n}",
    ruby: 'def greet(name)\n  puts "hi #{name}"\nend\n[1,2].each do |n|\n  puts n\nend',
    swift: 'import SwiftUI\nstruct ContentView: View {\n  var body: some View { Text("hi") }\n}',
    kotlin: 'data class User(val id: Int, val name: String)\n\nfun main() {\n  println(User(1, "a"))\n}',
    lua: 'local x = 1\nfunction greet(name)\n  print("hi " .. name)\nend',
    clojure: '(ns demo.core)\n\n(defn greet [name]\n  (println "hi" name))',
    elixir: 'defmodule Demo do\n  def greet(name) do\n    IO.puts("hi #{name}")\n  end\nend',
    erlang: '-module(demo).\n-export([main/0]).\n\nmain() ->\n    io:format("hi~n").',
    dart: "import 'package:flutter/material.dart';\n\nvoid main() {\n  runApp(App());\n}",
    scala: 'object Main extends App {\n  case class User(name: String)\n  val u = User("a")\n  println(u)\n}',
    groovy: "def list = [1, 2, 3]\nlist.each { println it }",
    mermaid: "graph TD\n  A[Start] --> B{Choice}\n  B -->|yes| C[Do it]",
    lezer: "@top Document { Statement* }\n\n@tokens {\n  Ident { $[a-zA-Z_]+ }\n}",
}

const NEGATIVES = {
    prose: "Remember to buy milk and call the dentist tomorrow morning.",
    schedule: "10:30 standup\n11:00 review\n13:00 lunch",
    sqlInProse: "Please select one item from the list where needed.",
    letInProse: "Let me know if you can make it to the meeting on Friday.",
    colonProse: "Reminder: buy milk and eggs on the way home.",
    releaseNotes: "Version 2.1.0\n- Fixed crash on startup\n- Added dark mode",
    todoProse: "TODO: call plumber\nTODO: pay rent",
    email: "Hi team,\n\nQuick update on the release: we are on track.\n\nBest,\nAlex",
    chinese: "明天上午十点开会，记得带上笔记本和充电器。",
}

describe("detectLanguage", () => {
    it.each(Object.entries(POSITIVES))("detects %s", (expected, text) => {
        const result = detectLanguage(text)
        expect(result.language, `runner-up: ${result.runnerUp}`).toBe(expected)
        expect(result.confidence).toBeGreaterThan(0)
    })

    it.each(Object.entries(NEGATIVES))("keeps prose as plain text (%s)", (_name, text) => {
        const result = detectLanguage(text)
        expect(result.language).toBe(PLAIN_LANGUAGE)
        expect(result.stable).toBe(false)
    })

    it("distinguishes strict JSON from JSON with comments", () => {
        expect(detectLanguage('{"a": 1}').language).toBe("json")
        expect(detectLanguage('{"a": 1, /* note */ "b": 2}').language).toBe("jsonc")
    })

    it("distinguishes JavaScript from TypeScript", () => {
        expect(detectLanguage("const x = 1\nconsole.log(x)").language).toBe("javascript")
        expect(detectLanguage("interface X { a: number }\nconst y: X = { a: 1 }").language).toBe("typescript")
    })

    it("distinguishes JSX/TSX from plain HTML", () => {
        expect(detectLanguage("<div>hello</div>").language).toBe("html")
        expect(detectLanguage("export const A = () => <div>{x}</div>").language).toBe("jsx")
    })

    it("keeps short and empty input as plain text", () => {
        expect(detectLanguage("")).toEqual({ language: PLAIN_LANGUAGE, confidence: 0, runnerUp: null, stable: false })
        expect(detectLanguage("   \n")).toEqual({
            language: PLAIN_LANGUAGE,
            confidence: 0,
            runnerUp: null,
            stable: false,
        })
        // Below MIN_LENGTH the evidence is halved and cannot win.
        expect(detectLanguage("a=1").language).toBe(PLAIN_LANGUAGE)
        expect("a=1".length).toBeLessThan(MIN_LENGTH)
    })

    it("marks a clearly unique signature as stable even when short", () => {
        const result = detectLanguage('syntax = "proto3";\nmessage A {}')
        expect(result.language).toBe("protobuf")
        expect(result.stable).toBe(true)
        expect(result.confidence).toBeGreaterThanOrEqual(STRONG_CONFIDENCE)
    })

    it("reports the runner-up for ambiguous input", () => {
        const result = detectLanguage("val x = 1\nprintln(x)")
        expect(result.language).toBe("kotlin")
        expect(result.runnerUp).toBe("scala")
        expect(result.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE)
    })

    it("refuses to switch when the winner is not clearly ahead", () => {
        const result = detectLanguage("func f() { }")
        expect(result.language).toBe("golang")
        expect(result.runnerUp).toBe("swift")
        expect(result.stable).toBe(false)
    })

    it("is deterministic", () => {
        const text = POSITIVES.typescript
        expect(detectLanguage(text)).toEqual(detectLanguage(text))
    })

    it("detects Markdown fences as a strong shortcut", () => {
        const text = "```js\nconst x = 1\n```"
        expect(hasCompleteFencedBlock(text)).toBe(true)
        expect(detectLanguage(text).language).toBe("markdown")
        expect(detectLanguage(text).stable).toBe(true)
    })
})

describe("detectBlocks", () => {
    it("returns one result per input, keyed by index", () => {
        const results = detectBlocks([
            { index: 3, text: POSITIVES.json },
            { index: 7, text: NEGATIVES.prose },
        ])
        expect(results.map((result) => result.index)).toEqual([3, 7])
        expect(results[0]).toMatchObject({ language: "json", index: 3 })
        expect(results[1]).toMatchObject({ language: PLAIN_LANGUAGE, index: 7 })
    })
})

describe("detection coverage", () => {
    const plain = new Set([PLAIN_LANGUAGE, "math"])
    const tokens = LANGUAGES.map((language) => language.token)

    it("can detect every non-plain block language", () => {
        const detectable = new Set(detectableLanguages())
        expect(tokens.filter((token) => !plain.has(token) && !detectable.has(token))).toEqual([])
    })

    it("does not invent languages that are not block languages", () => {
        const known = new Set(tokens)
        expect(detectableLanguages().filter((id) => !known.has(id))).toEqual([])
    })

    it("only proposes languages that have a parser (highlighting follows detection)", () => {
        for (const id of detectableLanguages()) {
            const language = LANGUAGES.find((entry) => entry.token === id)
            expect(language?.parser, id).toBeTruthy()
        }
    })
})
