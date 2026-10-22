import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyticsPlugin } from '@/index'
import { createMockConfig, createMockProvider } from '../utils/test-helpers'
import type { CollectionConfig, Field, TabsField } from 'payload'
import type { AnalyticsGlobals, LegacyAnalyticsPluginConfig } from '@/types'
import { DEFAULT_COMPARISON_OPTIONS } from '@/constants'

const analyticsGlobal = globalThis as typeof globalThis & AnalyticsGlobals

const ANALYTICS_FIELD_PATH = 'payload-analytics-plugin/components/CollectionAnalyticsField'

const createCollection = (slug: string, fields: Field[]): CollectionConfig => ({ slug, fields })

const titleField: Field = { name: 'title', type: 'text' }
const bodyField: Field = { name: 'body', type: 'textarea' }

const asTabs = (field: Field | undefined): TabsField => {
  if (field?.type !== 'tabs') throw new Error(`expected a tabs field, got ${field?.type}`)
  return field
}

// The plugin's analytics group: named 'analytics', rendering the collection field component
const expectAnalyticsGroup = (field: Field | undefined, rootPath: string) => {
  expect(field).toMatchObject({
    name: 'analytics',
    type: 'group',
    fields: [
      {
        name: 'data',
        type: 'ui',
        admin: { components: { Field: ANALYTICS_FIELD_PATH }, custom: { rootPath } },
      },
    ],
  })
}

