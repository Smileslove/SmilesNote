/**
 * Reading bundled binary assets at runtime.
 *
 * The wasm formatters ship as Vite assets (`?url` imports). In the browser and
 * in the Electron dev server those URLs are `http(s):` and `fetch` is enough.
 * The packaged Electron app loads the renderer from `file://`, where `fetch`
 * refuses the scheme, so the bytes are read through the preload bridge instead.
 * The last resort is XHR, which some Electron configurations still allow.
 *
 * Keeping this in one module means the formatters never care which host they
 * run in.
 */
import { FormatterError } from "../../errors.js"

/** @type {Map<string, Promise<ArrayBuffer>>} */
const cache = new Map()

/** Fetch a data: URL (used by tests and by Electron/Chromium alike). */
async function fetchBytes(url) {
    const response = await fetch(url)
    if (!response.ok) {
        throw new FormatterError(`Could not load formatter asset (${response.status}): ${url}`)
    }
    return await response.arrayBuffer()
}

/** Read a file:// URL through the preload bridge (packaged app). */
async function bridgeBytes(url) {
    const bridge = globalThis.heynote?.readAssetBytes
    if (typeof bridge !== "function") return null
    const bytes = await bridge(url)
    return bytes || null
}

/** Read any URL as an ArrayBuffer through XHR. */
function xhrBytes(url) {
    return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open("GET", url)
        request.responseType = "arraybuffer"
        request.onload = () => {
            if (request.response) {
                resolve(request.response)
            } else {
                reject(new FormatterError(`Could not read formatter asset: ${url}`))
            }
        }
        request.onerror = () => reject(new FormatterError(`Could not read formatter asset: ${url}`))
        request.send()
    })
}

/**
 * Read a bundled asset as bytes. Results are cached per URL: a formatter is
 * compiled from the same bytes only once.
 *
 * @param {string} url
 * @returns {Promise<ArrayBuffer>}
 */
export function readBinaryAsset(url) {
    const cached = cache.get(url)
    if (cached) return cached
    const promise = (async () => {
        if (/^(?:https?|data):/u.test(url)) {
            return await fetchBytes(url)
        }
        const fromBridge = await bridgeBytes(url)
        if (fromBridge) {
            return fromBridge
        }
        // Last resort: XHR can read file:// in some Electron configurations.
        return await xhrBytes(url)
    })()
    cache.set(url, promise)
    // A failed read must not poison the cache: a later attempt may succeed.
    promise.catch(() => cache.delete(url))
    return promise
}
