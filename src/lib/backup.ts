import {
  getDb,
  type Account,
  type Budget,
  type BudgetLimit,
  type Category,
  type Goal,
  type GoalContribution,
  type Transaction,
  type YearBudget,
  type YearBudgetLimit,
} from "./db";

export const BACKUP_FORMAT_VERSION = 1 as const;

type RawTransaction = Omit<Transaction, "account_name" | "category_name">;

export type FinanceBackup = {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  accounts: Account[];
  categories: Category[];
  transactions: RawTransaction[];
  budgets: Budget[];
  budgetLimits: BudgetLimit[];
  yearBudgets: YearBudget[];
  yearBudgetLimits: YearBudgetLimit[];
  goals: Goal[];
  goalContributions: GoalContribution[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray<T>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`В бэкапе нет массива «${label}»`);
  }
  return value as T[];
}

/** Validate and normalize unknown JSON into a FinanceBackup. */
export function parseFinanceBackup(payload: unknown): FinanceBackup {
  if (!isRecord(payload)) {
    throw new Error("Файл бэкапа повреждён");
  }
  const version = payload.formatVersion;
  if (version !== BACKUP_FORMAT_VERSION) {
    throw new Error("Неподдерживаемая версия бэкапа");
  }
  if (typeof payload.exportedAt !== "string" || !payload.exportedAt) {
    throw new Error("В бэкапе нет даты экспорта");
  }

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: payload.exportedAt,
    accounts: requireArray(payload.accounts, "accounts"),
    categories: requireArray(payload.categories, "categories"),
    transactions: requireArray(payload.transactions, "transactions"),
    budgets: requireArray(payload.budgets, "budgets"),
    budgetLimits: requireArray(payload.budgetLimits, "budgetLimits"),
    yearBudgets: requireArray(payload.yearBudgets, "yearBudgets"),
    yearBudgetLimits: requireArray(payload.yearBudgetLimits, "yearBudgetLimits"),
    goals: requireArray(payload.goals, "goals"),
    goalContributions: requireArray(payload.goalContributions, "goalContributions"),
  };
}

export function backupFileName(exportedAt = new Date()): string {
  const stamp = exportedAt.toISOString().slice(0, 10);
  return `finance-backup-${stamp}.json`;
}

export async function exportFinanceBackup(): Promise<FinanceBackup> {
  const db = await getDb();

  const [
    accounts,
    categories,
    transactions,
    budgets,
    budgetLimits,
    yearBudgets,
    yearBudgetLimits,
    goals,
    goalContributions,
  ] = await Promise.all([
    db.select<Account[]>(
      "SELECT id, name, currency, archived, created_at FROM accounts ORDER BY id ASC",
    ),
    db.select<Category[]>(
      "SELECT id, name, kind, is_essential, archived FROM categories ORDER BY id ASC",
    ),
    db.select<RawTransaction[]>(
      `SELECT id, account_id, category_id, title, amount_minor, currency,
              occurred_at, transfer_group_id, created_at
       FROM transactions
       ORDER BY id ASC`,
    ),
    db.select<Budget[]>(
      "SELECT id, year_month, currency, planned_income_minor, created_at, updated_at FROM budgets ORDER BY id ASC",
    ),
    db.select<BudgetLimit[]>(
      "SELECT id, budget_id, category_id, limit_minor FROM budget_limits ORDER BY id ASC",
    ),
    db.select<YearBudget[]>(
      "SELECT id, year, currency, planned_income_minor, created_at, updated_at FROM year_budgets ORDER BY id ASC",
    ),
    db.select<YearBudgetLimit[]>(
      "SELECT id, year_budget_id, category_id, limit_minor FROM year_budget_limits ORDER BY id ASC",
    ),
    db.select<Goal[]>(
      `SELECT id, title, currency, target_minor, deadline_date, archived, created_at, updated_at
       FROM goals ORDER BY id ASC`,
    ),
    db.select<GoalContribution[]>(
      `SELECT id, goal_id, amount_minor, note, contributed_at, created_at, transaction_id
       FROM goal_contributions ORDER BY id ASC`,
    ),
  ]);

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    accounts,
    categories,
    transactions,
    budgets,
    budgetLimits,
    yearBudgets,
    yearBudgetLimits,
    goals,
    goalContributions,
  };
}

/**
 * Replace all local finance data with the backup.
 * Uses BEGIN/COMMIT on the shared SQLite connection when available.
 */
