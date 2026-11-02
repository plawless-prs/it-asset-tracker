// Logic checks for the blank-cost multiplier and the export refusal.
// Run: node --test src/lib/priceupdates.cost.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLinesFromRows,
  exportMissingCostRefusal,
  isMissingNewCost,
  batchMissingCostWarning,
  previewMissingCostWarning,
  multiplierExampleText,
  listMultiplierNote,
} from './priceupdates.js'

const HEADER = ['Item', 'Cost', 'List']

function parse(dataRows, transforms, columns = { vendor_item_no: 0, cost: 1, list: 2 }) {
  return buildLinesFromRows([HEADER, ...dataRows], {
    header_row: 0,
    columns,
    transforms,
  })
}

function byItem(result) {
  return Object.fromEntries(result.lines.map(l => [l.vendor_item_no, l]))
}

test('list-only file with a multiplier sets new cost to list × multiplier', () => {
  const result = parse(
    [['A', '', '100'], ['B', '', '50']],
    { multiplier: '0.81' },
    { vendor_item_no: 0, list: 2 },
  )
  const lines = byItem(result)
  assert.equal(lines.A.new_cost, 81)
  assert.equal(lines.A.new_list, 100)
  assert.equal(lines.B.new_cost, 40.5)
  assert.equal(result.missingCost, 0)
  assert.equal(result.derivedFromList, 2)
  assert.equal(result.multiplierExample.source, 'list')
  assert.equal(result.multiplierExample.item, 'A')
  assert.match(multiplierExampleText(result.multiplierExample), /A has no cost/)
  assert.match(multiplierExampleText(result.multiplierExample), /\$100\.00 × 0\.81 = \$81\.00/)
  assert.match(listMultiplierNote(result.derivedFromList), /2 lines had no cost/)
})

test('discount % off list is unchanged and still runs before the multiplier', () => {
  const onlyDiscount = parse([['A', '', '100']], { discount_pct: '40' })
  assert.equal(byItem(onlyDiscount).A.new_cost, 60)
  assert.equal(onlyDiscount.derivedFromList, 0)

  // Discount fills the blank cost first, then the multiplier applies to that
  // cost. This is not the list × multiplier fallback (which would be 81).
  const both = parse([['A', '', '100']], { discount_pct: '40', multiplier: '0.81' })
  assert.equal(byItem(both).A.new_cost, 48.6)
  assert.equal(both.derivedFromList, 0)
  assert.equal(both.multiplierExample, null)
})

test('a row that already has a cost stays cost × multiplier', () => {
  const result = parse(
    [['A', '10', '20'], ['B', '$1,000.00', '1500']],
    { multiplier: '0.81', discount_pct: '40' },
  )
  const lines = byItem(result)
  assert.equal(lines.A.new_cost, 8.1)
  assert.equal(lines.A.new_list, 20)
  assert.equal(lines.B.new_cost, 810)
  assert.equal(result.derivedFromList, 0)
  assert.equal(result.multiplierExample.source, 'cost')
  assert.match(multiplierExampleText(result.multiplierExample), /cost \$10\.00 × 0\.81 = \$8\.10/)
})

test('a blank cost row in a file that maps a cost column uses list × multiplier', () => {
  const result = parse(
    [
      ['A', '10', '20'],
      ['B', '', '100'],
      ['C', '   ', '50'],
      ['D', '0', '100'],
    ],
    { multiplier: '.81' },
  )
  const lines = byItem(result)
  assert.equal(lines.A.new_cost, 8.1)
  assert.equal(lines.B.new_cost, 81)
  assert.equal(lines.C.new_cost, 40.5)
  // Explicit 0 is a cost, not a blank. It does not fall back to list.
  assert.equal(lines.D.new_cost, 0)
  assert.equal(result.derivedFromList, 2)
  assert.equal(result.missingCost, 0)
  assert.equal(result.multiplierExample.source, 'list')
  assert.equal(result.multiplierExample.item, 'B')
})

test('list without a multiplier or discount stores no new cost and warns', () => {
  const result = parse([['A', '', '25'], ['B', '', '']], { multiplier: '', discount_pct: '' })
  assert.equal(result.lines.length, 1)
  assert.equal(byItem(result).A.new_cost, null)
  assert.equal(byItem(result).A.new_list, 25)
  assert.equal(result.skippedNoPrice, 1)
  assert.equal(result.missingCost, 1)
  assert.equal(result.derivedFromList, 0)
  assert.match(previewMissingCostWarning(result.missingCost), /1 line has no new cost/)
  assert.equal(previewMissingCostWarning(0), null)
  assert.match(previewMissingCostWarning(3), /3 lines have no new cost/)
})

test('discount still fills a blank cost when a cost column is mapped', () => {
  const result = parse([['A', '10', '40'], ['B', '', '100']], { discount_pct: '20' })
  assert.equal(byItem(result).A.new_cost, 10)
  assert.equal(byItem(result).B.new_cost, 80)
})

test('multiplier rounds to 4 decimal places and does not add fields the insert would reject', () => {
  const result = parse([['A', '1.234567', '9']], { multiplier: '1' })
  const line = result.lines[0]
  assert.equal(line.new_cost, 1.2346)
  assert.deepEqual(Object.keys(line).sort(), [
    'description', 'effective_date', 'new_cost', 'new_list', 'raw', 'row_number', 'uom', 'vendor_item_no',
  ])
})

test('export refuses included matched lines missing new_cost and allows a real zero', () => {
  assert.equal(isMissingNewCost(null), true)
  assert.equal(isMissingNewCost(undefined), true)
  assert.equal(isMissingNewCost(''), true)
  assert.equal(isMissingNewCost('nope'), true)
  assert.equal(isMissingNewCost(0), false)
  assert.equal(isMissingNewCost('0'), false)
  assert.equal(isMissingNewCost('12.50'), false)

  assert.equal(exportMissingCostRefusal([
    { new_cost: 8.1 },
    { new_cost: 0 },
    { new_cost: '12.50' },
  ]), null)

  const one = exportMissingCostRefusal([
    { new_cost: 8.1 },
    { new_cost: null },
  ])
  assert.equal(one.status, 422)
  assert.match(one.error, /1 included matched line has no new cost/)
  assert.match(one.error, /no change/)

  const two = exportMissingCostRefusal([
    { new_cost: null },
    { new_cost: '' },
    { new_cost: undefined },
  ])
  assert.equal(two.status, 422)
  assert.match(two.error, /3 included matched lines have no new cost/)
})

test('batch warning distinguishes blocking lines from stored lines, and the locked batch', () => {
  assert.equal(batchMissingCostWarning(0, 0), null)
  const open = batchMissingCostWarning(4, 2, { editable: true })
  assert.match(open, /4 lines have no new cost/)
  assert.match(open, /2 included matched lines/)
  assert.match(open, /re-applied/i)
  const one = batchMissingCostWarning(1, 1, { editable: true })
  assert.match(one, /1 line has no new cost/)
  assert.match(one, /1 included matched line has no new cost/)
  const pending = batchMissingCostWarning(3, 0, { editable: true })
  assert.match(pending, /not blocked yet/)
  const locked = batchMissingCostWarning(2, 2, { editable: false })
  assert.match(locked, /re-create/i)
  assert.doesNotMatch(locked, /type a new cost/)
})
