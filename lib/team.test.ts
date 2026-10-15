import test from 'node:test'
import assert from 'node:assert/strict'
import { asTeamMember, TEAM } from './team.ts'

test('a name from the team list is accepted', () => {
  assert.equal(asTeamMember('Alex Moore'), 'Alex Moore')
})

test('surrounding spaces are tolerated', () => {
  assert.equal(asTeamMember('  Priya Shah  '), 'Priya Shah')
})

test('a name nobody on the team has is refused', () => {
  assert.equal(asTeamMember('Mallory'), null)
  assert.equal(asTeamMember('alex moore'), null, 'matching is exact, not fuzzy')
})

test('anything that is not a plain string is refused', () => {
  for (const value of [undefined, null, 42, {}, [], ['Alex Moore'], true, '']) {
    assert.equal(asTeamMember(value), null, `refused: ${JSON.stringify(value)}`)
  }
})

test('the team list is not empty and has no duplicates', () => {
  assert.ok(TEAM.length > 1)
  assert.equal(new Set(TEAM).size, TEAM.length)
})
