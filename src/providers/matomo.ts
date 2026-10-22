import { z } from 'zod'
import type { AnalyticsProvider, DashboardData, ComparisonData } from '../types'

export interface MatomoConfig {
  apiToken?: string
  siteId?: string
  apiHost?: string
}

// Matomo API response schemas
const MatomoVisitsSummarySchema = z.object({
  nb_uniq_visitors: z.number().optional(),
  nb_visits: z.number().optional(),
  nb_actions: z.number().optional(),
  bounce_rate: z.string().optional(), // Matomo returns percentages as strings like "45%"
  avg_time_on_site: z.number().optional(),
})

const MatomoPageSchema = z.object({
  label: z.string(),
  nb_visits: z.number(),
  nb_uniq_visitors: z.number(),
  nb_hits: z.number(),
  bounce_rate: z.string().optional(),
  avg_time_on_page: z.number().optional(),
})

const MatomoReferrerSchema = z.object({
  label: z.string(),
  nb_visits: z.number(),
  nb_uniq_visitors: z.number().optional(),
  bounce_rate: z.string().optional(),
  avg_time_on_site: z.number().optional(),
})

const MatomoGoalSchema = z.object({
  label: z.string(),
  nb_conversions: z.number(),
  nb_visits_converted: z.number(),
  conversion_rate: z.string(), // e.g., "12.5%"
})

const MatomoTimeSeriesSchema = z.record(z.string(), z.object({
  nb_uniq_visitors: z.number().optional(),
  nb_visits: z.number().optional(),
  nb_actions: z.number().optional(),
}))

