import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { formatCurrency } from '@/lib/format'

interface BalanceStepsProps {
  /** Saldo no começo do mês. */
  opening: number
  /** Saldo de agora. */
  current: number
  /** Onde o mês deve terminar, com o que ainda está pendente. */
  projected: number
  currency: string
  locale: string
}

const tone = (value: number) => (value < 0 ? 'text-rose-500' : 'text-foreground')

/** Inicial → saldo atual → previsto, no mesmo desenho de um passo a passo. */
export function BalanceSteps({ opening, current, projected, currency, locale }: BalanceStepsProps) {
  const { t } = useTranslation()
  const { mask } = usePrivacyMode()
  const money = (value: number) => mask(formatCurrency(value, currency, locale))

  return (
    <div data-testid="balance-steps" className="rounded-2xl bg-muted/40 px-4 py-4 sm:px-6">
      <div className="relative grid grid-cols-[1fr_1.4fr_1fr] items-start text-center">
        {/* Os fios ficam atrás dos pontos, que têm fundo próprio. */}
        <span aria-hidden className="absolute top-[9px] left-[14.7%] h-0.5 w-[35.3%] bg-blue-600" />
        <span aria-hidden className="absolute top-[9px] left-[50%] w-[35.3%] border-t-2 border-dotted border-muted-foreground/40" />
        <div className="relative flex flex-col items-center" title={t('dashboard.balanceInitialHint')}>
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <span className={`mt-2 text-sm tabular-nums text-muted-foreground`}>{money(opening)}</span>
          <span className="text-xs text-muted-foreground">{t('dashboard.balanceInitial')}</span>
        </div>

        <div className="relative flex flex-col items-center">
          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-blue-600 bg-background">
            <span className="h-2 w-2 rounded-full bg-blue-600" />
          </span>
          <span className={`mt-2 text-2xl sm:text-3xl font-bold tabular-nums leading-tight ${tone(current)}`}>
            {money(current)}
          </span>
          <span className="text-xs text-muted-foreground">{t('dashboard.balanceCurrent')}</span>
        </div>

        <div className="relative flex flex-col items-center" title={t('dashboard.balanceForecastHint')}>
          <span className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 bg-muted" />
          <span className={`mt-2 text-sm tabular-nums ${projected < 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>
            {money(projected)}
          </span>
          <span className="text-xs text-muted-foreground">{t('dashboard.balanceForecast')}</span>
        </div>
      </div>
    </div>
  )
}
