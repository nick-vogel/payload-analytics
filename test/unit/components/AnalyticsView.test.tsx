import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { SetStepNav } from '@payloadcms/ui'
import type { AdminViewServerProps } from 'payload'
import { AnalyticsView } from '@/components/AnalyticsView'
import type { TimePeriod } from '@/types'

// The admin template and Payload UI pieces are server/admin-only; stand them in with
// spies that render their children so the view's own output can be asserted.
vi.mock('@payloadcms/next/templates', () => ({
  DefaultTemplate: vi.fn(({ children }: { children?: React.ReactNode }) => (
    <div data-testid="default-template">{children}</div>
  )),
}))

vi.mock('@payloadcms/ui', () => ({
  Gutter: ({ children }: { children?: React.ReactNode }) => <div className="gutter">{children}</div>,
  SetStepNav: vi.fn(() => null),
}))

vi.mock('@/components/AnalyticsClient', () => ({
  AnalyticsClient: () => <div data-testid="analytics-client" />,
}))

// Values the plugin stores on the Node global in src/index.ts
type AnalyticsViewGlobal = typeof globalThis & {
  __analyticsTimePeriods?: TimePeriod[]
  __analyticsDefaultTimePeriod?: TimePeriod
  __analyticsEnableComparison?: boolean
  __analyticsDashboardPath?: string
  __analyticsExternalDashboardUrl?: string
  __analyticsExternalDashboardLinkText?: string
  __analyticsShowExternalLink?: boolean
}

const analyticsGlobal = globalThis as AnalyticsViewGlobal

const GLOBAL_KEYS = [
  '__analyticsTimePeriods',
  '__analyticsDefaultTimePeriod',
  '__analyticsEnableComparison',
  '__analyticsDashboardPath',
  '__analyticsExternalDashboardUrl',
  '__analyticsExternalDashboardLinkText',
  '__analyticsShowExternalLink',
] as const

const adminUser = { id: 1, email: 'editor@example.com', collection: 'users' }
const i18n = { language: 'en' }
const payload = { config: { routes: { admin: '/admin' } } }
const permissions = { canAccessAdmin: true }
const visibleEntities = { collections: ['posts'], globals: [] }
const locale = { code: 'en', label: 'English' }
const params = { segments: ['analytics'] }
const searchParams = { tab: 'overview' }

// AdminViewServerProps carries the whole Payload config, import map and request. The view
// reads only initPageResult (req.user, req.i18n, req.payload, locale, permissions,
// visibleEntities), params and searchParams, so the fixture supplies just those.
const createViewProps = (user: typeof adminUser | null): AdminViewServerProps =>
  ({
    initPageResult: {
      req: { user, i18n, payload },
      locale,
      permissions,
      visibleEntities,
    },
    params,
    searchParams,
  }) as unknown as AdminViewServerProps

// AnalyticsView is a React server component: call it and render the element it returns
const renderView = async (user: typeof adminUser | null = adminUser) =>
  render(<>{await AnalyticsView(createViewProps(user))}</>)

const templateProps = () => vi.mocked(DefaultTemplate).mock.lastCall?.[0]

const handoffScript = (container: HTMLElement) => container.querySelector('script')?.innerHTML ?? ''

