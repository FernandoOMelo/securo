/** Ações em lote sobre o status dos lançamentos selecionados: efetivar e ignorar.
 *
 *  Ficam num componente à parte da barra de seleção: o mesmo par de menus serve
 *  à barra do computador e ao menu do celular.
 */
import { useTranslation } from 'react-i18next'
import { CircleCheck, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface Props {
  disabled?: boolean
  onPost: (keepDate: boolean) => void
  onIgnore: (ignored: boolean) => void
}

export function BulkStatusActions({ disabled, onPost, onIgnore }: Props) {
  const { t } = useTranslation()
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title={t('operationalFlow.post')}
            className="h-8 shrink-0 px-3 text-sm"
          >
            <CircleCheck size={15} className="lg:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">{t('operationalFlow.post')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuItem onSelect={() => onPost(false)}>{t('operationalFlow.postToday')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onPost(true)}>{t('operationalFlow.postKeepDate')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title={t('operationalFlow.ignore')}
            className="h-8 shrink-0 px-3 text-sm"
          >
            <EyeOff size={15} className="lg:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">{t('operationalFlow.ignore')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuItem onSelect={() => onIgnore(true)}>{t('operationalFlow.ignoreSelected')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onIgnore(false)}>{t('operationalFlow.restoreSelected')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
