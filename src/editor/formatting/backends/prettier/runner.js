/**
 * Prettier execution.
 *
 * Everything here is async and lazy: `prettier/standalone` is imported on the
 * first format call, and each plugin is imported (and cached) per parser, so a
 * JSON block never pays for the TypeScript or Java plugin.
 */
import { FormatterError } from "../../errors.js"
import { clampIndent, clampPrintWidth } from "../../options.js"
import { PARSER_PLANS } from "./parsers.js"

/** @type {Promise<{format:Function,formatWithCursor:Function}>|null} */
let prettierModule = null

/** @type {Map<string, Promise<unknown>>} */
const pluginCache = new Map()

/** Load Prettier standalone once. */
async function loadPrettier() {
    if (!prettierModule) {
        prettierModule = import("prettier/standalone").then((module) => module.default ?? module)
    }
    return prettierModule
}

/** Load a plugin once per cache key; third-party plugins hide the plugin on default. */
async function loadPlugin(cacheKey, loader, unwrapDefault) {
    const cached = pluginCache.get(cacheKey)
    if (cached) return cached
    const promise = loader().then((module) => (unwrapDefault ? unwrapPlugin(module) : module))
    pluginCache.set(cacheKey, promise)
    return promise
}

function unwrapPlugin(module) {
    return module && module.default ? module.default : module
}

/**
 * Build the Prettier option object for a block.
 *
 * Only options the user can influence are forwarded; everything else keeps
 * Prettier's defaults (double quotes, semicolons, 80 columns, trailing comma
 * "all", LF). `plugins` is always set by the caller.
 *
 * @param {string} parser
 * @param {object} options forward FormatOptions
 * @param {Record<string, unknown>} [defaults] plan-specific overrides
 */
export function prettierOptions(parser, options = {}, defaults = {}) {
    /** @type {Record<string, unknown>} */
    const resolved = { parser }
    const indent = clampIndent(options.indent)
    if (indent !== null) {
        resolved.tabWidth = indent
        resolved.useTabs = options.useTabs === true
    } else if (options.useTabs === true) {
        resolved.useTabs = true
    }
    const printWidth = clampPrintWidth(options.printWidth)
    if (printWidth !== null) resolved.printWidth = printWidth
    if (typeof options.semi === "boolean") resolved.semi = options.semi
    if (typeof options.singleQuote === "boolean") resolved.singleQuote = options.singleQuote
    if (options.trailingComma) resolved.trailingComma = options.trailingComma
    return { ...resolved, ...defaults }
}

/**
 * Format text with Prettier.
 *
 * `formatWithCursor` is used when the caret is inside the body so the caret can
 * be mapped into the formatted text. It has a known performance cliff when the
 * caret sits at the very start or end of the input (prettier/prettier#4801), so
 * those two cases go through the cheaper `format()` and reconstruct the caret.
 *
 * @param {string} parser
 * @param {{text:string, options?:object, cursorOffset?:number|null}} context
 * @returns {Promise<{text:string, cursorOffset:number|null}>}
 */
export async function formatWithPrettier(parser, { text, options = {}, cursorOffset = null }) {
    const plan = PARSER_PLANS[parser]
    if (!plan) {
        throw new FormatterError(`No Prettier parser plan for "${parser}".`)
    }
    const prettier = await loadPrettier()
    const plugins = await Promise.all(
        plan.plugins.map((loader, index) =>
            loadPlugin(`${parser}:${index}`, loader, plan.unwrapDefault === true),
        ),
    )
    const resolvedOptions = {
        ...prettierOptions(plan.parser, options, plan.defaults),
        plugins,
    }

    const hasCursor = Number.isFinite(cursorOffset) && cursorOffset >= 0
    const atEdge = !hasCursor || cursorOffset <= 0 || cursorOffset >= text.length
    if (atEdge) {
        const formatted = await prettier.format(text, resolvedOptions)
        return {
            text: formatted,
            cursorOffset: hasCursor ? (cursorOffset <= 0 ? 0 : formatted.length) : null,
        }
    }

    const result = await prettier.formatWithCursor(text, {
        ...resolvedOptions,
        cursorOffset,
    })
    return { text: result.formatted, cursorOffset: result.cursorOffset }
}
