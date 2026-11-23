/**
 * Backend registry.
 *
 * This is the ONE place that knows how a backend kind is loaded. Adding a
 * formatter engine means:
 *   1. write `backends/<kind>/index.js` exporting `{id, supports, run}`;
 *   2. add its lazy loader below;
 *   3. add the kind to `BACKEND_KINDS` in `manifest.js`.
 *
 * The loaders are dynamic imports on purpose: this module is imported by the
 * formatting pipeline only, and the engines (Prettier, wasm binaries, dprint)
 * must never enter the first-screen bundle.
 */

/** @type {Record<string, () => Promise<{id:string, supports:Function, run:Function}>>} */
export const BACKEND_LOADERS = {
    prettier: () => import("./prettier/index.js"),
    wasm: () => import("./wasm/index.js"),
    dprint: () => import("./dprint/index.js"),
}

/**
 * Load the backend module for a spec kind, or null when the kind is unknown.
 * @param {string} kind
 * @returns {Promise<{id:string, supports:Function, run:Function}|null>}
 */
export async function loadBackend(kind) {
    const loader = BACKEND_LOADERS[kind]
    return loader ? await loader() : null
}
