import { describe, it, expect } from 'vitest'
import {
  formatNumber,
  formatDuration,
  formatPercentage,
  formatChange,
  formatAxisDate,
  formatTooltipDate,
} from '@/lib/formatters'

// Local wall-clock timestamps (no Z), so the formatted day and hour do not shift with the runner's time zone
const MID_JANUARY_2PM = '2024-01-15T14:00:00'
const MID_MARCH_9AM = '2024-03-05T09:00:00'

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

describe('formatPercentage', () => {
  it('should round to a whole percent', () => {
    expect(formatPercentage(45.2)).toBe('45%')
    expect(formatPercentage(45.5)).toBe('46%')
    expect(formatPercentage(0)).toBe('0%')
    expect(formatPercentage(100)).toBe('100%')
  })
})

describe('formatChange', () => {
  it('should report no change as a neutral 0%', () => {
    expect(formatChange(null)).toEqual({ text: '0%', isPositive: false })
    expect(formatChange(0)).toEqual({ text: '0%', isPositive: false })
  })

  it('should prefix a rise with a plus sign and mark it positive', () => {
    expect(formatChange(12.5)).toEqual({ text: '+13%', isPositive: true })
    expect(formatChange(0.4)).toEqual({ text: '+0%', isPositive: true })
  })

  it('should keep the minus sign on a fall and mark it negative', () => {
    expect(formatChange(-5.3)).toEqual({ text: '-5%', isPositive: false })
    expect(formatChange(-100)).toEqual({ text: '-100%', isPositive: false })
  })
})

describe('formatAxisDate', () => {
  it('should show the hour for the day period', () => {
    expect(formatAxisDate(MID_JANUARY_2PM, 'day')).toMatch(/^2\sPM$/)
    expect(formatAxisDate(MID_MARCH_9AM, 'day')).toMatch(/^9\sAM$/)
  })

  it('should show the short month for 12mo, adding the year on January', () => {
    expect(formatAxisDate(MID_MARCH_9AM, '12mo')).toBe('Mar')
    expect(formatAxisDate(MID_JANUARY_2PM, '12mo')).toBe('Jan 24')
  })

  it('should show month and day without the year for 30d', () => {
    expect(formatAxisDate(MID_JANUARY_2PM, '30d')).toBe('1/15')
  })

  it('should show month, day and two-digit year for every other period', () => {
    expect(formatAxisDate(MID_JANUARY_2PM, '7d')).toBe('1/15/24')
    expect(formatAxisDate(MID_MARCH_9AM, '6mo')).toBe('3/5/24')
  })
})

describe('formatTooltipDate', () => {
  it('should include the hour for the day period', () => {
    expect(formatTooltipDate(MID_JANUARY_2PM, 'day')).toMatch(/^Jan 15, 2024 at 2\sPM$/)
  })

  it('should show the full date for every other period', () => {
    expect(formatTooltipDate(MID_JANUARY_2PM, '7d')).toBe('Jan 15, 2024')
    expect(formatTooltipDate(MID_MARCH_9AM, '12mo')).toBe('Mar 5, 2024')
  })
})
