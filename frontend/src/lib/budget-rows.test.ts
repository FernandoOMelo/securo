import { describe, expect, it } from 'vitest'

import type { BudgetVsActual } from '@/types'

import { budgetRows, budgetTone, budgetTotals } from './budget-rows'

const row = (over: Partial<BudgetVsActual>): BudgetVsActual => ({
  category_id: 'c', category_name: 'Mercado', category_icon: 'x', category_color: '#111111',
  group_id: null, group_name: null, budget_amount: 500, actual_amount: 250, projected_amount: 250,
  prev_month_amount: 0, projected_prev_month_amount: 0, percentage_used: 50, is_recurring: false, ...over,
})

describe('budgetRows', () => {
  it('ignora categorias sem orçamento', () => {
    const rows = budgetRows([
      row({ category_id: 'a', budget_amount: null }),
      row({ category_id: 'b', budget_amount: 0 }),
      row({ category_id: 'c' }),
    ])

    expect(rows.map((r) => r.id)).toEqual(['c'])
  })

  it('põe as mais comprometidas primeiro', () => {
    const rows = budgetRows([
      row({ category_id: 'a', category_name: 'A', percentage_used: 30 }),
      row({ category_id: 'b', category_name: 'B', percentage_used: 120 }),
      row({ category_id: 'c', category_name: 'C', percentage_used: 85 }),
    ])

    expect(rows.map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })

  it('recalcula o percentual quando a API não manda', () => {
    const [only] = budgetRows([row({ percentage_used: null, budget_amount: 200, actual_amount: 50 })])

    expect(only.pct).toBe(25)
  })

  it('lista vazia ou indefinida dá lista vazia', () => {
    expect(budgetRows(undefined)).toEqual([])
    expect(budgetRows([])).toEqual([])
  })
})

describe('budgetTone', () => {
  it.each([
    [0, 'ok'], [79.9, 'ok'], [80, 'warn'], [99.9, 'warn'], [100, 'over'], [250, 'over'],
  ])('%s%% é %s', (pct, tone) => {
    expect(budgetTone(pct)).toBe(tone)
  })
})

describe('budgetTotals', () => {
  it('soma gasto e orçamento e deriva o percentual', () => {
    const totals = budgetTotals(budgetRows([
      row({ category_id: 'a', budget_amount: 400, actual_amount: 100, percentage_used: 25 }),
      row({ category_id: 'b', budget_amount: 600, actual_amount: 500, percentage_used: 83 }),
    ]))

    expect(totals).toEqual({ spent: 600, budget: 1000, pct: 60 })
  })

  it('sem linhas não divide por zero', () => {
    expect(budgetTotals([])).toEqual({ spent: 0, budget: 0, pct: 0 })
  })
})
