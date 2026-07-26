export type BudgetLimitInput = {
  categoryId: number;
  categoryName: string;
  isEssential: boolean;
  limitMinor: number;
  kind: "income" | "expense";
};

export type CategoryActual = {
  categoryId: number;
  spentMinor: number;
};

export type CategoryBudgetRow = {
  categoryId: number;
  categoryName: string;
  isEssential: boolean;
  kind: "income" | "expense";
  planMinor: number;
  actualMinor: number;
  remainingMinor: number;
  usageRatio: number;
  status: "ok" | "near" | "over";
};

export type MonthBudgetSummary = {
  currency: string;
  plannedIncomeMinor: number;
  allocatedMinor: number;
  freeMinor: number;
  actualIncomeMinor: number;
  actualExpenseMinor: number;
  categories: CategoryBudgetRow[];
};

export type YearBudgetSummary = MonthBudgetSummary & {
  year: string;
  months: YearMonthProgress[];
};

export type YearMonthProgress = {
  yearMonth: string;
  plannedIncomeMinor: number;
  allocatedMinor: number;
  actualIncomeMinor: number;
  actualExpenseMinor: number;
  hasBudget: boolean;
};

/** Near-limit warning threshold (90%). */
export const NEAR_LIMIT_RATIO = 0.9;

function buildCategoryRow(
  limit: BudgetLimitInput,
  actualMinor: number,
): CategoryBudgetRow {
  if (!Number.isSafeInteger(limit.limitMinor) || limit.limitMinor < 0) {
    throw new Error("Лимит категории должен быть неотрицательным целым");
  }
  if (!Number.isSafeInteger(actualMinor) || actualMinor < 0) {
    throw new Error("Фактическая сумма категории должна быть неотрицательным целым");
  }

  const remainingMinor = limit.limitMinor - actualMinor;
  const usageRatio =
    limit.limitMinor === 0 ? (actualMinor > 0 ? 1 : 0) : actualMinor / limit.limitMinor;

  let status: CategoryBudgetRow["status"] = "ok";
  if (limit.kind === "expense") {
    if (actualMinor > limit.limitMinor) {
      status = "over";
    } else if (limit.limitMinor > 0 && usageRatio >= NEAR_LIMIT_RATIO) {
      status = "near";
    }
  }

  return {
    categoryId: limit.categoryId,
    categoryName: limit.categoryName,
    isEssential: limit.isEssential,
    kind: limit.kind,
    planMinor: limit.limitMinor,
    actualMinor,
    remainingMinor,
    usageRatio,
    status,
  };
}

export function expenseLimitWarning(input: {
  categoryName: string;
  planMinor: number;
  actualMinor: number;
  addedExpenseMinor: number;
}): string | null {
  const plan = input.planMinor;
  if (!Number.isSafeInteger(plan) || plan <= 0) {
    return null;
  }
  const added = Math.abs(input.addedExpenseMinor);
  if (!Number.isSafeInteger(added) || added <= 0) {
    return null;
  }
  const nextActual = input.actualMinor + added;
  if (!Number.isSafeInteger(nextActual)) {
    return null;
  }
  if (nextActual > plan) {
    return `Лимит «${input.categoryName}» будет превышен — операция всё равно сохранится`;
  }
  if (nextActual / plan >= NEAR_LIMIT_RATIO) {
    return `Расход близко к лимиту «${input.categoryName}»`;
  }
  return null;
}

