/**
 * Capability: "can this block be formatted, and if not, why?"
 *
 * Pure and cheap. It reads the language declaration plus the pure-data manifest
 * and never loads Prettier, a wasm binary or a plugin, so the status bar and the
 * command palette can ask about every block without paying for the engines.
 */
import { LANGUAGES } from "../languages.js"
import { FormatCode } from "./errors.js"
import { unavailableMessage } from "./messages.js"
import { specSupport, specTarget } from "./backends/catalog.js"

const LANGUAGES_BY_TOKEN = new Map(LANGUAGES.map((language) => [language.token, language]))

/**
 * @param {string} token
 * @returns {object|null}
 */
export function languageOf(token) {
    return LANGUAGES_BY_TOKEN.get(token) ?? null
}

/**
 * Display name for a block language token; falls back to the token itself.
 * @param {string} token
 * @returns {string}
 */
export function languageName(token) {
    return languageOf(token)?.name ?? (typeof token === "string" && token ? token : "This block")
}

/**
 * The formatter declared by a language, or null.
 * @param {string} token
 * @returns {{kind:string, parser?:string, formatter?:string, plugin?:string}|null}
 */
export function formatterSpecOf(token) {
    return languageOf(token)?.formatter ?? null
}

/**
 * @typedef {object} FormatSupport
 * @property {boolean} supported
 * @property {{kind:string, parser?:string, formatter?:string, plugin?:string}|null} spec
 * @property {string|null} reason a FormatCode, null when supported
 * @property {string|null} target parser/formatter/plugin id, for messages
 */

/**
 * Decide whether a block language can be formatted right now.
 *
 * @param {string} token
 * @returns {FormatSupport}
 */
export function formatSupport(token) {
    const spec = formatterSpecOf(token)
    if (!spec) {
        return {
            supported: false,
            spec: null,
            reason: noSpecReason(token),
            target: null,
        }
    }
    const support = specSupport(spec)
    if (support === null) {
        return { supported: false, spec, reason: FormatCode.BACKEND_UNAVAILABLE, target: specTarget(spec) }
    }
    if (!support) {
        return { supported: false, spec, reason: FormatCode.PLUGIN_UNAVAILABLE, target: specTarget(spec) }
    }
    return { supported: true, spec, reason: null, target: specTarget(spec) }
}

/**
 * @param {string} token
 * @returns {boolean}
 */
export function supportsFormatting(token) {
    return formatSupport(token).supported
}

/**
 * One sentence for a disabled format action, or null when it is available.
 * @param {string} token
 * @returns {string|null}
 */
export function formattingUnavailableReason(token) {
    // No language under the cursor yet (startup) or an unknown token: make no
    // claim, the UI has its own generic wording.
    if (!languageOf(token)) return null
    const support = formatSupport(token)
    if (support.supported) return null
    return unavailableMessage({
        reason: support.reason,
        parser: support.target,
        languageName: languageName(token),
    })
}

/** Plain text and math blocks have special wording, everything else is generic. */
function noSpecReason(token) {
    if (token === "text") return FormatCode.PLAIN_TEXT
    if (token === "math") return FormatCode.COMPUTED
    return FormatCode.NO_FORMATTER
}
