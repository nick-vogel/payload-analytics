import { z } from 'zod'
import { AnalyticsProvider, DashboardData, ComparisonData } from '../types'

export interface GoogleAnalyticsConfig {
  propertyId?: string
  apiKey?: string
}

// GA4 API response schemas
const GA4DimensionHeaderSchema = z.object({
  name: z.string(),
})

const GA4MetricHeaderSchema = z.object({
  name: z.string(),
  type: z.string(),
})

const GA4RowSchema = z.object({
  dimensionValues: z.array(z.object({
    value: z.string(),
  })),
  metricValues: z.array(z.object({
    value: z.string(),
  })),
})

const GA4ResponseSchema = z.object({
  dimensionHeaders: z.array(GA4DimensionHeaderSchema).optional(),
  metricHeaders: z.array(GA4MetricHeaderSchema).optional(),
  rows: z.array(GA4RowSchema).optional(),
  rowCount: z.number().optional(),
})

async function fetchGA4API(
  endpoint: string,
  config: Required<GoogleAnalyticsConfig>,
  body: Record<string, unknown>
): Promise<unknown> {
  const { propertyId, apiKey } = config

  if (!propertyId || !apiKey) {
    console.warn('Google Analytics API credentials missing')
    return null
  }

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:${endpoint}?key=${apiKey}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`GA4 API error: ${response.status} ${response.statusText}`)
    }

    return await response.json()
  } catch (error) {
    console.error('GA4 API fetch error:', error)
    return null
  }
}

function getGA4DateRange(period?: string) {
  const today = new Date()
  const getDateString = (date: Date) => date.toISOString().split('T')[0]
  
  let startDate: string
  let endDate = 'today'
  let previousStartDate: string
  let previousEndDate: string

  switch (period) {
    case 'day':
    case '24h':
      startDate = 'today'
      previousStartDate = 'yesterday'
      previousEndDate = 'yesterday'
      break
    case '7d':
      startDate = '7daysAgo'
      previousStartDate = '14daysAgo'
      previousEndDate = '8daysAgo'
      break
    case '14d':
      startDate = '14daysAgo'
      previousStartDate = '28daysAgo'
      previousEndDate = '15daysAgo'
      break
    case '30d':
      startDate = '30daysAgo'
      previousStartDate = '60daysAgo'
      previousEndDate = '31daysAgo'
      break
    case 'lastMonth': {
      const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0)
      startDate = getDateString(lastMonth)
      endDate = getDateString(lastMonthEnd)
      previousStartDate = getDateString(new Date(lastMonth.getFullYear(), lastMonth.getMonth() - 1, 1))
      previousEndDate = getDateString(new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 0))
      break
    }
    case 'thisMonth': {
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      startDate = getDateString(thisMonth)
      previousStartDate = getDateString(new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1))
      previousEndDate = getDateString(new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 0))
      break
    }
    case '12mo':
      startDate = '365daysAgo'
      previousStartDate = '730daysAgo'
      previousEndDate = '366daysAgo'
      break
    default:
      startDate = '7daysAgo'
      previousStartDate = '14daysAgo'
      previousEndDate = '8daysAgo'
  }

  return {
    current: { startDate, endDate },
    previous: { startDate: previousStartDate, endDate: previousEndDate },
  }
}

/**
 * GA4 returns the `date` dimension as YYYYMMDD and `dateHour` as YYYYMMDDHH.
 * The dashboard chart passes the value to `new Date()`, which needs ISO 8601,
 * so convert to YYYY-MM-DD (or YYYY-MM-DDTHH:00:00 for an hourly key).
 * Anything else is returned unchanged.
 */
function toISODate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?$/.exec(value)
  if (!match) return value
  const [, year, month, day, hour] = match
  const date = `${year}-${month}-${day}`
  return hour === undefined ? date : `${date}T${hour}:00:00`
}

function parseMetricValue(value: string, type: string = 'TYPE_INTEGER'): number {
  if (type === 'TYPE_FLOAT' || type === 'TYPE_PERCENT') {
    return parseFloat(value) || 0
  }
  return parseInt(value, 10) || 0
}

