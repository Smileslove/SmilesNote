import { jsonLanguage } from "@codemirror/lang-json"
import { pythonLanguage } from "@codemirror/lang-python"
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript"
import { htmlLanguage } from "@codemirror/lang-html"
import { StandardSQL } from "@codemirror/lang-sql"
import { markdownLanguage } from "@codemirror/lang-markdown"
import { javaLanguage } from "@codemirror/lang-java"
import { lezerLanguage } from "@codemirror/lang-lezer"
import { phpLanguage } from "@codemirror/lang-php"
import { cssLanguage } from "@codemirror/lang-css"
import { cppLanguage } from "@codemirror/lang-cpp"
import { xmlLanguage } from "@codemirror/lang-xml"
import { rustLanguage } from "@codemirror/lang-rust"
import { csharpLanguage } from "@replit/codemirror-lang-csharp"
import { vueLanguage } from "@codemirror/lang-vue";
import { mermaidLanguage } from 'codemirror-lang-mermaid';

import { StreamLanguage } from "@codemirror/language"
import { ruby } from "@codemirror/legacy-modes/mode/ruby"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { yaml } from "@codemirror/legacy-modes/mode/yaml"
import { go } from "@codemirror/legacy-modes/mode/go"
import { clojure } from "@codemirror/legacy-modes/mode/clojure"
import { elixirLanguage } from "codemirror-lang-elixir"
import { erlang } from "@codemirror/legacy-modes/mode/erlang"
import { toml } from "@codemirror/legacy-modes/mode/toml"
import { swift } from "@codemirror/legacy-modes/mode/swift"
import { kotlin, dart, scala } from "@codemirror/legacy-modes/mode/clike"
import { groovy } from "@codemirror/legacy-modes/mode/groovy"
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { objectiveC } from "@codemirror/legacy-modes/mode/clike"
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf"
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile"

import { graphqlParser } from "./graphql-language.ts"
import { mathjsLanguage } from "heynote-lang-mathjs"


/**
 * Formatting backends are declared as plain data and loaded by
 * `src/editor/formatting/`:
 *
 *   {kind: "prettier", parser: "<name>"}   Prettier standalone, lazy plugins
 *   {kind: "wasm", formatter: "<id>"}      bundled wasm formatter (ruff, gofmt, ...)
 *   {kind: "dprint", plugin: "<id>"}       dprint plugin (toml)
 *
 * A language without a `formatter` has no bundled formatter. That is a valid,
 * honest state; the UI reports it instead of failing silently. Never import
 * Prettier, a wasm file or a plugin in this file: `vite.config.mjs` imports
 * LANGUAGES in Node at config time, and capability checks run on the UI thread.
 */
class Language {
    /**
     * @param token: The token used to identify the language in the buffer content
     * @param name: The name of the language
     * @param parser: The Lezer parser used to parse the language
     * @param guesslang: The name of the language as used by the guesslang library
     * @param formatter: The formatter spec for the language (if any)
     * @param inheritIndentation: If true, the indentService will return null for blocks of this type, which will 
     *                            result in the  line inheriting the indentation of the one above it
     */
    constructor({ token, name, parser, guesslang, formatter, inheritIndentation }) {
        this.token = token
        this.name = name
        this.parser = parser
        this.guesslang = guesslang
        this.formatter = formatter
        this.inheritIndentation = inheritIndentation
    }
}

