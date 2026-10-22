import type { PayloadRequest } from 'payload'
import type { AnalyticsGlobals } from '../types'

export const collectionAnalyticsEndpoint = async (req: PayloadRequest): Promise<Response> => {
  const provider = (globalThis as typeof globalThis & AnalyticsGlobals).__analyticsProvider
  if (!provider) {
    return Response.json({ error: 'Analytics provider not configured' }, { status: 500 })
  }

  const url = new URL(req.url || '', `http://localhost`)
  const path = url.searchParams.get('path')
  
  if (!path) {
    return Response.json({ error: 'Path parameter is required' }, { status: 400 })
  }
  
  try {
    // For collection analytics, we'll use a 30-day period
    // and filter by the specific path
    const data = await provider.getDashboardData('30d')
    
    if (!data) {
      return Response.json({ error: 'Failed to fetch analytics data' }, { status: 500 })
    }
    
    // Filter the data to only include stats for the specific path
    // This is a simplified version - in a real implementation,
    // providers would need to support path filtering
    const filteredData = {
      ...data,
      pages: data.pages?.filter(page => page.page === path) || [],
    }
    
    // If we have page-specific data, use it for the stats
    if (filteredData.pages.length > 0) {
      const pageData = filteredData.pages[0]
      filteredData.stats = {
        visitors: { value: pageData.visitors, change: null },
        pageviews: { value: pageData.pageviews, change: null },
        bounce_rate: { value: pageData.bounce_rate, change: null },
        visit_duration: { value: pageData.visit_duration, change: null },
      }
    } else {
      // No data for this specific page
      filteredData.stats = {
        visitors: { value: 0, change: null },
        pageviews: { value: 0, change: null },
        bounce_rate: { value: 0, change: null },
        visit_duration: { value: 0, change: null },
      }
    }

    return Response.json(filteredData)
  } catch {
    return Response.json({ error: 'Failed to fetch analytics data' }, { status: 500 })
  }
}