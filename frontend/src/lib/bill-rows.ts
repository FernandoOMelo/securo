import type { CreditCardBillSummary, Transaction } from '@/types'

/** Sem filtro de fim, mostra as faturas que vencem até esta folga à frente. */
const LOOKAHEAD_DAYS = 45

export type ListEntry =
  | { kind: 'tx'; tx: Transaction }
  | { kind: 'bill'; bill: CreditCardBillSummary }

export interface BillRowOptions {
  bills: CreditCardBillSummary[] | undefined
  /** Os lançamentos que a página está mostrando, na ordem da lista. */
  items: Pick<Transaction, 'date'>[]
  page: number
  limit: number
  total: number
  from?: string
  to?: string
  /** Vazio = todas as contas. */
  accountIds: string[]
  descending: boolean
  today: string
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * As faturas que cabem nesta página da lista, cada uma na data de vencimento.
 *
 * A lista é paginada no servidor e as faturas vêm de outro lugar, então uma
 * fatura entra na página cujo intervalo de datas a contém; a primeira e a última
 * página ficam abertas nas pontas, limitadas pelo período filtrado.
 */
export function billRowsFor(o: BillRowOptions): CreditCardBillSummary[] {
  const first = o.page <= 1
  const last = o.page * o.limit >= o.total
  const dates = o.items.map((i) => i.date)
  const minDate = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : undefined
  const maxDate = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : undefined

  const cap = o.to ?? addDays(o.today, LOOKAHEAD_DAYS)
  // Início e fim (em data) da faixa que esta página cobre.
  const startsAtEarliest = o.descending ? last : first
  const startsAtLatest = o.descending ? first : last
  const lower = startsAtEarliest || minDate === undefined ? (o.from ?? '') : minDate
  const upper = startsAtLatest || maxDate === undefined ? cap : maxDate

  return (o.bills ?? [])
    .filter((b) => b.status !== 'zero' && b.bank_total > 0)
    .filter((b) => o.accountIds.length === 0 || o.accountIds.includes(b.account_id))
    .filter((b) => b.due_date >= lower && b.due_date <= upper)
    .filter((b) => (!o.from || b.due_date >= o.from) && (!o.to || b.due_date <= o.to))
    .sort((a, b) => (o.descending ? b.due_date.localeCompare(a.due_date) : a.due_date.localeCompare(b.due_date)))
}

/** Junta as faturas aos lançamentos pela data; numa mesma data a fatura vem depois. */
export function interleave(
  items: Transaction[],
  bills: CreditCardBillSummary[],
  descending: boolean,
): ListEntry[] {
  const out: ListEntry[] = []
  let b = 0
  const before = (billDate: string, txDate: string) => (descending ? billDate > txDate : billDate < txDate)
  for (const tx of items) {
    while (b < bills.length && before(bills[b].due_date, tx.date)) {
      out.push({ kind: 'bill', bill: bills[b++] })
    }
    out.push({ kind: 'tx', tx })
  }
  while (b < bills.length) out.push({ kind: 'bill', bill: bills[b++] })
  return out
}
