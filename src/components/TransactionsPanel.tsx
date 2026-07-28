import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addTransaction,
  deleteTransaction,
  getMonthBudgetSummary,
  transferBetweenAccounts,
  updateTransaction,
  type Account,
  type Category,
  type Transaction,
} from "../lib/db";
import {
  currentYearMonth,
  expenseLimitWarning,
  monthBoundsUtc,
} from "../lib/budget";
import { formatMinorPlain, formatMoney, parseMoneyInput, sumMinor } from "../lib/money";
import { MonthSwitcher } from "./MonthSwitcher";

export type TransactionsFocus = {
  categoryId: number | null;
  yearMonth: string;
};

type Props = {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  primaryCurrency: string;
  focus?: TransactionsFocus | null;
  onChanged: () => Promise<void> | void;
};

type CategoryFilter = "all" | "none" | number;

function parseCategoryFilter(value: string): CategoryFilter {
  if (value === "all" || value === "none") {
    return value;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : "all";
}

type TxKind = "expense" | "income" | "transfer";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateInputFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return todayDateInput();
  }
  return date.toISOString().slice(0, 10);
}

function isoFromDateInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Укажите корректную дату");
  }
  return `${value}T12:00:00.000Z`;
}

function amountToInput(amountMinor: number, currency: string): string {
  return formatMinorPlain(Math.abs(amountMinor), currency);
}

function formatYearMonthLabel(yearMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    return yearMonth;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const label = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return label.charAt(0).toLocaleUpperCase("ru") + label.slice(1);
}


