import Database from "@tauri-apps/plugin-sql";
import {
  buildBudgetSummary,
  currentYearMonth,
  monthBoundsUtc,
  monthsOfYear,
  nextYear,
  nextYearMonth,
  splitYearlyMinorAcrossMonths,
  yearBoundsUtc,
  type MonthBudgetSummary,
  type YearBudgetSummary,
  type YearMonthProgress,
} from "./budget";
import { parseMoneyInput, parseMoneyInputOrZero, sumMinor } from "./money";
import {
  averageDailyExpense,
  buildCategoryShares,
  daysElapsedInMonthUtc,
  daysInMonthUtc,
  savingsRate,
  type AnalyticsOverview,
  type MonthCashflow,
} from "./analytics";

export type Account = {
  id: number;
  name: string;
  currency: string;
  archived: number;
  created_at: string;
};

export type Category = {
  id: number;
  name: string;
  kind: "income" | "expense";
  is_essential: number;
  archived: number;
};

export type Transaction = {
  id: number;
  account_id: number;
  category_id: number | null;
  title: string;
  amount_minor: number;
  currency: string;
  occurred_at: string;
  transfer_group_id: string | null;
  created_at: string;
  account_name?: string;
  category_name?: string | null;
};

export type Budget = {
  id: number;
  year_month: string;
  currency: string;
  planned_income_minor: number;
  created_at: string;
  updated_at: string;
};

export type YearBudget = {
  id: number;
  year: string;
  currency: string;
  planned_income_minor: number;
  created_at: string;
  updated_at: string;
};

export type BudgetLimit = {
  id: number;
  budget_id: number;
  category_id: number;
  limit_minor: number;
  category_name?: string;
  category_kind?: "income" | "expense";
  is_essential?: number;
};

export type YearBudgetLimit = {
  id: number;
  year_budget_id: number;
  category_id: number;
  limit_minor: number;
  category_name?: string;
  category_kind?: "income" | "expense";
  is_essential?: number;
};

export type Goal = {
  id: number;
  title: string;
  currency: string;
  target_minor: number;
  deadline_date: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
};

export type GoalContribution = {
  id: number;
  goal_id: number;
  amount_minor: number;
  note: string | null;
  contributed_at: string;
  created_at: string;
  transaction_id?: number | null;
};

export type GoalSummary = Goal & {
  saved_minor: number;
};

const DB_URL = "sqlite:finance.db";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then(async (db) => {
      await db.execute("PRAGMA foreign_keys = ON");
      return db;
    });
  }
  return dbPromise;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newTransferGroupId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function listAccounts(includeArchived = false): Promise<Account[]> {
  const db = await getDb();
  if (includeArchived) {
    return db.select<Account[]>(
      "SELECT id, name, currency, archived, created_at FROM accounts ORDER BY archived ASC, id ASC",
    );
  }
  return db.select<Account[]>(
    "SELECT id, name, currency, archived, created_at FROM accounts WHERE archived = 0 ORDER BY id ASC",
  );
}

const ACCOUNT_CURRENCIES = new Set(["KZT", "USD", "EUR", "RUB", "GBP", "CNY"]);

export async function addAccount(input: {
  name: string;
  currency: string;
}): Promise<Account> {
  const name = input.name.trim();
  const currency = input.currency.trim().toUpperCase();
  if (!name) {
    throw new Error("Укажите название счёта");
  }
  if (name.length > 80) {
    throw new Error("Название слишком длинное");
  }
  if (!ACCOUNT_CURRENCIES.has(currency) && !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Укажите валюту ISO 4217 (например KZT)");
  }

  const db = await getDb();
  const duplicates = await db.select<Account[]>(
    `SELECT id, name, currency, archived, created_at
     FROM accounts
     WHERE archived = 0 AND lower(name) = lower($1)`,
    [name],
  );
  if (duplicates[0]) {
    throw new Error("Такой счёт уже есть");
  }

  await db.execute(
    `INSERT INTO accounts (name, currency, archived, created_at)
     VALUES ($1, $2, 0, $3)`,
    [name, currency, nowIso()],
  );

  const created = await db.select<Account[]>(
    `SELECT id, name, currency, archived, created_at
     FROM accounts
     WHERE archived = 0 AND name = $1
     ORDER BY id DESC
     LIMIT 1`,
    [name],
  );
  if (!created[0]) {
    throw new Error("Не удалось создать счёт");
  }
  return created[0];
}

export async function updateAccount(input: {
  id: number;
  name: string;
}): Promise<void> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Укажите название счёта");
  }
  if (name.length > 80) {
    throw new Error("Название слишком длинное");
  }

  const db = await getDb();
  const existing = await db.select<Account[]>(
    "SELECT id, name, currency, archived, created_at FROM accounts WHERE id = $1 AND archived = 0",
    [input.id],
  );
  if (!existing[0]) {
    throw new Error("Счёт не найден");
  }

  const duplicates = await db.select<Account[]>(
    `SELECT id FROM accounts
     WHERE archived = 0 AND lower(name) = lower($1) AND id <> $2`,
    [name, input.id],
  );
  if (duplicates[0]) {
    throw new Error("Такой счёт уже есть");
  }

  await db.execute("UPDATE accounts SET name = $1 WHERE id = $2", [name, input.id]);
}

export async function archiveAccount(id: number): Promise<void> {
  const db = await getDb();
  const existing = await db.select<Account[]>(
    "SELECT id, name, currency, archived, created_at FROM accounts WHERE id = $1 AND archived = 0",
    [id],
  );
  if (!existing[0]) {
    throw new Error("Счёт не найден");
  }

  const active = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM accounts WHERE archived = 0",
  );
  if ((active[0]?.count ?? 0) <= 1) {
    throw new Error("Нельзя архивировать единственный активный счёт");
  }

  // Soft-archive only — transaction history is preserved.
  await db.execute("UPDATE accounts SET archived = 1 WHERE id = $1", [id]);
}

export async function listCategories(kind?: "income" | "expense"): Promise<Category[]> {
  const db = await getDb();
  if (kind) {
    return db.select<Category[]>(
      "SELECT id, name, kind, is_essential, archived FROM categories WHERE archived = 0 AND kind = $1 ORDER BY is_essential DESC, name ASC",
      [kind],
    );
  }
  return db.select<Category[]>(
    "SELECT id, name, kind, is_essential, archived FROM categories WHERE archived = 0 ORDER BY kind ASC, is_essential DESC, name ASC",
  );
}

export async function addCategory(input: {
  name: string;
  kind: "income" | "expense";
  isEssential: boolean;
}): Promise<Category> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Укажите название категории");
  }
  if (name.length > 80) {
    throw new Error("Название слишком длинное");
  }
  if (input.kind !== "income" && input.kind !== "expense") {
    throw new Error("Некорректный тип категории");
  }

  const db = await getDb();
  const duplicates = await db.select<Category[]>(
    `SELECT id, name, kind, is_essential, archived
     FROM categories
     WHERE archived = 0 AND kind = $1 AND lower(name) = lower($2)`,
    [input.kind, name],
  );
  if (duplicates[0]) {
    throw new Error("Такая категория уже есть");
  }

  await db.execute(
    `INSERT INTO categories (name, kind, is_essential, archived)
     VALUES ($1, $2, $3, 0)`,
    [name, input.kind, input.isEssential ? 1 : 0],
  );

  const created = await db.select<Category[]>(
    `SELECT id, name, kind, is_essential, archived
     FROM categories
     WHERE archived = 0 AND kind = $1 AND name = $2
     ORDER BY id DESC
     LIMIT 1`,
    [input.kind, name],
  );
  if (!created[0]) {
    throw new Error("Не удалось создать категорию");
  }
  return created[0];
}

