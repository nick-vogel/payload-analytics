import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPlausibleProvider } from '@/providers/plausible'
import { mockFetchResponse } from '../../utils/test-helpers'
import { plausibleStatsResponse, plausibleTimeseriesResponse } from '../../fixtures/api-responses'

// Plausible's v1 breakdown endpoint returns metrics as flat numbers, unlike the
// aggregate endpoint which nests each metric under `value`.
const pagesBreakdownResponse = {
  results: [
    { page: '/', visitors: 500, pageviews: 1200, bounce_rate: 35, visit_duration: 240 },
    { page: '/about', visitors: 300, pageviews: 450, bounce_rate: 55, visit_duration: 120 },
  ],
}

const sourcesBreakdownResponse = {
  results: [
    { source: 'Google', visitors: 400, bounce_rate: 40, visit_duration: 200 },
    { source: 'Direct / None', visitors: 350, bounce_rate: 50, visit_duration: 150 },
    { source: 'Twitter', visitors: 200, bounce_rate: 60, visit_duration: 90 },
  ],
}

const goalsBreakdownResponse = {
  results: [
    { goal: 'Signup', visitors: 45, events: 50, conversion_rate: 3.6 },
    { goal: 'Purchase', visitors: 23, events: 25, conversion_rate: 1.9 },
  ],
}

// The realtime endpoint returns a bare number.
const realtimeResponse = 42

const fetchMock = vi.fn<typeof fetch>()

const urlOf = (call: Parameters<typeof fetch>): URL => new URL(String(call[0]))

const callFor = (endpoint: string, property?: string) =>
  fetchMock.mock.calls.find((call) => {
    const url = urlOf(call)
    return (
      url.pathname === `/api/v1/stats/${endpoint}` &&
      (property === undefined || url.searchParams.get('property') === property)
    )
  })

/** Answer each Plausible request by endpoint and breakdown property, not by call order. */
const routePlausible = (responses: {
  aggregate?: unknown
  timeseries?: unknown
  pages?: unknown
  sources?: unknown
  goals?: unknown
  realtime?: unknown
}) => {
  fetchMock.mockImplementation((input) => {
    const url = new URL(String(input))
    const endpoint = url.pathname.replace('/api/v1/stats/', '')
    const property = url.searchParams.get('property')
    const body =
      endpoint === 'aggregate' ? responses.aggregate
      : endpoint === 'timeseries' ? responses.timeseries
      : endpoint === 'realtime/visitors' ? responses.realtime
      : property === 'event:page' ? responses.pages
      : property === 'visit:source' ? responses.sources
      : property === 'event:goal' ? responses.goals
      : undefined
    return mockFetchResponse(body ?? {})
  })
}