export function createGoogleAnalyticsProvider(config: GoogleAnalyticsConfig = {}): AnalyticsProvider {
  const fullConfig: Required<GoogleAnalyticsConfig> = {
    propertyId: config.propertyId || process.env.GA4_PROPERTY_ID || '',
    apiKey: config.apiKey || process.env.GA4_API_KEY || '',
  }

  return {
    name: 'google-analytics',
    async getDashboardData(period: string = '7d', _comparison?: ComparisonData): Promise<DashboardData | null> {
      try {
        const dateRanges = getGA4DateRange(period)

        // Fetch overview metrics with comparison
        const metricsResponse = await fetchGA4API('runReport', fullConfig, {
          dateRanges: [dateRanges.current, dateRanges.previous],
          metrics: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
          ],
        })

        const metricsData = GA4ResponseSchema.safeParse(metricsResponse)
        if (!metricsData.success || !metricsData.data.rows) {
          console.error('GA4 metrics parsing failed')
          return null
        }

        // Extract current and previous period metrics
        const currentMetrics = metricsData.data.rows[0]?.metricValues || []
        const previousMetrics = metricsData.data.rows[1]?.metricValues || []

        const visitors = parseMetricValue(currentMetrics[0]?.value || '0')
        const pageviews = parseMetricValue(currentMetrics[1]?.value || '0')
        const bounceRate = parseMetricValue(currentMetrics[2]?.value || '0', 'TYPE_FLOAT') * 100
        const avgDuration = parseMetricValue(currentMetrics[3]?.value || '0', 'TYPE_FLOAT')

        const prevVisitors = parseMetricValue(previousMetrics[0]?.value || '0')
        const prevPageviews = parseMetricValue(previousMetrics[1]?.value || '0')
        const prevBounceRate = parseMetricValue(previousMetrics[2]?.value || '0', 'TYPE_FLOAT') * 100
        const prevAvgDuration = parseMetricValue(previousMetrics[3]?.value || '0', 'TYPE_FLOAT')

        // Calculate changes
        const visitorsChange = prevVisitors > 0 ? ((visitors - prevVisitors) / prevVisitors) * 100 : null
        const pageviewsChange = prevPageviews > 0 ? ((pageviews - prevPageviews) / prevPageviews) * 100 : null
        const bounceRateChange = prevBounceRate > 0 ? ((bounceRate - prevBounceRate) / prevBounceRate) * 100 : null
        const durationChange = prevAvgDuration > 0 ? ((avgDuration - prevAvgDuration) / prevAvgDuration) * 100 : null

        // Fetch time series data
        const timeseriesResponse = await fetchGA4API('runReport', fullConfig, {
          dateRanges: [dateRanges.current],
          dimensions: [{ name: 'date' }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
          ],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        })

        const timeseriesData = GA4ResponseSchema.safeParse(timeseriesResponse)
        const timeseries = timeseriesData.success && timeseriesData.data.rows
          ? timeseriesData.data.rows.map(row => ({
              date: toISODate(row.dimensionValues[0]?.value || ''),
              visitors: parseMetricValue(row.metricValues[0]?.value || '0'),
              pageviews: parseMetricValue(row.metricValues[1]?.value || '0'),
            }))
          : []

        // Fetch top pages
        const pagesResponse = await fetchGA4API('runReport', fullConfig, {
          dateRanges: [dateRanges.current],
          dimensions: [{ name: 'pagePath' }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
          ],
          limit: 10,
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        })

        const pagesData = GA4ResponseSchema.safeParse(pagesResponse)
        const pages = pagesData.success && pagesData.data.rows
          ? pagesData.data.rows.map(row => ({
              page: row.dimensionValues[0]?.value || '/',
              visitors: parseMetricValue(row.metricValues[0]?.value || '0'),
              pageviews: parseMetricValue(row.metricValues[1]?.value || '0'),
              bounce_rate: parseMetricValue(row.metricValues[2]?.value || '0', 'TYPE_FLOAT') * 100,
              visit_duration: parseMetricValue(row.metricValues[3]?.value || '0', 'TYPE_FLOAT'),
            }))
          : []

        // Fetch traffic sources
        const sourcesResponse = await fetchGA4API('runReport', fullConfig, {
          dateRanges: [dateRanges.current],
          dimensions: [{ name: 'sessionSource' }],
          metrics: [
            { name: 'activeUsers' },
            { name: 'bounceRate' },
            { name: 'averageSessionDuration' },
          ],
          limit: 10,
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        })

        const sourcesData = GA4ResponseSchema.safeParse(sourcesResponse)
        const sources = sourcesData.success && sourcesData.data.rows
          ? sourcesData.data.rows.map(row => ({
              source: row.dimensionValues[0]?.value || 'Direct',
              visitors: parseMetricValue(row.metricValues[0]?.value || '0'),
              bounce_rate: parseMetricValue(row.metricValues[1]?.value || '0', 'TYPE_FLOAT') * 100,
              visit_duration: parseMetricValue(row.metricValues[2]?.value || '0', 'TYPE_FLOAT'),
            }))
          : []

        // Fetch events (GA4 custom events)
        const eventsResponse = await fetchGA4API('runReport', fullConfig, {
          dateRanges: [dateRanges.current],
          dimensions: [{ name: 'eventName' }],
          metrics: [
            { name: 'eventCount' },
            { name: 'activeUsers' },
          ],
          limit: 10,
          orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
          // FilterExpression fields are mutually exclusive; notExpression wraps a
          // nested FilterExpression to negate it.
          dimensionFilter: {
            notExpression: {
              filter: {
                fieldName: 'eventName',
                stringFilter: {
                  matchType: 'EXACT',
                  value: 'page_view',
                  caseSensitive: false,
                },
              },
            },
          },
        })

        const eventsData = GA4ResponseSchema.safeParse(eventsResponse)
        const events = eventsData.success && eventsData.data.rows
          ? eventsData.data.rows.map(row => ({
              goal: row.dimensionValues[0]?.value || '',
              events: parseMetricValue(row.metricValues[0]?.value || '0'),
              visitors: parseMetricValue(row.metricValues[1]?.value || '0'),
              conversion_rate: visitors > 0 
                ? (parseMetricValue(row.metricValues[1]?.value || '0') / visitors) * 100 
                : 0,
            }))
          : []

        // Fetch realtime data (if available with API key)
        // Note: Realtime API might require additional permissions
        const realtimeResponse = await fetchGA4API('runRealtimeReport', fullConfig, {
          metrics: [{ name: 'activeUsers' }],
        })

        const realtimeData = GA4ResponseSchema.safeParse(realtimeResponse)
        const realtimeVisitors = realtimeData.success && realtimeData.data.rows?.[0]
          ? parseMetricValue(realtimeData.data.rows[0].metricValues[0]?.value || '0')
          : 0

        return {
          stats: {
            visitors: {
              value: visitors,
              change: visitorsChange,
            },
            pageviews: {
              value: pageviews,
              change: pageviewsChange,
            },
            bounce_rate: {
              value: bounceRate,
              change: bounceRateChange,
            },
            visit_duration: {
              value: avgDuration,
              change: durationChange,
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
        console.error('Google Analytics getDashboardData error:', error)
        return null
      }
    },
    trackEvent(eventName: string, props?: Record<string, unknown>) {
      // Client-side tracking would use gtag
      console.log('Google Analytics trackEvent:', eventName, props)
    },
  }
}