export async function updateCategory(input: {
  id: number;
  name: string;
  isEssential: boolean;
}): Promise<void> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Укажите название категории");
  }
  if (name.length > 80) {
    throw new Error("Название слишком длинное");
  }

  const db = await getDb();
  const existing = await db.select<Category[]>(
    "SELECT id, name, kind, is_essential, archived FROM categories WHERE id = $1 AND archived = 0",
    [input.id],
  );
  const category = existing[0];
  if (!category) {
    throw new Error("Категория не найдена");
  }

  const duplicates = await db.select<Category[]>(
    `SELECT id FROM categories
     WHERE archived = 0 AND kind = $1 AND lower(name) = lower($2) AND id != $3`,
    [category.kind, name, input.id],
  );
  if (duplicates[0]) {
    throw new Error("Такая категория уже есть");
  }

  await db.execute(
    `UPDATE categories
     SET name = $1, is_essential = $2
     WHERE id = $3 AND archived = 0`,
    [name, input.isEssential ? 1 : 0, input.id],
  );
}

/**
 * Soft-delete: keeps transaction history, hides category from new operations.
 */
export async function archiveCategory(id: number): Promise<void> {
  const db = await getDb();
  const existing = await db.select<Category[]>(
    "SELECT id, name, kind, is_essential, archived FROM categories WHERE id = $1 AND archived = 0",
    [id],
  );
  if (!existing[0]) {
    throw new Error("Категория не найдена");
  }

  // Remove plan limits first, then hide the category.
  await db.execute("DELETE FROM budget_limits WHERE category_id = $1", [id]);
  try {
    await db.execute("DELETE FROM year_budget_limits WHERE category_id = $1", [id]);
  } catch {
    // year_budget_limits may be absent on older DBs before migration 3.
  }

  const result = await db.execute(
    "UPDATE categories SET archived = 1 WHERE id = $1 AND archived = 0",
    [id],
  );
  if ((result.rowsAffected ?? 0) < 1) {
    throw new Error("Не удалось удалить категорию");
  }
}

export async function listTransactions(limit = 100): Promise<Transaction[]> {
  const db = await getDb();
  return db.select<Transaction[]>(
    `SELECT t.id, t.account_id, t.category_id, t.title, t.amount_minor, t.currency,
            t.occurred_at, t.transfer_group_id, t.created_at,
            a.name AS account_name, c.name AS category_name
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     ORDER BY t.occurred_at DESC, t.id DESC
     LIMIT $1`,
    [limit],
  );
}

export type AddTransactionInput = {
  accountId: number;
  categoryId: number | null;
  title: string;
  amountInput: string;
  /** Positive for income, negative for expense — sign is applied from kind if provided. */
  kind: "income" | "expense";
  currency: string;
  occurredAt?: string;
};

export async function addTransaction(input: AddTransactionInput): Promise<void> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Укажите описание операции");
  }

  let amountMinor = parseMoneyInput(input.amountInput, input.currency);
  if (amountMinor === 0) {
    throw new Error("Сумма не может быть нулевой");
  }

  if (input.kind === "income" && amountMinor < 0) {
    amountMinor = Math.abs(amountMinor);
  }
  if (input.kind === "expense" && amountMinor > 0) {
    amountMinor = -amountMinor;
  }

  if (input.kind === "expense" && input.categoryId == null) {
    throw new Error("Для расхода выберите категорию");
  }

  const db = await getDb();
  const accounts = await db.select<Account[]>(
    "SELECT id, name, currency, archived, created_at FROM accounts WHERE id = $1 AND archived = 0",
    [input.accountId],
  );
  const account = accounts[0];
  if (!account) {
    throw new Error("Счёт не найден");
  }
  if (account.currency !== input.currency) {
    throw new Error("Валюта операции должна совпадать с валютой счёта");
  }

  if (input.categoryId != null) {
    const categories = await db.select<Category[]>(
      "SELECT id, name, kind, is_essential, archived FROM categories WHERE id = $1 AND archived = 0",
      [input.categoryId],
    );
    const category = categories[0];
    if (!category) {
      throw new Error("Категория не найдена");
    }
    if (category.kind !== input.kind) {
      throw new Error("Тип категории не совпадает с типом операции");
    }
  }

  const occurredAt = input.occurredAt ?? nowIso();
  const createdAt = nowIso();

  await db.execute(
    `INSERT INTO transactions
      (account_id, category_id, title, amount_minor, currency, occurred_at, transfer_group_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
    [
      input.accountId,
      input.categoryId,
      title,
      amountMinor,
      input.currency,
      occurredAt,
      createdAt,
    ],
  );
}

export type ImportTransactionRow = {
  title: string;
  amountMinor: number;
  occurredAt: string;
  categoryId: number | null;
};

export async function importTransactions(input: {
  accountId: number;
  rows: ImportTransactionRow[];
  skipDuplicates?: boolean;
}): Promise<{ imported: number; skippedDuplicates: number }> {
  if (input.rows.length === 0) {
    throw new Error("Нет строк для импорта");
  }
  if (input.rows.length > 2_000) {
    throw new Error("Слишком много строк для одного импорта");
  }

  const db = await getDb();
  const accounts = await db.select<Account[]>(
    "SELECT id, name, currency, archived, created_at FROM accounts WHERE id = $1 AND archived = 0",
    [input.accountId],
  );
  const account = accounts[0];
  if (!account) {
    throw new Error("Счёт не найден");
  }

  const categories = await listCategories();
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  let imported = 0;
  let skippedDuplicates = 0;
  const createdAt = nowIso();

  for (const row of input.rows) {
    const title = row.title.trim();
    if (!title) {
      throw new Error("У операции пустое описание");
    }
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor === 0) {
      throw new Error("Некорректная сумма операции");
    }
    if (Number.isNaN(Date.parse(row.occurredAt))) {
      throw new Error("Некорректная дата операции");
    }

    const kind = row.amountMinor < 0 ? "expense" : "income";
    if (kind === "expense" && row.categoryId == null) {
      throw new Error("Для расходов нужна категория");
    }
    if (row.categoryId != null) {
      const category = categoryById.get(row.categoryId);
      if (!category) {
        throw new Error("Категория не найдена");
      }
      if (category.kind !== kind) {
        throw new Error("Тип категории не совпадает с типом операции");
      }
    }

    if (input.skipDuplicates !== false) {
      const duplicates = await db.select<{ id: number }[]>(
        `SELECT id FROM transactions
         WHERE account_id = $1
           AND amount_minor = $2
           AND title = $3
           AND occurred_at = $4
         LIMIT 1`,
        [input.accountId, row.amountMinor, title, row.occurredAt],
      );
      if (duplicates[0]) {
        skippedDuplicates += 1;
        continue;
      }
    }

    await db.execute(
      `INSERT INTO transactions
        (account_id, category_id, title, amount_minor, currency, occurred_at, transfer_group_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
      [
        input.accountId,
        row.categoryId,
        title,
        row.amountMinor,
        account.currency,
        row.occurredAt,
        createdAt,
      ],
    );
    imported += 1;
  }

  return { imported, skippedDuplicates };
}

