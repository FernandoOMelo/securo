import type { BudgetVsActual } from '@/types'

export type BudgetTone = 'ok' | 'warn' | 'over'

export interface BudgetRow {
  id: string
  name: string
  color: string
  spent: number
  budget: number
  /** Percentual do orçamento usado; pode passar de 100. */
  pct: number
}

/** A partir de 80% o orçamento está perto do limite; a partir de 100%, estourado. */
export function budgetTone(pct: number): BudgetTone {
  if (pct >= 100) return 'over'
  if (pct >= 80) return 'warn'
  return 'ok'
}

/**
 * Só as categorias que têm orçamento, as mais comprometidas primeiro.
 *
 * Usa o percentual que a API já calcula; sem ele, recalcula pelo gasto.
 */
export function budgetRows(comparison: BudgetVsActual[] | undefined): BudgetRow[] {
  return (comparison ?? [])
    .filter((row) => row.budget_amount != null && Number(row.budget_amount) > 0)
    .map((row) => {
      const budget = Number(row.budget_amount)
      const spent = Number(row.actual_amount)
      return {
        id: row.category_id,
        name: row.category_name,
        color: row.category_color,
        spent,
        budget,
        pct: row.percentage_used != null ? Number(row.percentage_used) : (spent / budget) * 100,
      }
    })
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))
}

export function budgetTotals(rows: BudgetRow[]): { spent: number; budget: number; pct: number } {
  const spent = rows.reduce((sum, row) => sum + row.spent, 0)
  const budget = rows.reduce((sum, row) => sum + row.budget, 0)
  return { spent, budget, pct: budget > 0 ? (spent / budget) * 100 : 0 }
}
