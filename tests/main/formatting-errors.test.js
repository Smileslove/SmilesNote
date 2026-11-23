import { describe, expect, it } from "vitest"

import { FormatCode, classifyError, locationFromMessage } from "../../src/editor/formatting/errors.js"
import { failureMessage, unavailableMessage } from "../../src/editor/formatting/messages.js"

describe("classifyError", () => {
    it("recognizes a Prettier SyntaxError and keeps its location", () => {
        const error = new SyntaxError("Unexpected token (2:5)")
        error.loc = { start: { line: 2, column: 5 } }
        expect(classifyError(error)).toEqual({
            isSyntax: true,
            message: "Unexpected token (2:5)",
            line: 2,
            column: 5,
        })
    })

    it("recognizes a message-only parser failure", () => {
        const result = classifyError(new Error("Expression expected. (1:12)"))
        expect(result.isSyntax).toBe(true)
        expect(result.line).toBe(null)
    })

    it("treats a formatter crash as an internal error", () => {
        const result = classifyError(new Error("Cannot read properties of undefined (reading 'print')"))
        expect(result.isSyntax).toBe(false)
        expect(result.message).toContain("Cannot read properties")
    })

    it("ignores NaN locations (plugin-xml does this)", () => {
        const error = new SyntaxError("bad xml")
        error.loc = { start: { line: NaN, column: NaN } }
        expect(classifyError(error).line).toBe(null)
    })

    it("survives non-Error throws", () => {
        expect(classifyError("boom")).toMatchObject({ isSyntax: false, message: "boom" })
    })
})

describe("locationFromMessage", () => {
    it("reads file:line:column from wasm formatter messages", () => {
        expect(locationFromMessage("error: block.c:12:7: expected ';'")).toEqual({ line: 12, column: 7 })
    })

    it("does not mistake times or bare numbers for positions", () => {
        expect(locationFromMessage("built at 12:30:45")).toBe(null)
        expect(locationFromMessage("line 12:30")).toBe(null)
    })

    it("rejects impossible positions", () => {
        expect(locationFromMessage("block.c:0:3: nope")).toBe(null)
    })
})

describe("messages", () => {
    it("explains every unavailable reason", () => {
        expect(unavailableMessage({ reason: FormatCode.PLAIN_TEXT, languageName: "Plain Text" })).toMatch(/nothing/i)
        expect(unavailableMessage({ reason: FormatCode.COMPUTED, languageName: "Math" })).toMatch(/computed/i)
        expect(unavailableMessage({ reason: FormatCode.NO_FORMATTER, languageName: "Rust" })).toBe(
            "Rust has no bundled formatter.",
        )
        expect(
            unavailableMessage({ reason: FormatCode.PLUGIN_UNAVAILABLE, parser: "xml", languageName: "XML" }),
        ).toContain('"xml"')
        expect(unavailableMessage({ reason: FormatCode.BACKEND_UNAVAILABLE, languageName: "TOML" })).toMatch(
            /backend/i,
        )
        expect(unavailableMessage({ reason: null, languageName: "JSON" })).toBe(null)
    })

    it("includes the location for syntax errors", () => {
        expect(
            failureMessage(
                { code: FormatCode.SYNTAX_ERROR, detail: "Unexpected token.", line: 3, column: 4 },
                "JSON",
            ),
        ).toBe("Could not parse JSON at line 3, column 4. Unexpected token.")
    })

    it("keeps engine detail for internal errors", () => {
        expect(failureMessage({ code: FormatCode.INTERNAL_ERROR, detail: "boom" }, "YAML")).toBe(
            "The YAML formatter failed. boom",
        )
    })

    it("reports empty blocks and stale results", () => {
        expect(failureMessage({ code: FormatCode.EMPTY }, "JSON")).toMatch(/empty/i)
        expect(failureMessage({ code: FormatCode.STALE }, "JSON")).toMatch(/changed while/i)
    })
})