export async function deleteTransaction(id: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ transfer_group_id: string | null }[]>(
    "SELECT transfer_group_id FROM transactions WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (!row) {
    return;
  }

  if (row.transfer_group_id) {
    await db.execute("DELETE FROM transactions WHERE transfer_group_id = $1", [
      row.transfer_group_id,
    ]);
    return;
  }

  await db.execute("DELETE FROM transactions WHERE id = $1", [id]);
}

export type UpdateTransactionInput = {
  id: number;
  accountId: number;
  categoryId: number | null;
  title: string;
  amountInput: string;
  kind: "income" | "expense";
  currency: string;
  occurredAt: string;
};

export async function updateTransaction(input: UpdateTransactionInput): Promise<void> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Укажите описание операции");
  }
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    throw new Error("Некорректная дата операции");
  }

  let amountMinor = parseMoneyInput(input.amountInput, input.currency);
  if (amountMinor === 0) {
    throw new Error("Сумма не может быть нулевой");
  }
  if (input.kind === "income" && amountMinor < 0) {
    amountMinor = Math.abs(amountMinor);
  }
  if (input.kind === "expense" && amountMinor > 0) {
    amountMinor = -amountMinor;
  }
  if (input.kind === "expense" && input.categoryId == null) {
    throw new Error("Для расхода выберите категорию");
  }

  const db = await getDb();
  const existing = await db.select<{ id: number; transfer_group_id: string | null }[]>(
    "SELECT id, transfer_group_id FROM transactions WHERE id = $1",
    [input.id],
  );
  if (!existing[0]) {
    throw new Error("Операция не найдена");
  }
  if (existing[0].transfer_group_id) {
    throw new Error("Перевод нельзя редактировать — удалите и создайте заново");
  }

  const accounts = await db.select<Account[]>(
    "SELECT id, name, currency, archived, created_at FROM accounts WHERE id = $1 AND archived = 0",
    [input.accountId],
  );
  const account = accounts[0];
  if (!account) {
    throw new Error("Счёт не найден");
  }
  if (account.currency !== input.currency) {
    throw new Error("Валюта операции должна совпадать с валютой счёта");
  }

  if (input.categoryId != null) {
    const categories = await db.select<Category[]>(
      "SELECT id, name, kind, is_essential, archived FROM categories WHERE id = $1 AND archived = 0",
      [input.categoryId],
    );
    const category = categories[0];
    if (!category) {
      throw new Error("Категория не найдена");
    }
    if (category.kind !== input.kind) {
      throw new Error("Тип категории не совпадает с типом операции");
    }
  }

  await db.execute(
    `UPDATE transactions
     SET account_id = $1,
         category_id = $2,
         title = $3,
         amount_minor = $4,
         currency = $5,
         occurred_at = $6
     WHERE id = $7`,
    [
      input.accountId,
      input.categoryId,
      title,
      amountMinor,
      input.currency,
      input.occurredAt,
      input.id,
    ],
  );
}

export async function transferBetweenAccounts(input: {
  fromAccountId: number;
  toAccountId: number;
  amountInput: string;
  title?: string;
  occurredAt?: string;
}): Promise<void> {
  if (input.fromAccountId === input.toAccountId) {
    throw new Error("Выберите разные счета");
  }

  const db = await getDb();
  const accounts = await db.select<Account[]>(
    "SELECT id, name, currency, archived, created_at FROM accounts WHERE id IN ($1, $2) AND archived = 0",
    [input.fromAccountId, input.toAccountId],
  );
  const from = accounts.find((a) => a.id === input.fromAccountId);
  const to = accounts.find((a) => a.id === input.toAccountId);
  if (!from || !to) {
    throw new Error("Счёт не найден");
  }
  if (from.currency !== to.currency) {
    throw new Error("Перевод между разными валютами требует явного курса");
  }

  const amountMinor = Math.abs(parseMoneyInput(input.amountInput, from.currency));
  if (amountMinor === 0) {
    throw new Error("Сумма не может быть нулевой");
  }

  const groupId = newTransferGroupId();
  const occurredAt =
    input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt))
      ? input.occurredAt
      : nowIso();
  const createdAt = nowIso();
  const title = (input.title ?? "Перевод").trim() || "Перевод";

  await db.execute("BEGIN IMMEDIATE");
  try {
    await db.execute(
      `INSERT INTO transactions
        (account_id, category_id, title, amount_minor, currency, occurred_at, transfer_group_id, created_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)`,
      [
        from.id,
        `${title} → ${to.name}`,
        -amountMinor,
        from.currency,
        occurredAt,
        groupId,
        createdAt,
      ],
    );
    await db.execute(
      `INSERT INTO transactions
        (account_id, category_id, title, amount_minor, currency, occurred_at, transfer_group_id, created_at)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)`,
      [
        to.id,
        `${title} ← ${from.name}`,
        amountMinor,
        to.currency,
        occurredAt,
        groupId,
        createdAt,
      ],
    );
    await db.execute("COMMIT");
  } catch (error) {
    try {
      await db.execute("ROLLBACK");
    } catch {
      await db.execute("DELETE FROM transactions WHERE transfer_group_id = $1", [groupId]);
    }
    throw error;
  }
}

export async function getAccountBalances(): Promise<
  { accountId: number; name: string; currency: string; balanceMinor: number }[]
> {
  const db = await getDb();
  const accounts = await listAccounts();
  const balances: { accountId: number; name: string; currency: string; balanceMinor: number }[] =
    [];

  for (const account of accounts) {
    const rows = await db.select<{ total: number | null }[]>(
      "SELECT COALESCE(SUM(amount_minor), 0) AS total FROM transactions WHERE account_id = $1",
      [account.id],
    );
    balances.push({
      accountId: account.id,
      name: account.name,
      currency: account.currency,
      balanceMinor: Number(rows[0]?.total ?? 0),
    });
  }

  return balances;
}

const budgetCreateLocks = new Map<string, Promise<Budget>>();
const yearBudgetCreateLocks = new Map<string, Promise<YearBudget>>();

export async function getOrCreateBudget(yearMonth: string, currency: string): Promise<Budget> {
  const lockKey = `${yearMonth}:${currency}`;
  const inFlight = budgetCreateLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const db = await getDb();
    const existing = await db.select<Budget[]>(
      "SELECT id, year_month, currency, planned_income_minor, created_at, updated_at FROM budgets WHERE year_month = $1",
      [yearMonth],
    );
    if (existing[0]) {
      return existing[0];
    }

    const stamp = nowIso();
    await db.execute(
      `INSERT INTO budgets (year_month, currency, planned_income_minor, created_at, updated_at)
       VALUES ($1, $2, 0, $3, $4)
       ON CONFLICT(year_month) DO NOTHING`,
      [yearMonth, currency, stamp, stamp],
    );

    const created = await db.select<Budget[]>(
      "SELECT id, year_month, currency, planned_income_minor, created_at, updated_at FROM budgets WHERE year_month = $1",
      [yearMonth],
    );
    if (!created[0]) {
      throw new Error("Не удалось создать бюджет");
    }
    return created[0];
  })();

  budgetCreateLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    budgetCreateLocks.delete(lockKey);
  }
}

