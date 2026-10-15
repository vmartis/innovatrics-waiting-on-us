/**
 * Finding one customer by typing, instead of scanning the whole list.
 *
 * The rule is deliberately forgiving, because a teammate types from memory on
 * an ordinary keyboard: case does not matter, stray spaces do not matter,
 * accents do not matter, punctuation does not matter, and the words may be in
 * any order. Every word you type has to appear somewhere in the company name
 * or the contact person's name — so "pay meridian" finds Meridian Pay, "ward"
 * finds whoever Fiona Ward writes for, and "zielinski" finds Piotr Zieliński.
 *
 * It matches on substrings, not whole words, so three letters are enough.
 */

/** The part of a thread a search looks at. Nothing else is searchable. */
export type Searchable = {
  customer: string
  contactName: string | null
}

/**
 * Strip the two differences a person typing a name should not have to
 * reproduce: upper case and accents (Novotná → novotna). Both what is typed
 * and what is searched go through this.
 *
 * Punctuation is deliberately left alone. Folding it away sounds helpful but
 * breaks the case it is meant to fix: turn the slash in "A/S" into a space
 * and the typed "as" no longer matches. No customer or contact in the data
 * has punctuation that gets in the way, so it is not worth the trap.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

function terms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

function haystackFor(thread: Searchable): string {
  return fold(`${thread.customer} ${thread.contactName ?? ''}`)
}

/** True when every word typed appears in the customer or contact name. */
export function matchesSearch(thread: Searchable, query: string): boolean {
  const words = terms(query)
  if (words.length === 0) return true

  const haystack = haystackFor(thread)
  return words.every((word) => haystack.includes(word))
}

/** The threads worth showing for what has been typed, in the same order. */
export function filterBySearch<T extends Searchable>(threads: readonly T[], query: string): T[] {
  // The typed words are split once here, not once per thread.
  const words = terms(query)
  if (words.length === 0) return [...threads]

  return threads.filter((thread) => {
    const haystack = haystackFor(thread)
    return words.every((word) => haystack.includes(word))
  })
}
