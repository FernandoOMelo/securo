/**
 * Fluxo operacional na lista de transações: efetivar e ignorar a seleção, e
 * aplicar um filtro salvo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'

import TransactionsPage from '@/pages/transactions'
import { renderWithProviders } from '@/test/utils'
import type { Transaction } from '@/types'

const api = vi.hoisted(() => ({
  transactions: {
    list: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn(),
    bulkPost: vi.fn(), bulkIgnore: vi.fn(),
  },
  categories: { list: vi.fn(), listIncludingHidden: vi.fn() },
  categoryGroups: { list: vi.fn() },
  accounts: {
    get: vi.fn(), list: vi.fn(), bills: vi.fn(), summary: vi.fn(),
    update: vi.fn(), runningBalance: vi.fn(),
  },
  recurring: { list: vi.fn() },
  payees: { list: vi.fn() },
  admin: { accountingMode: vi.fn() },
  groups: { get: vi.fn(), list: vi.fn() },
  rules: { create: vi.fn() },
  reconciliation: { suggestions: vi.fn() },
  syncMatchSuggestions: { count: vi.fn() },
  currencies: { list: vi.fn() },
  settings: { attachments: vi.fn() },
  auth: { updateMe: vi.fn() },
  creditCardBills: { list: vi.fn() },
}))

vi.mock('@/lib/api', () => api)
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))
vi.mock('@/hooks/use-display-locale', () => ({
  useDisplayLocale: () => 'en-US',
  useDateLocale: () => 'en-US',
}))
vi.mock('@/hooks/use-privacy-mode', () => ({
  usePrivacyMode: () => ({ mask: (value: string) => value, privacyMode: false, MASK: '***' }),
}))
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      preferences: {
        currency_display: 'BRL',
        transaction_filters: { w1: [{ id: 'f1', name: 'Só pendentes', query: 'status=pending' }] },
      },
    },
    updateUser: vi.fn(),
  }),
}))
vi.mock('@/contexts/workspace-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/workspace-context')>()
  return {
    ...actual,
    useWorkspace: () => ({ canWrite: true, hasModule: () => true, current: { id: 'w1', name: 'Família' } }),
  }
})
vi.mock('@/contexts/collection-filter-context', () => ({
  useCollectionFilter: () => ({
    collections: [], activeCollectionId: null, activeCollection: null,
    setActiveCollectionId: () => {}, activeAccountIds: null, activeWalletIds: null,
  }),
}))

function tx(over: Partial<Transaction> & { id: string; description: string }): Transaction {
  return {
    user_id: 'user-1', account_id: 'acc-1', category_id: null, category: null,
    external_id: null, original_description: null, amount: 10, currency: 'BRL',
    date: '2026-10-08', type: 'debit', source: 'manual', status: 'pending',
    payee: null, payee_id: null, payee_name: null, notes: null,
    transfer_pair_id: null, transfer_counterpart: null, amount_primary: null,
    fx_rate_used: null, fx_fallback: false, installment_number: null,
    total_installments: null, installment_total_amount: null,
    installment_purchase_date: null, installment_series_id: null, bill_id: null,
    effective_bill_date: null, splits: [], is_ignored: false,
    ...over,
  }
}

const rows = [tx({ id: 'a', description: 'ALUGUEL' }), tx({ id: 'b', description: 'ACADEMIA' }), tx({ id: 'c', description: 'MERCADO' })]

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  api.transactions.list.mockResolvedValue({ items: rows, total: rows.length, page: 1, limit: 50 })
  api.transactions.bulkPost.mockResolvedValue({ updated: 2, skipped: 0 })
  api.transactions.bulkIgnore.mockResolvedValue({ updated: 2, skipped: 0 })
  api.categories.list.mockResolvedValue([])
  api.categories.listIncludingHidden.mockResolvedValue([])
  api.categoryGroups.list.mockResolvedValue([])
  api.accounts.list.mockResolvedValue([])
  api.recurring.list.mockResolvedValue([])
  api.payees.list.mockResolvedValue([])
  api.admin.accountingMode.mockResolvedValue(false)
  api.groups.list.mockResolvedValue([])
  api.reconciliation.suggestions.mockResolvedValue([])
  api.syncMatchSuggestions.count.mockResolvedValue({ pending: 0 })
  api.currencies.list.mockResolvedValue([])
  api.settings.attachments.mockResolvedValue(false)
  api.creditCardBills.list.mockResolvedValue([])
})

async function selectTwoRows() {
  const view = renderWithProviders(<TransactionsPage />, { route: '/transactions', path: '/transactions' })
  await screen.findByText('ALUGUEL')
  await view.user.click(within(rowOf('ALUGUEL')).getByRole('checkbox'))
  await view.user.click(within(rowOf('ACADEMIA')).getByRole('checkbox'))
  return view
}

describe('efetivar e ignorar a seleção', () => {
  it('efetiva as linhas marcadas com a data de hoje', async () => {
    const { user } = await selectTwoRows()

    await user.click(await screen.findByRole('button', { name: 'Efetivar' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Efetivar com a data de hoje' }))

    await waitFor(() => expect(api.transactions.bulkPost).toHaveBeenCalledWith(['a', 'b'], false))
  })

  it('efetiva mantendo a data de cada uma', async () => {
    const { user } = await selectTwoRows()

    await user.click(await screen.findByRole('button', { name: 'Efetivar' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Efetivar mantendo a data' }))

    await waitFor(() => expect(api.transactions.bulkPost).toHaveBeenCalledWith(['a', 'b'], true))
  })

  it('ignora a seleção e limpa as marcas depois', async () => {
    const { user } = await selectTwoRows()

    await user.click(await screen.findByRole('button', { name: 'Ignorar' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Ignorar selecionados' }))

    await waitFor(() => expect(api.transactions.bulkIgnore).toHaveBeenCalledWith(['a', 'b'], true))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Efetivar' })).not.toBeInTheDocument())
  })
})

describe('filtros salvos', () => {
  it('mostra o filtro do workspace e o aplica com um clique', async () => {
    const { user } = renderWithProviders(<TransactionsPage />, { route: '/transactions', path: '/transactions' })
    await screen.findByText('ALUGUEL')

    await user.click(screen.getByRole('button', { name: 'Só pendentes' }))

    await waitFor(() =>
      expect(api.transactions.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'pending' })),
    )
  })
})

describe('faturas na lista', () => {
  const openBill = {
    id: 'fat1', account_id: 'card', account_name: 'Cartão Itaú', masked_number: null, currency: 'BRL',
    due_date: '2026-10-08', bank_total: 1234.5, app_total: 1234.5, difference: 0, matches: true,
    transactions_count: 3, paid_amount: 0, status: 'open', payments: [], estimated: true,
  }

  it('mostra a fatura na data de vencimento, com valor e situação', async () => {
    api.creditCardBills.list.mockResolvedValue([openBill])
    renderWithProviders(<TransactionsPage />, { route: '/transactions?from=2026-10-01&to=2026-10-31', path: '/transactions' })

    const row = await screen.findByTestId('bill-row')

    expect(within(row).getByText('Fatura Cartão Itaú')).toBeInTheDocument()
    expect(within(row).getByText('A vencer')).toBeInTheDocument()
    expect(within(row).getByText('Estimada')).toBeInTheDocument()
    expect(within(row).getByText(/1\.234,50|1,234\.50/)).toBeInTheDocument()
  })

  it('segue na lista como paga depois de quitada', async () => {
    api.creditCardBills.list.mockResolvedValue([{ ...openBill, status: 'paid', estimated: false, paid_amount: 1234.5 }])
    renderWithProviders(<TransactionsPage />, { route: '/transactions?from=2026-10-01&to=2026-10-31', path: '/transactions' })

    expect(await within(await screen.findByTestId('bill-row')).findByText('Paga')).toBeInTheDocument()
  })

  it('não aparece quando um filtro de conteúdo está ativo', async () => {
    api.creditCardBills.list.mockResolvedValue([openBill])
    renderWithProviders(<TransactionsPage />, { route: '/transactions?from=2026-10-01&to=2026-10-31&status=pending', path: '/transactions' })
    await screen.findByText('ALUGUEL')

    expect(screen.queryByTestId('bill-row')).not.toBeInTheDocument()
  })
})
