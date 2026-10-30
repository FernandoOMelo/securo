import { screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/utils'

import { BulkStatusActions } from './bulk-status-actions'

const setup = (disabled = false) => {
  const onPost = vi.fn()
  const onIgnore = vi.fn()
  const view = renderWithProviders(<BulkStatusActions disabled={disabled} onPost={onPost} onIgnore={onIgnore} />)
  return { ...view, onPost, onIgnore }
}

it('efetiva com a data de hoje ou mantendo a data', async () => {
  const { user, onPost } = setup()

  await user.click(screen.getByRole('button', { name: 'Efetivar' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Efetivar com a data de hoje' }))
  await user.click(screen.getByRole('button', { name: 'Efetivar' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Efetivar mantendo a data' }))

  expect(onPost.mock.calls).toEqual([[false], [true]])
})

it('ignora e reativa a seleção', async () => {
  const { user, onIgnore } = setup()

  await user.click(screen.getByRole('button', { name: 'Ignorar' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Ignorar selecionados' }))
  await user.click(screen.getByRole('button', { name: 'Ignorar' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Reativar selecionados' }))

  expect(onIgnore.mock.calls).toEqual([[true], [false]])
})

it('desliga os dois menus enquanto uma ação está em andamento', () => {
  setup(true)

  expect(screen.getByRole('button', { name: 'Efetivar' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Ignorar' })).toBeDisabled()
})
