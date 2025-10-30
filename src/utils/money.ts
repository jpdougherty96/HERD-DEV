const toNumber = (value: number | string | null | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

type NormalizeToCentsOptions = {
  /**
   * When true, treat the incoming value as a dollar amount even if it parses to a whole integer (e.g. "1000").
   * Useful for handling raw form input where users enter dollars instead of cents.
   */
  assumeInputIsDollars?: boolean;
};

/**
 * Normalizes a value that may represent dollars or cents into cents.
 * Supports legacy data that may have stored dollars directly.
 */
export const normalizeToCents = (
  value: number | string | null | undefined,
  options: NormalizeToCentsOptions = {}
): number => {
  const { assumeInputIsDollars = false } = options;
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  if (assumeInputIsDollars) return Math.round(numeric * 100);

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0;

    if (trimmed.includes('.') || trimmed.includes(',')) {
      return Math.round(numeric * 100);
    }
  }

  if (Math.abs(numeric) >= 100 && Number.isInteger(numeric)) return Math.round(numeric);
  return Math.round(numeric * 100);
};

/**
 * Converts a value (dollars or cents) into a display string.
 */
export const formatPrice = (
  value: number | string | null | undefined,
  options: { withCurrency?: boolean } = {}
): string => {
  const cents = normalizeToCents(value);
  const dollars = cents / 100;
  const formatted = dollars.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return options.withCurrency ? `$${formatted}` : formatted;
};

/**
 * Returns the value in whole dollars as a number (e.g. 7500 -> 75).
 */
export const centsToDollars = (value: number | string | null | undefined): number => {
  const cents = normalizeToCents(value);
  return cents / 100;
};
