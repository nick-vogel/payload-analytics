import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AfterNavLinksClient } from '@/components/AfterNavLinksClient'

// A distinctive prefix of each provider icon's first <path d>
const BAR_CHART_PATH = 'M3 3v18h18v-2H5V3H3z'
const PROVIDER_PATH_PREFIXES: Array<[provider: string, prefix: string]> = [
  ['plausible', 'M12.1835'],
  ['umami', 'M2.203'],
  ['matomo', 'M6.664'],
  ['posthog', 'M10.8914'],
  ['google-analytics', 'M22.84'],
]

const renderLink = (props: Partial<React.ComponentProps<typeof AfterNavLinksClient>> = {}) =>
  render(
    <AfterNavLinksClient provider="plausible" dashboardPath="/analytics" adminRoute="/admin" {...props} />,
  )

const getAnalyticsLink = () => screen.getByRole('link', { name: 'Analytics' })

const iconPath = () => getAnalyticsLink().querySelector('svg path')?.getAttribute('d') ?? ''

const injectedHideStyles = () =>
  Array.from(document.head.querySelectorAll('style')).filter((style) =>
    style.textContent?.includes(':not(.custom-analytics-link)'),
  )

describe('AfterNavLinksClient', () => {
  it('should link to the dashboard under the admin route', () => {
    renderLink({ adminRoute: '/cms', dashboardPath: '/stats' })

    const link = getAnalyticsLink()
    expect(link).toHaveAttribute('href', '/cms/stats')
    expect(link).toHaveAttribute('id', 'nav-analytics')
    expect(link).toHaveClass('nav__link', 'custom-analytics-link')
    expect(screen.getByText('Analytics')).toHaveClass('nav__link-label')
  })

  it.each(PROVIDER_PATH_PREFIXES)('should render the %s brand icon', (provider, prefix) => {
    renderLink({ provider })

    expect(iconPath().startsWith(prefix)).toBe(true)
  })

  it('should use the wide viewBox for the PostHog logo', () => {
    renderLink({ provider: 'posthog' })

    expect(getAnalyticsLink().querySelector('svg')).toHaveAttribute('viewBox', '0 0 157 30')
  })

  it.each(['generic', 'some-unknown-provider'])('should fall back to the bar chart icon for %s', (provider) => {
    renderLink({ provider })

    expect(iconPath()).toContain(BAR_CHART_PATH)
  })

  it('should prefer the generic icon over the provider icon when useGenericIcon is set', () => {
    renderLink({ provider: 'plausible', useGenericIcon: true })

    expect(iconPath()).toContain(BAR_CHART_PATH)
    expect(iconPath().startsWith('M12.1835')).toBe(false)
  })

  it('should inject a style that hides the auto-generated nav item for the same href', () => {
    renderLink({ adminRoute: '/cms', dashboardPath: '/stats' })

    const styles = injectedHideStyles()
    expect(styles).toHaveLength(1)
    expect(styles[0].textContent).toContain('.nav-group a[href="/cms/stats"]:not(.custom-analytics-link)')
    expect(styles[0].textContent).toContain('display: none !important')
  })

  it('should remove the injected style on unmount', () => {
    const { unmount } = renderLink()
    expect(injectedHideStyles()).toHaveLength(1)

    unmount()

    expect(injectedHideStyles()).toHaveLength(0)
  })

  it('should replace the injected style when the dashboard path changes', () => {
    const { rerender } = renderLink({ dashboardPath: '/analytics' })

    rerender(<AfterNavLinksClient provider="plausible" dashboardPath="/traffic" adminRoute="/admin" />)

    const styles = injectedHideStyles()
    expect(styles).toHaveLength(1)
    expect(styles[0].textContent).toContain('a[href="/admin/traffic"]')
    expect(getAnalyticsLink()).toHaveAttribute('href', '/admin/traffic')
  })
})
