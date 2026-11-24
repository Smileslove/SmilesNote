/**
 * Language detection worker.
 *
 * The main thread sends one batch of candidate blocks; the worker answers with
 * one detection per block. Detection is pure and fast, so the worker exists to
 * keep large notes (many blocks, long bodies) off the UI thread, not because a
 * single block is expensive.
 *
 * The protocol carries `path` and `sequence` so a late answer can never be
 * applied to a buffer or document version it was not computed for.
 */
import { detectBlocks } from "./detect-blocks.js"

const scope = globalThis

if (typeof scope.postMessage === "function" && typeof scope.document === "undefined") {
    scope.onmessage = (event) => {
        const request = event.data
        if (!request || request.type !== "detect") return
        const { requestId, path, sequence, blocks } = request
        try {
            const results = detectBlocks(Array.isArray(blocks) ? blocks : [])
            scope.postMessage({ type: "detect-result", requestId, path, sequence, results })
        } catch (error) {
            scope.postMessage({
                type: "detect-error",
                requestId,
                path,
                sequence,
                message: error instanceof Error ? error.message : String(error),
            })
        }
    }
}
