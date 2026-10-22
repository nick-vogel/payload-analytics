export function formatNumber(num: number): string {
  if (!Number.isFinite(num)) {
    return num.toString()
  }
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`
  }
  return num.toString()
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

export function formatPercentage(value: number): string {
  return `${Math.round(value)}%`
}

export function formatChange(change: number | null): { text: string; isPositive: boolean } {
  if (change === null || change === 0) {
    return { text: '0%', isPositive: false }
  }
  
  const isPositive = change > 0
  const text = `${isPositive ? '+' : ''}${Math.round(change)}%`
  
  return { text, isPositive }
}

export function formatAxisDate(dateStr: string, period: string): string {
  const date = new Date(dateStr)

  if (period === 'day') {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
  } else if (period === '12mo') {
    const month = date.getMonth()
    if (month === 0) {
      return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    }
    return date.toLocaleDateString('en-US', { month: 'short' })
  } else if (period === '30d') {
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  } else {
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
  }
}

export function formatTooltipDate(dateStr: string, period: string): string {
  const date = new Date(dateStr)

  if (period === 'day') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
}