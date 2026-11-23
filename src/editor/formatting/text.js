/**
 * Text helpers for the formatting pipeline.
 *
 * The only thing that needs care here is the trailing newline. Prettier (and
 * every other engine) prints a final newline, but a block body does not own the
 * newline before the next delimiter: writing it back would push a blank line
 * into the block every time the user formats. The rule is therefore "preserve
 * what the block already had": a body without a trailing newline keeps none, a
 * body that ends with one keeps exactly the printed newline.
 */

/**
 * Normalize an engine's output for a block body.
 *
 * @param {string} input the original block body
 * @param {string} printed the engine's output
 * @returns {string}
 */
export function normalizePrintedText(input, printed) {
    const normalized = String(printed).replace(/\r\n?/gu, "\n")
    if (input.endsWith("\n") || input.endsWith("\r\n") || input.endsWith("\r")) {
        return normalized
    }
    return normalized.replace(/\n+$/u, "")
}

/**
 * True when two block bodies are equivalent, ignoring line endings and trailing
 * blank lines. Used to avoid dispatching a no-op (which would still create an
 * undo step).
 *
 * @param {string} input
 * @param {string} output
 * @returns {boolean}
 */
export function isAlreadyFormatted(input, output) {
    const strip = (value) =>
        String(value)
            .replace(/\r\n?/gu, "\n")
            .replace(/\n+$/u, "")
    return strip(input) === strip(output)
}

/**
 * Clamp a cursor offset into a new body. Used for backends that cannot report
 * where the cursor ended up.
 *
 * @param {number|null|undefined} offset
 * @param {number} length
 * @returns {number|null}
 */
export function clampCursorOffset(offset, length) {
    if (!Number.isFinite(offset)) return null
    return Math.max(0, Math.min(Math.trunc(offset), length))
}
