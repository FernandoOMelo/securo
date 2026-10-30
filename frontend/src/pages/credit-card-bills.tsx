/** Faturas dos cartões: o total que o banco informa contra o que o app tem.
 *
 *  Os pagamentos chegam sozinhos com a conexão bancária, então esta tela não
 *  registra nada: mostra se cada fatura confere, qual pagamento a quitou e
 *  quais lançamentos a compõem. Uma diferença é mostrada como diferença,
 *  nunca escondida, porque é ela que aponta lançamento faltando ou sobrando.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, CircleCheck, TriangleAlert } from 'lucide-react'
import { accounts as accountsApi, creditCardBills, transactions as transactionsApi } from '@/lib/api'
import { formatCurrency } from '@/lib/format'
import { useDateLocale, useDisplayLocale } from '@/hooks/use-display-locale'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BillStatus, CreditCardBillSummary } from '@/types'

const STATUS_TONE: Record<BillStatus, string> = {
  paid: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  partial: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  open: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  unpaid: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  zero: 'bg-muted text-muted-foreground',
}

function useMoney() {
  const locale = useDisplayLocale()
  const { mask } = usePrivacyMode()
  return (value: number, currency: string) => mask(formatCurrency(value, currency, locale))
}

function BillLines({ bill }: { bill: CreditCardBillSummary }) {
  const { t } = useTranslation()
  const dateLocale = useDateLocale()
  const money = useMoney()
  const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(dateLocale)

  const { data, isLoading } = useQuery({
    queryKey: ['credit-card-bills', bill.id, 'transactions'],
    queryFn: () => transactionsApi.list({ bill_id: bill.id, account_ids: [bill.account_id], limit: 200 }),
  })

  return (
    <div className="space-y-4 border-t border-border px-4 py-4 text-sm">
      {bill.payments.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('cardBills.payments')}
          </p>
          <ul className="space-y-1">
            {bill.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between gap-3">
                <span className="truncate">{day(payment.date)} · {payment.description}</span>
                <span className="shrink-0 tabular-nums">{money(payment.amount, bill.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('cardBills.charges')}
        </p>
        {isLoading ? (
          <p className="text-muted-foreground">{t('cardBills.loading')}</p>
        ) : !data?.items.length ? (
          <p className="text-muted-foreground">{t('cardBills.noCharges')}</p>
        ) : (
          <ul className="space-y-1">
            {data.items.map((tx) => (
              <li key={tx.id} className="flex justify-between gap-3">
                <span className="truncate">{day(tx.date)} · {tx.description}</span>
                <span
                  className={cn(
                    'shrink-0 tabular-nums',
                    tx.type === 'credit' && 'text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {tx.type === 'credit' ? '−' : ''}{money(tx.amount, tx.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function BillCard({ bill }: { bill: CreditCardBillSummary }) {
  const { t } = useTranslation()
  const dateLocale = useDateLocale()
  const money = useMoney()
  const [open, setOpen] = useState(false)
  const due = new Date(`${bill.due_date}T00:00:00`).toLocaleDateString(dateLocale)

  const payment =
    bill.status === 'paid'
      ? t('cardBills.paidOn', {
          date: new Date(`${bill.payments[bill.payments.length - 1]?.date ?? bill.due_date}T00:00:00`)
            .toLocaleDateString(dateLocale),
        })
      : bill.status === 'partial'
        ? t('cardBills.paidPart', {
            paid: money(bill.paid_amount, bill.currency),
            total: money(bill.bank_total, bill.currency),
          })
        : null

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-card" data-testid="card-bill">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-left hover:bg-muted/40"
      >
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <div className="min-w-[10rem] flex-1">
          <p className="font-medium">
            {bill.account_name}
            {bill.masked_number ? ` · ${bill.masked_number}` : ''}
          </p>
          <p className="text-sm text-muted-foreground">{t('cardBills.dueOn', { date: due })}</p>
        </div>
        <div className="min-w-[7rem]">
          <p className="text-xs text-muted-foreground">{t('cardBills.bankTotal')}</p>
          <p className="font-medium tabular-nums">{money(bill.bank_total, bill.currency)}</p>
        </div>
        <div className="min-w-[9rem]">
          <p className="text-xs text-muted-foreground">{t('cardBills.conference')}</p>
          {bill.matches ? (
            <p className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
              <CircleCheck size={14} aria-hidden /> {t('cardBills.matches')}
            </p>
          ) : (
            <p
              className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
              title={t('cardBills.differsHint', {
                bank: money(bill.bank_total, bill.currency),
                app: money(bill.app_total, bill.currency),
              })}
            >
              <TriangleAlert size={14} aria-hidden />
              {t('cardBills.differs', { value: money(Math.abs(bill.difference), bill.currency) })}
            </p>
          )}
        </div>
        <div className="min-w-[9rem]">
          <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', STATUS_TONE[bill.status])}>
            {t(`cardBills.status.${bill.status}`)}
          </span>
          {payment && <p className="mt-0.5 text-xs text-muted-foreground">{payment}</p>}
        </div>
      </button>
      {open && <BillLines bill={bill} />}
    </li>
  )
}

export default function CreditCardBillsPage() {
  const { t } = useTranslation()
  const [accountId, setAccountId] = useState('')

  const { data: allAccounts = [] } = useQuery({
    queryKey: ['accounts', 'list'],
    queryFn: () => accountsApi.list(),
  })
  const cards = useMemo(() => allAccounts.filter((account) => account.type === 'credit_card'), [allAccounts])

  const { data: bills, isLoading, isError } = useQuery({
    queryKey: ['credit-card-bills', accountId || 'all'],
    queryFn: () => creditCardBills.list(accountId || undefined),
  })

  return (
    <div>
      <PageHeader
        section={t('cardBills.section')}
        title={t('cardBills.title')}
        action={
          <div className="flex items-center gap-2">
            <select
              aria-label={t('cardBills.card')}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              <option value="">{t('cardBills.allCards')}</option>
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.display_name || card.name}
                  {card.masked_number ? ` · ${card.masked_number}` : ''}
                </option>
              ))}
            </select>
            <Button variant="outline" size="sm" asChild>
              <Link to="/accounts">{t('cardBills.backToAccounts')}</Link>
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('cardBills.loading')}</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-rose-600">{t('cardBills.error')}</p>
      ) : !bills?.length ? (
        <p className="text-sm text-muted-foreground">{t('cardBills.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {bills.map((bill) => (
            <BillCard key={bill.id} bill={bill} />
          ))}
        </ul>
      )}
    </div>
  )
}
