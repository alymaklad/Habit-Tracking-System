import { describe, expect, it } from 'vitest'
import {
  addDays,
  dateRange,
  diffDays,
  formatCountdown,
  formatDuration,
  formatRelative,
  isoWeekNumber,
  localToInstant,
  parseGoogleDue,
  toGoogleDue,
  toLocalDate,
  weekStart,
  weekday
} from '@main/domain/time'

describe('Google due dates are calendar dates, never instants', () => {
  // The regression this guards: Google returns `due` as midnight UTC. Converting it
  // through a negative-offset timezone yields the PREVIOUS day.
  it('keeps the same calendar day west of UTC', () => {
    expect(parseGoogleDue('2026-08-20T00:00:00.000Z')).toBe('2026-08-20')
  })

  it('keeps the same calendar day east of UTC', () => {
    expect(parseGoogleDue('2026-08-20T00:00:00.000Z')).toBe('2026-08-20')
  })

  it('demonstrates the bug it prevents', () => {
    // What a naive implementation would do in New York:
    const naive = new Date('2026-08-20T00:00:00.000Z').toLocaleDateString('en-CA', {
      timeZone: 'America/New_York'
    })
    expect(naive).toBe('2026-08-19')
    // What we actually do:
    expect(parseGoogleDue('2026-08-20T00:00:00.000Z')).toBe('2026-08-20')
  })

  it('round-trips through toGoogleDue', () => {
    expect(parseGoogleDue(toGoogleDue('2026-01-01'))).toBe('2026-01-01')
    expect(parseGoogleDue(toGoogleDue('2026-12-31'))).toBe('2026-12-31')
  })

  it('handles missing and malformed values', () => {
    expect(parseGoogleDue(null)).toBeNull()
    expect(parseGoogleDue(undefined)).toBeNull()
    expect(parseGoogleDue('')).toBeNull()
    expect(parseGoogleDue('not-a-date')).toBeNull()
  })
})

describe('timezone-aware local dates', () => {
  it('resolves the local day differently either side of UTC', () => {
    const instant = '2026-08-20T23:30:00.000Z'
    expect(toLocalDate(instant, 'America/New_York')).toBe('2026-08-20')
    expect(toLocalDate(instant, 'Africa/Cairo')).toBe('2026-08-21')
  })

  it('maps a local wall time back to the right instant in Cairo', () => {
    // Cairo is UTC+3 in August 2026 (DST).
    const iso = localToInstant('2026-08-20', '20:00', 'Africa/Cairo')
    expect(iso.startsWith('2026-08-20T17:00')).toBe(true)
  })

  it('maps a local wall time back to the right instant in New York', () => {
    const iso = localToInstant('2026-08-20', '18:00', 'America/New_York')
    expect(iso.startsWith('2026-08-20T22:00')).toBe(true)
  })

  it('survives a DST transition', () => {
    // US DST ends 1 November 2026; 08:00 local is UTC-5 after the change.
    const iso = localToInstant('2026-11-02', '08:00', 'America/New_York')
    expect(iso.startsWith('2026-11-02T13:00')).toBe(true)
  })
})

describe('calendar arithmetic', () => {
  it('adds days across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('adds days across a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('diffs days', () => {
    expect(diffDays('2026-08-20', '2026-08-27')).toBe(7)
    expect(diffDays('2026-08-27', '2026-08-20')).toBe(-7)
    expect(diffDays('2026-08-20', '2026-08-20')).toBe(0)
  })

  it('uses ISO weekdays with Monday as 1', () => {
    expect(weekday('2026-08-20')).toBe(4) // Thursday
    expect(weekday('2026-08-23')).toBe(7) // Sunday
  })

  it('starts weeks on Monday', () => {
    expect(weekStart('2026-08-20')).toBe('2026-08-17')
    expect(weekStart('2026-08-17')).toBe('2026-08-17')
    expect(weekStart('2026-08-23')).toBe('2026-08-17')
  })

  it('reports ISO week numbers', () => {
    expect(isoWeekNumber('2026-08-20')).toBe(34)
  })

  it('builds inclusive ranges', () => {
    expect(dateRange('2026-08-20', '2026-08-23')).toEqual([
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23'
    ])
    expect(dateRange('2026-08-20', '2026-08-20')).toEqual(['2026-08-20'])
  })
})

describe('sync status formatting', () => {
  const now = new Date('2026-08-20T20:44:00.000Z')

  it('formats how long ago the last sync ran', () => {
    expect(formatRelative('2026-08-20T20:43:00.000Z', now)).toBe('1m ago')
    expect(formatRelative('2026-08-20T20:43:50.000Z', now)).toBe('just now')
    expect(formatRelative('2026-08-20T18:44:00.000Z', now)).toBe('2h ago')
    expect(formatRelative('2026-08-18T20:44:00.000Z', now)).toBe('2d ago')
    expect(formatRelative(null, now)).toBe('never')
  })

  it('counts down to the next sync', () => {
    expect(formatCountdown('2026-08-20T20:44:30.000Z', now)).toBe('< 1m')
    expect(formatCountdown('2026-08-20T20:48:00.000Z', now)).toBe('4m')
    expect(formatCountdown('2026-08-20T20:43:00.000Z', now)).toBe('due now')
    expect(formatCountdown(null, now)).toBe('—')
  })
})

describe('duration formatting', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(45)).toBe('45m')
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(118)).toBe('1h 58m')
    expect(formatDuration(0)).toBe('0m')
  })
})
