import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createUmamiProvider } from '@/providers/umami'
import type { AnalyticsProvider } from '@/types'
import { mockFetchResponse } from '../../utils/test-helpers'
import { umamiStatsResponse } from '../../fixtures/api-responses'

const NOW = new Date('2024-01-10T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

// Fixtures in the shape the current provider validates. Each metrics type is
// a separate request that returns a flat array of { x, y }.
const umamiPageviews = {
  pageviews: [
    { x: 1704844800000, y: 250 }, // 2024-01-10
    { x: 1704931200000, y: 300 }, // 2024-01-11
    { x: 1705017600000, y: 280 }, // 2024-01-12
  ],
  sessions: [
    { x: 1704844800000, y: 100 },
    { x: 1704931200000, y: 120 },
    { x: 1705017600000, y: 110 },
  ],
}

const umamiMetrics: Record<string, Array<{ x: string; y: number }>> = {
  url: [
    { x: '/', y: 1200 },
    { x: '/about', y: 450 },
  ],
  referrer: [
    { x: 'google.com', y: 400 },
    { x: '', y: 350 },
  ],
  event: [
    { x: 'Signup', y: 45 },
    { x: 'Purchase', y: 23 },
  ],
}

interface UmamiRoutes {
  stats?: unknown
  pageviews?: unknown
  metrics?: Record<string, unknown>
}

// Answers each Umami request by endpoint (and metrics type), not by call order.
function routeUmami(routes: UmamiRoutes) {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input))
    const endpoint = url.pathname.split('/').pop()
    let body: unknown = {}

    if (endpoint === 'stats') body = routes.stats ?? {}
    if (endpoint === 'pageviews') body = routes.pageviews ?? {}
    if (endpoint === 'metrics') body = routes.metrics?.[url.searchParams.get('type') ?? ''] ?? {}

    return mockFetchResponse(body)
  }
}