export const LANGUAGES = [
    new Language({
        token: "text",
        name: "Plain Text",
        parser: null,
        guesslang: null,
        inheritIndentation: true,
    }),
    new Language({
        token: "math",
        name: "Math",
        parser: mathjsLanguage.parser,
        guesslang: null,
        inheritIndentation: true,
    }),
    new Language({
        token: "json",
        name: "JSON",
        parser: jsonLanguage.parser,
        guesslang: "json",
        formatter: {kind: "prettier", parser: "json-stringify"},
    }),
    new Language({
        token: "jsonc",
        name: "JSONC",
        // JSON with comments/trailing commas. Prettier's lenient json parser
        // keeps the author's line wrapping, so it does not force expansion.
        parser: jsonLanguage.parser,
        guesslang: null,
        formatter: {kind: "prettier", parser: "json"},
    }),
    new Language({
        token: "python",
        name: "Python",
        parser: pythonLanguage.parser,
        guesslang: "py",
        formatter: {kind: "wasm", formatter: "python"},
    }),
    new Language({
        token: "html",
        name: "HTML",
        parser: htmlLanguage.parser,
        guesslang: "html",
        formatter: {kind: "prettier", parser: "html"},
    }),
    new Language({
        token: "sql",
        name: "SQL",
        parser: StandardSQL.language.parser,
        guesslang: "sql",
        inheritIndentation: true,
        formatter: {kind: "wasm", formatter: "sql"},
    }),
    new Language({
        token: "markdown",
        name: "Markdown",
        parser: markdownLanguage.parser,
        guesslang: "md",
        formatter: {kind: "prettier", parser: "markdown"},
    }),
    new Language({
        token: "java",
        name: "Java",
        parser: javaLanguage.parser,
        guesslang: "java",
        formatter: {kind: "prettier", parser: "java"},
    }),
    new Language({
        token: "lezer",
        name: "Lezer",
        parser: lezerLanguage.parser,
        guesslang: null,
    }),
    new Language({
        token: "php",
        name: "PHP",
        parser: phpLanguage.configure({top:"Program"}).parser,
        guesslang: "php",
    }),
    new Language({
        token: "css",
        name: "CSS",
        parser: cssLanguage.parser,
        guesslang: "css",
        formatter: {kind: "prettier", parser: "css"},
    }),
    new Language({
        token: "scss",
        name: "SCSS",
        // Approximate highlighting: reuses the CSS parser. Formatting is exact
        // (Prettier's scss parser).
        parser: cssLanguage.parser,
        guesslang: null,
        formatter: {kind: "prettier", parser: "scss"},
    }),
    new Language({
        token: "less",
        name: "Less",
        parser: cssLanguage.parser,
        guesslang: null,
        formatter: {kind: "prettier", parser: "less"},
    }),
    new Language({
        token: "xml",
        name: "XML",
        parser: xmlLanguage.parser,
        guesslang: "xml",
        formatter: {kind: "prettier", parser: "xml"},
    }),
    new Language({
        token: "graphql",
        name: "GraphQL",
        parser: graphqlParser,
        guesslang: null,
        formatter: {kind: "prettier", parser: "graphql"},
    }),
    new Language({
        token: "cpp",
        name: "C++",
        parser: cppLanguage.parser,
        guesslang: "cpp",
        formatter: {kind: "wasm", formatter: "clang"},
    }),
    new Language({
        token: "c",
        name: "C",
        parser: cppLanguage.parser,
        // Guesslang cannot reliably tell C from C++; leave auto-detection to C++
        // (the user can still pick C explicitly).
        guesslang: null,
        formatter: {kind: "wasm", formatter: "clang"},
    }),
    new Language({
        token: "rust",
        name: "Rust",
        parser: rustLanguage.parser,
        guesslang: "rs",
    }),
    new Language({
        token: "csharp",
        name: "C#",
        parser: csharpLanguage.parser,
        guesslang: "cs",
        formatter: {kind: "wasm", formatter: "clang"},
    }),
    new Language({
        token: "objectivec",
        name: "Objective-C",
        parser: StreamLanguage.define(objectiveC).parser,
        guesslang: null,
        formatter: {kind: "wasm", formatter: "clang"},
    }),
    new Language({
        token: "protobuf",
        name: "Protobuf",
        parser: StreamLanguage.define(protobuf).parser,
        guesslang: null,
        formatter: {kind: "wasm", formatter: "clang"},
    }),
    new Language({
        token: "ruby",
        name: "Ruby",
        parser: StreamLanguage.define(ruby).parser,
        guesslang: "rb",
    }),
    new Language({
        token: "shell",
        name: "Shell",
        parser: StreamLanguage.define(shell).parser,
        guesslang: "sh",
        formatter: {kind: "wasm", formatter: "sh"},
    }),
    new Language({
        token: "dockerfile",
        name: "Dockerfile",
        parser: StreamLanguage.define(dockerFile).parser,
        guesslang: null,
        formatter: {kind: "wasm", formatter: "dockerfile"},
    }),
    new Language({
        token: "yaml",
        name: "YAML",
        parser: StreamLanguage.define(yaml).parser,
        guesslang: "yaml",
        formatter: {kind: "prettier", parser: "yaml"},
    }),
    new Language({
        token: "toml",
        name: "TOML",
        parser: StreamLanguage.define(toml).parser,
        guesslang: "toml",
        formatter: {kind: "dprint", plugin: "toml"},
    }),
    new Language({
        token: "golang",
        name: "Go",
        parser: StreamLanguage.define(go).parser,
        guesslang: "go",
        formatter: {kind: "wasm", formatter: "go"},
    }),
    new Language({
        token: "clojure",
        name: "Clojure",
        parser: StreamLanguage.define(clojure).parser,
        guesslang: "clj",
    }),
    new Language({
        token: "elixir",
        name: "Elixir",
        parser: elixirLanguage.parser,
        guesslang: "ex",
    }),
    new Language({
        token: "erlang",
        name: "Erlang",
        parser: StreamLanguage.define(erlang).parser,
        guesslang: "erl",
    }),
    new Language({
        token: "javascript",
        name: "JavaScript",
        parser: javascriptLanguage.parser,
        guesslang: "js",
        formatter: {kind: "prettier", parser: "babel"},
    }),
    new Language({
        token: "jsx",
        name: "JSX",
        parser: jsxLanguage.parser,
        guesslang: null,
        formatter: {kind: "prettier", parser: "babel"},
    }),
    new Language({
        token: "typescript",
        name: "TypeScript",
        parser: typescriptLanguage.parser,
        guesslang: "ts",
        formatter: {kind: "prettier", parser: "typescript"},
    }),
    new Language({
        token: "tsx",
        name: "TSX",
        parser: tsxLanguage.parser,
        guesslang: null,
        formatter: {kind: "prettier", parser: "typescript"},
    }),
    new Language({
        token: "swift",
        name: "Swift",
        parser: StreamLanguage.define(swift).parser,
        guesslang: "swift",
    }),
    new Language({
        token: "kotlin",
        name: "Kotlin",
        parser: StreamLanguage.define(kotlin).parser,
        guesslang: "kt",
    }),
    new Language({
        token: "lua",
        name: "Lua",
        parser: StreamLanguage.define(lua).parser,
        guesslang: "lua",
    }),
    new Language({
        token: "groovy",
        name: "Groovy",
        parser: StreamLanguage.define(groovy).parser,
        guesslang: "groovy",
    }),
    new Language({
        token: "diff",
        name: "Diff",
        parser: StreamLanguage.define(diff).parser,
        guesslang: null,
    }),
    new Language({
        token: "powershell",
        name: "PowerShell",
        parser: StreamLanguage.define(powerShell).parser,
        guesslang: "ps1",
    }),
    new Language({
        token: "vue",
        name: "Vue",
        parser: vueLanguage.parser,
        guesslang: null,
        formatter: {kind: "prettier", parser: "vue"},
    }),
    new Language({
        token: "dart",
        name: "Dart",
        parser: StreamLanguage.define(dart).parser,
        guesslang: "dart",
    }),
    new Language({
        token: "scala",
        name: "Scala",
        parser: StreamLanguage.define(scala).parser,
        guesslang: "scala",
    }),
    new Language({
        token: "mermaid",
        name: "Mermaid",
        parser: mermaidLanguage.parser ,
        guesslang: null,
    }),
]


const languageMapping = Object.fromEntries(LANGUAGES.map(l => [l.token, l]))

export function getLanguage(token) {
    return languageMapping[token]
}