async function fetchMatomoAPI<T>(
  config: MatomoConfig,
  params: Record<string, unknown> = {},
  schema: z.ZodSchema<T>
): Promise<T | null> {
  if (!config.apiToken || !config.siteId) {
    console.warn('Matomo API token or site ID is not configured')
    return null
  }

  try {
    const url = new URL(`${config.apiHost}/index.php`)
    
    // Add required Matomo parameters
    const queryParams = {
      module: 'API',
      format: 'JSON',
      token_auth: config.apiToken,
      idSite: config.siteId,
      ...params,
    }

    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value))
      }
    })
    
    const response = await fetch(url.toString())

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Matomo API error: ${response.status} ${response.statusText}`)
      console.error(`Response: ${errorText}`)
      return null
    }

    const data = await response.json()
    
    // Check for Matomo error response
    if (data.result === 'error') {
      console.error('Matomo API error:', data.message)
      return null
    }

    return schema.parse(data)
  } catch (error) {
    console.error(`Error fetching Matomo data:`, error)
    return null
  }
}

function getMatomoPeriod(period: string): { period: string; date: string } {
  switch (period) {
    case 'day':
      return { period: 'day', date: 'today' }
    case '7d':
      return { period: 'range', date: 'last7' }
    case '30d':
      return { period: 'range', date: 'last30' }
    case '12mo':
      return { period: 'range', date: 'last365' }
    default:
      return { period: 'range', date: 'last7' }
  }
}

function parsePercentage(value?: string): number {
  if (!value) return 0
  return parseFloat(value.replace('%', ''))
}

export function createMatomoProvider(config: MatomoConfig): AnalyticsProvider {
  const apiConfig: MatomoConfig = {
    apiToken: config.apiToken || process.env.MATOMO_API_TOKEN,
    siteId: config.siteId || process.env.MATOMO_SITE_ID,
    apiHost: config.apiHost || process.env.MATOMO_API_HOST || 'https://matomo.example.com'
  }

  return {
    name: 'matomo',
    
    async getDashboardData(period: string = '7d', _comparison?: ComparisonData): Promise<DashboardData | null> {
      if (!apiConfig.apiToken || !apiConfig.siteId) {
        console.warn('Matomo API token or site ID is not configured')
        return null
      }

      try {
        const { period: matomoPeriod, date } = getMatomoPeriod(period)
        
        // Base parameters for all requests
        const baseParams = {
          period: matomoPeriod,
          date,
        }

        // Fetch current period data
        const [currentStats, pages, referrers, goals, timeseries, liveVisitors] = await Promise.all([
          // Current period stats
          fetchMatomoAPI(apiConfig, {
            ...baseParams,
            method: 'VisitsSummary.get',
          }, MatomoVisitsSummarySchema),
          
          // Top pages
          fetchMatomoAPI(apiConfig, {
            ...baseParams,
            method: 'Actions.getPageUrls',
            filter_limit: 10,
            flat: 1,
          }, z.array(MatomoPageSchema)),
          
          // Top referrers
          fetchMatomoAPI(apiConfig, {
            ...baseParams,
            method: 'Referrers.getAll',
            filter_limit: 10,
          }, z.array(MatomoReferrerSchema)),
          
          // Goals
          fetchMatomoAPI(apiConfig, {
            ...baseParams,
            method: 'Goals.getGoals',
          }, z.array(MatomoGoalSchema)).catch(() => []), // Goals might not be configured
          
          // Time series data
          fetchMatomoAPI(apiConfig, {
            ...baseParams,
            method: 'VisitsSummary.getVisits',
            period: 'day',
            date: period === 'day' ? 'today' : `last${period === '7d' ? '7' : period === '30d' ? '30' : '365'}`,
          }, MatomoTimeSeriesSchema),
          
          // Live visitors (if available)
          fetchMatomoAPI(apiConfig, {
            method: 'Live.getCounters',
            lastMinutes: 5,
          }, z.object({ 
            '0': z.object({ 
              visitors: z.number().optional() 
            }).optional() 
          })).catch(() => null),
        ])

        // Fetch previous period for comparison
        const previousDate = period === 'day' ? 'yesterday' : 
                            period === '7d' ? 'previous7' : 
                            period === '30d' ? 'previous30' : 
                            'previous365'
        
        const previousStats = await fetchMatomoAPI(apiConfig, {
          period: matomoPeriod,
          date: previousDate,
          method: 'VisitsSummary.get',
        }, MatomoVisitsSummarySchema)

        if (!currentStats) {
          return null
        }

        // Calculate changes
        const calculateChange = (current?: number, previous?: number): number | null => {
          if (!current || !previous || previous === 0) return null
          return ((current - previous) / previous) * 100
        }

        // Transform timeseries data
        const timeseriesData = Object.entries(timeseries || {}).map(([date, data]) => ({
          date: new Date(date).toISOString(),
          visitors: data.nb_uniq_visitors || 0,
          pageviews: data.nb_actions || 0,
        }))

        // Transform pages data
        const pagesData = (pages || []).map(page => ({
          page: page.label,
          visitors: page.nb_uniq_visitors,
          pageviews: page.nb_hits,
          bounce_rate: parsePercentage(page.bounce_rate),
          visit_duration: page.avg_time_on_page || 0,
        }))

        // Transform referrers to sources
        const sources = (referrers || []).map(ref => ({
          source: ref.label || 'Direct',
          visitors: ref.nb_uniq_visitors || ref.nb_visits,
          bounce_rate: parsePercentage(ref.bounce_rate),
          visit_duration: ref.avg_time_on_site || 0,
        }))

        // Transform goals to events
        const events = (goals || []).map(goal => ({
          goal: goal.label,
          visitors: goal.nb_visits_converted,
          events: goal.nb_conversions,
          conversion_rate: parsePercentage(goal.conversion_rate),
        }))

        return {
          stats: {
            visitors: {
              value: currentStats.nb_uniq_visitors || 0,
              change: calculateChange(currentStats.nb_uniq_visitors, previousStats?.nb_uniq_visitors),
            },
            pageviews: {
              value: currentStats.nb_actions || 0,
              change: calculateChange(currentStats.nb_actions, previousStats?.nb_actions),
            },
            bounce_rate: {
              value: parsePercentage(currentStats.bounce_rate),
              change: calculateChange(
                parsePercentage(currentStats.bounce_rate), 
                parsePercentage(previousStats?.bounce_rate)
              ),
            },
            visit_duration: {
              value: currentStats.avg_time_on_site || 0,
              change: calculateChange(currentStats.avg_time_on_site, previousStats?.avg_time_on_site),
            },
          },
          timeseries: timeseriesData,
          pages: pagesData,
          sources,
          events,
          realtime: {
            visitors: liveVisitors?.['0']?.visitors || 0,
          },
        }
      } catch (error) {
        console.error('Error fetching Matomo data:', error)
        return null
      }
    },

    trackEvent(eventName: string, props?: Record<string, unknown>) {
      // This would be implemented on the client side using Matomo's tracking script
      console.log('Track event:', eventName, props)
    }
  }
}