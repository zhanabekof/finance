/** Currency fraction digits for ISO 4217 codes used in the app. */
const FRACTION_DIGITS: Record<string, number> = {
  KZT: 2,
  USD: 2,
  EUR: 2,
};

export function currencyFractionDigits(currency: string): number {
  return FRACTION_DIGITS[currency.toUpperCase()] ?? 2;
}

export function scaleForCurrency(currency: string): number {
  const digits = currencyFractionDigits(currency);
  let scale = 1;
  for (let i = 0; i < digits; i += 1) {
    scale *= 10;
  }
  return scale;
}

/**
 * Parse a user-entered amount into signed minor units.
 * Uses integer arithmetic only — never floating money math.
 */
export function parseMoneyInput(input: string, currency: string): number {
  let trimmed = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!trimmed || trimmed === "-" || trimmed === "+" || trimmed === ".") {
    throw new Error("Введите сумму");
  }

  // Allow "12." while typing / before blur.
  if (trimmed.endsWith(".")) {
    trimmed = trimmed.slice(0, -1);
  }
  if (!trimmed || trimmed === "-" || trimmed === "+") {
    throw new Error("Введите сумму");
  }

  const sign = trimmed.startsWith("-") ? -1 : 1;
  const unsigned = trimmed.replace(/^[+-]/, "");
  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    throw new Error("Некорректная сумма");
  }

  const [wholePart, fractionPart = ""] = unsigned.split(".");
  const digits = currencyFractionDigits(currency);
  if (fractionPart.length > digits) {
    throw new Error(`Максимум ${digits} знака после запятой`);
  }

  const whole = Number.parseInt(wholePart || "0", 10);
  if (!Number.isSafeInteger(whole)) {
    throw new Error("Слишком большая сумма");
  }

  const padded = fractionPart.padEnd(digits, "0");
  const fraction = padded ? Number.parseInt(padded, 10) : 0;
  const scale = scaleForCurrency(currency);
  const minor = whole * scale + fraction;
  if (!Number.isSafeInteger(minor)) {
    throw new Error("Слишком большая сумма");
  }

  return sign * minor;
}

/** Empty or blank limit fields count as zero instead of throwing. */
export function parseMoneyInputOrZero(input: string, currency: string): number {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "." || trimmed === "-" || trimmed === "+") {
    return 0;
  }
  return parseMoneyInput(trimmed, currency);
}

export function formatMoney(amountMinor: number, currency: string, locale = "ru-RU"): string {
  const digits = currencyFractionDigits(currency);
  const scale = scaleForCurrency(currency);
  const absolute = Math.abs(amountMinor);
  const whole = Math.trunc(absolute / scale);
  const fraction = absolute % scale;
  const sign = amountMinor < 0 ? "-" : "";
  const major =
    digits === 0
      ? String(whole)
      : `${whole}.${String(fraction).padStart(digits, "0")}`;

  const asNumber = Number(`${sign}${major}`);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(asNumber);
}

export function sumMinor(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Некорректная денежная сумма");
    }
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Переполнение при сложении сумм");
    }
  }
  return total;
}