export function TransactionsPanel({
  accounts,
  categories,
  transactions,
  primaryCurrency,
  focus = null,
  onChanged,
}: Props) {
  const [txKind, setTxKind] = useState<TxKind>("expense");
  const [txTitle, setTxTitle] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txAccountId, setTxAccountId] = useState<number | "">(
    accounts[0]?.id ?? "",
  );
  const [txToAccountId, setTxToAccountId] = useState<number | "">(
    accounts[1]?.id ?? accounts[0]?.id ?? "",
  );
  const [txCategoryId, setTxCategoryId] = useState<number | "">("");
  const [txDate, setTxDate] = useState(todayDateInput());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [txFilter, setTxFilter] = useState<"all" | "expense" | "income" | "transfer">(
    "all",
  );
  const [txSearch, setTxSearch] = useState("");
  const [listMonth, setListMonth] = useState(currentYearMonth());
  const [monthOnly, setMonthOnly] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [pendingDeleteTxId, setPendingDeleteTxId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!focus) {
      return;
    }
    setListMonth(focus.yearMonth);
    setMonthOnly(true);
    setCategoryFilter(focus.categoryId == null ? "none" : focus.categoryId);
    setTxFilter("all");
    setTxSearch("");
  }, [focus]);

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.kind === "expense"),
    [categories],
  );
  const incomeCategories = useMemo(
    () => categories.filter((category) => category.kind === "income"),
    [categories],
  );
  const visibleCategories =
    txKind === "expense" ? expenseCategories : incomeCategories;
  const selectedAccount = accounts.find((account) => account.id === txAccountId);

  const filteredTransactions = useMemo(() => {
    const query = txSearch.trim().toLocaleLowerCase("ru");
    const bounds = monthOnly ? monthBoundsUtc(listMonth) : null;
    return transactions.filter((transaction) => {
      if (
        bounds &&
        (transaction.occurred_at < bounds.startIso ||
          transaction.occurred_at >= bounds.endIso)
      ) {
        return false;
      }
      if (categoryFilter === "none" && transaction.category_id != null) {
        return false;
      }
      if (
        typeof categoryFilter === "number" &&
        transaction.category_id !== categoryFilter
      ) {
        return false;
      }
      if (txFilter === "expense" && transaction.amount_minor >= 0) {
        return false;
      }
      if (txFilter === "income" && transaction.amount_minor < 0) {
        return false;
      }
      if (txFilter === "transfer" && !transaction.transfer_group_id) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [transaction.title, transaction.category_name, transaction.account_name]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("ru").includes(query));
    });
  }, [transactions, txFilter, txSearch, listMonth, monthOnly, categoryFilter]);

  const filteredTotalMinor = useMemo(
    () => sumMinor(filteredTransactions.map((tx) => tx.amount_minor)),
    [filteredTransactions],
  );

  const categoryFilterLabel = useMemo(() => {
    if (categoryFilter === "all") {
      return "все категории";
    }
    if (categoryFilter === "none") {
      return "без категории";
    }
    return (
      categories.find((category) => category.id === categoryFilter)?.name ??
      "категория"
    );
  }, [categoryFilter, categories]);

  const hasActiveScope =
    categoryFilter !== "all" || !monthOnly || listMonth !== currentYearMonth();

  function resetScopeFilters() {
    setCategoryFilter("all");
    setMonthOnly(true);
    setListMonth(currentYearMonth());
    setTxSearch("");
    setTxFilter("all");
  }

  function resetForm(kind: TxKind = "expense") {
    setEditingId(null);
    setTxKind(kind);
    setTxTitle("");
    setTxAmount("");
    setTxCategoryId("");
    setTxDate(todayDateInput());
    setTxAccountId(accounts[0]?.id ?? "");
    setTxToAccountId(accounts[1]?.id ?? accounts[0]?.id ?? "");
  }

  function startEdit(tx: Transaction) {
    if (tx.transfer_group_id) {
      setError("Перевод нельзя редактировать — удалите и создайте заново");
      return;
    }
    setError(null);
    setNotice(null);
    setEditingId(tx.id);
    setTxKind(tx.amount_minor < 0 ? "expense" : "income");
    setTxTitle(tx.title);
    setTxAmount(amountToInput(tx.amount_minor, tx.currency));
    setTxAccountId(tx.account_id);
    setTxCategoryId(tx.category_id ?? "");
    setTxDate(dateInputFromIso(tx.occurred_at));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (txAccountId === "") {
      setError("Выберите счёт");
      return;
    }
    setSaving(true);
    try {
      const occurredAt = isoFromDateInput(txDate);

      if (txKind === "transfer") {
        if (txToAccountId === "") {
          throw new Error("Выберите счёт назначения");
        }
        await transferBetweenAccounts({
          fromAccountId: txAccountId,
          toAccountId: txToAccountId,
          amountInput: txAmount,
          title: txTitle.trim() || "Перевод",
          occurredAt,
        });
        setNotice("Перевод записан");
        resetForm("transfer");
        await onChanged();
        return;
      }

      const account = accounts.find((row) => row.id === txAccountId);
      if (!account) {
        throw new Error("Счёт не найден");
      }

      let budgetWarning: string | null = null;
      if (txKind === "expense" && txCategoryId !== "") {
        try {
          const amountMinor = Math.abs(parseMoneyInput(txAmount, account.currency));
          const summary = await getMonthBudgetSummary();
          const row = summary.categories.find(
            (category) =>
              category.kind === "expense" && category.categoryId === txCategoryId,
          );
          if (row) {
            const prior =
              editingId == null
                ? 0
                : Math.abs(
                    transactions.find((tx) => tx.id === editingId)?.amount_minor ?? 0,
                  );
            budgetWarning = expenseLimitWarning({
              categoryName: row.categoryName,
              planMinor: row.planMinor,
              actualMinor: Math.max(0, row.actualMinor - prior),
              addedExpenseMinor: amountMinor,
            });
          }
        } catch {
          // Budget warning is best-effort and must not block saving.
        }
      }

      if (editingId != null) {
        await updateTransaction({
          id: editingId,
          accountId: txAccountId,
          categoryId: txCategoryId === "" ? null : txCategoryId,
          title: txTitle,
          amountInput: txAmount,
          kind: txKind,
          currency: account.currency,
          occurredAt,
        });
        setNotice(budgetWarning ?? "Операция обновлена");
      } else {
        await addTransaction({
          accountId: txAccountId,
          categoryId: txCategoryId === "" ? null : txCategoryId,
          title: txTitle,
          amountInput: txAmount,
          kind: txKind,
          currency: account.currency,
          occurredAt,
        });
        setNotice(
          budgetWarning ??
            (txKind === "expense" ? "Расход записан" : "Доход записан"),
        );
      }
      resetForm(txKind);
      await onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteTx(id: number) {
    setError(null);
    try {
      await deleteTransaction(id);
      setPendingDeleteTxId(null);
      if (editingId === id) {
        resetForm();
      }
      setNotice("Операция удалена");
      await onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="panel transactions-panel">
      <header className="panel-head transactions-head">
        <div>
          <p className="eyebrow">Движение средств</p>
          <h2>Операции</h2>
          <p className="muted">
            Запишите доход, расход или перевод — баланс обновится автоматически.
          </p>
        </div>
        <div className="transactions-count">
          <strong className="mono">{transactions.length}</strong>
          <span>операций</span>
        </div>
      </header>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="banner notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="transactions-workspace">
        <form className="tx-form" onSubmit={onSubmit}>
          <div className="tx-form-top">
            <div className="kind-toggle tx-kind-toggle" role="group" aria-label="Тип операции">
              <button
                type="button"
                className={txKind === "expense" ? "active expense-active" : ""}
                onClick={() => {
                  setTxKind("expense");
                  setTxCategoryId("");
                  if (editingId != null) {
                    setEditingId(null);
                  }
                }}
              >
                <span aria-hidden>−</span> Расход
              </button>
              <button
                type="button"
                className={txKind === "income" ? "active income-active" : ""}
                onClick={() => {
                  setTxKind("income");
                  setTxCategoryId("");
                  if (editingId != null) {
                    setEditingId(null);
                  }
                }}
              >
                <span aria-hidden>+</span> Доход
              </button>
              <button
                type="button"
                className={txKind === "transfer" ? "active" : ""}
                onClick={() => {
                  setTxKind("transfer");
                  setTxCategoryId("");
                  setEditingId(null);
                }}
                disabled={accounts.length < 2}
                title={
                  accounts.length < 2
                    ? "Нужно минимум два активных счёта"
                    : undefined
                }
              >
                Перевод
              </button>
            </div>

            <label className={`tx-amount-field ${txKind === "income" ? "income" : "expense"}`}>
              <span>Сумма</span>
              <div>
                <b aria-hidden>
                  {txKind === "income" ? "+" : txKind === "expense" ? "−" : "⇄"}
                </b>
                <input
                  className="mono"
                  value={txAmount}
                  onChange={(event) => setTxAmount(event.currentTarget.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  required
                />
                <em>{selectedAccount?.currency ?? primaryCurrency}</em>
              </div>
            </label>
          </div>

          <div className="tx-fields">
            <label className="tx-title-field">
              <span>Описание</span>
              <input
                value={txTitle}
                onChange={(event) => setTxTitle(event.currentTarget.value)}
                placeholder={
                  txKind === "expense"
                    ? "Например, продукты"
                    : txKind === "income"
                      ? "Например, зарплата"
                      : "Например, на накопления"
                }
                required={txKind !== "transfer"}
              />
            </label>
            <label>
              <span>{txKind === "transfer" ? "Со счёта" : "Счёт"}</span>
              <select
                value={txAccountId}
                onChange={(event) => setTxAccountId(Number(event.currentTarget.value))}
                required
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.currency}
                  </option>
                ))}
              </select>
            </label>
            {txKind === "transfer" ? (
              <label>
                <span>На счёт</span>
                <select
                  value={txToAccountId}
                  onChange={(event) =>
                    setTxToAccountId(Number(event.currentTarget.value))
                  }
                  required
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.currency}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                <span>Категория</span>
                <select
                  value={txCategoryId}
                  onChange={(event) =>
                    setTxCategoryId(
                      event.currentTarget.value === ""
                        ? ""
                        : Number(event.currentTarget.value),
                    )
                  }
                  required={txKind === "expense"}
                >
                  <option value="">
                    {txKind === "expense" ? "Выберите категорию" : "Без категории"}
                  </option>
                  {visibleCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                      {category.is_essential
                        ? txKind === "expense"
                          ? " · обязательно"
                          : " · регулярно"
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span>Дата</span>
              <input
                type="date"
                value={txDate}
                onChange={(event) => setTxDate(event.currentTarget.value)}
                required
              />
            </label>
          </div>

          <div className="tx-form-actions">
            <span className="muted">
              {editingId != null
                ? "Редактирование операции"
                : txKind === "expense"
                  ? "Сумма спишется со счёта"
                  : txKind === "income"
                    ? "Сумма поступит на счёт"
                    : "Создаются две связанные операции"}
            </span>
            <div className="tx-form-action-buttons">
              {editingId != null ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => resetForm()}
                >
                  Отмена
                </button>
              ) : null}
              <button type="submit" disabled={saving}>
                {saving
                  ? "Сохраняю…"
                  : editingId != null
                    ? "Сохранить изменения"
                    : txKind === "expense"
                      ? "Записать расход"
                      : txKind === "income"
                        ? "Записать доход"
                        : "Записать перевод"}
              </button>
            </div>
          </div>
        </form>

        <div className="transactions-history">
          <div className="tx-filter-board">
            <div className="tx-filter-board-top">
              <div className="tx-filter-board-title">
                <p className="eyebrow">Журнал</p>
                <h3>История</h3>
              </div>
              <div className="tx-filter" role="group" aria-label="Тип операций">
                {(["all", "expense", "income", "transfer"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={txFilter === filter ? `active${filter !== "all" ? ` is-${filter}` : ""}` : ""}
                    onClick={() => setTxFilter(filter)}
                  >
                    {filter === "all"
                      ? "Все"
                      : filter === "expense"
                        ? "Расходы"
                        : filter === "income"
                          ? "Доходы"
                          : "Переводы"}
                  </button>
                ))}
              </div>
            </div>

            <label className="tx-filter-search">
              <span className="tx-ledger-label">Поиск</span>
              <input
                type="search"
                value={txSearch}
                onChange={(event) => setTxSearch(event.currentTarget.value)}
                placeholder="Описание, категория или счёт"
                aria-label="Поиск операций"
              />
            </label>

            <div className="tx-filter-grid" aria-label="Период и категория">
              <div className="tx-filter-period">
                <div className="tx-filter-period-head">
                  <span className="tx-ledger-label">Период</span>
                  <div
                    className="tx-segment"
                    role="group"
                    aria-label="Режим периода"
                  >
                    <button
                      type="button"
                      className={monthOnly ? "active" : ""}
                      onClick={() => setMonthOnly(true)}
                    >
                      Месяц
                    </button>
                    <button
                      type="button"
                      className={!monthOnly ? "active" : ""}
                      onClick={() => setMonthOnly(false)}
                    >
                      Всё время
                    </button>
                  </div>
                </div>
                {monthOnly ? (
                  <div className="tx-filter-month-card">
                    <strong>{formatYearMonthLabel(listMonth)}</strong>
                    <MonthSwitcher
                      value={listMonth}
                      onChange={setListMonth}
                      ariaLabel="Месяц операций"
                      showToday
                    />
                  </div>
                ) : (
                  <div className="tx-filter-month-card is-all">
                    <strong>Вся история</strong>
                    <span>Без ограничения по месяцу</span>
                  </div>
                )}
              </div>

              <label className="tx-filter-category">
                <span className="tx-ledger-label">Категория</span>
                <select
                  value={
                    categoryFilter === "all" || categoryFilter === "none"
                      ? categoryFilter
                      : String(categoryFilter)
                  }
                  onChange={(event) =>
                    setCategoryFilter(parseCategoryFilter(event.currentTarget.value))
                  }
                >
                  <option value="all">Все категории</option>
                  <option value="none">Без категории</option>
                  {expenseCategories.length > 0 ? (
                    <optgroup label="Расходы">
                      {expenseCategories.map((category) => (
                        <option key={`e-${category.id}`} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {incomeCategories.length > 0 ? (
                    <optgroup label="Доходы">
                      {incomeCategories.map((category) => (
                        <option key={`i-${category.id}`} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                <span className="tx-filter-category-hint">{categoryFilterLabel}</span>
              </label>
            </div>

            <div className="tx-filter-summary">
              <div className="tx-filter-summary-main">
                <div className="tx-filter-count">
                  <strong className="mono">{filteredTransactions.length}</strong>
                  <span>
                    {filteredTransactions.length === 1
                      ? "операция"
                      : filteredTransactions.length > 1 &&
                          filteredTransactions.length < 5
                        ? "операции"
                        : "операций"}
                  </span>
                </div>
                {(categoryFilter !== "all" ||
                  !monthOnly ||
                  txFilter !== "all" ||
                  txSearch.trim()) && (
                  <div className="tx-filter-chips">
                    {monthOnly ? (
                      <span className="tx-filter-chip is-period">
                        {formatYearMonthLabel(listMonth)}
                      </span>
                    ) : (
                      <span className="tx-filter-chip is-period">Всё время</span>
                    )}
                    {categoryFilter !== "all" ? (
                      <button
                        type="button"
                        className="tx-filter-chip is-category"
                        onClick={() => setCategoryFilter("all")}
                        title="Убрать фильтр категории"
                      >
                        <span>{categoryFilterLabel}</span>
                        <em aria-hidden>×</em>
                      </button>
                    ) : null}
                    {txFilter !== "all" ? (
                      <button
                        type="button"
                        className={`tx-filter-chip is-${txFilter}`}
                        onClick={() => setTxFilter("all")}
                        title="Убрать фильтр типа"
                      >
                        <span>
                          {txFilter === "expense"
                            ? "Расходы"
                            : txFilter === "income"
                              ? "Доходы"
                              : "Переводы"}
                        </span>
                        <em aria-hidden>×</em>
                      </button>
                    ) : null}
                    {txSearch.trim() ? (
                      <button
                        type="button"
                        className="tx-filter-chip"
                        onClick={() => setTxSearch("")}
                        title="Очистить поиск"
                      >
                        <span>«{txSearch.trim()}»</span>
                        <em aria-hidden>×</em>
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="tx-filter-summary-side">
                {filteredTransactions.length > 0 ? (
                  <div className="tx-filter-total">
                    <span>Итого</span>
                    <strong
                      className={`mono ${
                        filteredTotalMinor >= 0 ? "income" : "expense"
                      }`}
                    >
                      {formatMoney(filteredTotalMinor, primaryCurrency)}
                    </strong>
                  </div>
                ) : null}
                {hasActiveScope || txSearch.trim() || txFilter !== "all" ? (
                  <button
                    type="button"
                    className="ghost compact"
                    onClick={resetScopeFilters}
                  >
                    Сбросить
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <ul className="ledger-list transactions">
            {filteredTransactions.map((tx) => (
              <li
                key={tx.id}
                className={tx.amount_minor >= 0 ? "tx-income" : "tx-expense"}
              >
                <span className="tx-direction" aria-hidden>
                  {tx.transfer_group_id ? "⇄" : tx.amount_minor >= 0 ? "↙" : "↗"}
                </span>
                <div className="tx-copy">
                  <strong>{tx.title}</strong>
                  <span className="muted">
                    {tx.transfer_group_id
                      ? "Перевод"
                      : (tx.category_name ?? "Без категории")}
                    {tx.account_name ? ` · ${tx.account_name}` : ""}
                  </span>
                </div>
                <time className="muted" dateTime={tx.occurred_at}>
                  {formatDate(tx.occurred_at)}
                </time>
                <span
                  className={`mono tx-value ${
                    tx.amount_minor >= 0 ? "income" : "expense"
                  }`}
                >
                  {formatMoney(tx.amount_minor, tx.currency)}
                </span>
                <div className="tx-delete">
                  {pendingDeleteTxId === tx.id ? (
                    <>
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => setPendingDeleteTxId(null)}
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        className="danger-solid compact"
                        onClick={() => void onDeleteTx(tx.id)}
                      >
                        Подтвердить
                      </button>
                    </>
                  ) : (
                    <>
                      {!tx.transfer_group_id ? (
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={() => startEdit(tx)}
                        >
                          Изменить
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ghost compact tx-delete-trigger"
                        onClick={() => setPendingDeleteTxId(tx.id)}
                        aria-label={`Удалить операцию ${tx.title}`}
                      >
                        Удалить
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {filteredTransactions.length === 0 && (
              <li className="empty transactions-empty">
                {transactions.length === 0 ? (
                  "История пуста. Запишите первую операцию слева."
                ) : (
                  <>
                    <strong>В этой выборке пусто</strong>
                    <span>
                      {monthOnly
                        ? `Нет операций за ${formatYearMonthLabel(listMonth)}`
                        : "Нет операций"}
                      {categoryFilter !== "all"
                        ? ` · ${categoryFilterLabel}`
                        : ""}
                      .
                    </span>
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={resetScopeFilters}
                    >
                      Сбросить фильтры
                    </button>
                  </>
                )}
              </li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
