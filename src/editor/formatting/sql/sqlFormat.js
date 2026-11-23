/**
 * Ported from Quillip's `src/editor/sqlFormat.ts` (TypeScript) to plain
 * JavaScript, with no behaviour change.
 *
 * This module formats SQL text. `CREATE TABLE` statements are laid out by this
 * file: column name / type / attributes get aligned into a table (per
 * ALIGN_ORDER) so the DDL reads as a grid. Every other statement — and any
 * `CREATE TABLE` whose structure it cannot decide safely — is handed back to
 * the injected sql_fmt fallback formatter (`baseFormatter`).
 */

/**
 * SQL 格式化：`CREATE TABLE` 按元素对齐，其余语句交给随包分发的 sql_fmt。
 *
 * 为什么只做 DDL 对齐：@wasm-fmt/sql_fmt 基于 Rust 的 sqlformat，通用方言下会把
 * MySQL 的 `SET ('a', 'b')` 当成语句子句拆成多行，也不会把列名、类型、约束、注释排成
 * 一张表。DBX 的做法是 sql-formatter 解析 + 自己的 layout printer，其中 `CREATE TABLE`
 * 走单独的列对齐（`layout/ddl.ts`、`ddlDisplay.ts` 的 alignDdlColumnDefinitions）。
 * 这里按同样的思路做一个窄版本：只接管能确定结构的 `CREATE TABLE`，其它语句原样回到
 * sql_fmt，避免在拿不准的地方猜 SQL。
 *
 * 对齐规则（整张表统一）：
 *  - 列名、类型左对齐补空格；
 *  - 属性（NULL / NOT NULL、DEFAULT、AUTO_INCREMENT、ON UPDATE、COMMENT …）按属性
 *    起始列对齐；
 *  - 列定义之间的注释照原位置输出，但不再切分对齐宽度：同一张表的每个字段落在同一
 *    组列上，否则 `-- ===== 整数 =====` 这类分节会让上下两段的 NOT NULL / DEFAULT
 *    错开，看起来像没对齐；
 *  - COMMENT 列按「不含 GENERATED 表达式的行」计算宽度：表达式的长度不可控，让它参与
 *    会把整张表的注释列推得很远，而超长行保持原样、短行仍对齐到该列。
 *
 * 失败即回退：结构不像 `CREATE TABLE`、列定义里有行注释、`CREATE TABLE ... AS SELECT`
 * 等拿不准的情况一律返回 null，由调用方用 sql_fmt 的原有结果，绝不半猜半排。
 */
import { isWord, splitSqlStatements, tokenizeSql, wordUpper } from "./sqlLexer.js"

/**
 * @typedef {object} SqlFormatOptions
 * @property {number} [indent] 缩进宽度（空格数）；默认 2。
 * @property {boolean} [useTabs] 用 tab 缩进（对齐用的补空格仍是空格，和 DBX 的 Writer 一致）。
 */

/**
 * 非 DDL 语句的兜底格式化器（worker 里是 sql_fmt）。
 *
 * @typedef {(source: string) => Promise<string>} SqlBaseFormatter
 */

const DEFAULT_INDENT = 2

/* ------------------------------------------------------------ 内联渲染 --- */

/** `(` 前要空一格的关键字：属性值、子句、约束的开始，而不是函数/类型参数。 */
const SPACE_BEFORE_PAREN = new Set([
    'AS',
    'CHECK',
    'DEFAULT',
    'EXISTS',
    'FROM',
    'IN',
    'INDEX',
    'INTO',
    'JOIN',
    'KEY',
    'LIKE',
    'NOT',
    'ON',
    'PARTITION',
    'PRIMARY',
    'RANGE',
    'LIST',
    'HASH',
    'THAN',
    'REFERENCES',
    'SELECT',
    'THEN',
    'ELSE',
    'WHEN',
    'UNION',
    'UNIQUE',
    'USING',
    'VALUES',
    'WHERE',
    'WITH',
    'AND',
    'OR',
    'ALL',
    'ANY',
    'SOME',
    'BETWEEN',
    'IS',
])

/** 两侧都不加空格的运算符：类型转换、JSON 取值。 */
const TIGHT_OPERATORS = new Set(['::', '->', '->>'])

