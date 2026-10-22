import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMatomoProvider } from '@/providers/matomo'
import { mockFetchResponse } from '../../utils/test-helpers'

// Response shapes per Matomo's Reporting API (checked against demo.matomo.cloud).
// VisitsSummary.get returns a single object.
const currentSummary = {
  nb_uniq_visitors: 1234,
  nb_visits: 1500,
  nb_actions: 5678,
  bounce_rate: '45%',
  avg_time_on_site: 180,
}

const previousSummary = {
  nb_uniq_visitors: 1000,
  nb_visits: 1200,
  nb_actions: 5000,
  bounce_rate: '50%',
  avg_time_on_site: 150,
}

const pageUrls = [
  { label: '/', nb_visits: 600, nb_uniq_visitors: 500, nb_hits: 1200, bounce_rate: '35%', avg_time_on_page: 240 },
  { label: '/about', nb_visits: 350, nb_uniq_visitors: 300, nb_hits: 450, bounce_rate: '55%', avg_time_on_page: 120 },
]

const referrers = [
  { label: 'google.com', nb_visits: 450, nb_uniq_visitors: 400, bounce_rate: '40%', avg_time_on_site: 200 },
  { label: 'Direct Entry', nb_visits: 350 },
  { label: 'twitter.com', nb_visits: 200, bounce_rate: '60.5%' },
]

// Goals.getGoals returns definitions; Goals.get (showAllGoalSpecificMetrics=1) returns
// the per-goal conversions as goal_<idgoal>_* columns.
const goalDefinitions = [
  { idsite: 1, idgoal: 1, name: 'Signup', match_attribute: 'url', pattern: '/signup/done', pattern_type: 'contains', revenue: 0, deleted: 0 },
  { idsite: 1, idgoal: 2, name: 'Purchase', match_attribute: 'url', pattern: '/checkout/done', pattern_type: 'contains', revenue: 0, deleted: 0 },
]

const goalMetrics = {
  nb_conversions: 75,
  nb_visits_converted: 68,
  conversion_rate: '5.5%',
  goal_1_nb_conversions: 50,
  goal_1_nb_visits_converted: 45,
  goal_1_conversion_rate: '3.6%',
  goal_2_nb_conversions: 25,
  goal_2_nb_visits_converted: 23,
  goal_2_conversion_rate: '1.9%',
}

// VisitsSummary.getVisits returns a date-to-visits map.
const dailyVisits = {
  '2024-01-01': 110,
  '2024-01-02': 130,
  '2024-01-03': 115,
}

// Live.getCounters returns a one-element array.
const liveCounters = [{ visits: 50, actions: 120, visitors: 42, visitsConverted: 3 }]

type Route = (method: string, params: URLSearchParams) => unknown

const fetchMock = vi.fn<typeof fetch>()

const urlOf = (call: Parameters<typeof fetch>): URL => new URL(String(call[0]))

const isPreviousPeriod = (params: URLSearchParams) => {
  const date = params.get('date') ?? ''
  return date === 'yesterday' || date.startsWith('previous')
}

const callsFor = (method: string) =>
  fetchMock.mock.calls.filter((call) => urlOf(call).searchParams.get('method') === method)

/** Answer each Matomo request by its `method` parameter, not by call order. */
const routeMatomo = (route: Route) => {
  fetchMock.mockImplementation((input) => {
    const params = new URL(String(input)).searchParams
    return mockFetchResponse(route(params.get('method') ?? '', params) ?? [])
  })
}

const fullRoute: Route = (method, params) => {
  switch (method) {
    case 'VisitsSummary.get':
      return isPreviousPeriod(params) ? previousSummary : currentSummary
    case 'Actions.getPageUrls':
      return pageUrls
    case 'Referrers.getAll':
      return referrers
    case 'Goals.getGoals':
      return goalDefinitions
    case 'Goals.get':
      return goalMetrics
    case 'VisitsSummary.getVisits':
      return dailyVisits
    case 'Live.getCounters':
      return liveCounters
    default:
      return undefined
  }
}

