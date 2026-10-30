/** Bloco "Orçamentos" do painel: quanto de cada orçamento do mês já foi usado.
 *
 *  Reaproveita a mesma consulta que as barras de categoria, então abrir este
 *  bloco não acrescenta nenhuma chamada à API.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { PiggyBank } from 'lucide-react'
import { budgets } from '@/lib/api'
import { formatCurrency } from '@/lib/format'
import { budgetRows, budgetTone, budgetTotals, type BudgetTone } from '@/lib/budget-rows'
import { monthRange } from '@/lib/month-utils'
import { useDisplayLocale } from '@/hooks/use-display-locale'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { cn } from '@/lib/utils'

const BAR_TONE: Record<BudgetTone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  over: 'bg-rose-500',
}

const MAX_ROWS = 6

function Bar({ pct, label }: { pct: number; label: string }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.min(Math.round(pct), 100)}
      aria-valuetext={`${Math.round(pct)}%`}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full rounded-full', BAR_TONE[budgetTone(pct)])} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

export function DashboardBudgetsWidget({ month, currency }: { month: string; currency: string }) {
  const { t } = useTranslation()
  const locale = useDisplayLocale()
  const { mask } = usePrivacyMode()
  const monthStart = monthRange(month).from

  const { data } = useQuery({
    // A mesma chave das barras de categoria: uma chamada só serve aos dois.
    queryKey: ['budgets', 'comparison', month],
    queryFn: () => budgets.comparison(monthStart),
  })

  const rows = useMemo(() => budgetRows(data), [data])
  const totals = useMemo(() => budgetTotals(rows), [rows])
  const money = (value: number) => mask(formatCurrency(value, currency, locale))

  return (
    <div className="h-full rounded-xl border border-border bg-card shadow-sm" data-testid="dashboard-budgets-widget">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <PiggyBank size={16} aria-hidden /> {t('dashboardLayout.budgetsWidget.title')}
        </h2>
        {rows.length > 0 && (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold tabular-nums text-foreground">{money(totals.spent)}</span>
            {' '}{t('dashboardLayout.budgetsWidget.of')}{' '}
            <span className="tabular-nums">{money(totals.budget)}</span>
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t('dashboardLayout.budgetsWidget.empty')}</p>
      ) : (
        <>
          <div className="px-5 pt-3">
            <Bar pct={totals.pct} label={t('dashboardLayout.budgetsWidget.title')} />
          </div>
          <ul className="space-y-3 px-5 py-4">
            {rows.slice(0, MAX_ROWS).map((row) => (
              <li key={row.id} className="text-sm">
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {money(row.spent)} / {money(row.budget)}
                    <span className={cn('ml-2 font-medium', budgetTone(row.pct) === 'over' && 'text-rose-600 dark:text-rose-400')}>
                      {Math.round(row.pct)}%
                    </span>
                  </span>
                </div>
                <Bar pct={row.pct} label={row.name} />
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex justify-end border-t border-border px-5 py-3 text-sm">
        <Link to="/budgets" className="font-medium text-primary hover:underline">
          {t('dashboardLayout.budgetsWidget.viewAll')} →
        </Link>
      </div>
    </div>
  )
}
