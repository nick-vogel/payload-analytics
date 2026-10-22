import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createGoogleAnalyticsProvider } from '@/providers/google-analytics'
import { mockFetchResponse } from '../../utils/test-helpers'

interface ReportRequest {
  dateRanges?: Array<{ startDate: string; endDate: string }>
  dimensions?: Array<{ name: string }>
  metrics?: Array<{ name: string }>
  orderBys?: unknown[]
  dimensionFilter?: unknown
  limit?: number
}

const metric = (name: string, type: string) => ({ name, type })

// One overview report with two date ranges: row 0 is the current period, row 1 the previous.
const overviewReport = {
  dimensionHeaders: [{ name: 'dateRange' }],
  metricHeaders: [
    metric('activeUsers', 'TYPE_INTEGER'),
    metric('screenPageViews', 'TYPE_INTEGER'),
    metric('bounceRate', 'TYPE_FLOAT'),
    metric('averageSessionDuration', 'TYPE_SECONDS'),
  ],
  rows: [
    {
      dimensionValues: [{ value: 'date_range_0' }],
      metricValues: [{ value: '1234' }, { value: '5678' }, { value: '0.452' }, { value: '180' }],
    },
    {
      dimensionValues: [{ value: 'date_range_1' }],
      metricValues: [{ value: '1000' }, { value: '5000' }, { value: '0.5' }, { value: '150' }],
    },
  ],
}

const timeseriesReport = {
  rows: [
    { dimensionValues: [{ value: '20240108' }], metricValues: [{ value: '100' }, { value: '250' }] },
    { dimensionValues: [{ value: '20240109' }], metricValues: [{ value: '120' }, { value: '300' }] },
    { dimensionValues: [{ value: '20240110' }], metricValues: [{ value: '110' }, { value: '280' }] },
  ],
}

const pagesReport = {
  rows: [
    { dimensionValues: [{ value: '/' }], metricValues: [{ value: '500' }, { value: '1200' }, { value: '0.35' }, { value: '240' }] },
    { dimensionValues: [{ value: '/about' }], metricValues: [{ value: '300' }, { value: '450' }, { value: '0.55' }, { value: '120' }] },
  ],
}

const sourcesReport = {
  rows: [
    { dimensionValues: [{ value: 'google' }], metricValues: [{ value: '400' }, { value: '0.4' }, { value: '200' }] },
    { dimensionValues: [{ value: '(direct)' }], metricValues: [{ value: '350' }, { value: '0.5' }, { value: '150' }] },
    { dimensionValues: [{ value: 'twitter.com' }], metricValues: [{ value: '200' }, { value: '0.6' }, { value: '90' }] },
  ],
}

const eventsReport = {
  rows: [
    { dimensionValues: [{ value: 'sign_up' }], metricValues: [{ value: '50' }, { value: '45' }] },
    { dimensionValues: [{ value: 'purchase' }], metricValues: [{ value: '25' }, { value: '23' }] },
  ],
}

const realtimeReport = {
  rows: [{ dimensionValues: [], metricValues: [{ value: '7' }] }],
}

const fetchMock = vi.fn<typeof fetch>()

const bodyOf = (call: Parameters<typeof fetch>): ReportRequest => JSON.parse(String(call[1]?.body))

type ReportKind = 'overview' | 'timeseries' | 'pages' | 'sources' | 'events' | 'realtime'

const kindOf = (url: string, body: ReportRequest): ReportKind => {
  if (url.includes(':runRealtimeReport')) return 'realtime'
  switch (body.dimensions?.[0]?.name) {
    case 'date':
      return 'timeseries'
    case 'pagePath':
      return 'pages'
    case 'sessionSource':
      return 'sources'
    case 'eventName':
      return 'events'
    default:
      return 'overview'
  }
}

const callFor = (kind: ReportKind) =>
  fetchMock.mock.calls.find((call) => kindOf(String(call[0]), bodyOf(call)) === kind)

/** Answer each GA4 report request by what it asks for, not by call order. */
const routeGA4 = (responses: Partial<Record<ReportKind, unknown>>) => {
  fetchMock.mockImplementation((input, init) => {
    const kind = kindOf(String(input), JSON.parse(String(init?.body)))
    return mockFetchResponse(responses[kind] ?? { rows: [] })
  })
}

const allReports = {
  overview: overviewReport,
  timeseries: timeseriesReport,
  pages: pagesReport,
  sources: sourcesReport,
  events: eventsReport,
  realtime: realtimeReport,
}

