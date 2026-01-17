/**
 * Time utilities for Open-Meteo timestamps without timezone offsets.
 */

export type DateParts = {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Accept Open-Meteo-style timestamps ("YYYY-MM-DDTHH:mm") and ISO UTC ("...:ss(.sss)Z").
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,3})?(?:Z)?$/;

function buildDateParts(
  year: number,
  month: number,
  day: number,
  hour?: number,
  minute?: number
): DateParts | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour !== undefined && (hour < 0 || hour > 23)) return null;
  if (minute !== undefined && (minute < 0 || minute > 59)) return null;

  return {
    year,
    month,
    day,
    hour,
    minute
  };
}

export function parseOpenMeteoDate(value: string): DateParts | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  return buildDateParts(year, month, day);
}

export function parseOpenMeteoDateTime(value: string): DateParts | null {
  const match = DATETIME_RE.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  return buildDateParts(year, month, day, hour, minute);
}

export function parseOpenMeteoTimestamp(value: string): DateParts | null {
  return parseOpenMeteoDateTime(value) || parseOpenMeteoDate(value);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function resolveTimeZone(timeZone?: string): string {
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
      return timeZone;
    } catch {
      // Fall through to local timezone.
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function getZonedParts(date: Date, timeZone?: string): Required<DateParts> | null {
  const resolved = resolveTimeZone(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: resolved,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const parts = formatter.formatToParts(date);
    const values: Record<string, number> = {};
    parts.forEach((part) => {
      if (part.type !== 'literal') {
        values[part.type] = Number(part.value);
      }
    });

    if (
      !Number.isFinite(values.year) ||
      !Number.isFinite(values.month) ||
      !Number.isFinite(values.day) ||
      !Number.isFinite(values.hour) ||
      !Number.isFinite(values.minute)
    ) {
      return null;
    }

    return {
      year: values.year,
      month: values.month,
      day: values.day,
      hour: values.hour,
      minute: values.minute
    };
  } catch {
    return null;
  }
}

export function getZonedNowParts(timeZone?: string): Required<DateParts> | null {
  return getZonedParts(new Date(), timeZone);
}

export function getZonedDateParts(date: Date, timeZone?: string): Required<DateParts> | null {
  return getZonedParts(date, timeZone);
}

export function isSameDate(a: DateParts, b: DateParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function isSameHour(a: DateParts, b: DateParts): boolean {
  return (
    isSameDate(a, b) &&
    Number.isFinite(a.hour) &&
    Number.isFinite(b.hour) &&
    a.hour === b.hour
  );
}

export function addDays(date: DateParts, days: number): DateParts {
  const base = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const next = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate()
  };
}

export function formatDateKey(parts: DateParts): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

export function formatDateTimeKey(parts: DateParts): string | null {
  if (!Number.isFinite(parts.hour) || !Number.isFinite(parts.minute)) return null;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour as number)}:${pad2(parts.minute as number)}`;
}

export function formatHourLabel(parts: DateParts, locale = 'en-CA'): string {
  if (!Number.isFinite(parts.hour)) return '';
  const date = new Date(Date.UTC(2000, 0, 1, parts.hour as number, parts.minute ?? 0));
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone: 'UTC' }).format(date);
}

export function formatWeekdayHourLabel(parts: DateParts, locale = 'en-CA'): string {
  if (!Number.isFinite(parts.hour)) return '';
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour as number, parts.minute ?? 0)
  );
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

export function formatCalendarDate(parts: DateParts, locale = 'en-CA'): string {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(date);
}

export function shiftOpenMeteoDateTimeKey(value: string, deltaHours: number): string | null {
  if (!Number.isFinite(deltaHours) || deltaHours === 0) return value;
  const parts = parseOpenMeteoDateTime(value);
  if (!parts || !Number.isFinite(parts.hour) || !Number.isFinite(parts.minute)) return null;

  const base = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour as number,
    parts.minute as number
  );
  const shifted = new Date(base + deltaHours * 60 * 60 * 1000);
  return formatDateTimeKey({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes()
  });
}

export function findCurrentHourIndex(times: string[], timeZone?: string): number {
  if (times.length === 0) return 0;
  const now = getZonedNowParts(timeZone);
  if (!now) return 0;

  const index = times.findIndex((time) => {
    const parts = parseOpenMeteoDateTime(time);
    return parts ? isSameHour(parts, now) : false;
  });

  return index >= 0 ? index : 0;
}