/** 这些关键字后面的 `+ - ! ~` 是一元符号（表达式开头），不是二元运算符。 */
const EXPRESSION_KEYWORDS = new Set([
    'AS',
    'AND',
    'BETWEEN',
    'BY',
    'DEFAULT',
    'ELSE',
    'IN',
    'IS',
    'LIKE',
    'NOT',
    'ON',
    'OR',
    'RETURN',
    'SET',
    'THEN',
    'VALUES',
    'WHEN',
    'WHERE',
])

/** 位/十六进制/字符集前缀：`b'0'`、`x'1F'`、`_utf8mb4'中文'` 要贴在一起。 */
const LITERAL_PREFIX = /^(?:[bBxXnN]|_[A-Za-z0-9]+)$/u

function isUnaryOperator(token, previous) {
    if (token.kind !== 'operator') return false
    if (!['+', '-', '!', '~'].includes(token.text)) return false
    if (!previous) return true
    if (previous.kind === 'operator') return true
    if (previous.kind === 'punct') return ['(', ',', '['].includes(previous.text)
    if (previous.kind === 'word') return EXPRESSION_KEYWORDS.has(wordUpper(previous))
    return false
}

function shouldSpace(previous, previousPrevious, current, previousWasUnary) {
    if (previousWasUnary) return false

    if (current.kind === 'punct') {
        switch (current.text) {
            case ',':
            case ';':
            case '.':
            case ')':
            case ']':
            case '[':
                return false
            case '(':
                if (previous.kind === 'word') {
                    if (SPACE_BEFORE_PAREN.has(wordUpper(previous))) return true
                    // `UNIQUE KEY uk (col)`：索引名不是关键字，靠前一个词判断。
                    return previousPrevious?.kind === 'word' && ['KEY', 'INDEX', 'REFERENCES'].includes(wordUpper(previousPrevious))
                }
                // `UNIQUE KEY \`uk\` (col)` / `REFERENCES t (id)`：引号名字后面跟列清单要空格。
                if (previous.kind === 'quoted') {
                    return previousPrevious?.kind === 'word' && ['KEY', 'INDEX', 'REFERENCES'].includes(wordUpper(previousPrevious))
                }
                return true
            default:
                return true
        }
    }

    if (current.kind === 'quoted' && current.text.startsWith('[')) {
        // `[dbo].[users]` 是 SQL Server 引号标识符，`arr[1]` 是 Postgres 下标：
        // 方括号里是纯数字/运算符时当下标贴住前一个值，否则按普通标识符留空格。
        const subscriptLike = /^\[[^A-Za-z_\u0080-\uffff\s]*\]$/u.test(current.text)
        if (previous.kind === 'punct') return previous.text !== '(' && previous.text !== '[' && previous.text !== '.'
        if (previous.kind === 'word' || previous.kind === 'quoted') return !subscriptLike
        return true
    }

    if (previous.kind === 'punct') {
        switch (previous.text) {
            case '(':
            case '[':
            case '.':
                return false
            default:
                return true
        }
    }

    if (current.kind === 'operator') return !TIGHT_OPERATORS.has(current.text)
    if (previous.kind === 'operator') return !TIGHT_OPERATORS.has(previous.text)

    if (previous.kind === 'word' && current.kind === 'string' && LITERAL_PREFIX.test(previous.text)) return false

    return true
}

/** 把一段 token 直接排成一行：只归一化空白，不进任何换行。 */
function renderInline(tokens) {
    let result = ''
    let previous
    let previousPrevious
    let previousWasUnary = false
    for (const token of tokens) {
        if (previous && shouldSpace(previous, previousPrevious, token, previousWasUnary)) result += ' '
        result += token.text
        previousWasUnary = isUnaryOperator(token, previous)
        previousPrevious = previous
        previous = token
    }
    return result.trimEnd()
}

/* -------------------------------------------------------- 列定义切分 --- */

/**
 * @typedef {'nullable' | 'default' | 'auto' | 'generated' | 'onUpdate' | 'key' | 'collate' | 'charset' | 'references' | 'check' | 'comment' | 'other'} AttributeSlot
 */

