/**
 * User-facing sentences for formatting refusals and failures.
 *
 * Kept separate from capability.js (which answers "can this block be
 * formatted?") so the answers stay pure data and the wording lives in one
 * place. Only the English UI exists today; a translation layer would replace
 * this module without touching capability or the backends.
 */
import { FormatCode } from "./errors.js"

/**
 * Sentence explaining why a block cannot be formatted.
 *
 * @param {{reason:string|null, parser?:string|null, languageName:string}} support
 * @returns {string|null} null when the block is formattable
 */
export function unavailableMessage({ reason, parser, languageName }) {
    switch (reason) {
        case null:
            return null
        case FormatCode.PLAIN_TEXT:
            return "Plain text blocks have nothing to format."
        case FormatCode.COMPUTED:
            return "Math blocks show computed results, not source that can be formatted."
        case FormatCode.PLUGIN_UNAVAILABLE:
            return `The "${parser ?? "unknown"}" formatter is not bundled in this build.`
        case FormatCode.BACKEND_UNAVAILABLE:
            return `${languageName} uses a formatter backend that is not registered in this build.`
        case FormatCode.NO_FORMATTER:
        default:
            return `${languageName} has no bundled formatter.`
    }
}

/**
 * Sentence for a failed or skipped format pass.
 *
 * @param {{code:string,detail?:string|null,line?:number|null,column?:number|null}} result
 * @param {string} languageName
 * @returns {string}
 */
export function failureMessage(result, languageName) {
    const where = result.line
        ? ` at line ${result.line}${result.column ? `, column ${result.column}` : ""}`
        : ""
    switch (result.code) {
        case FormatCode.EMPTY:
            return "Nothing to format: this block is empty."
        case FormatCode.SYNTAX_ERROR:
            return `Could not parse ${languageName}${where}. ${result.detail ?? ""}`.trim()
        case FormatCode.INTERNAL_ERROR:
            return `The ${languageName} formatter failed. ${result.detail ?? ""}`.trim()
        case FormatCode.PLUGIN_UNAVAILABLE:
            return `The formatter for ${languageName} is not bundled in this build.`
        case FormatCode.BACKEND_UNAVAILABLE:
            return `The formatter backend for ${languageName} is not registered in this build.`
        case FormatCode.STALE:
            return "The block changed while it was being formatted; nothing was applied."
        case FormatCode.NO_FORMATTER:
            return `${languageName} has no bundled formatter.`
        default:
            return `Could not format ${languageName}.`
    }
}
