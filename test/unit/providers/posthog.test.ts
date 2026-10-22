import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPostHogProvider } from '@/providers/posthog'
import type { AnalyticsProvider } from '@/types'
import { mockFetchResponse } from '../../utils/test-helpers'

const NOW = new Date('2024-01-10T12:00:00Z')

// Fixtures in the shape the current provider reads: PostHog trend results
// carry `results[].count`, `results[].data` and `results[].labels`.
const trend = (count: number, data: number[] = [], labels: string[] = []) => ({
  results: [{ label: '$pageview', count, data, labels }],
})

interface PostHogRoutes {
  pageviews?: unknown
  visitors?: unknown
  prevPageviews?: unknown
  prevVisitors?: unknown
  paths?: unknown
  referrers?: unknown
  events?: unknown
}

const emptyResults = { results: [] }

// Answers each PostHog request by what it asks for, not by call order.
// A previous-period request is one whose date_to is not "now".
function routePostHog(routes: PostHogRoutes) {
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input))
    const params = url.searchParams
    const isPrevious = params.get('date_to') !== NOW.toISOString()
    let body: unknown = emptyResults

    if (url.pathname.endsWith('/insights/path/')) {
      body = routes.paths ?? emptyResults
    } else if (url.pathname.endsWith('/events/')) {
      body = routes.events ?? emptyResults
    } else if (url.pathname.endsWith('/insights/trend/')) {
      if (params.get('breakdown') === '$referrer') {
        body = routes.referrers ?? emptyResults
      } else if (params.get('events')?.includes('"dau"')) {
        body = (isPrevious ? routes.prevVisitors : routes.visitors) ?? emptyResults
      } else {
        body = (isPrevious ? routes.prevPageviews : routes.pageviews) ?? emptyResults
      }
    }

    return mockFetchResponse(body)
  }
}

