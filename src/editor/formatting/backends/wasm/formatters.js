/**
 * wasm formatter implementations.
 *
 * The ids come from `catalog.js` (the declared truth), the code lives here.
 * Every engine is lazily loaded and compiled once per session; the `.wasm`
 * binary itself is resolved through a lazy `?url` import so this module stays
 * importable outside Vite (unit tests) and the asset is only touched when a
 * block of that language is formatted for the first time.
 */
import { FormatterError } from "../../errors.js"
import { clampIndent, clampPrintWidth } from "../../options.js"
import { formatSqlText } from "../../sql/sql-format.js"
import { readBinaryAsset } from "./assets.js"
import { WASM_FORMATTERS as WASM_FORMATTER_IDS, assertComplete } from "../catalog.js"

/* --------------------------------------------------------------- init --- */

/**
 * Build a cached initializer for one wasm formatter.
 *
 * @template T
 * @param {() => Promise<T & {default: (bytes: BufferSource) => Promise<unknown>}>} importer
 * @param {() => Promise<{default: string}>} urlLoader Vite `?url` asset import
 */
function wasmModule(importer, urlLoader) {
    let promise = null
    const load = async () => {
        const [module, asset] = await Promise.all([importer(), urlLoader()])
        await module.default(await readBinaryAsset(asset.default))
        return module
    }
    return {
        async get() {
            if (!promise) {
                promise = load().catch((error) => {
                    // A failed fetch/init must not poison the cache.
                    promise = null
                    throw error
                })
            }
            return await promise
        },
    }
}

const ruff = wasmModule(
    () => import("@wasm-fmt/ruff_fmt/web"),
    () => import("@wasm-fmt/ruff_fmt/wasm?url"),
)
const gofmt = wasmModule(
    () => import("@wasm-fmt/gofmt/web"),
    () => import("@wasm-fmt/gofmt/wasm?url"),
)
const sqlFmt = wasmModule(
    () => import("@wasm-fmt/sql_fmt/web"),
    () => import("@wasm-fmt/sql_fmt/wasm?url"),
)
const clangFormat = wasmModule(
    () => import("@wasm-fmt/clang-format/web"),
    () => import("@wasm-fmt/clang-format/wasm?url"),
)
const shfmt = wasmModule(
    () => import("@wasm-fmt/shfmt/web"),
    () => import("@wasm-fmt/shfmt/wasm?url"),
)

/* -------------------------------------------------------------- clang --- */

/** clang-format decides the language from the file name. */
const CLANG_FILENAMES = {
    c: "block.c",
    cpp: "block.cpp",
    csharp: "block.cs",
    objectivec: "block.m",
    protobuf: "block.proto",
}

/**
 * clang-format takes one style string, not an options object.
 * @param {object} options
 */
function clangStyle(options) {
    /** @type {Record<string, unknown>} */
    const style = { BasedOnStyle: "LLVM" }
    const indent = clampIndent(options.indent)
    if (indent !== null) {
        // TabWidth has to match IndentWidth: with UseTab, clang-format only
        // emits tabs for multiples of TabWidth and the file ends up mixing
        // spaces and tabs.
        style.IndentWidth = indent
        style.TabWidth = indent
    }
    if (typeof options.useTabs === "boolean") {
        style.UseTab = options.useTabs ? "ForIndentation" : "Never"
        if (indent === null && options.useTabs) style.TabWidth = 2
    }
    const columnLimit = clampPrintWidth(options.printWidth)
    if (columnLimit !== null) style.ColumnLimit = columnLimit
    return Object.keys(style).length === 1 ? "LLVM" : JSON.stringify(style)
}

/* ---------------------------------------------------------- dockerfmt --- */

async function formatWithDockerfmt(text, options) {
    const [module, asset] = await Promise.all([
        import("@reteps/dockerfmt"),
        import("@reteps/dockerfmt/format.wasm?url"),
    ])
    if (typeof module.formatDockerfileContents !== "function") {
        throw new FormatterError("dockerfmt does not expose formatDockerfileContents")
    }
    const indent = clampIndent(options.indent) ?? 2
    const formatOptions = { indent, trailingNewline: true, spaceRedirects: false }
    // dockerfmt's wasm_exec.js installs a `process` stub on globalThis. The
    // renderer is long-lived; leaving it behind makes other engines (the Java
    // parser in particular) believe they run under Node.
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process")
    try {
        const getWasm = async () => await readBinaryAsset(asset.default)
        // The browser build takes the wasm bytes as a third argument; the Node
        // build reads them itself and ignores it.
        return await module.formatDockerfileContents(text, formatOptions, getWasm)
    } finally {
        if (processDescriptor) {
            Object.defineProperty(globalThis, "process", processDescriptor)
        } else {
            Reflect.deleteProperty(globalThis, "process")
        }
    }
}

/* ----------------------------------------------------------- registry --- */

/** @typedef {(text:string, options:object, token:string) => Promise<string>} WasmFormatter */

/** @type {Record<string, WasmFormatter>} */
export const WASM_FORMATTERS = {
    async python(text) {
        const module = await ruff.get()
        return module.format(text)
    },
    async go(text) {
        const module = await gofmt.get()
        return module.format(text)
    },
    async sql(text, options) {
        const module = await sqlFmt.get()
        const indent = clampIndent(options.indent)
        /** @type {Record<string, unknown>} */
        const config = { dialect: "generic" }
        if (indent !== null) config.indent_width = indent
        if (options.useTabs === true) {
            config.indent_style = "tab"
        } else if (indent !== null || options.useTabs === false) {
            config.indent_style = "space"
        }
        return formatSqlText(
            text,
            { indent: indent ?? undefined, useTabs: options.useTabs },
            async (source) => module.format(source, config),
        )
    },
    async clang(text, options, token) {
        const module = await clangFormat.get()
        return module.format(text, CLANG_FILENAMES[token] ?? "block.c", clangStyle(options))
    },
    async sh(text, options) {
        const module = await shfmt.get()
        const indent = clampIndent(options.indent)
        /** @type {Record<string, number>} */
        const shfmtOptions = {}
        if (options.useTabs === true) shfmtOptions.indent = 0
        else if (indent !== null) shfmtOptions.indent = indent
        else if (options.useTabs === false) shfmtOptions.indent = 2
        return module.format(text, "block.sh", shfmtOptions)
    },
    async dockerfile(text, options) {
        return await formatWithDockerfmt(text, options)
    },
}

/** Formatter ids this build implements. */
export function knownWasmFormatters() {
    return Object.keys(WASM_FORMATTERS)
}

assertComplete("wasm", WASM_FORMATTER_IDS, WASM_FORMATTERS)
