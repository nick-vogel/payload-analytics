import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalyticsClient } from '@/components/AnalyticsClient'
import type { DashboardData, TimePeriod } from '@/types'

// Globals AnalyticsView injects before AnalyticsClient mounts
type AnalyticsTestWindow = Window & {
  __analyticsTimePeriods?: TimePeriod[]
  __analyticsDefaultTimePeriod?: TimePeriod
  __analyticsEnableComparison?: boolean
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

const expectFetchedWith = (url: string) => {
  expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'same-origin' }))
}

// Open a Payload SelectInput (react-select) by its field id and pick an option
const selectOption = async (
  user: ReturnType<typeof userEvent.setup>,
  container: HTMLElement,
  fieldName: string,
  optionLabel: string,
) => {
  const control = container.querySelector(`#field-${fieldName} .rs__control`)
  if (!(control instanceof HTMLElement)) {
    throw new Error(`No select control for ${fieldName}`)
  }
  await user.click(control)
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
    vi.unstubAllGlobals()
    const analyticsWindow = window as AnalyticsTestWindow
    delete analyticsWindow.__analyticsTimePeriods
    delete analyticsWindow.__analyticsDefaultTimePeriod
    delete analyticsWindow.__analyticsEnableComparison
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
    const periodField = container.querySelector('#field-analytics-period')
    if (!(periodField instanceof HTMLElement)) throw new Error('No period field')
    expect(within(periodField).getByText('Last 30 days')).toBeInTheDocument()
  })

  it('should handle time period selection', async () => {
    const user = userEvent.setup()
    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    const periodField = container.querySelector('#field-analytics-period')
    if (!(periodField instanceof HTMLElement)) throw new Error('No period field')
    expect(within(periodField).getByText('Last 7 days')).toBeInTheDocument()

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

    const control = container.querySelector('#field-analytics-period .rs__control')
    if (!(control instanceof HTMLElement)) throw new Error('No period control')
    await user.click(control)

    expect(await screen.findByRole('option', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last 7 days' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last 6 months' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Last 30 days' })).not.toBeInTheDocument()
  })

  it('should hide the comparison selector when comparison is disabled', async () => {
    ;(window as AnalyticsTestWindow).__analyticsEnableComparison = false

    const { container } = render(<AnalyticsClient />)
    await screen.findByText('1.2K')

    expect(container.querySelector('#field-analytics-comparison')).not.toBeInTheDocument()
    expect(container.querySelector('#field-analytics-period')).toBeInTheDocument()
  })
})
