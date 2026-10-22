import { z } from 'zod'
import { AnalyticsProvider, DashboardData, ComparisonData } from '../types'

export interface PostHogConfig {
  apiKey?: string
  projectId?: string
  apiHost?: string
}

// PostHog API response schemas
const PostHogTrendsSchema = z.object({
  results: z.array(
    z.object({
      label: z.string(),
      data: z.array(z.number()),
      labels: z.array(z.string()),
      count: z.number(),
    })
  ),
})

// Shapes of the unvalidated responses, as the code below reads them
interface PostHogResultsResponse<T> {
  results?: T[]
}

interface PostHogPathResult {
  path?: string
  count?: number
}

interface PostHogReferrerResult {
  label?: string
  count?: number
}

interface PostHogEventResult {
  event: string
  count: number
}

async function fetchPostHogAPI(
  endpoint: string,
  config: Required<PostHogConfig>,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const { apiKey, projectId, apiHost } = config

  if (!apiKey || !projectId) {
    console.warn('PostHog API credentials missing')
    return null
  }

  const url = new URL(`${apiHost}/api/projects/${projectId}${endpoint}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      url.searchParams.append(key, String(value))
    }
  })

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`PostHog API error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('PostHog API fetch error:', error)
    return null
  }
}

function getPostHogDateRange(period?: string) {
  const now = new Date()
  const endDate = now.toISOString()
  let startDate: Date
  let interval: string
  let previousStartDate: Date
  let previousEndDate: Date

  switch (period) {
    case 'day':
    case '24h':
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      interval = 'hour'
      previousEndDate = new Date(startDate)
      previousStartDate = new Date(previousEndDate.getTime() - 24 * 60 * 60 * 1000)
      break
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      interval = 'day'
      previousEndDate = new Date(startDate)
      previousStartDate = new Date(previousEndDate.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      interval = 'day'
      previousEndDate = new Date(startDate)
      previousStartDate = new Date(previousEndDate.getTime() - 30 * 24 * 60 * 60 * 1000)
      break
    case '12mo':
      startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
      interval = 'month'
      previousEndDate = new Date(startDate)
      previousStartDate = new Date(previousEndDate.getFullYear() - 1, previousEndDate.getMonth(), previousEndDate.getDate())
      break
    default:
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      interval = 'day'
      previousEndDate = new Date(startDate)
      previousStartDate = new Date(previousEndDate.getTime() - 7 * 24 * 60 * 60 * 1000)
  }

  return {
    date_from: startDate.toISOString(),
    date_to: endDate,
    interval,
    previous_date_from: previousStartDate.toISOString(),
    previous_date_to: previousEndDate.toISOString(),
  }
}

export function createPostHogProvider(config: PostHogConfig = {}): AnalyticsProvider {
  const fullConfig: Required<PostHogConfig> = {
    apiKey: config.apiKey || process.env.POSTHOG_API_KEY || '',
    projectId: config.projectId || process.env.POSTHOG_PROJECT_ID || '',
    apiHost: config.apiHost || process.env.POSTHOG_API_HOST || 'https://app.posthog.com',
  }

  return {
    name: 'posthog',
    async getDashboardData(period: string = '7d', _comparison?: ComparisonData): Promise<DashboardData | null> {
      try {
        const dateRange = getPostHogDateRange(period)

        // Fetch current period data
        const [pageviewsData, sessionsData, pathsData, referrersData, eventsData] = await Promise.all([
          // Pageviews
          fetchPostHogAPI('/insights/trend/', fullConfig, {
            events: JSON.stringify([{ id: '$pageview', type: 'events' }]),
            date_from: dateRange.date_from,
            date_to: dateRange.date_to,
            interval: dateRange.interval,
          }),
          // Sessions (unique users)
          fetchPostHogAPI('/insights/trend/', fullConfig, {
            events: JSON.stringify([{ id: '$pageview', type: 'events', math: 'dau' }]),
            date_from: dateRange.date_from,
            date_to: dateRange.date_to,
            interval: dateRange.interval,
          }),
          // Top paths
          fetchPostHogAPI('/insights/path/', fullConfig, {
            date_from: dateRange.date_from,
            date_to: dateRange.date_to,
            limit: 10,
          }),
          // Referrers
          fetchPostHogAPI('/insights/trend/', fullConfig, {
            events: JSON.stringify([{ id: '$pageview', type: 'events' }]),
            breakdown: '$referrer',
            breakdown_type: 'event',
            date_from: dateRange.date_from,
            date_to: dateRange.date_to,
          }),
          // Custom events
          fetchPostHogAPI('/events/', fullConfig, {
            select: 'event,count()',
            where: JSON.stringify([
              'AND',
              ['event', '!=', '$pageview'],
              ['event', '!=', '$pageleave'],
            ]),
            date_from: dateRange.date_from,
            date_to: dateRange.date_to,
            orderBy: '-count()',
            limit: 10,
          }),
        ])

        // Fetch previous period data for comparison
        const [prevPageviewsData, prevSessionsData] = await Promise.all([
          fetchPostHogAPI('/insights/trend/', fullConfig, {
            events: JSON.stringify([{ id: '$pageview', type: 'events' }]),
            date_from: dateRange.previous_date_from,
            date_to: dateRange.previous_date_to,
            interval: dateRange.interval,
          }),
          fetchPostHogAPI('/insights/trend/', fullConfig, {
            events: JSON.stringify([{ id: '$pageview', type: 'events', math: 'dau' }]),
            date_from: dateRange.previous_date_from,
            date_to: dateRange.previous_date_to,
            interval: dateRange.interval,
          }),
        ])

        // Parse and validate responses
        const pageviews = PostHogTrendsSchema.safeParse(pageviewsData)
        const sessions = PostHogTrendsSchema.safeParse(sessionsData)
        const prevPageviews = PostHogTrendsSchema.safeParse(prevPageviewsData)
        const prevSessions = PostHogTrendsSchema.safeParse(prevSessionsData)

        if (!pageviews.success || !sessions.success) {
          console.error('PostHog data parsing failed')
          return null
        }

        // Calculate current period totals
        const currentPageviews = pageviews.data.results[0]?.count || 0
        const currentVisitors = sessions.data.results[0]?.count || 0

        // Calculate previous period totals
        const previousPageviews = prevPageviews.success ? (prevPageviews.data.results[0]?.count || 0) : 0
        const previousVisitors = prevSessions.success ? (prevSessions.data.results[0]?.count || 0) : 0

        // Calculate changes
        const pageviewsChange = previousPageviews > 0 
          ? ((currentPageviews - previousPageviews) / previousPageviews) * 100 
          : null
        const visitorsChange = previousVisitors > 0 
          ? ((currentVisitors - previousVisitors) / previousVisitors) * 100 
          : null

        // Calculate bounce rate and duration (PostHog doesn't provide these directly)
        // We'll use placeholder values for now
        const bounceRate = 45.0 // Placeholder
        const avgDuration = 120 // Placeholder (seconds)

        // Format timeseries data
        const timeseries = pageviews.data.results[0]?.labels.map((label, index) => ({
          date: label,
          visitors: sessions.data.results[0]?.data[index] || 0,
          pageviews: pageviews.data.results[0]?.data[index] || 0,
        })) || []

        // Format pages data (from paths if available)
        const pages = (pathsData as PostHogResultsResponse<PostHogPathResult> | null)?.results?.slice(0, 10).map((path) => ({
          page: path.path || '/',
          visitors: path.count || 0,
          pageviews: path.count || 0,
          bounce_rate: bounceRate,
          visit_duration: avgDuration,
        })) || []

        // Format sources data
        const sources = (referrersData as PostHogResultsResponse<PostHogReferrerResult> | null)?.results?.slice(0, 10).map((ref) => ({
          source: ref.label || 'Direct',
          visitors: ref.count || 0,
          bounce_rate: bounceRate,
          visit_duration: avgDuration,
        })) || []

        // Format events data
        const events = (eventsData as PostHogResultsResponse<PostHogEventResult> | null)?.results?.map((event) => ({
          goal: event.event,
          visitors: event.count || 0,
          events: event.count || 0,
          conversion_rate: currentVisitors > 0 ? (event.count / currentVisitors) * 100 : 0,
        })) || []

        // Get real-time visitors (PostHog doesn't have a direct API for this)
        // We'll use the last hour's data as an approximation
        const realtimeVisitors = 0 // Placeholder

        return {
          stats: {
            visitors: {
              value: currentVisitors,
              change: visitorsChange,
            },
            pageviews: {
              value: currentPageviews,
              change: pageviewsChange,
            },
            bounce_rate: {
              value: bounceRate,
              change: null,
            },
            visit_duration: {
              value: avgDuration,
              change: null,
            },
          },
          timeseries,
          pages,
          sources,
          events,
          realtime: {
            visitors: realtimeVisitors,
          },
        }
      } catch (error) {
        console.error('PostHog getDashboardData error:', error)
        return null
      }
    },
    trackEvent(eventName: string, props?: Record<string, unknown>) {
      // Client-side tracking would be implemented here
      // This is just a placeholder as tracking is typically done client-side
      console.log('PostHog trackEvent:', eventName, props)
    },
  }
}