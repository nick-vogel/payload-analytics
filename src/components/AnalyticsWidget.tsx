'use client'

import React, { useEffect, useState } from 'react'
import { formatNumber, formatPercentage, formatDuration } from '../lib/formatters'
import type { DashboardData } from '../types'
import { ExternalLink } from './ExternalLink'

// Values AnalyticsView injects on window, plus the Payload client config if present
interface AnalyticsWindow extends Window {
  __analyticsExternalDashboardUrl?: string
  __analyticsExternalDashboardLinkText?: string
  __analyticsShowExternalLink?: boolean
  __payloadConfig?: { routes?: { api?: string } }
}

export const AnalyticsWidget: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [externalUrl, setExternalUrl] = useState<string | null>(null)
  const [externalLinkText, setExternalLinkText] = useState<string>('View in Dashboard')
  const [showExternalLink, setShowExternalLink] = useState<boolean>(true)

  // Add styles
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `
      .card {
        background: var(--theme-elevation-100);
        border: 1px solid var(--theme-elevation-200);
        border-radius: var(--style-radius-m);
        padding: calc(var(--base) * 1.5);
        position: relative;
      }
      .analytics-external-link {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        color: var(--theme-text-light);
        text-decoration: none;
        font-size: 0.875rem;
        transition: color 0.2s;
        margin-top: 1rem;
      }
      .analytics-external-link:hover {
        color: var(--theme-text);
      }
      .analytics-external-link-icon {
        width: 14px;
        height: 14px;
      }
    `
    document.head.appendChild(style)
    return () => {
      document.head.removeChild(style)
    }
  }, [])

  useEffect(() => {
    // Get config from global
    const analyticsWindow = window as AnalyticsWindow
    if (typeof window !== 'undefined') {
      setExternalUrl(analyticsWindow.__analyticsExternalDashboardUrl || null)
      setExternalLinkText(analyticsWindow.__analyticsExternalDashboardLinkText || 'View in Dashboard')
      setShowExternalLink(analyticsWindow.__analyticsShowExternalLink !== false)
    }
    
    // Widget always shows today's data
    const apiRoute = analyticsWindow.__payloadConfig?.routes?.api || '/api'
    fetch(`${apiRoute}/analytics/dashboard?period=day`, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then(res => res.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading || !data || !data.stats) {
    return null
  }

  return (
    <div className="card" style={{ marginBottom: '2rem', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--theme-text)' }}>
          Today's Analytics
        </h3>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: 'var(--theme-text)' }}>
          <span style={{
            width: '8px',
            height: '8px',
            backgroundColor: (data.realtime?.visitors || 0) > 0 ? '#10b981' : '#6b7280',
            borderRadius: '50%',
            display: 'inline-block',
            marginRight: '0.5rem'
          }} />
          {data.realtime?.visitors || 0} visitor{data.realtime?.visitors !== 1 ? 's' : ''} online now
        </h3>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-light)' }}>Visitors</div>
          <div style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--theme-text)' }}>
            {formatNumber(data.stats?.visitors?.value || 0)}
          </div>
        </div>
        
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-light)' }}>Pageviews</div>
          <div style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--theme-text)' }}>
            {formatNumber(data.stats?.pageviews?.value || 0)}
          </div>
        </div>
        
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-light)' }}>Bounce Rate</div>
          <div style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--theme-text)' }}>
            {formatPercentage(data.stats?.bounce_rate?.value || 0)}
          </div>
        </div>
        
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-text-light)' }}>Avg Duration</div>
          <div style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--theme-text)' }}>
            {formatDuration(data.stats?.visit_duration?.value || 0)}
          </div>
        </div>
      </div>
      {showExternalLink && externalUrl && (
        <ExternalLink 
          href={externalUrl}
          text={externalLinkText}
        />
      )}
    </div>
  )
}

export default AnalyticsWidget