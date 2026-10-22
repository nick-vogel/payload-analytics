import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PayloadRequest } from 'payload'
import { analyticsEndpoint } from '@/endpoints/analytics'
import { collectionAnalyticsEndpoint } from '@/endpoints/collectionAnalytics'
import { DEFAULT_TIME_PERIODS } from '@/constants'
import type { AnalyticsGlobals, AnalyticsProvider, DashboardData } from '@/types'
import { createMockDashboardData, createMockProvider } from '../utils/test-helpers'

const analyticsGlobal = globalThis as typeof globalThis & AnalyticsGlobals

const DASHBOARD_URL = 'http://localhost:3000/api/analytics/dashboard'
const COLLECTION_URL = 'http://localhost:3000/api/analytics/collection'

// The endpoint only reads req.url, so a request carrying just the URL is enough
const createRequest = (url: string): PayloadRequest => ({ url }) as PayloadRequest

// A provider whose getDashboardData mock is typed, so its calls can be read back without casts
const createTypedProvider = (data: DashboardData | null) => {
  const getDashboardData = vi.fn<AnalyticsProvider['getDashboardData']>().mockResolvedValue(data)
  const provider: AnalyticsProvider = { name: 'typed-provider', getDashboardData }
  return { provider, getDashboardData }
}

// createMockProvider falls back to default data when given null, so build this one by hand
const createNullProvider = (): AnalyticsProvider => ({
  name: 'null-provider',
  getDashboardData: vi.fn().mockResolvedValue(null),
})

