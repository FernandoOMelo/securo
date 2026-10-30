/** Bloco "Cartões" do painel: a próxima fatura de cada cartão e quanto falta pagar.
 *
 *  Não mostra nada quando o workspace não tem faturas, para o painel não
 *  ganhar um quadro vazio de quem não usa cartão.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CreditCard } from 'lucide-react'
import { creditCardBills } from '@/lib/api'
import { formatCurrency } from '@/lib/format'
import { useDateLocale, useDisplayLocale } from '@/hooks/use-display-locale'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { BillStatusBadge } from '@/components/bill-status-badge'
import { billsDueIn, remainingToPay } from '@/lib/card-bills'

export function DashboardCardsWidget({ month }: { month: string }) {
  const { t } = useTranslation()
  const locale = useDisplayLocale()
  const dateLocale = useDateLocale()
  const { mask } = usePrivacyMode()

  const { data } = useQuery({
    queryKey: ['credit-card-bills', 'dashboard'],
    queryFn: () => creditCardBills.list(undefined, 24),
  })

  const rows = useMemo(() => billsDueIn(data ?? [], month), [data, month])
  const needsAttention = useMemo(
    () => rows.some((bill) => bill.status === 'unpaid' && bill.bank_total > 1),
    [rows],
  )

  // Sem nenhuma fatura no workspace, o bloco não ocupa lugar no painel.
  if (!data?.length) return null

  const money = (value: number, currency: string) => mask(formatCurrency(value, currency, locale))
  const toPay = rows.reduce((sum, bill) => sum + remainingToPay(bill), 0)
  const currency = rows[0]?.currency ?? data[0].currency

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm" data-testid="dashboard-cards-widget">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CreditCard size={16} aria-hidden /> {t('dashboardLayout.cardsWidget.title')}
        </h2>
        {rows.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('dashboardLayout.cardsWidget.toPay')}{' '}
            <span className="font-semibold tabular-nums text-foreground">{money(toPay, currency)}</span>
          </p>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted-foreground">{t('dashboardLayout.cardsWidget.noBills')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((bill) => (
            <li key={bill.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <div className="min-w-[10rem] flex-1">
                <p className="font-medium">
                  {bill.account_name}
                  {bill.masked_number ? ` · ${bill.masked_number}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('cardBills.dueOn', { date: new Date(`${bill.due_date}T00:00:00`).toLocaleDateString(dateLocale) })}
                </p>
              </div>
              <span className="text-right">
                <span className="font-medium tabular-nums">{money(bill.bank_total, bill.currency)}</span>
                {bill.estimated && (
                  <span className="block text-xs text-muted-foreground" title={t('cardBills.estimatedHint')}>
                    {t('cardBills.estimated')}
                  </span>
                )}
              </span>
              <BillStatusBadge status={bill.status} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-sm">
        {needsAttention ? (
          <span className="text-amber-600 dark:text-amber-400">{t('dashboardLayout.cardsWidget.unpaidInMonth')}</span>
        ) : (
          <span />
        )}
        <Link to="/faturas" className="font-medium text-primary hover:underline">
          {t('dashboardLayout.cardsWidget.viewAll')} →
        </Link>
      </div>
    </div>
  )
}
