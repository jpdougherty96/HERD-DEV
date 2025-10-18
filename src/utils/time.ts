// src/utils/time.ts

const DEFAULT_LONG_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
};

const DEFAULT_SHORT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

const parseDateFromISO = (value?: string): Date | null => {
  if (!value) return null;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    return null;
  }
  return new Date(year, month - 1, day);
};

export const formatDateDisplay = (
  value?: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_LONG_DATE_OPTIONS,
  locale = "en-US",
): string => {
  const parsed = parseDateFromISO(value);
  if (!parsed) return "";
  return parsed.toLocaleDateString(locale, options);
};

export const formatDateRangeDisplay = (
  start?: string,
  end?: string,
  options: Intl.DateTimeFormatOptions = DEFAULT_LONG_DATE_OPTIONS,
  locale = "en-US",
): string => {
  const startLabel = formatDateDisplay(start, options, locale);
  if (!startLabel) return "";
  const endLabel = formatDateDisplay(end, options, locale);
  if (!endLabel || !end || end === start) {
    return startLabel;
  }
  return `${startLabel} – ${endLabel}`;
};

export const formatDateRangeShort = (
  start?: string,
  end?: string,
  locale = "en-US",
): string => formatDateRangeDisplay(start, end, DEFAULT_SHORT_DATE_OPTIONS, locale);

export const formatTime = (time: string) => {
  if (!time) return "Select time";
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export const generateTimeOptions = () => {
  const times: { value: string; display: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const display = formatTime(value);
      times.push({ value, display });
    }
  }
  return times;
};
