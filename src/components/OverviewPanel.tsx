import type { CSSProperties } from "react";
import type { AnalyticsOverview } from "../lib/analytics";
import { formatPercent } from "../lib/analytics";
import { formatMoney } from "../lib/money";
import { MonthSwitcher } from "./MonthSwitcher";

const MONTH_LABELS = [
  "Янв",
  "Фев",
  "Мар",
  "Апр",
  "Май",
  "Июн",
  "Июл",
  "Авг",
  "Сен",
  "Окт",
  "Ноя",
  "Дек",
];

type Props = {
  analytics: AnalyticsOverview;
  onYearMonthChange: (value: string) => void;
  onOpenBudget: () => void;
  onOpenTransactions: () => void;
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function monthTitle(yearMonth: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
    return "Месяц";
  }
  const [year, month] = yearMonth.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, (month ?? 1) - 1, 1)));
}

export function OverviewPanel({
  analytics,
  onYearMonthChange,
  onOpenBudget,
  onOpenTransactions,
}: Props) {
  const { currency, month, yearFlow, monthBudget, yearBudget, alerts, accounts, recentTransactions } =
    analytics;

  const maxMonthFlow = Math.max(
    1,
    ...yearFlow.months.map((m) => Math.max(m.incomeMinor, m.expenseMinor)),
  );

  const budgetUsage =
    monthBudget.allocatedMinor > 0
      ? monthBudget.actualExpenseMinor / monthBudget.allocatedMinor
      : monthBudget.actualExpenseMinor > 0
        ? 1
        : 0;

  const monthIndex = Number(analytics.yearMonth.slice(5, 7)) - 1;
  const previousMonth = monthIndex > 0 ? yearFlow.months[monthIndex - 1] : undefined;
  const expenseChange =
    previousMonth && previousMonth.expenseMinor > 0
      ? (month.expenseMinor - previousMonth.expenseMinor) / previousMonth.expenseMinor
      : null;
  const remainingDays = Math.max(month.daysInMonth - month.daysElapsed, 0);
  const remainingBudget = monthBudget.allocatedMinor - monthBudget.actualExpenseMinor;
  const dailyAllowance =
    remainingDays > 0 && remainingBudget > 0 ? Math.trunc(remainingBudget / remainingDays) : 0;
  const projectedExpense = month.avgDailyExpenseMinor * month.daysInMonth;
  const topExpense = month.expenseCategories[0];
  const hasActivity = month.incomeMinor > 0 || month.expenseMinor > 0;
  const budgetConfigured =
    monthBudget.plannedIncomeMinor > 0 || monthBudget.allocatedMinor > 0;

  return (
    <section className="panel analytics">
      <header className="analytics-head">
        <div>
          <p className="eyebrow">Финансовый пульс</p>
          <h2>{monthTitle(analytics.yearMonth)}</h2>
          <p className="muted">Главное о деньгах за выбранный месяц</p>
        </div>
        <MonthSwitcher
          value={analytics.yearMonth}
          onChange={onYearMonthChange}
          ariaLabel="Период аналитики"
        />
      </header>

      <section className="financial-pulse" aria-label="Состояние финансов">
        <div className="balance-focus">
          <span className="metric-label">Общий баланс · {currency}</span>
          <strong className="mono">{formatMoney(analytics.balanceMinor, currency)}</strong>
          <p className="muted">
            За месяц осталось{" "}
            <span className={`mono ${month.netMinor >= 0 ? "income" : "expense"}`}>
              {formatMoney(month.netMinor, currency)}
            </span>{" "}
            · сбережения {formatPercent(month.savingsRate)}
          </p>
        </div>
        <div className={`budget-gauge ${budgetUsage > 1 ? "over" : ""}`}>
          <div
            className="gauge-ring"
            style={
              {
                "--usage": String(Math.min(Math.max(budgetUsage, 0), 1)),
              } as CSSProperties
            }
            aria-label={`Использовано ${formatPercent(budgetUsage)} лимитов`}
          >
            <span className="mono">{formatPercent(budgetUsage)}</span>
          </div>
          <div>
            <strong>{budgetConfigured ? "Лимит месяца" : "Бюджет не задан"}</strong>
            <span className="muted">
              {budgetConfigured
                ? `${formatMoney(monthBudget.actualExpenseMinor, currency)} из ${formatMoney(
                    monthBudget.allocatedMinor,
                    currency,
                  )}`
                : "Задайте план, чтобы видеть темп расходов"}
            </span>
          </div>
        </div>
      </section>

      <section className="decision-strip" aria-label="Подсказки на месяц">
        <article>
          <span className="metric-label">Можно тратить в день</span>
          <strong className="mono">{formatMoney(dailyAllowance, currency)}</strong>
          <p>
            {remainingDays > 0
              ? `На оставшиеся ${remainingDays} дн. в рамках лимитов`
              : "Месяц завершён"}
          </p>
        </article>
        <article>
          <span className="metric-label">Прогноз расходов</span>
          <strong
            className={`mono ${
              monthBudget.allocatedMinor > 0 &&
              projectedExpense > monthBudget.allocatedMinor
                ? "expense"
                : ""
            }`}
          >
            {formatMoney(projectedExpense, currency)}
          </strong>
          <p>При текущем среднем темпе</p>
        </article>
        <article>
          <span className="metric-label">Крупнейшая категория</span>
          <strong>{topExpense?.categoryName ?? "Нет расходов"}</strong>
          <p>
            {topExpense
              ? `${formatMoney(topExpense.amountMinor, currency)} · ${formatPercent(
                  topExpense.shareRatio,
                )}`
              : "Добавьте операции для анализа"}
          </p>
        </article>
        <article>
          <span className="metric-label">К прошлому месяцу</span>
          <strong
            className={`mono ${
              expenseChange != null && expenseChange > 0 ? "expense" : "income"
            }`}
          >
            {expenseChange == null
              ? "—"
              : `${expenseChange > 0 ? "+" : ""}${formatPercent(expenseChange)}`}
          </strong>
          <p>{expenseChange == null ? "Недостаточно данных" : "Изменение расходов"}</p>
        </article>
      </section>

      {!hasActivity && (
        <section className="analytics-empty">
          <div>
            <strong>За этот месяц пока нет операций</strong>
            <p>Добавьте доход или расход — аналитика обновится автоматически.</p>
          </div>
          <button type="button" onClick={onOpenTransactions}>
            Добавить операцию
          </button>
        </section>
      )}

      <section className="analytics-block cashflow-block">
        <div className="block-head">
          <div>
            <h3>Денежный поток {analytics.year}</h3>
            <p className="muted">Доходы и расходы по месяцам</p>
          </div>
          <div className="legend" aria-label="Легенда графика">
            <span><i className="legend-dot income" /> доход</span>
            <span><i className="legend-dot expense" /> расход</span>
          </div>
        </div>
        <div
          className="cashflow-ribbon"
          role="img"
          aria-label="График доходов и расходов по месяцам"
        >
          {yearFlow.months.map((row, index) => {
            const isSelected = row.yearMonth === analytics.yearMonth;
            return (
              <button
                type="button"
                key={row.yearMonth}
                className={`cashflow-col ${isSelected ? "selected" : ""}`}
                onClick={() => onYearMonthChange(row.yearMonth)}
                aria-label={`${MONTH_LABELS[index]}: доход ${formatMoney(
                  row.incomeMinor,
                  currency,
                )}, расход ${formatMoney(row.expenseMinor, currency)}`}
              >
                <div className="cashflow-bars">
                  <i
                    className="bar income"
                    style={{ height: `${(row.incomeMinor / maxMonthFlow) * 100}%` }}
                  />
                  <i
                    className="bar expense"
                    style={{ height: `${(row.expenseMinor / maxMonthFlow) * 100}%` }}
                  />
                </div>
                <span>{MONTH_LABELS[index]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="analytics-grid primary">
        <section className="analytics-block">
          <div className="block-head">
            <div>
              <h3>Куда уходят деньги</h3>
              <p className="muted">Доля каждой категории в расходах месяца</p>
            </div>
          </div>
          {month.expenseCategories.length === 0 ? (
            <p className="empty-inline">Категории появятся после первой расходной операции.</p>
          ) : (
            <ul className="share-list">
              {month.expenseCategories.map((row, index) => (
                <li key={`${row.categoryId ?? "none"}-${row.categoryName}`}>
                  <div className="share-rank">{String(index + 1).padStart(2, "0")}</div>
                  <div className="share-content">
                    <div className="share-meta">
                      <strong>
                        {row.categoryName}
                        {row.isEssential && <span className="tag">обязательно</span>}
                      </strong>
                      <span className="mono">
                        {formatMoney(row.amountMinor, currency)}
                      </span>
                    </div>
                    <div className="share-track">
                      <i style={{ width: `${Math.min(row.shareRatio * 100, 100)}%` }} />
                      <span>{formatPercent(row.shareRatio)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="split-row">
            <div>
              <span>Обязательные</span>
              <strong className="mono">
                {formatMoney(month.essentialExpenseMinor, currency)}
              </strong>
            </div>
            <div>
              <span>Необязательные</span>
              <strong className="mono">
                {formatMoney(month.discretionaryExpenseMinor, currency)}
              </strong>
            </div>
          </div>
        </section>

        <section className="analytics-block plan-card">
          <div className="block-head">
            <div>
              <h3>План и факт</h3>
              <p className="muted">Как месяц идёт относительно бюджета</p>
            </div>
            <button type="button" className="ghost compact" onClick={onOpenBudget}>
              Изменить план
            </button>
          </div>
          <div className="comparison-row">
            <span>Доход</span>
            <div>
              <i
                className="income"
                style={{
                  width: `${Math.min(
                    monthBudget.plannedIncomeMinor > 0
                      ? (monthBudget.actualIncomeMinor / monthBudget.plannedIncomeMinor) * 100
                      : 0,
                    100,
                  )}%`,
                }}
              />
            </div>
            <strong className="mono">
              {formatMoney(monthBudget.actualIncomeMinor, currency)}
              <small> / {formatMoney(monthBudget.plannedIncomeMinor, currency)}</small>
            </strong>
          </div>
          <div className="comparison-row">
            <span>Расход</span>
            <div>
              <i
                className={budgetUsage > 1 ? "expense" : ""}
                style={{ width: `${Math.min(budgetUsage * 100, 100)}%` }}
              />
            </div>
            <strong className="mono">
              {formatMoney(monthBudget.actualExpenseMinor, currency)}
              <small> / {formatMoney(monthBudget.allocatedMinor, currency)}</small>
            </strong>
          </div>
          <dl className="budget-dl">
            <div>
              <dt>Свободные средства</dt>
              <dd className={`mono ${monthBudget.freeMinor < 0 ? "expense" : ""}`}>
                {formatMoney(monthBudget.freeMinor, currency)}
              </dd>
            </div>
            <div>
              <dt>Остаток лимитов</dt>
              <dd className={`mono ${remainingBudget < 0 ? "expense" : ""}`}>
                {formatMoney(remainingBudget, currency)}
              </dd>
            </div>
          </dl>
          {alerts.length > 0 ? (
            <div className="alert-list">
              {alerts.map((row) => (
                <button type="button" key={row.categoryId} onClick={onOpenBudget}>
                  <span className={`status-dot ${row.status}`} />
                  <span>
                    <strong>{row.categoryName}</strong>
                    <small>
                      {row.status === "over"
                        ? `Перерасход ${formatMoney(-row.remainingMinor, currency)}`
                        : `Использовано ${formatPercent(row.usageRatio)}`}
                    </small>
                  </span>
                  <span aria-hidden>→</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="healthy-note">Все заданные лимиты в норме.</p>
          )}
        </section>
      </div>

      <details className="analytics-details">
        <summary>
          <span>
            <strong>Подробнее о {analytics.year} годе</strong>
            <small>Годовой план, категории и счета</small>
          </span>
          <span aria-hidden>⌄</span>
        </summary>
        <div className="analytics-grid detail-grid">
          <section className="analytics-block">
            <div className="block-head">
              <div>
                <h3>Итоги года</h3>
                <p className="muted">Норма сбережений {formatPercent(yearFlow.savingsRate)}</p>
              </div>
            </div>
            <div className="year-totals">
              <div>
                <span>Доход</span>
                <strong className="mono income">
                  {formatMoney(yearFlow.incomeMinor, currency)}
                </strong>
              </div>
              <div>
                <span>Расход</span>
                <strong className="mono expense">
                  {formatMoney(yearFlow.expenseMinor, currency)}
                </strong>
              </div>
              <div>
                <span>Сбережения</span>
                <strong className={`mono ${yearFlow.netMinor >= 0 ? "income" : "expense"}`}>
                  {formatMoney(yearFlow.netMinor, currency)}
                </strong>
              </div>
            </div>
            <div className="year-plan-line">
              <span>Годовой план дохода</span>
              <strong className="mono">
                {formatMoney(yearBudget.plannedIncomeMinor, currency)}
              </strong>
            </div>
            <div className="year-plan-line">
              <span>Распределено по категориям</span>
              <strong className="mono">
                {formatMoney(yearBudget.allocatedMinor, currency)}
              </strong>
            </div>
          </section>
          <section className="analytics-block">
            <div className="block-head">
              <h3>Счета</h3>
            </div>
            <ul className="ledger-list account-list">
              {accounts.map((account) => (
                <li key={account.accountId}>
                  <span>{account.name}</span>
                  <span className="mono">
                    {formatMoney(account.balanceMinor, account.currency)}
                  </span>
                </li>
              ))}
            </ul>
            <h3 className="subhead">Топ расходов за год</h3>
            <ul className="year-category-list">
              {yearFlow.expenseCategories.slice(0, 5).map((row) => (
                <li key={`year-${row.categoryId ?? "none"}`}>
                  <span>{row.categoryName}</span>
                  <span className="mono">
                    {formatMoney(row.amountMinor, currency)} · {formatPercent(row.shareRatio)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </details>

      <section className="analytics-block recent-block recent-activity">
        <div className="block-head">
          <div>
            <h3>Последние операции</h3>
            <p className="muted">
              {recentTransactions.length > 0
                ? "Свежие изменения баланса"
                : "Здесь появится движение денег"}
            </p>
          </div>
          <button type="button" className="ghost compact" onClick={onOpenTransactions}>
            Открыть журнал →
          </button>
        </div>
        <ul className="recent-transactions">
          {recentTransactions.slice(0, 5).map((tx) => (
            <li
              key={tx.id}
              className={tx.amountMinor >= 0 ? "recent-income" : "recent-expense"}
            >
              <span className="recent-direction" aria-hidden>
                {tx.amountMinor >= 0 ? "↙" : "↗"}
              </span>
              <div className="recent-copy">
                <strong>{tx.title}</strong>
                <span className="muted">{tx.categoryName ?? "Без категории"}</span>
              </div>
              <time className="muted" dateTime={tx.occurredAt}>
                {formatDate(tx.occurredAt)}
              </time>
              <span
                className={`mono recent-amount ${
                  tx.amountMinor >= 0 ? "income" : "expense"
                }`}
              >
                {formatMoney(tx.amountMinor, tx.currency)}
              </span>
            </li>
          ))}
          {recentTransactions.length === 0 && (
            <li className="recent-empty">
              <span aria-hidden>↗</span>
              <div>
                <strong>Операций пока нет</strong>
                <p>Запишите доход или расход — он сразу появится здесь.</p>
              </div>
              <button type="button" onClick={onOpenTransactions}>
                Добавить операцию
              </button>
            </li>
          )}
        </ul>
      </section>
    </section>
  );
}
