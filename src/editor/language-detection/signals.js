/**
 * Lightweight per-language signals and keywords.
 *
 * These are deliberately weaker than the signatures in `signatures.js` and the
 * structural scorers in `structural.js`: a single regex hit must never be enough
 * to reclassify a block. `detect.js` gives them weight only when the text has a
 * code shape or a structural scorer already found evidence, and caps their
 * contribution so one long file cannot dominate the vote.
 */

/** @type {Record<string, readonly RegExp[]>} */
export const SIGNALS = {
    json: [/^\s*[[{][\s\S]*[\]}]\s*$/u, /"[^"]+"\s*:/u],
    jsonc: [/^\s*[[{][\s\S]*[\]}]\s*$/u, /\/[/*]/u],
    javascript: [/\b(?:const|let|var|function|=>|import|export)\b/u, /\bconsole\.\w+\(/u],
    jsx: [/<[A-Za-z][\w.:-]*(?:\s[^<>]*)?>/u, /\bclassName\s*=/u],
    typescript: [/\b(?:interface|type|enum)\s+\w+/u, /:\s*(?:string|number|boolean)\b/u, /\bas\s+const\b/u],
    tsx: [/<[A-Za-z][\w.:-]*(?:\s[^<>]*)?>/u, /:\s*(?:string|number|boolean)\b/u],
    html: [/<(!doctype|html|div|span|p|body|head|section|main)\b/iu],
    vue: [/<template[\s>]/iu, /<script\s+setup\b/iu, /<script\b[^>]*>\s*export\s+default\b/iu],
    css: [/[\w-]+\s*:\s*[^;{]+;/u, /@media\b/u],
    scss: [/^\s*\$[\w-]+\s*:/mu, /@(use|mixin|include|extend)\b/u, /&\s*[:.{]/u],
    less: [/^\s*@[\w-]+\s*:/mu, /\.mixin\(/u, /@\{[\w-]+\}/u],
    xml: [/^\s*<\?xml\b/iu, /<[\w:-]+(?:\s[\w:-]+="[^"]*")*\s*\/?>/u],
    graphql: [
        /^\s*(?:query|mutation|subscription)\b[^;{}\n]*\{/mu,
        /^\s*fragment\s+[_A-Za-z]\w*\s+on\s+[_A-Za-z]\w*/mu,
        /^\s*(?:type|interface|input|enum)\s+[_A-Za-z]\w*\b[^{}\n]*\{/mu,
    ],
    sql: [/\b(?:select|insert|update|delete|create\s+table)\b/iu],
    python: [/^\s*def\s+\w+\(/mu, /^\s*(?:import|from)\s+\w+/mu, /^\s*print\(/mu],
    yaml: [/^[\w.-]+:\s+.+$/mu, /^\s*-\s+\w+/mu],
    shell: [/^#!\/.*(?:sh|bash|zsh)\b/mu, /^\s*(?:if|then|fi|for|while|case|echo)\b/mu, /\$\{?\w+/u],
    powershell: [/^\s*\$\w+\s*=/mu, /\b(?:Get|Set|New|Remove)-\w+/u, /^\s*(?:param|function)\b/mu],
    dockerfile: [/^\s*FROM\s+\S+/mu, /^\s*(?:RUN|CMD|COPY|ENTRYPOINT|EXPOSE|WORKDIR)\s/mu],
    toml: [/^\s*\[\[?[\w.-]+\]\]?\s*$/mu, /^\s*[\w.-]+\s*=\s*["[{]/mu],
    diff: [/^diff --git\b/mu, /^@@\s+-\d+/mu, /^\+\+\+\s+\S+/mu],
    rust: [/^\s*fn\s+\w+\s*[<(]/mu, /\blet\s+mut\b/u, /\bimpl\b/u, /#\[derive\(/u],
    golang: [/^package\s+\w+/mu, /^func\s+\w+/mu, /:=/u, /\bfmt\.\w+\(/u],
    java: [/\bpublic\s+(?:final\s+)?class\s+\w+/u, /\bSystem\.out\.print/u, /^\s*import\s+java\./mu],
    c: [/#include\s*<\w+\.h>/u, /^\s*(?:int|void)\s+\w+\s*\(/mu, /\bprintf\s*\(/u],
    cpp: [/#include\s*<(?:iostream|vector|string|map)>/u, /\bstd::\w+/u, /\btemplate\s*</u],
    csharp: [/\busing\s+System\b/u, /\bnamespace\s+[\w.]+/u, /\bConsole\.WriteLine\(/u],
    objectivec: [/@interface\b/u, /@implementation\b/u, /#import\s*[<"]/u],
    protobuf: [/^\s*syntax\s*=\s*"proto[23]"/mu, /^\s*message\s+\w+\s*\{/mu, /^\s*(?:repeated|optional)\s+\w+/mu],
    php: [/<\?php\b/iu, /\$\w+\s*=/u, /\b(?:function|class)\s+\w+/u],
    ruby: [/^\s*def\s+\w+[?!]?\s*$/mu, /^\s*end\s*$/mu, /\bputs\s+/u, /\bdo\s*\|\w+\|/u],
    swift: [/^\s*(?:func|let|var)\s+\w+/mu, /\bimport\s+(?:SwiftUI|Foundation|UIKit)\b/u, /\bguard\s+let\b/u],
    kotlin: [/^\s*fun\s+\w+/mu, /^\s*val\s+\w+/mu, /\bdata\s+class\b/u],
    lua: [/^\s*local\s+\w+/mu, /^\s*function\s+[\w.:]+\s*\(/mu, /\bend\s*$/mu],
    clojure: [/^\s*\(defn?-?\s/mu, /^\s*\(require\s/mu, /:[a-z][\w-]*/u],
    elixir: [/^\s*defp?\s+\w+/mu, /\|>/u, /\bIO\.(?:puts|inspect)\b/u],
    erlang: [/^-export\(\[/mu, /\bio:format\(/u, /\bend\s*\.\s*$/mu],
    dart: [/^\s*import\s+['"]package:/mu, /\bvoid\s+main\s*\(/u, /@override\b/u],
    scala: [/\bobject\s+\w+\s+extends\b/u, /\bcase\s+class\b/u, /^\s*import\s+scala\./mu],
    groovy: [/@Grab\b/u, /\bprintln\s+/u, /^\s*def\s+\w+/mu],
    mermaid: [/-->|-->\|/u, /^\s*participant\s+\w+/mu, /^\s*subgraph\s+/mu],
    lezer: [/^\s*@(?:top|tokens?|external|skip|precedence)\b/mu, /^\s*[A-Za-z_]\w*\s*\{/mu],
}

/** @type {Record<string, readonly string[]>} */
export const KEYWORDS = {
    javascript: ["const ", "let ", "function ", "=>", "console.log", "export ", "import ", "require(", "=== "],
    typescript: ["interface ", ": string", ": number", ": boolean", "enum ", "implements ", "as const", "?: "],
    python: ["def ", "elif ", "self.", "none", "true", "false", "print(", "import ", "from "],
    rust: ["fn ", "let mut ", "impl ", "pub fn", "use std::", "println!", "match ", "-> ", "&self", "option<", "result<"],
    golang: ["func ", ":=", "package ", "fmt.", "go func", "err != nil", "range "],
    java: ["public class", "private ", "public static void main", "import java.", "system.out.print", "extends "],
    cpp: ["#include <", "std::", "using namespace", "template<", "nullptr", "::"],
    c: ["#include <stdio.h>", "int main(", "printf(", "malloc(", "struct "],
    csharp: ["namespace ", "public class", "console.writeline", "string[]", "using system"],
    php: ["<?php", "function ", "$this->", "echo ", "public function"],
    ruby: ["def ", "puts ", "attr_accessor", ".each do", "require "],
    kotlin: ["fun ", "val ", "var ", "println(", "data class", "when ("],
    swift: ["func ", "import uikit", "import swiftui", "guard let", "struct "],
    lua: ["local ", "function ", "print(", "require("],
    graphql: ["mutation ", "subscription ", "fragment ", "implements ", "union ", "schema {"],
    sql: ["select ", "from ", "where ", "insert into", "update ", "delete from", "create table", "join ", "group by", "order by"],
    html: ["<div", "<span", "<!doctype", "</", "<html", "<p>", "<body"],
    css: ["color:", "margin:", "padding:", "@media", "display:", "font-size:", "background:"],
    shell: ["#!/", "echo ", "$(", "if [", "export ", "sudo ", "| grep"],
    powershell: ["get-", "set-", "$env:", "write-host", "param(", "foreach ("],
    objectivec: ["@interface", "@implementation", "nsstring", "nslog", "nsarray"],
    protobuf: ["message ", "syntax =", "repeated ", "optional ", "service ", "rpc "],
    clojure: ["(defn", "(ns ", "(require", "(let [", "(map "],
    elixir: ["defmodule ", "def ", "defp ", "|>", "IO.puts"],
    erlang: ["-module(", "-export(", "io:format", " -> "],
    scala: ["object ", "case class", "def ", "val ", "extends "],
    dart: ["void main()", "import 'package:", "@override", "final "],
    groovy: ["def ", "println ", "@grab", "it."],
    mermaid: ["graph td", "flowchart", "sequencediagram", "participant ", "subgraph "],
    lezer: ["@top", "@tokens", "@external", "@skip"],
}
