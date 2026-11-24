import { describe, expect, it, vi } from "vitest"

import { DetectionClient } from "../../src/editor/language-detection/detection-client.js"

/** Minimal Worker stand-in: tests drive the responses explicitly. */
class FakeWorker {
    constructor() {
        this.listeners = new Map()
        this.posted = []
        this.terminated = false
    }
    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set())
        this.listeners.get(type).add(listener)
    }
    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener)
    }
    postMessage(message) {
        this.posted.push(message)
    }
    terminate() {
        this.terminated = true
    }
    emit(type, event) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
    }
    respond(data) {
        this.emit("message", { data })
    }
}

function makeClient(timeoutMs = 1000) {
    const worker = new FakeWorker()
    const client = new DetectionClient(() => worker, timeoutMs)
    return { client, worker }
}

describe("DetectionClient", () => {
    it("posts a batch and resolves with the results", async () => {
        const { client, worker } = makeClient()
        const { requestId, response } = client.request({
            path: "a.txt",
            sequence: 4,
            blocks: [{ index: 0, text: '{"a": 1}' }],
        })
        expect(worker.posted).toEqual([
            { type: "detect", requestId, path: "a.txt", sequence: 4, blocks: [{ index: 0, text: '{"a": 1}' }] },
        ])
        worker.respond({
            type: "detect-result",
            requestId,
            path: "a.txt",
            sequence: 4,
            results: [{ index: 0, language: "json", confidence: 3.5, runnerUp: null, stable: true }],
        })
        await expect(response).resolves.toEqual([
            { index: 0, language: "json", confidence: 3.5, runnerUp: null, stable: true },
        ])
        client.dispose()
    })

    it("rejects a response for a different document version", async () => {
        const { client, worker } = makeClient()
        const { requestId, response } = client.request({ path: "a.txt", sequence: 1, blocks: [] })
        worker.respond({ type: "detect-result", requestId, path: "b.txt", sequence: 1, results: [] })
        await expect(response).rejects.toThrow(/mismatched/)
        client.dispose()
    })

    it("rejects a worker error message", async () => {
        const { client, worker } = makeClient()
        const { requestId, response } = client.request({ path: "a.txt", sequence: 1, blocks: [] })
        worker.respond({ type: "detect-error", requestId, path: "a.txt", sequence: 1, message: "boom" })
        await expect(response).rejects.toThrow("boom")
        client.dispose()
    })

    it("ignores answers for unknown request ids", async () => {
        const { client, worker } = makeClient()
        const { response } = client.request({ path: "a.txt", sequence: 1, blocks: [] })
        worker.respond({ type: "detect-result", requestId: 999, path: "a.txt", sequence: 1, results: [] })
        expect(client.pending.size).toBe(1)
        client.dispose()
        await expect(response).rejects.toThrow(/disposed/)
    })

    it("rebuilds the worker after a crash and rejects pending work", async () => {
        const { client, worker } = makeClient()
        const { response } = client.request({ path: "a.txt", sequence: 1, blocks: [] })
        worker.emit("error", { message: "worker crashed" })
        await expect(response).rejects.toThrow("worker crashed")
        expect(worker.terminated).toBe(true)
        const second = client.request({ path: "a.txt", sequence: 2, blocks: [] })
        expect(client.worker).not.toBe(null)
        second.response.catch(() => {})
        client.dispose()
    })

    it("times out a wedged worker", async () => {
        vi.useFakeTimers()
        const { client, worker } = makeClient(50)
        const { response } = client.request({ path: "a.txt", sequence: 1, blocks: [] })
        vi.advanceTimersByTime(60)
        await expect(response).rejects.toThrow(/timed out/)
        expect(worker.terminated).toBe(true)
        client.dispose()
        vi.useRealTimers()
    })

    it("refuses work after dispose", async () => {
        const { client } = makeClient()
        client.dispose()
        await expect(client.request({ path: "a.txt", sequence: 1, blocks: [] }).response).rejects.toThrow(/disposed/)
    })
})
