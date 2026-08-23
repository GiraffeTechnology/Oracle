export class BusinessCalendar {
  constructor({ calendarId, timeZone, excludedWeekdays = [0, 6], holidays = [] }) {
    if (!calendarId || !timeZone) throw new Error("CALENDAR_INVALID");
    this.calendarId = calendarId;
    this.timeZone = timeZone;
    this.excludedWeekdays = new Set(excludedWeekdays);
    this.holidays = new Set(holidays);
  }

  addBusinessDays(start, count) {
    if (!Number.isInteger(count) || count < 0 || count > 30) throw new Error("BUSINESS_DAY_COUNT_INVALID");
    const result = new Date(start);
    let remaining = count;
    while (remaining > 0) {
      result.setUTCDate(result.getUTCDate() + 1);
      const date = result.toISOString().slice(0, 10);
      if (!this.excludedWeekdays.has(result.getUTCDay()) && !this.holidays.has(date)) remaining -= 1;
    }
    return result;
  }
}

