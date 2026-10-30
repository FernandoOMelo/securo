import type { CreditCardBillSummary, Transaction } from '@/types'

export const todayIso = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** As faturas que vencem no mês `yyyy-MM`: no máximo uma por cartão (a mais tardia). */
export function billsDueIn(bills: CreditCardBillSummary[], month: string): CreditCardBillSummary[] {
  const byCard = new Map<string, CreditCardBillSummary>()
  for (const bill of bills) {
    if (!bill.due_date.startsWith(month)) continue
    const current = byCard.get(bill.account_id)
    if (!current || bill.due_date > current.due_date) byCard.set(bill.account_id, bill)
  }
  return [...byCard.values()].sort(
    (a, b) => a.due_date.localeCompare(b.due_date) || a.account_name.localeCompare(b.account_name),
  )
}

export function remainingToPay(bill: CreditCardBillSummary): number {
  return Math.max(bill.bank_total - bill.paid_amount, 0)
}

export interface BillPaymentInfo {
  /** O cartão que recebeu o pagamento. */
  card: { id: string; name: string }
  /** A fatura quitada, quando as faturas já carregaram e a identificam. */
  bill: CreditCardBillSummary | null
}

/**
 * Um pagamento de fatura aparece em duas contas: o débito na conta que pagou e o
 * crédito no cartão, ligados como transferência. Devolve o cartão e a fatura
 * quando `tx` é uma dessas duas pontas, e null para qualquer outro lançamento.
 */
export function billPaymentOf(
  tx: Pick<Transaction, 'id' | 'account_id' | 'transfer_pair_id' | 'transfer_counterpart'>,
  accountType: string | null | undefined,
  accountName: string | undefined,
  bills: CreditCardBillSummary[] | undefined,
): BillPaymentInfo | null {
  if (!tx.transfer_pair_id) return null
  const other = tx.transfer_counterpart
  let card: BillPaymentInfo['card'] | null = null
  let cardLegId: string | null = null
  if (accountType === 'credit_card') {
    card = { id: tx.account_id ?? '', name: accountName ?? '' }
    cardLegId = tx.id
  } else if (other?.account_type === 'credit_card') {
    card = { id: other.account_id, name: other.account_name }
    cardLegId = other.transaction_id ?? null
  }
  if (!card) return null
  const bill = cardLegId ? (bills ?? []).find((b) => b.payments.some((p) => p.id === cardLegId)) ?? null : null
  return { card, bill }
}