/**
 * 属性的对齐顺序：大致按 MySQL 列定义里出现的先后排，前面的属性先对齐，后面的
 * 再按当前列宽补空格，这样「缺一个属性」的行也能落到同一列上。
 */
const ALIGN_ORDER = [
    'nullable',
    'collate',
    'charset',
    'default',
    'auto',
    'generated',
    'onUpdate',
    'references',
    'check',
    'key',
    'other',
    'comment',
]

/** 会开启一段属性文本的单词（类型扫描遇到它就停）。 */
const ATTRIBUTE_STARTERS = new Set([
    'AS',
    'AUTO_INCREMENT',
    'AUTOINCREMENT',
    'CHARACTER',
    'CHARSET',
    'CHECK',
    'COLLATE',
    'COLUMN_FORMAT',
    'COMMENT',
    'COMPRESSION',
    'CONSTRAINT',
    'DEFAULT',
    'DEFERRABLE',
    'ENCRYPTED',
    'FOREIGN',
    'GENERATED',
    'IDENTITY',
    'INDEX',
    'INITIALLY',
    'INVISIBLE',
    'KEY',
    'NOT',
    'NULL',
    'ON',
    'PRIMARY',
    'REFERENCES',
    'SRID',
    'STORAGE',
    'STORED',
    'PERSISTENT',
    'UNIQUE',
    'VIRTUAL',
    'VISIBLE',
])

/** 列定义列表里以这些词开头的项是表级约束，不是列。 */
const CONSTRAINT_STARTERS = new Set([
    'CHECK',
    'CONSTRAINT',
    'EXCLUDE',
    'FOREIGN',
    'FULLTEXT',
    'INDEX',
    'KEY',
    'LIKE',
    'PERIOD',
    'PRIMARY',
    'SPATIAL',
    'UNIQUE',
])

/**
 * @typedef {object} AttributeSegment
 * @property {AttributeSlot} slot
 * @property {string} text
 * @property {number} pad 对齐补的空格数（1 个分隔空格之外额外加的）。
 */

/**
 * @typedef {object} ColumnLayout
 * @property {string} name
 * @property {string} type
 * @property {AttributeSegment[]} segments
 */

/** 括号配对：从 `(` 找到匹配的 `)` 之后，返回下一个下标。 */
function skipParenthesis(tokens, openIndex) {
    let depth = 0
    for (let index = openIndex; index < tokens.length; index += 1) {
        const token = tokens[index]
        if (token.kind !== 'punct') continue
        if (token.text === '(') depth += 1
        else if (token.text === ')') {
            depth -= 1
            if (depth === 0) return index + 1
        }
    }
    return tokens.length
}

/** 读取一个「默认值 / ON UPDATE 目标」表达式，返回结束下标。 */
function consumeValue(tokens, start) {
    let index = start
    while (index < tokens.length && tokens[index].kind === 'operator' && ['+', '-', '!', '~'].includes(tokens[index].text)) {
        index += 1
    }
    if (index >= tokens.length) return index
    const token = tokens[index]
    if (token.kind === 'punct' && token.text === '(') {
        index = skipParenthesis(tokens, index)
    } else if (token.kind === 'word') {
        index += 1
        const next = tokens[index]
        if (next?.kind === 'string' && LITERAL_PREFIX.test(token.text)) index += 1
        else if (next?.kind === 'punct' && next.text === '(') index = skipParenthesis(tokens, index)
    } else {
        index += 1
    }
    // 后缀类型转换：DEFAULT 'x'::text
    while (tokens[index]?.kind === 'operator' && tokens[index].text === '::') {
        index += 1
        while (tokens[index] && (tokens[index].kind === 'word' || tokens[index].kind === 'quoted')) index += 1
    }
    return index
}

function consumeGenerated(tokens, start) {
    let index = start + 1
    if (isWord(tokens[index], 'ALWAYS')) index += 1
    if (isWord(tokens[index], 'AS')) index += 1
    if (tokens[index]?.kind === 'punct' && tokens[index].text === '(') index = skipParenthesis(tokens, index)
    if (isWord(tokens[index], 'VIRTUAL') || isWord(tokens[index], 'STORED') || isWord(tokens[index], 'PERSISTENT')) index += 1
    return index
}