describe('createUmamiProvider', () => {
  let provider: AnalyticsProvider
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>

  const requestedUrls = () => fetchMock.mock.calls.map(([input]) => new URL(String(input)))

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    fetchMock = vi.fn<typeof fetch>()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('creation', () => {
    it('should initialize with provided config', async () => {
      provider = createUmamiProvider({
        apiKey: 'test-api-key',
        siteId: 'test-site-id',
        apiHost: 'https://analytics.example.com',
      })
      fetchMock.mockImplementation(routeUmami({}))

      await provider.getDashboardData('7d')

      expect(provider.name).toBe('umami')
      const [url] = requestedUrls()
      expect(url.origin).toBe('https://analytics.example.com')
      expect(url.pathname).toBe('/api/websites/test-site-id/stats')
    })

    it('should use environment variables when config is not provided', async () => {
      process.env.UMAMI_API_KEY = 'env-api-key'
      process.env.UMAMI_SITE_ID = 'env-site-id'
      process.env.UMAMI_API_HOST = 'https://env.analytics.com'

      try {
        provider = createUmamiProvider({})
        fetchMock.mockImplementation(routeUmami({}))

        await provider.getDashboardData('7d')

        expect(provider.name).toBe('umami')
        const [url] = requestedUrls()
        expect(url.origin).toBe('https://env.analytics.com')
        expect(url.pathname).toBe('/api/websites/env-site-id/stats')
        const init = fetchMock.mock.calls[0][1]
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer env-api-key' })
      } finally {
        delete process.env.UMAMI_API_KEY
        delete process.env.UMAMI_SITE_ID
        delete process.env.UMAMI_API_HOST
      }
    })

    it('should use the Umami Cloud API host by default', async () => {
      provider = createUmamiProvider({ apiKey: 'test-api-key', siteId: 'test-site-id' })
      fetchMock.mockImplementation(routeUmami({}))

      await provider.getDashboardData('7d')

      expect(requestedUrls()[0].origin).toBe('https://api.umami.is')
    })

    it('should return null without calling the API when credentials are missing', async () => {
      provider = createUmamiProvider({})

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getDashboardData', () => {
    beforeEach(() => {
      provider = createUmamiProvider({
        apiKey: 'test-api-key',
        siteId: 'test-site-id',
        apiHost: 'https://analytics.example.com',
      })
    })

    it('should fetch and transform data correctly', async () => {
      fetchMock.mockImplementation(
        routeUmami({
          stats: {
            pageviews: { value: 5678, change: 13.56 },
            visitors: { value: 1234, change: 23.4 },
            visits: { value: 1500 },
            bounces: { value: 678 },
            totaltime: { value: 270000 },
          },
          pageviews: umamiPageviews,
          metrics: umamiMetrics,
        })
      )

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()
      // Changes come straight from the stats response; derived metrics have none
      expect(result?.stats).toEqual({
        visitors: { value: 1234, change: 23.4 },
        pageviews: { value: 5678, change: 13.56 },
        bounce_rate: { value: 45.2, change: null }, // 678/1500 * 100
        visit_duration: { value: 180, change: null }, // 270000/1500
      })

      expect(result?.timeseries).toHaveLength(3)
      expect(result?.timeseries?.[0]).toEqual({
        date: '2024-01-10T00:00:00.000Z',
        visitors: 100,
        pageviews: 250,
      })

      expect(result?.pages).toEqual([
        { page: '/', visitors: 1200, pageviews: 1200, bounce_rate: 45.2, visit_duration: 180 },
        { page: '/about', visitors: 450, pageviews: 450, bounce_rate: 45.2, visit_duration: 180 },
      ])
      expect(result?.sources).toEqual([
        { source: 'google.com', visitors: 400, bounce_rate: 45.2, visit_duration: 180 },
        { source: 'Direct', visitors: 350, bounce_rate: 45.2, visit_duration: 180 },
      ])
      expect(result?.events).toHaveLength(2)
      expect(result?.events?.[0].goal).toBe('Signup')
      expect(result?.events?.[0].events).toBe(45)
      expect(result?.events?.[0].conversion_rate).toBeCloseTo((45 / 1234) * 100, 5)
      // Umami has no realtime endpoint; the provider reports zero
      expect(result?.realtime).toEqual({ visitors: 0 })
    })

    it('should report a null change when the stats response has none', async () => {
      fetchMock.mockImplementation(routeUmami({ stats: umamiStatsResponse }))

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.visitors).toEqual({ value: 1234, change: null })
      expect(result?.stats?.pageviews).toEqual({ value: 5678, change: null })
    })

    it('should calculate time periods correctly', async () => {
      fetchMock.mockImplementation(routeUmami({}))

      await provider.getDashboardData('30d')

      const [statsUrl] = requestedUrls()
      expect(statsUrl.pathname).toBe('/api/websites/test-site-id/stats')
      expect(statsUrl.searchParams.get('startAt')).toBe(String(NOW.getTime() - 30 * DAY))
      expect(statsUrl.searchParams.get('endAt')).toBe(String(NOW.getTime()))
      expect(statsUrl.searchParams.get('unit')).toBe('day')
    })

    it('should request each metrics type with a limit of 10', async () => {
      fetchMock.mockImplementation(routeUmami({}))

      await provider.getDashboardData('7d')

      const metricsCalls = requestedUrls().filter((url) => url.pathname.endsWith('/metrics'))
      expect(metricsCalls.map((url) => url.searchParams.get('type'))).toEqual([
        'url',
        'referrer',
        'event',
      ])
      for (const url of metricsCalls) {
        expect(url.searchParams.get('limit')).toBe('10')
      }
    })

    it('should handle empty responses from the secondary endpoints', async () => {
      fetchMock.mockImplementation(
        routeUmami({
          stats: {
            pageviews: { value: 0 },
            visitors: { value: 0 },
            visits: { value: 0 },
            bounces: { value: 0 },
            totaltime: { value: 0 },
          },
        })
      )

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()
      expect(result?.stats?.visitors.value).toBe(0)
      expect(result?.stats?.pageviews.value).toBe(0)
      // No visits: derived metrics fall back to 0 instead of dividing by zero
      expect(result?.stats?.bounce_rate.value).toBe(0)
      expect(result?.stats?.visit_duration.value).toBe(0)
      expect(result?.timeseries).toEqual([])
      expect(result?.pages).toEqual([])
      expect(result?.sources).toEqual([])
      expect(result?.events).toEqual([])
    })

    it('should return null when the stats response is missing or invalid', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse({}))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should handle API errors gracefully', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should return null when the API responds with an error status', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse({ error: 'Unauthorized' }, 401))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should send correct authorization headers', async () => {
      fetchMock.mockImplementation(routeUmami({}))

      await provider.getDashboardData('7d')

      expect(fetchMock).toHaveBeenCalledTimes(5)
      for (const [, init] of fetchMock.mock.calls) {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer test-api-key',
          'Content-Type': 'application/json',
        })
      }
    })

    it('should calculate bounce rate correctly', async () => {
      fetchMock.mockImplementation(
        routeUmami({
          stats: {
            pageviews: { value: 1000 },
            visitors: { value: 500 },
            visits: { value: 600 },
            bounces: { value: 300 },
            totaltime: { value: 108000 }, // 180 seconds * 600 visits
          },
        })
      )

      const result = await provider.getDashboardData('7d')

      // Bounce rate = (bounces / visits) * 100
      expect(result?.stats?.bounce_rate.value).toBe(50) // 300/600 * 100
      expect(result?.stats?.visit_duration.value).toBe(180) // 108000/600
    })

    it('should handle different time period formats', async () => {
      fetchMock.mockImplementation(routeUmami({}))

      const expected: Record<string, { span: number; unit: string }> = {
        day: { span: DAY, unit: 'hour' },
        '7d': { span: 7 * DAY, unit: 'day' },
        '30d': { span: 30 * DAY, unit: 'day' },
        '12mo': { span: 365 * DAY, unit: 'month' },
        unknown: { span: 7 * DAY, unit: 'day' }, // falls back to 7 days
      }

      for (const [period, { span, unit }] of Object.entries(expected)) {
        fetchMock.mockClear()

        await provider.getDashboardData(period)

        expect(fetchMock).toHaveBeenCalledTimes(5) // 5 API calls per period
        const [statsUrl] = requestedUrls()
        expect(statsUrl.searchParams.get('startAt')).toBe(String(NOW.getTime() - span))
        expect(statsUrl.searchParams.get('unit')).toBe(unit)
      }
    })
  })

  describe('trackEvent', () => {
    it('should be a server-side placeholder that makes no API call', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      provider = createUmamiProvider({
        apiKey: 'test-api-key',
        siteId: 'test-site-id',
      })

      provider.trackEvent?.('Signup', { plan: 'pro' })

      expect(provider.trackEvent).toBeTypeOf('function')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith('Track event:', 'Signup', { plan: 'pro' })
      logSpy.mockRestore()
    })
  })
})
