import type { CategoryBudgetRow, MonthBudgetSummary, YearMonthProgress } from "./budget";

export type CategoryShare = {
  categoryId: number | null;
  categoryName: string;
  isEssential: boolean;
  amountMinor: number;
  shareRatio: number;
};

export type MonthCashflow = {
  yearMonth: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
};

export type AnalyticsOverview = {
  currency: string;
  yearMonth: string;
  year: string;
  balanceMinor: number;
  accounts: {
    accountId: number;
    name: string;
    currency: string;
    balanceMinor: number;
  }[];
  month: {
    incomeMinor: number;
    expenseMinor: number;
    netMinor: number;
    savingsRate: number | null;
    avgDailyExpenseMinor: number;
    daysElapsed: number;
    daysInMonth: number;
    essentialExpenseMinor: number;
    discretionaryExpenseMinor: number;
    uncategorizedExpenseMinor: number;
    expenseCategories: CategoryShare[];
    incomeCategories: CategoryShare[];
  };
  yearFlow: {
    incomeMinor: number;
    expenseMinor: number;
    netMinor: number;
    savingsRate: number | null;
    essentialExpenseMinor: number;
    discretionaryExpenseMinor: number;
    expenseCategories: CategoryShare[];
    months: MonthCashflow[];
  };
  monthBudget: MonthBudgetSummary;
  yearBudget: {
    plannedIncomeMinor: number;
    allocatedMinor: number;
    freeMinor: number;
    actualIncomeMinor: number;
    actualExpenseMinor: number;
    categories: CategoryBudgetRow[];
    months: YearMonthProgress[];
  };
  alerts: CategoryBudgetRow[];
  recentTransactions: {
    id: number;
    title: string;
    amountMinor: number;
    currency: string;
    occurredAt: string;
    categoryName: string | null;
  }[];
};

export function savingsRate(incomeMinor: number, expenseMinor: number): number | null {
  if (!Number.isSafeInteger(incomeMinor) || !Number.isSafeInteger(expenseMinor)) {
    throw new Error("Некорректные суммы для нормы сбережений");
  }
  if (incomeMinor <= 0) {
    return null;
  }
  return (incomeMinor - expenseMinor) / incomeMinor;
}

export function buildCategoryShares(
  rows: {
    categoryId: number | null;
    categoryName: string;
    isEssential: boolean;
    amountMinor: number;
  }[],
): CategoryShare[] {
  const total = rows.reduce((sum, row) => {
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor < 0) {
      throw new Error("Сумма категории должна быть неотрицательным целым");
    }
    return sum + row.amountMinor;
  }, 0);

  return rows
    .filter((row) => row.amountMinor > 0)
    .map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      isEssential: row.isEssential,
      amountMinor: row.amountMinor,
      shareRatio: total === 0 ? 0 : row.amountMinor / total,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.categoryName.localeCompare(b.categoryName, "ru"));
}

export function averageDailyExpense(
  expenseMinor: number,
  daysElapsed: number,
): number {
  if (!Number.isSafeInteger(expenseMinor) || expenseMinor < 0) {
    throw new Error("Расход должен быть неотрицательным целым");
  }
  if (!Number.isInteger(daysElapsed) || daysElapsed <= 0) {
    return 0;
  }
  return Math.trunc(expenseMinor / daysElapsed);
}

export function daysElapsedInMonthUtc(yearMonth: string, now = new Date()): number {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    throw new Error("Ожидается формат YYYY-MM");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const sameMonth =
    now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month;
  if (!sameMonth) {
    // Past months: full month; future months: 0 elapsed for averages
    const monthStart = Date.UTC(year, month - 1, 1);
    if (now.getTime() < monthStart) {
      return 0;
    }
    return daysInMonth;
  }
  return Math.min(Math.max(now.getUTCDate(), 1), daysInMonth);
}

export function daysInMonthUtc(yearMonth: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    throw new Error("Ожидается формат YYYY-MM");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatPercent(ratio: number | null, digits = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) {
    return "—";
  }
  return `${(ratio * 100).toFixed(digits)}%`;
}