function consumeAsGenerated(tokens, start) {
    let index = start + 1
    if (tokens[index]?.kind === 'punct' && tokens[index].text === '(') index = skipParenthesis(tokens, index)
    if (isWord(tokens[index], 'VIRTUAL') || isWord(tokens[index], 'STORED') || isWord(tokens[index], 'PERSISTENT')) index += 1
    return index
}

function consumePrimaryKey(tokens, start) {
    let index = start + 1
    if (isWord(tokens[index], 'KEY')) index += 1
    if (isWord(tokens[index], 'CLUSTERED') || isWord(tokens[index], 'NONCLUSTERED')) index += 1
    return index
}

function consumeReferences(tokens, start) {
    let index = start + 1
    while (index < tokens.length) {
        const token = tokens[index]
        if (token.kind === 'punct' && token.text === '.') {
            index += 1
            continue
        }
        if (token.kind === 'quoted') {
            index += 1
            continue
        }
        if (token.kind === 'word') {
            const upper = wordUpper(token)
            if (['ON', 'MATCH', 'DEFERRABLE', 'INITIALLY', 'NOT'].includes(upper)) break
            index += 1
            continue
        }
        break
    }
    if (tokens[index]?.kind === 'punct' && tokens[index].text === '(') index = skipParenthesis(tokens, index)
    return index
}

/** 把列定义里类型之后的部分切成属性段。 */
function splitAttributeSegments(tokens) {
    const segments = []
    const push = (slot, start, end) => {
        if (end <= start) return
        const text = renderInline(tokens.slice(start, end))
        if (!text) return
        const last = segments[segments.length - 1]
        if (last && last.slot === slot && slot === 'other') {
            last.text += ` ${text}`
            return
        }
        segments.push({ slot, text, pad: 0 })
    }

    let index = 0
    while (index < tokens.length) {
        const token = tokens[index]
        const upper = wordUpper(token)
        let end = index + 1
        let slot = 'other'

        if (upper === 'NOT' && isWord(tokens[index + 1], 'NULL')) {
            slot = 'nullable'
            end = index + 2
        } else if (upper === 'NULL') {
            slot = 'nullable'
        } else if (upper === 'DEFAULT') {
            slot = 'default'
            end = consumeValue(tokens, index + 1)
        } else if (upper === 'AUTO_INCREMENT' || upper === 'AUTOINCREMENT') {
            slot = 'auto'
        } else if (upper === 'IDENTITY') {
            slot = 'auto'
            if (tokens[index + 1]?.kind === 'punct' && tokens[index + 1].text === '(') end = skipParenthesis(tokens, index + 1)
        } else if (upper === 'ON' && isWord(tokens[index + 1], 'UPDATE')) {
            slot = 'onUpdate'
            end = consumeValue(tokens, index + 2)
        } else if (upper === 'GENERATED') {
            slot = 'generated'
            end = consumeGenerated(tokens, index)
        } else if (upper === 'AS') {
            slot = 'generated'
            end = consumeAsGenerated(tokens, index)
        } else if (upper === 'PRIMARY') {
            slot = 'key'
            end = consumePrimaryKey(tokens, index)
        } else if (upper === 'UNIQUE') {
            slot = 'key'
            end = isWord(tokens[index + 1], 'KEY') || isWord(tokens[index + 1], 'INDEX') ? index + 2 : index + 1
        } else if (upper === 'KEY' || upper === 'INDEX') {
            slot = 'key'
        } else if (upper === 'REFERENCES') {
            slot = 'references'
            end = consumeReferences(tokens, index)
        } else if (upper === 'CHECK') {
            slot = 'check'
            if (tokens[index + 1]?.kind === 'punct' && tokens[index + 1].text === '(') end = skipParenthesis(tokens, index + 1)
        } else if (upper === 'COMMENT') {
            slot = 'comment'
            end = index + 2
        } else if (upper === 'COLLATE') {
            slot = 'collate'
            end = index + 2
        } else if (upper === 'CHARACTER' && (isWord(tokens[index + 1], 'SET') || isWord(tokens[index + 1], 'CHARSET'))) {
            slot = 'charset'
            end = index + 3
        } else if (upper === 'CHARSET') {
            slot = 'charset'
            end = index + 2
        } else if (['SRID', 'COLUMN_FORMAT', 'STORAGE', 'COMPRESSION', 'CONSTRAINT'].includes(upper)) {
            slot = 'other'
            end = index + 2
        }

        end = Math.min(Math.max(end, index + 1), tokens.length)
        push(slot, index, end)
        index = end
    }

    return segments
}