export async function updateBudgetPlan(input: {
  yearMonth: string;
  currency: string;
  plannedIncomeInput: string;
  limits: { categoryId: number; limitInput: string }[];
}): Promise<void> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.yearMonth)) {
    throw new Error("Некорректный месяц бюджета");
  }

  const categories = await listCategories();
  const kindById = new Map(categories.map((category) => [category.id, category.kind]));

  let plannedFromIncome = 0;
  const parsedLimits: { categoryId: number; limitMinor: number }[] = [];
  for (const limit of input.limits) {
    const limitMinor = Math.abs(
      parseMoneyInputOrZero(limit.limitInput || "0", input.currency),
    );
    parsedLimits.push({ categoryId: limit.categoryId, limitMinor });
    if (kindById.get(limit.categoryId) === "income") {
      plannedFromIncome += limitMinor;
      if (!Number.isSafeInteger(plannedFromIncome)) {
        throw new Error("Переполнение при расчёте планового дохода");
      }
    }
  }

  const fallbackPlanned = Math.abs(
    parseMoneyInputOrZero(input.plannedIncomeInput || "0", input.currency),
  );
  const plannedIncomeMinor = plannedFromIncome > 0 ? plannedFromIncome : fallbackPlanned;

  const db = await getDb();
  const budget = await getOrCreateBudget(input.yearMonth, input.currency);
  const stamp = nowIso();

  await db.execute(
    `UPDATE budgets
     SET planned_income_minor = $1, currency = $2, updated_at = $3
     WHERE id = $4`,
    [plannedIncomeMinor, input.currency, stamp, budget.id],
  );

  await db.execute("DELETE FROM budget_limits WHERE budget_id = $1", [budget.id]);

  for (const limit of parsedLimits) {
    await db.execute(
      `INSERT INTO budget_limits (budget_id, category_id, limit_minor)
       VALUES ($1, $2, $3)
       ON CONFLICT(budget_id, category_id) DO UPDATE SET limit_minor = excluded.limit_minor`,
      [budget.id, limit.categoryId, limit.limitMinor],
    );
  }
}

export async function listBudgetLimits(budgetId: number): Promise<BudgetLimit[]> {
  const db = await getDb();
  return db.select<BudgetLimit[]>(
    `SELECT bl.id, bl.budget_id, bl.category_id, bl.limit_minor,
            c.name AS category_name, c.kind AS category_kind, c.is_essential
     FROM budget_limits bl
     JOIN categories c ON c.id = bl.category_id
     WHERE bl.budget_id = $1
     ORDER BY c.kind ASC, c.is_essential DESC, c.name ASC`,
    [budgetId],
  );
}

export async function getMonthBudgetSummary(yearMonth = currentYearMonth()): Promise<MonthBudgetSummary> {
  const accounts = await listAccounts();
  const primary = accounts[0];
  if (!primary) {
    throw new Error("Нет активного счёта");
  }

  const budget = await getOrCreateBudget(yearMonth, primary.currency);
  const limits = await listBudgetLimits(budget.id);
  const { startIso, endIso } = monthBoundsUtc(yearMonth);
  const db = await getDb();

  const expenseRows = await db.select<{ category_id: number; spent: number }[]>(
    `SELECT category_id, COALESCE(SUM(-amount_minor), 0) AS spent
     FROM transactions
     WHERE amount_minor < 0
       AND category_id IS NOT NULL
       AND currency = $1
       AND occurred_at >= $2
       AND occurred_at < $3
       AND transfer_group_id IS NULL
     GROUP BY category_id`,
    [budget.currency, startIso, endIso],
  );

  const incomeByCategory = await db.select<{ category_id: number; earned: number }[]>(
    `SELECT category_id, COALESCE(SUM(amount_minor), 0) AS earned
     FROM transactions
     WHERE amount_minor > 0
       AND category_id IS NOT NULL
       AND currency = $1
       AND occurred_at >= $2
       AND occurred_at < $3
       AND transfer_group_id IS NULL
     GROUP BY category_id`,
    [budget.currency, startIso, endIso],
  );

  const incomeRows = await db.select<{ total: number | null }[]>(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total
     FROM transactions
     WHERE amount_minor > 0
       AND currency = $1
       AND occurred_at >= $2
       AND occurred_at < $3
       AND transfer_group_id IS NULL`,
    [budget.currency, startIso, endIso],
  );

  const allCategories = await listCategories();
  const limitInputs =
    limits.length > 0
      ? limits.map((limit) => ({
          categoryId: limit.category_id,
          categoryName: limit.category_name ?? `#${limit.category_id}`,
          isEssential: Boolean(limit.is_essential),
          limitMinor: limit.limit_minor,
          kind: (limit.category_kind ?? "expense") as "income" | "expense",
        }))
      : allCategories
          .filter((category) => category.kind === "expense")
          .map((category) => ({
            categoryId: category.id,
            categoryName: category.name,
            isEssential: Boolean(category.is_essential),
            limitMinor: 0,
            kind: "expense" as const,
          }));

  return buildBudgetSummary({
    currency: budget.currency,
    plannedIncomeMinor: budget.planned_income_minor,
    limits: limitInputs,
    expenseActuals: expenseRows.map((row) => ({
      categoryId: row.category_id,
      spentMinor: Number(row.spent),
    })),
    incomeActuals: incomeByCategory.map((row) => ({
      categoryId: row.category_id,
      spentMinor: Number(row.earned),
    })),
    actualIncomeMinor: Number(incomeRows[0]?.total ?? 0),
  });
}

export async function getOrCreateYearBudget(year: string, currency: string): Promise<YearBudget> {
  const lockKey = `${year}:${currency}`;
  const inFlight = yearBudgetCreateLocks.get(lockKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async () => {
    const db = await getDb();
    const existing = await db.select<YearBudget[]>(
      "SELECT id, year, currency, planned_income_minor, created_at, updated_at FROM year_budgets WHERE year = $1",
      [year],
    );
    if (existing[0]) {
      return existing[0];
    }

    const stamp = nowIso();
    await db.execute(
      `INSERT INTO year_budgets (year, currency, planned_income_minor, created_at, updated_at)
       VALUES ($1, $2, 0, $3, $4)
       ON CONFLICT(year) DO NOTHING`,
      [year, currency, stamp, stamp],
    );

    const created = await db.select<YearBudget[]>(
      "SELECT id, year, currency, planned_income_minor, created_at, updated_at FROM year_budgets WHERE year = $1",
      [year],
    );
    if (!created[0]) {
      throw new Error("Не удалось создать годовой бюджет");
    }
    return created[0];
  })();

  yearBudgetCreateLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    yearBudgetCreateLocks.delete(lockKey);
  }
}

