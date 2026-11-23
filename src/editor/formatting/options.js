/**
 * Formatting options.
 *
 * Options are derived from the live editor configuration so that "indent 4"
 * means the same thing for every backend. A backend only sees a normalized
 * `{indent, useTabs, printWidth, semi, singleQuote, trailingComma}` object and
 * is responsible for clamping values it cannot represent (clang-format's
 * column limit, for instance). The clamping helpers below are shared so the
 * limits are documented in one place.
 */
import { EditorState } from "@codemirror/state"
import { indentUnit } from "@codemirror/language"

export const DEFAULT_INDENT = 4
export const DEFAULT_PRINT_WIDTH = 80
export const MIN_INDENT = 1
export const MAX_INDENT = 8
export const MIN_PRINT_WIDTH = 20
export const MAX_PRINT_WIDTH = 200

/**
 * Read formatting options from an editor state.
 *
 * The indentation width comes from the same `indentUnit` facet the editor uses
 * for auto-indent, so a 2-space buffer formats with 2-space indentation even if
 * the global setting is different.
 *
 * @param {EditorState} state
 * @param {object} [overrides] forwarded to the result (only defined keys)
 * @returns {{indent:number,useTabs:boolean,printWidth?:number,semi?:boolean,singleQuote?:boolean,trailingComma?:string}}
 */
export function formatOptionsFromState(state, overrides = {}) {
    const unit = state.facet(indentUnit)
    const tabSize = state.facet(EditorState.tabSize) || DEFAULT_INDENT
    const useTabs = unit === "\t"
    const indent = useTabs ? tabSize : unit ? unit.length : tabSize
    return compact({
        indent,
        useTabs,
        ...overrides,
    })
}

/** @param {number|undefined} value */
export function clampIndent(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    return Math.max(MIN_INDENT, Math.min(MAX_INDENT, Math.round(value)))
}

/** @param {number|undefined} value */
export function clampPrintWidth(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return null
    return Math.max(MIN_PRINT_WIDTH, Math.min(MAX_PRINT_WIDTH, Math.round(value)))
}

/**
 * Drop `undefined` values so backend option builders can use `in`/spread
 * without accidentally overriding their defaults with `undefined`.
 */
function compact(object) {
    const result = {}
    for (const [key, value] of Object.entries(object)) {
        if (value !== undefined) result[key] = value
    }
    return result
}