/**
 * 解析一条列定义：列名 + 类型 + 属性段；结构不像普通列时返回 null。
 *
 * 「像普通列」的判断尽量窄：第一个 token 是标识符，第二个 token 不是属性关键字
 * （SQL Server 的 `[x] AS (...)` 计算列于是落到 inline 分支），类型至少有一个词。
 */
function parseColumnDefinition(tokens) {
    const name = tokens[0]
    if (!name || (name.kind !== 'word' && name.kind !== 'quoted')) return null
    if (name.kind === 'word' && CONSTRAINT_STARTERS.has(wordUpper(name))) return null

    const second = tokens[1]
    if (!second) return null
    if (second.kind !== 'word') return null
    if (ATTRIBUTE_STARTERS.has(wordUpper(second))) {
        // CHARACTER VARYING / CHARACTER SET 的分界靠后一个词判断。
        const isCharacterType = wordUpper(second) === 'CHARACTER' && !isWord(tokens[2], 'SET') && !isWord(tokens[2], 'CHARSET')
        if (!isCharacterType) return null
    }

    const typeTokens = []
    let index = 1
    while (index < tokens.length) {
        const token = tokens[index]
        if (token.kind === 'punct' && token.text === '(' && typeTokens.length > 0) {
            const end = skipParenthesis(tokens, index)
            typeTokens.push(...tokens.slice(index, end))
            index = end
            continue
        }
        if (token.kind === 'punct' && (token.text === '[' || token.text === ']') && typeTokens.length > 0) {
            typeTokens.push(token)
            index += 1
            continue
        }
        if (token.kind === 'word') {
            const upper = wordUpper(token)
            if (typeTokens.length === 0) {
                typeTokens.push(token)
                index += 1
                continue
            }
            if (ATTRIBUTE_STARTERS.has(upper)) {
                const isCharacterSet =
                    upper === 'CHARACTER' && (isWord(tokens[index + 1], 'SET') || isWord(tokens[index + 1], 'CHARSET'))
                if (!isCharacterSet) break
            }
            typeTokens.push(token)
            index += 1
            continue
        }
        break
    }

    const type = renderInline(typeTokens)
    if (!type) return null

    return {
        name: renderInline([name]),
        type,
        segments: splitAttributeSegments(tokens.slice(index)),
    }
}

/* ---------------------------------------------------------- CREATE TABLE --- */

/**
 * @typedef {object} CommentItem
 * @property {'comment'} kind
 * @property {string} text
 */

/**
 * @typedef {object} InlineItem
 * @property {'inline'} kind
 * @property {string} text
 * @property {boolean} commaAfter
 * @property {string} trailing
 */

/**
 * @typedef {object} ColumnItem
 * @property {'column'} kind
 * @property {ColumnLayout} layout
 * @property {boolean} commaAfter
 * @property {string} trailing
 */

/**
 * @typedef {CommentItem | InlineItem | ColumnItem} TableItem
 */

/**
 * @typedef {object} RawEntry
 * @property {'tokens' | 'comment'} kind
 * @property {object[]} tokens
 * @property {object[]} trailing
 * @property {boolean} commaAfter
 */

function countNewlines(text) {
    let count = 0
    for (const character of text) if (character === '\n') count += 1
    return count
}

function isCommentToken(token) {
    return token.kind === 'lineComment' || token.kind === 'blockComment'
}

/** CREATE 之后允许出现、但仍算普通建表的前缀词。 */
const CREATE_TABLE_MODIFIERS = new Set(['OR', 'REPLACE', 'TEMPORARY', 'TEMP', 'GLOBAL', 'LOCAL', 'UNLOGGED', 'TRANSIENT', 'VOLATILE'])

