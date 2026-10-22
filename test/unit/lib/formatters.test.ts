import { describe, it, expect } from 'vitest'
import { formatNumber, formatDuration } from '@/lib/formatters'

describe('formatNumber', () => {
  it('should format numbers with K/M suffixes', () => {
    expect(formatNumber(1000)).toBe('1.0K')
    expect(formatNumber(1234567)).toBe('1.2M')
    expect(formatNumber(0)).toBe('0')
  })

  it('should handle negative numbers', () => {
    expect(formatNumber(-1000)).toBe('-1000')
    expect(formatNumber(-1234567)).toBe('-1234567')
  })

  it('should handle decimal numbers', () => {
    expect(formatNumber(1234.56)).toBe('1.2K')
    expect(formatNumber(999.99)).toBe('999.99')
  })

  it('should handle very large numbers', () => {
    expect(formatNumber(1000000000)).toBe('1000.0M')
  })

  it('should handle edge cases', () => {
    expect(formatNumber(NaN)).toBe('NaN')
    expect(formatNumber(-Infinity)).toBe('-Infinity')
  })

  it('should render positive Infinity without a suffix', () => {
    expect(formatNumber(Infinity)).toBe('Infinity')
  })
})

describe('formatDuration', () => {
  it('should format seconds correctly', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(30)).toBe('30s')
    expect(formatDuration(59)).toBe('59s')
  })

  it('should format minutes and seconds', () => {
    expect(formatDuration(60)).toBe('1m')
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(120)).toBe('2m')
    expect(formatDuration(155)).toBe('2m 35s')
  })

  it('should format hours, minutes and seconds', () => {
    expect(formatDuration(3600)).toBe('60m')
    expect(formatDuration(3660)).toBe('61m')
    expect(formatDuration(3665)).toBe('61m 5s')
    expect(formatDuration(7200)).toBe('120m')
    expect(formatDuration(7325)).toBe('122m 5s')
  })

  it('should handle large durations', () => {
    expect(formatDuration(86400)).toBe('1440m') // 1 day
    expect(formatDuration(172800)).toBe('2880m') // 2 days
  })

  it('should handle edge cases', () => {
    expect(formatDuration(-60)).toBe('-60s') // Negative duration
    expect(formatDuration(NaN)).toBe('NaNm')
    expect(formatDuration(Infinity)).toBe('Infinitym')
  })
})