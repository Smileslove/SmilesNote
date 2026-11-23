/**
 * Failure codes and engine-error classification.
 *
 * Backends throw whatever their engine throws. This module is the single place
 * that decides whether a failure is the user's syntax error or the formatter
 * breaking, and where it tries to recover a line/column. The UI only ever sees
 * a stable code plus optional location; the raw engine prose is kept in
 * `detail` for a tooltip.
 */

/** Stable failure codes. @readonly */
export const FormatCode = Object.freeze({
    /** nothing to format */
    EMPTY: "empty",
    PLAIN_TEXT: "plain-text",
    COMPUTED: "computed",
    NO_FORMATTER: "no-formatter",
    /** a parser/backend is declared but missing from this build */
    PLUGIN_UNAVAILABLE: "plugin-unavailable",
    BACKEND_UNAVAILABLE: "backend-unavailable",
    /** the engine could not parse the block */
    SYNTAX_ERROR: "syntax-error",
    /** the engine crashed for another reason */
    INTERNAL_ERROR: "internal-error",
    /** formatting succeeded but the block changed before the result was applied */
    STALE: "stale",
    /** the request was abandoned (superseded or cancelled) */
    CANCELLED: "cancelled",
    /** formatting succeeded and changed the block */
    FORMATTED: "formatted",
    /** formatting succeeded and changed nothing */
    NO_CHANGE: "no-change",
})

/**
 * Error thrown by a backend for a condition it can describe precisely.
 * Anything else is classified from its message.
 */
export class FormatterError extends Error {
    /**
     * @param {string} message
     * @param {{cause?:unknown}} [options]
     */
    constructor(message, options = {}) {
        super(message, options)
        this.name = "FormatterError"
    }
}

const SYNTAX_PATTERN =
    /syntax|unexpected (?:token|character|end)|expect(?:ed|ing)\b|unterminated|parse error|failed to parse|must be followed|invalid (?:token|character|syntax)|unclosed/iu

/**
 * Split an engine failure into "the block is not valid" and "the formatter is
 * broken", and recover a location when the engine reports one.
 *
 * Prettier puts `loc.start` on its SyntaxError. The wasm formatters print
 * `file.ext:line:column:` in the message instead, which is why the fallback
 * pattern insists on a file extension (so `12:30:45` in prose is not mistaken
 * for a position).
 *
 * @param {unknown} error
 * @returns {{isSyntax:boolean,message:string,line:number|null,column:number|null}}
 */
export function classifyError(error) {
    const engineError = /** @type {{name?:string,message?:string,loc?:{start?:{line?:number,column?:number}}|null}} */ (
        error ?? {}
    )
    const rawMessage = engineError.message ?? String(error ?? "")
    const message = rawMessage.replace(/\s+/gu, " ").trim()
    const name = String(engineError.name ?? "")

    const isSyntax =
        error instanceof SyntaxError ||
        SYNTAX_PATTERN.test(name) ||
        SYNTAX_PATTERN.test(message)

    let line = locationNumber(engineError?.loc?.start?.line)
    let column = locationNumber(engineError?.loc?.start?.column)
    if (line === null) {
        const fromMessage = locationFromMessage(message)
        line = fromMessage?.line ?? null
        column = fromMessage?.column ?? null
    }

    return { isSyntax, message, line, column }
}

/**
 * Extract `file.ext:line:column` from an engine message.
 * @param {string} message
 * @returns {{line:number,column:number}|null}
 */
export function locationFromMessage(message) {
    const match = /(?:^|\s)[A-Za-z0-9_.-]+\.[A-Za-z0-9]+:(\d+):(\d+):/u.exec(String(message ?? ""))
    if (!match) return null
    const line = Number(match[1])
    const column = Number(match[2])
    if (!Number.isSafeInteger(line) || line < 1) return null
    if (!Number.isSafeInteger(column) || column < 0) return null
    return { line, column }
}

/** Prettier sometimes reports `NaN` positions (e.g. plugin-xml). */
function locationNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}
