import { scaleForCurrency } from "./money";

/** Currencies shown in the converter (ISO 4217). */
export const CONVERTER_CURRENCIES = [
  { code: "KZT", label: "Тенге" },
  { code: "USD", label: "Доллар США" },
  { code: "EUR", label: "Евро" },
  { code: "RUB", label: "Рубль" },
  { code: "GBP", label: "Фунт стерлингов" },
  { code: "CNY", label: "Юань" },
  { code: "TRY", label: "Лира" },
  { code: "AED", label: "Дирхам ОАЭ" },
  { code: "CHF", label: "Франк" },
  { code: "JPY", label: "Иена" },
] as const;

export type ConverterCurrencyCode = (typeof CONVERTER_CURRENCIES)[number]["code"];

export type FxRateSnapshot = {
  base: string;
  /** Units of each currency per 1 unit of `base`. */
  rates: Record<string, number>;
  /** ISO date (YYYY-MM-DD) when rates were published, if known. */
  asOfDate: string | null;
  fetchedAt: string;
  source: "open.er-api.com" | "currency-api";
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

const OPEN_ER_API_URL = "https://open.er-api.com/v6/latest/USD";
const CURRENCY_API_URL =
  "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json";

let cachedSnapshot: FxRateSnapshot | null = null;
let inflight: Promise<FxRateSnapshot> | null = null;

function normalizeCurrency(code: string): string {
  return code.trim().toUpperCase();
}

function isFinitePositiveRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseOpenErApi(payload: unknown): FxRateSnapshot {
  if (!payload || typeof payload !== "object") {
    throw new Error("Некорректный ответ API курсов");
  }
  const data = payload as {
    result?: string;
    base_code?: string;
    time_last_update_utc?: string;
    rates?: Record<string, unknown>;
  };
  if (data.result !== "success" || !data.rates || typeof data.rates !== "object") {
    throw new Error("Сервис курсов вернул ошибку");
  }

  const base = normalizeCurrency(data.base_code ?? "USD");
  const rates: Record<string, number> = { [base]: 1 };
  for (const [code, value] of Object.entries(data.rates)) {
    if (isFinitePositiveRate(value)) {
      rates[normalizeCurrency(code)] = value;
    }
  }
  if (!rates.KZT || !rates.EUR || !rates.USD) {
    throw new Error("В ответе нет нужных валют");
  }

  let asOfDate: string | null = null;
  if (typeof data.time_last_update_utc === "string") {
    const parsed = new Date(data.time_last_update_utc);
    if (!Number.isNaN(parsed.getTime())) {
      asOfDate = parsed.toISOString().slice(0, 10);
    }
  }

  return {
    base,
    rates,
    asOfDate,
    fetchedAt: new Date().toISOString(),
    source: "open.er-api.com",
  };
}

function parseCurrencyApi(payload: unknown): FxRateSnapshot {
  if (!payload || typeof payload !== "object") {
    throw new Error("Некорректный ответ API курсов");
  }
  const data = payload as { date?: string; usd?: Record<string, unknown> };
  if (!data.usd || typeof data.usd !== "object") {
    throw new Error("Сервис курсов вернул ошибку");
  }

  const rates: Record<string, number> = { USD: 1 };
  for (const [code, value] of Object.entries(data.usd)) {
    if (isFinitePositiveRate(value)) {
      rates[normalizeCurrency(code)] = value;
    }
  }
  if (!rates.KZT || !rates.EUR || !rates.USD) {
    throw new Error("В ответе нет нужных валют");
  }

  const asOfDate =
    typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
      ? data.date
      : todayUtcDate();

  return {
    base: "USD",
    rates,
    asOfDate,
    fetchedAt: new Date().toISOString(),
    source: "currency-api",
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFreshSnapshot(): Promise<FxRateSnapshot> {
  try {
    const payload = await fetchJson(OPEN_ER_API_URL);
    return parseOpenErApi(payload);
  } catch {
    const payload = await fetchJson(CURRENCY_API_URL);
    return parseCurrencyApi(payload);
  }
}

function cacheIsFresh(snapshot: FxRateSnapshot, nowMs = Date.now()): boolean {
  const fetchedMs = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetchedMs)) {
    return false;
  }
  return nowMs - fetchedMs < CACHE_TTL_MS;
}

/**
 * Load FX rates vs USD. Uses in-memory cache (~30 min) and a CDN fallback.
 */
export async function loadFxRates(options?: {
  forceRefresh?: boolean;
}): Promise<FxRateSnapshot> {
  if (!options?.forceRefresh && cachedSnapshot && cacheIsFresh(cachedSnapshot)) {
    return cachedSnapshot;
  }
  if (!options?.forceRefresh && inflight) {
    return inflight;
  }

  inflight = fetchFreshSnapshot()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      return snapshot;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Test helper — inject or clear the in-memory cache. */
export function __setFxRatesCacheForTests(snapshot: FxRateSnapshot | null): void {
  cachedSnapshot = snapshot;
  inflight = null;
}

/**
 * Convert minor units using rates quoted against the same base currency.
 * Rates are floating-point (API limitation); result is rounded to the target currency minor unit.
 */
export function convertAmountMinor(
  amountMinor: number,
  fromCurrency: string,
  toCurrency: string,
  ratesVsBase: Record<string, number>,
): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error("Некорректная сумма");
  }

  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  if (from === to) {
    return amountMinor;
  }

  const fromRate = ratesVsBase[from];
  const toRate = ratesVsBase[to];
  if (!isFinitePositiveRate(fromRate) || !isFinitePositiveRate(toRate)) {
    throw new Error(`Нет курса для ${from} → ${to}`);
  }

  const fromScale = scaleForCurrency(from);
  const toScale = scaleForCurrency(to);
  const factor = (toRate * toScale) / (fromRate * fromScale);
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error("Некорректный курс");
  }

  const result = Math.round(amountMinor * factor);
  if (!Number.isSafeInteger(result)) {
    throw new Error("Слишком большая сумма для конвертации");
  }
  return result;
}

/** Units of `to` currency per 1 unit of `from` (major units). */
export function rateFromTo(
  fromCurrency: string,
  toCurrency: string,
  ratesVsBase: Record<string, number>,
): number {
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  if (from === to) {
    return 1;
  }
  const fromRate = ratesVsBase[from];
  const toRate = ratesVsBase[to];
  if (!isFinitePositiveRate(fromRate) || !isFinitePositiveRate(toRate)) {
    throw new Error(`Нет курса для ${from} → ${to}`);
  }
  return toRate / fromRate;
}

export function formatRateNumber(rate: number, locale = "ru-RU"): string {
  const digits = rate >= 100 ? 2 : rate >= 1 ? 4 : 6;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  }).format(rate);
}

export function formatFxRate(
  fromCurrency: string,
  toCurrency: string,
  ratesVsBase: Record<string, number>,
  locale = "ru-RU",
): string {
  const rate = rateFromTo(fromCurrency, toCurrency, ratesVsBase);
  const formatted = formatRateNumber(rate, locale);
  return `1 ${normalizeCurrency(fromCurrency)} = ${formatted} ${normalizeCurrency(toCurrency)}`;
}
