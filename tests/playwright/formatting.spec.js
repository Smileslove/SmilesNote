import { test, expect } from "@playwright/test";
import { HeynotePage } from "./test-utils.js";

let heynotePage

test.beforeEach(async ({ page }) => {
    heynotePage = new HeynotePage(page)
    await heynotePage.goto()
})

/** Click the status-bar format button and wait until block 0 has the expected body. */
async function formatBlock(page, expected) {
    await page.locator("css=.status .status-block.format").click()
    await expect.poll(() => heynotePage.getBlockContent(0), { timeout: 20_000 }).toBe(expected)
    // Formatting must not create an empty undo step on the next pass.
    await page.locator("css=.status .status-block.format").click()
    await expect.poll(() => heynotePage.getBlockContent(0), { timeout: 20_000 }).toBe(expected)
}

test("JSON formatting", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞json
    {"test": 1, "key2": "hey!"}
`)
    expect(await page.locator("css=.status .status-block.lang")).toHaveText("JSON")
    await formatBlock(page, `{
    "test": 1,
    "key2": "hey!"
}
`)
})

test("JSON formatting (cursor at start)", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞json
    {"test": 1, "key2": "hey!"}
`)
    for (let i=0; i<5; i++) {
        await page.locator("body").press("ArrowUp")
    }
    await page.locator("css=.status-block.format").click()
    await expect.poll(() => heynotePage.getBlockContent(0), { timeout: 20_000 }).toBe(`{
    "test": 1,
    "key2": "hey!"
}
`)
    const block = (await heynotePage.getBlocks())[0]
    expect(await page.evaluate(() => window._heynote_editor.view.state.selection.main.from)).toBe(block.content.from)
})

test("HTML formats embedded script and style", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞html
<div><script>const x={a:1}</script><style>a{color:red}</style></div>
`)
    await formatBlock(page, `<div>
    <script>
        const x = { a: 1 };
    </script>
    <style>
        a {
            color: red;
        }
    </style>
</div>
`)
})

test("Markdown formats fenced code", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞markdown
\`\`\`js
const x={a:1}
\`\`\`
`)
    await formatBlock(page, "```js\nconst x = { a: 1 };\n```\n")
})

test("SCSS formatting", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞scss
$c:red;a{color:$c}
`)
    await formatBlock(page, `$c: red;
a {
    color: $c;
}
`)
})

test("C formatting (clang-format backend)", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞c
#include <stdio.h>
int main(){return 0;}
`)
    await formatBlock(page, `#include <stdio.h>
int main() { return 0; }
`)
})

test("Dockerfile formatting (dockerfmt backend)", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞dockerfile
from alpine
run   echo hi
`)
    await formatBlock(page, `FROM alpine
RUN echo hi
`)
})

test("TypeScript formatting", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞typescript
const x:{a:number}={a:1}
`)
    await formatBlock(page, `const x: { a: number } = { a: 1 };
`)
})

test("Python formatting (wasm backend)", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞python
def foo ():
  return 42
`)
    await formatBlock(page, `def foo():
    return 42
`)
})

test("TOML formatting (dprint backend)", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞toml
a=1
b = [1,2]
`)
    await formatBlock(page, `a = 1
b = [1, 2]
`)
})

test("SQL formatting (wasm backend)", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞sql
select a,b from t where x=1
`)
    await page.locator("css=.status .status-block.format").click()
    await expect
        .poll(() => heynotePage.getBlockContent(0), { timeout: 20_000 })
        .toContain("select\n    a,\n    b\nfrom\n    t\nwhere\n    x = 1")
})

test("format key binding (Alt + Shift + F)", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞javascript
const x={a:1}
`)
    await page.locator("css=.cm-content").first().click()
    await page.locator("body").press("Alt+Shift+F")
    await expect.poll(() => heynotePage.getBlockContent(0), { timeout: 20_000 }).toBe("const x = { a: 1 };\n")
})

test("formatting is a single undo step", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞javascript
const x={a:1}
`)
    const original = await heynotePage.getBlockContent(0)
    await page.locator("css=.status .status-block.format").click()
    await expect.poll(() => heynotePage.getBlockContent(0), { timeout: 20_000 }).toBe("const x = { a: 1 };\n")
    await heynotePage.executeCommand("undo")
    await expect.poll(() => heynotePage.getBlockContent(0)).toBe(original)
})

test("unsupported language reports why instead of failing silently", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞rust
fn main(){}
`)
    const original = await heynotePage.getBlockContent(0)
    await page.locator("css=.status .status-block.format").click()
    await expect(page.locator("css=.status .status-block.message")).toHaveText(
        "Rust has no bundled formatter.",
        { timeout: 20_000 },
    )
    expect(await heynotePage.getBlockContent(0)).toBe(original)
    await expect(page.locator("css=.status .status-block.format")).toHaveClass(/disabled/)

    // The message belongs to the block it was produced for.
    await heynotePage.setContent(`
∞∞∞json
{"a":1}
`)
    await expect(page.locator("css=.status .status-block.message")).toHaveCount(0)
})

test("syntax errors are reported and leave the block untouched", async ({ page }) => {
    await heynotePage.setContent(`
∞∞∞json
    {"test": }
`)
    const original = await heynotePage.getBlockContent(0)
    await page.locator("css=.status .status-block.format").click()
    await expect(page.locator("css=.status .status-block.message")).toContainText(
        "Could not parse JSON",
        { timeout: 20_000 },
    )
    expect(await heynotePage.getBlockContent(0)).toBe(original)
})
