import { z } from 'zod'
import type { AnalyticsProvider, DashboardData, ComparisonData } from '../types'

export interface UmamiConfig {
  apiKey?: string
  siteId?: string
  apiHost?: string
}

// Umami API response schemas
const UmamiStatsSchema = z.object({
  pageviews: z.object({
    value: z.number(),
    change: z.number().optional(),
  }),
  visitors: z.object({
    value: z.number(),
    change: z.number().optional(),
  }),
  visits: z.object({
    value: z.number(),
    change: z.number().optional(),
  }),
  bounces: z.object({
    value: z.number(),
    change: z.number().optional(),
  }),
  totaltime: z.object({
    value: z.number(),
    change: z.number().optional(),
  }),
})

const UmamiMetricsSchema = z.array(z.object({
  x: z.string(), // metric name (page, referrer, etc.)
  y: z.number(), // count
}))

const UmamiPageviewsSchema = z.object({
  pageviews: z.array(z.object({
    x: z.number(), // timestamp
    y: z.number(), // count
  })),
  sessions: z.array(z.object({
    x: z.number(), // timestamp
    y: z.number(), // count
  })),
})

async function fetchUmamiAPI<T>(
  config: UmamiConfig,
  endpoint: string,
  params: Record<string, unknown> = {},
  schema: z.ZodSchema<T>
): Promise<T | null> {
  if (!config.apiKey || !config.siteId) {
    console.warn('Umami API key or site ID is not configured')
    return null
  }

  try {
    const url = new URL(`${config.apiHost}/api/websites/${config.siteId}/${endpoint}`)
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value))
      }
    })
    
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Umami API error: ${response.status} ${response.statusText}`)
      console.error(`Response: ${errorText}`)
      return null
    }

    const data = await response.json()
    return schema.parse(data)
  } catch (error) {
    console.error(`Error fetching Umami ${endpoint}:`, error)
    return null
  }
}

function getUmamiDateRange(period: string): { startAt: number; endAt: number; unit: string } {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  
  switch (period) {
    case 'day':
      return { 
        startAt: now - day, 
        endAt: now,
        unit: 'hour'
      }
    case '7d':
      return { 
        startAt: now - (7 * day), 
        endAt: now,
        unit: 'day'
      }
    case '30d':
      return { 
        startAt: now - (30 * day), 
        endAt: now,
        unit: 'day'
      }
    case '12mo':
      return { 
        startAt: now - (365 * day), 
        endAt: now,
        unit: 'month'
      }
    default:
      return { 
        startAt: now - (7 * day), 
        endAt: now,
        unit: 'day'
      }
  }
}

export function createUmamiProvider(config: UmamiConfig): AnalyticsProvider {
  const apiConfig: UmamiConfig = {
    apiKey: config.apiKey || process.env.UMAMI_API_KEY,
    siteId: config.siteId || process.env.UMAMI_SITE_ID,
    apiHost: config.apiHost || process.env.UMAMI_API_HOST || 'https://api.umami.is'
  }

  return {
    name: 'umami',
    
    async getDashboardData(period: string = '7d', _comparison?: ComparisonData): Promise<DashboardData | null> {
      if (!apiConfig.apiKey || !apiConfig.siteId) {
        console.warn('Umami API key or site ID is not configured')
        return null
      }

      try {
        const { startAt, endAt, unit } = getUmamiDateRange(period)
        const dateParams = {
          startAt,
          endAt,
          unit,
        }

        // Fetch all data in parallel
        const [stats, pageviews, pages, referrers, events] = await Promise.all([
          fetchUmamiAPI(apiConfig, 'stats', dateParams, UmamiStatsSchema),
          fetchUmamiAPI(apiConfig, 'pageviews', dateParams, UmamiPageviewsSchema),
          fetchUmamiAPI(apiConfig, 'metrics', { ...dateParams, type: 'url', limit: 10 }, UmamiMetricsSchema),
          fetchUmamiAPI(apiConfig, 'metrics', { ...dateParams, type: 'referrer', limit: 10 }, UmamiMetricsSchema),
          fetchUmamiAPI(apiConfig, 'metrics', { ...dateParams, type: 'event', limit: 10 }, UmamiMetricsSchema),
        ])

        if (!stats) {
          return null
        }

        // Calculate bounce rate and average duration
        const bounceRate = stats.visits?.value > 0 
          ? (stats.bounces?.value || 0) / stats.visits.value * 100 
          : 0
        const avgDuration = stats.visits?.value > 0 
          ? (stats.totaltime?.value || 0) / stats.visits.value 
          : 0

        // Transform Umami pageviews to our timeseries format
        const timeseries = pageviews?.pageviews?.map((item, index) => ({
          date: new Date(item.x).toISOString(),
          visitors: pageviews.sessions?.[index]?.y || 0,
          pageviews: item.y,
        })) || []

        // Transform pages data
        const pagesData = pages?.map(page => ({
          page: page.x,
          visitors: page.y,
          pageviews: page.y, // Umami doesn't separate these
          bounce_rate: bounceRate, // Apply site-wide bounce rate
          visit_duration: avgDuration, // Apply site-wide duration
        })) || []

        // Transform referrers to sources
        const sources = referrers?.map(ref => ({
          source: ref.x || 'Direct',
          visitors: ref.y,
          bounce_rate: bounceRate, // Apply site-wide bounce rate
          visit_duration: avgDuration, // Apply site-wide duration
        })) || []

        // Transform events
        const eventsData = events?.map(event => ({
          goal: event.x,
          visitors: event.y,
          events: event.y,
          conversion_rate: stats.visitors?.value > 0 ? (event.y / stats.visitors.value * 100) : 0,
        })) || []

        return {
          stats: {
            visitors: {
              value: stats.visitors?.value || 0,
              change: stats.visitors?.change ?? null,
            },
            pageviews: {
              value: stats.pageviews?.value || 0,
              change: stats.pageviews?.change ?? null,
            },
            bounce_rate: {
              value: bounceRate,
              change: null, // Umami doesn't provide change for calculated metrics
            },
            visit_duration: {
              value: avgDuration,
              change: null, // Umami doesn't provide change for calculated metrics
            },
          },
          timeseries,
          pages: pagesData,
          sources,
          events: eventsData,
          realtime: {
            visitors: 0, // Umami doesn't provide real-time data
          },
        }
      } catch (error) {
        console.error('Error fetching Umami data:', error)
        return null
      }
    },

    trackEvent(eventName: string, props?: Record<string, unknown>) {
      // This would be implemented on the client side using Umami's tracking script
      console.log('Track event:', eventName, props)
    }
  }
}