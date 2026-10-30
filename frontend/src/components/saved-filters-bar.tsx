/** Filtros salvos da lista de transações: um clique aplica, e o filtro atual pode ser guardado.
 *
 *  Não aparece enquanto não há o que mostrar: nenhum filtro salvo e nenhum
 *  filtro aplicado para salvar.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Bookmark, BookmarkPlus, X } from 'lucide-react'
import { auth as authApi } from '@/lib/api'
import { extractApiError } from '@/lib/api-errors'
import { useAuth } from '@/contexts/auth-context'
import {
  MAX_FILTER_NAME,
  MAX_SAVED_FILTERS,
  filtersFor,
  hasActiveFilters,
  isApplied,
  newFilterId,
  queryToApply,
  serializeFilters,
  withFilter,
  withoutFilter,
} from '@/lib/saved-filters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface Props {
  workspaceId: string | null | undefined
  /** A query string da página agora (os filtros em uso). */
  search: string
  onApply: (query: string) => void
}

export function SavedFiltersBar({ workspaceId, search, onApply }: Props) {
  const { t } = useTranslation()
  const { user, updateUser } = useAuth()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [includePeriod, setIncludePeriod] = useState(false)

  const store = user?.preferences?.transaction_filters
  const filters = filtersFor(store, workspaceId)
  const canSave = hasActiveFilters(search) && filters.length < MAX_SAVED_FILTERS

  const persist = useMutation({
    mutationFn: (next: Record<string, unknown>) =>
      authApi.updateMe({ preferences: { ...(user?.preferences ?? {}), transaction_filters: next } }),
    onSuccess: (updated) => updateUser(updated),
    onError: (error) => toast.error(extractApiError(error, t('savedFilters.saveError'))),
  })

  if (!workspaceId || (filters.length === 0 && !canSave)) return null

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    persist.mutate(
      withFilter(store, workspaceId, {
        id: newFilterId(),
        name: trimmed.slice(0, MAX_FILTER_NAME),
        query: serializeFilters(search, includePeriod),
      }),
      {
        onSuccess: () => {
          setSaving(false)
          setName('')
          setIncludePeriod(false)
          toast.success(t('savedFilters.saved'))
        },
      },
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="saved-filters">
        {filters.length > 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Bookmark size={13} aria-hidden /> {t('savedFilters.label')}
          </span>
        )}
        {filters.map((filter) => {
          const applied = isApplied(filter, search)
          return (
            <span
              key={filter.id}
              className={cn(
                'inline-flex items-center overflow-hidden rounded-full border text-sm',
                applied ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-foreground',
              )}
            >
              <button
                type="button"
                aria-pressed={applied}
                onClick={() => onApply(queryToApply(filter, search))}
                className="px-3 py-1 hover:bg-muted/60"
              >
                {filter.name}
              </button>
              <button
                type="button"
                aria-label={t('savedFilters.remove', { name: filter.name })}
                disabled={persist.isPending}
                onClick={() => persist.mutate(withoutFilter(store, workspaceId, filter.id))}
                className="border-l border-border/60 px-1.5 py-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          )
        })}
        {canSave && (
          <Button variant="outline" size="sm" className="h-8 rounded-full" onClick={() => setSaving(true)}>
            <BookmarkPlus size={14} className="mr-1.5" aria-hidden />
            {t('savedFilters.save')}
          </Button>
        )}
      </div>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t('savedFilters.dialogTitle')}</DialogTitle>
              <DialogDescription>{t('savedFilters.dialogHint')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <label htmlFor="saved-filter-name" className="text-sm font-medium">{t('savedFilters.name')}</label>
              <Input
                id="saved-filter-name"
                autoFocus
                maxLength={MAX_FILTER_NAME}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('savedFilters.namePlaceholder')}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={includePeriod}
                onChange={(event) => setIncludePeriod(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
              />
              <span>
                {t('savedFilters.includePeriod')}
                <span className="block text-xs text-muted-foreground">{t('savedFilters.includePeriodHint')}</span>
              </span>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setSaving(false)}>
                {t('savedFilters.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={!name.trim() || persist.isPending}>
                {t('savedFilters.confirm')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
