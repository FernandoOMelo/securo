import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { BillStatus } from '@/types'

const TONE: Record<BillStatus, string> = {
  paid: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  partial: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  open: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  unpaid: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  zero: 'bg-muted text-muted-foreground',
}

/** A situação de uma fatura, com a mesma cor e o mesmo texto em toda a interface. */
export function BillStatusBadge({ status, className }: { status: BillStatus; className?: string }) {
  const { t } = useTranslation()
  return (
    <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', TONE[status], className)}>
      {t(`cardBills.status.${status}`)}
    </span>
  )
}
