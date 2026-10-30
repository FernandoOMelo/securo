import { describe, expect, it } from 'vitest'

import type { CreditCardBillSummary, Transaction } from '@/types'

import { billRowsFor, interleave } from './bill-rows'

const bill = (over: Partial<CreditCardBillSummary>): CreditCardBillSummary => ({
  id: 'b', account_id: 'c1', account_name: 'Cartão Itaú', masked_number: null, currency: 'BRL',
  due_date: '2026-10-20', bank_total: 100, app_total: 100, difference: 0, matches: true,
  transactions_count: 1, paid_amount: 0, status: 'open', payments: [], estimated: false, ...over,
})
const day = (date: string) => ({ date })
const base = {
  items: [day('2026-10-28'), day('2026-10-05')], page: 1, limit: 50, total: 2,
  from: '2026-10-01', to: '2026-10-31', accountIds: [], descending: true, today: '2026-10-30',
}

describe('billRowsFor', () => {
  it('traz as faturas que vencem no período, em aberto ou já pagas', () => {
    const bills = [
      bill({ id: 'paga', due_date: '2026-10-20', status: 'paid' }),
      bill({ id: 'aberta', due_date: '2026-10-28', status: 'open', estimated: true }),
      bill({ id: 'nov', due_date: '2026-11-20' }),
      bill({ id: 'set', due_date: '2026-09-20' }),
    ]

    expect(billRowsFor({ ...base, bills }).map((b) => b.id)).toEqual(['aberta', 'paga'])
  })

  it('respeita as contas filtradas e some com fatura sem valor', () => {
    const bills = [
      bill({ id: 'a', account_id: 'c1' }),
      bill({ id: 'b', account_id: 'c2' }),
      bill({ id: 'zero', status: 'zero', bank_total: 0 }),
    ]

    expect(billRowsFor({ ...base, bills, accountIds: ['c2'] }).map((b) => b.id)).toEqual(['b'])
    expect(billRowsFor({ ...base, bills }).map((b) => b.id)).toEqual(['a', 'b'])
  })

  it('sem período, olha só até um pouco à frente de hoje', () => {
    const bills = [bill({ id: 'perto', due_date: '2026-11-15' }), bill({ id: 'longe', due_date: '2027-03-15' })]

    const rows = billRowsFor({ ...base, bills, from: undefined, to: undefined })

    expect(rows.map((b) => b.id)).toEqual(['perto'])
  })

  it('numa página do meio, só as faturas dentro das datas da página', () => {
    const bills = [bill({ id: 'dentro', due_date: '2026-10-15' }), bill({ id: 'fora', due_date: '2026-10-29' })]

    const rows = billRowsFor({
      ...base, bills, page: 2, total: 150, items: [day('2026-10-20'), day('2026-10-10')],
    })

    expect(rows.map((b) => b.id)).toEqual(['dentro'])
  })

  it('sem faturas carregadas devolve vazio', () => {
    expect(billRowsFor({ ...base, bills: undefined })).toEqual([])
  })
})

describe('interleave', () => {
  const tx = (id: string, date: string) => ({ id, date }) as Transaction

  it('põe a fatura na posição da data, na ordem da lista', () => {
    const out = interleave([tx('a', '2026-10-28'), tx('b', '2026-10-05')], [bill({ id: 'f', due_date: '2026-10-20' })], true)

    expect(out.map((e) => (e.kind === 'bill' ? e.bill.id : e.tx.id))).toEqual(['a', 'f', 'b'])
  })

  it('funciona na ordem crescente e com faturas além do último lançamento', () => {
    const out = interleave(
      [tx('b', '2026-10-05'), tx('a', '2026-10-28')],
      [bill({ id: 'f', due_date: '2026-10-20' }), bill({ id: 'g', due_date: '2026-11-02' })],
      false,
    )

    expect(out.map((e) => (e.kind === 'bill' ? e.bill.id : e.tx.id))).toEqual(['b', 'f', 'a', 'g'])
  })
})
