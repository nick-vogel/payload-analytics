import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PayloadRequest } from 'payload'
import { analyticsEndpoint } from '@/endpoints/analytics'
import { DEFAULT_TIME_PERIODS } from '@/constants'
import type { AnalyticsGlobals, AnalyticsProvider } from '@/types'
import { createMockDashboardData, createMockProvider } from '../utils/test-helpers'

const analyticsGlobal = globalThis as typeof globalThis & AnalyticsGlobals

const DASHBOARD_URL = 'http://localhost:3000/api/analytics/dashboard'

// The endpoint only reads req.url, so a request carrying just the URL is enough
const createRequest = (url: string): PayloadRequest => ({ url }) as PayloadRequest

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
  })
})
