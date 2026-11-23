/**
 * Format-block command entry point.
 *
 * The implementation lives in `src/editor/formatting/`; this module only keeps
 * the historical export name used by the command palette and key bindings, and
 * adds the one thing the formatting pipeline must not do itself: turning an
 * outcome into a status-bar message (the pipeline stays store-free so it can be
 * reused from a worker later).
 */
import { useHeynoteStore } from "../../stores/heynote-store.js"
import { formatBlockContent } from "../formatting/index.js"

export { formatBlockContent }

/**
 * Format the active block and report a failure/refusal in the status bar.
 *
 * A successful pass is silent; a failure, a refusal or a stale result leaves a
 * transient message so the user never wonders why "nothing happened".
 *
 * @param {{state:import("@codemirror/state").EditorState, dispatch:Function}} view
 */
export async function formatBlockCommand(view) {
    const outcome = await formatBlockContent(view)
    if (outcome?.message) {
        useHeynoteStore().setStatusMessage(outcome.message, {
            kind: outcome.code === "syntax-error" || outcome.code === "internal-error" ? "error" : "warn",
        })
    }
    return outcome
}
