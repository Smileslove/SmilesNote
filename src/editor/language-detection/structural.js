/**
 * Structural scorers: the part of detection that actually tells languages apart.
 *
 * Each scorer looks for a shape that is characteristic of one language and
 * awards points for it. They are intentionally strict: a keyword alone is not a
 * shape. The scores here dominate the keyword contribution in `detect.js`.
 *
 * Every key must be a block token from `src/editor/languages.js`; a test asserts
 * that, and also that every non-plain language has a way to be detected.
 */

import { hasCompleteFencedBlock, hasJsxShape, withoutStringLiterals } from "./text-shapes.js"

function typescriptStructure(text) {
    let score = 0
    if (/^\s*(?:export\s+)?interface\s+[$A-Z_a-z][$\w]*(?:\s+extends\s+[^{]+)?\s*\{/mu.test(text)) {
        score += 3.0
    }
    if (/^\s*(?:export\s+)?type\s+[$A-Z_a-z][$\w]*(?:\s*<[^>\n]+>)?\s*=/mu.test(text)) {
        score += 2.6
    }
    if (/^\s*(?:export\s+)?(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*:\s*[^=\n]+=/mu.test(text)) {
        score += 2.8
    }
    if (/^\s*(?:export\s+)?(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*=\s*<[A-Z][\w,\s]*>\s*\(/mu.test(text)) {
        score += 3.4
    }
    if (/^\s*(?:export\s+)?(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*=\s*\([^)\n]*:[^)\n]+\)\s*=>/mu.test(text)) {
        score += 3.2
    }
    if (
        /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+[$A-Z_a-z][$\w]*\s*\([^)\n]*:[^)\n]+\)\s*(?::\s*[^{;\n]+)?\s*\{/mu.test(
            text,
        )
    ) {
        score += 3.4
    }
    if (/\b(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*=\s*[^;\n]+\s+as\s+(?:const|[A-Z][\w.<>]*)/mu.test(text)) {
        score += 3.2
    }
    return score
}

function jsonLike(text) {
    const trimmed = text.trim()
    if (!trimmed) return false
    return /^[[{]/u.test(trimmed) && /[\]}]$/u.test(trimmed)
}

function jsonParses(text) {
    try {
        JSON.parse(text.trim())
        return true
    } catch {
        return false
    }
}

/** @type {Record<string, (text: string) => number>} */
export const STRUCTURAL = {
    json: (text) => {
        if (!jsonLike(text)) return 0
        if (jsonParses(text)) return 3.5
        return /"\s*:/u.test(text) ? 1.6 : 0.2
    },
    jsonc: (text) => {
        if (!jsonLike(text)) return 0
        if (jsonParses(text)) return 0
        return /\/[/*]/u.test(text) && /"\s*:/u.test(text) ? 3.0 : 0
    },
    javascript: (text) => {
        if (hasJsxShape(text)) return 0
        let score = 0
        if (/^\s*(?:const|let|var)\s+[$A-Z_a-z][$\w]*\s*=/mu.test(text)) score += 1.4
        if (/^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+[$A-Z_a-z][$\w]*\s*\([^)\n]*\)\s*\{/mu.test(text)) {
            score += 2.2
        }
        if (/^\s*(?:console|globalThis|window|document)\.[A-Za-z_$][\w$]*\s*\(/mu.test(text)) {
            score += 1.2
        }
        return score
    },
    jsx: (text) => (hasJsxShape(text) ? 4.2 : 0),
    typescript: (text) => (hasJsxShape(text) ? 0 : typescriptStructure(text)),
    tsx: (text) => (hasJsxShape(text) && typescriptStructure(text) > 0 ? 4.8 : 0),
    markdown: (text) => {
        let score = 0
        // "# import cmath" is a Python comment, not a Markdown heading. Only
        // count headings when the block does not look like source code.
        const codeish = /^\s*(?:import|from|def|class|print|#include|const|let|var|function|package|using|public|private)\b/mu.test(
            text,
        )
        if (!codeish && /^#{1,6}\s+\S/mu.test(text)) score += 1.6
        if (/^\s*[-*+]\s\[[ xX]\]/mu.test(text)) score += 2.2
        if (/```/u.test(text)) score += 1.2
        if (hasCompleteFencedBlock(text)) score += 2.8
        const bold = /\*\*([^*\n]{1,80})\*\*/u.exec(text)
        if (bold && /[A-Za-z]{2}/u.test(bold[1]) && !/[()]/u.test(bold[1])) score += 0.8
        if (/^\s*\d+\.\s+\S/mu.test(text)) score += 0.5
        if (/\[[^\]]+\]\([^)]+\)/u.test(text)) score += 0.9
        return score
    },
    yaml: (text) => {
        const lines = text.split("\n").filter((line) => line.trim().length > 0)
        if (lines.length === 0) return 0
        // A time-of-day list ("10:30 standup") looks like a key/value map to a
        // naive test, so require a colon followed by space/end-of-line and a
        // plausible (non-numeric) key.
        let keys = 0
        const yamlish = lines.filter((line) => {
            const trimmed = line.trim()
            if (trimmed.startsWith("#")) return true
            if (/^-\s+/u.test(trimmed)) return true
            const match = /^([^:#\s][^:#]*?):(?:\s|$)/u.exec(trimmed)
            if (!match) return false
            const key = match[1].trim()
            if (/^[\d.\-+]+$/u.test(key)) return false
            // Markdown emphasis/links/headings look like `key: value` lines.
            if (/[*`#[\]()]/u.test(key)) return false
            keys += 1
            return true
        }).length
        if (keys < 1 || yamlish !== lines.length) return 0
        if (lines.length < 2) return 0
        // Require at least one YAML-ish feature: nesting, a list, a document
        // marker, a typed scalar value, or an identifier-like key. A list of
        // "TODO: do something" lines otherwise reads as a mapping.
        const hasStructure =
            /^\s{2,}\S/mu.test(text) ||
            /^---\s*$/mu.test(text) ||
            /^\s*[^\s:#][^:]*:\s*(?:[-+]?\d|true|false|null|~|["'[])/mu.test(text) ||
            /^[a-z][\w.-]*\s*:/mu.test(text)
        if (!hasStructure) return 0
        return 2.4
    },
    toml: (text) => {
        const lines = text.split("\n").filter((line) => line.trim().length > 0)
        if (lines.length < 2) return 0
        let sections = 0
        let assigns = 0
        let valueLike = 0
        for (const line of lines) {
            const trimmed = line.trim()
            if (/^#/u.test(trimmed)) continue
            if (/^\[\[?[A-Za-z0-9_.\-"']+\]\]?$/u.test(trimmed)) {
                sections += 1
                continue
            }
            const match = /^([A-Za-z0-9_.\-"']+)\s*=\s*(.+)$/u.exec(trimmed)
            if (!match) return 0
            assigns += 1
            const value = match[2].trim()
            // TOML values are typed literals, not free prose.
            if (/^(?:"[^"]*"|'[^']*'|true|false|[\d_.\-+eE]+|\[[^\]]*\]|\{[^}]*\})$/u.test(value)) {
                valueLike += 1
            } else if (/^\d/u.test(value)) {
                valueLike += 1
            }
        }
        if (assigns === 0 || valueLike < assigns) return 0
        if (sections === 0 && assigns < 2) return 0
        return 2.6 + (sections > 0 ? 0.4 : 0)
    },
    dockerfile: (text) => {
        const lines = text.split("\n").filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"))
        if (lines.length < 1) return 0
        const instructions =
            /^(?:FROM|RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|ENV|ARG|EXPOSE|USER|VOLUME|LABEL|SHELL|HEALTHCHECK|ONBUILD)\b/u
        const hits = lines.filter((line) => instructions.test(line.trim())).length
        if (hits < 2 && !/^\s*FROM\s+/iu.test(text)) return 0
        return Math.min(3.0, 1.0 + hits * 0.6)
    },
    diff: (text) => {
        if (/^diff --git /mu.test(text)) return 3.2
        if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/mu.test(text)) return 3.0
        return 0
    },
    css: (text) => {
        const hasBlock = /\{[^}]*:[^}]*\}/u.test(text)
        const hasSelector = /(^|\n)\s*[.#]?[\w-]+(?:\s*,\s*[.#]?[\w-]+)*\s*\{/u.test(text)
        return (hasBlock ? 1.4 : 0) + (hasSelector ? 1.1 : 0)
    },
    scss: (text) => {
        let score = 0
        if (/^\s*\$[\w-]+\s*:/mu.test(text)) score += 2.0
        if (/@(?:use|forward|mixin|include|extend|each|if)\b/u.test(text)) score += 1.2
        if (/&\s*[:.{]/u.test(text)) score += 0.9
        if (/\{[^}]*:[^}]*\}/u.test(text) && score > 0) score += 0.8
        return score
    },
    less: (text) => {
        let score = 0
        if (/^\s*@[\w-]+\s*:\s*[^;\n]+;/mu.test(text)) score += 2.0
        if (/\.mixin\(|&:extend\(/u.test(text)) score += 1.2
        if (/@\{[\w-]+\}/u.test(text)) score += 0.8
        if (/\{[^}]*:[^}]*\}/u.test(text) && score > 0) score += 0.8
        return score
    },
    vue: (text) => {
        const hasTemplate = /<template(?:\s[^>]*)?>/iu.test(text)
        const hasScriptSetup = /<script\b[^>]*\ssetup(?:\s|=|>)/iu.test(text)
        const hasOptionsScript = /<script\b[^>]*>\s*export\s+default\b/iu.test(text)
        const hasSfcStyle = /<style(?:\s[^>]*)?>/iu.test(text)
        return hasTemplate && (hasScriptSetup || hasOptionsScript || hasSfcStyle) ? 4.2 : 0
    },
    html: (text) => {
        const plain = withoutStringLiterals(text)
        const tags = plain.match(/<\/?[a-z][\w-]*[^>]*>/giu)
        if (!tags || tags.length === 0) return 0
        if (/<!doctype html/iu.test(plain)) return 3.2
        if (/<(?:template|script|style)\b/iu.test(plain)) return 0.8
        return Math.min(2.6, tags.length * 0.55)
    },
    xml: (text) => {
        if (/^\s*<\?xml\b/u.test(text)) return 3.2
        const tags = text.match(/<\/[a-z][\w.:-]*>/giu)
        if (!tags || tags.length < 2) return 0
        return Math.min(2.0, tags.length * 0.5)
    },
    rust: (text) => {
        let score = 0
        if (/^\s*(?:pub\s+)?fn\s+\w+\s*[(<]/mu.test(text)) score += 1.6
        if (/\blet\s+mut\b/u.test(text)) score += 1.2
        if (/^\s*(?:pub\s+)?impl\b/mu.test(text)) score += 1.0
        if (/^\s*use\s+[\w:]+;/mu.test(text)) score += 0.8
        if (/\b\w+!\s*\(/u.test(text)) score += 0.6
        return score
    },
    golang: (text) => {
        let score = 0
        if (/^\s*package\s+\w+\s*$/mu.test(text)) score += 2.4
        if (/^\s*func\s+\w*\s*\(/mu.test(text)) score += 1.4
        if (text.includes(":=")) score += 0.9
        if (/\bfmt\.\w+/u.test(text)) score += 0.8
        if (/^import\s*(?:\(|")/mu.test(text)) score += 0.6
        return score
    },
    java: (text) => {
        let score = 0
        if (/\bpublic\s+(?:final\s+)?class\b/u.test(text)) score += 1.8
        if (/public\s+static\s+void\s+main\b/u.test(text)) score += 1.6
        if (/^\s*import\s+java\./mu.test(text)) score += 1.4
        if (/\bSystem\.out\.print/u.test(text)) score += 1.0
        return score
    },
    cpp: (text) => {
        let score = 0
        if (/^\s*#\s*include\s*[<"]/mu.test(text)) score += 1.6
        if (/\bstd::/u.test(text)) score += 1.2
        if (/\b(?:using\s+namespace|template\s*<)/u.test(text)) score += 1.0
        if (/\bnullptr\b/u.test(text)) score += 0.6
        return score
    },
    c: (text) => {
        let score = 0
        if (/^\s*#\s*include\s*<(?:stdio|stdlib|string|math|stdint|stdbool)\.h>/mu.test(text)) score += 2.0
        if (/\bint\s+main\s*\(\s*(?:void|int\s+argc)/u.test(text)) score += 1.2
        if (/\b(?:printf|scanf|malloc|free|strlen)\s*\(/u.test(text)) score += 1.0
        return score
    },
    csharp: (text) => {
        let score = 0
        if (/\bConsole\.Write/u.test(text)) score += 1.8
        if (/\bnamespace\s+[\w.]+/u.test(text)) score += 1.2
        if (/\b(?:string\[\]|List<|Dictionary<)/u.test(text)) score += 0.8
        return score
    },
    objectivec: (text) => {
        let score = 0
        if (/^\s*@(?:interface|implementation|protocol)\b/mu.test(text)) score += 2.6
        if (/^\s*#import\s*[<"]/mu.test(text)) score += 1.2
        if (/\b(?:NSString|NSArray|NSDictionary|NSObject)\b/u.test(text)) score += 0.9
        if (/\[\s*\w+\s+\w+\s*\]/u.test(text)) score += 0.8
        return score
    },
    protobuf: (text) => {
        let score = 0
        if (/^\s*syntax\s*=\s*["']proto[23]["']/mu.test(text)) score += 2.6
        if (/^\s*message\s+\w+\s*\{/mu.test(text)) score += 2.0
        if (/^\s*(?:repeated|optional|required)\s+\w+/mu.test(text)) score += 1.0
        if (/^\s*\w+\s+\w+\s*=\s*\d+\s*;/mu.test(text)) score += 1.2
        if (/^\s*(?:service|rpc)\s+\w+/mu.test(text)) score += 1.0
        return score
    },
    python: (text) => {
        let score = 0
        if (/^\s*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*(?:->[^:]+)?:\s*$/mu.test(text)) score += 1.8
        if (/^\s*print\s*\(\s*(?:"[^"\n]*"|'[^'\n]*'|[-+]?\d+(?:\.\d+)?)\s*\)\s*;?\s*$/mu.test(text)) {
            score += 2.2
        }
        if (/^\s*(?:from\s+[\w.]+\s+)?import\s+[\w.]+/mu.test(text)) score += 1.2
        if (/^\s*print\s*\(/mu.test(text)) score += 0.9
        if (/^if\s+__name__\s*==\s*['"]__main__['"]\s*:/mu.test(text)) score += 1.6
        if (/^\s*(?:elif|else)\s*:\s*$/mu.test(text)) score += 0.7
        if (/^\s+\w[\w.]*\s*=\s*[^=\n]+$/mu.test(text) && /^\s{4}/mu.test(text)) score += 0.4
        return score
    },
    php: (text) => {
        let score = 0
        if (/^\s*<\?php\b/imu.test(text)) score += 3.0
        if (/\$\w+\s*=/u.test(text)) score += 0.8
        if (/\$this->/u.test(text)) score += 1.0
        return score
    },
    ruby: (text) => {
        let score = 0
        // "def foo(a):" is Python; Ruby's def line never ends with a colon.
        if (/^\s*def\s+\w+[?!]?\s*\([^)]*\)\s*$/mu.test(text)) score += 1.2
        if (/\bputs\b/u.test(text)) score += 0.6
        if (/\.each\s+do\b/u.test(text)) score += 1.2
        if (/\battr_(?:accessor|reader|writer)\b/u.test(text)) score += 1.0
        return score
    },
    kotlin: (text) => {
        let score = 0
        if (/^\s*fun\s+\w+/mu.test(text)) score += 1.4
        if (/\bdata\s+class\b/u.test(text)) score += 1.2
        if (/\bval\s+\w+\s*[:=]/u.test(text)) score += 0.8
        if (/\bwhen\s*\(/u.test(text)) score += 0.8
        return score
    },
    swift: (text) => {
        let score = 0
        if (/^\s*import\s+(?:UIKit|SwiftUI|Foundation)/mu.test(text)) score += 2.2
        if (/\bguard\s+let\b/u.test(text)) score += 1.2
        if (/^\s*func\s+\w+/mu.test(text)) score += 0.8
        return score
    },
    graphql: (text) => {
        let score = 0
        // Prose such as "query the database and type your answer" starts exactly
        // like a GraphQL operation, so a bare keyword is not evidence.
        if (
            /^\s*(?:query|mutation|subscription)\b(?:[ \t]+[_A-Za-z]\w*)?(?:[ \t\r\n]*\([^()]*\))?[ \t\r\n]*\{/mu.test(
                text,
            )
        ) {
            score += 2.2
        }
        if (/^\s*fragment\s+[_A-Za-z]\w*\s+on\s+[_A-Za-z]\w*/mu.test(text)) score += 2.0
        if (/^\s*(?:type|interface|input)\s+[_A-Za-z]\w*\s*(?:implements\s+[^{}\n]+)?\s*\{/mu.test(text)) {
            const hasFieldDefinitions = /^\s*[_A-Za-z]\w*\s*(?:\([^()]*\))?\s*:\s*[[\]!_A-Za-z]/mu.test(text)
            score += hasFieldDefinitions ? 2.6 : 1.0
        }
        if (/^\s*enum\s+[_A-Za-z]\w*\s*\{/mu.test(text)) {
            const looksTypeScript = /^\s*[_A-Za-z]\w*\s*(?:=|,)/mu.test(text)
            if (!looksTypeScript) score += 1.8
        }
        if (/^\s*schema\s*\{/mu.test(text)) score += 1.6
        if (/^\s*union\s+[_A-Za-z]\w*\s*=/mu.test(text)) score += 1.4
        if (/^\s*scalar\s+[_A-Za-z]\w*\s*$/mu.test(text)) score += 1.2
        return score
    },
    sql: (text) => {
        if (
            /^\s*select\s+(?:distinct\s+)?[\w.*`"]+(?:\s*,\s*[\w.*`"]+)*\s+from\s+[\w."`]+\b/imu.test(text) ||
            /^\s*select\s+(?:distinct\s+)?(?:count|sum|avg|min|max)\s*\(\s*(?:\*|[\w."`]+)\s*\)(?:\s+as\s+\w+)?\s+from\s+[\w."`]+\b/imu.test(
                text,
            ) ||
            /^\s*(?:insert\s+into|update)\s+[\w."`]+(?:\s+set\b|\s*\()/imu.test(text) ||
            /^\s*delete\s+from\s+[\w."`]+\b/imu.test(text) ||
            /^\s*(?:create|alter|drop)\s+(?:table|view|index)\s+[\w."`]+\b/imu.test(text) ||
            /^\s*with\s+[\w."`]+\s+as\s*\(/imu.test(text)
        ) {
            return 2.2
        }
        return 0
    },
    powershell: (text) => {
        let score = 0
        if (/^\s*param\s*\(/mu.test(text)) score += 1.8
        if (/\bGet-[A-Z]\w+/u.test(text)) score += 1.4
        if (/\$env:/u.test(text)) score += 1.0
        if (/\bWrite-Host\b/u.test(text)) score += 1.0
        return score
    },
    shell: (text) => {
        let score = 0
        if (/^#!\//mu.test(text)) score += 2.6
        if (/^\s*if\s+\[/mu.test(text)) score += 1.0
        if (/^\s*fi\s*$/mu.test(text)) score += 0.8
        if (/\$\([^)]+\)/u.test(text)) score += 0.6
        if (/\|\s*grep\b/u.test(text)) score += 0.8
        return score
    },
    clojure: (text) => {
        let score = 0
        if (/^\s*\(ns\s+[\w.-]+/mu.test(text)) score += 2.4
        if (/^\s*\(defn-?\s/mu.test(text)) score += 2.0
        if (/\(:require\b|\(:import\b/u.test(text)) score += 1.0
        if (/\(let\s*\[/u.test(text)) score += 0.8
        return score
    },
    elixir: (text) => {
        let score = 0
        if (/^\s*defmodule\s+[\w.]+\s+do\b/mu.test(text)) score += 2.6
        if (/^\s*defp?\s+\w+.*\bdo\s*$/mu.test(text)) score += 1.8
        if (/\|>/u.test(text)) score += 1.2
        if (/\bIO\.(?:puts|inspect)\b/u.test(text)) score += 1.0
        return score
    },
    erlang: (text) => {
        let score = 0
        if (/^\s*-module\(\w+\)\s*\./mu.test(text)) score += 2.4
        if (/^\s*-export\(\[/mu.test(text)) score += 2.0
        if (/\bio:format\(/u.test(text)) score += 1.2
        if (/->.*\.\s*$/mu.test(text)) score += 0.6
        return score
    },
    dart: (text) => {
        let score = 0
        if (/^\s*import\s+['"]package:/mu.test(text)) score += 2.6
        if (/\bvoid\s+main\s*\(\s*\)/u.test(text)) score += 1.2
        if (/@override\b/u.test(text)) score += 1.0
        if (/\bfinal\s+\w+\s+\w+\s*=/u.test(text)) score += 0.6
        return score
    },
    scala: (text) => {
        let score = 0
        if (/\bobject\s+\w+\s+extends\b/u.test(text)) score += 2.0
        if (/\bcase\s+class\b/u.test(text)) score += 2.0
        if (/^\s*import\s+scala\./mu.test(text)) score += 1.8
        if (/\bdef\s+\w+\s*\([^)]*\)\s*:\s*[A-Z]\w*/u.test(text)) score += 1.0
        if (/\bval\s+\w+\s*:\s*[A-Z]\w*/u.test(text)) score += 0.8
        return score
    },
    groovy: (text) => {
        let score = 0
        if (/@Grab\b/u.test(text)) score += 2.6
        if (/\bdef\s+\w+\s*\(/u.test(text) && /\bprintln\b/u.test(text)) score += 1.4
        if (/\bit\.\w+/u.test(text)) score += 0.8
        return score
    },
    mermaid: (text) => {
        let score = 0
        if (/^\s*(?:graph|flowchart)\s+(?:TD|TB|BT|LR|RL)\b/mu.test(text)) score += 2.6
        if (/^\s*(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph)\b/mu.test(text)) {
            score += 2.4
        }
        if (/-->|---|==>|-\.->/u.test(text)) score += 0.6
        if (/^\s*(?:participant|subgraph|note|loop|alt|else|end)\b/mu.test(text)) score += 0.6
        return score
    },
    lezer: (text) => {
        let score = 0
        if (/^\s*@top\s+\w+/mu.test(text)) score += 2.6
        if (/^\s*@tokens\b/mu.test(text)) score += 1.6
        if (/^\s*@external\b/mu.test(text)) score += 1.2
        if (/^\s*\w+\s*\{\s*$/mu.test(text) && /\{\s*\}/u.test(text)) score += 0.6
        return score
    },
}
