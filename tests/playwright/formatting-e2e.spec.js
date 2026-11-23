import { test, expect, _electron as electron } from "@playwright/test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { spawn } from "node:child_process"

import { HeynotePage } from "./test-utils.js"

/**
 * Formatting in the PACKAGED app (renderer loaded from file://).
 *
 * The wasm backends read their `.wasm` assets at runtime. In the browser build
 * that is a plain fetch; in Electron the renderer runs from file://, where the
 * preload bridge (`window.heynote.readAssetBytes`) reads the bytes instead.
 * This test is the only place that exercises that path end to end.
 */

async function ensureElectronBuild() {
    const mainPath = path.join(process.cwd(), "dist-electron", "main", "index.js")
    const preloadPath = path.join(process.cwd(), "dist-electron", "preload", "index.js")
    try {
        await fs.stat(mainPath)
        await fs.stat(preloadPath)
        return
    } catch {
        // build below
    }
    await new Promise((resolve, reject) => {
        const child = spawn("npx", ["vite", "build"], { stdio: "inherit", env: { ...process.env } })
        child.on("error", reject)
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite build failed: ${code}`))))
    })
}

async function dirExists(target) {
    try {
        return (await fs.stat(target)).isDirectory()
    } catch (error) {
        if (error.code === "ENOENT") return false
        throw error
    }
}

async function removeDirWithRetry(target) {
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await fs.rm(target, { recursive: true, force: true })
            return
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
        }
    }
}

test.describe("formatting in the packaged app", { tag: "@e2e" }, () => {
    test.describe.configure({ mode: "serial" })
    test.skip(({ browserName }) => browserName !== "chromium", "Electron runs only once under chromium")

    /** @type {HeynotePage} */
    let heynotePage
    let electronApp
    let tmpRoot
    let userDataDir
    let page

    test.beforeEach(async () => {
        test.setTimeout(120000)
        await ensureElectronBuild()
        tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "heynote-fmt-e2e-"))
        userDataDir = path.join(tmpRoot, "user-data")
        await fs.mkdir(userDataDir)

        // The CI/harness environment may set ELECTRON_RUN_AS_NODE (Node-only
        // runs); Electron would then start as plain Node instead of the app.
        const env = { ...process.env, HEYNOTE_TEST_USER_DATA_DIR: userDataDir }
        delete env.ELECTRON_RUN_AS_NODE

        electronApp = await electron.launch({
            args: ["--no-sandbox", "tests/playwright/electron-runner.cjs"],
            env,
        })
        page = await electronApp.firstWindow()
        await page.waitForLoadState("domcontentloaded")
        heynotePage = new HeynotePage(page)
        await expect(page.locator(".cm-editor")).toBeVisible()
    })

    test.afterEach(async () => {
        if (electronApp) {
            await electronApp.close()
        }
        if (await dirExists(tmpRoot)) {
            await removeDirWithRetry(tmpRoot)
        }
    })

    test("exposes the asset bridge and formats with Prettier", async () => {
        expect(await page.evaluate(() => typeof window.heynote.readAssetBytes)).toBe("function")

        await heynotePage.setContent(`
∞∞∞json
{"a":1}
`)
        await page.locator("css=.status .status-block.format").click()
        await expect
            .poll(() => heynotePage.getBlockContent(0), { timeout: 30000 })
            .toBe('{\n    "a": 1\n}\n')
    })

    test("formats Python (wasm asset read through the bridge)", async () => {
        await heynotePage.setContent(`
∞∞∞python
def foo ():
  return 42
`)
        await page.locator("css=.status .status-block.format").click()
        await expect
            .poll(() => heynotePage.getBlockContent(0), { timeout: 60000 })
            .toBe("def foo():\n    return 42\n")
    })

    test("formats TOML (dprint) and SCSS (Prettier)", async () => {
        await heynotePage.setContent(`
∞∞∞toml
a=1
b = [1,2]
`)
        await page.locator("css=.status .status-block.format").click()
        await expect
            .poll(() => heynotePage.getBlockContent(0), { timeout: 60000 })
            .toBe("a = 1\nb = [1, 2]\n")

        await heynotePage.setContent(`
∞∞∞scss
$c:red;a{color:$c}
`)
        await page.locator("css=.status .status-block.format").click()
        await expect
            .poll(() => heynotePage.getBlockContent(0), { timeout: 30000 })
            .toBe("$c: red;\na {\n    color: $c;\n}\n")
    })
})
