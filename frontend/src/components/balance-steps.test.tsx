import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { renderWithProviders } from '@/test/utils'

import { BalanceSteps } from './balance-steps'

const setup = (over: Partial<Parameters<typeof BalanceSteps>[0]> = {}) =>
  renderWithProviders(
    <BalanceSteps opening={955.14} current={97.9} projected={-20} currency="BRL" locale="pt-BR" {...over} />,
  )

it('mostra o saldo inicial, o atual em destaque e o previsto', () => {
  setup()

  expect(screen.getByText('Inicial')).toBeInTheDocument()
  expect(screen.getByText('Saldo atual')).toBeInTheDocument()
  expect(screen.getByText('Previsto')).toBeInTheDocument()
  expect(screen.getByText(/955,14/)).toBeInTheDocument()
  expect(screen.getByText(/97,90/)).toBeInTheDocument()
  expect(screen.getByText(/20,00/)).toBeInTheDocument()
})

it('pinta de vermelho o previsto negativo', () => {
  setup()

  expect(screen.getByText(/20,00/).className).toContain('text-rose-500')
})
