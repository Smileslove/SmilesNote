import { expect, test } from "@playwright/test"
import { EditorState } from "@codemirror/state"
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language"

import { heynoteLang } from "@/src/editor/lang-heynote/heynote.js"
import { getBlocksFromSyntaxTree, getBlocksFromString } from "@/src/editor/block/block-parsing.js"

const contents = `
∞∞∞text
Text Block A
∞∞∞text-a;created=2025-12-14T10:49:23.407Z
Text Block B
∞∞∞json-a
{
"key": "value"
}
∞∞∞python
print("Hello, World!")
`

/**
 * Parse the blocks from a COMPLETE syntax tree.
 *
 * CodeMirror parses on a time budget and may cut a parse short (and mark it
 * done early) under load, which leaves a partial tree without NoteLanguage
 * children. getBlocksFromSyntaxTree() requires a complete tree, so retry with a
 * fresh state until one is available instead of asserting on a slice.
 */
function blocksFromCompleteTree() {
    for (let attempt = 0; attempt < 20; attempt++) {
        const state = EditorState.create({ doc: contents, extensions: heynoteLang() })
        ensureSyntaxTree(state, state.doc.length, 5000)
        if (!syntaxTreeAvailable(state, state.doc.length)) continue
        try {
            return getBlocksFromSyntaxTree(state)
        } catch {
            // Partial tree: retry with a fresh state.
        }
    }
    return null
}

test("parse blocks from both syntax tree and string contents", async () => {
    const state = EditorState.create({ doc: contents, extensions: heynoteLang() })
    const stringBlocks = getBlocksFromString(state)
    const treeBlocks = blocksFromCompleteTree()

    expect(treeBlocks, "no complete syntax tree was produced").not.toBeNull()
    expect(treeBlocks).toEqual(stringBlocks)
})