/**
 * 判断 `tokens[start]` 起是不是 `CREATE [OR REPLACE] [TEMPORARY] ... TABLE`，
 * 是则返回 TABLE 之后的下标，否则返回 -1。
 */
function createTableKeywordEnd(tokens, start) {
    let index = start
    if (!isWord(tokens[index], 'CREATE')) return -1
    index += 1
    while (isWord(tokens[index]) && CREATE_TABLE_MODIFIERS.has(wordUpper(tokens[index]))) index += 1
    return isWord(tokens[index], 'TABLE') ? index + 1 : -1
}

function startsWithCreateTable(tokens) {
    let index = 0
    while (index < tokens.length && isCommentToken(tokens[index])) index += 1
    return createTableKeywordEnd(tokens, index) >= 0
}

/** 表定义列表按顶层逗号拆条目，并保留行注释。 */
function splitDefinitionEntries(bodyTokens, source, bodyDepth) {
    const entries = []
    let current = []
    let previous

    const flush = (commaAfter) => {
        if (current.length === 0) return
        entries.push({ kind: 'tokens', tokens: current, trailing: [], commaAfter })
        current = []
    }

    for (let tokenIndex = 0; tokenIndex < bodyTokens.length; tokenIndex += 1) {
        const token = bodyTokens[tokenIndex]
        if (isCommentToken(token)) {
            const ownLine = previous ? countNewlines(source.slice(previous.end, token.start)) > 0 : true
            if (current.length > 0) {
                if (token.kind === 'lineComment') {
                    // 行注释会吞掉本行剩余内容：只有它是这条定义的结尾（后面只剩逗号 / 结束）
                    // 才能安全地当尾部注释，否则后面的 token 需要换行，交回给 sql_fmt。
                    const next = bodyTokens.slice(tokenIndex + 1).find((candidate) => !isCommentToken(candidate))
                    const closesDefinition = next === undefined || (next.kind === 'punct' && next.text === ',' && next.depth === bodyDepth)
                    if (!closesDefinition) return null
                    entries.push({ kind: 'tokens', tokens: current, trailing: [token], commaAfter: false })
                    current = []
                    previous = token
                    continue
                }
                current.push(token)
            } else if (!ownLine && entries.length > 0) {
                // 逗号同一行后面的注释跟着上一条定义走，不单独占一行。
                entries[entries.length - 1].trailing.push(token)
            } else {
                entries.push({ kind: 'comment', tokens: [token], trailing: [], commaAfter: false })
            }
            previous = token
            continue
        }

        if (token.kind === 'punct' && token.text === ',' && token.depth === bodyDepth) {
            if (current.length === 0) {
                const last = entries[entries.length - 1]
                if (last && last.kind === 'tokens') last.commaAfter = true
            } else {
                flush(true)
            }
            previous = token
            continue
        }

        current.push(token)
        previous = token
    }

    flush(false)
    return entries
}

/** 渲染整张表的列：所有列共享列宽，注释与不认识的条目按原顺序插在中间。 */
function renderColumnGroup(group) {
    const lines = []
    const columns = group.filter((item) => item.kind === 'column')
    if (group.length === 0) return lines

    const nameWidth = Math.max(0, ...columns.map((item) => item.layout.name.length))
    const typeWidth = Math.max(0, ...columns.map((item) => item.layout.type.length))

    const startColumn = (layout, segmentIndex) => {
        let position = nameWidth + 1 + typeWidth
        for (let index = 0; index < segmentIndex; index += 1) {
            position += 1 + layout.segments[index].pad + layout.segments[index].text.length
        }
        return position + 1 + layout.segments[segmentIndex].pad
    }

    for (const slot of ALIGN_ORDER) {
        const rows = columns
            .map((item) => ({ item, index: item.layout.segments.findIndex((segment) => segment.slot === slot) }))
            .filter((entry) => entry.index >= 0)

        // COMMENT 的目标列不拿 GENERATED 表达式行的宽度来算：表达式长度不可控，
        // 让它参与会把整张表的注释列推得很远。但短行仍对齐到该列，只有超长的行保持原样。
        const measured =
            slot === 'comment'
                ? rows.filter(
                    (entry) =>
                        !entry.item.layout.segments.slice(0, entry.index).some((segment) => segment.slot === 'generated'),
                )
                : rows
        if (measured.length < 2) continue

        const starts = measured.map(({ item, index }) => startColumn(item.layout, index))
        const target = Math.max(...starts)
        for (const entry of slot === 'comment' ? rows : measured) {
            const start = startColumn(entry.item.layout, entry.index)
            if (start < target) entry.item.layout.segments[entry.index].pad += target - start
        }
    }

    for (const item of group) {
        if (item.kind === 'comment') {
            lines.push(item.text)
            continue
        }
        let line
        if (item.kind === 'column') {
            line = item.layout.name.padEnd(nameWidth) + ' ' + item.layout.type.padEnd(typeWidth)
            for (const segment of item.layout.segments) line += ' '.repeat(1 + segment.pad) + segment.text
        } else {
            line = item.text
        }
        line = line.trimEnd()
        if (item.commaAfter) line += ','
        if (item.trailing) line += ' ' + item.trailing
        lines.push(line)
    }
    return lines
}

