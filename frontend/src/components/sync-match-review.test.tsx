import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { syncMatchSuggestions } from '@/lib/api'
import { renderWithProviders } from '@/test/utils'
import type { SyncMatchSuggestion } from '@/types'

import { SyncMatchReview } from './sync-match-review'

vi.mock('@/lib/api', () => ({
  syncMatchSuggestions: { count: vi.fn(), list: vi.fn(), merge: vi.fn(), decline: vi.fn() },
}))

vi.mock('@/hooks/use-display-locale', () => ({
  useDisplayLocale: () => 'en-US',
  useDateLocale: () => 'en-US',
}))

const suggestion: SyncMatchSuggestion = {
  id: 's1',
  account_id: 'a1',
  reason: 'description',
  score: 0.5,
  manual: {
    id: 'm1', description: 'Mercado', amount: 25, currency: 'BRL',
    date: '2026-04-10', status: 'posted', source: 'manual',
  },
  synced: {
    id: 'b1', description: 'SUPERMERCADO ABC', amount: 25, currency: 'BRL',
    date: '2026-04-10', status: 'posted', source: 'sync',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(syncMatchSuggestions.count).mockResolvedValue({ pending: 1 })
  vi.mocked(syncMatchSuggestions.list).mockResolvedValue([suggestion])
  vi.mocked(syncMatchSuggestions.merge).mockResolvedValue(undefined)
  vi.mocked(syncMatchSuggestions.decline).mockResolvedValue(undefined)
})

it('renders nothing when there is nothing to decide', async () => {
  vi.mocked(syncMatchSuggestions.count).mockResolvedValue({ pending: 0 })

  renderWithProviders(<SyncMatchReview canWrite />)

  await waitFor(() => expect(syncMatchSuggestions.count).toHaveBeenCalled())
  expect(screen.queryByTestId('sync-match-banner')).not.toBeInTheDocument()
})

it('shows both sides and merges on request', async () => {
  const { user } = renderWithProviders(<SyncMatchReview canWrite />)

  await user.click(await screen.findByRole('button', { name: 'Review' }))
  const row = await screen.findByTestId('sync-match-row')
  expect(within(row).getByText('Mercado')).toBeInTheDocument()
  expect(within(row).getByText('SUPERMERCADO ABC')).toBeInTheDocument()

  await user.click(within(row).getByRole('button', { name: 'Same charge, merge' }))

  await waitFor(() => expect(syncMatchSuggestions.merge).toHaveBeenCalledWith('s1'))
  expect(syncMatchSuggestions.decline).not.toHaveBeenCalled()
})

it('keeps both entries when they are different charges', async () => {
  const { user } = renderWithProviders(<SyncMatchReview canWrite />)

  await user.click(await screen.findByRole('button', { name: 'Review' }))
  await user.click(await screen.findByRole('button', { name: 'Different charges' }))

  await waitFor(() => expect(syncMatchSuggestions.decline).toHaveBeenCalledWith('s1'))
  expect(syncMatchSuggestions.merge).not.toHaveBeenCalled()
})

it('lets a read-only member look but not decide', async () => {
  const { user } = renderWithProviders(<SyncMatchReview canWrite={false} />)

  await user.click(await screen.findByRole('button', { name: 'Review' }))

  expect(await screen.findByTestId('sync-match-row')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Same charge, merge' })).not.toBeInTheDocument()
})
