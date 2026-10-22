import { z } from 'zod'
import type { AnalyticsProvider, PlausibleConfig, DashboardData, ComparisonData } from '../types'

const TimePeriodSchema = z.object({
  date: z.string(),
  visitors: z.number(),
  pageviews: z.number().optional(),
  bounce_rate: z.number().optional(),
  visit_duration: z.number().optional(),
})

const PageSchema = z.object({
  page: z.string(),
  visitors: z.number(),
  pageviews: z.number(),
  bounce_rate: z.number(),
  visit_duration: z.number(),
})

const SourceSchema = z.object({
  source: z.string(),
  visitors: z.number(),
  bounce_rate: z.number(),
  visit_duration: z.number(),
})

const EventSchema = z.object({
  goal: z.string(),
  visitors: z.number(),
  events: z.number(),
  conversion_rate: z.number(),
})

const StatsSchema = z.object({
  results: z.object({
    visitors: z.object({
      value: z.number(),
      change: z.number().nullable().optional(),
    }).optional(),
    pageviews: z.object({
      value: z.number(),
      change: z.number().nullable().optional(),
    }).optional(),
    bounce_rate: z.object({
      value: z.number(),
      change: z.number().nullable().optional(),
    }).optional(),
    visit_duration: z.object({
      value: z.number(),
      change: z.number().nullable().optional(),
    }).optional(),
  }).optional(),
})

const RealtimeSchema = z.number()

async function fetchPlausibleAPI<T>(
  config: PlausibleConfig,
  endpoint: string,
  params: Record<string, string> = {},
  schema: z.ZodSchema<T>
): Promise<T | null> {
  if (!config.apiKey || !config.siteId) {
    console.warn('Plausible API key or site ID is not configured')
    return null
  }

  try {
    const queryParams = new URLSearchParams({
      site_id: config.siteId,
      ...params,
    })

    const url = `${config.apiHost}/api/v1/stats/${endpoint}?${queryParams}`
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Plausible API error: ${response.status} ${response.statusText}`)
      console.error(`Response: ${errorText}`)
      return null
    }

    const data = await response.json()
    return schema.parse(data)
  } catch (error) {
    console.error(`Error fetching Plausible ${endpoint}:`, error)
    return null
  }
}

export function createPlausibleProvider(config: PlausibleConfig): AnalyticsProvider {
  const apiConfig: PlausibleConfig = {
    apiKey: config.apiKey || process.env.PLAUSIBLE_API_KEY,
    siteId: config.siteId || process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
    apiHost: config.apiHost || process.env.PLAUSIBLE_API_HOST || process.env.NEXT_PUBLIC_PLAUSIBLE_HOST || 'https://plausible.io'
  }

  return {
    name: 'plausible',
    
    async getDashboardData(period: string = '7d', comparison?: ComparisonData): Promise<DashboardData | null> {
      if (!apiConfig.apiKey || !apiConfig.siteId) {
        console.warn('Plausible API key or site ID is not configured')
        return null
      }

      try {
        // Handle custom date ranges
        const apiParams: Record<string, string> = { metrics: 'visitors,pageviews,bounce_rate,visit_duration' }
        
        if (period.includes(',')) {
          // Custom date range format: "YYYY-MM-DD,YYYY-MM-DD"
          const [start, end] = period.split(',')
          apiParams.period = 'custom'
          apiParams.date = `${start},${end}`
        } else if (period === 'all') {
          // For all time, use custom period with a very early start date
          const today = new Date().toISOString().split('T')[0]
          apiParams.period = 'custom'
          apiParams.date = `2019-01-01,${today}` // Plausible started in 2019
        } else if (period === 'year' || period === 'thisYear') {
          // Year to date
          const now = new Date()
          const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0]
          const today = now.toISOString().split('T')[0]
          apiParams.period = 'custom'
          apiParams.date = `${yearStart},${today}`
        } else if (period === 'lastYear') {
          // Last year
          const now = new Date()
          const lastYearStart = new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0]
          const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31).toISOString().split('T')[0]
          apiParams.period = 'custom'
          apiParams.date = `${lastYearStart},${lastYearEnd}`
        } else if (period === 'lastMonth') {
          // Last month
          const now = new Date()
          const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
          const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
          apiParams.period = 'custom'
          apiParams.date = `${lastMonth.toISOString().split('T')[0]},${lastMonthEnd.toISOString().split('T')[0]}`
        } else {
          apiParams.period = period
        }
        
        // Add comparison parameters
        if (comparison) {
          if (comparison.period === 'previousPeriod') {
            apiParams.compare = 'previous_period'
          } else if (comparison.period === 'sameLastYear') {
            apiParams.compare = 'previous_year'
          } else if (comparison.period === 'custom' && comparison.customStartDate && comparison.customEndDate) {
            // For custom comparison, we'll need to make a separate API call
            apiParams.compare_from = comparison.customStartDate
            apiParams.compare_to = comparison.customEndDate
          }
        }

        const [statsResponse, timeseries, pages, sources, events, realtime] = await Promise.all([
          fetchPlausibleAPI(apiConfig, 'aggregate', apiParams, StatsSchema),
          fetchPlausibleAPI(apiConfig, 'timeseries', { ...apiParams, metrics: 'visitors' }, z.object({ results: z.array(TimePeriodSchema) }))
            .then(data => data?.results || []),
          fetchPlausibleAPI(apiConfig, 'breakdown', { ...apiParams, property: 'event:page', limit: '10', metrics: 'visitors,pageviews,bounce_rate,visit_duration' }, z.object({ results: z.array(PageSchema) }))
            .then(data => data?.results || []),
          fetchPlausibleAPI(apiConfig, 'breakdown', { ...apiParams, property: 'visit:source', limit: '10', metrics: 'visitors,bounce_rate,visit_duration' }, z.object({ results: z.array(SourceSchema) }))
            .then(data => data?.results || []),
          fetchPlausibleAPI(apiConfig, 'breakdown', { ...apiParams, property: 'event:goal', limit: '10', metrics: 'visitors,events,conversion_rate' }, z.object({ results: z.array(EventSchema) }))
            .then(data => data?.results || [])
            .catch((err) => {
              console.warn('Failed to fetch events/goals:', err)
              return []
            }),
          fetchPlausibleAPI(apiConfig, 'realtime/visitors', {}, RealtimeSchema)
            .then(visitors => ({ visitors: visitors || 0 }))
            .catch(() => ({ visitors: 0 })),
        ])

        if (!statsResponse?.results) {
          return null
        }

        const stats = {
          visitors: {
            value: statsResponse.results.visitors?.value || 0,
            change: statsResponse.results.visitors?.change ?? null
          },
          pageviews: {
            value: statsResponse.results.pageviews?.value || 0,
            change: statsResponse.results.pageviews?.change ?? null
          },
          bounce_rate: {
            value: statsResponse.results.bounce_rate?.value || 0,
            change: statsResponse.results.bounce_rate?.change ?? null
          },
          visit_duration: {
            value: statsResponse.results.visit_duration?.value || 0,
            change: statsResponse.results.visit_duration?.change ?? null
          },
        }

        return {
          stats,
          timeseries,
          pages,
          sources,
          events,
          realtime,
        }
      } catch (error) {
        console.error('Error fetching Plausible data:', error)
        return null
      }
    },

    trackEvent(eventName: string, props?: Record<string, unknown>) {
      // This would be implemented on the client side
      // For now, we'll just log it
      console.log('Track event:', eventName, props)
    }
  }
}