export async function restoreFinanceBackup(backup: FinanceBackup): Promise<void> {
  const parsed = parseFinanceBackup(backup);
  const db = await getDb();

  await db.execute("PRAGMA foreign_keys = OFF");
  try {
    await db.execute("BEGIN IMMEDIATE");
    try {
      await db.execute("DELETE FROM goal_contributions");
      await db.execute("DELETE FROM goals");
      await db.execute("DELETE FROM year_budget_limits");
      await db.execute("DELETE FROM year_budgets");
      await db.execute("DELETE FROM budget_limits");
      await db.execute("DELETE FROM budgets");
      await db.execute("DELETE FROM transactions");
      await db.execute("DELETE FROM categories");
      await db.execute("DELETE FROM accounts");

      for (const account of parsed.accounts) {
        await db.execute(
          `INSERT INTO accounts (id, name, currency, archived, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            account.id,
            account.name,
            account.currency,
            account.archived,
            account.created_at,
          ],
        );
      }
      for (const category of parsed.categories) {
        await db.execute(
          `INSERT INTO categories (id, name, kind, is_essential, archived)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            category.id,
            category.name,
            category.kind,
            category.is_essential,
            category.archived,
          ],
        );
      }
      for (const tx of parsed.transactions) {
        await db.execute(
          `INSERT INTO transactions
            (id, account_id, category_id, title, amount_minor, currency, occurred_at, transfer_group_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            tx.id,
            tx.account_id,
            tx.category_id,
            tx.title,
            tx.amount_minor,
            tx.currency,
            tx.occurred_at,
            tx.transfer_group_id,
            tx.created_at,
          ],
        );
      }
      for (const budget of parsed.budgets) {
        await db.execute(
          `INSERT INTO budgets (id, year_month, currency, planned_income_minor, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            budget.id,
            budget.year_month,
            budget.currency,
            budget.planned_income_minor,
            budget.created_at,
            budget.updated_at,
          ],
        );
      }
      for (const limit of parsed.budgetLimits) {
        await db.execute(
          `INSERT INTO budget_limits (id, budget_id, category_id, limit_minor)
           VALUES ($1, $2, $3, $4)`,
          [limit.id, limit.budget_id, limit.category_id, limit.limit_minor],
        );
      }
      for (const yearBudget of parsed.yearBudgets) {
        await db.execute(
          `INSERT INTO year_budgets (id, year, currency, planned_income_minor, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            yearBudget.id,
            yearBudget.year,
            yearBudget.currency,
            yearBudget.planned_income_minor,
            yearBudget.created_at,
            yearBudget.updated_at,
          ],
        );
      }
      for (const limit of parsed.yearBudgetLimits) {
        await db.execute(
          `INSERT INTO year_budget_limits (id, year_budget_id, category_id, limit_minor)
           VALUES ($1, $2, $3, $4)`,
          [
            limit.id,
            limit.year_budget_id,
            limit.category_id,
            limit.limit_minor,
          ],
        );
      }
      for (const goal of parsed.goals) {
        await db.execute(
          `INSERT INTO goals (id, title, currency, target_minor, deadline_date, archived, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            goal.id,
            goal.title,
            goal.currency,
            goal.target_minor,
            goal.deadline_date,
            goal.archived,
            goal.created_at,
            goal.updated_at,
          ],
        );
      }
      for (const contribution of parsed.goalContributions) {
        await db.execute(
          `INSERT INTO goal_contributions (id, goal_id, amount_minor, note, contributed_at, created_at, transaction_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            contribution.id,
            contribution.goal_id,
            contribution.amount_minor,
            contribution.note,
            contribution.contributed_at,
            contribution.created_at,
            contribution.transaction_id ?? null,
          ],
        );
      }

      await db.execute("COMMIT");
    } catch (error) {
      try {
        await db.execute("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      throw error;
    }
  } finally {
    await db.execute("PRAGMA foreign_keys = ON");
  }
}

export function downloadBackupJson(backup: FinanceBackup, filename = backupFileName()): void {
  const text = `${JSON.stringify(backup, null, 2)}\n`;
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function readBackupFile(file: File): Promise<FinanceBackup> {
  if (file.size > 32 * 1024 * 1024) {
    throw new Error("Файл бэкапа слишком большой (максимум 32 МБ)");
  }
  const text = await file.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Файл не является корректным JSON");
  }
  return parseFinanceBackup(payload);
}
