import type { CreditCardBillSummary } from '@/types'

export const todayIso = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** A fatura que interessa de um cartão: a próxima a vencer, ou a última que existe. */
export function pickBills(bills: CreditCardBillSummary[], today = todayIso()): CreditCardBillSummary[] {
  const byCard = new Map<string, CreditCardBillSummary[]>()
  for (const bill of bills) byCard.set(bill.account_id, [...(byCard.get(bill.account_id) ?? []), bill])

  const picked: CreditCardBillSummary[] = []
  for (const cardBills of byCard.values()) {
    const sorted = [...cardBills].sort((a, b) => a.due_date.localeCompare(b.due_date))
    const upcoming = sorted.find((bill) => bill.due_date >= today)
    picked.push(upcoming ?? sorted[sorted.length - 1])
  }
  return picked.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.account_name.localeCompare(b.account_name))
}

export function remainingToPay(bill: CreditCardBillSummary): number {
  return Math.max(bill.bank_total - bill.paid_amount, 0)
}
