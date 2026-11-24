/**
 * Ported from Quillip's `src/editor/sqlLexer.ts` (TypeScript) to plain
 * JavaScript. No behaviour change: same tokenizer, same token kinds, same
 * source ranges and paren depths.
 */

/**
 * SQL 词法切分（只服务格式化，不是 SQL 解析器）。
 *
 * 为什么需要它：@wasm-fmt/sql_fmt（Rust 的 sqlformat）对通用方言的 DDL 支持有限，
 * 会把 MySQL 的 `SET ('a', 'b')` 当成语句子句拆行，也不会按列对齐。要让
 * `CREATE TABLE` 的列定义排成一张表，必须自己知道「哪个 token 是列名、类型、约束」，
 * 于是先做一层最小词法：保留注释与字符串原样，只记录 token 种类、源码区间和括号深度。
 *
 * 三种确定性约定：
 *  - token.text 永远是源码原文，不做任何改写；格式化只重新排列空白与换行。
 *  - 字符串 / 引号标识符里的一切（逗号、括号、`--`、关键字）都只属于该 token，
 *    所以按逗号拆列定义不会切坏字符串。
 *  - depth 只统计圆括号：`(` 取进入前的深度，`)` 取与它匹配的 `(` 的深度，其余 token
 *    取自身所在深度。顶层语句的分号与 CREATE TABLE 列定义列表的逗号都靠它区分。
 *
 * 不认识的字符一律当作一个单字符运算符保留，宁可让它原样输出，也不静默吞掉。
 */

/**
 * token 种类。
 *
 * @typedef {'word' | 'quoted' | 'string' | 'number' | 'operator' | 'punct' | 'lineComment' | 'blockComment'} SqlTokenKind
 */

/**
 * @typedef {object} SqlToken
 * @property {SqlTokenKind} kind
 * @property {string} text 源码原文，逐字符保留。
 * @property {number} start 源码起止偏移（左闭右开）。
 * @property {number} end 源码起止偏移（左闭右开）。
 * @property {number} depth 圆括号深度，见模块注释。
 */

const WORD_START = /[A-Za-z_$\u0080-\uffff]/u
const WORD_PART = /[A-Za-z0-9_$\u0080-\uffff]/u
const DIGIT = /[0-9]/

/** 多字符运算符按长度降序匹配，避免 `<=>` 被拆成 `<=` + `>`。 */
const MULTI_CHAR_OPERATORS = ['<=>', '->>', '::', '->', '<=', '>=', '<>', '!=', ':=', '||', '&&', '<<', '>>', '!<', '!>']

const PUNCTUATION = new Set(['(', ')', ',', ';', '.', '[', ']'])

function isWhitespace(character) {
    return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f' || character === '\v'
}

/**
 * @param {SqlToken|undefined} token
 * @param {string} [value]
 * @returns {boolean}
 */
export function isWord(token, value) {
    if (token?.kind !== 'word') return false
    return value === undefined ? true : token.text.toUpperCase() === value
}

/** token 是否是某个单词（忽略大小写），方便判断关键字序列。 */
export function wordUpper(token) {
    return token?.kind === 'word' ? token.text.toUpperCase() : ''
}

/**
 * 扫描引号结构，返回结束偏移（未闭合时返回源码末尾）。
 *
 * `backslashEscapes` 只对 MySQL 的 `'...'` 打开：MySQL 默认把 `\'` 当转义，而
 * Postgres / SQLite 的字符串里反斜杠是普通字符。猜错时最坏结果是后续 token 被并进
 * 同一个字符串 token（原文照抄、字符不丢），不会像「提前结束」那样把后面的 SQL 重新
 * 排布成另一副样子。
 *
 * @param {string} source
 * @param {number} start
 * @param {string} quote
 * @param {{ doubledQuote: boolean, backslashEscapes: boolean }} options
 * @returns {number}
 */
function scanQuoted(source, start, quote, options) {
    let index = start + 1
    while (index < source.length) {
        const character = source[index]
        if (options.backslashEscapes && character === '\\') {
            index += 2
            continue
        }
        if (character === quote) {
            if (options.doubledQuote && source[index + 1] === quote) {
                index += 2
                continue
            }
            return index + 1
        }
        index += 1
    }
    return source.length
}

/** 扫描数字字面量，返回结束偏移。 */
function scanNumber(source, start) {
    let index = start
    const isHex = source[index] === '0' && (source[index + 1] === 'x' || source[index + 1] === 'X')
    if (isHex) {
        index += 2
        while (index < source.length && /[0-9A-Fa-f]/.test(source[index])) index += 1
        return index
    }
    while (index < source.length && DIGIT.test(source[index])) index += 1
    if (source[index] === '.') {
        index += 1
        while (index < source.length && DIGIT.test(source[index])) index += 1
    }
    if (index < source.length && (source[index] === 'e' || source[index] === 'E')) {
        let exponent = index + 1
        if (source[exponent] === '+' || source[exponent] === '-') exponent += 1
        if (DIGIT.test(source[exponent] ?? '')) {
            index = exponent
            while (index < source.length && DIGIT.test(source[index])) index += 1
        }
    }
    return index
}

