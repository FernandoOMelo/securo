/**
 * O layout do dashboard: quais blocos aparecem, em que ordem e com que largura.
 *
 * O que fica salvo é só o que a pessoa escolheu, em `preferences`, uma lista
 * por workspace. Na leitura, `resolveLayout` completa o que faltar a partir do
 * padrão: um bloco criado depois de salvar aparece sozinho, e um bloco que
 * deixou de existir é descartado, então um layout antigo nunca quebra a tela.
 */

export const WIDGET_IDS = [
  'overview',
  'cards',
  'uncategorized',
  'categories',
  'evolution',
  'goals',
  'transactions',
] as const

export type WidgetId = (typeof WIDGET_IDS)[number]
export type WidgetWidth = 'half' | 'full'

export interface WidgetEntry {
  id: WidgetId
  visible: boolean
  width: WidgetWidth
}

export type DashboardLayout = WidgetEntry[]

export const DEFAULT_LAYOUT: DashboardLayout = [
  { id: 'overview', visible: true, width: 'full' },
  { id: 'cards', visible: true, width: 'full' },
  { id: 'uncategorized', visible: true, width: 'full' },
  { id: 'categories', visible: true, width: 'half' },
  { id: 'evolution', visible: true, width: 'half' },
  { id: 'goals', visible: true, width: 'full' },
  { id: 'transactions', visible: true, width: 'full' },
]

const isWidgetId = (value: unknown): value is WidgetId =>
  typeof value === 'string' && (WIDGET_IDS as readonly string[]).includes(value)

const isWidth = (value: unknown): value is WidgetWidth => value === 'half' || value === 'full'

/**
 * Layout salvo (ou lixo) -> layout completo e válido.
 *
 * Cada bloco aparece uma vez. Os conhecidos mantêm a ordem salva; os que não
 * estavam salvos entram no fim, com a visibilidade e a largura do padrão.
 */
export function resolveLayout(saved: unknown): DashboardLayout {
  const defaults = new Map(DEFAULT_LAYOUT.map((entry) => [entry.id, entry]))
  const seen = new Set<WidgetId>()
  const result: DashboardLayout = []

  if (Array.isArray(saved)) {
    for (const raw of saved) {
      if (!raw || typeof raw !== 'object') continue
      const { id, visible, width } = raw as Record<string, unknown>
      if (!isWidgetId(id) || seen.has(id)) continue
      seen.add(id)
      const base = defaults.get(id)!
      result.push({
        id,
        visible: typeof visible === 'boolean' ? visible : base.visible,
        width: isWidth(width) ? width : base.width,
      })
    }
  }

  for (const entry of DEFAULT_LAYOUT) {
    if (!seen.has(entry.id)) result.push({ ...entry })
  }
  return result
}

/** Sobe ou desce um bloco uma posição; no limite, devolve o layout como está. */
export function moveWidget(layout: DashboardLayout, id: WidgetId, direction: -1 | 1): DashboardLayout {
  const from = layout.findIndex((entry) => entry.id === id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= layout.length) return layout
  const next = [...layout]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

export function updateWidget(
  layout: DashboardLayout,
  id: WidgetId,
  patch: Partial<Pick<WidgetEntry, 'visible' | 'width'>>,
): DashboardLayout {
  return layout.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
}

export function layoutsEqual(a: DashboardLayout, b: DashboardLayout): boolean {
  return a.length === b.length && a.every((entry, index) => {
    const other = b[index]
    return entry.id === other.id && entry.visible === other.visible && entry.width === other.width
  })
}

/** Chave do layout de um workspace dentro de `preferences.dashboard_layouts`. */
export function layoutFor(
  layouts: Record<string, unknown> | undefined,
  workspaceId: string | null | undefined,
): DashboardLayout {
  return resolveLayout(workspaceId ? layouts?.[workspaceId] : undefined)
}
