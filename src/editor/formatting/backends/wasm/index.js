/**
 * wasm backend.
 *
 * A language opts in with `formatter: {kind:"wasm", formatter:"<id>"}`; the id
 * names an entry in `formatters.js`. Nothing wasm-related is imported until a
 * block of that language is actually formatted.
 */
import { WASM_FORMATTERS } from "./formatters.js"

export const id = "wasm"

/**
 * @param {{formatter?:string}} spec
 * @returns {boolean}
 */
export function supports(spec) {
    return Boolean(spec && WASM_FORMATTERS[spec.formatter])
}

/**
 * @param {{formatter:string}} spec
 * @param {{text:string, options?:object, token:string}} context
 * @returns {Promise<string>}
 */
export async function run(spec, { text, options = {}, token }) {
    const formatter = WASM_FORMATTERS[spec.formatter]
    if (!formatter) {
        throw new Error(`No wasm formatter "${spec.formatter}" in this build.`)
    }
    return await formatter(text, options, token)
}