describe('createPostHogProvider', () => {
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
      provider = createPostHogProvider({
        apiKey: 'test-api-key',
        projectId: 'test-project-id',
        apiHost: 'https://posthog.example.com',
      })
      fetchMock.mockImplementation(routePostHog({}))

      await provider.getDashboardData('7d')

      expect(provider.name).toBe('posthog')
      const [url] = requestedUrls()
      expect(url.origin).toBe('https://posthog.example.com')
      expect(url.pathname.startsWith('/api/projects/test-project-id/')).toBe(true)
    })

    it('should use environment variables when config is not provided', async () => {
      process.env.POSTHOG_API_KEY = 'env-api-key'
      process.env.POSTHOG_PROJECT_ID = 'env-project-id'
      process.env.POSTHOG_API_HOST = 'https://env.posthog.com'

      try {
        provider = createPostHogProvider({})
        fetchMock.mockImplementation(routePostHog({}))

        await provider.getDashboardData('7d')

        expect(provider.name).toBe('posthog')
        const [url] = requestedUrls()
        expect(url.origin).toBe('https://env.posthog.com')
        expect(url.pathname.startsWith('/api/projects/env-project-id/')).toBe(true)
        const init = fetchMock.mock.calls[0][1]
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer env-api-key' })
      } finally {
        delete process.env.POSTHOG_API_KEY
        delete process.env.POSTHOG_PROJECT_ID
        delete process.env.POSTHOG_API_HOST
      }
    })

    it('should use default API host if not provided', async () => {
      provider = createPostHogProvider({
        apiKey: 'test-api-key',
        projectId: 'test-project-id',
      })
      fetchMock.mockImplementation(routePostHog({}))

      await provider.getDashboardData('7d')

      expect(provider.name).toBe('posthog')
      expect(requestedUrls()[0].origin).toBe('https://app.posthog.com')
    })

    it('should return null without calling the API when credentials are missing', async () => {
      provider = createPostHogProvider({})

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getDashboardData', () => {
    beforeEach(() => {
      provider = createPostHogProvider({
        apiKey: 'test-api-key',
        projectId: 'test-project-id',
        apiHost: 'https://app.posthog.com',
      })
    })

    it('should fetch and transform data correctly', async () => {
      fetchMock.mockImplementation(
        routePostHog({
          pageviews: trend(330, [100, 120, 110], ['2024-01-08', '2024-01-09', '2024-01-10']),
          visitors: trend(30, [10, 12, 8], ['2024-01-08', '2024-01-09', '2024-01-10']),
          prevPageviews: trend(330),
          prevVisitors: trend(10),
          paths: { results: [{ path: '/', count: 20 }, { path: '/about', count: 5 }] },
          referrers: { results: [{ label: 'google.com', count: 18 }, { label: '', count: 12 }] },
          events: { results: [{ event: 'Signup', count: 3 }] },
        })
      )

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()

      // Stats: totals come from the trend counts, changes from the previous period
      expect(result?.stats?.visitors).toEqual({ value: 30, change: 200 }) // (30-10)/10 * 100
      expect(result?.stats?.pageviews).toEqual({ value: 330, change: 0 }) // (330-330)/330 * 100
      expect(result?.stats?.bounce_rate).toEqual({ value: 45, change: null })
      expect(result?.stats?.visit_duration).toEqual({ value: 120, change: null })

      // Pages
      expect(result?.pages).toHaveLength(2)
      expect(result?.pages?.[0]).toEqual({
        page: '/',
        visitors: 20,
        pageviews: 20,
        bounce_rate: 45,
        visit_duration: 120,
      })

      // Sources
      expect(result?.sources).toEqual([
        { source: 'google.com', visitors: 18, bounce_rate: 45, visit_duration: 120 },
        { source: 'Direct', visitors: 12, bounce_rate: 45, visit_duration: 120 },
      ])

      // Events: conversion rate is event count over current visitors
      expect(result?.events).toEqual([
        { goal: 'Signup', visitors: 3, events: 3, conversion_rate: 10 },
      ])

      // Timeseries pairs pageview and visitor data by label
      expect(result?.timeseries).toEqual([
        { date: '2024-01-08', visitors: 10, pageviews: 100 },
        { date: '2024-01-09', visitors: 12, pageviews: 120 },
        { date: '2024-01-10', visitors: 8, pageviews: 110 },
      ])

      expect(result?.realtime).toEqual({ visitors: 0 })
    })

    it('should report a null change when the previous period has no data', async () => {
      fetchMock.mockImplementation(
        routePostHog({
          pageviews: trend(50),
          visitors: trend(20),
          prevPageviews: trend(0),
          prevVisitors: emptyResults,
        })
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.visitors).toEqual({ value: 20, change: null })
      expect(result?.stats?.pageviews).toEqual({ value: 50, change: null })
    })

    it('should handle empty results responses', async () => {
      fetchMock.mockImplementation(routePostHog({}))

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()
      expect(result?.stats?.visitors.value).toBe(0)
      expect(result?.stats?.pageviews.value).toBe(0)
      expect(result?.timeseries).toEqual([])
      expect(result?.pages).toEqual([])
      expect(result?.sources).toEqual([])
      expect(result?.events).toEqual([])
    })

    it('should return null when the trend responses fail validation', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse({ result: [] }))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should report placeholder bounce rate and visit duration', async () => {
      // PostHog has no bounce rate or duration endpoint; the provider reports fixed placeholders
      fetchMock.mockImplementation(
        routePostHog({ pageviews: trend(6), visitors: trend(3) })
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.bounce_rate).toEqual({ value: 45, change: null })
      expect(result?.stats?.visit_duration).toEqual({ value: 120, change: null })
    })

    it('should extract sources from the referrer breakdown', async () => {
      fetchMock.mockImplementation(
        routePostHog({
          pageviews: trend(4),
          visitors: trend(4),
          referrers: {
            results: [
              { label: 'google', count: 1 },
              { label: 'twitter', count: 1 },
              { label: 'facebook.com', count: 1 },
              { count: 1 },
            ],
          },
        })
      )

      const result = await provider.getDashboardData('7d')

      const breakdownCall = requestedUrls().find(
        (url) => url.searchParams.get('breakdown') === '$referrer'
      )
      expect(breakdownCall?.searchParams.get('breakdown_type')).toBe('event')

      expect(result?.sources).toHaveLength(4)
      expect(result?.sources?.find((s) => s.source === 'google')).toBeDefined()
      expect(result?.sources?.find((s) => s.source === 'twitter')).toBeDefined()
      expect(result?.sources?.find((s) => s.source === 'facebook.com')).toBeDefined()
      expect(result?.sources?.find((s) => s.source === 'Direct')).toBeDefined()
    })

    it('should handle API errors gracefully', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should return null when the API responds with an error status', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse({}, 500))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should send correct authorization headers', async () => {
      fetchMock.mockImplementation(routePostHog({}))

      await provider.getDashboardData('7d')

      expect(fetchMock).toHaveBeenCalledTimes(7)
      for (const [, init] of fetchMock.mock.calls) {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer test-api-key',
          'Content-Type': 'application/json',
        })
      }
    })

    it('should calculate date ranges correctly', async () => {
      fetchMock.mockImplementation(routePostHog({}))

      await provider.getDashboardData('30d')

      const ranges = requestedUrls().map((url) => [
        url.searchParams.get('date_from'),
        url.searchParams.get('date_to'),
      ])

      // Current period
      expect(ranges[0]).toEqual(['2023-12-11T12:00:00.000Z', '2024-01-10T12:00:00.000Z'])
      expect(requestedUrls()[0].searchParams.get('interval')).toBe('day')
      // Previous period ends where the current one starts
      expect(ranges).toContainEqual(['2023-11-11T12:00:00.000Z', '2023-12-11T12:00:00.000Z'])
    })

    it('should use hourly intervals for the day period', async () => {
      fetchMock.mockImplementation(routePostHog({}))

      await provider.getDashboardData('day')

      const [url] = requestedUrls()
      expect(url.searchParams.get('date_from')).toBe('2024-01-09T12:00:00.000Z')
      expect(url.searchParams.get('interval')).toBe('hour')
    })

    it('should fall back to 7 days for an unknown period', async () => {
      fetchMock.mockImplementation(routePostHog({}))

      await provider.getDashboardData('unknown')

      const [url] = requestedUrls()
      expect(url.searchParams.get('date_from')).toBe('2024-01-03T12:00:00.000Z')
      expect(url.searchParams.get('interval')).toBe('day')
    })

    it('should use monthly intervals from the same day a year ago for 12mo', async () => {
      fetchMock.mockImplementation(routePostHog({}))

      await provider.getDashboardData('12mo')

      // 12mo starts at local midnight on the same calendar day one year earlier,
      // and the previous period is the year before that.
      const localDay = (iso: string | null) => {
        const date = new Date(String(iso))
        return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours()]
      }
      const [current] = requestedUrls()
      expect(current.searchParams.get('interval')).toBe('month')
      expect(localDay(current.searchParams.get('date_from'))).toEqual([2023, 1, 10, 0])
      expect(current.searchParams.get('date_to')).toBe(NOW.toISOString())

      const previous = requestedUrls().find((url) => url.searchParams.get('date_to') !== NOW.toISOString())
      expect(previous?.searchParams.get('date_to')).toBe(current.searchParams.get('date_from'))
      expect(localDay(previous?.searchParams.get('date_from') ?? null)).toEqual([2022, 1, 10, 0])
    })

    it('should report null changes when the previous-period responses fail validation', async () => {
      fetchMock.mockImplementation(
        routePostHog({
          pageviews: trend(50),
          visitors: trend(20),
          prevPageviews: { result: [] },
          prevVisitors: { results: 'nope' },
        })
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.visitors).toEqual({ value: 20, change: null })
      expect(result?.stats?.pageviews).toEqual({ value: 50, change: null })
    })

    it('should fill defaults for sparse rows and fail-safe lists', async () => {
      fetchMock.mockImplementation(
        routePostHog({
          // Visitor data is shorter than the labels, and one pageview point is 0.
          pageviews: trend(5, [5, 0], ['2024-01-09', '2024-01-10']),
          visitors: trend(0, [3], ['2024-01-09', '2024-01-10']),
          paths: { results: [{}] },
          referrers: { results: [{ label: 'news.ycombinator.com' }] },
          events: { results: [{ event: 'Signup', count: 0 }, { event: 'Purchase', count: 2 }] },
        })
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.timeseries).toEqual([
        { date: '2024-01-09', visitors: 3, pageviews: 5 },
        { date: '2024-01-10', visitors: 0, pageviews: 0 },
      ])
      expect(result?.pages).toEqual([
        { page: '/', visitors: 0, pageviews: 0, bounce_rate: 45, visit_duration: 120 },
      ])
      expect(result?.sources).toEqual([
        { source: 'news.ycombinator.com', visitors: 0, bounce_rate: 45, visit_duration: 120 },
      ])
      // With no current visitors there is nothing to divide by, so conversion is 0.
      expect(result?.events).toEqual([
        { goal: 'Signup', visitors: 0, events: 0, conversion_rate: 0 },
        { goal: 'Purchase', visitors: 2, events: 2, conversion_rate: 0 },
      ])
    })

    it('should return empty lists when paths, referrers and events carry no results', async () => {
      fetchMock.mockImplementation(
        routePostHog({
          pageviews: trend(5),
          visitors: trend(5),
          paths: {},
          referrers: {},
          events: {},
        })
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.pages).toEqual([])
      expect(result?.sources).toEqual([])
      expect(result?.events).toEqual([])
    })

    it('should keep only the first 10 paths and referrers', async () => {
      const many = Array.from({ length: 12 }, (_, i) => i)
      fetchMock.mockImplementation(
        routePostHog({
          pageviews: trend(5),
          visitors: trend(5),
          paths: { results: many.map((i) => ({ path: `/p${i}`, count: i })) },
          referrers: { results: many.map((i) => ({ label: `ref${i}`, count: i })) },
        })
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.pages?.map((p) => p.page)).toEqual(many.slice(0, 10).map((i) => `/p${i}`))
      expect(result?.sources?.map((s) => s.source)).toEqual(many.slice(0, 10).map((i) => `ref${i}`))
    })
  })

  describe('trackEvent', () => {
    it('should be a server-side placeholder that makes no API call', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      provider = createPostHogProvider({
        apiKey: 'test-api-key',
        projectId: 'test-project-id',
      })

      provider.trackEvent?.('Signup', { plan: 'pro' })

      expect(provider.trackEvent).toBeTypeOf('function')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith('PostHog trackEvent:', 'Signup', { plan: 'pro' })
      logSpy.mockRestore()
    })
  })
})