describe('createGoogleAnalyticsProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('configuration', () => {
    it('should initialize with provided config', () => {
      const provider = createGoogleAnalyticsProvider({
        propertyId: '123456789',
        apiKey: 'test-api-key',
      })

      expect(provider.name).toBe('google-analytics')
    })

    it('should use environment variables when config is not provided', async () => {
      vi.stubEnv('GA4_PROPERTY_ID', '987654321')
      vi.stubEnv('GA4_API_KEY', 'env-api-key')
      routeGA4(allReports)

      const provider = createGoogleAnalyticsProvider({})
      await provider.getDashboardData('7d')

      const call = callFor('overview')
      expect(String(call?.[0])).toBe(
        'https://analyticsdata.googleapis.com/v1beta/properties/987654321:runReport?key=env-api-key',
      )
    })

    it('should return null without calling the API when credentials are missing', async () => {
      vi.stubEnv('GA4_PROPERTY_ID', '')
      vi.stubEnv('GA4_API_KEY', '')

      const provider = createGoogleAnalyticsProvider()
      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getDashboardData', () => {
    const provider = createGoogleAnalyticsProvider({
      propertyId: '123456789',
      apiKey: 'test-api-key',
    })

    it('should fetch and transform data correctly', async () => {
      routeGA4(allReports)

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()
      expect(result?.stats?.visitors.value).toBe(1234)
      expect(result?.stats?.visitors.change).toBeCloseTo(23.4, 5) // (1234-1000)/1000 * 100
      expect(result?.stats?.pageviews.value).toBe(5678)
      expect(result?.stats?.pageviews.change).toBeCloseTo(13.56, 5) // (5678-5000)/5000 * 100
      expect(result?.stats?.bounce_rate.value).toBeCloseTo(45.2, 5)
      expect(result?.stats?.bounce_rate.change).toBeCloseTo(-9.6, 5) // (0.452-0.5)/0.5 * 100
      expect(result?.stats?.visit_duration.value).toBe(180)
      expect(result?.stats?.visit_duration.change).toBeCloseTo(20, 5) // (180-150)/150 * 100

      expect(result?.timeseries?.map(({ visitors, pageviews }) => ({ visitors, pageviews }))).toEqual([
        { visitors: 100, pageviews: 250 },
        { visitors: 120, pageviews: 300 },
        { visitors: 110, pageviews: 280 },
      ])
      expect(result?.pages).toHaveLength(2)
      expect(result?.pages?.[0]).toMatchObject({ page: '/', visitors: 500, pageviews: 1200, visit_duration: 240 })
      expect(result?.pages?.[0].bounce_rate).toBeCloseTo(35, 5)
      expect(result?.sources).toHaveLength(3)
      expect(result?.events).toHaveLength(2)
      expect(result?.realtime).toEqual({ visitors: 7 })
    })

    it('should return timeseries dates the dashboard chart can parse', async () => {
      routeGA4(allReports)

      const result = await provider.getDashboardData('7d')

      // GA4 returns the date dimension as YYYYMMDD. The chart passes it to new Date()
      // (src/lib/formatters.ts formatAxisDate), which needs an ISO date.
      expect(result?.timeseries?.[0]).toEqual({
        date: '2024-01-08',
        visitors: 100,
        pageviews: 250,
      })
    })

    it('should format date ranges correctly for GA4 API', async () => {
      routeGA4(allReports)

      const ranges = [
        { input: 'day', current: { startDate: 'today', endDate: 'today' } },
        { input: '7d', current: { startDate: '7daysAgo', endDate: 'today' } },
        { input: '30d', current: { startDate: '30daysAgo', endDate: 'today' } },
        { input: '12mo', current: { startDate: '365daysAgo', endDate: 'today' } },
      ]

      for (const { input, current } of ranges) {
        fetchMock.mockClear()
        await provider.getDashboardData(input)

        const overview = callFor('overview')
        expect(overview).toBeDefined()
        if (!overview) return
        const { dateRanges } = bodyOf(overview)
        expect(dateRanges).toHaveLength(2)
        expect(dateRanges?.[0]).toEqual(current)

        // Every breakdown report covers only the current period.
        const timeseries = callFor('timeseries')
        expect(timeseries && bodyOf(timeseries).dateRanges).toEqual([current])
      }
    })

    it('should handle bounce rate as decimal conversion', async () => {
      routeGA4({
        overview: {
          rows: [
            {
              dimensionValues: [{ value: 'date_range_0' }],
              metricValues: [{ value: '1000' }, { value: '2000' }, { value: '0.753' }, { value: '200' }],
            },
          ],
        },
      })

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.bounce_rate.value).toBeCloseTo(75.3, 5)
    })

    it('should send the API key in the query string of every request', async () => {
      routeGA4(allReports)

      await provider.getDashboardData('7d')

      expect(fetchMock).toHaveBeenCalledTimes(6)
      for (const [input, init] of fetchMock.mock.calls) {
        const url = new URL(String(input))
        expect(url.searchParams.get('key')).toBe('test-api-key')
        expect(url.pathname).toMatch(/^\/v1beta\/properties\/123456789:(runReport|runRealtimeReport)$/)
        expect(init?.method).toBe('POST')
        expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
      }
      expect(callFor('realtime')).toBeDefined()
    })

    it('should construct proper report request bodies', async () => {
      routeGA4(allReports)

      await provider.getDashboardData('7d')

      const overview = callFor('overview')
      const timeseries = callFor('timeseries')
      expect(overview && bodyOf(overview).dimensions).toBeUndefined()
      expect(overview && bodyOf(overview).metrics).toEqual([
        { name: 'activeUsers' },
        { name: 'screenPageViews' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ])
      expect(timeseries && bodyOf(timeseries).dimensions).toEqual([{ name: 'date' }])
      expect(timeseries && bodyOf(timeseries).metrics).toEqual([{ name: 'activeUsers' }, { name: 'screenPageViews' }])
      expect(timeseries && bodyOf(timeseries).orderBys).toEqual([{ dimension: { dimensionName: 'date' } }])
    })

    it('should map custom events and their conversion rate', async () => {
      routeGA4(allReports)

      const result = await provider.getDashboardData('7d')

      // conversion_rate is the event's users over all active users (1234).
      expect(result?.events?.map(({ goal, events, visitors }) => ({ goal, events, visitors }))).toEqual([
        { goal: 'sign_up', events: 50, visitors: 45 },
        { goal: 'purchase', events: 25, visitors: 23 },
      ])
      expect(result?.events?.[0].conversion_rate).toBeCloseTo((45 / 1234) * 100, 5)
    })

    it('should ask GA4 to filter page_view out of the custom events report', async () => {
      routeGA4(allReports)

      await provider.getDashboardData('7d')

      // A FilterExpression sets exactly one of andGroup, orGroup, notExpression or
      // filter, and notExpression takes a nested FilterExpression.
      const events = callFor('events')
      expect(events && bodyOf(events).dimensionFilter).toEqual({
        notExpression: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { matchType: 'EXACT', value: 'page_view', caseSensitive: false },
          },
        },
      })
    })

    it('should handle empty API responses', async () => {
      routeGA4({})

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()
      expect(result?.stats?.visitors).toEqual({ value: 0, change: null })
      expect(result?.stats?.pageviews).toEqual({ value: 0, change: null })
      expect(result?.timeseries).toEqual([])
      expect(result?.pages).toEqual([])
      expect(result?.sources).toEqual([])
      expect(result?.events).toEqual([])
      expect(result?.realtime).toEqual({ visitors: 0 })
    })

    it('should handle API errors gracefully', async () => {
      fetchMock.mockRejectedValue(new Error('API Error'))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should handle non-200 responses', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse('Unauthorized', 401))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should map traffic sources', async () => {
      routeGA4(allReports)

      const result = await provider.getDashboardData('7d')

      expect(result?.sources?.map(({ source, visitors, visit_duration }) => ({ source, visitors, visit_duration }))).toEqual([
        { source: 'google', visitors: 400, visit_duration: 200 },
        { source: '(direct)', visitors: 350, visit_duration: 150 },
        { source: 'twitter.com', visitors: 200, visit_duration: 90 },
      ])
      expect(result?.sources?.map(({ bounce_rate }) => bounce_rate)).toEqual([
        expect.closeTo(40, 5),
        expect.closeTo(50, 5),
        expect.closeTo(60, 5),
      ])
    })

    it('should pair each relative period with the window just before it', async () => {
      routeGA4(allReports)

      const ranges = [
        { input: '24h', current: { startDate: 'today', endDate: 'today' }, previous: { startDate: 'yesterday', endDate: 'yesterday' } },
        { input: '14d', current: { startDate: '14daysAgo', endDate: 'today' }, previous: { startDate: '28daysAgo', endDate: '15daysAgo' } },
        { input: '30d', current: { startDate: '30daysAgo', endDate: 'today' }, previous: { startDate: '60daysAgo', endDate: '31daysAgo' } },
        { input: '12mo', current: { startDate: '365daysAgo', endDate: 'today' }, previous: { startDate: '730daysAgo', endDate: '366daysAgo' } },
        // An unrecognised period falls back to the last 7 days.
        { input: 'quarter', current: { startDate: '7daysAgo', endDate: 'today' }, previous: { startDate: '14daysAgo', endDate: '8daysAgo' } },
      ]

      for (const { input, current, previous } of ranges) {
        fetchMock.mockClear()
        await provider.getDashboardData(input)

        const overview = callFor('overview')
        expect(overview && bodyOf(overview).dateRanges, input).toEqual([current, previous])
      }
    })

    describe('calendar month periods', () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        // Mid-month and mid-day, in a leap year, so February ends on the 29th.
        vi.setSystemTime(new Date('2024-03-15T12:00:00Z'))
        routeGA4(allReports)
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('should request last month as explicit dates against the month before it', async () => {
        await provider.getDashboardData('lastMonth')

        const overview = callFor('overview')
        expect(overview && bodyOf(overview).dateRanges).toEqual([
          { startDate: '2024-02-01', endDate: '2024-02-29' },
          { startDate: '2024-01-01', endDate: '2024-01-31' },
        ])
        const pages = callFor('pages')
        expect(pages && bodyOf(pages).dateRanges).toEqual([{ startDate: '2024-02-01', endDate: '2024-02-29' }])
      })

      it('should request this month to date against the whole of last month', async () => {
        await provider.getDashboardData('thisMonth')

        const overview = callFor('overview')
        expect(overview && bodyOf(overview).dateRanges).toEqual([
          { startDate: '2024-03-01', endDate: 'today' },
          { startDate: '2024-02-01', endDate: '2024-02-29' },
        ])
      })
    })

    it('should convert hourly dateHour keys and pass unknown date keys through', async () => {
      routeGA4({
        ...allReports,
        timeseries: {
          rows: [
            { dimensionValues: [{ value: '2024010813' }], metricValues: [{ value: '4' }, { value: '9' }] },
            { dimensionValues: [{ value: '(other)' }], metricValues: [{ value: '1' }, { value: '2' }] },
          ],
        },
      })

      const result = await provider.getDashboardData('day')

      expect(result?.timeseries).toEqual([
        { date: '2024-01-08T13:00:00', visitors: 4, pageviews: 9 },
        { date: '(other)', visitors: 1, pageviews: 2 },
      ])
    })

    it('should fill defaults for rows that omit dimension and metric values', async () => {
      const blankRow = { dimensionValues: [], metricValues: [] }
      routeGA4({
        overview: { rows: [blankRow] },
        timeseries: { rows: [blankRow] },
        pages: { rows: [blankRow] },
        sources: { rows: [blankRow] },
        events: { rows: [blankRow] },
        realtime: { rows: [blankRow] },
      })

      const result = await provider.getDashboardData('7d')

      expect(result?.stats).toEqual({
        visitors: { value: 0, change: null },
        pageviews: { value: 0, change: null },
        bounce_rate: { value: 0, change: null },
        visit_duration: { value: 0, change: null },
      })
      expect(result?.timeseries).toEqual([{ date: '', visitors: 0, pageviews: 0 }])
      expect(result?.pages).toEqual([{ page: '/', visitors: 0, pageviews: 0, bounce_rate: 0, visit_duration: 0 }])
      expect(result?.sources).toEqual([{ source: 'Direct', visitors: 0, bounce_rate: 0, visit_duration: 0 }])
      // With no active users there is nothing to divide by, so the conversion rate is 0.
      expect(result?.events).toEqual([{ goal: '', events: 0, visitors: 0, conversion_rate: 0 }])
      expect(result?.realtime).toEqual({ visitors: 0 })
    })

    it('should keep the overview when every breakdown report fails validation', async () => {
      const malformed = { rows: 'not-an-array' }
      routeGA4({
        overview: overviewReport,
        timeseries: malformed,
        pages: malformed,
        sources: malformed,
        events: malformed,
        realtime: malformed,
      })

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.visitors).toEqual({ value: 1234, change: expect.closeTo(23.4, 5) })
      expect(result?.timeseries).toEqual([])
      expect(result?.pages).toEqual([])
      expect(result?.sources).toEqual([])
      expect(result?.events).toEqual([])
      expect(result?.realtime).toEqual({ visitors: 0 })
    })

    it('should return null when the overview report fails validation', async () => {
      routeGA4({ ...allReports, overview: { rows: [{ dimensionValues: 'bad' }] } })

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
      // It stops after the overview instead of requesting the breakdowns.
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('trackEvent', () => {
    it('should be a client-side stub that only logs the event', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const provider = createGoogleAnalyticsProvider({
        propertyId: '123456789',
        apiKey: 'test-api-key',
      })

      provider.trackEvent?.('sign_up', { method: 'email' })

      expect(log).toHaveBeenCalledWith('Google Analytics trackEvent:', 'sign_up', { method: 'email' })
      expect(fetchMock).not.toHaveBeenCalled()
      log.mockRestore()
    })
  })
})
