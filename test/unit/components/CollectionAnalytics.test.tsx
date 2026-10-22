import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CollectionAnalytics } from '@/components/CollectionAnalytics'
import type { DashboardData } from '@/types'

// The Payload client config, if something has exposed it on window
type PayloadConfigTestWindow = Window & {
  __payloadConfig?: { routes?: { api?: string } }
}

const createPageStats = (overrides?: Partial<NonNullable<DashboardData['stats']>>): DashboardData => ({
  stats: {
    visitors: { value: 1234, change: null },
    pageviews: { value: 5678, change: null },
    bounce_rate: { value: 45.2, change: null },
    visit_duration: { value: 185, change: null },
    ...overrides,
  },
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const fetchMock = vi.fn<typeof fetch>()

const EMPTY_MESSAGE = 'No analytics data available for this page yet.'

const collectionStyles = () =>
  Array.from(document.head.querySelectorAll('style')).filter((style) =>
    style.textContent?.includes('.collection-analytics-grid'),
  )

describe('CollectionAnalytics', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonResponse(createPageStats()))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (window as PayloadConfigTestWindow).__payloadConfig
  })

  it('should show the loading overlay before the request resolves', () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))

    const { container } = render(
      <CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />,
    )

    expect(container.querySelector('.payload__loading-overlay')).toBeInTheDocument()
    expect(screen.queryByText('Visitors')).not.toBeInTheDocument()
  })

  it('should request stats for the document path under the root path', async () => {
    render(<CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />)

    await screen.findByText('Visitors')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/collection?path=%2Fblog%2Fhello-world', {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('should collapse repeated slashes when the root path is /', async () => {
    render(<CollectionAnalytics collectionSlug="pages" documentSlug="about" rootPath="/" />)

    await screen.findByText('Visitors')
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/collection?path=%2Fabout', expect.anything())
  })

  it('should use the API route from the exposed Payload config', async () => {
    ;(window as PayloadConfigTestWindow).__payloadConfig = { routes: { api: '/cms-api' } }

    render(<CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog/" />)

    await screen.findByText('Visitors')
    expect(fetchMock).toHaveBeenCalledWith(
      '/cms-api/analytics/collection?path=%2Fblog%2Fhello-world',
      expect.anything(),
    )
  })

  it('should render the four stat cards with formatted values', async () => {
    const { container } = render(
      <CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />,
    )

    expect(await screen.findByText('1.2K')).toBeInTheDocument()
    expect(screen.getByText('5.7K')).toBeInTheDocument()
    expect(screen.getByText('45%')).toBeInTheDocument()
    expect(screen.getByText('3m 5s')).toBeInTheDocument()

    const labels = Array.from(container.querySelectorAll('.collection-analytics-label')).map((el) => el.textContent)
    expect(labels).toEqual(['Visitors', 'Pageviews', 'Bounce Rate', 'Avg Duration'])
    expect(screen.getAllByText('Last 30 days')).toHaveLength(4)
  })

  it('should show stats when only pageviews are above zero', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(createPageStats({ visitors: { value: 0, change: null }, pageviews: { value: 12, change: null } })),
    )

    render(<CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />)

    expect(await screen.findByText('12')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('should fall back to zero for metrics missing from the response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ stats: { visitors: { value: 7 } } }))

    const { container } = render(
      <CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />,
    )

    await screen.findByText('7')
    const values = Array.from(container.querySelectorAll('.collection-analytics-value')).map((el) => el.textContent)
    expect(values).toEqual(['7', '0', '0%', '0s'])
  })

  it('should show the empty state when the page has no visitors or pageviews', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(createPageStats({ visitors: { value: 0, change: null }, pageviews: { value: 0, change: null } })),
    )

    render(<CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />)

    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText('Visitors')).not.toBeInTheDocument()
  })

  it('should show the empty state when the response has no stats', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ pages: [] }))

    render(<CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />)

    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument()
  })

  it('should log and show the empty state when the API responds with an error status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401))

    render(<CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />)

    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith('Failed to fetch collection analytics:', expect.any(Error))
  })

  it('should log and show the empty state when the request fails', async () => {
    const networkError = new TypeError('Network down')
    fetchMock.mockRejectedValueOnce(networkError)

    render(<CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />)

    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith('Failed to fetch collection analytics:', networkError)
  })

  it('should not request anything when there is no document slug', async () => {
    render(<CollectionAnalytics collectionSlug="posts" documentSlug="" rootPath="/blog" />)

    expect(await screen.findByText(EMPTY_MESSAGE)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should refetch when the document slug changes', async () => {
    const { rerender } = render(
      <CollectionAnalytics collectionSlug="posts" documentSlug="first-post" rootPath="/blog" />,
    )
    await screen.findByText('Visitors')

    rerender(<CollectionAnalytics collectionSlug="posts" documentSlug="second-post" rootPath="/blog" />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/analytics/collection?path=%2Fblog%2Fsecond-post',
        expect.anything(),
      )
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('should inject its styles once and remove them on unmount', async () => {
    const { unmount } = render(
      <CollectionAnalytics collectionSlug="posts" documentSlug="hello-world" rootPath="/blog" />,
    )
    await screen.findByText('Visitors')
    expect(collectionStyles()).toHaveLength(1)

    unmount()

    expect(collectionStyles()).toHaveLength(0)
  })
})
