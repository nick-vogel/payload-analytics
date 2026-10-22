import type { Config, Field } from 'payload'

export interface AnalyticsProvider {
  name: string
  getDashboardData: (period?: string, comparison?: ComparisonData) => Promise<DashboardData | null>
  trackEvent?: (eventName: string, props?: Record<string, unknown>) => void
}

export interface PlausibleConfig {
  apiKey?: string
  siteId?: string
  apiHost?: string
}

export interface UmamiConfig {
  apiKey?: string
  siteId?: string
  apiHost?: string
}

export interface MatomoConfig {
  apiToken?: string
  siteId?: string
  apiHost?: string
}

export interface PostHogConfig {
  apiKey?: string
  projectId?: string
  apiHost?: string
}

export interface GoogleAnalyticsConfig {
  propertyId?: string
  apiKey?: string
}

export type TimePeriod = 
  | 'day' 
  | '7d' 
  | '14d' 
  | '30d' 
  | '6mo'
  | '12mo'
  | 'month'
  | 'lastMonth' 
  | 'thisMonth'
  | 'year'
  | 'lastYear'
  | 'thisYear'
  | 'custom'
  | string // Allow provider-specific periods

export type ComparisonOption = 
  | 'previousPeriod' 
  | 'sameLastYear' 
  | 'custom'

export interface ComparisonData {
  period: ComparisonOption
  customStartDate?: string
  customEndDate?: string
}

export interface DashboardWidgetConfig {
  enabled?: boolean
  position?: 'beforeDashboard' | 'afterDashboard'
}

export interface AnalyticsViewConfig {
  enabled?: boolean
  position?: 'beforeNavLinks' | 'afterNavLinks'
}

export interface CollectionAnalyticsConfig {
  enabled: boolean
  rootPath: string
  tabbedUI?: boolean
  fields?: (args: { defaultFields: Field[] }) => Field[]
}

// Base configuration shared by all providers
interface BaseAnalyticsConfig {
  enabled?: boolean
  enableDashboard?: boolean
  dashboardPath?: string
  dashboardWidget?: DashboardWidgetConfig | boolean // boolean for backward compatibility
  analyticsView?: AnalyticsViewConfig | boolean // boolean for backward compatibility
  customNavigation?: boolean
  useGenericIcon?: boolean
  timePeriods?: TimePeriod[]
  defaultTimePeriod?: TimePeriod
  comparisonOptions?: ComparisonOption[]
  enableComparison?: boolean
  externalDashboardUrl?: string
  externalDashboardLinkText?: string
  showExternalLink?: boolean
  collections?: Record<string, CollectionAnalyticsConfig>
}

// Provider-specific configurations using discriminated unions
export type AnalyticsPluginConfig = BaseAnalyticsConfig & (
  | { provider: 'plausible'; config?: PlausibleConfig }
  | { provider: 'umami'; config?: UmamiConfig }
  | { provider: 'matomo'; config?: MatomoConfig }
  | { provider: 'posthog'; config?: PostHogConfig }
  | { provider: 'google-analytics'; config?: GoogleAnalyticsConfig }
  | { provider: AnalyticsProvider; config?: never }
)

// Legacy support - to be deprecated
export interface LegacyAnalyticsPluginConfig extends BaseAnalyticsConfig {
  provider: 'plausible' | 'umami' | 'matomo' | 'posthog' | 'google-analytics' | AnalyticsProvider
  plausible?: PlausibleConfig
  umami?: UmamiConfig
  matomo?: MatomoConfig
  posthog?: PostHogConfig
  googleAnalytics?: GoogleAnalyticsConfig
}

// Values the plugin stores on the Node global for API routes and server components
export interface AnalyticsGlobals {
  __analyticsProvider?: AnalyticsProvider
  __analyticsProviderName?: string
  __analyticsUseGenericIcon?: boolean
  __analyticsTimePeriods?: TimePeriod[]
  __analyticsDefaultTimePeriod?: TimePeriod
  __analyticsComparisonOptions?: ComparisonOption[]
  __analyticsEnableComparison?: boolean
  __analyticsDashboardPath?: string
  __analyticsExternalDashboardUrl?: string
  __analyticsExternalDashboardLinkText?: string
  __analyticsShowExternalLink?: boolean
  __adminRoute?: string
}

export interface DashboardData {
  stats?: {
    visitors: { value: number; change: number | null }
    pageviews: { value: number; change: number | null }
    bounce_rate: { value: number; change: number | null }
    visit_duration: { value: number; change: number | null }
  }
  timeseries?: Array<{
    date: string
    visitors: number
    pageviews?: number
    bounce_rate?: number
    visit_duration?: number
  }>
  pages?: Array<{
    page: string
    visitors: number
    pageviews: number
    bounce_rate: number
    visit_duration: number
  }>
  sources?: Array<{
    source: string
    visitors: number
    bounce_rate: number
    visit_duration: number
  }>
  events?: Array<{
    goal: string
    visitors: number
    events: number
    conversion_rate: number
  }>
  realtime?: {
    visitors: number
  }
}

export type AnalyticsPlugin = (config: AnalyticsPluginConfig) => (payload: Config) => Config