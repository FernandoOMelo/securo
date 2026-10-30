/**
 * Filtros salvos da lista de transações.
 *
 * Um filtro salvo é a própria query string da página (ela já guarda todos os
 * filtros na URL), então salvar e aplicar não precisam conhecer cada filtro. O
 * período fica de fora por padrão: "contas do cartão, pendentes" serve a
 * qualquer mês, e aplicar o filtro mantém o período que a pessoa já está vendo.
 *
 * Ficam em `preferences.transaction_filters`, uma lista por workspace, porque
 * contas e categorias de um workspace não existem no outro.
 */

export interface SavedFilter {
  id: string
  name: string
  /** Query string sem o `?`. */
  query: string
}

export const MAX_SAVED_FILTERS = 20
export const MAX_FILTER_NAME = 40

/** Parâmetros que descrevem a tela, não um filtro. `hide_ignored` é uma preferência guardada no navegador. */
const VIEW_PARAMS = ['view', 'day', 'page', 'hide_ignored']
const PERIOD_PARAMS = ['from', 'to']

const toParams = (search: string) => new URLSearchParams(search.replace(/^\?/, ''))

/** Há algum filtro aplicado? Só o período e a visão não contam. */
export function hasActiveFilters(search: string): boolean {
  const params = toParams(search)
  return [...params.keys()].some(
    (key) => !VIEW_PARAMS.includes(key) && !PERIOD_PARAMS.includes(key) && params.get(key) !== '',
  )
}

/** A query a guardar: sem a visão e, a menos que se peça, sem o período. */
export function serializeFilters(search: string, includePeriod: boolean): string {
  const source = toParams(search)
  const kept = new URLSearchParams()
  for (const [key, value] of source) {
    if (VIEW_PARAMS.includes(key) || value === '') continue
    if (!includePeriod && PERIOD_PARAMS.includes(key)) continue
    kept.append(key, value)
  }
  return kept.toString()
}

/** A query para navegar ao aplicar: o filtro salvo, com o período atual se ele não trouxer um. */
export function queryToApply(saved: SavedFilter, currentSearch: string): string {
  const next = toParams(saved.query)
  const hasPeriod = PERIOD_PARAMS.some((key) => next.has(key))
  if (!hasPeriod) {
    const current = toParams(currentSearch)
    for (const key of PERIOD_PARAMS) {
      const value = current.get(key)
      if (value) next.set(key, value)
    }
  }
  return next.toString()
}

/** O filtro salvo está aplicado agora? Compara só o que o filtro define. */
export function isApplied(saved: SavedFilter, currentSearch: string): boolean {
  const wanted = toParams(saved.query)
  const current = toParams(currentSearch)
  const keys = new Set([...wanted.keys(), ...current.keys()].filter((key) => !VIEW_PARAMS.includes(key)))
  for (const key of keys) {
    if (PERIOD_PARAMS.includes(key) && !wanted.has(key)) continue
    if (wanted.get(key) !== current.get(key)) return false
  }
  return keys.size > 0
}

type Store = Record<string, unknown> | undefined

const isFilter = (value: unknown): value is SavedFilter => {
  if (!value || typeof value !== 'object') return false
  const { id, name, query } = value as Record<string, unknown>
  return typeof id === 'string' && typeof name === 'string' && name.trim() !== '' && typeof query === 'string'
}

/** Os filtros de um workspace; qualquer coisa que não seja um filtro válido é descartada. */
export function filtersFor(store: Store, workspaceId: string | null | undefined): SavedFilter[] {
  const list = workspaceId ? store?.[workspaceId] : undefined
  return Array.isArray(list) ? list.filter(isFilter) : []
}

export function withFilter(store: Store, workspaceId: string, filter: SavedFilter): Record<string, SavedFilter[]> {
  const current = (store ?? {}) as Record<string, SavedFilter[]>
  return { ...current, [workspaceId]: [...filtersFor(store, workspaceId), filter] }
}

export function withoutFilter(store: Store, workspaceId: string, id: string): Record<string, SavedFilter[]> {
  const current = (store ?? {}) as Record<string, SavedFilter[]>
  return { ...current, [workspaceId]: filtersFor(store, workspaceId).filter((filter) => filter.id !== id) }
}

export function newFilterId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
