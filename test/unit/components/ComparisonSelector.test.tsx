import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectInput } from '@payloadcms/ui'
import { ComparisonSelector } from '@/components/ComparisonSelector'
import type { ComparisonData } from '@/types'

// Keep the real SelectInput, but spy on it so a test can reach the props it was given
vi.mock('@payloadcms/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@payloadcms/ui')>()
  return { ...actual, SelectInput: vi.fn(actual.SelectInput) }
})

const renderSelector = (value: ComparisonData | null = null) => {
  const onChange = vi.fn<(value: ComparisonData | null) => void>()
  const utils = render(<ComparisonSelector value={value} onChange={onChange} currentPeriod="7d" />)
  return { ...utils, onChange }
}

const lastSelectInputProps = () => {
  const props = vi.mocked(SelectInput).mock.lastCall?.[0]
  if (!props) {
    throw new Error('SelectInput was not rendered')
  }
  return props
}

// Open the Payload SelectInput (react-select) and pick an option
const selectOption = async (
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  optionLabel: string,
) => {
  const control = container.querySelector('#field-analytics-comparison .rs__control')
  if (!(control instanceof HTMLElement)) {
    throw new Error('No comparison select control')
  }
  await user.click(control)
  await user.click(await screen.findByRole('option', { name: optionLabel }))
}

const selectedLabel = (container: HTMLElement) =>
  container.querySelector('#field-analytics-comparison .rs__single-value')?.textContent

describe('ComparisonSelector', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render a "Compare to" select with the four comparison options', async () => {
    const user = userEvent.setup()
    const { container } = renderSelector()

    expect(screen.getByText('Compare to')).toBeInTheDocument()
    const control = container.querySelector('#field-analytics-comparison .rs__control')
    if (!(control instanceof HTMLElement)) {
      throw new Error('No comparison select control')
    }
    await user.click(control)

    const options = (await screen.findAllByRole('option')).map((option) => option.textContent)
    expect(options).toEqual(['No comparison', 'Previous period', 'Same period last year', 'Custom date range'])
  })

  it.each<[ComparisonData | null, string]>([
    [null, 'No comparison'],
    [{ period: 'previousPeriod' }, 'Previous period'],
    [{ period: 'sameLastYear' }, 'Same period last year'],
    [{ period: 'custom', customStartDate: '2024-01-01', customEndDate: '2024-01-31' }, 'Custom date range'],
  ])('should show the selected option for %j', (value, label) => {
    const { container } = renderSelector(value)

    expect(selectedLabel(container)).toBe(label)
  })

  it('should not be clearable', () => {
    renderSelector({ period: 'previousPeriod' })

    expect(lastSelectInputProps().isClearable).toBe(false)
  })

  it.each<[string, ComparisonData]>([
    ['Previous period', { period: 'previousPeriod' }],
    ['Same period last year', { period: 'sameLastYear' }],
  ])('should emit the period when "%s" is picked', async (label, expected) => {
    const user = userEvent.setup()
    const { container, onChange } = renderSelector()

    await selectOption(user, container, label)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(expected)
  })

  it('should emit null when "No comparison" is picked', async () => {
    const user = userEvent.setup()
    const { container, onChange } = renderSelector({ period: 'previousPeriod' })

    await selectOption(user, container, 'No comparison')

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('should default a custom range to the last 30 days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2024-03-31T12:00:00Z'))
    const user = userEvent.setup()
    const { container, onChange } = renderSelector()

    await selectOption(user, container, 'Custom date range')

    expect(onChange).toHaveBeenCalledWith({
      period: 'custom',
      customStartDate: '2024-03-01',
      customEndDate: '2024-03-31',
    })
  })

  it('should read the first option when the select reports an array', () => {
    const { onChange } = renderSelector()
    const { onChange: handleChange } = lastSelectInputProps()

    act(() => {
      handleChange?.([{ label: 'Same period last year', value: 'sameLastYear' }])
    })

    expect(onChange).toHaveBeenCalledWith({ period: 'sameLastYear' })
  })

  it('should emit null when the select reports an array holding "none"', () => {
    const { onChange } = renderSelector({ period: 'sameLastYear' })
    const { onChange: handleChange } = lastSelectInputProps()

    act(() => {
      handleChange?.([{ label: 'No comparison', value: 'none' }])
    })

    expect(onChange).toHaveBeenCalledWith(null)
  })
})
