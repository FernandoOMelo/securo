import { describe, expect, it } from 'vitest'

import {
  filtersFor,
  hasActiveFilters,
  isApplied,
  queryToApply,
  serializeFilters,
  withFilter,
  withoutFilter,
  type SavedFilter,
} from './saved-filters'

const saved = (query: string, id = 'f1'): SavedFilter => ({ id, name: 'Filtro', query })

describe('hasActiveFilters', () => {
  it('período e visão sozinhos não são filtro', () => {
    expect(hasActiveFilters('')).toBe(false)
    expect(hasActiveFilters('?from=2026-10-01&to=2026-10-31')).toBe(false)
    expect(hasActiveFilters('?view=calendar&day=2026-10-05')).toBe(false)
    expect(hasActiveFilters('?hide_ignored=true')).toBe(false)
  })

  it('qualquer outro parâmetro com valor é filtro', () => {
    expect(hasActiveFilters('?status=pending')).toBe(true)
    expect(hasActiveFilters('?from=2026-10-01&account_id=a1')).toBe(true)
  })

  it('parâmetro vazio não conta', () => {
    expect(hasActiveFilters('?status=')).toBe(false)
  })
})

describe('serializeFilters', () => {
  const search = '?status=pending&account_id=a1,a2&from=2026-10-01&to=2026-10-31&view=calendar&day=2026-10-05&q='

  it('guarda os filtros, sem a visão e sem o período por padrão', () => {
    expect(serializeFilters(search, false)).toBe('status=pending&account_id=a1%2Ca2')
  })

  it('guarda o período quando se pede', () => {
    expect(serializeFilters(search, true)).toBe('status=pending&account_id=a1%2Ca2&from=2026-10-01&to=2026-10-31')
  })

  it('não guarda a preferência de ocultar ignorados', () => {
    expect(serializeFilters('?status=pending&hide_ignored=true', false)).toBe('status=pending')
  })

  it('aceita a query com ou sem o ?', () => {
    expect(serializeFilters('type=debit', false)).toBe('type=debit')
  })
})

describe('queryToApply', () => {
  it('mantém o período em uso quando o filtro não tem um', () => {
    const query = queryToApply(saved('status=pending'), '?from=2026-11-01&to=2026-11-30&type=credit')

    expect(new URLSearchParams(query).get('from')).toBe('2026-11-01')
    expect(new URLSearchParams(query).get('to')).toBe('2026-11-30')
    expect(new URLSearchParams(query).get('status')).toBe('pending')
    expect(new URLSearchParams(query).has('type')).toBe(false) // o filtro anterior sai
  })

  it('usa o período do próprio filtro quando ele tem um', () => {
    const query = queryToApply(saved('status=pending&from=2026-01-01&to=2026-01-31'), '?from=2026-11-01&to=2026-11-30')

    expect(new URLSearchParams(query).get('from')).toBe('2026-01-01')
  })

  it('sem período em uso, não inventa um', () => {
    expect(queryToApply(saved('status=pending'), '')).toBe('status=pending')
  })
})

describe('isApplied', () => {
  it('reconhece o filtro aplicado, ignorando o período e a visão', () => {
    expect(isApplied(saved('status=pending'), '?status=pending&from=2026-11-01&to=2026-11-30')).toBe(true)
    expect(isApplied(saved('status=pending'), '?status=pending&view=calendar')).toBe(true)
  })

  it('não reconhece quando algo difere ou sobra', () => {
    expect(isApplied(saved('status=pending'), '?status=posted')).toBe(false)
    expect(isApplied(saved('status=pending'), '?status=pending&type=debit')).toBe(false)
    expect(isApplied(saved('status=pending'), '')).toBe(false)
  })
})

describe('armazenamento por workspace', () => {
  it('lê só os filtros do workspace e descarta o que não é filtro', () => {
    const store = { w1: [saved('a=1'), { id: 'x' }, null, { id: 'y', name: ' ', query: 'b=2' }], w2: [saved('c=3', 'f2')] }

    expect(filtersFor(store, 'w1').map((f) => f.id)).toEqual(['f1'])
    expect(filtersFor(store, 'w2').map((f) => f.id)).toEqual(['f2'])
    expect(filtersFor(store, 'w3')).toEqual([])
    expect(filtersFor(undefined, 'w1')).toEqual([])
    expect(filtersFor(store, null)).toEqual([])
  })

  it('withFilter e withoutFilter não mexem nos outros workspaces nem no original', () => {
    const store = { w1: [saved('a=1')], w2: [saved('c=3', 'f2')] }
    const before = JSON.stringify(store)

    const added = withFilter(store, 'w1', saved('b=2', 'f3'))
    expect(added.w1.map((f) => f.id)).toEqual(['f1', 'f3'])
    expect(added.w2).toBe(store.w2)

    const removed = withoutFilter(added, 'w1', 'f1')
    expect(removed.w1.map((f) => f.id)).toEqual(['f3'])
    expect(JSON.stringify(store)).toBe(before)
  })
})
