/** Manual entries the bank sync may have seen, waiting for a decision.
 *
 *  The sync merges a bank charge into a manual entry alone only when there
 *  is one clear counterpart. Anything less lands here instead of being
 *  merged or duplicated without anyone looking, so the page stays out of
 *  the way until there is something to decide, and says nothing when
 *  there is not.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle } from 'lucide-react'
import { syncMatchSuggestions as api } from '@/lib/api'
import { extractApiError } from '@/lib/api-errors'
import { invalidateFinancialQueries } from '@/lib/invalidate-queries'
import { formatCurrency } from '@/lib/format'
import { useDateLocale, useDisplayLocale } from '@/hooks/use-display-locale'
import { usePrivacyMode } from '@/hooks/use-privacy-mode'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SyncMatchSide, SyncMatchSuggestion } from '@/types'

const QUERY_KEY = ['sync-match-suggestions']

function Side({ label, side }: { label: string; side: SyncMatchSide }) {
  const locale = useDisplayLocale()
  const dateLocale = useDateLocale()
  const { mask } = usePrivacyMode()
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium" title={side.description}>{side.description}</p>
      <p className="text-sm text-muted-foreground">
        {new Date(`${side.date}T00:00:00`).toLocaleDateString(dateLocale)}
        {' · '}
        {mask(formatCurrency(side.amount, side.currency, locale))}
      </p>
    </div>
  )
}

function Row({
  suggestion,
  canWrite,
  busy,
  onMerge,
  onDecline,
}: {
  suggestion: SyncMatchSuggestion
  canWrite: boolean
  busy: boolean
  onMerge: () => void
  onDecline: () => void
}) {
  const { t } = useTranslation()
  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="sync-match-row">
      <p className="text-sm text-muted-foreground">{t(`syncMatch.reason.${suggestion.reason}`)}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Side label={t('syncMatch.yours')} side={suggestion.manual} />
        <Side label={t('syncMatch.bank')} side={suggestion.synced} />
      </div>
      {canWrite && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={onDecline}>
            {t('syncMatch.keepBoth')}
          </Button>
          <Button size="sm" disabled={busy} onClick={onMerge}>
            {t('syncMatch.merge')}
          </Button>
        </div>
      )}
    </li>
  )
}

export function SyncMatchReview({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data: count } = useQuery({
    queryKey: [...QUERY_KEY, 'count'],
    queryFn: api.count,
  })
  const pending = count?.pending ?? 0

  const { data: suggestions = [] } = useQuery({
    queryKey: [...QUERY_KEY, 'list'],
    queryFn: () => api.list(),
    enabled: open && pending > 0,
  })

  const settle = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'merge' | 'decline' }) =>
      action === 'merge' ? api.merge(id) : api.decline(id),
    onSuccess: (_data, { action }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      if (action === 'merge') invalidateFinancialQueries(queryClient)
      toast.success(t(action === 'merge' ? 'syncMatch.merged' : 'syncMatch.kept'))
    },
    onError: (error) => toast.error(extractApiError(error)),
  })

  if (pending === 0) return null

  return (
    <>
      <div
        role="status"
        className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3"
        data-testid="sync-match-banner"
      >
        <AlertTriangle size={16} className="shrink-0 text-amber-500" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">{t('syncMatch.banner', { count: pending })}</p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t('syncMatch.review')}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('syncMatch.title')}</DialogTitle>
            <DialogDescription>{t('syncMatch.description')}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-3">
            {suggestions.map((suggestion) => (
              <Row
                key={suggestion.id}
                suggestion={suggestion}
                canWrite={canWrite}
                busy={settle.isPending}
                onMerge={() => settle.mutate({ id: suggestion.id, action: 'merge' })}
                onDecline={() => settle.mutate({ id: suggestion.id, action: 'decline' })}
              />
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
