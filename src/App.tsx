import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTransaction,
  addCategory,
  applyYearBudgetToMonths,
  archiveCategory,
  copyBudgetToNextMonth,
  copyYearBudgetToNextYear,
  getFullAnalytics,
  getMonthBudgetSummary,
  getOrCreateBudget,
  getOrCreateYearBudget,
  getYearBudgetSummary,
  listAccounts,
  listBudgetLimits,
  listCategories,
  listTransactions,
  listYearBudgetLimits,
  updateBudgetPlan,
  updateCategory,
  updateYearBudgetPlan,
  deleteTransaction,
  type Account,
  type Category,
  type Transaction,
} from "./db";
import {
  currentYear,
  currentYearMonth,
  type MonthBudgetSummary,
  type YearBudgetSummary,
} from "./budget";
import type { AnalyticsOverview } from "./analytics";
import { formatMoney, parseMoneyInputOrZero, sumMinor } from "./money";
import { OverviewPanel } from "./OverviewPanel";
import { CategoriesPanel } from "./CategoriesPanel";
import { GoalsPanel } from "./GoalsPanel";
import { ImportPanel } from "./ImportPanel";
import { CurrencyConverterPanel } from "./CurrencyConverterPanel";
import { MonthSwitcher } from "./MonthSwitcher";
import "./App.css";

type Tab =
  | "overview"
  | "transactions"
  | "budget"
  | "goals"
  | "converter"
  | "import"
  | "categories";
type BudgetScope = "month" | "year";

const NAV_ITEMS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Обзор" },
  { id: "transactions", label: "Операции" },
  { id: "budget", label: "Бюджет" },
  { id: "goals", label: "Цели" },
  { id: "converter", label: "Конвертер" },
  { id: "import", label: "Импорт" },
  { id: "categories", label: "Категории" },
];

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

function minorToInput(amountMinor: number, currency: string): string {
  const digits = currency === "KZT" || currency === "USD" || currency === "EUR" ? 2 : 2;
  const scale = 10 ** digits;
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const whole = Math.trunc(abs / scale);
  const fraction = String(abs % scale).padStart(digits, "0");
  return `${sign}${whole}.${fraction}`;
}

function isYearMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function isYear(value: string): boolean {
  return /^\d{4}$/.test(value);
}

function sumDraftMinor(values: string[], currency: string): number {
  return sumMinor(values.map((value) => draftMinorOrZero(value, currency)));
}

function draftMinorOrZero(value: string, currency: string): number {
  try {
    return Math.abs(parseMoneyInputOrZero(value, currency));
  } catch {
    return 0;
  }
}