export async function updateYearBudgetPlan(input: {
  year: string;
  currency: string;
  plannedIncomeInput: string;
  limits: { categoryId: number; limitInput: string }[];
}): Promise<void> {
  if (!/^\d{4}$/.test(input.year)) {
    throw new Error("Некорректный год бюджета");
  }

  const categories = await listCategories();
  const kindById = new Map(categories.map((category) => [category.id, category.kind]));

  let plannedFromIncome = 0;
  const parsedLimits: { categoryId: number; limitMinor: number }[] = [];
  for (const limit of input.limits) {
    const limitMinor = Math.abs(
      parseMoneyInputOrZero(limit.limitInput || "0", input.currency),
    );
    parsedLimits.push({ categoryId: limit.categoryId, limitMinor });
    if (kindById.get(limit.categoryId) === "income") {
      plannedFromIncome += limitMinor;
      if (!Number.isSafeInteger(plannedFromIncome)) {
        throw new Error("Переполнение при расчёте планового дохода");
      }
    }
  }

  const fallbackPlanned = Math.abs(
    parseMoneyInputOrZero(input.plannedIncomeInput || "0", input.currency),
  );
  const plannedIncomeMinor = plannedFromIncome > 0 ? plannedFromIncome : fallbackPlanned;

  const db = await getDb();
  const budget = await getOrCreateYearBudget(input.year, input.currency);
  const stamp = nowIso();

  await db.execute(
    `UPDATE year_budgets
     SET planned_income_minor = $1, currency = $2, updated_at = $3
     WHERE id = $4`,
    [plannedIncomeMinor, input.currency, stamp, budget.id],
  );

  await db.execute("DELETE FROM year_budget_limits WHERE year_budget_id = $1", [budget.id]);

  for (const limit of parsedLimits) {
    await db.execute(
      `INSERT INTO year_budget_limits (year_budget_id, category_id, limit_minor)
       VALUES ($1, $2, $3)
       ON CONFLICT(year_budget_id, category_id) DO UPDATE SET limit_minor = excluded.limit_minor`,
      [budget.id, limit.categoryId, limit.limitMinor],
    );
  }
}

export async function listYearBudgetLimits(yearBudgetId: number): Promise<YearBudgetLimit[]> {
  const db = await getDb();
  return db.select<YearBudgetLimit[]>(
    `SELECT ybl.id, ybl.year_budget_id, ybl.category_id, ybl.limit_minor,
            c.name AS category_name, c.kind AS category_kind, c.is_essential
     FROM year_budget_limits ybl
     JOIN categories c ON c.id = ybl.category_id
     WHERE ybl.year_budget_id = $1
     ORDER BY c.kind ASC, c.is_essential DESC, c.name ASC`,
    [yearBudgetId],
  );
}

export async function getYearBudgetSummary(year: string): Promise<YearBudgetSummary> {
  const accounts = await listAccounts();
  const primary = accounts[0];
  if (!primary) {
    throw new Error("Нет активного счёта");
  }

  const budget = await getOrCreateYearBudget(year, primary.currency);
  const limits = await listYearBudgetLimits(budget.id);
  const { startIso, endIso } = yearBoundsUtc(year);
  const db = await getDb();

  const expenseRows = await db.select<{ category_id: number; spent: number }[]>(
    `SELECT category_id, COALESCE(SUM(-amount_minor), 0) AS spent
     FROM transactions
     WHERE amount_minor < 0
       AND category_id IS NOT NULL
       AND currency = $1
       AND occurred_at >= $2
       AND occurred_at < $3
       AND transfer_group_id IS NULL
     GROUP BY category_id`,
    [budget.currency, startIso, endIso],
  );

  const incomeByCategory = await db.select<{ category_id: number; earned: number }[]>(
    `SELECT category_id, COALESCE(SUM(amount_minor), 0) AS earned
     FROM transactions
     WHERE amount_minor > 0
       AND category_id IS NOT NULL
       AND currency = $1
       AND occurred_at >= $2
       AND occurred_at < $3
       AND transfer_group_id IS NULL
     GROUP BY category_id`,
    [budget.currency, startIso, endIso],
  );

  const incomeRows = await db.select<{ total: number | null }[]>(
    `SELECT COALESCE(SUM(amount_minor), 0) AS total
     FROM transactions
     WHERE amount_minor > 0
       AND currency = $1
       AND occurred_at >= $2
       AND occurred_at < $3
       AND transfer_group_id IS NULL`,
    [budget.currency, startIso, endIso],
  );

  const allCategories = await listCategories();
  const limitInputs =
    limits.length > 0
      ? limits.map((limit) => ({
          categoryId: limit.category_id,
          categoryName: limit.category_name ?? `#${limit.category_id}`,
          isEssential: Boolean(limit.is_essential),
          limitMinor: limit.limit_minor,
          kind: (limit.category_kind ?? "expense") as "income" | "expense",
        }))
      : allCategories
          .filter((category) => category.kind === "expense")
          .map((category) => ({
            categoryId: category.id,
            categoryName: category.name,
            isEssential: Boolean(category.is_essential),
            limitMinor: 0,
            kind: "expense" as const,
          }));

  const summary = buildBudgetSummary({
    currency: budget.currency,
    plannedIncomeMinor: budget.planned_income_minor,
    limits: limitInputs,
    expenseActuals: expenseRows.map((row) => ({
      categoryId: row.category_id,
      spentMinor: Number(row.spent),
    })),
    incomeActuals: incomeByCategory.map((row) => ({
      categoryId: row.category_id,
      spentMinor: Number(row.earned),
    })),
    actualIncomeMinor: Number(incomeRows[0]?.total ?? 0),
  });

  const months: YearMonthProgress[] = [];
  for (const yearMonth of monthsOfYear(year)) {
    const monthBudgetRows = await db.select<Budget[]>(
      "SELECT id, year_month, currency, planned_income_minor, created_at, updated_at FROM budgets WHERE year_month = $1",
      [yearMonth],
    );
    const monthBudget = monthBudgetRows[0];
    const bounds = monthBoundsUtc(yearMonth);

    const monthIncome = await db.select<{ total: number | null }[]>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM transactions
       WHERE amount_minor > 0 AND currency = $1
         AND occurred_at >= $2 AND occurred_at < $3
         AND transfer_group_id IS NULL`,
      [budget.currency, bounds.startIso, bounds.endIso],
    );
    const monthExpense = await db.select<{ total: number | null }[]>(
      `SELECT COALESCE(SUM(-amount_minor), 0) AS total
       FROM transactions
       WHERE amount_minor < 0 AND currency = $1
         AND occurred_at >= $2 AND occurred_at < $3
         AND transfer_group_id IS NULL`,
      [budget.currency, bounds.startIso, bounds.endIso],
    );

    let allocatedMinor = 0;
    if (monthBudget) {
      const monthLimits = await listBudgetLimits(monthBudget.id);
      allocatedMinor = sumMinor(monthLimits.map((limit) => limit.limit_minor));
    }

    months.push({
      yearMonth,
      plannedIncomeMinor: monthBudget?.planned_income_minor ?? 0,
      allocatedMinor,
      actualIncomeMinor: Number(monthIncome[0]?.total ?? 0),
      actualExpenseMinor: Number(monthExpense[0]?.total ?? 0),
      hasBudget: Boolean(monthBudget),
    });
  }

  return {
    ...summary,
    year,
    months,
  };
}

export async function copyYearBudgetToNextYear(fromYear: string): Promise<string> {
  const target = nextYear(fromYear);
  const db = await getDb();

  const sourceRows = await db.select<YearBudget[]>(
    "SELECT id, year, currency, planned_income_minor, created_at, updated_at FROM year_budgets WHERE year = $1",
    [fromYear],
  );
  const source = sourceRows[0];
  if (!source) {
    throw new Error("Исходный годовой бюджет не найден");
  }

  const stamp = nowIso();
  const existing = await db.select<YearBudget[]>(
    "SELECT id, year, currency, planned_income_minor, created_at, updated_at FROM year_budgets WHERE year = $1",
    [target],
  );

  let targetBudgetId: number;
  if (existing[0]) {
    targetBudgetId = existing[0].id;
    await db.execute(
      `UPDATE year_budgets
       SET currency = $1, planned_income_minor = $2, updated_at = $3
       WHERE id = $4`,
      [source.currency, source.planned_income_minor, stamp, targetBudgetId],
    );
    await db.execute("DELETE FROM year_budget_limits WHERE year_budget_id = $1", [
      targetBudgetId,
    ]);
  } else {
    await db.execute(
      `INSERT INTO year_budgets (year, currency, planned_income_minor, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [target, source.currency, source.planned_income_minor, stamp, stamp],
    );
    const created = await db.select<YearBudget[]>(
      "SELECT id FROM year_budgets WHERE year = $1",
      [target],
    );
    const newBudget = created[0];
    if (!newBudget) {
      throw new Error("Не удалось скопировать годовой бюджет");
    }
    targetBudgetId = newBudget.id;
  }

  const limits = await listYearBudgetLimits(source.id);
  for (const limit of limits) {
    await db.execute(
      `INSERT INTO year_budget_limits (year_budget_id, category_id, limit_minor)
       VALUES ($1, $2, $3)`,
      [targetBudgetId, limit.category_id, limit.limit_minor],
    );
  }

  return target;
}

