import { EditorState } from "@codemirror/state"
import { indentUnit } from "@codemirror/language"
import { describe, expect, it } from "vitest"

import {
    DEFAULT_PRINT_WIDTH,
    clampIndent,
    clampPrintWidth,
    formatOptionsFromState,
} from "../../src/editor/formatting/options.js"
import { clampCursorOffset, isAlreadyFormatted, normalizePrintedText } from "../../src/editor/formatting/text.js"

describe("normalizePrintedText", () => {
    it("drops the engine's trailing newline when the block had none", () => {
        expect(normalizePrintedText("a=1", "a = 1\n")).toBe("a = 1")
    })

    it("keeps a trailing newline when the block had one", () => {
        expect(normalizePrintedText("a=1\n", "a = 1\n")).toBe("a = 1\n")
    })

    it("collapses repeated trailing newlines only when the block had none", () => {
        expect(normalizePrintedText("a", "a\n\n\n")).toBe("a")
        expect(normalizePrintedText("a\n", "a\n\n\n")).toBe("a\n\n\n")
    })

    it("normalizes CRLF input from the engine", () => {
        expect(normalizePrintedText("a\r\n", "a\r\nb\r\n")).toBe("a\nb\n")
    })
})

describe("isAlreadyFormatted", () => {
    it("ignores line endings and trailing blank lines", () => {
        expect(isAlreadyFormatted("a\n", "a")).toBe(true)
        expect(isAlreadyFormatted("a\r\nb", "a\nb\n")).toBe(true)
    })

    it("detects a real change", () => {
        expect(isAlreadyFormatted("{'a':1}", '{\n  "a": 1\n}')).toBe(false)
    })
})

describe("clampCursorOffset", () => {
    it("clamps into the new body", () => {
        expect(clampCursorOffset(10, 4)).toBe(4)
        expect(clampCursorOffset(-3, 4)).toBe(0)
        expect(clampCursorOffset(2, 4)).toBe(2)
    })

    it("returns null when the backend reported no offset", () => {
        expect(clampCursorOffset(null, 4)).toBe(null)
        expect(clampCursorOffset(undefined, 4)).toBe(null)
    })
})

describe("options", () => {
    it("reads spaces from indentUnit", () => {
        const state = EditorState.create({ doc: "", extensions: [indentUnit.of("  ")] })
        expect(formatOptionsFromState(state)).toEqual({ indent: 2, useTabs: false })
    })

    it("reads tabs from indentUnit and uses the tab size as width", () => {
        const state = EditorState.create({ doc: "", extensions: [indentUnit.of("\t"), EditorState.tabSize.of(8)] })
        expect(formatOptionsFromState(state)).toEqual({ indent: 8, useTabs: true })
    })

    it("forwards only defined overrides", () => {
        const state = EditorState.create({ doc: "", extensions: [indentUnit.of("    ")] })
        expect(formatOptionsFromState(state, { printWidth: 100, semi: undefined })).toEqual({
            indent: 4,
            useTabs: false,
            printWidth: 100,
        })
    })

    it("clamps indent and print width", () => {
        expect(clampIndent(0)).toBe(1)
        expect(clampIndent(99)).toBe(8)
        expect(clampIndent(2.6)).toBe(3)
        expect(clampIndent(NaN)).toBe(null)
        expect(clampPrintWidth(1)).toBe(20)
        expect(clampPrintWidth(10000)).toBe(200)
        expect(clampPrintWidth(undefined)).toBe(null)
        expect(DEFAULT_PRINT_WIDTH).toBe(80)
    })
})
