/**
 * Prettier backend.
 *
 * One backend, many parsers. A language opts in with
 * `formatter: {kind:"prettier", parser:"<name>"}` and the parser plan decides
 * which plugins are loaded.
 */
import { formatWithPrettier } from "./runner.js"
import { PARSER_PLANS } from "./parsers.js"

export const id = "prettier"

/**
 * @param {{parser?:string}} spec
 * @returns {boolean}
 */
export function supports(spec) {
    return Boolean(spec && PARSER_PLANS[spec.parser])
}

/**
 * @param {{parser:string}} spec
 * @param {{text:string, options?:object, cursorOffset?:number|null}} context
 */
export function run(spec, context) {
    return formatWithPrettier(spec.parser, context)
}
