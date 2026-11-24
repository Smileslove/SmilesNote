/**
 * Automatic block-language detection.
 *
 * Integration layer: decides *when* to ask for a detection and *whether* to
 * apply the answer. The scoring lives in `detect.js` (pure), the worker protocol
 * in `client.js` / `detect.worker.js`.
 *
 * Rules that matter for a good user experience:
 *
 *  - only blocks in auto mode are candidates; a manual language choice always
 *    wins and is never overridden;
 *  - ALL auto blocks of the note are checked in one debounced batch (not just
 *    the block under the cursor), so pasting into a note detects every pasted
 *    block, and blocks detected while editing keep their language;
 *  - a result is applied only when the detection engine calls it `stable`
 *    (winner clearly ahead of the runner-up);
 *  - hysteresis: a block that already has a language keeps it until the text is
 *    long enough or the evidence is strong, which stops JS/TS from trading places
 *    on every keystroke;
 *  - a whole-body replacement (paste, undo into a block) may clear stale syntax
 *    back to plain text;
 *  - answers are validated against the document sequence and the exact block
 *    text they were computed from, so a slow answer never overwrites newer input
 *    or the wrong block;
 *  - the language rewrite is annotated, so it does not re-trigger detection.
 */
import { Annotation, Transaction } from "@codemirror/state"
import { ViewPlugin } from "@codemirror/view"
import { redoDepth } from "@codemirror/commands"

import { blockState } from "../block/block.js"
import {
    heynoteEvent,
    LANGUAGE_CHANGE,
    UPDATE_CREATED,
    CURSOR_CHANGE,
    IMAGE_RESIZE,
} from "../annotation.js"
import DetectWorker from "./detect.worker.js?worker"
import { getDetectionClient } from "./client.js"
import {
    DETECTION_SAMPLE_LIMIT,
    MIN_LENGTH,
    MIN_SWITCH_LENGTH,
    PLAIN_LANGUAGE,
    STRONG_CONFIDENCE,
} from "./detect.js"

/** Marks header rewrites produced by detection itself. */
const detectionApplied = Annotation.define()

/** Wait for a pause in typing before analyzing; 500ms felt right in Quillip too. */
const DEBOUNCE_MS = 500

/** Bound one request: a note with hundreds of auto blocks is rare; keep it sane. */
const MAX_BLOCKS_PER_REQUEST = 200