export function buildBudgetSummary(input: {
  currency: string;
  plannedIncomeMinor: number;
  limits: BudgetLimitInput[];
  expenseActuals: CategoryActual[];
  incomeActuals?: CategoryActual[];
  actualIncomeMinor: number;
}): MonthBudgetSummary {
  const {
    currency,
    plannedIncomeMinor,
    limits,
    expenseActuals,
    incomeActuals = [],
    actualIncomeMinor,
  } = input;

  if (!Number.isSafeInteger(plannedIncomeMinor) || plannedIncomeMinor < 0) {
    throw new Error("Плановый доход должен быть неотрицательным целым");
  }
  if (!Number.isSafeInteger(actualIncomeMinor) || actualIncomeMinor < 0) {
    throw new Error("Фактический доход должен быть неотрицательным целым");
  }

  const expenseByCategory = new Map<number, number>();
  for (const row of expenseActuals) {
    if (!Number.isSafeInteger(row.spentMinor) || row.spentMinor < 0) {
      throw new Error("Фактический расход должен быть неотрицательным целым");
    }
    expenseByCategory.set(row.categoryId, row.spentMinor);
  }

  const incomeByCategory = new Map<number, number>();
  for (const row of incomeActuals) {
    if (!Number.isSafeInteger(row.spentMinor) || row.spentMinor < 0) {
      throw new Error("Фактический доход категории должен быть неотрицательным целым");
    }
    incomeByCategory.set(row.categoryId, row.spentMinor);
  }

  let allocatedMinor = 0;
  let plannedFromCategories = 0;
  let actualExpenseMinor = 0;
  const categories: CategoryBudgetRow[] = [];

  for (const limit of limits) {
    if (limit.kind === "expense") {
      allocatedMinor += limit.limitMinor;
      if (!Number.isSafeInteger(allocatedMinor)) {
        throw new Error("Переполнение при расчёте бюджета");
      }
      const actualMinor = expenseByCategory.get(limit.categoryId) ?? 0;
      actualExpenseMinor += actualMinor;
      categories.push(buildCategoryRow(limit, actualMinor));
      continue;
    }

    plannedFromCategories += limit.limitMinor;
    if (!Number.isSafeInteger(plannedFromCategories)) {
      throw new Error("Переполнение при расчёте планового дохода");
    }
    const actualMinor = incomeByCategory.get(limit.categoryId) ?? 0;
    categories.push(buildCategoryRow(limit, actualMinor));
  }

  // Prefer the explicit total when set; otherwise derive from income category plans.
  const effectivePlannedIncome =
    plannedIncomeMinor > 0 ? plannedIncomeMinor : plannedFromCategories;

  categories.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "income" ? -1 : 1;
    }
    if (a.isEssential !== b.isEssential) {
      return a.isEssential ? -1 : 1;
    }
    return a.categoryName.localeCompare(b.categoryName, "ru");
  });

  return {
    currency,
    plannedIncomeMinor: effectivePlannedIncome,
    allocatedMinor,
    freeMinor: effectivePlannedIncome - allocatedMinor,
    actualIncomeMinor,
    actualExpenseMinor,
    categories,
  };
}

/** @deprecated Use buildBudgetSummary — same rules for month and year. */
export const buildMonthBudgetSummary = buildBudgetSummary;

/**
 * Split a yearly minor amount across 12 months.
 * Remainder goes +1 to the first `remainder` months.
 */
export function splitYearlyMinorAcrossMonths(totalMinor: number): number[] {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new Error("Годовая сумма должна быть неотрицательным целым");
  }
  const base = Math.trunc(totalMinor / 12);
  const remainder = totalMinor % 12;
  return Array.from({ length: 12 }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function nextYearMonth(yearMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    throw new Error("Ожидается формат YYYY-MM");
  }
  let year = Number(match[1]);
  let month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error("Некорректный месяц");
  }
  month += 1;
  if (month === 13) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function monthBoundsUtc(yearMonth: string): { startIso: string; endIso: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    throw new Error("Ожидается формат YYYY-MM");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function currentYearMonth(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function currentYear(now = new Date()): string {
  return String(now.getUTCFullYear());
}

export function nextYear(year: string): string {
  const match = /^(\d{4})$/.exec(year);
  if (!match) {
    throw new Error("Ожидается формат YYYY");
  }
  return String(Number(match[1]) + 1);
}

export function yearBoundsUtc(year: string): { startIso: string; endIso: string } {
  const match = /^(\d{4})$/.exec(year);
  if (!match) {
    throw new Error("Ожидается формат YYYY");
  }
  const y = Number(match[1]);
  return {
    startIso: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)).toISOString(),
    endIso: new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0, 0)).toISOString(),
  };
}

export function monthsOfYear(year: string): string[] {
  const match = /^(\d{4})$/.exec(year);
  if (!match) {
    throw new Error("Ожидается формат YYYY");
  }
  return Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    return `${year}-${month}`;
  });
}
