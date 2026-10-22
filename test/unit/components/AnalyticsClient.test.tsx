import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalyticsClient } from '@/components/AnalyticsClient'
import type { DashboardData, TimePeriod } from '@/types'

// Globals AnalyticsView injects before AnalyticsClient mounts
type AnalyticsTestWindow = Window & {
  __analyticsTimePeriods?: TimePeriod[]
  __analyticsDefaultTimePeriod?: TimePeriod
  __analyticsEnableComparison?: boolean
  __payloadConfig?: { routes?: { api?: string } }
}

const createDashboardData = (overrides?: Partial<DashboardData>): DashboardData => ({
  stats: {
    visitors: { value: 1234, change: 12.5 },
    pageviews: { value: 5678, change: -5.3 },
    bounce_rate: { value: 45.2, change: -2.1 },
    visit_duration: { value: 180, change: 15.0 },
  },
  timeseries: [
    { date: '2024-01-01', visitors: 100, pageviews: 250 },
    { date: '2024-01-02', visitors: 120, pageviews: 300 },
  ],
  pages: [
    { page: '/', visitors: 500, pageviews: 900, bounce_rate: 35, visit_duration: 240 },
    { page: '/about', visitors: 300, pageviews: 450, bounce_rate: 55, visit_duration: 120 },
  ],
  sources: [
    { source: 'google', visitors: 400, bounce_rate: 40, visit_duration: 200 },
    { source: 'direct', visitors: 350, bounce_rate: 50, visit_duration: 150 },
  ],
  events: [
    { goal: 'Signup', visitors: 45, events: 50, conversion_rate: 20.5 },
  ],
  realtime: { visitors: 42 },
  ...overrides,
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const fetchMock = vi.fn<typeof fetch>()

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not provide
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// A ResizeObserver that reports a real size, so ResponsiveContainer draws the chart
class SizedResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    // ResponsiveContainer reads only contentRect from the entry
    const entry = { target, contentRect: { width: 800, height: 250 } }
    this.callback([entry as unknown as ResizeObserverEntry], this)
  }
  unobserve() {}
  disconnect() {}
}

const dateInput = (container: HTMLElement, id: string): HTMLInputElement => {
  const input = container.querySelector(`#${id}`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`No date input ${id}`)
  return input
}

const expectFetchedWith = (url: string) => {
  expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'same-origin' }))
}

// Payload's ReactSelect renders a ShimmerEffect on its first commit and only swaps in
// the real react-select after its own mount effect runs. The select first mounts in
// the same render that shows the data, so a query made straight after
// findByText('1.2K') can still see the shimmer when the machine is busy. Wait for the
// control itself.
const findSelectControl = (container: HTMLElement, fieldName: string) =>
  waitFor(() => {
    const control = container.querySelector(`#field-${fieldName} .rs__control`)
    if (!(control instanceof HTMLElement)) {
      throw new Error(`No select control for ${fieldName}`)
    }
    return control
  })

// Open a Payload SelectInput (react-select) by its field id and pick an option
const selectOption = async (
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  fieldName: string,
  optionLabel: string,
) => {
  await user.click(await findSelectControl(container, fieldName))
  await user.click(await screen.findByRole('option', { name: optionLabel }))
}

