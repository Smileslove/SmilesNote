/**
 * GraphQL syntax highlighting.
 *
 * This is a finite lexer for colouring only. It recognises GraphQL's lexical
 * tokens (names, variables, directives, strings, block strings, numbers,
 * comments and punctuation) and maps them onto @lezer/highlight tags. It is NOT
 * a GraphQL parser or validator: malformed or unfamiliar input falls back to
 * plain text, and the emitted tree carries no grammar structure for folding,
 * completion or schema checks.
 *
 * The project deliberately has no @codemirror/lang-graphql / @lezer/graphql
 * dependency, so this uses StreamLanguage (already used by the legacy modes)
 * rather than adding a third-party parser.
 *
 * Known limit: blocks longer than the highlight window (>20k chars) parse only
 * the visible slice. A window that starts inside a triple-quoted block string
 * cannot know that, so its contents colour as code until the closing `"""`.
 */
import { LanguageSupport, StreamLanguage, type StringStream } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

interface GraphQLState {
  /** A triple-quoted block string continues onto the next line. */
  inBlockString: boolean
  /** The next name is a type name (after type/on/implements/&/|). */
  expectTypeName: boolean
  /** The next name is an operation or fragment name (after query/fragment). */
  expectDefinitionName: boolean
  /** The next name is in type position (`: [User!]!`), resolved by casing. */
  typePosition: boolean
  /** Selection sets and SDL bodies live at depth >= 1. */
  braceDepth: number
  /** `implements A, B` keeps type position across commas. */
  implementsList: boolean
}

/**
 * GraphQL's contextual keywords. They are highlighted wherever they appear;
 * the grammar's context-sensitivity is intentionally not modelled.
 */
const KEYWORDS = new Set([
  'query',
  'mutation',
  'subscription',
  'fragment',
  'on',
  'type',
  'interface',
  'union',
  'enum',
  'input',
  'schema',
  'scalar',
  'extend',
  'implements',
  'directive',
  'repeatable',
])

/** Keywords followed by a user-defined type name. */
const TYPE_NAME_KEYWORDS = new Set([
  'type',
  'interface',
  'union',
  'enum',
  'input',
  'schema',
  'scalar',
  'extend',
  'implements',
  'on',
  'directive',
])

/** Keywords followed by an operation or fragment name. */
const DEFINITION_NAME_KEYWORDS = new Set(['query', 'mutation', 'subscription', 'fragment'])

const BUILTIN_SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID'])

const NAME_START = /^[_A-Za-z]/
const NAME_CONTINUE = /[_0-9A-Za-z]/
const NAME = /^[_A-Za-z][_0-9A-Za-z]*/
// `123abc` is invalid GraphQL: do not split it into a number plus a name.
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![_0-9A-Za-z.])/

/**
 * Token name → tag mapping. Keeping the names readable here (instead of
 * returning tag names directly) lets the lexer separate, say, a string from a
 * block string while the theme keeps styling ordinary string tokens.
 */
const tokenTable = {
  graphqlComment: t.comment,
  graphqlString: t.string,
  graphqlBlockString: t.special(t.string),
  graphqlNumber: t.number,
  graphqlBoolean: t.bool,
  graphqlNull: t.null,
  graphqlVariable: t.constant(t.variableName),
  graphqlDirective: t.meta,
  graphqlKeyword: t.keyword,
  graphqlBuiltinScalar: t.standard(t.typeName),
  graphqlTypeName: t.typeName,
  graphqlEnumValue: t.constant(t.variableName),
  graphqlDefinitionName: t.definition(t.variableName),
  graphqlPropertyName: t.propertyName,
  graphqlBracket: t.bracket,
  graphqlPunctuation: t.punctuation,
}

/**
 * Consume a single-line string starting at its opening quote.
 *
 * GraphQL forbids raw newlines inside normal strings, so an unterminated string
 * simply ends at the line break instead of leaking colour onto later lines.
 */
function readQuotedString(stream: StringStream): void {
  stream.next()
  while (!stream.eol()) {
    const char = stream.next()
    if (char === '\\') {
      if (!stream.eol()) stream.next()
      continue
    }
    if (char === '"') return
  }
}

/**
 * Consume the remainder of a block string on the current line.
 *
 * A closing unescaped `"""` ends the state; otherwise the state survives the
 * newline and the next line continues in the same block-string token. Escaped
 * quotes (`\"""`) do not close the string.
 */
function readBlockStringRemainder(
  stream: StringStream,
  state: GraphQLState,
): void {
  while (!stream.eol()) {
    const char = stream.next()
    if (char === '\\') {
      if (!stream.eol()) stream.next()
      continue
    }
    if (char === '"' && stream.peek() === '"' && stream.string[stream.pos + 1] === '"') {
      stream.pos += 2
      state.inBlockString = false
      return
    }
  }
}

/**
 * Classify one name token.
 *
 * GraphQL keywords are contextual: `type` is a definition keyword at the top
 * level but an ordinary field name inside a selection set. `on` and
 * `implements` introduce type names at any depth. Type positions after a colon
 * are resolved by GraphQL's naming convention (types are PascalCase, fields are
 * not), because a bare `:` is also a field alias or argument separator.
 */