/** 渲染一个 `CREATE TABLE` 语句；拿不准时返回 null。 */
function renderCreateTableStatement(statementTokens, source, options) {
    let firstSignificant = 0
    while (firstSignificant < statementTokens.length && isCommentToken(statementTokens[firstSignificant])) {
        firstSignificant += 1
    }
    if (firstSignificant >= statementTokens.length) return null

    const tableKeywordEnd = createTableKeywordEnd(statementTokens, firstSignificant)
    if (tableKeywordEnd < 0) return null
    let cursor = tableKeywordEnd
    if (isWord(statementTokens[cursor], 'IF') && isWord(statementTokens[cursor + 1], 'NOT') && isWord(statementTokens[cursor + 2], 'EXISTS')) {
        cursor += 3
    }

    // 表名（可带 schema 限定）之后必须紧跟列定义括号；`... AS SELECT` 直接放弃。
    let openIndex = -1
    for (let index = cursor; index < statementTokens.length; index += 1) {
        const token = statementTokens[index]
        if (token.kind === 'lineComment') return null
        if (token.kind === 'punct' && token.text === ';' && token.depth === 0) return null
        if (isWord(token, 'AS')) return null
        if (token.kind === 'punct' && token.text === '(' && token.depth === 0) {
            openIndex = index
            break
        }
    }
    if (openIndex < 0) return null

    const openDepth = statementTokens[openIndex].depth
    let closeIndex = -1
    for (let index = openIndex + 1; index < statementTokens.length; index += 1) {
        const token = statementTokens[index]
        if (token.kind === 'punct' && token.text === ')' && token.depth === openDepth) {
            closeIndex = index
            break
        }
    }
    if (closeIndex < 0) return null

    const bodyTokens = statementTokens.slice(openIndex + 1, closeIndex)
    if (bodyTokens.length === 0) return null

    const entries = splitDefinitionEntries(bodyTokens, source, openDepth + 1)
    if (!entries) return null

    // 表选项：` ) ENGINE = ...；` 保持一行；行注释只允许出现在末尾。
    const restTokens = statementTokens.slice(closeIndex + 1)
    let hasSemicolon = false
    const restComments = []
    const restInline = []
    let seenLineComment = false
    for (const token of restTokens) {
        if (token.kind === 'punct' && token.text === ';' && token.depth === 0) {
            hasSemicolon = true
            continue
        }
        if (token.kind === 'lineComment') {
            seenLineComment = true
            restComments.push(token)
            continue
        }
        if (seenLineComment) return null
        restInline.push(token)
    }

    const items = []
    for (const entry of entries) {
        if (entry.kind === 'comment') {
            const token = entry.tokens[0]
            items.push({ kind: 'comment', text: token.text.trim() })
            continue
        }
        const trailing = entry.trailing.length > 0 ? renderInline(entry.trailing) : ''
        const layout = parseColumnDefinition(entry.tokens)
        if (!layout) {
            items.push({ kind: 'inline', text: renderInline(entry.tokens), commaAfter: entry.commaAfter, trailing })
            continue
        }
        items.push({ kind: 'column', layout, commaAfter: entry.commaAfter, trailing })
    }

    // 表名前的注释：保留注释之间的空行，避免格式化把用户的分段抹平。
    const headerLines = []
    let previousEnd = -1
    for (let index = 0; index < firstSignificant; index += 1) {
        const token = statementTokens[index]
        if (previousEnd >= 0 && countNewlines(source.slice(previousEnd, token.start)) >= 2) headerLines.push('')
        headerLines.push(token.text.trim())
        previousEnd = token.end
    }
    if (previousEnd >= 0 && countNewlines(source.slice(previousEnd, statementTokens[firstSignificant].start)) >= 2) {
        headerLines.push('')
    }

    const indentUnit = options.useTabs ? '\t' : ' '.repeat(options.indent)
    const header = renderInline(statementTokens.slice(firstSignificant, openIndex))
    if (!header) return null

    const bodyLines = renderColumnGroup(items).map((line) => (line.length > 0 ? indentUnit + line : line))

    const closing = `)${restInline.length > 0 ? ' ' + renderInline(restInline) : ''}${hasSemicolon ? ';' : ''}`
    const lines = [...headerLines, `${header} (`, ...bodyLines, closing, ...restComments.map((token) => token.text.trim())]
    return lines.join('\n')
}

