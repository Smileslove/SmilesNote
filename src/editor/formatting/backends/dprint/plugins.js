/**
 * dprint plugin implementations.
 *
 * dprint is a meta-formatter: it runs a plugin wasm binary with a config
 * object. TOML is the only bundled plugin; adding another means a new entry
 * here plus its id in `catalog.js`.
 */
import { clampIndent, clampPrintWidth } from "../../options.js"
import { readBinaryAsset } from "../wasm/assets.js"
import { DPRINT_PLUGINS as DPRINT_PLUGIN_IDS, assertComplete } from "../catalog.js"

/** Compiled plugin instances, keyed by plugin id. */
const instances = new Map()

function pluginInstance(id) {
    if (!instances.has(id)) {
        const promise = (async () => {
            const [formatter, asset] = await Promise.all([
                import("@dprint/formatter"),
                import("@dprint/toml/plugin.wasm?url"),
            ])
            return formatter.createFromBuffer(await readBinaryAsset(asset.default))
        })().catch((error) => {
            instances.delete(id)
            throw error
        })
        instances.set(id, promise)
    }
    return instances.get(id)
}

/**
 * @typedef {(text:string, options:object) => Promise<string>} DprintPlugin
 */

/** @type {Record<string, DprintPlugin>} */
export const DPRINT_PLUGINS = {
    async toml(text, options) {
        const formatter = await pluginInstance("toml")
        /** @type {Record<string, unknown>} */
        const overrideConfig = {}
        const indentWidth = clampIndent(options.indent)
        if (indentWidth !== null) overrideConfig.indentWidth = indentWidth
        if (typeof options.useTabs === "boolean") overrideConfig.useTabs = options.useTabs
        const lineWidth = clampPrintWidth(options.printWidth)
        if (lineWidth !== null) overrideConfig.lineWidth = lineWidth
        return formatter.formatText({
            filePath: "block.toml",
            fileText: text,
            overrideConfig: Object.keys(overrideConfig).length === 0 ? undefined : overrideConfig,
        })
    },
}

/** Plugin ids this build implements. */
export function knownDprintPlugins() {
    return Object.keys(DPRINT_PLUGINS)
}

assertComplete("dprint", DPRINT_PLUGIN_IDS, DPRINT_PLUGINS)