function classifyName(word: string, state: GraphQLState): string {
  if (word === 'true' || word === 'false' || word === 'null') {
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    return word === 'null' ? 'graphqlNull' : 'graphqlBoolean'
  }

  if (BUILTIN_SCALARS.has(word)) {
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    return 'graphqlBuiltinScalar'
  }

  const inSelectionOrBody = state.braceDepth >= 1
  const isContextualKeyword = word === 'on' || word === 'implements'
  if (KEYWORDS.has(word) && (!inSelectionOrBody || isContextualKeyword)) {
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    if (word === 'on' || word === 'implements') {
      state.expectTypeName = true
      state.implementsList = word === 'implements'
    } else if (DEFINITION_NAME_KEYWORDS.has(word)) {
      state.expectDefinitionName = true
    } else if (TYPE_NAME_KEYWORDS.has(word)) {
      state.expectTypeName = true
    }
    return 'graphqlKeyword'
  }

  if (state.expectDefinitionName) {
    state.expectDefinitionName = false
    return 'graphqlDefinitionName'
  }
  if (state.expectTypeName) {
    state.expectTypeName = false
    return 'graphqlTypeName'
  }

  const wasTypePosition = state.typePosition
  state.typePosition = false
  if (wasTypePosition) {
    // GraphQL types are PascalCase; enum values and constants are SCREAMING_CASE.
    if (/^[A-Z][A-Z0-9_]*$/u.test(word)) return 'graphqlEnumValue'
    if (/^[A-Z]/u.test(word)) return 'graphqlTypeName'
  }
  // Field, argument, alias, enum value and object-value names are the common
  // case. Without a grammar this is a heuristic, not validated syntax.
  return 'graphqlPropertyName'
}

/** Tokenizer for one line; block-string state is carried across lines. */
function token(stream: StringStream, state: GraphQLState): string | null {
  if (state.inBlockString) {
    readBlockStringRemainder(stream, state)
    return 'graphqlBlockString'
  }
  if (stream.eatSpace()) return null

  const char = stream.peek()
  if (char === undefined) return null

  if (char === '#') {
    stream.skipToEnd()
    return 'graphqlComment'
  }

  if (char === '"') {
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    if (stream.match('"""')) {
      state.inBlockString = true
      readBlockStringRemainder(stream, state)
      return 'graphqlBlockString'
    }
    readQuotedString(stream)
    return 'graphqlString'
  }

  if (char === '$') {
    stream.next()
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    if (stream.eat(NAME_START)) {
      stream.eatWhile(NAME_CONTINUE)
      return 'graphqlVariable'
    }
    return 'graphqlPunctuation'
  }

  if (char === '@') {
    stream.next()
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    if (stream.eat(NAME_START)) {
      stream.eatWhile(NAME_CONTINUE)
      return 'graphqlDirective'
    }
    return 'graphqlPunctuation'
  }

  if (stream.match(NUMBER)) {
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    return 'graphqlNumber'
  }

  if (NAME_START.test(char)) {
    const word = (stream.match(NAME) as RegExpMatchArray)[0]
    return classifyName(word, state)
  }

  if (char === '.') {
    if (stream.match('...')) return 'graphqlPunctuation'
    stream.next()
    return null
  }

  if (char === '{') {
    stream.next()
    state.braceDepth += 1
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    state.implementsList = false
    return 'graphqlBracket'
  }

  if (char === '}') {
    stream.next()
    state.braceDepth = Math.max(0, state.braceDepth - 1)
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = false
    state.implementsList = false
    return 'graphqlBracket'
  }

  if (char === '[') {
    // A list type keeps the following name in type position: `[User!]!`.
    stream.next()
    state.expectTypeName = false
    state.expectDefinitionName = false
    state.typePosition = true
    return 'graphqlBracket'
  }

  if (char === ']' || char === '!' || char === ')' || char === '(') {
    // `!` and `]` continue a type reference; `(`/`)` end the current position.
    stream.next()
    state.expectTypeName = false
    state.expectDefinitionName = false
    if (char === '(' || char === ')') state.typePosition = false
    return 'graphqlBracket'
  }

  if (char === ':') {
    stream.next()
    state.expectTypeName = false
    state.expectDefinitionName = false
    // `field: Type`, `$var: Type` and `schema { query: Query }`.
    state.typePosition = true
    return 'graphqlPunctuation'
  }

  if (char === '=' || char === '|' || char === '&') {
    stream.next()
    state.expectTypeName = false
    state.expectDefinitionName = false
    // `union U = A | B`, `implements A & B` and default values.
    state.typePosition = true
    return 'graphqlPunctuation'
  }

  if (char === ',') {
    stream.next()
    state.expectDefinitionName = false
    // `implements A, B`: the comma separates type names.
    if (state.implementsList) state.typePosition = true
    return 'graphqlPunctuation'
  }

  // Unknown or invalid input stays plain text.
  stream.next()
  return null
}

const graphqlStreamLanguage = StreamLanguage.define<GraphQLState>({
  name: 'graphql',
  startState: () => ({
    inBlockString: false,
    expectTypeName: false,
    expectDefinitionName: false,
    typePosition: false,
    braceDepth: 0,
    implementsList: false,
  }),
  token,
  tokenTable,
  languageData: {
    commentTokens: { line: '#' },
  },
})

/**
 * GraphQL highlighting support.
 *
 * Wrapped in LanguageSupport because block highlighting reads `.language` and
 * markdown fences need the support object, exactly like the legacy modes.
 */
export function graphql(): LanguageSupport {
  return new LanguageSupport(graphqlStreamLanguage)
}

/** The stream parser, for block highlighting (Language.parser). */
export const graphqlParser = graphqlStreamLanguage.parser
