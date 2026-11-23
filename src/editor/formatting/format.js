/**
 * The formatting pipeline.
 *
 * `formatText` is transport-agnostic: it takes a block body and returns a
 * result object. The editor layer decides what to do with the text; a future
 * worker / IPC implementation would wrap exactly this function.
 *
 * Order matters:
 *  1. capability (refuse early with a reason, do not load an engine),
 *  2. empty body (report it instead of pretending to format),
 *  3. backend (dynamically imported here),
 *  4. trailing-newline normalization,
 *  5. idempotence (no empty undo steps),
 *  6. failure classification (syntax vs internal, with a location).
 */
import { formatSupport } from "./capability.js"
import { loadBackend } from "./backends/registry.js"
import { FormatCode, FormatterError, classifyError } from "./errors.js"
import { clampCursorOffset, isAlreadyFormatted, normalizePrintedText } from "./text.js"

/**
 * @typedef {object} FormatResult
 * @property {boolean} ok
 * @property {string} text body to write back (the input on failure)
 * @property {boolean} changed
 * @property {string} code a FormatCode
 * @property {number|null} cursorOffset caret offset inside `text`, when known
 * @property {string|null} detail raw engine message, for tooltips only
 * @property {number|null} line 1-based line of a syntax error, relative to the block
 * @property {number|null} column 1-based column of a syntax error
 */

/**
 * @param {object} request
 * @param {string} request.token block language token
 * @param {string} request.text block body
 * @param {object} [request.options] FormatOptions
 * @param {number|null} [request.cursorOffset] caret offset inside the body
 * @param {AbortSignal} [request.signal]
 * @returns {Promise<FormatResult>}
 */
export async function formatText({ token, text, options = {}, cursorOffset = null, signal }) {
    const source = String(text ?? "")
    const support = formatSupport(token)
    if (!support.supported) {
        return failure(source, support.reason ?? FormatCode.NO_FORMATTER)
    }
    if (source.trim().length === 0) {
        return failure(source, FormatCode.EMPTY)
    }
    if (signal?.aborted) {
        return failure(source, FormatCode.CANCELLED)
    }

    try {
        const backend = await loadBackend(support.spec.kind)
        if (!backend) {
            return failure(source, FormatCode.BACKEND_UNAVAILABLE)
        }
        if (!backend.supports(support.spec)) {
            return failure(source, FormatCode.PLUGIN_UNAVAILABLE)
        }
        const output = await backend.run(support.spec, {
            token,
            text: source,
            options,
            cursorOffset,
            signal,
        })
        if (signal?.aborted) {
            return failure(source, FormatCode.CANCELLED)
        }
        const printed = typeof output === "string" ? output : output?.text
        if (typeof printed !== "string") {
            throw new FormatterError("The formatter returned no text.")
        }

        const formatted = normalizePrintedText(source, printed)
        if (isAlreadyFormatted(source, formatted)) {
            return success(source, false, FormatCode.NO_CHANGE, cursorOffset)
        }
        const reportedCursor = typeof output === "object" && output !== null ? output.cursorOffset : null
        return success(formatted, true, FormatCode.FORMATTED, reportedCursor ?? cursorOffset)
    } catch (error) {
        if (signal?.aborted) {
            return failure(source, FormatCode.CANCELLED)
        }
        const { isSyntax, message, line, column } = classifyError(error)
        return {
            ok: false,
            text: source,
            changed: false,
            code: isSyntax ? FormatCode.SYNTAX_ERROR : FormatCode.INTERNAL_ERROR,
            cursorOffset: null,
            detail: message || null,
            line,
            column,
        }
    }
}

/**
 * @param {string} text
 * @param {boolean} changed
 * @param {string} code
 * @param {number|null} cursorOffset
 * @returns {FormatResult}
 */
function success(text, changed, code, cursorOffset) {
    return {
        ok: true,
        text,
        changed,
        code,
        cursorOffset: clampCursorOffset(cursorOffset, text.length),
        detail: null,
        line: null,
        column: null,
    }
}

/**
 * @param {string} text
 * @param {string} code
 * @returns {FormatResult}
 */
function failure(text, code) {
    return {
        ok: false,
        text,
        changed: false,
        code,
        cursorOffset: null,
        detail: null,
        line: null,
        column: null,
    }
}
