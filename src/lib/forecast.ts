/**
 * Month-end projection from budget plans for regular (essential) categories.
 * Does not create transactions — only estimates what is still expected.
 */
export type RecurringPlanRow = {
  kind: "income" | "expense";
  isEssential: boolean;
  planMinor: number;
  actualMinor: number;
};

export type RecurringForecast = {
  expectedRemainingIncomeMinor: number;
  expectedRemainingExpenseMinor: number;
  projectedNetDeltaMinor: number;
};

export function buildRecurringForecast(rows: RecurringPlanRow[]): RecurringForecast {
  let expectedRemainingIncomeMinor = 0;
  let expectedRemainingExpenseMinor = 0;

  for (const row of rows) {
    if (!row.isEssential) {
      continue;
    }
    if (!Number.isSafeInteger(row.planMinor) || row.planMinor < 0) {
      throw new Error("План категории должен быть неотрицательным целым");
    }
    if (!Number.isSafeInteger(row.actualMinor) || row.actualMinor < 0) {
      throw new Error("Факт категории должен быть неотрицательным целым");
    }
    const remaining = Math.max(0, row.planMinor - row.actualMinor);
    if (row.kind === "income") {
      expectedRemainingIncomeMinor += remaining;
    } else {
      expectedRemainingExpenseMinor += remaining;
    }
  }

  return {
    expectedRemainingIncomeMinor,
    expectedRemainingExpenseMinor,
    projectedNetDeltaMinor:
      expectedRemainingIncomeMinor - expectedRemainingExpenseMinor,
  };
}
