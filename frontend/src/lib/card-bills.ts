import type { CreditCardBillSummary } from '@/types'

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