function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingBudget, setSavingBudget] = useState(false);
  const [savingTransaction, setSavingTransaction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const budgetDraftsDirtyRef = useRef(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [budgetSummary, setBudgetSummary] = useState<MonthBudgetSummary | null>(null);
  const [yearBudgetSummary, setYearBudgetSummary] = useState<YearBudgetSummary | null>(null);
  const [budgetScope, setBudgetScope] = useState<BudgetScope>("month");
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [overviewMonth, setOverviewMonth] = useState(currentYearMonth());
  const [budgetYear, setBudgetYear] = useState(currentYear());
  const [budgetYearDraft, setBudgetYearDraft] = useState(currentYear());

  const [txKind, setTxKind] = useState<"expense" | "income">("expense");
  const [txTitle, setTxTitle] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txAccountId, setTxAccountId] = useState<number | "">("");
  const [txCategoryId, setTxCategoryId] = useState<number | "">("");
  const [txFilter, setTxFilter] = useState<"all" | "expense" | "income">("all");
  const [txSearch, setTxSearch] = useState("");
  const [pendingDeleteTxId, setPendingDeleteTxId] = useState<number | null>(null);

  const [plannedIncome, setPlannedIncome] = useState("0.00");
  const [limitDrafts, setLimitDrafts] = useState<Record<number, string>>({});

  const primaryCurrency = accounts[0]?.currency ?? "KZT";
  const activeSummary = budgetScope === "month" ? budgetSummary : yearBudgetSummary;

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.kind === "expense"),
    [categories],
  );
  const incomeCategories = useMemo(
    () => categories.filter((c) => c.kind === "income"),
    [categories],
  );
  const visibleCategories = txKind === "expense" ? expenseCategories : incomeCategories;
  const selectedAccount = accounts.find((account) => account.id === txAccountId);
  const filteredTransactions = useMemo(() => {
    const query = txSearch.trim().toLocaleLowerCase("ru");
    return transactions.filter((transaction) => {
      if (txFilter === "expense" && transaction.amount_minor >= 0) {
        return false;
      }
      if (txFilter === "income" && transaction.amount_minor < 0) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [transaction.title, transaction.category_name, transaction.account_name]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("ru").includes(query));
    });
  }, [transactions, txFilter, txSearch]);

  const draftIncomePlanMinor = useMemo(
    () =>
      sumDraftMinor(
        incomeCategories.map((category) => limitDrafts[category.id] ?? "0"),
        primaryCurrency,
      ),
    [incomeCategories, limitDrafts, primaryCurrency],
  );
  const draftExpensePlanMinor = useMemo(
    () =>
      sumDraftMinor(
        expenseCategories.map((category) => limitDrafts[category.id] ?? "0"),
        primaryCurrency,
      ),
    [expenseCategories, limitDrafts, primaryCurrency],
  );
  const effectiveDraftIncomeMinor =
    incomeCategories.length > 0
      ? draftIncomePlanMinor
      : draftMinorOrZero(plannedIncome, primaryCurrency);
  const draftFreeMinor = effectiveDraftIncomeMinor - draftExpensePlanMinor;

  function goToTab(next: Tab) {
    setTab(next);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  const refresh = useCallback(async () => {
    setError(null);

    const safeYearMonth = isYearMonth(yearMonth) ? yearMonth : currentYearMonth();
    const safeOverviewMonth = isYearMonth(overviewMonth)
      ? overviewMonth
      : currentYearMonth();
    const safeYear = isYear(budgetYear) ? budgetYear : currentYear();

    const [accs, cats, txs] = await Promise.all([
      listAccounts(),
      listCategories(),
      listTransactions(80),
    ]);
    setAccounts(accs);
    setCategories(cats);
    setTransactions(txs);

    const currency = accs[0]?.currency ?? "KZT";
    setTxAccountId((prev) => (prev === "" && accs[0] ? accs[0].id : prev));

    // Avoid parallel getOrCreateBudget for the same month (UNIQUE race).
    const fullAnalytics = await getFullAnalytics(currency, safeOverviewMonth);
    const monthSummary =
      safeYearMonth === safeOverviewMonth
        ? fullAnalytics.monthBudget
        : await getMonthBudgetSummary(safeYearMonth);
    const yearSummary = await getYearBudgetSummary(safeYear);

    setAnalytics(fullAnalytics);
    setBudgetSummary(monthSummary);
    setYearBudgetSummary(yearSummary);
  }, [budgetYear, overviewMonth, yearMonth]);

  const loadBudgetDrafts = useCallback(async () => {
    if (budgetDraftsDirtyRef.current) {
      return;
    }

    const cats = await listCategories();
    const accs = await listAccounts();
    const currency = accs[0]?.currency ?? "KZT";

    if (budgetScope === "month") {
      const safeYearMonth = isYearMonth(yearMonth) ? yearMonth : currentYearMonth();
      const monthBudget = await getOrCreateBudget(safeYearMonth, currency);
      const limits = await listBudgetLimits(monthBudget.id);
      if (budgetDraftsDirtyRef.current) {
        return;
      }
      const drafts: Record<number, string> = {};
      let incomePlanMinor = 0;
      for (const category of cats) {
        const limit = limits.find((item) => item.category_id === category.id);
        drafts[category.id] = limit
          ? minorToInput(limit.limit_minor, currency)
          : "0.00";
        if (category.kind === "income" && limit) {
          incomePlanMinor += limit.limit_minor;
        }
      }
      setLimitDrafts(drafts);
      setPlannedIncome(
        minorToInput(
          incomePlanMinor > 0 ? incomePlanMinor : monthBudget.planned_income_minor,
          currency,
        ),
      );
      return;
    }

    const safeYear = isYear(budgetYear) ? budgetYear : currentYear();
    const yearBudget = await getOrCreateYearBudget(safeYear, currency);
    const limits = await listYearBudgetLimits(yearBudget.id);
    if (budgetDraftsDirtyRef.current) {
      return;
    }
    const drafts: Record<number, string> = {};
    let incomePlanMinor = 0;
    for (const category of cats) {
      const limit = limits.find((item) => item.category_id === category.id);
      drafts[category.id] = limit
        ? minorToInput(limit.limit_minor, currency)
        : "0.00";
      if (category.kind === "income" && limit) {
        incomePlanMinor += limit.limit_minor;
      }
    }
    setLimitDrafts(drafts);
    setPlannedIncome(
      minorToInput(
        incomePlanMinor > 0 ? incomePlanMinor : yearBudget.planned_income_minor,
        currency,
      ),
    );
  }, [budgetScope, budgetYear, yearMonth]);

  useEffect(() => {
    let cancelled = false;

    refresh()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    budgetDraftsDirtyRef.current = false;
    let cancelled = false;
    loadBudgetDrafts().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadBudgetDrafts]);

  function markBudgetDraftDirty() {
    budgetDraftsDirtyRef.current = true;
  }

  function commitYearMonth(value: string) {
    if (isYearMonth(value)) {
      budgetDraftsDirtyRef.current = false;
      setYearMonth(value);
    }
  }

  function commitOverviewMonth(value: string) {
    if (isYearMonth(value)) {
      setOverviewMonth(value);
    }
  }

  function onBudgetYearDraftChange(value: string) {
    setBudgetYearDraft(value);
  }

  function onBudgetYearBlur() {
    if (isYear(budgetYearDraft)) {
      if (budgetYearDraft !== budgetYear) {
        budgetDraftsDirtyRef.current = false;
        setBudgetYear(budgetYearDraft);
      }
      return;
    }
    const fallback = isYear(budgetYear) ? budgetYear : currentYear();
    setBudgetYearDraft(fallback);
    if (fallback !== budgetYear) {
      budgetDraftsDirtyRef.current = false;
      setBudgetYear(fallback);
    }
  }

  function onBudgetFormKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter") {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT") {
      // Enter in amount fields must not auto-submit and wipe the screen mid-edit.
      event.preventDefault();
    }
  }

  async function onAddTransaction(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (txAccountId === "") {
      setError("Выберите счёт");
      return;
    }
    setSavingTransaction(true);
    try {
      const account = accounts.find((a) => a.id === txAccountId);
      if (!account) {
        throw new Error("Счёт не найден");
      }
      await addTransaction({
        accountId: txAccountId,
        categoryId: txCategoryId === "" ? null : txCategoryId,
        title: txTitle,
        amountInput: txAmount,
        kind: txKind,
        currency: account.currency,
      });
      setTxTitle("");
      setTxAmount("");
      setNotice(txKind === "expense" ? "Расход записан" : "Доход записан");
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingTransaction(false);
    }
  }

  async function onDeleteTx(id: number) {
    setNotice(null);
    try {
      await deleteTransaction(id);
      setPendingDeleteTxId(null);
      setNotice("Операция удалена");
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSaveBudget(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    setSavingBudget(true);
    try {
      const limits = categories.map((category) => ({
        categoryId: category.id,
        limitInput: limitDrafts[category.id] ?? "0",
      }));

      if (budgetScope === "month") {
        if (!isYearMonth(yearMonth)) {
          throw new Error("Выберите корректный месяц");
        }
        await updateBudgetPlan({
          yearMonth,
          currency: primaryCurrency,
          plannedIncomeInput: incomeCategories.length > 0 ? "0" : plannedIncome,
          limits,
        });
        setNotice("Месячный бюджет сохранён. Операции не изменены.");
      } else {
        if (!isYear(budgetYear)) {
          throw new Error("Выберите корректный год");
        }
        await updateYearBudgetPlan({
          year: budgetYear,
          currency: primaryCurrency,
          plannedIncomeInput: incomeCategories.length > 0 ? "0" : plannedIncome,
          limits,
        });
        setNotice("Годовой бюджет сохранён. Операции не изменены.");
      }
      budgetDraftsDirtyRef.current = false;
      await refresh();
      await loadBudgetDrafts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingBudget(false);
    }
  }

  async function onCopyBudget() {
    setNotice(null);
    try {
      if (budgetScope === "month") {
        const next = await copyBudgetToNextMonth(yearMonth);
        setYearMonth(next);
        setNotice(`План перенесён на ${next}. Операции не изменены.`);
      } else {
        const next = await copyYearBudgetToNextYear(budgetYear);
        setBudgetYear(next);
        setBudgetYearDraft(next);
        setNotice(`Годовой план перенесён на ${next}. Операции не изменены.`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onApplyYearToMonths() {
    setNotice(null);
    try {
      await applyYearBudgetToMonths(budgetYear);
      setNotice(
        `Годовой план разложен на 12 месяцев ${budgetYear}. Операции не изменены.`,
      );
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function reloadAfterCategoryChange() {
    budgetDraftsDirtyRef.current = false;
    const cats = await listCategories();
    setCategories(cats);
    await refresh();
    await loadBudgetDrafts();
  }

  async function onCreateCategory(input: {
    name: string;
    kind: "income" | "expense";
    isEssential: boolean;
  }) {
    setError(null);
    await addCategory(input);
    setNotice("Категория добавлена");
    await reloadAfterCategoryChange();
  }

  async function onUpdateCategory(input: {
    id: number;
    name: string;
    isEssential: boolean;
  }) {
    setError(null);
    await updateCategory(input);
    setNotice("Категория обновлена");
    await reloadAfterCategoryChange();
  }

  async function onArchiveCategory(id: number) {
    setError(null);
    try {
      await archiveCategory(id);
      if (txCategoryId === id) {
        setTxCategoryId("");
      }
      setNotice("Категория удалена. История операций сохранена.");
      await reloadAfterCategoryChange();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  return (
    <div className={`app-shell${menuOpen ? " menu-open" : ""}`}>
      <header className="mobile-chrome">
        <div className="mobile-chrome-brand">
          <strong>Finance</strong>
        </div>
        <button
          type="button"
          className={`burger${menuOpen ? " open" : ""}`}
          aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={menuOpen}
          aria-controls="app-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <button
        type="button"
        className="menu-backdrop"
        aria-label="Закрыть меню"
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />

      <main className="stage">
        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="banner notice" role="status">
            {notice}
          </p>
        )}
        {loading && !activeSummary && !analytics && <p className="muted">Загрузка…</p>}

        {tab === "overview" &&
          (analytics ? (
            <OverviewPanel
              analytics={analytics}
              onYearMonthChange={commitOverviewMonth}
              onOpenBudget={() => {
                setBudgetScope("month");
                if (isYearMonth(overviewMonth)) {
                  budgetDraftsDirtyRef.current = false;
                  setYearMonth(overviewMonth);
                }
                goToTab("budget");
              }}
              onOpenTransactions={() => goToTab("transactions")}
            />
          ) : (
            <p className="muted">Загрузка обзора…</p>
          ))}

        {tab === "transactions" && (
          <section className="panel transactions-panel">
            <header className="panel-head transactions-head">
              <div>
                <p className="eyebrow">Движение средств</p>
                <h2>Операции</h2>
                <p className="muted">Запишите движение денег — баланс обновится автоматически.</p>
              </div>
              <div className="transactions-count">
                <strong className="mono">{transactions.length}</strong>
                <span>операций</span>
              </div>
            </header>

            <div className="transactions-workspace">
              <form className="tx-form" onSubmit={onAddTransaction}>
              <div className="tx-form-top">
                <div className="kind-toggle tx-kind-toggle" role="group" aria-label="Тип операции">
                  <button
                    type="button"
                    className={txKind === "expense" ? "active expense-active" : ""}
                    onClick={() => {
                      setTxKind("expense");
                      setTxCategoryId("");
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
                    }}
                  >
                    <span aria-hidden>+</span> Доход
                  </button>
                </div>

                <label className={`tx-amount-field ${txKind}`}>
                  <span>Сумма</span>
                  <div>
                    <b aria-hidden>{txKind === "expense" ? "−" : "+"}</b>
                    <input
                      className="mono"
                      value={txAmount}
                      onChange={(e) => setTxAmount(e.currentTarget.value)}
                      placeholder="0.00"
                      inputMode="decimal"
                      autoFocus
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
                    onChange={(e) => setTxTitle(e.currentTarget.value)}
                    placeholder={txKind === "expense" ? "Например, продукты" : "Например, зарплата"}
                    required
                  />
                </label>
                <label>
                  <span>Счёт</span>
                  <select
                    value={txAccountId}
                    onChange={(e) => setTxAccountId(Number(e.currentTarget.value))}
                    required
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.currency}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Категория</span>
                  <select
                    value={txCategoryId}
                    onChange={(e) =>
                      setTxCategoryId(
                        e.currentTarget.value === "" ? "" : Number(e.currentTarget.value),
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
              </div>

              <div className="tx-form-actions">
                <span className="muted">
                  {txKind === "expense" ? "Сумма спишется со счёта" : "Сумма поступит на счёт"}
                </span>
                <button type="submit" disabled={savingTransaction}>
                  {savingTransaction
                    ? "Записываю…"
                    : txKind === "expense"
                      ? "Записать расход"
                      : "Записать доход"}
                </button>
              </div>
              </form>

              <div className="transactions-history">
                <div className="transactions-toolbar">
                  <div>
                    <h3>История</h3>
                    <span className="muted">{filteredTransactions.length} показано</span>
                  </div>
                  <input
                    type="search"
                    value={txSearch}
                    onChange={(e) => setTxSearch(e.currentTarget.value)}
                    placeholder="Поиск операций"
                    aria-label="Поиск операций"
                  />
                  <div className="tx-filter" role="group" aria-label="Фильтр операций">
                    {(["all", "expense", "income"] as const).map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        className={txFilter === filter ? "active" : ""}
                        onClick={() => setTxFilter(filter)}
                      >
                        {filter === "all" ? "Все" : filter === "expense" ? "Расходы" : "Доходы"}
                      </button>
                    ))}
                  </div>
                </div>

                <ul className="ledger-list transactions">
                  {filteredTransactions.map((tx) => (
                    <li key={tx.id} className={tx.amount_minor >= 0 ? "tx-income" : "tx-expense"}>
                      <span className="tx-direction" aria-hidden>
                        {tx.amount_minor >= 0 ? "↙" : "↗"}
                      </span>
                      <div className="tx-copy">
                        <strong>{tx.title}</strong>
                        <span className="muted">
                          {tx.category_name ?? "Без категории"}
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
                              onClick={() => onDeleteTx(tx.id)}
                            >
                              Подтвердить
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="ghost compact tx-delete-trigger"
                            onClick={() => setPendingDeleteTxId(tx.id)}
                            aria-label={`Удалить операцию ${tx.title}`}
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                  {filteredTransactions.length === 0 && (
                    <li className="empty transactions-empty">
                      {transactions.length === 0
                        ? "История пуста. Запишите первую операцию слева."
                        : "По этому запросу операций не найдено."}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </section>
        )}

        {tab === "budget" && (
          <section className="panel budget-panel">
            <header className="panel-head budget-head">
              <div>
                <p className="eyebrow">
                  {budgetScope === "month" ? "План на месяц" : "План на год"}
                </p>
                <h2>Бюджет</h2>
              </div>
            </header>

            <div className="budget-toolbar">
              <div className="budget-toolbar-top">
                <div className="kind-toggle" role="group" aria-label="Период бюджета">
                  <button
                    type="button"
                    className={budgetScope === "month" ? "active" : ""}
                    onClick={() => {
                      budgetDraftsDirtyRef.current = false;
                      setBudgetScope("month");
                    }}
                  >
                    Месяц
                  </button>
                  <button
                    type="button"
                    className={budgetScope === "year" ? "active" : ""}
                    onClick={() => {
                      budgetDraftsDirtyRef.current = false;
                      setBudgetScope("year");
                    }}
                  >
                    Год
                  </button>
                </div>

                <div className="budget-toolbar-actions">
                  <button type="button" className="ghost" onClick={onCopyBudget}>
                    {budgetScope === "month" ? "На следующий месяц" : "На следующий год"}
                  </button>
                  {budgetScope === "year" && (
                    <button type="button" className="ghost" onClick={onApplyYearToMonths}>
                      Разложить на 12 месяцев
                    </button>
                  )}
                </div>
              </div>

              {budgetScope === "month" ? (
                <div className="budget-period-field budget-period-switcher">
                  <span>Месяц</span>
                  <MonthSwitcher
                    value={isYearMonth(yearMonth) ? yearMonth : currentYearMonth()}
                    onChange={commitYearMonth}
                    showToday={false}
                    ariaLabel="Месяц бюджета"
                  />
                </div>
              ) : (
                <label className="budget-period-field">
                  <span>Год</span>
                  <input
                    type="number"
                    min="2000"
                    max="2100"
                    value={budgetYearDraft}
                    onChange={(e) => onBudgetYearDraftChange(e.currentTarget.value)}
                    onBlur={onBudgetYearBlur}
                  />
                </label>
              )}
            </div>

            {budgetScope === "year" && yearBudgetSummary && (
              <div className="year-months">
                <h3>Месяцы года</h3>
                <ul>
                  {yearBudgetSummary.months.map((month, index) => (
                    <li key={month.yearMonth} className={month.hasBudget ? "filled" : ""}>
                      <button
                        type="button"
                        className="month-cell"
                        onClick={() => {
                          budgetDraftsDirtyRef.current = false;
                          setBudgetScope("month");
                          setYearMonth(month.yearMonth);
                        }}
                      >
                        <span>{MONTH_LABELS[index]}</span>
                        <strong className="mono">
                          {formatMoney(month.actualExpenseMinor, yearBudgetSummary.currency)}
                        </strong>
                        <em className="muted">
                          {month.hasBudget
                            ? `план ${formatMoney(month.plannedIncomeMinor, yearBudgetSummary.currency)}`
                            : "нет плана"}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <form
              className="budget-form"
              onSubmit={onSaveBudget}
              onKeyDown={onBudgetFormKeyDown}
            >
              <div className="budget-section budget-section-income">
                <div className="budget-section-head">
                  <div>
                    <span className="budget-section-index">01</span>
                    <h3>План доходов</h3>
                  </div>
                  <div className="budget-section-total">
                    <span>{incomeCategories.length} категорий</span>
                    <strong className="mono">
                      {formatMoney(draftIncomePlanMinor, primaryCurrency)}
                    </strong>
                  </div>
                </div>
                <p className="muted section-hint">
                  Все активные категории дохода из справочника. Укажите ожидаемую сумму
                  для каждой.
                </p>

                {incomeCategories.length > 0 ? (
                  <ul className="limit-list income-limits">
                    {incomeCategories.map((category) => {
                      const row = activeSummary?.categories.find(
                        (c) => c.categoryId === category.id,
                      );
                      return (
                        <li key={category.id} className={row?.status ?? "ok"}>
                          <div className="limit-meta">
                            <strong>
                              {category.name}
                              {category.is_essential ? (
                                <span className="tag">регулярный</span>
                              ) : (
                                <span className="tag soft">нерегулярный</span>
                              )}
                            </strong>
                            {row && activeSummary && (
                              <span className="muted">
                                факт {formatMoney(row.actualMinor, activeSummary.currency)} · ещё{" "}
                                {formatMoney(
                                  Math.max(row.remainingMinor, 0),
                                  activeSummary.currency,
                                )}{" "}
                                · {Math.round(row.usageRatio * 100)}%
                              </span>
                            )}
                            {row && (
                              <div className="meter" aria-hidden>
                                <i
                                  style={{
                                    width: `${Math.min(row.usageRatio * 100, 100)}%`,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          <label className="budget-amount">
                            <span>План</span>
                            <input
                              className="mono"
                              value={limitDrafts[category.id] ?? "0.00"}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                markBudgetDraftDirty();
                                setLimitDrafts((prev) => ({
                                  ...prev,
                                  [category.id]: value,
                                }));
                              }}
                              inputMode="decimal"
                              aria-label={`План дохода ${category.name}`}
                            />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="budget-empty">
                    <p>В справочнике пока нет категорий дохода.</p>
                    <button type="button" className="ghost" onClick={() => setTab("categories")}>
                      Создать категорию дохода
                    </button>
                  </div>
                )}

                {incomeCategories.length === 0 && (
                  <label className="plan-income">
                    {budgetScope === "month"
                      ? "Сводный плановый доход за месяц"
                      : "Сводный плановый доход за год"}
                    <input
                      className="mono"
                      value={plannedIncome}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        markBudgetDraftDirty();
                        setPlannedIncome(value);
                      }}
                    />
                    <small className="muted">
                      Временный вариант, пока не добавлены категории дохода.
                    </small>
                  </label>
                )}
              </div>

              <div className="budget-math budget-plan-summary" aria-label="Баланс плана">
                <div>
                  <span>План дохода</span>
                  <strong className="mono income">
                    {formatMoney(effectiveDraftIncomeMinor, primaryCurrency)}
                  </strong>
                </div>
                <div>
                  <span>Распределено на расходы</span>
                  <strong className="mono">
                    {formatMoney(draftExpensePlanMinor, primaryCurrency)}
                  </strong>
                </div>
                <div>
                  <span>Свободные</span>
                  <strong className={`mono ${draftFreeMinor < 0 ? "expense" : ""}`}>
                    {formatMoney(
                      effectiveDraftIncomeMinor - draftExpensePlanMinor,
                      primaryCurrency,
                    )}
                  </strong>
                </div>
                {activeSummary && (
                  <div>
                    <span>Факт доход / расход</span>
                    <strong className="mono">
                      {formatMoney(activeSummary.actualIncomeMinor, activeSummary.currency)}
                      {" / "}
                      {formatMoney(activeSummary.actualExpenseMinor, activeSummary.currency)}
                    </strong>
                  </div>
                )}
              </div>

              <div className="budget-section budget-section-expense">
                <div className="budget-section-head">
                  <div>
                    <span className="budget-section-index">02</span>
                    <h3>Лимиты расходов</h3>
                  </div>
                  <div className="budget-section-total">
                    <span>{expenseCategories.length} категорий</span>
                    <strong className="mono">
                      {formatMoney(draftExpensePlanMinor, primaryCurrency)}
                    </strong>
                  </div>
                </div>
                <p className="muted section-hint">
                  Все активные категории расходов из справочника. Нулевой лимит означает,
                  что сумма пока не запланирована.
                </p>

                {expenseCategories.length > 0 ? (
                  <ul className="limit-list">
                    {expenseCategories.map((category) => {
                      const row = activeSummary?.categories.find(
                        (c) => c.categoryId === category.id,
                      );
                      return (
                        <li key={category.id} className={row?.status ?? "ok"}>
                          <div className="limit-meta">
                            <strong>
                              {category.name}
                              {category.is_essential ? (
                                <span className="tag">обязательно</span>
                              ) : (
                                <span className="tag soft">необязательно</span>
                              )}
                            </strong>
                            {row && activeSummary && (
                              <span className="muted">
                                факт {formatMoney(row.actualMinor, activeSummary.currency)} ·
                                остаток{" "}
                                {formatMoney(row.remainingMinor, activeSummary.currency)} ·{" "}
                                {Math.round(row.usageRatio * 100)}%
                              </span>
                            )}
                            {row && (
                              <div className="meter" aria-hidden>
                                <i
                                  style={{
                                    width: `${Math.min(row.usageRatio * 100, 100)}%`,
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          <label className="budget-amount">
                            <span>Лимит</span>
                            <input
                              className="mono"
                              value={limitDrafts[category.id] ?? "0.00"}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                markBudgetDraftDirty();
                                setLimitDrafts((prev) => ({
                                  ...prev,
                                  [category.id]: value,
                                }));
                              }}
                              inputMode="decimal"
                              aria-label={`Лимит ${category.name}`}
                            />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="budget-empty">
                    <p>В справочнике пока нет категорий расходов.</p>
                    <button type="button" className="ghost" onClick={() => setTab("categories")}>
                      Создать категорию расхода
                    </button>
                  </div>
                )}
              </div>

              <div className="budget-save-bar">
                <div>
                  <span>Остаток после распределения</span>
                  <strong className={`mono ${draftFreeMinor < 0 ? "expense" : "income"}`}>
                    {formatMoney(draftFreeMinor, primaryCurrency)}
                  </strong>
                </div>
                <button type="submit" disabled={savingBudget}>
                {savingBudget
                  ? "Сохранение…"
                  : budgetScope === "month"
                    ? "Сохранить месяц"
                    : "Сохранить год"}
                </button>
              </div>
            </form>
          </section>
        )}

        {tab === "goals" && (
          <GoalsPanel
            currency={primaryCurrency}
            accounts={accounts}
            onChanged={async () => {
              setNotice("Пополнение цели записано в операции");
              await refresh();
            }}
          />
        )}

        {tab === "converter" && (
          <CurrencyConverterPanel defaultCurrency={primaryCurrency} />
        )}

        {tab === "import" && (
          <ImportPanel
            accounts={accounts}
            categories={categories}
            onImported={async () => {
              setNotice("Выписка импортирована");
              await refresh();
            }}
          />
        )}

        {tab === "categories" && (
          <CategoriesPanel
            categories={categories}
            onCreate={onCreateCategory}
            onUpdate={onUpdateCategory}
            onArchive={onArchiveCategory}
          />
        )}
      </main>

      <aside className="rail" id="app-nav">
        <div className="brand">
          <h1>Finance</h1>
        </div>
        <nav className="nav" aria-label="Разделы">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? "nav-item active" : "nav-item"}
              onClick={() => goToTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <p className="rail-note">Данные только на этом устройстве</p>
      </aside>

    </div>
  );
}

export default App;
