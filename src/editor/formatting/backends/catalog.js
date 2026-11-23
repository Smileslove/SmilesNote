/**
 * The formatter catalog: what this build declares as supported.
 *
 * PURE DATA. `capability.js` (and therefore the status bar) imports this on the
 * UI thread, so nothing here may import Prettier, a wasm file or a plugin.
 *
 * The ids below are the single source of truth used by BOTH sides:
 *   - capability checks (`specSupport`) decide whether a block can be formatted
 *     without loading an engine;
 *   - each backend implementation builds its table from these ids and fails
 *     loudly at import time when an implementation is missing
 *     (`assertComplete`), so "declared but not implemented" cannot ship.
 *
 * Adding a parser/formatter/plugin therefore means: add the id here, add the
 * implementation in the matching backend, add a language entry that references
 * it. `tests/main/formatting-capability.test.js` locks the two sides together.
 */

/** Backend kinds the pipeline can dispatch to (registry.js has a loader for each). */
export const BACKEND_KINDS = Object.freeze(["prettier", "wasm", "dprint"])

/** Prettier parsers with a plugin plan in this build. */
export const PRETTIER_PARSERS = Object.freeze([
    "json",
    "json-stringify",
    "babel",
    "typescript",
    "html",
    "css",
    "scss",
    "less",
    "vue",
    "markdown",
    "yaml",
    "graphql",
    "xml",
    "java",
])

/** wasm formatter ids with an implementation in this build. */
export const WASM_FORMATTERS = Object.freeze(["python", "go", "sql", "clang", "sh", "dockerfile"])

/** dprint plugin ids bundled with the app. */
export const DPRINT_PLUGINS = Object.freeze(["toml"])

/**
 * Whether a formatter spec has a declared implementation.
 *
 * @param {{kind:string, parser?:string, formatter?:string, plugin?:string}} spec
 * @returns {boolean|null} false when declared but missing, null when the backend
 *   kind itself is unknown (a bug in the language table)
 */
export function specSupport(spec) {
    if (!spec || typeof spec.kind !== "string") return null
    switch (spec.kind) {
        case "prettier":
            return PRETTIER_PARSERS.includes(spec.parser)
        case "wasm":
            return WASM_FORMATTERS.includes(spec.formatter)
        case "dprint":
            return DPRINT_PLUGINS.includes(spec.plugin)
        default:
            return null
    }
}

/**
 * The id a spec refers to, for error messages.
 * @param {{kind:string, parser?:string, formatter?:string, plugin?:string}|null} spec
 * @returns {string|null}
 */
export function specTarget(spec) {
    if (!spec) return null
    return spec.parser ?? spec.formatter ?? spec.plugin ?? null
}

/**
 * Throw when an implementation table is missing a catalog id. Called at import
 * time by the backends so a half-finished port fails immediately instead of
 * silently refusing to format one language.
 *
 * @param {string} kind
 * @param {readonly string[]} declared
 * @param {Record<string, unknown>} implemented
 */
export function assertComplete(kind, declared, implemented) {
    const missing = declared.filter((id) => !(id in implemented))
    if (missing.length > 0) {
        throw new Error(
            `Formatter catalog declares ${kind} id(s) without an implementation: ${missing.join(", ")}`,
        )
    }
}
