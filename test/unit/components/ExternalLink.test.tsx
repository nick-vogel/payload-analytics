import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExternalLink } from '@/components/ExternalLink'

describe('ExternalLink', () => {
  it('should open the href in a new tab without leaking the opener', () => {
    render(<ExternalLink href="https://plausible.io/example.com" text="View in Plausible" />)

    const link = screen.getByRole('link', { name: 'View in Plausible' })
    expect(link).toHaveAttribute('href', 'https://plausible.io/example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('should render the link text followed by the external-link icon', () => {
    render(<ExternalLink href="https://example.com" text="Open dashboard" />)

    const link = screen.getByRole('link', { name: 'Open dashboard' })
    expect(link).toHaveTextContent('Open dashboard')
    const icon = link.querySelector('svg.analytics-external-link-icon')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveAttribute('viewBox', '0 0 16 16')
    expect(link.lastElementChild).toBe(icon)
  })

  it('should use only the base class when no className is given', () => {
    render(<ExternalLink href="https://example.com" text="Open" />)

    expect(screen.getByRole('link', { name: 'Open' }).className.trim()).toBe('analytics-external-link')
  })

  it('should append a custom className to the base class', () => {
    render(<ExternalLink href="https://example.com" text="Open" className="header-link" />)

    const link = screen.getByRole('link', { name: 'Open' })
    expect(link).toHaveClass('analytics-external-link')
    expect(link).toHaveClass('header-link')
  })
})
