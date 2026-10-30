/** Bloco "Pendências" do painel: o que ainda não foi efetivado no mês.
 *
 *  Mostra quanto está por entrar e por sair e os primeiros lançamentos por
 *  data, com um atalho para a lista completa já filtrada.
 */
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { transactions } from '@/lib/api'
import { formatCurrency } from '@/lib/format'
import { monthRange } from '@/lib/month-utils'
import { useDateLocale, useDisplayLocale } from '@/hooks/use-display-locale'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { cn } from '@/lib/utils'

const SHOWN = 6

export function DashboardPendingWidget({ month, currency }: { month: string; currency: string }) {
  const { t } = useTranslation()
  const locale = useDisplayLocale()
  const dateLocale = useDateLocale()
  const { mask } = usePrivacyMode()
  const { from, to } = monthRange(month)

  const { data } = useQuery({
    queryKey: ['transactions', 'pending-widget', month],
    queryFn: () =>
      transactions.list({
        status: 'pending',
        from,
        to,
        limit: SHOWN,
        sort_by: 'date',
        sort_dir: 'asc',
        exclude_ignored: true,
      }),
  })

  const money = (value: number, code = currency) => mask(formatCurrency(value, code, locale))
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const summary = data?.summary
  const params = new URLSearchParams({ status: 'pending', from, to })

  return (
    <div className="h-full rounded-xl border border-border bg-card shadow-sm" data-testid="dashboard-pending-widget">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Clock size={16} aria-hidden /> {t('dashboardLayout.pendingWidget.title')}
          {total > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{total}</span>
          )}
        </h2>
        {summary && total > 0 && (
          <p className="flex gap-3 text-sm tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">
              {t('dashboardLayout.pendingWidget.toReceive')} {money(summary.income, summary.currency)}
            </span>
            <span className="text-muted-foreground">
              {t('dashboardLayout.pendingWidget.toPay')} {money(summary.expense, summary.currency)}
            </span>
          </p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t('dashboardLayout.pendingWidget.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((tx) => (
            <li key={tx.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <span className="min-w-0 truncate">
                <span className="text-muted-foreground">
                  {new Date(`${tx.date}T00:00:00`).toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })}
                </span>
                {' · '}
                {tx.description}
              </span>
              <span className={cn('shrink-0 tabular-nums', tx.type === 'credit' && 'text-emerald-600 dark:text-emerald-400')}>
                {tx.type === 'credit' ? '+' : ''}{money(tx.amount, tx.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm">
        {total > items.length ? (
          <span className="text-muted-foreground">
            {t('dashboardLayout.pendingWidget.more', { count: total - items.length })}
          </span>
        ) : (
          <span />
        )}
        <Link to={`/transactions?${params}`} className="font-medium text-primary hover:underline">
          {t('dashboardLayout.pendingWidget.viewAll')} →
        </Link>
      </div>
    </div>
  )
}