/** 把 SQL 源码切成 token；空白被丢弃，但 token 的源码区间足以还原任意间距。 */
export function tokenizeSql(source) {
    const tokens = []
    const length = source.length
    let depth = 0
    let index = 0

    const push = (kind, start, end, tokenDepth = depth) => {
        tokens.push({ kind, text: source.slice(start, end), start, end, depth: tokenDepth })
    }

    while (index < length) {
        const character = source[index]

        if (isWhitespace(character)) {
            index += 1
            continue
        }

        // -- 行注释（SQL 标准；MySQL 要求 `-- ` 后跟空白，这里放宽，反正不改变文本）
        if (character === '-' && source[index + 1] === '-') {
            const start = index
            index += 2
            while (index < length && source[index] !== '\n' && source[index] !== '\r') index += 1
            push('lineComment', start, index)
            continue
        }

        // # 行注释（MySQL）
        if (character === '#') {
            const start = index
            index += 1
            while (index < length && source[index] !== '\n' && source[index] !== '\r') index += 1
            push('lineComment', start, index)
            continue
        }

        if (character === '/' && source[index + 1] === '*') {
            const start = index
            index += 2
            while (index < length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
            index = Math.min(length, index + 2)
            push('blockComment', start, index)
            continue
        }

        if (character === "'") {
            const start = index
            index = scanQuoted(source, start, "'", { doubledQuote: true, backslashEscapes: true })
            push('string', start, index)
            continue
        }

        if (character === '"') {
            const start = index
            index = scanQuoted(source, start, '"', { doubledQuote: true, backslashEscapes: false })
            push('quoted', start, index)
            continue
        }

        if (character === '`') {
            const start = index
            index = scanQuoted(source, start, '`', { doubledQuote: true, backslashEscapes: false })
            push('quoted', start, index)
            continue
        }

        // [ ... ]：SQL Server 的引号标识符；Postgres 的空数组 `[]` 是两个标点。
        if (character === '[') {
            if (source[index + 1] === ']') {
                push('punct', index, index + 1)
                index += 1
                continue
            }
            const start = index
            index = scanQuoted(source, start, ']', { doubledQuote: true, backslashEscapes: false })
            push('quoted', start, index)
            continue
        }

        if (DIGIT.test(character) || (character === '.' && DIGIT.test(source[index + 1] ?? ''))) {
            const start = index
            index = scanNumber(source, start)
            push('number', start, index)
            continue
        }

        if (WORD_START.test(character)) {
            const start = index
            index += 1
            while (index < length && WORD_PART.test(source[index])) index += 1
            push('word', start, index)
            continue
        }

        if (character === '(') {
            push('punct', index, index + 1, depth)
            depth += 1
            index += 1
            continue
        }

        if (character === ')') {
            depth = Math.max(0, depth - 1)
            push('punct', index, index + 1, depth)
            index += 1
            continue
        }

        if (PUNCTUATION.has(character)) {
            push('punct', index, index + 1)
            index += 1
            continue
        }

        const multi = MULTI_CHAR_OPERATORS.find((operator) => source.startsWith(operator, index))
        if (multi) {
            push('operator', index, index + multi.length)
            index += multi.length
            continue
        }

        push('operator', index, index + 1)
        index += 1
    }

    return tokens
}

/**
 * 一段 SQL 语句在源码里的范围与 token 下标（token 下标左闭右开）。
 *
 * @typedef {object} SqlStatementRange
 * @property {number} start 语句起点：上一条语句分号之后（含它前面的注释与空白）。
 * @property {number} end 语句终点：本语句分号之后（含分号），没有分号时是最后一个 token 结束。
 * @property {number} firstToken 本语句覆盖的 token 下标。
 * @property {number} lastToken 本语句覆盖的 token 下标。
 */

/**
 * 按顶层分号切语句。
 *
 * 只在 depth === 0 的分号处切：字符串、注释、括号里的分号都属于当前语句。触发器 /
 * 存储过程里的 `BEGIN ... ; ... END` 与 `DELIMITER` 本来也不是 sqlformat 能可靠处理的
 * 输入，这里不额外猜测，保持「按顶层分号」这一条简单规则。
 */
export function splitSqlStatements(tokens) {
    const ranges = []
    let firstToken = 0
    let start = 0

    tokens.forEach((token, index) => {
        if (token.kind === 'punct' && token.text === ';' && token.depth === 0) {
            ranges.push({ start, end: token.end, firstToken, lastToken: index + 1 })
            firstToken = index + 1
            start = token.end
        }
    })

    // 最后一段没有分号：到最后一个 token 结束，缺失的分号不会被凭空补上。
    const end = tokens.length > 0 ? tokens[tokens.length - 1].end : start
    ranges.push({ start, end, firstToken, lastToken: tokens.length })
    return ranges
}
