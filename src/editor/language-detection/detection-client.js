/**
 * Detection worker client.
 *
 * One long-lived worker is shared by every editor. Requests are keyed by id and
 * answered with the same id plus the `path`/`sequence` they were computed for,
 * so a late answer is either ignored (stale id) or rejected (mismatched
 * document) instead of being applied to the wrong block.
 */
const DETECTION_TIMEOUT_MS = 5000

/**
 * @typedef {object} DetectionResult
 * @property {number} index
 * @property {string} language
 * @property {number} confidence
 * @property {string|null} runnerUp
 * @property {boolean} stable
 */

/** @typedef {{path:string, sequence:number, blocks:Array<{index:number,text:string}>}} DetectRequestPayload */

export class DetectionClient {
    /**
     * @param {() => Worker} createWorker
     * @param {number} [timeoutMs]
     */
    constructor(createWorker, timeoutMs = DETECTION_TIMEOUT_MS) {
        this.createWorker = createWorker
        this.timeoutMs = timeoutMs
        this.worker = null
        this.pending = new Map()
        this.nextId = 1
        this.disposed = false
        this.onMessage = (event) => this.handleMessage(event)
        this.onError = (event) => this.handleWorkerFailure(errorText(event))
    }

    /**
     * @param {DetectRequestPayload} payload
     * @returns {{requestId:number, response:Promise<DetectionResult[]>}}
     */
    request({ path, sequence, blocks }) {
        const requestId = this.nextId++
        const response = new Promise((resolve, reject) => {
            if (this.disposed) {
                reject(new Error("Detection client disposed"))
                return
            }
            let worker
            try {
                worker = this.ensureWorker()
            } catch (error) {
                reject(error)
                return
            }
            const timer = setTimeout(() => {
                if (!this.pending.has(requestId)) return
                this.pending.delete(requestId)
                // The worker may be wedged; rebuild it for the next request.
                this.resetWorker()
                reject(new Error(`Language detection timed out after ${this.timeoutMs}ms`))
            }, this.timeoutMs)
            this.pending.set(requestId, { path, sequence, resolve, reject, timer })
            try {
                worker.postMessage({ type: "detect", requestId, path, sequence, blocks })
            } catch (error) {
                this.settle(requestId)
                reject(error)
            }
        })
        return { requestId, response }
    }

    dispose() {
        if (this.disposed) return
        this.disposed = true
        this.failAll(new Error("Detection client disposed"))
        this.resetWorker()
    }

    ensureWorker() {
        if (!this.worker) {
            const worker = this.createWorker()
            worker.addEventListener("message", this.onMessage)
            worker.addEventListener("error", this.onError)
            this.worker = worker
        }
        return this.worker
    }

    handleMessage(event) {
        const data = event?.data
        if (!data || typeof data !== "object") return
        if (data.type === "detect-error") {
            const pending = this.pending.get(data.requestId)
            if (pending) {
                this.settle(data.requestId)
                pending.reject(new Error(String(data.message ?? "Language detection failed")))
            }
            return
        }
        if (data.type !== "detect-result") return
        const pending = this.pending.get(data.requestId)
        if (!pending) return
        this.settle(data.requestId)
        if (data.path !== pending.path || data.sequence !== pending.sequence) {
            pending.reject(new Error("Language detection returned a mismatched response"))
            return
        }
        pending.resolve(Array.isArray(data.results) ? data.results : [])
    }

    handleWorkerFailure(message) {
        this.failAll(new Error(message))
        this.resetWorker()
    }

    settle(requestId) {
        const pending = this.pending.get(requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(requestId)
    }

    failAll(error) {
        for (const requestId of [...this.pending.keys()]) {
            const pending = this.pending.get(requestId)
            this.settle(requestId)
            pending?.reject(error)
        }
    }

    resetWorker() {
        const worker = this.worker
        this.worker = null
        if (!worker) return
        worker.removeEventListener("message", this.onMessage)
        worker.removeEventListener("error", this.onError)
        worker.terminate?.()
    }
}

function errorText(event) {
    if (event && typeof event === "object") {
        if (typeof event.message === "string" && event.message) return event.message
        if (event.error instanceof Error) return event.error.message
    }
    return "Language detection worker failed"
}

/**
 * Shared client: workers are relatively heavy, one per app is enough.
 *
 * The worker factory is injected by `index.js` so this module stays
 * transport-agnostic and can be unit tested with a fake worker.
 */
let sharedClient = null

export function getDetectionClient(createWorker) {
    if (!sharedClient) sharedClient = new DetectionClient(createWorker)
    return sharedClient
}
