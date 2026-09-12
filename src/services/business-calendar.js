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
    if (Number.isNaN(result.getTime())) throw new Error("BUSINESS_DAY_START_INVALID");
    let remaining = count;
    while (remaining > 0) {
      result.setUTCDate(result.getUTCDate() + 1);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: this.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      }).formatToParts(result);
      const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
      const date = `${values.year}-${values.month}-${values.day}`;
      const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
      if (!this.excludedWeekdays.has(weekday) && !this.holidays.has(date)) remaining -= 1;
    }
    return result;
  }
}
