/**
 * Small text-shape helpers shared by the structural scorers.
 *
 * They deliberately do not try to tokenize: detection only needs to know
 * whether a snippet *looks like* JSX/HTML or whether angle brackets inside
 * strings should be ignored.
 */

/** Remove simple string literals so tags inside strings are not counted. */
export function withoutStringLiterals(text) {
    if (!text.includes('"') && !text.includes("'") && !text.includes("`")) return text
    return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gu, "")
}

/**
 * JSX/TSX shape: real tags plus a code context.
 *
 * A bare `<div>hi</div>` is HTML, not JSX; the context checks are what keep the
 * two apart. SFC and HTML wrappers are excluded explicitly.
 */
export function hasJsxShape(text) {
    const source = withoutStringLiterals(text)
    if (/<(?:template|script|style)\b/iu.test(source)) return false
    const hasOpeningTag = /<[A-Za-z][\w.:-]*(?:\s[^<>]*)?>/u.test(source)
    const hasClosingTag = /<\/[A-Za-z][\w.:-]*\s*>/u.test(source)
    const hasSelfClosingTag = /<[A-Za-z][\w.:-]*(?:\s[^<>]*)?\/>/u.test(source)
    if (!hasOpeningTag || (!hasClosingTag && !hasSelfClosingTag)) return false
    return (
        /\breturn\s*\(?\s*</u.test(source) ||
        /=>\s*\(?\s*</u.test(source) ||
        /\b(?:const|let|var)\s+[$A-Z_a-z][$\w]*(?:\s*:\s*[^=\n]+)?\s*=\s*\(?\s*</u.test(source) ||
        /\bclassName\s*=/u.test(source) ||
        />\s*\{[^}\n]+\}/u.test(source)
    )
}
