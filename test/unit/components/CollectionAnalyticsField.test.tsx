import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useFormFields } from '@payloadcms/ui'
import type { FormState } from 'payload'
import { CollectionAnalyticsField } from '@/components/CollectionAnalyticsField'

vi.mock('@payloadcms/ui', () => ({
  useFormFields: vi.fn(),
}))

type FormFieldsSelector = Parameters<typeof useFormFields>[0]

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

const fetchMock = vi.fn<typeof fetch>()

// Run the component's selector against a form state, the way Payload's form context would
const mockFormState = (fields: FormState) => {
  vi.mocked(useFormFields).mockImplementation((selector: FormFieldsSelector) => selector([fields, () => {}]))
}

const pageStats = {
  stats: {
    visitors: { value: 42, change: null },
    pageviews: { value: 99, change: null },
    bounce_rate: { value: 30, change: null },
    visit_duration: { value: 45, change: null },
  },
}

describe('CollectionAnalyticsField', () => {
  const originalPath = window.location.pathname

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => jsonResponse(pageStats))
    vi.stubGlobal('fetch', fetchMock)
    window.history.pushState({}, '', '/admin/collections/posts/64f1c2')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.pushState({}, '', originalPath)
  })

  it('should fetch analytics for the document slug under the configured root path', async () => {
    mockFormState({ slug: { value: 'hello-world' } })

    render(<CollectionAnalyticsField custom={{ rootPath: '/blog' }} />)

    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/collection?path=%2Fblog%2Fhello-world', expect.anything())
  })

  it('should default the root path to / when none is configured', async () => {
    mockFormState({ slug: { value: 'about' } })

    render(<CollectionAnalyticsField />)

    await screen.findByText('42')
    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/collection?path=%2Fabout', expect.anything())
  })

  it('should render nothing while the document has no slug', () => {
    mockFormState({ title: { value: 'Untitled' } })

    const { container } = render(<CollectionAnalyticsField custom={{ rootPath: '/blog' }} />)

    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should render nothing outside an admin collection URL', () => {
    window.history.pushState({}, '', '/preview/posts/hello-world')
    mockFormState({ slug: { value: 'hello-world' } })

    const { container } = render(<CollectionAnalyticsField custom={{ rootPath: '/blog' }} />)

    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should render nothing on the admin root where no collection slug follows', () => {
    window.history.pushState({}, '', '/admin')
    mockFormState({ slug: { value: 'hello-world' } })

    const { container } = render(<CollectionAnalyticsField />)

    expect(container).toBeEmptyDOMElement()
  })
})