/**
 * Explicitly spreads the yearly plan into 12 monthly budgets.
 * Existing monthly budgets for that year are overwritten (plans only, not transactions).
 */
export async function applyYearBudgetToMonths(year: string): Promise<void> {
  const accounts = await listAccounts();
  const primary = accounts[0];
  if (!primary) {
    throw new Error("Нет активного счёта");
  }

  const yearBudget = await getOrCreateYearBudget(year, primary.currency);
  const yearLimits = await listYearBudgetLimits(yearBudget.id);
  if (yearBudget.planned_income_minor === 0 && yearLimits.length === 0) {
    throw new Error("Сначала задайте годовой план");
  }

  const incomeParts = splitYearlyMinorAcrossMonths(yearBudget.planned_income_minor);
  const limitPartsByCategory = new Map<number, number[]>();
  for (const limit of yearLimits) {
    limitPartsByCategory.set(
      limit.category_id,
      splitYearlyMinorAcrossMonths(limit.limit_minor),
    );
  }

  const db = await getDb();
  const months = monthsOfYear(year);
  for (let index = 0; index < months.length; index += 1) {
    const yearMonth = months[index]!;
    const monthBudget = await getOrCreateBudget(yearMonth, yearBudget.currency);
    const stamp = nowIso();

    await db.execute(
      `UPDATE budgets
       SET planned_income_minor = $1, currency = $2, updated_at = $3
       WHERE id = $4`,
      [incomeParts[index]!, yearBudget.currency, stamp, monthBudget.id],
    );

    await db.execute("DELETE FROM budget_limits WHERE budget_id = $1", [monthBudget.id]);

    for (const [categoryId, parts] of limitPartsByCategory) {
      const limitMinor = parts[index]!;
      if (limitMinor === 0) {
        continue;
      }
      await db.execute(
        `INSERT INTO budget_limits (budget_id, category_id, limit_minor)
         VALUES ($1, $2, $3)`,
        [monthBudget.id, categoryId, limitMinor],
      );
    }
  }
}

