import { test, expect } from "@playwright/test";
import { HeynotePage } from "./test-utils.js";

let heynotePage

test.beforeEach(async ({ page }) => {
    heynotePage = new HeynotePage(page)
    await heynotePage.goto()
})


test("test valid JSON detection", async ({ page }) => {
    await page.locator("body").pressSequentially(`
        {"test": 1, "key2": "hey!"}
    `)
    await expect(page.locator("css=.status .status-block.lang")).toHaveText("JSON (auto)")
    const block = (await heynotePage.getBlocks())[0]
    expect(block.language.name).toBe("json")
    expect(block.language.auto).toBeTruthy()
})


test("python detection", async ({ page }) => {
    await page.locator("body").pressSequentially(`
# import complex math module
import cmath

# calculate the discriminant
d = (b**2) - (4*a*c)

# find two solutions
sol1 = (-b-cmath.sqrt(d))/(2*a)
sol2 = (-b+cmath.sqrt(d))/(2*a)

print('The solution are {0} and {1}'.format(sol1,sol2))
    `)
    await expect(page.locator("css=.status .status-block.lang")).toHaveText("Python (auto)")
})

test("TOML detection", async ({ page }) => {
    await page.locator("body").pressSequentially(`
[build-system]
requires = ["setuptools>=61", "wheel", "setuptools_scm>=6.2"]
build-backend = "setuptools.build_meta"

[project]
name = "locust"
license = { text = "MIT" }
description = "Developer friendly load testing framework"
dynamic = ["version"]
requires-python = ">=3.8"
`)
    await expect(page.locator("css=.status .status-block.lang")).toHaveText("TOML (auto)")
})


test("prose stays plain text", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞text-a
Remember to buy milk and call the dentist tomorrow morning.
`)
    await page.waitForTimeout(1500)
    await expect(page.locator("css=.status .status-block.lang")).toHaveText("Plain Text (auto)")
})

test("detects JavaScript and TypeScript without trading places", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞text-a
const nums = [1, 2, 3]
const doubled = nums.map(n => n * 2)
console.log(doubled)
`)
    const block = (await heynotePage.getBlocks())[0]
    await expect.poll(async () => (await heynotePage.getBlocks())[0].language.name).toBe("javascript")
    // The rewrites keep the created metadata of the original delimiter.
    expect((await heynotePage.getBlocks())[0].language.auto).toBe(true)

    await heynotePage.setContent(`
∞∞∞text-a
interface User { id: number; name: string }
export const f = (u: User): string => u.name
`)
    await expect.poll(async () => (await heynotePage.getBlocks())[0].language.name).toBe("typescript")
})

test("detects languages that guesslang could not: JSX, SCSS, Dockerfile, GraphQL, C, Protobuf", async ({ page }) => {
    const cases = [
        ["jsx", `export const A = () => <div className="x">{value}</div>`],
        ["scss", `$primary: #333;\n.card {\n  color: $primary;\n  &:hover { color: red; }\n}`],
        ["dockerfile", `FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci`],
        ["graphql", `query GetUser {\n  user(id: 1) {\n    id\n    name\n  }\n}`],
        ["c", `#include <stdio.h>\nint main(void) {\n  printf("hi\\n");\n  return 0;\n}`],
        ["protobuf", `syntax = "proto3";\nmessage User {\n  int32 id = 1;\n  string name = 2;\n}`],
        ["less", `@primary: #333;\n.card {\n  color: @primary;\n  .mixin() { color: red; }\n}`],
        ["jsonc", `{\n  // settings\n  "name": "x", /* note */\n  "theme": "dark",\n}`],
    ]
    for (const [expected, body] of cases) {
        await heynotePage.setContent(`\n∞∞∞text-a\n${body}\n`)
        await expect
            .poll(async () => (await heynotePage.getBlocks())[0].language.name, { timeout: 8000 })
            .toBe(expected)
    }
})

test("detects every block of a multi-block note, not just the cursor block", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞text-a
{"a": 1, "b": [1, 2]}
∞∞∞text-a
SELECT id, name FROM users WHERE age > 18;
∞∞∞text-a
# Shopping

- milk
- eggs
`)
    await expect
        .poll(async () => (await heynotePage.getBlocks()).map((block) => block.language.name), { timeout: 8000 })
        .toEqual(["json", "sql", "markdown"])
})

test("never overrides a manual language choice", async ({ page }) => {
    // No "-a": the user picked JSON explicitly.
    await heynotePage.setContent(`
∞∞∞json
print("this is python, but the block is locked to JSON")
`)
    await page.waitForTimeout(1500)
    expect((await heynotePage.getBlocks())[0].language.name).toBe("json")
    expect((await heynotePage.getBlocks())[0].language.auto).toBe(false)
})

test("keeps an existing language on short, ambiguous text (hysteresis)", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞javascript-a
val x = 1
`)
    await page.waitForTimeout(1500)
    expect((await heynotePage.getBlocks())[0].language.name).toBe("javascript")
})

test("keeps the block created metadata when the language is detected", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞text-a;created=2024-01-02T03:04:05.000Z
{"a": 1}
`)
    await expect.poll(async () => (await heynotePage.getBlocks())[0].language.name).toBe("json")
    expect((await heynotePage.getBlocks())[0].created).toBe("2024-01-02T03:04:05.000Z")
})

test("clears stale syntax back to plain text when the body is replaced with prose", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞json-a
{"a": 1}
`)
    await expect.poll(async () => (await heynotePage.getBlocks())[0].language.name).toBe("json")
    await heynotePage.setContent(`
∞∞∞json-a
Remember to call the plumber on Tuesday morning.
`)
    await expect.poll(async () => (await heynotePage.getBlocks())[0].language.name).toBe("text")
})