describe('analyticsPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear global state
    delete analyticsGlobal.__analyticsProvider
    delete analyticsGlobal.__analyticsProviderName
    delete analyticsGlobal.__analyticsTimePeriods
    delete analyticsGlobal.__analyticsDefaultTimePeriod
    delete analyticsGlobal.__analyticsEnableComparison
  })

  describe('plugin initialization', () => {
    it('should create a valid Payload plugin', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        plausible: {
          apiKey: 'test-key',
          siteId: 'test-site',
        },
      })

      expect(plugin).toBeDefined()
      expect(typeof plugin).toBe('function')
    })

    it('should return config with analytics endpoints when enabled', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        enabled: true,
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.endpoints).toBeDefined()
      expect(modifiedConfig.endpoints).toHaveLength(2)
      // Payload mounts endpoint paths under /api
      expect(modifiedConfig.endpoints?.map(endpoint => endpoint.path)).toEqual([
        '/analytics/dashboard',
        '/analytics/collection',
      ])
    })

    it('should not add endpoints when disabled', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        enabled: false,
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.endpoints).toBeUndefined()
    })

    it('should add admin components when dashboard is enabled', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        enableDashboard: true,
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.views).toBeDefined()
      expect(modifiedConfig.admin?.components?.views?.analytics).toBeDefined()
    })

    it('should not add admin components when dashboard is disabled', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        enableDashboard: false,
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.views?.analytics).toBeUndefined()
    })

    it('should respect custom dashboard path', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        dashboardPath: '/custom-analytics',
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.views?.analytics).toBeDefined()
      expect(modifiedConfig.admin?.components?.views?.analytics?.path).toBe('/custom-analytics')
    })
  })

  describe('provider configuration', () => {
    it('should initialize Plausible provider', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        plausible: {
          apiKey: 'test-key',
          siteId: 'test-site',
        },
      })

      const config = createMockConfig()
      plugin(config)

      expect(analyticsGlobal.__analyticsProvider).toBeDefined()
      expect(analyticsGlobal.__analyticsProvider?.name).toBe('plausible')
    })

    it('should initialize Umami provider', () => {
      const plugin = analyticsPlugin({
        provider: 'umami',
        umami: {
          apiKey: 'test-key',
          siteId: 'test-site',
          apiHost: 'https://umami.example.com',
        },
      })

      const config = createMockConfig()
      plugin(config)

      expect(analyticsGlobal.__analyticsProvider).toBeDefined()
      expect(analyticsGlobal.__analyticsProvider?.name).toBe('umami')
    })

    it('should initialize Matomo provider', () => {
      const plugin = analyticsPlugin({
        provider: 'matomo',
        matomo: {
          apiToken: 'test-token',
          siteId: '1',
          apiHost: 'https://matomo.example.com',
        },
      })

      const config = createMockConfig()
      plugin(config)

      expect(analyticsGlobal.__analyticsProvider).toBeDefined()
      expect(analyticsGlobal.__analyticsProvider?.name).toBe('matomo')
    })

    it('should initialize PostHog provider', () => {
      const plugin = analyticsPlugin({
        provider: 'posthog',
        posthog: {
          apiKey: 'test-key',
          projectId: 'test-project',
        },
      })

      const config = createMockConfig()
      plugin(config)

      expect(analyticsGlobal.__analyticsProvider).toBeDefined()
      expect(analyticsGlobal.__analyticsProvider?.name).toBe('posthog')
    })

    it('should initialize Google Analytics provider', () => {
      const plugin = analyticsPlugin({
        provider: 'google-analytics',
        googleAnalytics: {
          propertyId: '123456789',
          apiKey: 'test-key',
        },
      })

      const config = createMockConfig()
      plugin(config)

      expect(analyticsGlobal.__analyticsProvider).toBeDefined()
      expect(analyticsGlobal.__analyticsProvider?.name).toBe('google-analytics')
    })

    it('should accept custom provider instance', () => {
      const customProvider = createMockProvider('custom')
      
      const plugin = analyticsPlugin({
        provider: customProvider,
      })

      const config = createMockConfig()
      plugin(config)

      expect(analyticsGlobal.__analyticsProvider).toBe(customProvider)
    })
  })

  describe('dashboard widget configuration', () => {
    it('should add widget to afterDashboard by default', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        dashboardWidget: true,
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.afterDashboard).toHaveLength(1)
      expect(modifiedConfig.admin?.components?.beforeDashboard).toBeUndefined()
    })

    it('should add widget to beforeDashboard when configured', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        dashboardWidget: {
          enabled: true,
          position: 'beforeDashboard',
        },
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.beforeDashboard).toHaveLength(1)
      expect(modifiedConfig.admin?.components?.afterDashboard).toBeUndefined()
    })

    it('should not add widget when disabled', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        dashboardWidget: false,
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.afterDashboard).toBeUndefined()
      expect(modifiedConfig.admin?.components?.beforeDashboard).toBeUndefined()
    })
  })

  describe('navigation configuration', () => {
    it('should add navigation link to afterNavLinks by default', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        analyticsView: true,
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.afterNavLinks).toHaveLength(1)
      expect(modifiedConfig.admin?.components?.beforeNavLinks).toBeUndefined()
    })

    it('should add navigation link to beforeNavLinks when configured', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        analyticsView: {
          enabled: true,
          position: 'beforeNavLinks',
        },
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.beforeNavLinks).toHaveLength(1)
      expect(modifiedConfig.admin?.components?.afterNavLinks).toBeUndefined()
    })

    it('should not add navigation when customNavigation is false', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        customNavigation: false,
        analyticsView: true,
      })

      const config = createMockConfig()
      const modifiedConfig = plugin(config)

      expect(modifiedConfig.admin?.components?.afterNavLinks).toBeUndefined()
      expect(modifiedConfig.admin?.components?.beforeNavLinks).toBeUndefined()
    })
  })

  describe('config validation', () => {
    it('should store configuration in global scope', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
        timePeriods: ['day', '7d', '30d'],
        defaultTimePeriod: '30d',
        enableComparison: false,
      })

      const config = createMockConfig()
      plugin(config)

      expect(analyticsGlobal.__analyticsTimePeriods).toEqual(['day', '7d', '30d'])
      expect(analyticsGlobal.__analyticsDefaultTimePeriod).toBe('30d')
      expect(analyticsGlobal.__analyticsEnableComparison).toBe(false)
    })

    it('should use default values when not specified', () => {
      const plugin = analyticsPlugin({
        provider: 'plausible',
      })

      const config = createMockConfig()
      plugin(config)

      expect(analyticsGlobal.__analyticsProvider).toBeDefined()
      expect(analyticsGlobal.__analyticsDefaultTimePeriod).toBe('7d')
      expect(analyticsGlobal.__analyticsEnableComparison).toBe(true)
    })
  })

  describe('environment variable support', () => {
    it('should initialize provider using environment variables', () => {
      process.env.PLAUSIBLE_API_KEY = 'env-key'
      process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN = 'env-site.com'

      try {
        const plugin = analyticsPlugin({
          provider: 'plausible',
        })

        const config = createMockConfig()
        plugin(config)

        expect(analyticsGlobal.__analyticsProvider).toBeDefined()
        expect(analyticsGlobal.__analyticsProvider?.name).toBe('plausible')
      } finally {
        delete process.env.PLAUSIBLE_API_KEY
        delete process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN
      }
    })
  })
  describe('provider config patterns', () => {
    it('should read connection details from config in the new pattern', () => {
      analyticsPlugin({
        provider: 'umami',
        config: { siteId: 'site-1', apiHost: 'https://umami.example.com' },
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsProvider?.name).toBe('umami')
      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBe('https://umami.example.com/websites/site-1')
    })

    it('should treat an undefined config as empty', () => {
      analyticsPlugin({ provider: 'plausible', config: undefined })(createMockConfig())

      expect(analyticsGlobal.__analyticsProvider?.name).toBe('plausible')
      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBeUndefined()
    })

    it('should ignore another provider\'s legacy block', () => {
      analyticsPlugin({
        provider: 'plausible',
        umami: { siteId: 'site-1', apiHost: 'https://umami.example.com' },
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBeUndefined()
    })

    it.each(['plausible', 'umami', 'matomo', 'posthog', 'google-analytics'] as const)(
      'should create the %s provider with no connection block at all',
      provider => {
        analyticsPlugin({ provider })(createMockConfig())

        expect(analyticsGlobal.__analyticsProvider?.name).toBe(provider)
        expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBeUndefined()
      },
    )

    it('should throw on an unknown provider name', () => {
      const unknownProvider: string = 'segment'
      const plugin = analyticsPlugin({
        provider: unknownProvider as LegacyAnalyticsPluginConfig['provider'],
      })

      expect(() => plugin(createMockConfig())).toThrow('Unknown analytics provider: segment')
    })

    it('should return the incoming config untouched when disabled', () => {
      const config = createMockConfig()

      expect(analyticsPlugin({ provider: 'plausible', enabled: false })(config)).toBe(config)
      expect(analyticsGlobal.__analyticsProvider).toBeUndefined()
    })
  })

  describe('external dashboard link', () => {
    beforeEach(() => {
      delete analyticsGlobal.__analyticsExternalDashboardUrl
      delete analyticsGlobal.__analyticsExternalDashboardLinkText
    })

    it('should build the Plausible dashboard URL from apiHost and siteId', () => {
      analyticsPlugin({
        provider: 'plausible',
        plausible: { siteId: 'example.com', apiHost: 'https://plausible.io' },
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBe('https://plausible.io/example.com')
      expect(analyticsGlobal.__analyticsExternalDashboardLinkText).toBe('View in Plausible')
    })

    it('should build the Umami dashboard URL from apiHost and siteId', () => {
      analyticsPlugin({
        provider: 'umami',
        umami: { siteId: 'site-1', apiHost: 'https://umami.example.com' },
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBe('https://umami.example.com/websites/site-1')
      expect(analyticsGlobal.__analyticsExternalDashboardLinkText).toBe('View in Umami')
    })

    it('should build the Matomo dashboard URL from apiHost and siteId', () => {
      analyticsPlugin({
        provider: 'matomo',
        matomo: { siteId: '3', apiHost: 'https://matomo.example.com' },
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBe(
        'https://matomo.example.com/index.php?module=CoreHome&action=index&idSite=3&period=day&date=today',
      )
      expect(analyticsGlobal.__analyticsExternalDashboardLinkText).toBe('View in Matomo')
    })

    it('should build the PostHog dashboard URL from apiHost and projectId', () => {
      analyticsPlugin({
        provider: 'posthog',
        posthog: { projectId: '42', apiHost: 'https://eu.posthog.com' },
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBe('https://eu.posthog.com/project/42/dashboard')
      expect(analyticsGlobal.__analyticsExternalDashboardLinkText).toBe('View in Posthog')
    })

    it('should build the Google Analytics report URL from propertyId alone', () => {
      analyticsPlugin({
        provider: 'google-analytics',
        googleAnalytics: { propertyId: '123456789' },
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBe(
        'https://analytics.google.com/analytics/web/#/report-home/a123456789',
      )
      // Hyphens become spaces; only the first letter is capitalized
      expect(analyticsGlobal.__analyticsExternalDashboardLinkText).toBe('View in Google analytics')
    })

    it.each([
      ['plausible', { plausible: { siteId: 'example.com' } }],
      ['umami', { umami: { siteId: 'site-1' } }],
      ['matomo', { matomo: { siteId: '3' } }],
      ['posthog', { posthog: { projectId: '42' } }],
      ['google-analytics', { googleAnalytics: {} }],
    ] as const)('should leave the %s URL unset when a connection detail is missing', (provider, legacyBlock) => {
      analyticsPlugin({ provider, ...legacyBlock })(createMockConfig())

      expect(analyticsGlobal.__analyticsProvider?.name).toBe(provider)
      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBeUndefined()
    })

    it('should prefer an explicit URL and link text over the generated ones', () => {
      analyticsPlugin({
        provider: 'plausible',
        plausible: { siteId: 'example.com', apiHost: 'https://plausible.io' },
        externalDashboardUrl: 'https://stats.example.com',
        externalDashboardLinkText: 'Open stats',
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBe('https://stats.example.com')
      expect(analyticsGlobal.__analyticsExternalDashboardLinkText).toBe('Open stats')
    })

    it('should use a generic link and no URL for a custom provider instance', () => {
      const customProvider = createMockProvider('custom')

      analyticsPlugin({ provider: customProvider })(createMockConfig())

      expect(analyticsGlobal.__analyticsProviderName).toBe('custom')
      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBeUndefined()
      expect(analyticsGlobal.__analyticsExternalDashboardLinkText).toBe('View in Dashboard')
    })

    it('should keep an explicit URL for a custom provider instance', () => {
      analyticsPlugin({
        provider: createMockProvider('custom'),
        externalDashboardUrl: 'https://custom.example.com',
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsExternalDashboardUrl).toBe('https://custom.example.com')
    })
  })

  describe('global settings', () => {
    it('should store the display settings for the admin components', () => {
      analyticsPlugin({
        provider: 'plausible',
        useGenericIcon: true,
        comparisonOptions: ['previousPeriod'],
        dashboardPath: '/stats',
        showExternalLink: false,
      })(createMockConfig())

      expect(analyticsGlobal.__analyticsProviderName).toBe('plausible')
      expect(analyticsGlobal.__analyticsUseGenericIcon).toBe(true)
      expect(analyticsGlobal.__analyticsComparisonOptions).toEqual(['previousPeriod'])
      expect(analyticsGlobal.__analyticsDashboardPath).toBe('/stats')
      expect(analyticsGlobal.__analyticsShowExternalLink).toBe(false)
      expect(analyticsGlobal.__adminRoute).toBe('/admin')
    })

    it('should store the defaults for the display settings', () => {
      analyticsPlugin({ provider: 'plausible' })(createMockConfig())

      expect(analyticsGlobal.__analyticsUseGenericIcon).toBe(false)
      expect(analyticsGlobal.__analyticsComparisonOptions).toEqual(DEFAULT_COMPARISON_OPTIONS)
      expect(analyticsGlobal.__analyticsDashboardPath).toBe('/analytics')
      expect(analyticsGlobal.__analyticsShowExternalLink).toBe(true)
    })
  })

  describe('existing admin config', () => {
    it('should append the plugin components after the ones already configured', () => {
      const existingEndpoint = { path: '/health', method: 'get' as const, handler: () => Response.json({ ok: true }) }
      const config = createMockConfig({
        admin: {
          components: {
            afterDashboard: ['./components/Existing#AfterDashboard'],
            afterNavLinks: ['./components/Existing#AfterNav'],
            views: { reports: { Component: './components/Reports', path: '/reports' } },
          },
        },
        endpoints: [existingEndpoint],
      })

      const modifiedConfig = analyticsPlugin({ provider: 'plausible' })(config)

      expect(modifiedConfig.admin?.components?.afterDashboard).toEqual([
        './components/Existing#AfterDashboard',
        'payload-analytics-plugin/components/AnalyticsWidget',
      ])
      expect(modifiedConfig.admin?.components?.afterNavLinks).toEqual([
        './components/Existing#AfterNav',
        'payload-analytics-plugin/components/AfterNavLinks',
      ])
      expect(modifiedConfig.admin?.components?.views).toEqual({
        reports: { Component: './components/Reports', path: '/reports' },
        analytics: { Component: 'payload-analytics-plugin/components/AnalyticsView', path: '/analytics' },
      })
      expect(modifiedConfig.endpoints?.map(endpoint => endpoint.path)).toEqual([
        '/health',
        '/analytics/dashboard',
        '/analytics/collection',
      ])
    })

    it('should append to existing beforeDashboard and beforeNavLinks entries', () => {
      const config = createMockConfig({
        admin: {
          components: {
            beforeDashboard: ['./components/Existing#BeforeDashboard'],
            beforeNavLinks: ['./components/Existing#BeforeNav'],
          },
        },
      })

      const modifiedConfig = analyticsPlugin({
        provider: 'plausible',
        dashboardWidget: { enabled: true, position: 'beforeDashboard' },
        analyticsView: { enabled: true, position: 'beforeNavLinks' },
      })(config)

      expect(modifiedConfig.admin?.components?.beforeDashboard).toEqual([
        './components/Existing#BeforeDashboard',
        'payload-analytics-plugin/components/AnalyticsWidget',
      ])
      expect(modifiedConfig.admin?.components?.beforeNavLinks).toEqual([
        './components/Existing#BeforeNav',
        'payload-analytics-plugin/components/AfterNavLinks',
      ])
    })

    it('should not add the navigation link when analyticsView is false or disabled', () => {
      const viaBoolean = analyticsPlugin({ provider: 'plausible', analyticsView: false })(createMockConfig())
      const viaObject = analyticsPlugin({
        provider: 'plausible',
        analyticsView: { enabled: false, position: 'afterNavLinks' },
      })(createMockConfig())

      for (const modifiedConfig of [viaBoolean, viaObject]) {
        expect(modifiedConfig.admin?.components?.afterNavLinks).toBeUndefined()
        expect(modifiedConfig.admin?.components?.beforeNavLinks).toBeUndefined()
      }
    })

    it('should not add the widget when the widget object is disabled', () => {
      const modifiedConfig = analyticsPlugin({
        provider: 'plausible',
        dashboardWidget: { enabled: false, position: 'beforeDashboard' },
      })(createMockConfig())

      expect(modifiedConfig.admin?.components?.beforeDashboard).toBeUndefined()
      expect(modifiedConfig.admin?.components?.afterDashboard).toBeUndefined()
    })
  })

  describe('collection analytics', () => {
    it('should leave collections without analytics config untouched', () => {
      const posts = createCollection('posts', [titleField])
      const pages = createCollection('pages', [titleField])

      const modifiedConfig = analyticsPlugin({
        provider: 'plausible',
        collections: { pages: { enabled: false, rootPath: '/' } },
      })(createMockConfig({ collections: [posts, pages] }))

      expect(modifiedConfig.collections?.[0]).toBe(posts)
      expect(modifiedConfig.collections?.[1]).toBe(pages)
    })

    it('should wrap untabbed fields in Content and Analytics tabs by default', () => {
      const modifiedConfig = analyticsPlugin({
        provider: 'plausible',
        collections: { posts: { enabled: true, rootPath: '/blog' } },
      })(createMockConfig({ collections: [createCollection('posts', [titleField, bodyField])] }))

      const fields = modifiedConfig.collections?.[0].fields
      expect(fields).toHaveLength(1)
      const tabs = asTabs(fields?.[0]).tabs
      expect(tabs.map(tab => tab.label)).toEqual(['Content', 'Analytics'])
      expect(tabs[0].fields).toEqual([titleField, bodyField])
      expect(tabs[1].fields).toHaveLength(1)
      expectAnalyticsGroup(tabs[1].fields[0], '/blog')
    })

    it('should add an Analytics tab to an existing leading tabs field and keep the fields after it', () => {
      const existingTabs: TabsField = {
        type: 'tabs',
        tabs: [{ label: 'Main', fields: [titleField] }],
      }
      const sidebarField: Field = { name: 'publishedAt', type: 'date' }

      const modifiedConfig = analyticsPlugin({
        provider: 'plausible',
        collections: { posts: { enabled: true, rootPath: '/blog', tabbedUI: true } },
      })(createMockConfig({ collections: [createCollection('posts', [existingTabs, sidebarField])] }))

      const fields = modifiedConfig.collections?.[0].fields
      expect(fields).toHaveLength(2)
      const tabs = asTabs(fields?.[0]).tabs
      expect(tabs.map(tab => tab.label)).toEqual(['Main', 'Analytics'])
      expect(tabs[0].fields).toEqual([titleField])
      expectAnalyticsGroup(tabs[1].fields[0], '/blog')
      expect(fields?.[1]).toBe(sidebarField)
    })

    it('should append the analytics group after the fields when tabbedUI is false', () => {
      const modifiedConfig = analyticsPlugin({
        provider: 'plausible',
        collections: { posts: { enabled: true, rootPath: '/blog', tabbedUI: false } },
      })(createMockConfig({ collections: [createCollection('posts', [titleField, bodyField])] }))

      const fields = modifiedConfig.collections?.[0].fields
      expect(fields).toHaveLength(3)
      expect(fields?.slice(0, 2)).toEqual([titleField, bodyField])
      expectAnalyticsGroup(fields?.[2], '/blog')
    })

    it('should use the fields returned by a collection fields customizer', () => {
      const extraField: Field = { name: 'trafficNotes', type: 'text' }

      const modifiedConfig = analyticsPlugin({
        provider: 'plausible',
        collections: {
          posts: {
            enabled: true,
            rootPath: '/blog',
            tabbedUI: false,
            fields: ({ defaultFields }) => [...defaultFields, extraField],
          },
        },
      })(createMockConfig({ collections: [createCollection('posts', [titleField])] }))

      const fields = modifiedConfig.collections?.[0].fields
      expect(fields).toHaveLength(3)
      expectAnalyticsGroup(fields?.[1], '/blog')
      expect(fields?.[2]).toBe(extraField)
    })

    it('should leave collections undefined when the config has none', () => {
      const modifiedConfig = analyticsPlugin({
        provider: 'plausible',
        collections: { posts: { enabled: true, rootPath: '/blog' } },
      })(createMockConfig({ collections: undefined }))

      expect(modifiedConfig.collections).toBeUndefined()
    })
  })
})