export async function copyBudgetToNextMonth(fromYearMonth: string): Promise<string> {
  const target = nextYearMonth(fromYearMonth);
  const db = await getDb();

  const sourceRows = await db.select<Budget[]>(
    "SELECT id, year_month, currency, planned_income_minor, created_at, updated_at FROM budgets WHERE year_month = $1",
    [fromYearMonth],
  );
  const source = sourceRows[0];
  if (!source) {
    throw new Error("Исходный бюджет не найден");
  }

  const stamp = nowIso();
  const existing = await db.select<Budget[]>(
    "SELECT id, year_month, currency, planned_income_minor, created_at, updated_at FROM budgets WHERE year_month = $1",
    [target],
  );

  let targetBudgetId: number;
  if (existing[0]) {
    targetBudgetId = existing[0].id;
    await db.execute(
      `UPDATE budgets
       SET currency = $1, planned_income_minor = $2, updated_at = $3
       WHERE id = $4`,
      [source.currency, source.planned_income_minor, stamp, targetBudgetId],
    );
    await db.execute("DELETE FROM budget_limits WHERE budget_id = $1", [targetBudgetId]);
  } else {
    await db.execute(
      `INSERT INTO budgets (year_month, currency, planned_income_minor, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [target, source.currency, source.planned_income_minor, stamp, stamp],
    );
    const created = await db.select<Budget[]>(
      "SELECT id FROM budgets WHERE year_month = $1",
      [target],
    );
    const newBudget = created[0];
    if (!newBudget) {
      throw new Error("Не удалось скопировать бюджет");
    }
    targetBudgetId = newBudget.id;
  }

  const limits = await listBudgetLimits(source.id);
  for (const limit of limits) {
    await db.execute(
      `INSERT INTO budget_limits (budget_id, category_id, limit_minor)
       VALUES ($1, $2, $3)`,
      [targetBudgetId, limit.category_id, limit.limit_minor],
    );
  }

  return target;
}

export async function getFullAnalytics(
  currency: string,
  yearMonth = currentYearMonth(),
): Promise<AnalyticsOverview> {
  const year = yearMonth.slice(0, 4);
  const balances = await getAccountBalances();
  const sameCurrency = balances.filter((b) => b.currency === currency);
  const balanceMinor = sumMinor(sameCurrency.map((b) => b.balanceMinor));

  const monthBounds = monthBoundsUtc(yearMonth);
  const yearBounds = yearBoundsUtc(year);
  const db = await getDb();

  async function periodTotals(startIso: string, endIso: string) {
    const incomeRows = await db.select<{ total: number | null }[]>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM transactions
       WHERE amount_minor > 0 AND currency = $1
         AND occurred_at >= $2 AND occurred_at < $3
         AND transfer_group_id IS NULL`,
      [currency, startIso, endIso],
    );
    const expenseRows = await db.select<{ total: number | null }[]>(
      `SELECT COALESCE(SUM(-amount_minor), 0) AS total
       FROM transactions
       WHERE amount_minor < 0 AND currency = $1
         AND occurred_at >= $2 AND occurred_at < $3
         AND transfer_group_id IS NULL`,
      [currency, startIso, endIso],
    );
    return {
      incomeMinor: Number(incomeRows[0]?.total ?? 0),
      expenseMinor: Number(expenseRows[0]?.total ?? 0),
    };
  }

  async function categoryBreakdown(
    startIso: string,
    endIso: string,
    kind: "expense" | "income",
  ) {
    if (kind === "expense") {
      const rows = await db.select<
        {
          category_id: number | null;
          category_name: string | null;
          is_essential: number | null;
          amount: number;
        }[]
      >(
        `SELECT t.category_id,
                c.name AS category_name,
                c.is_essential,
                COALESCE(SUM(-t.amount_minor), 0) AS amount
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE t.amount_minor < 0
           AND t.currency = $1
           AND t.occurred_at >= $2
           AND t.occurred_at < $3
           AND t.transfer_group_id IS NULL
         GROUP BY t.category_id, c.name, c.is_essential`,
        [currency, startIso, endIso],
      );
      return rows.map((row) => ({
        categoryId: row.category_id,
        categoryName: row.category_name ?? "Без категории",
        isEssential: Boolean(row.is_essential),
        amountMinor: Number(row.amount),
      }));
    }

    const rows = await db.select<
      {
        category_id: number | null;
        category_name: string | null;
        is_essential: number | null;
        amount: number;
      }[]
    >(
      `SELECT t.category_id,
              c.name AS category_name,
              c.is_essential,
              COALESCE(SUM(t.amount_minor), 0) AS amount
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.amount_minor > 0
         AND t.currency = $1
         AND t.occurred_at >= $2
         AND t.occurred_at < $3
         AND t.transfer_group_id IS NULL
       GROUP BY t.category_id, c.name, c.is_essential`,
      [currency, startIso, endIso],
    );
    return rows.map((row) => ({
      categoryId: row.category_id,
      categoryName: row.category_name ?? "Без категории",
      isEssential: Boolean(row.is_essential),
      amountMinor: Number(row.amount),
    }));
  }

  const [monthTotals, yearTotals, monthExpenseCats, monthIncomeCats, yearExpenseCats] =
    await Promise.all([
      periodTotals(monthBounds.startIso, monthBounds.endIso),
      periodTotals(yearBounds.startIso, yearBounds.endIso),
      categoryBreakdown(monthBounds.startIso, monthBounds.endIso, "expense"),
      categoryBreakdown(monthBounds.startIso, monthBounds.endIso, "income"),
      categoryBreakdown(yearBounds.startIso, yearBounds.endIso, "expense"),
    ]);

  const monthCashflows: MonthCashflow[] = [];
  for (const month of monthsOfYear(year)) {
    const bounds = monthBoundsUtc(month);
    const totals = await periodTotals(bounds.startIso, bounds.endIso);
    monthCashflows.push({
      yearMonth: month,
      incomeMinor: totals.incomeMinor,
      expenseMinor: totals.expenseMinor,
      netMinor: totals.incomeMinor - totals.expenseMinor,
    });
  }

  const monthBudget = await getMonthBudgetSummary(yearMonth);
  const yearBudget = await getYearBudgetSummary(year);
  const recent = await listTransactions(8);

  const daysElapsed = daysElapsedInMonthUtc(yearMonth);
  const daysInMonth = daysInMonthUtc(yearMonth);

  const monthEssential = sumMinor(
    monthExpenseCats.filter((c) => c.isEssential).map((c) => c.amountMinor),
  );
  const monthDiscretionary = sumMinor(
    monthExpenseCats
      .filter((c) => !c.isEssential && c.categoryId != null)
      .map((c) => c.amountMinor),
  );
  const monthUncategorized = sumMinor(
    monthExpenseCats.filter((c) => c.categoryId == null).map((c) => c.amountMinor),
  );

  const yearEssential = sumMinor(
    yearExpenseCats.filter((c) => c.isEssential).map((c) => c.amountMinor),
  );
  const yearDiscretionary = sumMinor(
    yearExpenseCats.filter((c) => !c.isEssential).map((c) => c.amountMinor),
  );

  return {
    currency,
    yearMonth,
    year,
    balanceMinor,
    accounts: sameCurrency.map((b) => ({
      accountId: b.accountId,
      name: b.name,
      currency: b.currency,
      balanceMinor: b.balanceMinor,
    })),
    month: {
      incomeMinor: monthTotals.incomeMinor,
      expenseMinor: monthTotals.expenseMinor,
      netMinor: monthTotals.incomeMinor - monthTotals.expenseMinor,
      savingsRate: savingsRate(monthTotals.incomeMinor, monthTotals.expenseMinor),
      avgDailyExpenseMinor: averageDailyExpense(monthTotals.expenseMinor, daysElapsed),
      daysElapsed,
      daysInMonth,
      essentialExpenseMinor: monthEssential,
      discretionaryExpenseMinor: monthDiscretionary,
      uncategorizedExpenseMinor: monthUncategorized,
      expenseCategories: buildCategoryShares(monthExpenseCats),
      incomeCategories: buildCategoryShares(monthIncomeCats),
    },
    yearFlow: {
      incomeMinor: yearTotals.incomeMinor,
      expenseMinor: yearTotals.expenseMinor,
      netMinor: yearTotals.incomeMinor - yearTotals.expenseMinor,
      savingsRate: savingsRate(yearTotals.incomeMinor, yearTotals.expenseMinor),
      essentialExpenseMinor: yearEssential,
      discretionaryExpenseMinor: yearDiscretionary,
      expenseCategories: buildCategoryShares(yearExpenseCats),
      months: monthCashflows,
    },
    monthBudget,
    yearBudget: {
      plannedIncomeMinor: yearBudget.plannedIncomeMinor,
      allocatedMinor: yearBudget.allocatedMinor,
      freeMinor: yearBudget.freeMinor,
      actualIncomeMinor: yearBudget.actualIncomeMinor,
      actualExpenseMinor: yearBudget.actualExpenseMinor,
      categories: yearBudget.categories,
      months: yearBudget.months,
    },
    alerts: monthBudget.categories.filter((c) => c.status !== "ok"),
    recentTransactions: recent.map((tx) => ({
      id: tx.id,
      title: tx.title,
      amountMinor: tx.amount_minor,
      currency: tx.currency,
      occurredAt: tx.occurred_at,
      categoryName: tx.category_name ?? null,
    })),
  };
}

export async function getOverviewTotals(currency: string): Promise<{
  balanceMinor: number;
  monthIncomeMinor: number;
  monthExpenseMinor: number;
}> {
  const analytics = await getFullAnalytics(currency);
  return {
    balanceMinor: analytics.balanceMinor,
    monthIncomeMinor: analytics.month.incomeMinor,
    monthExpenseMinor: analytics.month.expenseMinor,
  };
}

