import type { Config } from 'payload'
import type {
  AnalyticsGlobals,
  AnalyticsPluginConfig,
  LegacyAnalyticsPluginConfig,
  AnalyticsProvider,
  DashboardWidgetConfig,
  AnalyticsViewConfig,
  GoogleAnalyticsConfig,
  MatomoConfig,
  PlausibleConfig,
  PostHogConfig,
  UmamiConfig,
} from './types'
import { createPlausibleProvider } from './providers/plausible'
import { createUmamiProvider } from './providers/umami'
import { createMatomoProvider } from './providers/matomo'
import { createPostHogProvider } from './providers/posthog'
import { createGoogleAnalyticsProvider } from './providers/google-analytics'
import { DEFAULT_TIME_PERIODS, DEFAULT_COMPARISON_OPTIONS } from './constants'
import { analyticsEndpoint } from './endpoints/analytics'
import { collectionAnalyticsEndpoint } from './endpoints/collectionAnalytics'
import { createCollectionAnalyticsFields } from './fields/collectionAnalytics'

// Every field any built-in provider reads; each provider takes the subset it knows
type ProviderConnectionConfig = PlausibleConfig & UmamiConfig & MatomoConfig & PostHogConfig & GoogleAnalyticsConfig

export const analyticsPlugin = (pluginConfig: AnalyticsPluginConfig | LegacyAnalyticsPluginConfig) => (config: Config): Config => {
  // Extract base configuration
  const {
    provider = 'plausible',
    enabled = true,
    enableDashboard = true,
    dashboardPath = '/analytics',
    dashboardWidget = { enabled: true, position: 'afterDashboard' },
    analyticsView = { enabled: true, position: 'afterNavLinks' },
    customNavigation = true,
    useGenericIcon = false,
    timePeriods = DEFAULT_TIME_PERIODS,
    defaultTimePeriod = '7d',
    comparisonOptions = DEFAULT_COMPARISON_OPTIONS,
    enableComparison = true,
    externalDashboardUrl,
    externalDashboardLinkText,
    showExternalLink = true,
    collections = {},
  } = pluginConfig

  // Handle provider configuration - support both new and legacy patterns
  let providerConfig: ProviderConnectionConfig = {}
  
  if ('config' in pluginConfig) {
    // New pattern: config field
    providerConfig = pluginConfig.config || {}
  } else {
    // Legacy pattern: provider-specific fields
    const legacyConfig = pluginConfig as LegacyAnalyticsPluginConfig
    switch (provider) {
      case 'plausible':
        providerConfig = legacyConfig.plausible || {}
        break
      case 'umami':
        providerConfig = legacyConfig.umami || {}
        break
      case 'matomo':
        providerConfig = legacyConfig.matomo || {}
        break
      case 'posthog':
        providerConfig = legacyConfig.posthog || {}
        break
      case 'google-analytics':
        providerConfig = legacyConfig.googleAnalytics || {}
        break
    }
  }

  // Handle backward compatibility for dashboardWidget
  const widgetConfig: DashboardWidgetConfig = typeof dashboardWidget === 'boolean' 
    ? { enabled: dashboardWidget, position: 'afterDashboard' }
    : dashboardWidget

  // Handle backward compatibility for analyticsView
  const viewConfig: AnalyticsViewConfig = typeof analyticsView === 'boolean'
    ? { enabled: analyticsView && customNavigation, position: 'afterNavLinks' }
    : analyticsView

  if (!enabled) {
    return config
  }

  // Get the provider instance
  let providerInstance: AnalyticsProvider
  if (typeof provider === 'string') {
    switch (provider) {
      case 'plausible':
        providerInstance = createPlausibleProvider(providerConfig)
        break
      case 'umami':
        providerInstance = createUmamiProvider(providerConfig)
        break
      case 'matomo':
        providerInstance = createMatomoProvider(providerConfig)
        break
      case 'posthog':
        providerInstance = createPostHogProvider(providerConfig)
        break
      case 'google-analytics':
        providerInstance = createGoogleAnalyticsProvider(providerConfig)
        break
      default:
        throw new Error(`Unknown analytics provider: ${provider}`)
    }
  } else {
    providerInstance = provider
  }

  // Generate default external URL if not provided
  let finalExternalUrl = externalDashboardUrl
  if (!finalExternalUrl && typeof provider === 'string') {
    switch (provider) {
      case 'plausible':
        if (providerConfig.siteId && providerConfig.apiHost) {
          finalExternalUrl = `${providerConfig.apiHost}/${providerConfig.siteId}`
        }
        break
      case 'umami':
        if (providerConfig.siteId && providerConfig.apiHost) {
          finalExternalUrl = `${providerConfig.apiHost}/websites/${providerConfig.siteId}`
        }
        break
      case 'matomo':
        if (providerConfig.siteId && providerConfig.apiHost) {
          finalExternalUrl = `${providerConfig.apiHost}/index.php?module=CoreHome&action=index&idSite=${providerConfig.siteId}&period=day&date=today`
        }
        break
      case 'posthog':
        if (providerConfig.projectId && providerConfig.apiHost) {
          finalExternalUrl = `${providerConfig.apiHost}/project/${providerConfig.projectId}/dashboard`
        }
        break
      case 'google-analytics':
        if (providerConfig.propertyId) {
          finalExternalUrl = `https://analytics.google.com/analytics/web/#/report-home/a${providerConfig.propertyId}`
        }
        break
    }
  }

  // Generate default link text if not provided
  const finalLinkText = externalDashboardLinkText || `View in ${typeof provider === 'string' ? provider.charAt(0).toUpperCase() + provider.slice(1).replace(/-/g, ' ') : 'Dashboard'}`

  // Store provider and config in global for API routes and components
  const analyticsGlobal = globalThis as typeof globalThis & AnalyticsGlobals
  analyticsGlobal.__analyticsProvider = providerInstance
  analyticsGlobal.__analyticsProviderName = typeof provider === 'string' ? provider : provider.name
  analyticsGlobal.__analyticsUseGenericIcon = useGenericIcon
  analyticsGlobal.__analyticsTimePeriods = timePeriods
  analyticsGlobal.__analyticsDefaultTimePeriod = defaultTimePeriod
  analyticsGlobal.__analyticsComparisonOptions = comparisonOptions
  analyticsGlobal.__analyticsEnableComparison = enableComparison
  analyticsGlobal.__analyticsDashboardPath = dashboardPath
  analyticsGlobal.__analyticsExternalDashboardUrl = finalExternalUrl
  analyticsGlobal.__analyticsExternalDashboardLinkText = finalLinkText
  analyticsGlobal.__analyticsShowExternalLink = showExternalLink
  analyticsGlobal.__adminRoute = '/admin' // Default admin route


  const updatedConfig: Config = {
    ...config,
    admin: {
      ...config.admin,
      components: {
        ...config.admin?.components,
        views: {
          ...config.admin?.components?.views,
          ...(enableDashboard ? {
            analytics: {
              Component: 'payload-analytics-plugin/components/AnalyticsView',
              path: dashboardPath as `/${string}`,
            },
          } : {}),
        },
        ...(viewConfig.enabled && customNavigation ? {
          [viewConfig.position === 'beforeNavLinks' ? 'beforeNavLinks' : 'afterNavLinks']: [
            ...(config.admin?.components?.[viewConfig.position === 'beforeNavLinks' ? 'beforeNavLinks' : 'afterNavLinks'] || []),
            'payload-analytics-plugin/components/AfterNavLinks',
          ],
        } : {}),
        ...(widgetConfig.enabled ? {
          [widgetConfig.position === 'beforeDashboard' ? 'beforeDashboard' : 'afterDashboard']: [
            ...(config.admin?.components?.[widgetConfig.position === 'beforeDashboard' ? 'beforeDashboard' : 'afterDashboard'] || []),
            'payload-analytics-plugin/components/AnalyticsWidget',
          ],
        } : {}),
      },
    },
    endpoints: [
      ...(config.endpoints || []),
      {
        path: '/analytics/dashboard',
        method: 'get',
        handler: analyticsEndpoint,
      },
      {
        path: '/analytics/collection',
        method: 'get',
        handler: collectionAnalyticsEndpoint,
      },
    ],
    collections: config.collections?.map(collection => {
      // Check if this collection has analytics enabled
      const collectionAnalytics = collections[collection.slug]
      
      if (!collectionAnalytics?.enabled) {
        return collection
      }
      
      // Create analytics fields
      const analyticsFields = createCollectionAnalyticsFields({ config: collectionAnalytics })
      
      // If tabbedUI is enabled and collection has tabs as first field, add to tabs
      if (collectionAnalytics.tabbedUI !== false) {
        const firstField = collection.fields?.[0]
        if (firstField && firstField.type === 'tabs') {
          return {
            ...collection,
            fields: [
              {
                ...firstField,
                tabs: [
                  ...firstField.tabs,
                  {
                    label: 'Analytics',
                    fields: analyticsFields,
                  },
                ],
              },
              ...collection.fields.slice(1),
            ],
          }
        }
        // If no existing tabs, create tabs with Content and Analytics
        return {
          ...collection,
          fields: [
            {
              type: 'tabs',
              tabs: [
                {
                  label: 'Content',
                  fields: collection.fields || [],
                },
                {
                  label: 'Analytics',
                  fields: analyticsFields,
                },
              ],
            },
          ],
        }
      }
      
      // Otherwise add as group field at the end
      return {
        ...collection,
        fields: [
          ...(collection.fields || []),
          ...analyticsFields,
        ],
      }
    }),
  }

  return updatedConfig
}

// Export types and utilities
export * from './types'
export * from './lib/formatters'
export * from './constants'
export { createAnalyticsTab } from './fields/analyticsTab'
export { CollectionAnalyticsField } from './fields/collectionAnalytics'
export { createPlausibleProvider } from './providers/plausible'
export { createUmamiProvider } from './providers/umami'
export { createMatomoProvider } from './providers/matomo'
export { createPostHogProvider } from './providers/posthog'
export { createGoogleAnalyticsProvider } from './providers/google-analytics'