import { CreditCard } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { BillStatusBadge } from '@/components/bill-status-badge'
import { TableCell, TableRow } from '@/components/ui/table'
import type { ColumnDef } from '@/components/transactions-grid-columns'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { formatCurrency } from '@/lib/format'
import type { CreditCardBillSummary } from '@/types'

function useBillText(bill: CreditCardBillSummary, locale: string) {
  const { t } = useTranslation()
  const { mask } = usePrivacyMode()
  const amount = mask(`−${formatCurrency(bill.bank_total, bill.currency, locale)}`)
  return {
    title: `${t('cardBills.payment')} ${bill.account_name}`,
    hint: bill.estimated ? t('cardBills.estimatedHint') : undefined,
    estimated: bill.estimated ? t('cardBills.estimated') : null,
    amount,
    tone: bill.status === 'paid' ? 'text-muted-foreground' : 'text-rose-500',
  }
}

interface BillTableRowProps {
  bill: CreditCardBillSummary
  columns: ColumnDef[]
  widthOf: (id: ColumnDef['id']) => number
  dateLocale: string
  locale: string
  onOpen: () => void
}

/** Uma fatura de cartão na lista de transações, na data de vencimento. */
export function BillTableRow({ bill, columns, widthOf, dateLocale, locale, onOpen }: BillTableRowProps) {
  const { t } = useTranslation()
  const text = useBillText(bill, locale)

  const cell = (col: ColumnDef) => {
    const style = { width: widthOf(col.id), minWidth: widthOf(col.id) }
    const base = `py-2.5 ${col.align === 'right' ? 'text-right' : ''}`
    switch (col.id) {
      case 'date':
        return (
          <TableCell key={col.id} style={style} className={`${base} text-sm text-muted-foreground tabular-nums`}>
            {new Date(`${bill.due_date}T00:00:00`).toLocaleDateString(dateLocale)}
          </TableCell>
        )
      case 'description':
        return (
          <TableCell key={col.id} style={style} className={`${base} pl-2 max-w-0`}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300">
                <CreditCard className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={text.hint}>{text.title}</p>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <BillStatusBadge status={bill.status} />
                  {text.estimated && <span className="text-xs text-muted-foreground" title={text.hint}>{text.estimated}</span>}
                </div>
              </div>
            </div>
          </TableCell>
        )
      case 'account':
        return (
          <TableCell key={col.id} style={style} className={`${base} text-sm text-muted-foreground`}>
            <span className="truncate">{bill.account_name}</span>
          </TableCell>
        )
      case 'type':
        return (
          <TableCell key={col.id} style={style} className={`${base} text-sm text-muted-foreground`}>
            {t('cardBills.payment')}
          </TableCell>
        )
      case 'amount':
        return (
          <TableCell key={col.id} style={style} className={`${base} pr-5`}>
            <span className={`text-xs md:text-sm font-bold tabular-nums ${text.tone}`}>{text.amount}</span>
          </TableCell>
        )
      default:
        return <TableCell key={col.id} style={style} className={base} />
    }
  }

  return (
    <TableRow
      data-testid="bill-row"
      className="cursor-pointer border-b border-border bg-violet-500/[0.04] hover:bg-muted last:border-0"
      onClick={onOpen}
    >
      <TableCell style={{ width: 40, minWidth: 40 }} className="py-2.5 pl-4 pr-0" />
      {columns.map(cell)}
    </TableRow>
  )
}

interface BillMobileRowProps {
  bill: CreditCardBillSummary
  locale: string
  onOpen: () => void
}

export function BillMobileRow({ bill, locale, onOpen }: BillMobileRowProps) {
  const text = useBillText(bill, locale)
  return (
    <button
      type="button"
      data-testid="bill-row"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-border bg-violet-500/[0.04] px-4 py-3 text-left"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300">
        <CreditCard className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{text.title}</span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <BillStatusBadge status={bill.status} />
          {text.estimated && <span className="text-xs text-muted-foreground">{text.estimated}</span>}
        </span>
      </span>
      <span className={`shrink-0 text-sm font-bold tabular-nums ${text.tone}`}>{text.amount}</span>
    </button>
  )
}
