import { describe, expect, it } from 'vitest'

import type { CreditCardBillSummary } from '@/types'

import { billPaymentOf, billsDueIn, remainingToPay } from './card-bills'

const bill = (over: Partial<CreditCardBillSummary>): CreditCardBillSummary => ({
  id: 'b', account_id: 'c1', account_name: 'Itaú', masked_number: '4711', currency: 'BRL',
  due_date: '2026-10-20', bank_total: 100, app_total: 100, difference: 0, matches: true,
  transactions_count: 1, paid_amount: 0, status: 'open', payments: [], estimated: false, ...over,
})

describe('billsDueIn', () => {
  it('só traz as faturas que vencem no mês pedido', () => {
    const bills = [
      bill({ id: 'set', due_date: '2026-09-20' }),
      bill({ id: 'out', due_date: '2026-10-20' }),
      bill({ id: 'nov', due_date: '2026-11-20' }),
    ]

    expect(billsDueIn(bills, '2026-10').map((b) => b.id)).toEqual(['out'])
    expect(billsDueIn(bills, '2026-11').map((b) => b.id)).toEqual(['nov'])
    expect(billsDueIn(bills, '2026-12')).toEqual([])
  })

  it('uma fatura por cartão, ordenadas pelo vencimento', () => {
    const picked = billsDueIn(
      [
        bill({ id: 'x', account_id: 'c1', due_date: '2026-11-21' }),
        bill({ id: 'y', account_id: 'c2', account_name: 'Nubank', due_date: '2026-11-03' }),
        bill({ id: 'z', account_id: 'c2', account_name: 'Nubank', due_date: '2026-11-02' }),
      ],
      '2026-11',
    )

    expect(picked.map((b) => b.id)).toEqual(['y', 'x'])
  })

  it('lista vazia dá lista vazia', () => {
    expect(billsDueIn([], '2026-10')).toEqual([])
  })
})

describe('remainingToPay', () => {
  it('é o total menos o já pago, nunca negativo', () => {
    expect(remainingToPay(bill({ bank_total: 100, paid_amount: 30 }))).toBe(70)
    expect(remainingToPay(bill({ bank_total: 100, paid_amount: 150 }))).toBe(0)
  })
})

describe('billPaymentOf', () => {
  const debit = {
    id: 'd1', account_id: 'cc', transfer_pair_id: 'p1',
    transfer_counterpart: { account_id: 'card', account_name: 'Cartão Itaú', transaction_id: 'k1', account_type: 'credit_card' as const },
  }
  const credit = {
    id: 'k1', account_id: 'card', transfer_pair_id: 'p1',
    transfer_counterpart: { account_id: 'cc', account_name: 'Itaú', transaction_id: 'd1', account_type: 'checking' as const },
  }
  const paid = bill({ id: 'fat', status: 'paid', payments: [{ id: 'k1', date: '2026-10-20', description: 'Pagamento', amount: 100 }] })

  it('reconhece o débito na conta que pagou e acha a fatura pelo cartão', () => {
    const found = billPaymentOf(debit, 'checking', 'Itaú', [paid])

    expect(found?.card).toEqual({ id: 'card', name: 'Cartão Itaú' })
    expect(found?.bill?.status).toBe('paid')
  })

  it('reconhece o crédito no cartão', () => {
    const found = billPaymentOf(credit, 'credit_card', 'Cartão Itaú', [paid])

    expect(found?.card).toEqual({ id: 'card', name: 'Cartão Itaú' })
    expect(found?.bill?.id).toBe('fat')
  })

  it('segue como fatura mesmo sem as faturas carregadas', () => {
    expect(billPaymentOf(debit, 'checking', 'Itaú', undefined)?.bill).toBeNull()
  })

  it('transferência comum entre contas não é fatura', () => {
    const plain = { ...debit, transfer_counterpart: { ...debit.transfer_counterpart, account_type: 'savings' as const } }

    expect(billPaymentOf(plain, 'checking', 'Itaú', [paid])).toBeNull()
    expect(billPaymentOf({ ...debit, transfer_pair_id: null }, 'checking', 'Itaú', [paid])).toBeNull()
  })
})
