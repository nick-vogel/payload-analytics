import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AfterNavLinks } from '@/components/AfterNavLinksServer'

// Values the plugin stores on the Node global in src/index.ts
type AnalyticsNavGlobal = typeof globalThis & {
  __analyticsProviderName?: string
  __analyticsUseGenericIcon?: boolean
  __analyticsDashboardPath?: string
  __adminRoute?: string
}

const analyticsGlobal = globalThis as AnalyticsNavGlobal

// AfterNavLinks is a React server component: call it and render the element it returns
const renderServerComponent = async () => render(<>{await AfterNavLinks({})}</>)

const iconPath = () =>
  screen.getByRole('link', { name: 'Analytics' }).querySelector('svg path')?.getAttribute('d') ?? ''

describe('AfterNavLinks (server)', () => {
  afterEach(() => {
    delete analyticsGlobal.__analyticsProviderName
    delete analyticsGlobal.__analyticsUseGenericIcon
    delete analyticsGlobal.__analyticsDashboardPath
    delete analyticsGlobal.__adminRoute
  })

  it('should fall back to plausible at /admin/analytics when no globals are set', async () => {
    await renderServerComponent()

    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/admin/analytics')
    expect(iconPath().startsWith('M12.1835')).toBe(true)
  })

  it('should pass the configured provider, admin route and dashboard path to the client link', async () => {
    analyticsGlobal.__analyticsProviderName = 'umami'
    analyticsGlobal.__adminRoute = '/cms'
    analyticsGlobal.__analyticsDashboardPath = '/traffic'

    await renderServerComponent()

    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/cms/traffic')
    expect(iconPath().startsWith('M2.203')).toBe(true)
  })

  it('should pass the generic icon preference through', async () => {
    analyticsGlobal.__analyticsProviderName = 'matomo'
    analyticsGlobal.__analyticsUseGenericIcon = true

    await renderServerComponent()

    expect(iconPath()).toContain('M3 3v18h18v-2H5V3H3z')
  })
})
