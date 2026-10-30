import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/utils'

import { SavedFiltersBar } from './saved-filters-bar'

const state = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
  updateUser: vi.fn(),
  updateMe: vi.fn(),
}))

vi.mock('@/lib/api', () => ({ auth: { updateMe: state.updateMe } }))
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: { preferences: state.preferences }, updateUser: state.updateUser }),
}))

const filter = (id: string, name: string, query: string) => ({ id, name, query })

beforeEach(() => {
  vi.clearAllMocks()
  state.preferences = {}
  state.updateMe.mockImplementation(async (body: { preferences: Record<string, unknown> }) => ({
    preferences: body.preferences,
  }))
})

it('não aparece sem filtro salvo nem filtro aplicado', () => {
  renderWithProviders(<SavedFiltersBar workspaceId="w1" search="?from=2026-10-01&to=2026-10-31" onApply={vi.fn()} />)

  expect(screen.queryByTestId('saved-filters')).not.toBeInTheDocument()
})

it('lista os filtros do workspace e aplica um com o período em uso', async () => {
  state.preferences = {
    transaction_filters: {
      w1: [filter('f1', 'Pendentes', 'status=pending')],
      w2: [filter('f2', 'De outro workspace', 'type=debit')],
    },
  }
  const onApply = vi.fn()

  const { user } = renderWithProviders(
    <SavedFiltersBar workspaceId="w1" search="?from=2026-11-01&to=2026-11-30" onApply={onApply} />,
  )
  await user.click(screen.getByRole('button', { name: 'Pendentes' }))

  expect(screen.queryByText('De outro workspace')).not.toBeInTheDocument()
  const query = new URLSearchParams(onApply.mock.calls[0][0])
  expect(query.get('status')).toBe('pending')
  expect(query.get('from')).toBe('2026-11-01')
  expect(query.get('to')).toBe('2026-11-30')
})

it('marca o filtro que está aplicado', () => {
  state.preferences = { transaction_filters: { w1: [filter('f1', 'Pendentes', 'status=pending')] } }

  renderWithProviders(<SavedFiltersBar workspaceId="w1" search="?status=pending&from=2026-11-01" onApply={vi.fn()} />)

  expect(screen.getByRole('button', { name: 'Pendentes' })).toHaveAttribute('aria-pressed', 'true')
})

it('salva o filtro atual sem o período e sem perder outras preferências', async () => {
  state.preferences = { currency_display: 'BRL' }

  const { user } = renderWithProviders(
    <SavedFiltersBar
      workspaceId="w1"
      search="?status=pending&account_id=a1&from=2026-10-01&to=2026-10-31&view=calendar"
      onApply={vi.fn()}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Salvar filtro' }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Nome'), 'Pendentes do cartão')
  await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))

  await waitFor(() => expect(state.updateMe).toHaveBeenCalled())
  const sent = state.updateMe.mock.calls[0][0].preferences
  expect(sent.currency_display).toBe('BRL')
  const [saved] = sent.transaction_filters.w1
  expect(saved.name).toBe('Pendentes do cartão')
  expect(new URLSearchParams(saved.query).get('status')).toBe('pending')
  expect(saved.query).not.toContain('from=')
  expect(saved.query).not.toContain('view=')
  await waitFor(() => expect(state.updateUser).toHaveBeenCalled())
})

it('guarda o período quando se pede', async () => {
  const { user } = renderWithProviders(
    <SavedFiltersBar workspaceId="w1" search="?status=pending&from=2026-10-01&to=2026-10-31" onApply={vi.fn()} />,
  )
  await user.click(screen.getByRole('button', { name: 'Salvar filtro' }))
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText('Nome'), 'Outubro')
  await user.click(within(dialog).getByRole('checkbox'))
  await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))

  await waitFor(() => expect(state.updateMe).toHaveBeenCalled())
  expect(state.updateMe.mock.calls[0][0].preferences.transaction_filters.w1[0].query).toContain('from=2026-10-01')
})

it('não deixa salvar sem nome', async () => {
  const { user } = renderWithProviders(
    <SavedFiltersBar workspaceId="w1" search="?status=pending" onApply={vi.fn()} />,
  )
  await user.click(screen.getByRole('button', { name: 'Salvar filtro' }))
  const dialog = await screen.findByRole('dialog')

  expect(within(dialog).getByRole('button', { name: 'Salvar' })).toBeDisabled()
})

it('exclui um filtro sem mexer nos outros workspaces', async () => {
  state.preferences = {
    transaction_filters: {
      w1: [filter('f1', 'Pendentes', 'status=pending'), filter('f3', 'Débitos', 'type=debit')],
      w2: [filter('f2', 'Outro', 'type=credit')],
    },
  }

  const { user } = renderWithProviders(<SavedFiltersBar workspaceId="w1" search="" onApply={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Excluir o filtro Pendentes' }))

  await waitFor(() => expect(state.updateMe).toHaveBeenCalled())
  const sent = state.updateMe.mock.calls[0][0].preferences.transaction_filters
  expect(sent.w1.map((f: { id: string }) => f.id)).toEqual(['f3'])
  expect(sent.w2).toHaveLength(1)
})
