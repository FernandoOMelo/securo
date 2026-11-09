import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'

import { CategorySelect } from '@/components/category-select'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/format'
import type { Category, CategoryGroup } from '@/types'

/** Free-text tags as chips: Enter or comma adds one, suggestions come from
 *  the tags already in the workspace. */
export function TagsField({
  value,
  onChange,
  suggestions,
}: {
  value: string[]
  onChange: (next: string[]) => void
  suggestions: string[]
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  const add = (raw: string) => {
    const name = raw.trim().replace(/^#+/, '').trim()
    if (!name) return
    if (!value.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      onChange([...value, name])
    }
    setDraft('')
  }

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              #{tag}
              <button
                type="button"
                aria-label={t('transactions.removeTag', { tag })}
                onClick={() => onChange(value.filter((other) => other !== tag))}
                className="rounded-full hover:bg-primary/20"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={draft}
        list="transaction-tag-suggestions"
        placeholder={t('transactions.tagsPlaceholder')}
        className="bg-card"
        onChange={(e) => {
          const next = e.target.value
          if (next.endsWith(',')) add(next.slice(0, -1))
          else setDraft(next)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Enter adds the tag; it must not submit the whole form.
            e.preventDefault()
            add(draft)
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => add(draft)}
      />
      <datalist id="transaction-tag-suggestions">
        {suggestions
          .filter((name) => !value.some((tag) => tag.toLowerCase() === name.toLowerCase()))
          .map((name) => (
            <option key={name} value={name} />
          ))}
      </datalist>
    </div>
  )
}

export type CategoryPartDraft = { key: string; categoryId: string; amount: string }

/** Rows of category + amount that must add up to the transaction amount. */
export function CategoryPartsEditor({
  parts,
  onChange,
  total,
  parseAmount,
  currency,
  displayLocale,
  categories,
  groups,
}: {
  parts: CategoryPartDraft[]
  onChange: (next: CategoryPartDraft[]) => void
  total: number
  parseAmount: (value: string) => number | null
  currency: string
  displayLocale: string
  categories: Category[]
  groups: CategoryGroup[]
}) {
  const { t } = useTranslation()
  const distributed = parts.reduce((sum, part) => sum + (parseAmount(part.amount) ?? 0), 0)
  const difference = Math.round((total - distributed) * 100) / 100

  const update = (key: string, patch: Partial<CategoryPartDraft>) =>
    onChange(parts.map((part) => (part.key === key ? { ...part, ...patch } : part)))

  return (
    <div className="space-y-2 rounded-md border p-3">
      {parts.map((part) => (
        <div key={part.key} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
          <CategorySelect
            value={part.categoryId}
            onChange={(categoryId) => update(part.key, { categoryId })}
            categories={categories}
            groups={groups}
            className="bg-card"
          />
          <Input
            type="text"
            inputMode="decimal"
            value={part.amount}
            aria-label={t('transactions.partAmount')}
            onChange={(e) => update(part.key, { amount: e.target.value })}
            className="bg-card"
          />
          <button
            type="button"
            aria-label={t('transactions.removePart')}
            disabled={parts.length <= 2}
            onClick={() => onChange(parts.filter((other) => other.key !== part.key))}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-30"
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() =>
            onChange([...parts, { key: crypto.randomUUID(), categoryId: '', amount: '' }])
          }
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Plus size={14} />
          {t('transactions.addCategoryPart')}
        </button>
        <span
          className={
            difference === 0
              ? 'text-xs text-emerald-600 dark:text-emerald-400'
              : 'text-xs text-amber-600 dark:text-amber-400'
          }
        >
          {difference === 0
            ? t('transactions.partsOk')
            : difference > 0
              ? t('transactions.partsRemaining', { value: formatCurrency(difference, currency, displayLocale) })
              : t('transactions.partsExceeded', { value: formatCurrency(-difference, currency, displayLocale) })}
        </span>
      </div>
    </div>
  )
}
