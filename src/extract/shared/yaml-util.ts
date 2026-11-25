/** Thin helpers over the `yaml` package: parse once, then read nodes with 1-based line and column. */
import { LineCounter, parseAllDocuments, parseDocument, isAlias, isMap, isScalar, isSeq, Scalar } from 'yaml'
import type { Document, Node, Pair, YAMLMap, YAMLSeq } from 'yaml'

/** A parsed YAML text with position lookup. */
export interface Yaml {
  doc: Document.Parsed
  text: string
  /** 1-based line and column of an offset into the text. */
  pos(offset: number): { line: number; column: number }
}

/** Parses YAML text; undefined when it cannot be read at all. Recoverable errors still yield a document. */
export function loadYaml(text: string): Yaml | undefined {
  try {
    const lineCounter = new LineCounter()
    const doc = parseDocument(text, { lineCounter, prettyErrors: false, strict: false, uniqueKeys: false, merge: true })
    return {
      doc,
      text,
      pos(offset) {
        const p = lineCounter.linePos(offset)
        return { line: p.line, column: p.col }
      },
    }
  } catch {
    return undefined
  }
}

/**
 * Parses a YAML stream and returns one `Yaml` per document (`---` separated), all sharing one line
 * counter. A multi-document stream is valid YAML and is read in full; undefined when it cannot be
 * parsed at all.
 */
export function loadYamlAll(text: string): Yaml[] | undefined {
  try {
    const lineCounter = new LineCounter()
    const docs = parseAllDocuments(text, { lineCounter, prettyErrors: false, strict: false, uniqueKeys: false, merge: true })
    const list = Array.isArray(docs) ? docs : [docs]
    return list.map((doc) => ({
      doc: doc as Document.Parsed,
      text,
      pos(offset: number) {
        const p = lineCounter.linePos(offset)
        return { line: p.line, column: p.col }
      },
    }))
  } catch {
    return undefined
  }
}

/** A scalar read as written in the file. */
export interface ScalarText {
  /** The text as written, without surrounding quotes (`3.10` stays `3.10`; `'3.10'` is `3.10`). */
  text: string
  /** True when the value was written in quotes (so YAML reads it as a string). */
  quoted: boolean
  line: number
  column: number
}

/** Follows an alias to the node it points at. */
export function resolveNode(y: Yaml, node: unknown): unknown {
  let n = node
  for (let i = 0; i < 8 && isAlias(n); i++) n = (n as { resolve(doc: unknown): unknown }).resolve(y.doc)
  return n
}

/** Reads a scalar node as written; undefined when the node is not a scalar. */
export function scalarText(y: Yaml, node: unknown): ScalarText | undefined {
  const n = resolveNode(y, node)
  if (!isScalar(n)) return undefined
  const sc = n as Scalar
  const range = sc.range
  if (!range) return undefined
  const { line, column } = y.pos(range[0])
  const type = sc.type
  const quoted = type === Scalar.QUOTE_DOUBLE || type === Scalar.QUOTE_SINGLE
  if (type === Scalar.BLOCK_FOLDED || type === Scalar.BLOCK_LITERAL) {
    return { text: String(sc.value ?? '').replace(/\n$/, ''), quoted: false, line, column }
  }
  const raw = y.text.slice(range[0], range[1])
  const inner = quoted ? raw.slice(1, -1) : raw
  return { text: quoted ? String(sc.value ?? inner) : inner.trim(), quoted, line, column: quoted ? column + 1 : column }
}

/** Looks a key up in a map (merge keys included); returns the value node and the key position. */
export function getPair(y: Yaml, map: unknown, key: string): { value: unknown; line: number; column: number } | undefined {
  const m = resolveNode(y, map)
  if (!isMap(m)) return undefined
  const pairs = (m as YAMLMap).items as Pair[]
  for (const pair of pairs) {
    const k = scalarKey(pair.key)
    if (k === key) {
      const kn = pair.key as Node | null
      const range = kn && (kn as Node).range
      const p = range ? y.pos(range[0]) : { line: 1, column: 1 }
      return { value: pair.value, line: p.line, column: p.column }
    }
  }
  // `<<: *anchor` merge keys: look inside the merged maps.
  for (const pair of pairs) {
    if (scalarKey(pair.key) !== '<<') continue
    const v = resolveNode(y, pair.value)
    const targets = isSeq(v) ? ((v as YAMLSeq).items as unknown[]) : [v]
    for (const t of targets) {
      const found = getPair(y, t, key)
      if (found) return found
    }
  }
  return undefined
}

function scalarKey(key: unknown): string | undefined {
  if (isScalar(key)) {
    const v = (key as Scalar).value
    // With `merge: true` the `<<` key is a Scalar whose value is the symbol Symbol(<<).
    return typeof v === 'symbol' ? '<<' : String(v)
  }
  return undefined
}

/** The keys and values of a map in document order, merge keys excluded. */
export function entries(y: Yaml, map: unknown): { key: string; value: unknown; line: number; column: number }[] {
  const m = resolveNode(y, map)
  if (!isMap(m)) return []
  const out: { key: string; value: unknown; line: number; column: number }[] = []
  for (const pair of (m as YAMLMap).items as Pair[]) {
    const key = scalarKey(pair.key)
    if (key === undefined || key === '<<') continue
    const kn = pair.key as Node
    const p = kn.range ? y.pos(kn.range[0]) : { line: 1, column: 1 }
    out.push({ key, value: pair.value, line: p.line, column: p.column })
  }
  return out
}

/** The items of a sequence, aliases followed; [] when the node is not a sequence. */
export function items(y: Yaml, seq: unknown): unknown[] {
  const s = resolveNode(y, seq)
  return isSeq(s) ? ((s as YAMLSeq).items as unknown[]) : []
}

export { isMap, isSeq, isScalar }
