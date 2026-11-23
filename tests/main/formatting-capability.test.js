import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { LANGUAGES } from "../../src/editor/languages.js"
import {
    formatSupport,
    formatterSpecOf,
    formattingUnavailableReason,
    languageName,
    supportsFormatting,
} from "../../src/editor/formatting/capability.js"
import { FormatCode } from "../../src/editor/formatting/errors.js"
import {
    BACKEND_KINDS,
    DPRINT_PLUGINS,
    PRETTIER_PARSERS,
    WASM_FORMATTERS,
    specSupport,
    specTarget,
} from "../../src/editor/formatting/backends/catalog.js"
import { BACKEND_LOADERS } from "../../src/editor/formatting/backends/registry.js"
import { knownPrettierParsers } from "../../src/editor/formatting/backends/prettier/parsers.js"
import { knownWasmFormatters } from "../../src/editor/formatting/backends/wasm/formatters.js"
import { knownDprintPlugins } from "../../src/editor/formatting/backends/dprint/plugins.js"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const grammarPath = path.join(rootDir, "src/editor/lang-heynote/heynote.grammar")

const FORMATTABLE = LANGUAGES.filter((language) => language.formatter)

describe("formatter catalog and implementations", () => {
    it("implements every declared Prettier parser", () => {
        expect([...knownPrettierParsers()].sort()).toEqual([...PRETTIER_PARSERS].sort())
    })

    it("implements every declared wasm formatter", () => {
        expect([...knownWasmFormatters()].sort()).toEqual([...WASM_FORMATTERS].sort())
    })

    it("implements every declared dprint plugin", () => {
        expect([...knownDprintPlugins()].sort()).toEqual([...DPRINT_PLUGINS].sort())
    })

    it("registers a lazy loader for every backend kind", () => {
        expect(Object.keys(BACKEND_LOADERS).sort()).toEqual([...BACKEND_KINDS].sort())
    })

    it("only references ids that exist in the catalog", () => {
        for (const language of FORMATTABLE) {
            expect(specSupport(language.formatter), `${language.token} → ${specTarget(language.formatter)}`).toBe(true)
        }
    })

    it("declares a formatter for at least the migrated language set", () => {
        // A regression guard for the migration: 27 block languages format.
        expect(FORMATTABLE.length).toBe(27)
    })
})

describe("capability", () => {
    it("reports every declared formatter as supported", () => {
        for (const language of FORMATTABLE) {
            expect(supportsFormatting(language.token), language.token).toBe(true)
            expect(formatSupport(language.token).reason).toBe(null)
        }
    })

    it("reports an undisputed token as unsupported", () => {
        const support = formatSupport("not-a-language")
        expect(support.supported).toBe(false)
        expect(support.reason).toBe(FormatCode.NO_FORMATTER)
        expect(support.spec).toBe(null)
    })

    it("distinguishes plain text and math wording", () => {
        expect(formatSupport("text").reason).toBe(FormatCode.PLAIN_TEXT)
        expect(formatSupport("math").reason).toBe(FormatCode.COMPUTED)
        expect(formattingUnavailableReason("text")).toMatch(/nothing to format/i)
        expect(formattingUnavailableReason("math")).toMatch(/computed/i)
    })

    it("explains a language without a formatter by name", () => {
        expect(formatSupport("rust").reason).toBe(FormatCode.NO_FORMATTER)
        expect(formattingUnavailableReason("rust")).toBe("Rust has no bundled formatter.")
        expect(languageName("rust")).toBe("Rust")
    })

    it("exposes the declared spec", () => {
        expect(formatterSpecOf("json")).toEqual({ kind: "prettier", parser: "json-stringify" })
        expect(formatterSpecOf("jsonc")).toEqual({ kind: "prettier", parser: "json" })
        expect(formatterSpecOf("toml")).toEqual({ kind: "dprint", plugin: "toml" })
        expect(formatterSpecOf("python")).toEqual({ kind: "wasm", formatter: "python" })
        expect(formatterSpecOf("text")).toBe(null)
    })
})

describe("language table", () => {
    it("has unique lowercase tokens", () => {
        const tokens = LANGUAGES.map((language) => language.token)
        expect(new Set(tokens).size).toBe(tokens.length)
        for (const token of tokens) {
            expect(token).toMatch(/^[a-z]+$/)
        }
    })

    it("registers every token in the Lezer grammar", () => {
        const grammar = fs.readFileSync(grammarPath, "utf8")
        const languageBlock = grammar.slice(grammar.indexOf("NoteLanguage"), grammar.indexOf("Auto {"))
        for (const language of LANGUAGES) {
            expect(languageBlock, language.token).toContain(`"${language.token}"`)
        }
    })

    it("keeps the formatter spec free of runtime values", () => {
        // Specs are written to disk and read by the Node-side Vite config; a
        // function or module reference here would break both.
        for (const language of FORMATTABLE) {
            for (const value of Object.values(language.formatter)) {
                expect(["string", "number", "boolean"]).toContain(typeof value)
            }
        }
    })
})
