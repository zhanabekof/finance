import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  CONVERTER_CURRENCIES,
  convertAmountMinor,
  formatRateNumber,
  loadFxRates,
  rateFromTo,
  type FxRateSnapshot,
} from "./currencyConvert";
import { formatMinorPlain, parseMoneyInput } from "./money";

type Props = {
  defaultCurrency?: string;
};

const QUICK_AMOUNTS = ["100", "1 000", "10 000", "100 000"] as const;

const CURRENCY_MARK: Record<string, string> = {
  KZT: "₸",
  USD: "$",
  EUR: "€",
  RUB: "₽",
  GBP: "£",
  CNY: "¥",
  TRY: "₺",
  AED: "Dh",
  CHF: "Fr",
  JPY: "¥",
};

function currencyOrFallback(code: string | undefined, fallback: string): string {
  const normalized = (code ?? fallback).toUpperCase();
  return CONVERTER_CURRENCIES.some((item) => item.code === normalized)
    ? normalized
    : fallback;
}

function quickAmountValue(label: string): string {
  return label.replace(/\s/g, "");
}

export function CurrencyConverterPanel({ defaultCurrency = "KZT" }: Props) {
  const listId = useId();
  const initialCurrency = currencyOrFallback(defaultCurrency, "KZT");
  const [anchorCurrency, setAnchorCurrency] = useState(initialCurrency);
  const [anchorText, setAnchorText] = useState("1000");
  const [snapshot, setSnapshot] = useState<FxRateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeInputRef = useRef<HTMLInputElement | null>(null);

  async function refreshRates(forceRefresh = false) {
    setError(null);
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const next = await loadFxRates({ forceRefresh });
      setSnapshot(next);
    } catch {
      setError("Нет сети или сервис курсов недоступен. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refreshRates(false);
  }, []);

  let anchorMinor: number | null = null;
  let anchorError: string | null = null;
  try {
    if (anchorText.trim()) {
      const parsed = parseMoneyInput(anchorText, anchorCurrency);
      if (parsed < 0) {
        anchorError = "Сумма не может быть отрицательной";
      } else {
        anchorMinor = parsed;
      }
    }
  } catch (err) {
    anchorError = err instanceof Error ? err.message : "Некорректная сумма";
  }

  function amountFor(currency: string): string {
    if (currency === anchorCurrency) {
      return anchorText;
    }
    if (!snapshot || anchorMinor === null || anchorError) {
      return "";
    }
    try {
      const converted = convertAmountMinor(
        anchorMinor,
        anchorCurrency,
        currency,
        snapshot.rates,
      );
      return formatMinorPlain(converted, currency);
    } catch {
      return "";
    }
  }

  function onAmountChange(currency: string, value: string) {
    setAnchorCurrency(currency);
    setAnchorText(value);
  }

  function applyQuickAmount(label: string) {
    setAnchorText(quickAmountValue(label));
    activeInputRef.current?.focus();
  }

  function clearAmount() {
    setAnchorText("");
    activeInputRef.current?.focus();
  }

  const asOfLabel = snapshot?.asOfDate
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${snapshot.asOfDate}T12:00:00.000Z`))
    : null;

  const refreshedLabel = snapshot
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(snapshot.fetchedAt))
    : null;

  const orderedCurrencies = [
    ...CONVERTER_CURRENCIES.filter((item) => item.code === initialCurrency),
    ...CONVERTER_CURRENCIES.filter((item) => item.code !== initialCurrency),
  ];

  return (
    <section className="converter-panel" aria-labelledby={`${listId}-title`}>
      <div className="panel-head converter-head">
        <div>
          <p className="eyebrow">Курсы · live</p>
          <h2 id={`${listId}-title`}>Конвертер</h2>
          <p className="muted converter-lead">
            Пишите сумму в любой строке — остальные обновятся сами.
          </p>
        </div>
        <div className="converter-head-actions">
          <button
            type="button"
            className="ghost"
            disabled={!anchorText}
            onClick={clearAmount}
          >
            Очистить
          </button>
          <button
            type="button"
            className="converter-refresh"
            disabled={loading || refreshing}
            onClick={() => void refreshRates(true)}
          >
            {refreshing ? "Обновляю…" : "Обновить"}
          </button>
        </div>
      </div>

      <div className="converter-toolbar" aria-label="Быстрые суммы">
        <span className="converter-toolbar-label">Быстро</span>
        <div className="converter-chips">
          {QUICK_AMOUNTS.map((label) => (
            <button
              key={label}
              type="button"
              className="converter-chip"
              disabled={!snapshot}
              onClick={() => applyQuickAmount(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && !snapshot ? (
        <div className="converter-board converter-board-loading" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="converter-row skeleton" />
          ))}
        </div>
      ) : null}

      {snapshot ? (
        <div
          className={
            refreshing ? "converter-board is-refreshing" : "converter-board"
          }
          role="list"
          aria-label="Валюты"
        >
          {orderedCurrencies.map((item, index) => {
            const isActive = item.code === anchorCurrency;
            const mark = CURRENCY_MARK[item.code] ?? item.code;
            let rateHint: string | null = null;
            if (!isActive && anchorMinor !== null && !anchorError) {
              try {
                const rate = rateFromTo(
                  anchorCurrency,
                  item.code,
                  snapshot.rates,
                );
                rateHint = `1 ${anchorCurrency} = ${formatRateNumber(rate)} ${item.code}`;
              } catch {
                rateHint = null;
              }
            }

            return (
              <label
                key={item.code}
                className={
                  isActive ? "converter-row is-active" : "converter-row"
                }
                role="listitem"
                style={{ "--row-i": index } as CSSProperties}
              >
                <span className="converter-mark" aria-hidden="true">
                  {mark}
                </span>
                <span className="converter-currency">
                  <strong className="mono">{item.code}</strong>
                  <span>{item.label}</span>
                </span>
                <span className="converter-field">
                  <input
                    ref={isActive ? activeInputRef : undefined}
                    className="mono"
                    inputMode="decimal"
                    value={amountFor(item.code)}
                    onChange={(event) =>
                      onAmountChange(item.code, event.target.value)
                    }
                    onFocus={(event) => {
                      const next = event.currentTarget;
                      if (!isActive) {
                        onAmountChange(item.code, next.value);
                      }
                      requestAnimationFrame(() => next.select());
                    }}
                    placeholder="0"
                    autoComplete="off"
                    aria-label={`${item.label}, ${item.code}`}
                    aria-invalid={isActive && Boolean(anchorError)}
                    aria-describedby={
                      isActive && anchorError
                        ? `${listId}-error`
                        : rateHint
                          ? `${listId}-rate-${item.code}`
                          : undefined
                    }
                  />
                </span>
                {isActive && anchorError ? (
                  <span
                    id={`${listId}-error`}
                    className="converter-row-hint is-error"
                    role="alert"
                  >
                    {anchorError}
                  </span>
                ) : rateHint ? (
                  <span
                    id={`${listId}-rate-${item.code}`}
                    className="converter-row-hint mono"
                  >
                    {rateHint}
                  </span>
                ) : (
                  <span className="converter-row-hint">
                    {isActive ? "редактируете" : "\u00a0"}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      ) : null}

      {snapshot ? (
        <footer className="converter-meta">
          <span className="converter-status">
            <span className="converter-dot" aria-hidden="true" />
            {asOfLabel ? `Курсы на ${asOfLabel}` : "Курсы загружены"}
          </span>
          <span className="muted">
            {snapshot.source}
            {refreshedLabel ? ` · ${refreshedLabel}` : null}
          </span>
        </footer>
      ) : null}
    </section>
  );
}
