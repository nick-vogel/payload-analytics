import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AnalyticsWidget } from '@/components/AnalyticsWidget'
import { createMockDashboardData } from '../../utils/test-helpers'

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

const fetchMock = vi.fn<typeof fetch>()

describe('AnalyticsWidget', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonResponse(createMockDashboardData()))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should render widget with analytics data', async () => {
    render(<AnalyticsWidget />)

    await waitFor(() => {
      // Check widget title
      expect(screen.getByText("Today's Analytics")).toBeInTheDocument()
      
      // Check stats
      expect(screen.getByText('Visitors')).toBeInTheDocument()
      expect(screen.getByText('1.2K')).toBeInTheDocument()
      
      expect(screen.getByText('Pageviews')).toBeInTheDocument()
      expect(screen.getByText('5.7K')).toBeInTheDocument()
      
      expect(screen.getByText('Bounce Rate')).toBeInTheDocument()
      expect(screen.getByText('45%')).toBeInTheDocument()
      
      expect(screen.getByText('Avg Duration')).toBeInTheDocument()
      expect(screen.getByText('3m')).toBeInTheDocument()
    })
  })

  it('should display nothing while loading', () => {
    render(<AnalyticsWidget />)
    expect(screen.queryByText("Today's Analytics")).not.toBeInTheDocument()
  })

  it('should handle error state by rendering nothing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('API Error'))

    const { container } = render(<AnalyticsWidget />)

    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('should not show link to full dashboard', async () => {
    render(<AnalyticsWidget />)

    await waitFor(() => {
      expect(screen.queryByText('View full dashboard →')).not.toBeInTheDocument()
    })
  })

  it('should fetch data for today period', async () => {
    render(<AnalyticsWidget />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/analytics/dashboard?period=day',
        expect.objectContaining({ credentials: 'same-origin' }),
      )
    })
  })

  it('should handle empty data by rendering nothing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null))

    const { container } = render(<AnalyticsWidget />)

    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('should display real-time visitors if available', async () => {
    render(<AnalyticsWidget />)

    await waitFor(() => {
      expect(screen.getByText('42 visitors online now')).toBeInTheDocument()
    })
  })

  it('should display zero real-time visitors if not available', async () => {
    // The live counter always renders (commit 6b47e7b), falling back to 0
    const dataWithoutRealtime = createMockDashboardData()
    delete dataWithoutRealtime.realtime

    fetchMock.mockResolvedValueOnce(jsonResponse(dataWithoutRealtime))

    render(<AnalyticsWidget />)

    await waitFor(() => {
      expect(screen.getByText('1.2K')).toBeInTheDocument()
    })

    expect(screen.getByText('0 visitors online now')).toBeInTheDocument()
    expect(screen.queryByText('42 visitors online now')).not.toBeInTheDocument()
  })
})