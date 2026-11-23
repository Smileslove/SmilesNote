/**
 * dprint backend.
 *
 * A language opts in with `formatter: {kind:"dprint", plugin:"<id>"}`.
 */
import { DPRINT_PLUGINS } from "./plugins.js"

export const id = "dprint"

/**
 * @param {{plugin?:string}} spec
 * @returns {boolean}
 */
export function supports(spec) {
    return Boolean(spec && DPRINT_PLUGINS[spec.plugin])
}

/**
 * @param {{plugin:string}} spec
 * @param {{text:string, options?:object}} context
 * @returns {Promise<string>}
 */
export async function run(spec, { text, options = {} }) {
    const plugin = DPRINT_PLUGINS[spec.plugin]
    if (!plugin) {
        throw new Error(`No dprint plugin "${spec.plugin}" in this build.`)
    }
    return await plugin(text, options)
}
