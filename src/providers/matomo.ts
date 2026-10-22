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

// Matomo only processes unique visitors for single-day periods by default, so
// range-period rows omit nb_uniq_visitors; readers fall back to nb_visits.
const MatomoPageSchema = z.object({
  label: z.string(),
  nb_visits: z.number(),
  nb_uniq_visitors: z.number().optional(),
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

// Goals.getGoals returns goal definitions (no conversion stats), e.g.
// [{ idsite: 1, idgoal: 4, name: 'New Job Application', ... }].
const MatomoGoalDefinitionSchema = z.object({
  idgoal: z.union([z.number(), z.string()]),
  name: z.string(),
})

// Goals.get with showAllGoalSpecificMetrics=1 returns one flat object with
// per-goal columns: goal_<idgoal>_nb_conversions, goal_<idgoal>_conversion_rate, ...
const MatomoGoalMetricsSchema = z.record(z.string(), z.union([z.number(), z.string()]))

// VisitsSummary.getVisits returns a date-to-visits map, e.g. { '2024-01-01': 110 },
// or { value: 110 } when a single date is requested.
const MatomoTimeSeriesSchema = z.record(z.string(), z.number())

// Live.getCounters returns a one-element array.
const MatomoLiveCountersSchema = z.array(z.object({
  visitors: z.number().optional(),
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

function visitorsOf(row: { nb_uniq_visitors?: number; nb_visits?: number } | null): number | undefined {
  return row?.nb_uniq_visitors ?? row?.nb_visits
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
        const [currentStats, pages, referrers, goals, goalMetrics, timeseries, liveCounters] = await Promise.all([
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
          
          // Goal definitions (names)
          fetchMatomoAPI(apiConfig, {
            method: 'Goals.getGoals',
          }, z.array(MatomoGoalDefinitionSchema)),

          // Per-goal conversions for the period
          fetchMatomoAPI(apiConfig, {
            ...baseParams,
            method: 'Goals.get',
            showAllGoalSpecificMetrics: 1,
          }, MatomoGoalMetricsSchema),
          
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
          }, MatomoLiveCountersSchema),
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

        // Transform timeseries data. Skip keys that are not dates, such as the
        // { value } shape Matomo returns for a single date.
        const timeseriesData = Object.entries(timeseries || {})
          .map(([date, visits]) => ({ date: new Date(date), visits }))
          .filter(({ date }) => !Number.isNaN(date.getTime()))
          .map(({ date, visits }) => ({
            date: date.toISOString(),
            visitors: visits,
          }))

        // Transform pages data
        const pagesData = (pages || []).map(page => ({
          page: page.label,
          visitors: visitorsOf(page) ?? 0,
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
        const goalNumber = (key: string): number => {
          const value = goalMetrics?.[key]
          return typeof value === 'number' ? value : 0
        }
        const goalRate = (key: string): number => {
          const value = goalMetrics?.[key]
          return typeof value === 'string' ? parsePercentage(value) : 0
        }
        const events = (goals || []).map(goal => ({
          goal: goal.name,
          visitors: goalNumber(`goal_${goal.idgoal}_nb_visits_converted`),
          events: goalNumber(`goal_${goal.idgoal}_nb_conversions`),
          conversion_rate: goalRate(`goal_${goal.idgoal}_conversion_rate`),
        }))

        return {
          stats: {
            visitors: {
              value: visitorsOf(currentStats) || 0,
              change: calculateChange(visitorsOf(currentStats), visitorsOf(previousStats)),
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
            visitors: liveCounters?.[0]?.visitors || 0,
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