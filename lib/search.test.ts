import test from 'node:test'
import assert from 'node:assert/strict'
import { filterBySearch, matchesSearch, type Searchable } from './search.ts'

/** A slice of the real sample customers, including the two tricky pairs. */
const THREADS: Searchable[] = [
  { customer: 'Meridian Health Group', contactName: 'Ivan Petrov' },
  { customer: 'Consolidated Rail', contactName: 'Piotr Zieliński' },
  { customer: 'Aurora Analytics', contactName: 'Tomás Varga' },
  { customer: 'Nordbank A/S', contactName: null },
  { customer: 'Meridian Pay', contactName: null },
  { customer: 'Northgate Housing', contactName: 'Fiona Ward' },
  { customer: 'Copperfield Legal', contactName: 'Ana Ruiz' },
  { customer: 'Fenwick Legal', contactName: null },
  { customer: 'Nordbank AS', contactName: 'Petter Haugen' },
]

const found = (query: string) => filterBySearch(THREADS, query).map((t) => t.customer)

test('an empty box shows everything, in the order it was given', () => {
  assert.deepEqual(filterBySearch(THREADS, ''), THREADS)
  assert.deepEqual(filterBySearch(THREADS, '   '), THREADS)
})

test('matchesSearch on its own lets an empty query through', () => {
  assert.equal(matchesSearch(THREADS[0], ''), true)
  assert.equal(matchesSearch(THREADS[0], '  '), true)
})

test('typing part of a name is enough', () => {
  assert.deepEqual(found('northg'), ['Northgate Housing'])
})

test('case does not matter', () => {
  assert.deepEqual(found('LEGAL'), ['Copperfield Legal', 'Fenwick Legal'])
  assert.deepEqual(found('legal'), ['Copperfield Legal', 'Fenwick Legal'])
})

test('a name shared by two customers shows both', () => {
  assert.deepEqual(found('meridian'), ['Meridian Health Group', 'Meridian Pay'])
})

test('more words narrow it down', () => {
  assert.deepEqual(found('meridian pay'), ['Meridian Pay'])
})

test('the words may be typed in any order', () => {
  assert.deepEqual(found('pay meridian'), ['Meridian Pay'])
})

test('stray spaces do not break it', () => {
  assert.deepEqual(found('  meridian   pay  '), ['Meridian Pay'])
})

test('the contact person is searchable too', () => {
  assert.deepEqual(found('fiona'), ['Northgate Housing'])
  assert.deepEqual(found('ward'), ['Northgate Housing'])
})

test('a customer with no contact name is still searchable and never crashes', () => {
  assert.deepEqual(found('fenwick'), ['Fenwick Legal'])
  assert.equal(matchesSearch({ customer: 'Fenwick Legal', contactName: null }, 'ruiz'), false)
})

test('you do not have to type the accents', () => {
  // The real sample data has Piotr Zieliński, Tomás Varga and Eva Novotná;
  // nobody types those on an ordinary keyboard.
  assert.deepEqual(found('zielinski'), ['Consolidated Rail'])
  assert.deepEqual(found('tomas'), ['Aurora Analytics'])
  // And typing them properly still works.
  assert.deepEqual(found('Zieliński'), ['Consolidated Rail'])
})

test('punctuation is matched as written — a known limit, not an accident', () => {
  assert.deepEqual(found('nordbank as'), ['Nordbank AS'])
  assert.deepEqual(found('nordbank a/s'), ['Nordbank A/S'])
})

test('something nobody is called finds nothing', () => {
  assert.deepEqual(found('zzzz'), [])
})

test('the order of the list is kept, not re-ranked', () => {
  const all = THREADS.map((t) => t.customer)
  const hits = found('a')
  assert.ok(hits.length > 2)
  assert.deepEqual(hits, all.filter((name) => hits.includes(name)))
})

test('searching does not change the list it was given', () => {
  const before = [...THREADS]
  filterBySearch(THREADS, 'meridian')
  assert.deepEqual(THREADS, before)
})