export async function listGoals(includeArchived = false): Promise<GoalSummary[]> {
  const db = await getDb();
  const rows = await db.select<
    (Goal & { saved_minor: number | null })[]
  >(
    `SELECT g.id, g.title, g.currency, g.target_minor, g.deadline_date, g.archived,
            g.created_at, g.updated_at,
            COALESCE(SUM(c.amount_minor), 0) AS saved_minor
     FROM goals g
     LEFT JOIN goal_contributions c ON c.goal_id = g.id
     WHERE ($1 = 1 OR g.archived = 0)
     GROUP BY g.id
     ORDER BY g.archived ASC, g.deadline_date IS NULL, g.deadline_date ASC, g.title ASC`,
    [includeArchived ? 1 : 0],
  );

  return rows.map((row) => ({
    ...row,
    saved_minor: Number(row.saved_minor ?? 0),
  }));
}

export async function addGoal(input: {
  title: string;
  currency: string;
  targetInput: string;
  deadlineDate?: string | null;
}): Promise<number> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Укажите название цели");
  }
  if (title.length > 80) {
    throw new Error("Название слишком длинное");
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error("Некорректная валюта");
  }

  const targetMinor = Math.abs(parseMoneyInput(input.targetInput, input.currency));
  if (targetMinor <= 0) {
    throw new Error("Сумма цели должна быть больше нуля");
  }

  const deadline = normalizeDeadline(input.deadlineDate);
  const stamp = nowIso();
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO goals (title, currency, target_minor, deadline_date, archived, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 0, $5, $6)`,
    [title, input.currency, targetMinor, deadline, stamp, stamp],
  );
  const id = result.lastInsertId;
  if (id == null) {
    throw new Error("Не удалось создать цель");
  }
  return Number(id);
}

export async function updateGoal(input: {
  id: number;
  title: string;
  targetInput: string;
  deadlineDate?: string | null;
}): Promise<void> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Укажите название цели");
  }
  if (title.length > 80) {
    throw new Error("Название слишком длинное");
  }

  const db = await getDb();
  const existing = await db.select<Goal[]>(
    "SELECT id, title, currency, target_minor, deadline_date, archived, created_at, updated_at FROM goals WHERE id = $1 AND archived = 0",
    [input.id],
  );
  const goal = existing[0];
  if (!goal) {
    throw new Error("Цель не найдена");
  }

  const targetMinor = Math.abs(parseMoneyInput(input.targetInput, goal.currency));
  if (targetMinor <= 0) {
    throw new Error("Сумма цели должна быть больше нуля");
  }

  await db.execute(
    `UPDATE goals
     SET title = $1, target_minor = $2, deadline_date = $3, updated_at = $4
     WHERE id = $5`,
    [title, targetMinor, normalizeDeadline(input.deadlineDate), nowIso(), input.id],
  );
}

export async function archiveGoal(id: number): Promise<void> {
  const db = await getDb();
  const result = await db.execute(
    "UPDATE goals SET archived = 1, updated_at = $1 WHERE id = $2 AND archived = 0",
    [nowIso(), id],
  );
  if ((result.rowsAffected ?? 0) < 1) {
    throw new Error("Цель не найдена");
  }
}

export async function listGoalContributions(goalId: number): Promise<GoalContribution[]> {
  const db = await getDb();
  return db.select<GoalContribution[]>(
    `SELECT id, goal_id, amount_minor, note, contributed_at, created_at, transaction_id
     FROM goal_contributions
     WHERE goal_id = $1
     ORDER BY contributed_at DESC, id DESC`,
    [goalId],
  );
}

async function ensureGoalSavingsCategoryId(): Promise<number> {
  const db = await getDb();
  const existing = await db.select<Category[]>(
    `SELECT id, name, kind, is_essential, archived
     FROM categories
     WHERE kind = 'expense' AND archived = 0 AND name = 'Накопления'
     ORDER BY id ASC
     LIMIT 1`,
  );
  if (existing[0]) {
    return existing[0].id;
  }

  const result = await db.execute(
    `INSERT INTO categories (name, kind, is_essential, archived)
     VALUES ('Накопления', 'expense', 0, 0)`,
  );
  const id = result.lastInsertId;
  if (id == null) {
    throw new Error("Не удалось создать категорию «Накопления»");
  }
  return Number(id);
}

export async function addGoalContribution(input: {
  goalId: number;
  accountId: number;
  amountInput: string;
  note?: string;
  categoryId?: number;
}): Promise<void> {
  const db = await getDb();
  const existing = await db.select<Goal[]>(
    "SELECT id, title, currency, target_minor, deadline_date, archived, created_at, updated_at FROM goals WHERE id = $1 AND archived = 0",
    [input.goalId],
  );
  const goal = existing[0];
  if (!goal) {
    throw new Error("Цель не найдена");
  }

  const accounts = await db.select<Account[]>(
    "SELECT id, name, currency, archived, created_at FROM accounts WHERE id = $1 AND archived = 0",
    [input.accountId],
  );
  const account = accounts[0];
  if (!account) {
    throw new Error("Счёт не найден");
  }
  if (account.currency !== goal.currency) {
    throw new Error("Валюта счёта должна совпадать с валютой цели");
  }

  const amountMinor = Math.abs(parseMoneyInput(input.amountInput, goal.currency));
  if (amountMinor <= 0) {
    throw new Error("Сумма пополнения должна быть больше нуля");
  }

  const categoryId = input.categoryId ?? (await ensureGoalSavingsCategoryId());
  const categories = await db.select<Category[]>(
    "SELECT id, name, kind, is_essential, archived FROM categories WHERE id = $1 AND archived = 0",
    [categoryId],
  );
  const category = categories[0];
  if (!category) {
    throw new Error("Категория не найдена");
  }
  if (category.kind !== "expense") {
    throw new Error("Для пополнения цели нужна категория расхода");
  }

  const note = (input.note ?? "").trim() || null;
  const title = note || `Цель: ${goal.title}`;
  const stamp = nowIso();
  let transactionId: number | null = null;

  await db.execute("BEGIN IMMEDIATE");
  try {
    const txResult = await db.execute(
      `INSERT INTO transactions
        (account_id, category_id, title, amount_minor, currency, occurred_at, transfer_group_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)`,
      [
        account.id,
        categoryId,
        title.slice(0, 120),
        -amountMinor,
        goal.currency,
        stamp,
        stamp,
      ],
    );
    transactionId =
      txResult.lastInsertId == null ? null : Number(txResult.lastInsertId);
    if (transactionId == null) {
      throw new Error("Не удалось создать операцию");
    }

    await db.execute(
      `INSERT INTO goal_contributions
        (goal_id, amount_minor, note, contributed_at, created_at, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.goalId, amountMinor, note, stamp, stamp, transactionId],
    );
    await db.execute("UPDATE goals SET updated_at = $1 WHERE id = $2", [
      stamp,
      input.goalId,
    ]);
    await db.execute("COMMIT");
  } catch (error) {
    try {
      await db.execute("ROLLBACK");
    } catch {
      if (transactionId != null) {
        await db.execute("DELETE FROM transactions WHERE id = $1", [transactionId]);
      }
    }
    throw error;
  }
}

function normalizeDeadline(value?: string | null): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Срок укажите в формате ГГГГ-ММ-ДД");
  }
  return trimmed;
}