export function languageDetection(path, getEditor) {
    return ViewPlugin.fromClass(
        class {
            constructor(view) {
                this.view = view
                this.editor = getEditor()
                this.sequence = 0
                this.requestId = 0
                this.timer = null
                this.disposed = false
                /** Indices whose whole body was replaced by the latest edits. */
                this.replaced = new Set()
                this.schedule(0)
            }

            update(update) {
                if (this.disposed) return
                // The editor is read-only while a buffer loads; detect once it
                // becomes editable instead of racing the load.
                if (update.startState.readOnly !== update.state.readOnly) {
                    this.schedule(0)
                }
                if (!update.docChanged) return
                if (!update.transactions.some((transaction) => !isInternalTransaction(transaction))) {
                    return
                }
                this.recordReplacedBlocks(update)
                this.sequence += 1
                this.schedule()
            }

            destroy() {
                this.disposed = true
                if (this.timer !== null) {
                    clearTimeout(this.timer)
                    this.timer = null
                }
            }

            schedule(delay = DEBOUNCE_MS) {
                if (this.disposed) return
                if (this.timer !== null) clearTimeout(this.timer)
                this.timer = setTimeout(() => {
                    this.timer = null
                    void this.detect()
                }, delay)
            }

            recordReplacedBlocks(update) {
                for (const transaction of update.transactions) {
                    if (!transaction.docChanged || isInternalTransaction(transaction)) continue
                    const startBlocks = transaction.startState.field(blockState, false) ?? []
                    transaction.changes.iterChangedRanges((fromA, toA) => {
                        for (let index = 0; index < startBlocks.length; index++) {
                            const block = startBlocks[index]
                            if (block.content.to <= block.content.from) continue
                            if (fromA <= block.content.from && toA >= block.content.to) {
                                this.replaced.add(index)
                            }
                        }
                    })
                }
            }

            async detect() {
                if (this.disposed) return
                const state = this.view.state
                if (state.readOnly) return
                const blocks = state.field(blockState, false) ?? []
                const defaultToken = this.editor?.defaultBlockToken ?? PLAIN_LANGUAGE

                const targets = []
                const resets = []
                for (let index = 0; index < blocks.length; index++) {
                    const block = blocks[index]
                    if (!block.language.auto) continue
                    const text = state.sliceDoc(block.content.from, block.content.to)
                    const trimmed = text.trim()
                    if (trimmed.length === 0) {
                        // An empty auto block falls back to the default language
                        // (this is the "delete everything" reset, not a guess).
                        if (block.language.name !== defaultToken && redoDepth(state) === 0) {
                            resets.push(index)
                        }
                        continue
                    }
                    if (trimmed.length < MIN_LENGTH) continue
                    if (targets.length >= MAX_BLOCKS_PER_REQUEST) break
                    targets.push({
                        index,
                        text: text.length > DETECTION_SAMPLE_LIMIT ? text.slice(0, DETECTION_SAMPLE_LIMIT) : text,
                    })
                }

                if (resets.length > 0) {
                    const changes = []
                    for (const index of resets) {
                        const block = blocks[index]
                        if (!block) continue
                        changes.push({
                            from: block.delimiter.from,
                            to: block.delimiter.to,
                            insert: delimiterText(defaultToken, block.created),
                        })
                    }
                    this.apply(changes)
                }

                const replaced = new Set(this.replaced)
                this.replaced.clear()
                if (targets.length === 0) return

                const sequence = this.sequence
                const { requestId, response } = getDetectionClient(() => new DetectWorker()).request({
                    path,
                    sequence,
                    blocks: targets,
                })
                this.requestId = requestId

                let results
                try {
                    results = await response
                } catch {
                    // A worker failure leaves the current languages untouched.
                    return
                }
                if (this.disposed || requestId !== this.requestId || sequence !== this.sequence) return

                const current = this.view.state
                if (current.readOnly) return
                const currentBlocks = current.field(blockState, false) ?? []
                const expectedText = new Map(targets.map((target) => [target.index, target.text]))
                const changes = []

                for (const result of results) {
                    const block = currentBlocks[result.index]
                    const expected = expectedText.get(result.index)
                    if (!block || expected === undefined || !block.language.auto) continue
                    const text = current.sliceDoc(block.content.from, block.content.to)
                    // The answer must still describe the block as it is now.
                    const sample =
                        text.length > DETECTION_SAMPLE_LIMIT ? text.slice(0, DETECTION_SAMPLE_LIMIT) : text
                    if (sample !== expected) continue
                    const next = result.language
                    if (next === block.language.name) continue
                    const wasReplaced = replaced.has(result.index)
                    const empty = text.trim().length === 0
                    const clearingToText = next === PLAIN_LANGUAGE && (wasReplaced || empty)
                    if (next === PLAIN_LANGUAGE && !clearingToText) continue
                    if (!result.stable && !clearingToText) continue
                    // Hysteresis: do not trade an existing language back and
                    // forth on short, ambiguous text.
                    if (
                        !wasReplaced &&
                        !clearingToText &&
                        block.language.name !== PLAIN_LANGUAGE &&
                        text.trim().length < MIN_SWITCH_LENGTH &&
                        result.confidence < STRONG_CONFIDENCE
                    ) {
                        continue
                    }
                    changes.push({
                        from: block.delimiter.from,
                        to: block.delimiter.to,
                        insert: delimiterText(next, block.created),
                    })
                }
                this.apply(changes)
            }

            apply(changes) {
                if (this.disposed || changes.length === 0) return
                this.view.dispatch({
                    changes,
                    // Automatic metadata must not become an undo step of its own;
                    // undo should walk back text edits, not language guesses.
                    annotations: [
                        heynoteEvent.of(LANGUAGE_CHANGE),
                        detectionApplied.of(true),
                        Transaction.addToHistory.of(false),
                    ],
                })
            }
        },
    )
}

/** Detection's own header writes and metadata refreshes are not user edits. */
function isInternalTransaction(transaction) {
    if (transaction.annotation(detectionApplied) === true) return true
    const event = transaction.annotation(heynoteEvent)
    return event === UPDATE_CREATED || event === CURSOR_CHANGE || event === IMAGE_RESIZE
}

/**
 * Header text for a detected language.
 *
 * Kept local (instead of `changeLanguageTo`) so one transaction can rewrite many
 * headers and the `created` metadata is copied verbatim.
 */
function delimiterText(language, created) {
    return `\n∞∞∞${language}-a${created ? `;created=${created}` : ""}\n`
}
