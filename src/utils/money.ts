const toNumber = (value: number | string | null | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const sanitizeCurrencyString = (input: string): { normalized: string; hadDecimal: boolean } => {
  const trimmed = input.trim();
  if (!trimmed) return { normalized: '', hadDecimal: false };

  const cleaned = trimmed.replace(/[^\d.,-]/g, '');
  if (!cleaned) return { normalized: '', hadDecimal: false };

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let hadDecimal = false;
  let normalized = cleaned;

  if (hasComma) {
    if (hasDot) {
      normalized = cleaned.replace(/,/g, '');
      hadDecimal = true;
    } else {
      const lastComma = cleaned.lastIndexOf(',');
      const decimalsLength = cleaned.length - lastComma - 1;
      if (decimalsLength > 0 && decimalsLength <= 2) {
        normalized = cleaned.replace(',', '.');
        hadDecimal = true;
      } else {
        normalized = cleaned.replace(/,/g, '');
      }
    }
  }

  if (!hadDecimal && hasDot) {
    hadDecimal = true;
  }

  return { normalized, hadDecimal };
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
  let numeric: number;
  let hadDecimal = false;

  if (typeof value === 'string') {
    const { normalized, hadDecimal: stringHadDecimal } = sanitizeCurrencyString(value);
    if (!normalized) return 0;

    numeric = Number(normalized);
    hadDecimal = stringHadDecimal || normalized.includes('.');
  } else {
    numeric = toNumber(value);
    hadDecimal = !Number.isInteger(numeric);
  }

  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  if (assumeInputIsDollars) return Math.round(numeric * 100);

  if (hadDecimal) return Math.round(numeric * 100);

  if (Math.abs(numeric) >= 100 && Number.isInteger(numeric)) return Math.round(numeric);
  return Math.round(numeric * 100);
};

/**
 * Returns the value in whole dollars as a number (e.g. 7500 -> 75).
 */
export const centsToDollars = (value: number | string | null | undefined): number => {
  const cents = normalizeToCents(value);
  return cents / 100;
};

const PRICE_CENTS_KEYS = [
  'price_per_person_cents',
  'pricePerPersonCents',
  'price_cents',
  'priceCents',
] as const;

const PRICE_DOLLAR_KEYS = [
  'price_per_person',
  'pricePerPerson',
  'price',
  'price_dollars',
  'priceDollars',
] as const;

const parsePossibleNumber = (raw: any): number | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const cleaned = raw.trim();
    if (!cleaned) return null;
    const numeric = Number(cleaned.replace(/[^\d.-]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

export const resolvePriceCentsFromRow = (row: Record<string, any> | null | undefined): number => {
  if (!row || typeof row !== 'object') return 0;

  let zeroCandidate: number | null = null;

  for (const key of PRICE_CENTS_KEYS) {
    if (!(key in row)) continue;
    const numeric = parsePossibleNumber(row[key]);
    if (numeric === null) continue;
    const rounded = Math.round(numeric);
    if (rounded > 0) return rounded;
    if (rounded === 0 && zeroCandidate === null) zeroCandidate = 0;
  }

  for (const key of PRICE_DOLLAR_KEYS) {
    if (!(key in row)) continue;
    const cents = normalizeToCents(row[key], { assumeInputIsDollars: true });
    if (cents > 0) return cents;
    if (cents === 0 && zeroCandidate === null) zeroCandidate = 0;
  }

  return zeroCandidate ?? 0;
};
