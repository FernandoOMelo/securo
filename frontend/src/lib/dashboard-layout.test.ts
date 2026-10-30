import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  layoutFor,
  layoutsEqual,
  moveWidget,
  resolveLayout,
  updateWidget,
} from './dashboard-layout'

const ids = (layout: { id: string }[]) => layout.map((entry) => entry.id)

describe('resolveLayout', () => {
  it('devolve o padrão quando nada foi salvo', () => {
    expect(resolveLayout(undefined)).toEqual(DEFAULT_LAYOUT)
    expect(resolveLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(resolveLayout('lixo')).toEqual(DEFAULT_LAYOUT)
  })

  it('o padrão tem cada bloco conhecido uma vez', () => {
    expect([...ids(DEFAULT_LAYOUT)].sort()).toEqual([...WIDGET_IDS].sort())
  })

  it('mantém a ordem e as escolhas salvas', () => {
    const saved = [
      { id: 'transactions', visible: true, width: 'full' },
      { id: 'overview', visible: false, width: 'half' },
    ]

    const layout = resolveLayout(saved)

    expect(ids(layout).slice(0, 2)).toEqual(['transactions', 'overview'])
    expect(layout[1]).toEqual({ id: 'overview', visible: false, width: 'half' })
  })

  it('completa com os blocos que não estavam salvos, no fim e com o padrão deles', () => {
    const layout = resolveLayout([{ id: 'goals', visible: true, width: 'full' }])

    expect(layout).toHaveLength(WIDGET_IDS.length)
    expect(ids(layout)[0]).toBe('goals')
    expect(layout.find((entry) => entry.id === 'cards')).toEqual(
      DEFAULT_LAYOUT.find((entry) => entry.id === 'cards'),
    )
  })

  it('descarta blocos desconhecidos, repetidos e entradas inválidas', () => {
    const layout = resolveLayout([
      { id: 'inexistente', visible: true, width: 'full' },
      { id: 'goals', visible: true, width: 'full' },
      { id: 'goals', visible: false, width: 'half' },
      null,
      42,
      { visible: true },
    ])

    expect(ids(layout).filter((id) => id === 'goals')).toHaveLength(1)
    expect(layout.find((entry) => entry.id === 'goals')?.visible).toBe(true)
    expect(ids(layout)).not.toContain('inexistente')
    expect(layout).toHaveLength(WIDGET_IDS.length)
  })

  it('troca valores inválidos pelos do padrão, sem perder a posição', () => {
    const layout = resolveLayout([{ id: 'categories', visible: 'sim', width: 'enorme' }])

    expect(layout[0]).toEqual({ id: 'categories', visible: true, width: 'half' })
  })
})

describe('edição', () => {
  it('moveWidget troca de posição e para nos limites', () => {
    const moved = moveWidget(DEFAULT_LAYOUT, 'cards', -1)
    expect(ids(moved).slice(0, 2)).toEqual(['cards', 'overview'])
    expect(moveWidget(DEFAULT_LAYOUT, 'overview', -1)).toBe(DEFAULT_LAYOUT)
    expect(moveWidget(DEFAULT_LAYOUT, 'transactions', 1)).toBe(DEFAULT_LAYOUT)
  })

  it('moveWidget não altera o layout original', () => {
    const before = JSON.stringify(DEFAULT_LAYOUT)
    moveWidget(DEFAULT_LAYOUT, 'cards', 1)
    expect(JSON.stringify(DEFAULT_LAYOUT)).toBe(before)
  })

  it('updateWidget muda só o bloco pedido', () => {
    const next = updateWidget(DEFAULT_LAYOUT, 'goals', { visible: false })
    expect(next.find((entry) => entry.id === 'goals')?.visible).toBe(false)
    expect(next.filter((entry) => !entry.visible)).toHaveLength(1)
  })

  it('layoutsEqual compara ordem, visibilidade e largura', () => {
    expect(layoutsEqual(DEFAULT_LAYOUT, resolveLayout(undefined))).toBe(true)
    expect(layoutsEqual(DEFAULT_LAYOUT, moveWidget(DEFAULT_LAYOUT, 'cards', 1))).toBe(false)
    expect(layoutsEqual(DEFAULT_LAYOUT, updateWidget(DEFAULT_LAYOUT, 'goals', { width: 'half' }))).toBe(false)
  })
})

describe('layoutFor', () => {
  it('usa o layout do workspace e cai no padrão sem ele', () => {
    const saved = { w1: [{ id: 'goals', visible: false, width: 'full' }] }

    expect(layoutFor(saved, 'w1').find((entry) => entry.id === 'goals')?.visible).toBe(false)
    expect(layoutFor(saved, 'w2')).toEqual(DEFAULT_LAYOUT)
    expect(layoutFor(undefined, 'w1')).toEqual(DEFAULT_LAYOUT)
    expect(layoutFor(saved, null)).toEqual(DEFAULT_LAYOUT)
  })
})
