/**
 * Prettier parser plans.
 *
 * A plan says which plugins a parser needs, how to unwrap third-party plugin
 * modules, and which extra options are mandatory for that parser. Languages
 * reference these plans by name (`formatter: {kind:"prettier", parser:"babel"}`),
 * so JavaScript and JSX share one plan and there is no per-language duplication.
 *
 * Plugins are loaded through thunks: formatting JSON must not download the
 * TypeScript, HTML, XML or Java plugin. Each thunk becomes its own chunk.
 */
import { PRETTIER_PARSERS, assertComplete } from "../catalog.js"
import {
    HTML_EMBEDDED_PLUGINS,
    MARKDOWN_EMBEDDED_PLUGINS,
    loadBabelPlugin,
    loadEstreePlugin,
    loadGraphqlPlugin,
    loadMarkdownPlugin,
    loadPostcssPlugin,
    loadTypescriptPlugin,
    loadYamlPlugin,
} from "./embedded.js"

/**
 * @typedef {object} ParserPlan
 * @property {string} parser Prettier parser name
 * @property {Array<() => Promise<unknown>>} plugins lazy plugin loaders
 * @property {boolean} [unwrapDefault] take `module.default` (third-party plugins)
 * @property {Record<string, unknown>} [defaults] options forced for this parser
 */

/** @type {Record<string, ParserPlan>} */
export const PARSER_PLANS = {
    // Strict JSON (JSON.parse semantics): always expands objects/arrays, which
    // is what "format this JSON" is expected to do. Comments are rejected.
    "json-stringify": {
        parser: "json-stringify",
        plugins: [loadBabelPlugin, loadEstreePlugin],
    },
    // Lenient JSON (comments and trailing commas survive); keeps the author's
    // line wrapping, so single-line objects stay single-line.
    json: {
        parser: "json",
        plugins: [loadBabelPlugin, loadEstreePlugin],
    },
    babel: {
        parser: "babel",
        plugins: [loadBabelPlugin, loadEstreePlugin],
    },
    typescript: {
        // Babel would reject TypeScript syntax, so the TS plugin is the only
        // language plugin loaded here (plus the shared printer).
        parser: "typescript",
        plugins: [loadTypescriptPlugin, loadEstreePlugin],
    },
    html: { parser: "html", plugins: HTML_EMBEDDED_PLUGINS },
    vue: { parser: "vue", plugins: HTML_EMBEDDED_PLUGINS },
    css: { parser: "css", plugins: [loadPostcssPlugin] },
    scss: { parser: "scss", plugins: [loadPostcssPlugin] },
    less: { parser: "less", plugins: [loadPostcssPlugin] },
    markdown: { parser: "markdown", plugins: MARKDOWN_EMBEDDED_PLUGINS },
    yaml: { parser: "yaml", plugins: [loadYamlPlugin] },
    graphql: { parser: "graphql", plugins: [loadGraphqlPlugin] },
    xml: {
        parser: "xml",
        plugins: [() => import("@prettier/plugin-xml")],
        unwrapDefault: true,
        // plugin-xml defaults to whitespace-strict, which refuses to re-indent
        // element content: formatting then looks like it did nothing.
        defaults: { xmlWhitespaceSensitivity: "preserve" },
    },
    java: {
        parser: "java",
        plugins: [() => import("prettier-plugin-java")],
        unwrapDefault: true,
    },
}

/** Parser names this build implements (kept in sync with catalog.js by tests). */
export function knownPrettierParsers() {
    return Object.keys(PARSER_PLANS)
}

assertComplete("prettier", PRETTIER_PARSERS, PARSER_PLANS)
