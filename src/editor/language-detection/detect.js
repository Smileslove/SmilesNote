/**
 * Rule-based language detection.
 *
 * Replaces the previous guesslang (TF.js model) detector. Guessing wrong
 * actively harms editing, so the engine is conservative: a block only changes
 * language when the winner is clearly ahead of the runner-up, and the caller
 * applies additional hysteresis (see `index.js`).
 *
 * Three layers, strongest first:
 *
 *   1. SIGNATURES  — a shebang, `<?php`, `syntax = "proto3"`, a Mermaid header,
 *                    a Lezer annotation. One match settles the question.
 *   2. STRUCTURE   — per-language shape checks (`SELECT ... FROM`, `interface X {`,
 *                    `<template>` + `<script setup>`, ...). This is what actually
 *                    separates similar languages.
 *   3. KEYWORDS / SIGNALS — capped, and only counted when a structure, a code
 *                    shape or a strong literal set supports them. "select" in
 *                    an English sentence is not SQL.
 *
 * The engine is a pure function: no DOM, no worker state, no I/O. That is why it
 * can run in a worker and be unit tested with a plain corpus.
 */
import { SIGNATURES } from "./signatures.js"
import { STRUCTURAL } from "./structural.js"
import { SIGNALS, KEYWORDS } from "./signals.js"
import { hasCompleteFencedBlock, withoutStringLiterals } from "./text-shapes.js"

export const PLAIN_LANGUAGE = "text"

/** Below this score the block keeps its plain-text editing mode. */
export const MIN_CONFIDENCE = 1.5
/** The winner must lead by this much before a language switch is applied. */
export const MIN_MARGIN = 0.7
/** Short snippets are too ambiguous to classify. */
export const MIN_LENGTH = 8
/** A block that already has a language keeps it until it is this long... */
export const MIN_SWITCH_LENGTH = 24
/** ...or until the evidence is this strong. */
export const STRONG_CONFIDENCE = 3.2
/** Bound both analysis and transfer: structure is almost always at the top. */
export const DETECTION_SAMPLE_LIMIT = 16384
/** Signals only need the head of the block to agree. */
const SIGNAL_WINDOW = 512

/** @typedef {{language: string, confidence: number, runnerUp: string|null, stable: boolean}} Detection */

const SIGNATURE_LANGUAGES = new Set(SIGNATURES.map(({ language }) => language))

const CANDIDATE_IDS = Object.freeze(
    [
        ...new Set([
            ...Object.keys(STRUCTURAL),
            ...Object.keys(KEYWORDS),
            ...Object.keys(SIGNALS),
            ...SIGNATURE_LANGUAGES,
        ]),
    ].sort(),
)

/**
 * Languages this engine can detect. Every entry must exist in
 * `src/editor/languages.js`; tests enforce both directions so a language cannot
 * silently become undetectable.
 */
export function detectableLanguages() {
    return [...CANDIDATE_IDS]
}

const CANDIDATES = CANDIDATE_IDS.map((id) => ({
    id,
    signals: SIGNALS[id] ?? [],
    structural: STRUCTURAL[id],
    keywords: KEYWORDS[id],
    hasDedicatedScorer: Boolean(STRUCTURAL[id] || KEYWORDS[id]),
}))

const CANDIDATE_SET = new Set(CANDIDATE_IDS)

