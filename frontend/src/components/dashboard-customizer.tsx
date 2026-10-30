/** Escolher o que o painel mostra, em que ordem e com que largura.
 *
 *  Edita uma cópia: nada muda no painel até "Salvar", e "Restaurar padrão"
 *  também só mexe na cópia, para dar para voltar atrás cancelando.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DEFAULT_LAYOUT,
  layoutsEqual,
  moveWidget,
  updateWidget,
  type DashboardLayout,
  type WidgetWidth,
} from '@/lib/dashboard-layout'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  layout: DashboardLayout
  workspaceName: string
  saving: boolean
  onSave: (layout: DashboardLayout) => void
}

function Editor({ layout, workspaceName, saving, onSave, onCancel }: Omit<Props, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<DashboardLayout>(layout)
  const changed = !layoutsEqual(draft, layout)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('dashboardLayout.title')}</DialogTitle>
        <DialogDescription>{t('dashboardLayout.hint', { name: workspaceName })}</DialogDescription>
      </DialogHeader>

      <ul className="space-y-2">
        {draft.map((entry, index) => (
          <li
            key={entry.id}
            data-testid="layout-row"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div className="flex flex-col">
              <button
                type="button"
                aria-label={t('dashboardLayout.moveUp', { name: t(`dashboardLayout.widgets.${entry.id}`) })}
                disabled={index === 0}
                onClick={() => setDraft(moveWidget(draft, entry.id, -1))}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp size={14} aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t('dashboardLayout.moveDown', { name: t(`dashboardLayout.widgets.${entry.id}`) })}
                disabled={index === draft.length - 1}
                onClick={() => setDraft(moveWidget(draft, entry.id, 1))}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown size={14} aria-hidden />
              </button>
            </div>

            <span
              id={`layout-label-${entry.id}`}
              className={cn('min-w-0 flex-1 text-sm font-medium', !entry.visible && 'text-muted-foreground line-through')}
            >
              {t(`dashboardLayout.widgets.${entry.id}`)}
            </span>

            <div className="flex overflow-hidden rounded-md border border-border text-xs" role="group">
              {(['half', 'full'] as WidgetWidth[]).map((width) => (
                <button
                  key={width}
                  type="button"
                  aria-pressed={entry.width === width}
                  onClick={() => setDraft(updateWidget(draft, entry.id, { width }))}
                  className={cn(
                    'px-2 py-1',
                    entry.width === width ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                  )}
                >
                  {t(width === 'half' ? 'dashboardLayout.widthHalf' : 'dashboardLayout.widthFull')}
                </button>
              ))}
            </div>

            <Switch
              checked={entry.visible}
              aria-labelledby={`layout-label-${entry.id}`}
              onCheckedChange={(visible) => setDraft(updateWidget(draft, entry.id, { visible }))}
            />
          </li>
        ))}
      </ul>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={layoutsEqual(draft, DEFAULT_LAYOUT)}
          onClick={() => setDraft(DEFAULT_LAYOUT.map((entry) => ({ ...entry })))}
        >
          {t('dashboardLayout.reset')}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>{t('dashboardLayout.cancel')}</Button>
          <Button size="sm" disabled={!changed || saving} onClick={() => onSave(draft)}>
            {t('dashboardLayout.save')}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

export function DashboardCustomizer({ open, onOpenChange, layout, workspaceName, saving, onSave }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        {/* O editor só existe com o diálogo aberto: cada abertura parte do layout salvo. */}
        {open && (
          <Editor
            layout={layout}
            workspaceName={workspaceName}
            saving={saving}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
