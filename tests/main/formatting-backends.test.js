import { describe, expect, it } from "vitest"

import { LANGUAGES } from "../../src/editor/languages.js"
import { FormatCode } from "../../src/editor/formatting/errors.js"
import { formatText } from "../../src/editor/formatting/format.js"

/**
 * Real formatting through the pipeline for every Prettier-backed language.
 *
 * The wasm and dprint backends resolve their binaries through Vite `?url`
 * assets and are exercised by the browser/Electron tests instead.
 */
const SAMPLES = [
    {
        token: "json",
        input: '{"a":1,"b":[1,2]}',
        // json-stringify prints like JSON.stringify: every nested value on its own line.
        expected: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
    },
    // The lenient JSONC parser keeps comments and the author's line wrapping.
    { token: "jsonc", input: '{"a":1, /* note */ "b":2,}', expected: '{ "a": 1, /* note */ "b": 2 }' },
    { token: "javascript", input: "const a={b:1}", expected: "const a = { b: 1 };" },
    { token: "jsx", input: 'const a=<div className="x">hi</div>', includes: "<div className=\"x\">" },
    { token: "typescript", input: "interface A{m():void}", includes: "interface A {" },
    { token: "tsx", input: "const a=<div>{1}</div>", includes: "const a =" },
    { token: "html", input: "<div><script>const a=1</script></div>", includes: "const a = 1;" },
    { token: "css", input: "a{color:red}", expected: "a {\n  color: red;\n}" },
    { token: "scss", input: "$c:red;a{color:$c}", includes: "$c: red;" },
    { token: "less", input: "@c:red;a{color:@c}", includes: "@c: red;" },
    {
        token: "vue",
        input: '<template><div>{{x}}</div></template><script setup lang="ts">const x:{a:number}={a:1}</script>',
        includes: "const x: { a: number } = { a: 1 };",
    },
    { token: "markdown", input: "# hi\n* a", expected: "# hi\n\n- a" },
    { token: "yaml", input: "a:   1\nb: [1,2]", expected: "a: 1\nb: [1, 2]" },
    { token: "graphql", input: "query Q{user{id}}", includes: "query Q {" },
    { token: "xml", input: "<root><a>1</a></root>", includes: "<root>\n  <a>1</a>\n</root>" },
    { token: "java", input: "class A{void f(){}}", includes: "class A {" },
]

describe("Prettier backend through the pipeline", () => {
    it.each(SAMPLES)("formats $token", async ({ token, input, expected, includes }) => {
        const result = await formatText({ token, text: input, options: { indent: 2, useTabs: false } })
        expect(result.ok, result.detail ?? "").toBe(true)
        expect(result.changed).toBe(true)
        if (expected !== undefined) {
            expect(result.text).toBe(expected)
        } else {
            expect(result.text).toContain(includes)
        }
    })

    it.each(SAMPLES)("is idempotent for $token", async ({ token, input }) => {
        const first = await formatText({ token, text: input, options: { indent: 2 } })
        const second = await formatText({ token, text: first.text, options: { indent: 2 } })
        expect(second.ok).toBe(true)
        expect(second.text).toBe(first.text)
        expect(second.changed).toBe(false)
    })

    it("reports a syntax error with a reason instead of throwing", async () => {
        // Strict JSON rejects comments; JSONC is the block for that.
        const commented = await formatText({ token: "json", text: '{"a":1 /* comment */}' })
        const broken = await formatText({ token: "json", text: '{"a":}' })
        expect(commented.ok).toBe(false)
        expect(commented.code).toBe(FormatCode.SYNTAX_ERROR)
        expect(broken.ok).toBe(false)
        expect(broken.code).toBe(FormatCode.SYNTAX_ERROR)
        expect(broken.detail).toBeTruthy()
    })

    it("does not format a block without a formatter", async () => {
        const result = await formatText({ token: "rust", text: "fn main(){}" })
        expect(result.ok).toBe(false)
        expect(result.code).toBe(FormatCode.NO_FORMATTER)
        expect(result.text).toBe("fn main(){}")
    })

    it("reports an empty block", async () => {
        const result = await formatText({ token: "json", text: "   \n" })
        expect(result.ok).toBe(false)
        expect(result.code).toBe(FormatCode.EMPTY)
    })

    it("honours the indent option", async () => {
        const four = await formatText({
            token: "javascript",
            text: "function f(){return {a:1}}",
            options: { indent: 4 },
        })
        expect(four.text).toContain("\n    return")
    })

    it("honours useTabs", async () => {
        const tabs = await formatText({
            token: "javascript",
            text: "function f(){return {a:1}}",
            options: { indent: 4, useTabs: true },
        })
        expect(tabs.text).toContain("\n\treturn")
    })

    it("keeps the cursor inside the formatted text", async () => {
        const input = "const a={b:1,c:2}"
        const cursorOffset = input.indexOf("b")
        const result = await formatText({ token: "javascript", text: input, cursorOffset })
        expect(result.ok).toBe(true)
        expect(result.cursorOffset).toBeGreaterThanOrEqual(0)
        expect(result.cursorOffset).toBeLessThanOrEqual(result.text.length)
        expect(result.text.slice(result.cursorOffset - 1, result.cursorOffset + 1)).toContain("b")
    })

    it("covers every language marked with a Prettier formatter", () => {
        const prettierTokens = LANGUAGES.filter((language) => language.formatter?.kind === "prettier").map(
            (language) => language.token,
        )
        const covered = new Set(SAMPLES.map((sample) => sample.token))
        const missing = prettierTokens.filter((token) => !covered.has(token))
        expect(missing).toEqual([])
    })
})
