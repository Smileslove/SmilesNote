/**
 * Batch entry point for language detection.
 *
 * Kept in `detect.js` rather than in the worker file so the exact same code runs
 * in unit tests without a DOM/worker.
 */
import { detectLanguage } from "./detect.js"

/**
 * Detect a batch of blocks.
 *
 * @param {Array<{index:number, text:string}>} blocks
 * @returns {Array<{index:number, language:string, confidence:number, runnerUp:string|null, stable:boolean}>}
 */
export function detectBlocks(blocks) {
    const results = []
    for (const block of blocks) {
        const detection = detectLanguage(block.text)
        results.push({
            index: block.index,
            language: detection.language,
            confidence: detection.confidence,
            runnerUp: detection.runnerUp,
            stable: detection.stable,
        })
    }
    return results
}
