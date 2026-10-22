'use client'

import React, { useEffect, useState } from 'react'
import { formatNumber, formatPercentage, formatDuration } from '../lib/formatters'
import type { DashboardData } from '../types'

// The Payload client config, if something has exposed it on window
interface PayloadConfigWindow extends Window {
  __payloadConfig?: { routes?: { api?: string } }
}

interface CollectionAnalyticsProps {
  collectionSlug: string
  documentSlug: string
  rootPath: string
}

export const CollectionAnalytics: React.FC<CollectionAnalyticsProps> = ({ 
  collectionSlug, 
  documentSlug, 
  rootPath 
}) => {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasData, setHasData] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      if (!documentSlug) {
        setLoading(false)
        return
      }

      try {
        const apiRoute = (window as PayloadConfigWindow).__payloadConfig?.routes?.api || '/api'
        // Construct the path to track
        const fullPath = `${rootPath}/${documentSlug}`.replace(/\/+/g, '/')
        
        const response = await fetch(`${apiRoute}/analytics/collection?path=${encodeURIComponent(fullPath)}`, {
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
          },
        })
        
        if (!response.ok) {
          throw new Error('Failed to fetch analytics data')
        }
        
        const analyticsData = await response.json()
        
        // Check if we have any data
        const hasStats = analyticsData?.stats && 
          (analyticsData.stats.visitors?.value > 0 || 
           analyticsData.stats.pageviews?.value > 0)
        
        setHasData(hasStats)
        setData(analyticsData)
      } catch (err) {
        console.error('Failed to fetch collection analytics:', err)
        setHasData(false)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [collectionSlug, documentSlug, rootPath])

  // Add styles
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .collection-analytics-container {
        padding: 0;
      }
      .collection-analytics-empty {
        padding: 2rem;
        text-align: center;
        color: var(--theme-text-light);
      }
      .collection-analytics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        padding: 1rem;
      }
      .collection-analytics-card {
        background: var(--theme-elevation-50);
        border: 1px solid var(--theme-elevation-100);
        border-radius: var(--style-radius-s);
        padding: 1rem;
      }
      .collection-analytics-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--theme-text-light);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
      }
      .collection-analytics-value {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--theme-text);
      }
      .collection-analytics-subtitle {
        font-size: 0.875rem;
        color: var(--theme-text-light);
        margin-top: 0.25rem;
      }
    `
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  if (loading) {
    return (
      <div className="collection-analytics-container">
        <div className="payload__loading-overlay">
          <div className="payload__loading-overlay__bars">
            <div />
            <div />
            <div />
          </div>
        </div>
      </div>
    )
  }

  if (!hasData || !data?.stats) {
    return (
      <div className="collection-analytics-container">
        <div className="collection-analytics-empty">
          No analytics data available for this page yet.
        </div>
      </div>
    )
  }

  return (
    <div className="collection-analytics-container">
      <div className="collection-analytics-grid">
        <div className="collection-analytics-card">
          <div className="collection-analytics-label">Visitors</div>
          <div className="collection-analytics-value">
            {formatNumber(data.stats?.visitors?.value || 0)}
          </div>
          <div className="collection-analytics-subtitle">Last 30 days</div>
        </div>
        
        <div className="collection-analytics-card">
          <div className="collection-analytics-label">Pageviews</div>
          <div className="collection-analytics-value">
            {formatNumber(data.stats?.pageviews?.value || 0)}
          </div>
          <div className="collection-analytics-subtitle">Last 30 days</div>
        </div>
        
        <div className="collection-analytics-card">
          <div className="collection-analytics-label">Bounce Rate</div>
          <div className="collection-analytics-value">
            {formatPercentage(data.stats?.bounce_rate?.value || 0)}
          </div>
          <div className="collection-analytics-subtitle">Last 30 days</div>
        </div>
        
        <div className="collection-analytics-card">
          <div className="collection-analytics-label">Avg Duration</div>
          <div className="collection-analytics-value">
            {formatDuration(data.stats?.visit_duration?.value || 0)}
          </div>
          <div className="collection-analytics-subtitle">Last 30 days</div>
        </div>
      </div>
    </div>
  )
}

export default CollectionAnalytics