function hasCodeShape(text) {
    return (
        /[{}\[\]<>;=]|:=|->|=>|::/u.test(text) ||
        /(?:^|\n)\s*(?:#!|\$[A-Za-z_]|@[A-Za-z_-])/mu.test(text)
    )
}

const PYTHON_STRONG_LITERALS = [/\bNone\b/iu, /\bTrue\b/iu, /\bFalse\b/iu]

function hasStrongLiteralEvidence(language, text) {
    return language === "python" && PYTHON_STRONG_LITERALS.every((literal) => literal.test(text))
}

function keywordHits(words, lower) {
    if (!words) return 0
    let hits = 0
    for (const word of words) {
        // Two-letter fragments such as "if" would match everywhere.
        if (word.length <= 3) continue
        if (lower.includes(word)) hits += 1
    }
    return hits
}

function keywordScore(language, text, structure, hits) {
    if (hits === 0) return 0
    // SQL words such as "select/from/where" are common English. Only let them
    // reinforce a statement that already has a concrete SQL shape.
    if (language === "sql" && structure === 0) return 0
    if (structure === 0 && !hasCodeShape(text) && !hasStrongLiteralEvidence(language, text)) {
        return 0
    }
    return Math.min(2.6, hits * 0.6)
}

function matchedSignals(signals, text) {
    if (!signals) return 0
    let matches = 0
    for (const signal of signals) {
        const stateful = signal.global || signal.sticky
        if (stateful) signal.lastIndex = 0
        if (signal.test(text)) matches += 1
        if (stateful) signal.lastIndex = 0
    }
    return matches
}

/**
 * Detect the language of a block body.
 *
 * @param {string} text
 * @returns {Detection}
 */
export function detectLanguage(text) {
    const raw = String(text ?? "")
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
        return { language: PLAIN_LANGUAGE, confidence: 0, runnerUp: null, stable: false }
    }
    const tooShort = trimmed.length < MIN_LENGTH
    if (hasCompleteFencedBlock(trimmed)) {
        return { language: "markdown", confidence: 4, runnerUp: null, stable: true }
    }

    const source = trimmed.length > DETECTION_SAMPLE_LIMIT ? trimmed.slice(0, DETECTION_SAMPLE_LIMIT) : trimmed
    const lower = source.toLowerCase()
    const htmlText = withoutStringLiterals(source)
    const htmlLower = htmlText.toLowerCase()
    const signalText = source.slice(0, SIGNAL_WINDOW)
    const htmlSignalText = htmlText.slice(0, SIGNAL_WINDOW)
    const codeShape = hasCodeShape(source)

    /** @type {Map<string, number>} */
    const scores = new Map()
    const bump = (language, value) => {
        if (!CANDIDATE_SET.has(language) || value <= 0) return
        scores.set(language, (scores.get(language) ?? 0) + value)
    }

    // Layer 1: unambiguous shapes.
    for (const signature of SIGNATURES) {
        if (signature.test.test(source)) bump(signature.language, 3.4)
    }

    // Layer 2: structure, keywords and signals.
    for (const candidate of CANDIDATES) {
        const isHtml = candidate.id === "html"
        const candidateText = isHtml ? htmlText : source
        const structure = candidate.structural ? candidate.structural(candidateText) : 0
        const hits = keywordHits(candidate.keywords, isHtml ? htmlLower : lower)
        const words = keywordScore(candidate.id, source, structure, hits)
        const registrySignals =
            structure > 0 || hits > 0 || !candidate.hasDedicatedScorer
                ? matchedSignals(candidate.signals, isHtml ? htmlSignalText : signalText)
                : 0
        let evidence = structure + words

        if (evidence === 0 && registrySignals > 0) {
            if (registrySignals >= 2 && (codeShape || !candidate.hasDedicatedScorer)) {
                evidence = Math.min(2.4, registrySignals * 1.2 + (codeShape ? 0.4 : 0))
            } else if (!candidate.hasDedicatedScorer && codeShape) {
                evidence = 1.6
            } else {
                // A single generic signal is useful as a runner-up, not enough
                // to reclassify prose.
                evidence = 0.6
            }
        } else if (evidence > 0 && evidence < MIN_CONFIDENCE && structure === 0) {
            if (registrySignals >= 2) {
                evidence = Math.max(evidence, Math.min(2.4, registrySignals * 1.2))
            } else if (registrySignals > 0 && hits >= 2) {
                evidence += 0.6
            }
        }
        if (evidence > 0) bump(candidate.id, evidence)
    }

    if (tooShort) {
        // A few characters are never enough to reclassify a block confidently.
        for (const [language, score] of scores) scores.set(language, score * 0.5)
    }

    const ranked = [...scores.entries()].filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1])
    const best = ranked[0]
    if (!best || best[1] < MIN_CONFIDENCE) {
        return {
            language: PLAIN_LANGUAGE,
            confidence: best ? round(best[1]) : 0,
            runnerUp: best ? best[0] : null,
            stable: false,
        }
    }

    const [language, rawScore] = best
    const second = ranked[1]
    const margin = rawScore - (second ? second[1] : 0)
    return {
        language,
        confidence: round(rawScore),
        runnerUp: second ? second[0] : null,
        stable: margin >= MIN_MARGIN || rawScore >= STRONG_CONFIDENCE,
    }
}

function round(value) {
    return Number(value.toFixed(2))
}

/**
 * Detect a batch of blocks (the worker's entry point).
 *
 * Kept here rather than in the worker so the exact same code runs in unit
 * tests, without a DOM or a worker.
 *
 * @param {Array<{index:number, text:string}>} blocks
 * @returns {Array<{index:number, language:string, confidence:number, runnerUp:string|null, stable:boolean}>}
 */
export function detectBlocks(blocks) {
    const results = []
    for (const block of blocks) {
        const detection = detectLanguage(block.text)
        results.push({
            index: block.index,
            language: detection.language,
            confidence: detection.confidence,
            runnerUp: detection.runnerUp,
            stable: detection.stable,
        })
    }
    return results
}