describe('Analytics API Endpoint', () => {
  let mockRequest: PayloadRequest

  beforeEach(() => {
    vi.clearAllMocks()

    // Clear global state
    delete analyticsGlobal.__analyticsProvider

    mockRequest = createRequest(`${DASHBOARD_URL}?period=7d`)
  })

  describe('GET /api/analytics/dashboard', () => {
    it('should return analytics data when provider is configured', async () => {
      const mockData = createMockDashboardData()
      const mockProvider = createMockProvider('test', mockData)
      analyticsGlobal.__analyticsProvider = mockProvider

      const response = await analyticsEndpoint(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual(mockData)
      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('7d', undefined)
    })

    it('should use default period when not specified', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      await analyticsEndpoint(createRequest(DASHBOARD_URL))

      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('7d', undefined)
    })

    it('should pass custom period to provider', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      await analyticsEndpoint(createRequest(`${DASHBOARD_URL}?period=30d`))

      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('30d', undefined)
    })

    it('should return 500 when provider is not configured', async () => {
      const response = await analyticsEndpoint(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Analytics provider not configured' })
    })

    it('should return 500 when provider returns null', async () => {
      analyticsGlobal.__analyticsProvider = createNullProvider()

      const response = await analyticsEndpoint(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Failed to fetch analytics data' })
    })

    it('should handle provider errors gracefully', async () => {
      const mockProvider: AnalyticsProvider = {
        name: 'error-provider',
        getDashboardData: vi.fn().mockRejectedValue(new Error('Provider error')),
      }
      analyticsGlobal.__analyticsProvider = mockProvider

      const response = await analyticsEndpoint(mockRequest)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data).toEqual({ error: 'Failed to fetch analytics data' })
    })

    it('should handle multiple time period formats', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      // 'custom' without start and end is passed through unchanged, like any other period
      for (const period of DEFAULT_TIME_PERIODS) {
        await analyticsEndpoint(createRequest(`${DASHBOARD_URL}?period=${period}`))

        expect(mockProvider.getDashboardData).toHaveBeenCalledWith(period, undefined)
      }
    })

    it('should cache responses appropriately', async () => {
      const mockData = createMockDashboardData()
      const mockProvider = createMockProvider('test', mockData)
      analyticsGlobal.__analyticsProvider = mockProvider

      // Make multiple requests with same period
      const response1 = await analyticsEndpoint(mockRequest)
      const response2 = await analyticsEndpoint(mockRequest)

      // Provider should be called twice (no caching in endpoint)
      expect(mockProvider.getDashboardData).toHaveBeenCalledTimes(2)

      // Both responses should be successful
      expect(response1.status).toBe(200)
      expect(response2.status).toBe(200)
    })

    it('should validate period parameter format', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      // Test with invalid period (should still work as provider handles validation)
      const response = await analyticsEndpoint(createRequest(`${DASHBOARD_URL}?period=invalid`))

      expect(response.status).toBe(200)
      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('invalid', undefined)
    })

    it('should return consistent data structure', async () => {
      const mockData = createMockDashboardData()
      const mockProvider = createMockProvider('test', mockData)
      analyticsGlobal.__analyticsProvider = mockProvider

      const response = await analyticsEndpoint(mockRequest)
      const data = await response.json()

      // Verify data structure
      expect(data).toHaveProperty('stats')
      expect(data).toHaveProperty('timeseries')
      expect(data).toHaveProperty('pages')
      expect(data).toHaveProperty('sources')
      expect(data).toHaveProperty('events')
      expect(data).toHaveProperty('realtime')

      // Verify stats structure: each metric carries its value and its change
      for (const metric of ['visitors', 'pageviews', 'bounce_rate', 'visit_duration']) {
        expect(data.stats).toHaveProperty(metric)
        expect(data.stats[metric]).toHaveProperty('value')
        expect(data.stats[metric]).toHaveProperty('change')
      }
    })
    it('should join start and end into a range for the custom period', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      await analyticsEndpoint(createRequest(`${DASHBOARD_URL}?period=custom&start=2024-01-01&end=2024-01-31`))

      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('2024-01-01,2024-01-31', undefined)
    })

    it('should pass custom through unchanged when only one end of the range is given', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      await analyticsEndpoint(createRequest(`${DASHBOARD_URL}?period=custom&start=2024-01-01`))
      await analyticsEndpoint(createRequest(`${DASHBOARD_URL}?period=custom&end=2024-01-31`))

      expect(mockProvider.getDashboardData).toHaveBeenNthCalledWith(1, 'custom', undefined)
      expect(mockProvider.getDashboardData).toHaveBeenNthCalledWith(2, 'custom', undefined)
    })

    it('should ignore start and end when the period is not custom', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      await analyticsEndpoint(createRequest(`${DASHBOARD_URL}?period=30d&start=2024-01-01&end=2024-01-31`))

      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('30d', undefined)
    })

    it('should pass a comparison without dates when only the comparison type is given', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      await analyticsEndpoint(createRequest(`${DASHBOARD_URL}?period=7d&comparison=previousPeriod`))

      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('7d', {
        period: 'previousPeriod',
        customStartDate: undefined,
        customEndDate: undefined,
      })
    })

    it('should pass the custom comparison range alongside a custom period', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      await analyticsEndpoint(
        createRequest(
          `${DASHBOARD_URL}?period=custom&start=2024-02-01&end=2024-02-29` +
            '&comparison=custom&compareStart=2024-01-01&compareEnd=2024-01-29',
        ),
      )

      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('2024-02-01,2024-02-29', {
        period: 'custom',
        customStartDate: '2024-01-01',
        customEndDate: '2024-01-29',
      })
    })

    it('should fall back to the default period when the request has no URL', async () => {
      const mockProvider = createMockProvider('test')
      analyticsGlobal.__analyticsProvider = mockProvider

      const response = await analyticsEndpoint({} as PayloadRequest)

      expect(response.status).toBe(200)
      expect(mockProvider.getDashboardData).toHaveBeenCalledWith('7d', undefined)
    })
  })

  describe('GET /api/analytics/collection', () => {
    it('should return 500 when provider is not configured', async () => {
      const response = await collectionAnalyticsEndpoint(createRequest(`${COLLECTION_URL}?path=/about`))

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Analytics provider not configured' })
    })

    it('should return 400 without calling the provider when path is missing', async () => {
      const { provider, getDashboardData } = createTypedProvider(createMockDashboardData())
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint(createRequest(COLLECTION_URL))

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Path parameter is required' })
      expect(getDashboardData).not.toHaveBeenCalled()
    })

    it('should return 400 when the request has no URL', async () => {
      const { provider } = createTypedProvider(createMockDashboardData())
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint({} as PayloadRequest)

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Path parameter is required' })
    })

    it('should treat an empty path as missing', async () => {
      const { provider } = createTypedProvider(createMockDashboardData())
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint(createRequest(`${COLLECTION_URL}?path=`))

      expect(response.status).toBe(400)
    })

    it('should query the provider for 30 days without a comparison', async () => {
      const { provider, getDashboardData } = createTypedProvider(createMockDashboardData())
      analyticsGlobal.__analyticsProvider = provider

      await collectionAnalyticsEndpoint(createRequest(`${COLLECTION_URL}?path=/about`))

      expect(getDashboardData).toHaveBeenCalledTimes(1)
      expect(getDashboardData.mock.calls[0]).toEqual(['30d'])
    })

    it('should narrow pages to the requested path and build stats from that page', async () => {
      const mockData = createMockDashboardData()
      const { provider } = createTypedProvider(mockData)
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint(createRequest(`${COLLECTION_URL}?path=/about`))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.pages).toEqual([
        { page: '/about', visitors: 300, pageviews: 450, bounce_rate: 55, visit_duration: 120 },
      ])
      expect(data.stats).toEqual({
        visitors: { value: 300, change: null },
        pageviews: { value: 450, change: null },
        bounce_rate: { value: 55, change: null },
        visit_duration: { value: 120, change: null },
      })
      // The rest of the dashboard passes through untouched
      expect(data.timeseries).toEqual(mockData.timeseries)
      expect(data.sources).toEqual(mockData.sources)
      expect(data.realtime).toEqual(mockData.realtime)
    })

    it('should decode an encoded path before matching it', async () => {
      const mockData = createMockDashboardData({
        pages: [{ page: '/blog/hello world', visitors: 7, pageviews: 9, bounce_rate: 10, visit_duration: 30 }],
      })
      const { provider } = createTypedProvider(mockData)
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint(
        createRequest(`${COLLECTION_URL}?path=${encodeURIComponent('/blog/hello world')}`),
      )
      const data = await response.json()

      expect(data.pages).toHaveLength(1)
      expect(data.stats.visitors).toEqual({ value: 7, change: null })
    })

    it('should return zeroed stats and no pages when the path has no traffic', async () => {
      const { provider } = createTypedProvider(createMockDashboardData())
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint(createRequest(`${COLLECTION_URL}?path=/never-visited`))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.pages).toEqual([])
      expect(data.stats).toEqual({
        visitors: { value: 0, change: null },
        pageviews: { value: 0, change: null },
        bounce_rate: { value: 0, change: null },
        visit_duration: { value: 0, change: null },
      })
    })

    it('should return zeroed stats when the provider reports no pages at all', async () => {
      const mockData = createMockDashboardData()
      delete mockData.pages
      const { provider } = createTypedProvider(mockData)
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint(createRequest(`${COLLECTION_URL}?path=/about`))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.pages).toEqual([])
      expect(data.stats.pageviews).toEqual({ value: 0, change: null })
    })

    it('should return 500 when provider returns null', async () => {
      const { provider } = createTypedProvider(null)
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint(createRequest(`${COLLECTION_URL}?path=/about`))

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Failed to fetch analytics data' })
    })

    it('should return 500 when the provider throws', async () => {
      const { provider, getDashboardData } = createTypedProvider(null)
      getDashboardData.mockRejectedValue(new Error('Provider error'))
      analyticsGlobal.__analyticsProvider = provider

      const response = await collectionAnalyticsEndpoint(createRequest(`${COLLECTION_URL}?path=/about`))

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Failed to fetch analytics data' })
    })
  })
})
