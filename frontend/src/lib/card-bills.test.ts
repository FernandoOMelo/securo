import { describe, expect, it } from 'vitest'

import type { CreditCardBillSummary } from '@/types'

import { pickBills, remainingToPay } from './card-bills'

const bill = (over: Partial<CreditCardBillSummary>): CreditCardBillSummary => ({
  id: 'b', account_id: 'c1', account_name: 'Itaú', masked_number: '4711', currency: 'BRL',
  due_date: '2026-10-20', bank_total: 100, app_total: 100, difference: 0, matches: true,
  transactions_count: 1, paid_amount: 0, status: 'open', payments: [], ...over,
})

describe('pickBills', () => {
  const today = '2026-10-29'

  it('escolhe a próxima fatura a vencer de cada cartão', () => {
    const picked = pickBills(
      [
        bill({ id: 'velha', due_date: '2026-09-20' }),
        bill({ id: 'proxima', due_date: '2026-11-03' }),
        bill({ id: 'depois', due_date: '2026-12-03' }),
      ],
      today,
    )

    expect(picked.map((b) => b.id)).toEqual(['proxima'])
  })

  it('sem fatura futura, fica com a última que existe', () => {
    const picked = pickBills([bill({ id: 'a', due_date: '2026-08-20' }), bill({ id: 'b', due_date: '2026-09-20' })], today)

    expect(picked.map((b) => b.id)).toEqual(['b'])
  })

  it('uma fatura por cartão, ordenadas pelo vencimento', () => {
    const picked = pickBills(
      [
        bill({ id: 'x', account_id: 'c1', due_date: '2026-11-21' }),
        bill({ id: 'y', account_id: 'c2', account_name: 'Nubank', due_date: '2026-11-03' }),
      ],
      today,
    )

    expect(picked.map((b) => b.id)).toEqual(['y', 'x'])
  })

  it('lista vazia dá lista vazia', () => {
    expect(pickBills([], today)).toEqual([])
  })
})

describe('remainingToPay', () => {
  it('é o total menos o já pago, nunca negativo', () => {
    expect(remainingToPay(bill({ bank_total: 100, paid_amount: 30 }))).toBe(70)
    expect(remainingToPay(bill({ bank_total: 100, paid_amount: 150 }))).toBe(0)
  })
})