describe('createMatomoProvider', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('configuration', () => {
    it('should initialize with provided config', () => {
      const provider = createMatomoProvider({
        apiToken: 'test-token',
        siteId: '1',
        apiHost: 'https://matomo.example.com',
      })

      expect(provider.name).toBe('matomo')
    })

    it('should use environment variables when config is not provided', async () => {
      vi.stubEnv('MATOMO_API_TOKEN', 'env-token')
      vi.stubEnv('MATOMO_SITE_ID', '2')
      vi.stubEnv('MATOMO_API_HOST', 'https://env.matomo.com')
      routeMatomo(fullRoute)

      const provider = createMatomoProvider({})
      await provider.getDashboardData('7d')

      expect(fetchMock).toHaveBeenCalled()
      for (const call of fetchMock.mock.calls) {
        const url = urlOf(call)
        expect(`${url.origin}${url.pathname}`).toBe('https://env.matomo.com/index.php')
        expect(url.searchParams.get('token_auth')).toBe('env-token')
        expect(url.searchParams.get('idSite')).toBe('2')
      }
    })

    it('should return null without calling the API when credentials are missing', async () => {
      vi.stubEnv('MATOMO_API_TOKEN', '')
      vi.stubEnv('MATOMO_SITE_ID', '')

      const provider = createMatomoProvider({})
      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('getDashboardData', () => {
    const provider = createMatomoProvider({
      apiToken: 'test-token',
      siteId: '1',
      apiHost: 'https://matomo.example.com',
    })

    it('should fetch and transform data correctly', async () => {
      routeMatomo(fullRoute)

      const result = await provider.getDashboardData('7d')

      expect(result).not.toBeNull()
      expect(result?.stats?.visitors.value).toBe(1234)
      expect(result?.stats?.visitors.change).toBeCloseTo(23.4, 5) // (1234-1000)/1000 * 100
      expect(result?.stats?.pageviews.value).toBe(5678)
      expect(result?.stats?.pageviews.change).toBeCloseTo(13.56, 5) // (5678-5000)/5000 * 100
      expect(result?.stats?.bounce_rate.value).toBe(45)
      expect(result?.stats?.bounce_rate.change).toBeCloseTo(-10, 5) // (45-50)/50 * 100
      expect(result?.stats?.visit_duration.value).toBe(180)
      expect(result?.stats?.visit_duration.change).toBeCloseTo(20, 5) // (180-150)/150 * 100

      expect(result?.timeseries).toEqual([
        { date: new Date('2024-01-01').toISOString(), visitors: 110 },
        { date: new Date('2024-01-02').toISOString(), visitors: 130 },
        { date: new Date('2024-01-03').toISOString(), visitors: 115 },
      ])
      expect(result?.pages).toEqual([
        { page: '/', visitors: 500, pageviews: 1200, bounce_rate: 35, visit_duration: 240 },
        { page: '/about', visitors: 300, pageviews: 450, bounce_rate: 55, visit_duration: 120 },
      ])
      expect(result?.sources).toHaveLength(3)
      expect(result?.events).toEqual([
        { goal: 'Signup', visitors: 45, events: 50, conversion_rate: 3.6 },
        { goal: 'Purchase', visitors: 23, events: 25, conversion_rate: 1.9 },
      ])
      expect(result?.realtime).toEqual({ visitors: 42 })
    })

    it('should handle percentage parsing correctly', async () => {
      routeMatomo((method) =>
        method === 'VisitsSummary.get'
          ? { nb_uniq_visitors: 1000, nb_actions: 2000, bounce_rate: '75.5%', avg_time_on_site: 200 }
          : undefined,
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.bounce_rate.value).toBe(75.5)
    })

    it('should return a null change when there is no previous-period data', async () => {
      routeMatomo((method, params) =>
        method === 'VisitsSummary.get' && !isPreviousPeriod(params) ? currentSummary : undefined,
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.visitors).toEqual({ value: 1234, change: null })
      expect(result?.stats?.pageviews).toEqual({ value: 5678, change: null })
    })

    it('should map time periods correctly', async () => {
      routeMatomo(fullRoute)

      const periodMappings = [
        { input: 'day', period: 'day', date: 'today', previous: 'yesterday', series: 'today' },
        { input: '7d', period: 'range', date: 'last7', previous: 'previous7', series: 'last7' },
        { input: '30d', period: 'range', date: 'last30', previous: 'previous30', series: 'last30' },
        { input: '12mo', period: 'range', date: 'last365', previous: 'previous365', series: 'last365' },
      ]

      for (const mapping of periodMappings) {
        fetchMock.mockClear()
        await provider.getDashboardData(mapping.input)

        const summaries = callsFor('VisitsSummary.get').map((call) => urlOf(call).searchParams)
        expect(summaries).toHaveLength(2)
        expect(summaries[0].get('period')).toBe(mapping.period)
        expect(summaries[0].get('date')).toBe(mapping.date)
        expect(summaries[1].get('period')).toBe(mapping.period)
        expect(summaries[1].get('date')).toBe(mapping.previous)

        const [series] = callsFor('VisitsSummary.getVisits').map((call) => urlOf(call).searchParams)
        expect(series.get('period')).toBe('day')
        expect(series.get('date')).toBe(mapping.series)
      }
    })

    it('should report zero live visitors when the live counter is missing', async () => {
      routeMatomo((method, params) => (method === 'Live.getCounters' ? undefined : fullRoute(method, params)))

      const result = await provider.getDashboardData('7d')

      expect(result?.realtime).toEqual({ visitors: 0 })
    })

    it('should construct API URLs correctly', async () => {
      routeMatomo(fullRoute)

      await provider.getDashboardData('7d')

      const calls = fetchMock.mock.calls
      expect(calls).toHaveLength(8)
      for (const call of calls) {
        const url = urlOf(call)
        expect(`${url.origin}${url.pathname}`).toBe('https://matomo.example.com/index.php')
        expect(url.searchParams.get('module')).toBe('API')
        expect(url.searchParams.get('format')).toBe('JSON')
        expect(url.searchParams.get('idSite')).toBe('1')
        expect(url.searchParams.get('token_auth')).toBe('test-token')
      }
      expect(calls.map((call) => urlOf(call).searchParams.get('method')).sort()).toEqual([
        'Actions.getPageUrls',
        'Goals.get',
        'Goals.getGoals',
        'Live.getCounters',
        'Referrers.getAll',
        'VisitsSummary.get',
        'VisitsSummary.get',
        'VisitsSummary.getVisits',
      ])
      const [pages] = callsFor('Actions.getPageUrls')
      expect(urlOf(pages).searchParams.get('flat')).toBe('1')
      expect(urlOf(pages).searchParams.get('filter_limit')).toBe('10')
      const [goals] = callsFor('Goals.get')
      expect(urlOf(goals).searchParams.get('showAllGoalSpecificMetrics')).toBe('1')
    })

    it('should handle API errors gracefully', async () => {
      fetchMock.mockRejectedValue(new Error('API Error'))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should handle non-200 responses', async () => {
      fetchMock.mockImplementation(() => mockFetchResponse('Forbidden', 403))

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should treat a Matomo error payload as a failure', async () => {
      routeMatomo((method, params) =>
        method === 'VisitsSummary.get' ? { result: 'error', message: 'token_auth is invalid' } : fullRoute(method, params),
      )

      const result = await provider.getDashboardData('7d')

      expect(result).toBeNull()
    })

    it('should map referrers to sources', async () => {
      routeMatomo(fullRoute)

      const result = await provider.getDashboardData('7d')

      expect(result?.sources).toEqual([
        { source: 'google.com', visitors: 400, bounce_rate: 40, visit_duration: 200 },
        // Falls back to nb_visits when Matomo omits unique visitors.
        { source: 'Direct Entry', visitors: 350, bounce_rate: 0, visit_duration: 0 },
        { source: 'twitter.com', visitors: 200, bounce_rate: 60.5, visit_duration: 0 },
      ])
    })
  })

  // These responses are trimmed copies of what Matomo's own public demo
  // (https://demo.matomo.cloud, token_auth=anonymous, idSite=1) returned for each
  // method on 2026-10-22.
  describe('real Matomo response shapes', () => {
    const provider = createMatomoProvider({
      apiToken: 'test-token',
      siteId: '1',
      apiHost: 'https://matomo.example.com',
    })

    it('should read live visitors from the Live.getCounters array', async () => {
      routeMatomo((method, params) =>
        method === 'Live.getCounters'
          ? [{ visits: 50, actions: 120, visitors: 42, visitsConverted: 3 }]
          : fullRoute(method, params),
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.realtime).toEqual({ visitors: 42 })
    })

    it('should build the timeseries from VisitsSummary.getVisits date-to-number map', async () => {
      routeMatomo((method, params) =>
        method === 'VisitsSummary.getVisits'
          ? { '2024-01-01': 110, '2024-01-02': 130, '2024-01-03': 115 }
          : fullRoute(method, params),
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.timeseries).toHaveLength(3)
    })

    it('should list goals when Goals.getGoals returns goal definitions', async () => {
      routeMatomo((method, params) =>
        method === 'Goals.getGoals'
          ? [
              { idsite: 1, idgoal: 4, name: 'New Job Application', match_attribute: 'url', pattern: '/jobs/apply/', pattern_type: 'contains', revenue: 1, deleted: 0 },
              { idsite: 1, idgoal: 5, name: 'View Submit Job', match_attribute: 'url', pattern: 'jobs/add', pattern_type: 'contains', revenue: 5, deleted: 0 },
            ]
          : fullRoute(method, params),
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.events?.map((event) => event.goal)).toEqual(['New Job Application', 'View Submit Job'])
    })

    it('should keep pages when a range-period Actions.getPageUrls omits nb_uniq_visitors', async () => {
      routeMatomo((method, params) =>
        method === 'Actions.getPageUrls'
          ? [
              { label: '/cart/', nb_visits: 8186, nb_hits: 10792, sum_time_spent: 621723 },
              { label: '/about', nb_visits: 300, nb_hits: 450, sum_time_spent: 36000 },
            ]
          : fullRoute(method, params),
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.pages).toHaveLength(2)
    })

    it('should report visitors when a range-period VisitsSummary.get omits nb_uniq_visitors', async () => {
      routeMatomo((method, params) =>
        method === 'VisitsSummary.get'
          ? { nb_visits: 93288, nb_actions: 215614, bounce_count: 62181, bounce_rate: '67%', avg_time_on_site: 179 }
          : fullRoute(method, params),
      )

      const result = await provider.getDashboardData('7d')

      expect(result?.stats?.visitors.value).toBeGreaterThan(0)
    })

    it('should not fail the dashboard when a single-date VisitsSummary.getVisits returns { value }', async () => {
      routeMatomo((method, params) =>
        method === 'VisitsSummary.getVisits' ? { value: 8245 } : fullRoute(method, params),
      )

      const result = await provider.getDashboardData('day')

      expect(result).not.toBeNull()
      expect(result?.timeseries).toEqual([])
    })
  })

  describe('trackEvent', () => {
    it('should be a client-side stub that only logs the event', () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const provider = createMatomoProvider({
        apiToken: 'test-token',
        siteId: '1',
      })

      provider.trackEvent?.('Signup', { plan: 'pro' })

      expect(log).toHaveBeenCalledWith('Track event:', 'Signup', { plan: 'pro' })
      expect(fetchMock).not.toHaveBeenCalled()
      log.mockRestore()
    })
  })
})
