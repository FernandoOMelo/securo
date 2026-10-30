import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { accounts, creditCardBills, transactions } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import type { CreditCardBillSummary } from '@/types'

import CreditCardBillsPage from './credit-card-bills'

vi.mock('@/lib/api', () => ({
  accounts: { list: vi.fn() },
  creditCardBills: { list: vi.fn() },
  transactions: { list: vi.fn() },
}))
vi.mock('@/hooks/use-display-locale', () => ({
  useDisplayLocale: () => 'pt-BR',
  useDateLocale: () => 'pt-BR',
}))

const bill = (over: Partial<CreditCardBillSummary>): CreditCardBillSummary => ({
  id: 'b1',
  account_id: 'c1',
  account_name: 'Itaú Visa',
  masked_number: '4711',
  currency: 'BRL',
  due_date: '2026-10-20',
  bank_total: 1289.16,
  app_total: 1289.16,
  difference: 0,
  matches: true,
  transactions_count: 14,
  paid_amount: 1289.16,
  status: 'paid',
  payments: [{ id: 'p1', date: '2026-10-19', description: 'Pagamento de fatura', amount: 1289.16 }],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(accounts.list).mockResolvedValue([
    { id: 'c1', type: 'credit_card', name: 'Itaú Visa', display_name: null, masked_number: '4711' },
    { id: 'k1', type: 'checking', name: 'Conta', display_name: null, masked_number: null },
  ] as never)
  vi.mocked(transactions.list).mockResolvedValue({
    items: [
      { id: 't1', date: '2026-09-25', description: 'Mercado Central', amount: 100, currency: 'BRL', type: 'debit' },
      { id: 't2', date: '2026-09-26', description: 'Estorno loja', amount: 20, currency: 'BRL', type: 'credit' },
    ],
    total: 2, page: 1, limit: 200,
  } as never)
})

it('mostra cada fatura com conferência e situação do pagamento', async () => {
  vi.mocked(creditCardBills.list).mockResolvedValue([
    bill({}),
    bill({
      id: 'b2', due_date: '2026-09-20', bank_total: 400, app_total: 350, difference: 50,
      matches: false, paid_amount: 0, status: 'unpaid', payments: [],
    }),
  ])

  renderWithProviders(<CreditCardBillsPage />)

  const rows = await screen.findAllByTestId('card-bill')
  expect(within(rows[0]).getByText('Confere com o app')).toBeInTheDocument()
  expect(within(rows[0]).getByText('Paga')).toBeInTheDocument()
  expect(within(rows[1]).getByText(/Diferença de/)).toBeInTheDocument()
  expect(within(rows[1]).getByText('Sem pagamento identificado')).toBeInTheDocument()
})

it('expande a fatura com os pagamentos e os lançamentos dela', async () => {
  vi.mocked(creditCardBills.list).mockResolvedValue([bill({})])

  const { user } = renderWithProviders(<CreditCardBillsPage />)
  await user.click(await screen.findByRole('button', { name: /Itaú Visa/ }))

  expect(await screen.findByText(/Pagamento de fatura/)).toBeInTheDocument()
  expect(await screen.findByText(/Mercado Central/)).toBeInTheDocument()
  expect(screen.getByText(/Estorno loja/)).toBeInTheDocument()
  expect(transactions.list).toHaveBeenCalledWith(
    expect.objectContaining({ bill_id: 'b1', account_ids: ['c1'] }),
  )
})

it('filtra por cartão e só oferece cartões de crédito', async () => {
  vi.mocked(creditCardBills.list).mockResolvedValue([bill({})])

  const { user } = renderWithProviders(<CreditCardBillsPage />)
  const select = await screen.findByLabelText('Cartão')
  await waitFor(() => expect(within(select).getByRole('option', { name: /Itaú Visa/ })).toBeInTheDocument())
  expect(within(select).queryByRole('option', { name: 'Conta' })).not.toBeInTheDocument()

  await user.selectOptions(select, 'c1')

  await waitFor(() => expect(creditCardBills.list).toHaveBeenLastCalledWith('c1'))
})

it('avisa quando não há faturas', async () => {
  vi.mocked(creditCardBills.list).mockResolvedValue([])

  renderWithProviders(<CreditCardBillsPage />)

  expect(await screen.findByText(/Nenhuma fatura encontrada/)).toBeInTheDocument()
})
