/**
 * Unambiguous language signatures.
 *
 * A match is strong enough to settle the question on its own: nothing else
 * produces `<?php`, a protobuf `syntax =` line, a Mermaid diagram header or a
 * Lezer grammar annotation. Keep this list to shapes that really are unique —
 * everything ambiguous belongs in `structural.js` or `signals.js`.
 *
 * Language ids are the block tokens from `src/editor/languages.js`.
 */

/** @typedef {{language: string, test: RegExp}} Signature */

/** @type {readonly Signature[]} */
export const SIGNATURES = Object.freeze([
    { language: "python", test: /^#!.*\bpython[0-9.]*\b/mu },
    { language: "ruby", test: /^#!.*\bruby\b/mu },
    { language: "javascript", test: /^#!.*\bnode\b/mu },
    { language: "shell", test: /^#!\s*(?:\/usr\/bin\/env\s+)?(?:ba|z|k|da)?sh\b/imu },
    { language: "php", test: /^\s*<\?php\b/imu },
    { language: "xml", test: /^\s*<\?xml\b/u },
    { language: "html", test: /^\s*<!doctype\s+html/imu },
    { language: "diff", test: /^(?:diff --git |@@ -\d)/mu },
    { language: "dockerfile", test: /^\s*FROM\s+\S+(?:\s+AS\s+\S+)?\s*$/imu },
    { language: "dockerfile", test: /^\s*(?:RUN|CMD|COPY|ADD|ENTRYPOINT|WORKDIR|ENV|EXPOSE)\s+\S/mu },
    { language: "csharp", test: /\busing\s+System(?:\.\w+)*\s*;/u },
    { language: "golang", test: /^package\s+\w+\s*$/mu },
    { language: "scss", test: /^\s*\$[\w-]+\s*:/mu },
    { language: "less", test: /^\s*@[\w-]+\s*:\s*[^;\n]+;/mu },
    { language: "objectivec", test: /^\s*@(?:interface|implementation|protocol)\b/mu },
    { language: "protobuf", test: /^\s*syntax\s*=\s*["']proto[23]["']/mu },
    { language: "mermaid", test: /^\s*(?:graph|flowchart)\s+(?:TD|TB|BT|LR|RL)\b/mu },
    {
        language: "mermaid",
        test: /^\s*(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|quadrantChart|xychart-beta)\b/mu,
    },
    { language: "lezer", test: /^\s*@(?:top|tokens?|external|skip|precedence|detectDelim)\b/mu },
    { language: "elixir", test: /^\s*defmodule\s+[\w.]+\s+do\b/mu },
    { language: "erlang", test: /^\s*-module\(\w+\)\s*\.\s*$/mu },
    { language: "clojure", test: /^\s*\(ns\s+[\w.-]+/mu },
    { language: "dart", test: /^\s*import\s+['"]package:/mu },
])