describe('AnalyticsView', () => {
  afterEach(() => {
    GLOBAL_KEYS.forEach((key) => {
      delete analyticsGlobal[key]
    })
  })

  describe('without a logged-in user', () => {
    it('should render the unauthorized message instead of the dashboard', async () => {
      await renderView(null)

      expect(screen.getByRole('heading', { name: 'Unauthorized' })).toBeInTheDocument()
      expect(screen.getByText('You must be logged in to view this page.')).toBeInTheDocument()
      expect(screen.queryByTestId('analytics-client')).not.toBeInTheDocument()
      expect(SetStepNav).not.toHaveBeenCalled()
    })

    it('should still wrap the message in the admin template with no user', async () => {
      await renderView(null)

      expect(templateProps()).toMatchObject({
        i18n,
        locale,
        params,
        payload,
        permissions,
        searchParams,
        visibleEntities,
        user: undefined,
      })
    })
  })

  describe('with a logged-in user', () => {
    it('should render the dashboard heading and the client inside the admin template', async () => {
      await renderView()

      const template = screen.getByTestId('default-template')
      expect(screen.getByRole('heading', { name: 'Analytics Dashboard' })).toBeInTheDocument()
      expect(template).toContainElement(screen.getByTestId('analytics-client'))
      expect(templateProps()).toMatchObject({
        i18n,
        locale,
        params,
        payload,
        permissions,
        searchParams,
        visibleEntities,
        user: adminUser,
      })
    })

    it('should set the breadcrumb to the default dashboard path', async () => {
      await renderView()

      expect(vi.mocked(SetStepNav).mock.lastCall?.[0]).toEqual({
        nav: [{ url: '/admin/analytics', label: 'Analytics' }],
      })
    })

    it('should set the breadcrumb to a configured dashboard path', async () => {
      analyticsGlobal.__analyticsDashboardPath = '/traffic'

      await renderView()

      expect(vi.mocked(SetStepNav).mock.lastCall?.[0]).toEqual({
        nav: [{ url: '/admin/traffic', label: 'Analytics' }],
      })
    })

    it('should hand the plugin config to the client through window globals', async () => {
      Object.assign(analyticsGlobal, {
        __analyticsTimePeriods: ['day', '7d', '30d'],
        __analyticsDefaultTimePeriod: '30d',
        __analyticsEnableComparison: true,
        __analyticsExternalDashboardUrl: 'https://plausible.io/example.com',
        __analyticsExternalDashboardLinkText: 'Open Plausible',
        __analyticsShowExternalLink: true,
      })

      const { container } = await renderView()

      const script = handoffScript(container)
      expect(script).toContain('window.__analyticsTimePeriods = ["day","7d","30d"];')
      expect(script).toContain('window.__analyticsDefaultTimePeriod = "30d";')
      expect(script).toContain('window.__analyticsEnableComparison = true;')
      expect(script).toContain('window.__analyticsExternalDashboardUrl = "https://plausible.io/example.com";')
      expect(script).toContain('window.__analyticsExternalDashboardLinkText = "Open Plausible";')
      expect(script).toContain('window.__analyticsShowExternalLink = true;')
    })

    it('should hand over undefined for config the plugin did not set', async () => {
      const { container } = await renderView()

      const script = handoffScript(container)
      expect(script).toContain('window.__analyticsTimePeriods = undefined;')
      expect(script).toContain('window.__analyticsEnableComparison = undefined;')
    })

    it('should link to the external dashboard with the default text when enabled', async () => {
      analyticsGlobal.__analyticsShowExternalLink = true
      analyticsGlobal.__analyticsExternalDashboardUrl = 'https://plausible.io/example.com'

      await renderView()

      const link = screen.getByRole('link', { name: 'View in Dashboard' })
      expect(link).toHaveAttribute('href', 'https://plausible.io/example.com')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveClass('analytics-view-external-link')
    })

    it('should use the configured external link text', async () => {
      analyticsGlobal.__analyticsShowExternalLink = true
      analyticsGlobal.__analyticsExternalDashboardUrl = 'https://umami.example.com/websites/1'
      analyticsGlobal.__analyticsExternalDashboardLinkText = 'Open in Umami'

      await renderView()

      expect(screen.getByRole('link', { name: 'Open in Umami' })).toHaveAttribute(
        'href',
        'https://umami.example.com/websites/1',
      )
    })

    it('should hide the external link when it is switched off', async () => {
      analyticsGlobal.__analyticsShowExternalLink = false
      analyticsGlobal.__analyticsExternalDashboardUrl = 'https://plausible.io/example.com'

      await renderView()

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('should hide the external link when no dashboard URL is configured', async () => {
      analyticsGlobal.__analyticsShowExternalLink = true

      await renderView()

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })
})
