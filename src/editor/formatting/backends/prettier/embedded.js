/**
 * Plugin lists for Prettier's embedded-language hook.
 *
 * Prettier formats `<script>`/`<style>` inside HTML and Vue, and fenced code
 * inside Markdown, by asking for the *embedded* parser. `prettier/standalone`
 * has no plugin registry, so unless the embedded parsers are passed in the same
 * call, Prettier silently prints the nested code verbatim (it does not throw).
 * That is why HTML with a `<script>` used to look "unformatted".
 *
 * Keep these lists next to the parsers they belong to: adding a fence language
 * to Markdown is a one-line change here.
 */

export const loadHtmlPlugin = () => import("prettier/plugins/html")
export const loadBabelPlugin = () => import("prettier/plugins/babel")
export const loadEstreePlugin = () => import("prettier/plugins/estree")
export const loadTypescriptPlugin = () => import("prettier/plugins/typescript")
export const loadPostcssPlugin = () => import("prettier/plugins/postcss")
export const loadMarkdownPlugin = () => import("prettier/plugins/markdown")
export const loadYamlPlugin = () => import("prettier/plugins/yaml")
export const loadGraphqlPlugin = () => import("prettier/plugins/graphql")

/** HTML and Vue: script (JS/TS) and style (CSS) blocks. */
export const HTML_EMBEDDED_PLUGINS = [
    loadHtmlPlugin,
    loadBabelPlugin,
    loadEstreePlugin,
    loadTypescriptPlugin,
    loadPostcssPlugin,
]

/** Markdown fences: the common languages a note actually contains. */
export const MARKDOWN_EMBEDDED_PLUGINS = [
    loadMarkdownPlugin,
    loadHtmlPlugin,
    loadBabelPlugin,
    loadEstreePlugin,
    loadTypescriptPlugin,
    loadPostcssPlugin,
    loadYamlPlugin,
    loadGraphqlPlugin,
]