/* --------------------------------------------------------------- 入口 --- */

/**
 * 兜底格式化器跑到不动点。
 *
 * sql_fmt 对 `INSERT/REPLACE ... VALUES(...)`（VALUES 与括号之间没有空格）第一遍
 * 输出 `values\n(1, 2)`，第二遍才补成 `values\n  (1, 2)`；直接返回会让「格式化
 * 两次」产生第二次改动和额外的撤销步。其它语句一遍就稳定，所以这里最多再跑两遍，
 * 既返回稳定输出，也避免异常输入让引擎来回震荡。
 */
async function stabilizeBase(baseFormatter, source) {
    let printed = await baseFormatter(source)
    for (let pass = 0; pass < 2; pass += 1) {
        const next = await baseFormatter(printed)
        if (next === printed) return printed
        printed = next
    }
    return printed
}

/**
 * SQL 格式化入口。
 *
 * 没有任何 `CREATE TABLE` 时整段交给 sql_fmt（并跑到不动点），普通查询的现有输出
 * 不变；有 DDL 时逐条语句处理：能接管的走对齐渲染，其余仍然交给 sql_fmt。
 * 语句之间的空行按输入保留（最多一个空行）。
 */
export async function formatSqlText(source, options, baseFormatter) {
    const tokens = tokenizeSql(source)
    if (tokens.length === 0) return source
    const ranges = splitSqlStatements(tokens)
    // 没有需要接管的 DDL 时整段交给兜底格式化器，普通查询的现有输出不变。
    if (!ranges.some((range) => startsWithCreateTable(tokens.slice(range.firstToken, range.lastToken)))) {
        return stabilizeBase(baseFormatter, source)
    }

    const resolved = {
        indent: options.indent && options.indent > 0 ? options.indent : DEFAULT_INDENT,
        useTabs: options.useTabs === true,
    }

    const pieces = []
    for (const range of ranges) {
        if (range.lastToken <= range.firstToken) continue
        const chunkTokens = tokens.slice(range.firstToken, range.lastToken)
        const chunkText = source.slice(range.start, range.end)
        const leadingWhitespace = source.slice(range.start, chunkTokens[0].start)

        let formatted
        const ddl = renderCreateTableStatement(chunkTokens, source, resolved)
        if (ddl !== null) {
            formatted = ddl
        } else if (chunkTokens.every(isCommentToken)) {
            // 纯注释块没有可格式化的语句，原样保留。
            formatted = chunkText.trim()
        } else {
            formatted = (await stabilizeBase(baseFormatter, chunkText.trim())).trim()
        }
        if (!formatted) continue
        pieces.push({ text: formatted, leadingNewlines: countNewlines(leadingWhitespace) })
    }

    if (pieces.length === 0) return ''
    return pieces
        .map((piece, index) => {
            if (index === 0) return piece.text
            return (piece.leadingNewlines >= 2 ? '\n\n' : '\n') + piece.text
        })
        .join('')
}
