/**
 * Editor integration for block formatting.
 *
 * This module owns the CodeMirror side:
 *  - locate the active block and snapshot its body;
 *  - run the (async) pipeline;
 *  - REVALIDATE before writing anything back, because the document may have
 *    changed while the formatter ran;
 *  - dispatch one transaction that replaces only the block body, so formatting
 *    is a single undo step and block delimiters/metadata are untouched.
 *
 * It is the only formatting module that imports CodeMirror. The pipeline
 * (`format.js`), capability and backends stay editor-agnostic and testable.
 */
import { EditorSelection } from "@codemirror/state"

import { blockState, getActiveNoteBlock } from "../block/block.js"
import { formattingUnavailableReason, languageName, supportsFormatting } from "./capability.js"
import { FormatCode } from "./errors.js"
import { formatText } from "./format.js"
import { failureMessage } from "./messages.js"
import { formatOptionsFromState } from "./options.js"

/** Public API used by the editor command and the status bar. */
export { formattingUnavailableReason, languageName, supportsFormatting }

/**
 * @typedef {object} FormatOutcome
 * @property {boolean} changed
 * @property {string} code a FormatCode
 * @property {string|null} message sentence to show the user, null when silent
 * @property {string|null} detail raw engine message (tooltip material)
 * @property {number|null} line
 * @property {number|null} column
 */

/**
 * Format the block that contains the cursor.
 *
 * Accepts a CodeMirror `EditorView` (the command layer always passes one), so
 * the state can be re-read after the async pass.
 *
 * @param {{state:import("@codemirror/state").EditorState, dispatch:Function}} view
 * @returns {Promise<FormatOutcome|null>} null when there is nothing to do
 *   (read-only editor, or no block under the cursor)
 */
export async function formatBlockContent(view) {
    const state = view?.state
    if (!state || state.readOnly) {
        return null
    }
    const blocks = state.field(blockState, false) ?? []
    const block = getActiveNoteBlock(state)
    if (!block) {
        return null
    }

    const blockIndex = blocks.indexOf(block)
    const token = block.language.name
    const source = state.sliceDoc(block.content.from, block.content.to)
    const options = formatOptionsFromState(state)
    const cursorOffset = state.selection.asSingle().ranges[0].head - block.content.from

    const result = await formatText({ token, text: source, options, cursorOffset })

    if (!result.ok) {
        return {
            changed: false,
            code: result.code,
            message: failureMessage(result, languageName(token)),
            detail: result.detail,
            line: result.line,
            column: result.column,
        }
    }
    if (!result.changed) {
        return { changed: false, code: result.code, message: null, detail: null, line: null, column: null }
    }

    // The document may have been edited while Prettier/wasm was working. The
    // block at the same index must still hold exactly the text we formatted;
    // otherwise the result describes a document that no longer exists.
    const latest = view.state
    const latestBlocks = latest.field(blockState, false) ?? []
    const target = latestBlocks[blockIndex]
    if (
        !target ||
        target.language.name !== token ||
        latest.sliceDoc(target.content.from, target.content.to) !== source
    ) {
        return {
            changed: false,
            code: FormatCode.STALE,
            message: failureMessage({ code: FormatCode.STALE }, languageName(token)),
            detail: null,
            line: null,
            column: null,
        }
    }

    const from = target.content.from
    view.dispatch({
        changes: { from, to: target.content.to, insert: result.text },
        selection: mappedSelection(latest, from, target.content.to, result.text.length),
        userEvent: "input.format",
        scrollIntoView: true,
    })
    return { changed: true, code: FormatCode.FORMATTED, message: null, detail: null, line: null, column: null }
}

/**
 * Keep the caret inside the new body. When a selection is not fully inside the
 * formatted range (multi-cursor, selection across blocks), leave the mapping to
 * CodeMirror.
 *
 * @param {import("@codemirror/state").EditorState} state
 * @param {number} from
 * @param {number} to
 * @param {number} length
 * @returns {import("@codemirror/state").SelectionRange|undefined}
 */
function mappedSelection(state, from, to, length) {
    const ranges = state.selection.ranges
    if (ranges.length !== 1) return undefined
    const { anchor, head } = ranges[0]
    const shift = (pos) => (pos >= from && pos <= to ? from + Math.min(pos - from, length) : null)
    const anchorPos = shift(anchor)
    const headPos = shift(head)
    if (anchorPos === null || headPos === null) return undefined
    return EditorSelection.single(anchorPos, headPos)
}
