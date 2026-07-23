const MONTH_OPTIONS = [
  { value: 1, label: "Январь" },
  { value: 2, label: "Февраль" },
  { value: 3, label: "Март" },
  { value: 4, label: "Апрель" },
  { value: 5, label: "Май" },
  { value: 6, label: "Июнь" },
  { value: 7, label: "Июль" },
  { value: 8, label: "Август" },
  { value: 9, label: "Сентябрь" },
  { value: 10, label: "Октябрь" },
  { value: 11, label: "Ноябрь" },
  { value: 12, label: "Декабрь" },
] as const;

type Props = {
  value: string;
  onChange: (yearMonth: string) => void;
  showToday?: boolean;
  ariaLabel?: string;
};

function normalizeYearMonth(value: string): string {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return value;
  }
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(yearMonth: string, delta: number): string {
  const safe = normalizeYearMonth(yearMonth);
  const [year, month] = safe.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function yearOptions(centerYear: number): number[] {
  const start = centerYear - 6;
  const end = centerYear + 3;
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function composeYearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Переключатель месяца без native input[type=month] — стабильно на iOS. */
export function MonthSwitcher({
  value,
  onChange,
  showToday = true,
  ariaLabel = "Период",
}: Props) {
  const safe = normalizeYearMonth(value);
  const [year, month] = safe.split("-").map(Number);
  const years = yearOptions(year ?? new Date().getUTCFullYear());

  return (
    <div className="period-nav" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="ghost period-arrow"
        aria-label="Предыдущий месяц"
        onClick={() => onChange(shiftMonth(safe, -1))}
      >
        ‹
      </button>

      <div className="period-picker">
        <label className="period-select">
          <span className="visually-hidden">Месяц</span>
          <select
            value={month}
            onChange={(e) =>
              onChange(composeYearMonth(year, Number(e.currentTarget.value)))
            }
          >
            {MONTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="period-select">
          <span className="visually-hidden">Год</span>
          <select
            value={year}
            onChange={(e) =>
              onChange(composeYearMonth(Number(e.currentTarget.value), month))
            }
          >
            {years.map((optionYear) => (
              <option key={optionYear} value={optionYear}>
                {optionYear}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        className="ghost period-arrow"
        aria-label="Следующий месяц"
        onClick={() => onChange(shiftMonth(safe, 1))}
      >
        ›
      </button>

      {showToday && (
        <button
          type="button"
          className="ghost period-today"
          onClick={() => {
            const now = new Date();
            onChange(
              `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
            );
          }}
        >
          Сейчас
        </button>
      )}
    </div>
  );
}
