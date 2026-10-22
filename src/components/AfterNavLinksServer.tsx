import React from 'react'
import { AfterNavLinksClient } from './AfterNavLinksClient'

// Values the plugin stores on the Node global in src/index.ts
interface AnalyticsNavGlobals {
  __analyticsProviderName?: string
  __analyticsUseGenericIcon?: boolean
  __analyticsDashboardPath?: string
  __adminRoute?: string
}

export const AfterNavLinks: React.FC = () => {
  // Get the provider name and icon preference from global config
  const analyticsGlobal = global as typeof globalThis & AnalyticsNavGlobals
  const providerName = analyticsGlobal.__analyticsProviderName || 'plausible'
  const useGenericIcon = analyticsGlobal.__analyticsUseGenericIcon || false
  const dashboardPath = analyticsGlobal.__analyticsDashboardPath || '/analytics'
  const adminRoute = analyticsGlobal.__adminRoute || '/admin'
  
  return <AfterNavLinksClient provider={providerName} useGenericIcon={useGenericIcon} dashboardPath={dashboardPath} adminRoute={adminRoute} />
}

export default AfterNavLinks