describe('AnalyticsClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonResponse(createDashboardData()))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    Object.assign(window as AnalyticsTestWindow, {
      __analyticsTimePeriods: ['day', '7d', '30d', '12mo'],
      __analyticsDefaultTimePeriod: '7d',
      __analyticsEnableComparison: true,
    })
  })

  afterEach(() => {
    // Unmount before removing the ResizeObserver stub. The dashboard's first render
    // happens outside act (it follows the fetch), so React can still owe the
    // ResponsiveContainer mount effect when a test ends on a findBy. That effect calls
    // `new ResizeObserver`. If the stub is gone by the time it flushes, the
    // ReferenceError lands on whichever test is running, which is why it showed up
    // only under load. Unmounting inside act flushes it while the stub is still there.
    cleanup()
    vi.unstubAllGlobals()
    const analyticsWindow = window as AnalyticsTestWindow
    delete analyticsWindow.__analyticsTimePeriods
    delete analyticsWindow.__analyticsDefaultTimePeriod
    delete analyticsWindow.__analyticsEnableComparison
    delete analyticsWindow.__payloadConfig
  })

  it('should render loading state initially', () => {
    const { container } = render(<AnalyticsClient />)
    expect(container.querySelector('.payload__loading-overlay')).toBeInTheDocument()
    expect(screen.queryByText('Visitors')).not.toBeInTheDocument()
  })

  it('should fetch and display analytics data', async () => {
    render(<AnalyticsClient />)

    expect(await screen.findByText('1.2K')).toBeInTheDocument() // Visitors
    expect(screen.getByText('5.7K')).toBeInTheDocument() // Pageviews
    expect(screen.getByText('45%')).toBeInTheDocument() // Bounce rate
    expect(screen.getByText('3m')).toBeInTheDocument() // Visit duration

    expectFetchedWith('/api/analytics/dashboard?period=7d')
  })

  it('should not display percentage changes without a comparison', async () => {
    const { container } = render(<AnalyticsClient />)

    await screen.findByText('1.2K')
    expect(container.querySelector('.analytics-stat-change')).not.toBeInTheDocument()
  })

  it('should display percentage changes with correct styling when comparing', async () => {
    const user = userEvent.setup()
    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    await selectOption(user, container, 'analytics-comparison', 'Previous period')

    await waitFor(() => {
      expectFetchedWith('/api/analytics/dashboard?period=7d&comparison=previousPeriod')
    })

    // Visitors up: positive
    expect(await screen.findByText('↑ 12.5%')).toHaveClass('analytics-stat-change', 'positive')
    // Pageviews down: negative
    expect(screen.getByText('↓ 5.3%')).toHaveClass('analytics-stat-change', 'negative')
    // Bounce rate down is good: positive
    expect(screen.getByText('↓ 2.1%')).toHaveClass('analytics-stat-change', 'positive')
    // Visit duration up: positive
    expect(screen.getByText('↑ 15.0%')).toHaveClass('analytics-stat-change', 'positive')
  })

  it('should fetch the configured default time period first', async () => {
    ;(window as AnalyticsTestWindow).__analyticsDefaultTimePeriod = '30d'
    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expectFetchedWith('/api/analytics/dashboard?period=30d')
    expect(within(await findSelectControl(container, 'analytics-period')).getByText('Last 30 days')).toBeInTheDocument()
  })

  it('should handle time period selection', async () => {
    const user = userEvent.setup()
    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    expect(within(await findSelectControl(container, 'analytics-period')).getByText('Last 7 days')).toBeInTheDocument()

    await selectOption(user, container, 'analytics-period', 'Last 30 days')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/analytics/dashboard?period=30d',
        expect.objectContaining({ credentials: 'same-origin' }),
      )
    })
  })

  it('should render chart and tables when data is available', async () => {
    render(<AnalyticsClient />)

    expect(await screen.findByText('Visitors Over Time')).toBeInTheDocument()
    expect(screen.queryByText('No data available for this period')).not.toBeInTheDocument()

    expect(screen.getByText('Top Pages')).toBeInTheDocument()
    expect(screen.getByText('/')).toBeInTheDocument()
    expect(screen.getByText('/about')).toBeInTheDocument()

    expect(screen.getByText('Top Sources')).toBeInTheDocument()
    expect(screen.getByText('google')).toBeInTheDocument()
    expect(screen.getByText('direct')).toBeInTheDocument()
  })

  it('should show an empty chart message when there is no timeseries', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(createDashboardData({ timeseries: [] })))

    render(<AnalyticsClient />)

    expect(await screen.findByText('No data available for this period')).toBeInTheDocument()
  })

  it('should display real-time visitors when available', async () => {
    const { container } = render(<AnalyticsClient />)

    expect(await screen.findByText('42 visitors online now')).toBeInTheDocument()
    expect(container.querySelector('.analytics-realtime-dot')).not.toHaveClass('inactive')
  })

  it('should show zero real-time visitors as inactive when realtime is missing', async () => {
    const data = createDashboardData()
    delete data.realtime
    fetchMock.mockImplementation(async () => jsonResponse(data))

    const { container } = render(<AnalyticsClient />)

    expect(await screen.findByText('0 visitors online now')).toBeInTheDocument()
    expect(container.querySelector('.analytics-realtime-dot')).toHaveClass('inactive')
  })

  it('should handle network errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'))

    render(<AnalyticsClient />)

    expect(await screen.findByText('Network error')).toBeInTheDocument()
  })

  it('should handle non-ok responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))

    render(<AnalyticsClient />)

    expect(await screen.findByText('Failed to fetch analytics data')).toBeInTheDocument()
  })

  it('should handle empty data gracefully', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null))

    render(<AnalyticsClient />)

    expect(await screen.findByText('Unable to load analytics data')).toBeInTheDocument()
  })

  it('should render custom events section when available', async () => {
    render(<AnalyticsClient />)

    expect(await screen.findByText('Top Events')).toBeInTheDocument()
    expect(screen.getByText('Signup')).toBeInTheDocument()
  })

  it('should not render custom events section when there are no events', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(createDashboardData({ events: [] })))

    render(<AnalyticsClient />)

    await screen.findByText('Top Pages')
    expect(screen.queryByText('Top Events')).not.toBeInTheDocument()
  })

  it('should offer the configured time periods with their labels', async () => {
    const user = userEvent.setup()
    ;(window as AnalyticsTestWindow).__analyticsTimePeriods = ['day', '7d', '6mo']

    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    await user.click(await findSelectControl(container, 'analytics-period'))

    expect(await screen.findByRole('option', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last 7 days' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last 6 months' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Last 30 days' })).not.toBeInTheDocument()
  })

  it('should hide the comparison selector when comparison is disabled', async () => {
    ;(window as AnalyticsTestWindow).__analyticsEnableComparison = false

    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    // Wait until the selects are fully mounted, so the absence below is not just the shimmer
    expect(await findSelectControl(container, 'analytics-period')).toBeInTheDocument()
    expect(container.querySelector('#field-analytics-comparison')).not.toBeInTheDocument()
  })

  it('should fall back to the default periods when none are configured', async () => {
    const user = userEvent.setup()
    const analyticsWindow = window as AnalyticsTestWindow
    delete analyticsWindow.__analyticsTimePeriods
    delete analyticsWindow.__analyticsDefaultTimePeriod

    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    expectFetchedWith('/api/analytics/dashboard?period=7d')
    await user.click(await findSelectControl(container, 'analytics-period'))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Today',
      'Last 7 days',
      'Last 30 days',
      'Last 12 months',
    ])
  })

  it('should label a period it has no label for with its raw value', async () => {
    const user = userEvent.setup()
    ;(window as AnalyticsTestWindow).__analyticsTimePeriods = ['7d', 'quarter']

    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    await selectOption(user, container, 'analytics-period', 'quarter')

    await waitFor(() => {
      expectFetchedWith('/api/analytics/dashboard?period=quarter')
    })
  })

  it('should fetch from the configured Payload API route', async () => {
    ;(window as AnalyticsTestWindow).__payloadConfig = { routes: { api: '/cms-api' } }

    render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    expectFetchedWith('/cms-api/analytics/dashboard?period=7d')
  })

  it('should show a generic message when the request fails with a non-Error value', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject('offline'))

    render(<AnalyticsClient />)

    expect(await screen.findByText('An error occurred')).toBeInTheDocument()
  })

  it('should use the singular for a single visitor online', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(createDashboardData({ realtime: { visitors: 1 } })))

    render(<AnalyticsClient />)

    expect(await screen.findByText('1 visitor online now')).toBeInTheDocument()
  })

  it('should style falling metrics as negative and a rising bounce rate as negative', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        createDashboardData({
          stats: {
            visitors: { value: 1234, change: -12.5 },
            pageviews: { value: 5678, change: 5.3 },
            bounce_rate: { value: 45.2, change: 2.1 },
            visit_duration: { value: 180, change: -15 },
          },
        }),
      ),
    )
    const user = userEvent.setup()
    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    await selectOption(user, container, 'analytics-comparison', 'Same period last year')

    await waitFor(() => {
      expectFetchedWith('/api/analytics/dashboard?period=7d&comparison=sameLastYear')
    })
    expect(await screen.findByText('↓ 12.5%')).toHaveClass('analytics-stat-change', 'negative')
    expect(screen.getByText('↑ 5.3%')).toHaveClass('analytics-stat-change', 'positive')
    // Bounce rate going up is bad
    expect(screen.getByText('↑ 2.1%')).toHaveClass('analytics-stat-change', 'negative')
    expect(screen.getByText('↓ 15.0%')).toHaveClass('analytics-stat-change', 'negative')
  })

  it('should hide the change for a metric whose change is null', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        createDashboardData({
          stats: {
            visitors: { value: 1234, change: null },
            pageviews: { value: 5678, change: null },
            bounce_rate: { value: 45.2, change: null },
            visit_duration: { value: 180, change: 15 },
          },
        }),
      ),
    )
    const user = userEvent.setup()
    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    await selectOption(user, container, 'analytics-comparison', 'Previous period')

    expect(await screen.findByText('↑ 15.0%')).toBeInTheDocument()
    expect(container.querySelectorAll('.analytics-stat-change')).toHaveLength(1)
  })

  it('should format the chart axis with the selected period', async () => {
    vi.stubGlobal('ResizeObserver', SizedResizeObserverStub)
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        createDashboardData({
          // Local times, so the rendered day does not depend on the time zone
          timeseries: [
            { date: '2024-01-01T12:00:00', visitors: 100, pageviews: 250 },
            { date: '2024-01-02T12:00:00', visitors: 120, pageviews: 300 },
          ],
        }),
      ),
    )

    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    const ticks = await waitFor(() => {
      const labels = Array.from(container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value'))
      expect(labels.length).toBeGreaterThan(0)
      return labels.map((label) => label.textContent)
    })
    // 7d uses month/day/2-digit year
    expect(ticks).toEqual(['1/1/24', '1/2/24'])
  })

  it('should format the chart tooltip with the date and visitor count', async () => {
    vi.stubGlobal('ResizeObserver', SizedResizeObserverStub)
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        createDashboardData({
          timeseries: [
            { date: '2024-01-01T12:00:00', visitors: 1500, pageviews: 250 },
            { date: '2024-01-02T12:00:00', visitors: 120, pageviews: 300 },
          ],
        }),
      ),
    )

    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')
    const surface = await waitFor(() => {
      const wrapper = container.querySelector('.recharts-wrapper')
      if (!(wrapper instanceof HTMLElement)) throw new Error('No chart')
      return wrapper
    })

    // Hover near the left edge of the plot, over the first point. Recharts reads
    // pageX/pageY, which jsdom's MouseEvent does not set from the init dict.
    const hover = createEvent.mouseMove(surface, { clientX: 70, clientY: 100 })
    Object.defineProperties(hover, { pageX: { value: 70 }, pageY: { value: 100 } })
    fireEvent(surface, hover)

    const tooltip = await waitFor(() => {
      const content = container.querySelector('.recharts-tooltip-wrapper')
      expect(content?.textContent).toContain('Jan 1, 2024')
      return content
    })
    expect(tooltip?.textContent).toContain('1.5K visitors')
  })

  describe('custom date range', () => {
    beforeEach(() => {
      ;(window as AnalyticsTestWindow).__analyticsTimePeriods = ['7d', '30d', 'custom']
    })

    const openCustomPicker = async () => {
      const user = userEvent.setup()
      const view = render(<AnalyticsClient />)
      await screen.findByText('1.2K')
      await selectOption(user, view.container, 'analytics-period', 'Custom date')
      await screen.findByText('Date Range')
      return { user, ...view }
    }

    it('should not fetch until a start date is chosen and Apply is clicked', async () => {
      const { user, container } = await openCustomPicker()

      const apply = screen.getByRole('button', { name: 'Apply' })
      expect(apply).toBeDisabled()
      expect(apply).toHaveClass('btn--disabled')
      expect(fetchMock).toHaveBeenCalledTimes(1)

      fireEvent.change(dateInput(container, 'start-date'), { target: { value: '2024-01-01' } })
      fireEvent.change(dateInput(container, 'end-date'), { target: { value: '2024-01-31' } })
      expect(dateInput(container, 'end-date')).toHaveAttribute('min', '2024-01-01')
      expect(apply).toBeEnabled()
      expect(apply).not.toHaveClass('btn--disabled')

      fetchMock.mockImplementation(async () =>
        jsonResponse(
          createDashboardData({
            stats: {
              visitors: { value: 9999, change: null },
              pageviews: { value: 5678, change: null },
              bounce_rate: { value: 45.2, change: null },
              visit_duration: { value: 180, change: null },
            },
          }),
        ),
      )
      await user.click(apply)

      expect(await screen.findByText('10.0K')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expectFetchedWith('/api/analytics/dashboard?period=custom&start=2024-01-01&end=2024-01-31')
    })

    it('should keep the Apply button disabled when the end date is cleared', async () => {
      const { container } = await openCustomPicker()

      fireEvent.change(dateInput(container, 'start-date'), { target: { value: '2024-01-01' } })
      fireEvent.change(dateInput(container, 'end-date'), { target: { value: '' } })

      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    })

    it('should add a named comparison to the custom range request', async () => {
      const { user, container } = await openCustomPicker()
      await selectOption(user, container, 'analytics-comparison', 'Previous period')

      fireEvent.change(dateInput(container, 'start-date'), { target: { value: '2024-01-01' } })
      fireEvent.change(dateInput(container, 'end-date'), { target: { value: '2024-01-31' } })
      await user.click(screen.getByRole('button', { name: 'Apply' }))

      await waitFor(() => {
        expectFetchedWith('/api/analytics/dashboard?period=custom&start=2024-01-01&end=2024-01-31&comparison=previousPeriod')
      })
    })

    it('should show the error when the custom range request fails', async () => {
      const { user, container } = await openCustomPicker()
      fireEvent.change(dateInput(container, 'start-date'), { target: { value: '2024-01-01' } })
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, 500))

      await user.click(screen.getByRole('button', { name: 'Apply' }))

      expect(await screen.findByText('Failed to fetch analytics data')).toBeInTheDocument()
    })

    it('should show a generic message when the custom range request rejects with a non-Error value', async () => {
      const { user, container } = await openCustomPicker()
      fireEvent.change(dateInput(container, 'start-date'), { target: { value: '2024-01-01' } })
      fetchMock.mockImplementationOnce(() => Promise.reject('offline'))

      await user.click(screen.getByRole('button', { name: 'Apply' }))

      expect(await screen.findByText('An error occurred')).toBeInTheDocument()
    })
  })

  describe('custom comparison range', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2024-03-15T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should default to the last 30 days and refetch as the comparison dates change', async () => {
      const user = userEvent.setup()
      const { container } = render(<AnalyticsClient />)
      await screen.findByText('1.2K')

      await selectOption(user, container, 'analytics-comparison', 'Custom date range')

      await waitFor(() => {
        expectFetchedWith('/api/analytics/dashboard?period=7d&comparison=custom&compareStart=2024-02-14&compareEnd=2024-03-15')
      })
      expect(screen.getByText('Comparison Range')).toBeInTheDocument()
      expect(dateInput(container, 'compare-start-date')).toHaveValue('2024-02-14')
      expect(dateInput(container, 'compare-end-date')).toHaveValue('2024-03-15')

      fireEvent.change(dateInput(container, 'compare-start-date'), { target: { value: '2024-01-01' } })
      await waitFor(() => {
        expectFetchedWith('/api/analytics/dashboard?period=7d&comparison=custom&compareStart=2024-01-01&compareEnd=2024-03-15')
      })
      expect(dateInput(container, 'compare-end-date')).toHaveAttribute('min', '2024-01-01')

      fireEvent.change(dateInput(container, 'compare-end-date'), { target: { value: '2024-01-31' } })
      await waitFor(() => {
        expectFetchedWith('/api/analytics/dashboard?period=7d&comparison=custom&compareStart=2024-01-01&compareEnd=2024-01-31')
      })
    })

    it('should disable Apply while a comparison date is missing', async () => {
      const user = userEvent.setup()
      const { container } = render(<AnalyticsClient />)
      await screen.findByText('1.2K')
      await selectOption(user, container, 'analytics-comparison', 'Custom date range')
      await screen.findByText('Comparison Range')

      fireEvent.change(dateInput(container, 'start-date'), { target: { value: '2024-03-01' } })
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()

      fireEvent.change(dateInput(container, 'compare-end-date'), { target: { value: '' } })
      const apply = screen.getByRole('button', { name: 'Apply' })
      expect(apply).toBeDisabled()
      expect(apply).toHaveClass('btn--disabled')
    })

    it('should send the comparison range with an applied custom date range', async () => {
      const user = userEvent.setup()
      const { container } = render(<AnalyticsClient />)
      await screen.findByText('1.2K')
      await selectOption(user, container, 'analytics-comparison', 'Custom date range')
      await screen.findByText('Comparison Range')

      fireEvent.change(dateInput(container, 'start-date'), { target: { value: '2024-03-01' } })
      fireEvent.change(dateInput(container, 'end-date'), { target: { value: '2024-03-14' } })
      await user.click(screen.getByRole('button', { name: 'Apply' }))

      await waitFor(() => {
        expectFetchedWith(
          '/api/analytics/dashboard?period=custom&start=2024-03-01&end=2024-03-14&comparison=custom&compareStart=2024-02-14&compareEnd=2024-03-15',
        )
      })
    })

    it('should hide the comparison range inputs when comparison is disabled', async () => {
      ;(window as AnalyticsTestWindow).__analyticsEnableComparison = false
      ;(window as AnalyticsTestWindow).__analyticsTimePeriods = ['7d', 'custom']
      const user = userEvent.setup()
      const { container } = render(<AnalyticsClient />)
      await screen.findByText('1.2K')

      await selectOption(user, container, 'analytics-period', 'Custom date')

      expect(await screen.findByText('Date Range')).toBeInTheDocument()
      expect(screen.queryByText('Comparison Range')).not.toBeInTheDocument()
      expect(container.querySelector('#compare-start-date')).not.toBeInTheDocument()
    })
  })
})