describe('createPlausibleProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('configuration', () => {
    it('should initialize with provided config', () => {
      const provider = createPlausibleProvider({
        apiKey: 'test-api-key',
        siteId: 'test-site.com',
        apiHost: 'https://plausible.io',
      })

      expect(provider.name).toBe('plausible')
    })

    it('should use environment variables when config is not provided', async () => {
      vi.stubEnv('PLAUSIBLE_API_KEY', 'env-api-key')
      vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_DOMAIN', 'env-site.com')
      vi.stubEnv('PLAUSIBLE_API_HOST', 'https://analytics.example.com')
      routePlausible({ aggregate: plausibleStatsResponse })

      const provider = createPlausibleProvider({})
      await provider.getDashboardData('7d')

      const call = callFor('aggregate')
      expect(call).toBeDefined()
      if (!call) return
      const url = urlOf(call)
      expect(url.origin).toBe('https://analytics.example.com')
      expect(url.searchParams.get('site_id')).toBe('env-site.com')
      expect(call[1]?.headers).toEqual({ Authorization: 'Bearer env-api-key' })
    })

    it('should prioritize config over environment variables', async () => {
      vi.stubEnv('PLAUSIBLE_API_KEY', 'env-api-key')
      vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_DOMAIN', 'env-site.com')
      routePlausible({ aggregate: plausibleStatsResponse })

      const provider = createPlausibleProvider({
        apiKey: 'config-api-key',
        siteId: 'config-site.com',
      })
      await provider.getDashboardData('7d')

      const call = callFor('aggregate')
      expect(call).toBeDefined()
      if (!call) return
      expect(urlOf(call).searchParams.get('site_id')).toBe('config-site.com')
      expect(call[1]?.headers).toEqual({ Authorization: 'Bearer config-api-key' })
    })

    it('should default the API host to plausible.io', async () => {
      vi.stubEnv('PLAUSIBLE_API_HOST', '')
      vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_HOST', '')
      routePlausible({ aggregate: plausibleStatsResponse })

      const provider = createPlausibleProvider({ apiKey: 'k', siteId: 's' })
      await provider.getDashboardData('7d')

      const call = callFor('aggregate')
      expect(call && urlOf(call).origin).toBe('https://plausible.io')
    })

    it('should return null without calling the API when credentials are missing', async () => {
      vi.stubEnv('PLAUSIBLE_API_KEY', '')
      vi.stubEnv('NEXT_PUBLIC_PLAUSIBLE_DOMAIN', '')

      const provider = createPlausibleProvider({})
      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getDashboardData', () => {
    const provider = createPlausibleProvider({
      apiKey: 'test-api-key',
      siteId: 'test-site.com',
      apiHost: 'https://plausible.io',
    })

    it('should fetch and transform data correctly', async () => {
      routePlausible({
        aggregate: plausibleStatsResponse,
        timeseries: plausibleTimeseriesResponse,
        pages: pagesBreakdownResponse,
        sources: sourcesBreakdownResponse,
        goals: goalsBreakdownResponse,
        realtime: realtimeResponse,
      })

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()
      // Without a comparison the aggregate response carries no `change`, so it is null.
      expect(result?.stats).toEqual({
        visitors: { value: 1234, change: null },
        pageviews: { value: 5678, change: null },
        bounce_rate: { value: 45.2, change: null },
        visit_duration: { value: 180, change: null },
      })
      expect(result?.timeseries).toEqual(plausibleTimeseriesResponse.results)
      expect(result?.pages).toEqual(pagesBreakdownResponse.results)
      expect(result?.sources).toEqual(sourcesBreakdownResponse.results)
      expect(result?.events).toEqual(goalsBreakdownResponse.results)
      expect(result?.realtime).toEqual({ visitors: 42 })
    })

    it('should request each breakdown with its own property and metrics', async () => {
      routePlausible({ aggregate: plausibleStatsResponse })

      await provider.getDashboardData('7d')

      const pages = callFor('breakdown', 'event:page')
      const sources = callFor('breakdown', 'visit:source')
      const goals = callFor('breakdown', 'event:goal')
      expect(pages && urlOf(pages).searchParams.get('metrics')).toBe('visitors,pageviews,bounce_rate,visit_duration')
      expect(sources && urlOf(sources).searchParams.get('metrics')).toBe('visitors,bounce_rate,visit_duration')
      expect(goals && urlOf(goals).searchParams.get('metrics')).toBe('visitors,events,conversion_rate')
      for (const call of [pages, sources, goals]) {
        expect(call && urlOf(call).searchParams.get('limit')).toBe('10')
      }
      expect(fetchMock).toHaveBeenCalledTimes(6)
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

    it('should send the bearer token with every API request', async () => {
      routePlausible({ aggregate: plausibleStatsResponse })

      await provider.getDashboardData('7d')

      expect(fetchMock).toHaveBeenCalledTimes(6)
      for (const call of fetchMock.mock.calls) {
        expect(call[1]?.headers).toEqual({ Authorization: 'Bearer test-api-key' })
        expect(urlOf(call).searchParams.get('site_id')).toBe('test-site.com')
      }
    })

    it('should pass plain time periods through to the API', async () => {
      routePlausible({ aggregate: plausibleStatsResponse })

      await provider.getDashboardData('30d')

      const call = callFor('aggregate')
      expect(call && urlOf(call).searchParams.get('period')).toBe('30d')
    })

    it('should send a custom date range as period=custom', async () => {
      routePlausible({ aggregate: plausibleStatsResponse })

      await provider.getDashboardData('2024-01-01,2024-01-31')

      const call = callFor('aggregate')
      expect(call).toBeDefined()
      if (!call) return
      const params = urlOf(call).searchParams
      expect(params.get('period')).toBe('custom')
      expect(params.get('date')).toBe('2024-01-01,2024-01-31')
    })

    it('should send year to date as a custom range from January 1', async () => {
      routePlausible({ aggregate: plausibleStatsResponse })

      await provider.getDashboardData('year')

      const call = callFor('aggregate')
      expect(call).toBeDefined()
      if (!call) return
      const params = urlOf(call).searchParams
      const today = new Date().toISOString().split('T')[0]
      expect(params.get('period')).toBe('custom')
      expect(params.get('date')).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2},${today}$`))
    })

    it('should use the change values Plausible returns for a previous-period comparison', async () => {
      routePlausible({
        aggregate: {
          results: {
            visitors: { value: 1200, change: 20 },
            pageviews: { value: 5000, change: -9.09 },
            bounce_rate: { value: 45, change: -10 },
            visit_duration: { value: 180, change: 20 },
          },
        },
      })

      const result = await provider.getDashboardData('7d', { period: 'previousPeriod' })

      const call = callFor('aggregate')
      expect(call && urlOf(call).searchParams.get('compare')).toBe('previous_period')
      expect(result?.stats?.visitors.change).toBe(20)
      expect(result?.stats?.pageviews.change).toBe(-9.09)
      expect(result?.stats?.bounce_rate.change).toBe(-10)
      expect(result?.stats?.visit_duration.change).toBe(20)
    })

    it('should handle missing data gracefully', async () => {
      routePlausible({ aggregate: { results: {} } })

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()
      expect(result?.stats?.visitors).toEqual({ value: 0, change: null })
      expect(result?.timeseries).toEqual([])
      expect(result?.pages).toEqual([])
      expect(result?.sources).toEqual([])
      expect(result?.events).toEqual([])
      expect(result?.realtime).toEqual({ visitors: 0 })
    })

    describe('named calendar periods', () => {
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] })
        // Mid-month and mid-day, in a leap year, so February ends on the 29th.
        vi.setSystemTime(new Date('2024-03-15T12:00:00Z'))
        routePlausible({ aggregate: plausibleStatsResponse })
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      const dateParamsFor = async (period: string) => {
        fetchMock.mockClear()
        await provider.getDashboardData(period)
        const call = callFor('aggregate')
        const params = call ? urlOf(call).searchParams : new URLSearchParams()
        return { period: params.get('period'), date: params.get('date') }
      }

      it('should send all time as a custom range from 2019 to today', async () => {
        expect(await dateParamsFor('all')).toEqual({ period: 'custom', date: '2019-01-01,2024-03-15' })
      })

      it('should send this year as a custom range from January 1 to today', async () => {
        expect(await dateParamsFor('thisYear')).toEqual({ period: 'custom', date: '2024-01-01,2024-03-15' })
        expect(await dateParamsFor('year')).toEqual({ period: 'custom', date: '2024-01-01,2024-03-15' })
      })

      it('should send last year as the whole previous calendar year', async () => {
        expect(await dateParamsFor('lastYear')).toEqual({ period: 'custom', date: '2023-01-01,2023-12-31' })
      })

      it('should send last month as its first and last day', async () => {
        expect(await dateParamsFor('lastMonth')).toEqual({ period: 'custom', date: '2024-02-01,2024-02-29' })
      })

      it('should apply the same custom range to the timeseries and breakdowns', async () => {
        await provider.getDashboardData('lastYear')

        for (const call of [callFor('timeseries'), callFor('breakdown', 'event:page'), callFor('breakdown', 'visit:source')]) {
          expect(call && urlOf(call).searchParams.get('date')).toBe('2023-01-01,2023-12-31')
        }
        // The realtime counter takes no period at all.
        const realtime = callFor('realtime/visitors')
        expect(realtime && urlOf(realtime).searchParams.has('period')).toBe(false)
      })
    })

    describe('comparison parameters', () => {
      const aggregateParams = () => {
        const call = callFor('aggregate')
        return call ? urlOf(call).searchParams : new URLSearchParams()
      }

      beforeEach(() => {
        routePlausible({ aggregate: plausibleStatsResponse })
      })

      it('should ask for the previous year when comparing to the same period last year', async () => {
        await provider.getDashboardData('30d', { period: 'sameLastYear' })

        expect(aggregateParams().get('compare')).toBe('previous_year')
        expect(aggregateParams().has('compare_from')).toBe(false)
      })

      it('should send an explicit comparison range for a custom comparison', async () => {
        await provider.getDashboardData('30d', {
          period: 'custom',
          customStartDate: '2023-01-01',
          customEndDate: '2023-01-31',
        })

        const params = aggregateParams()
        expect(params.get('compare_from')).toBe('2023-01-01')
        expect(params.get('compare_to')).toBe('2023-01-31')
        expect(params.has('compare')).toBe(false)
        const timeseries = callFor('timeseries')
        expect(timeseries && urlOf(timeseries).searchParams.get('compare_from')).toBe('2023-01-01')
      })

      it('should send no comparison when a custom comparison is missing its end date', async () => {
        await provider.getDashboardData('30d', { period: 'custom', customStartDate: '2023-01-01' })

        const params = aggregateParams()
        expect(params.has('compare')).toBe(false)
        expect(params.has('compare_from')).toBe(false)
        expect(params.has('compare_to')).toBe(false)
        expect(params.get('period')).toBe('30d')
      })
    })
  })

  describe('trackEvent', () => {
    it('should be a client-side stub that only logs the event', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const provider = createPlausibleProvider({
        apiKey: 'test-api-key',
        siteId: 'test-site.com',
      })

      provider.trackEvent?.('Signup', { plan: 'pro' })

      expect(log).toHaveBeenCalledWith('Track event:', 'Signup', { plan: 'pro' })
      expect(fetchMock).not.toHaveBeenCalled()
      log.mockRestore()
    })
  })
})
