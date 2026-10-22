import React from 'react'
import { AnalyticsClient } from './AnalyticsClient'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter, SetStepNav } from '@payloadcms/ui'
import { AdminViewServerProps } from 'payload'
import type { TimePeriod } from '../types'

// Values the plugin stores on the Node global in src/index.ts
interface AnalyticsViewGlobals {
  __analyticsTimePeriods?: TimePeriod[]
  __analyticsDefaultTimePeriod?: TimePeriod
  __analyticsEnableComparison?: boolean
  __analyticsDashboardPath?: string
  __analyticsExternalDashboardUrl?: string
  __analyticsExternalDashboardLinkText?: string
  __analyticsShowExternalLink?: boolean
}

export const AnalyticsView: React.FC<AdminViewServerProps> = ({ initPageResult, params, searchParams}) => {

  if (!initPageResult.req.user) {
    return <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={undefined}
      visibleEntities={initPageResult.visibleEntities}
    >
      <Gutter>
        <h1>Unauthorized</h1>
        <p>You must be logged in to view this page.</p>
      </Gutter>
    </DefaultTemplate>
  }

  // Get config from global
  const analyticsGlobal = global as typeof globalThis & AnalyticsViewGlobals
  const timePeriods = analyticsGlobal.__analyticsTimePeriods
  const defaultTimePeriod = analyticsGlobal.__analyticsDefaultTimePeriod
  const enableComparison = analyticsGlobal.__analyticsEnableComparison
  const dashboardPath = analyticsGlobal.__analyticsDashboardPath || '/analytics'
  const externalDashboardUrl = analyticsGlobal.__analyticsExternalDashboardUrl
  const externalDashboardLinkText = analyticsGlobal.__analyticsExternalDashboardLinkText
  const showExternalLink = analyticsGlobal.__analyticsShowExternalLink
  
  // Get admin route from Payload config
  const adminRoute = '/admin' // Default admin route

  const navItems = [
    {
      url: `${adminRoute}${dashboardPath}`,
      label: 'Analytics'
    }
  ]

  return <DefaultTemplate
    i18n={initPageResult.req.i18n}
    locale={initPageResult.locale}
    params={params}
    payload={initPageResult.req.payload}
    permissions={initPageResult.permissions}
    searchParams={searchParams}
    user={initPageResult.req.user || undefined}
    visibleEntities={initPageResult.visibleEntities}
  >
    <SetStepNav nav={navItems} />
    <div style={{ marginBottom: 'calc(var(--base) * 3)' }}>
      <Gutter>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h1 style={{ margin: 0 }}>Analytics Dashboard</h1>
          {showExternalLink && externalDashboardUrl && (
            <>
              <style>{`
                .analytics-view-external-link {
                  display: inline-flex;
                  align-items: center;
                  gap: 0.25rem;
                  color: var(--theme-text-light);
                  text-decoration: none;
                  font-size: 0.875rem;
                  transition: color 0.2s;
                }
                .analytics-view-external-link:hover {
                  color: var(--theme-text);
                }
              `}</style>
              <a
                href={externalDashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="analytics-view-external-link"
              >
                {externalDashboardLinkText || 'View in Dashboard'}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M5.75 10.25L10.25 5.75M10.25 5.75H6.5M10.25 5.75V9.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </>
          )}
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.__analyticsTimePeriods = ${JSON.stringify(timePeriods)};
              window.__analyticsDefaultTimePeriod = ${JSON.stringify(defaultTimePeriod)};
              window.__analyticsEnableComparison = ${JSON.stringify(enableComparison)};
              window.__analyticsExternalDashboardUrl = ${JSON.stringify(externalDashboardUrl)};
              window.__analyticsExternalDashboardLinkText = ${JSON.stringify(externalDashboardLinkText)};
              window.__analyticsShowExternalLink = ${JSON.stringify(showExternalLink)};
            `,
          }}
        />
        <AnalyticsClient />
      </Gutter>
    </div>
  </DefaultTemplate>
}

export default AnalyticsView