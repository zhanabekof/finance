export type GoalProgress = {
  savedMinor: number;
  remainingMinor: number;
  usageRatio: number;
  status: "open" | "near" | "done";
  daysLeft: number | null;
};

/** Near-completion threshold (90%). */
export const NEAR_GOAL_RATIO = 0.9;

/**
 * Progress toward a savings goal.
 * Remaining is floored at zero when overfunded; ratio can exceed 1.
 */
export function buildGoalProgress(input: {
  targetMinor: number;
  savedMinor: number;
  deadlineDate?: string | null;
  now?: Date;
}): GoalProgress {
  const { targetMinor, savedMinor, deadlineDate = null, now = new Date() } = input;

  if (!Number.isSafeInteger(targetMinor) || targetMinor <= 0) {
    throw new Error("Цель должна быть положительным целым");
  }
  if (!Number.isSafeInteger(savedMinor) || savedMinor < 0) {
    throw new Error("Накоплено должно быть неотрицательным целым");
  }

  const remainingMinor = Math.max(targetMinor - savedMinor, 0);
  const usageRatio = savedMinor / targetMinor;

  let status: GoalProgress["status"] = "open";
  if (savedMinor >= targetMinor) {
    status = "done";
  } else if (usageRatio >= NEAR_GOAL_RATIO) {
    status = "near";
  }

  let daysLeft: number | null = null;
  if (deadlineDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)) {
      throw new Error("Ожидается дата YYYY-MM-DD");
    }
    const [year, month, day] = deadlineDate.split("-").map(Number);
    const deadlineUtc = Date.UTC(year, (month ?? 1) - 1, day ?? 1);
    const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    daysLeft = Math.trunc((deadlineUtc - nowUtc) / 86_400_000);
  }

  return {
    savedMinor,
    remainingMinor,
    usageRatio,
    status,
    daysLeft,
  };
}

/**
 * Suggested monthly contribution to hit the target by deadline.
 * Remainder from integer division is ignored (conservative estimate).
 */
export function suggestedMonthlyContribution(
  remainingMinor: number,
  daysLeft: number,
): number {
  if (!Number.isSafeInteger(remainingMinor) || remainingMinor < 0) {
    throw new Error("Остаток должен быть неотрицательным целым");
  }
  if (!Number.isSafeInteger(daysLeft)) {
    throw new Error("Дни до срока должны быть целым числом");
  }
  if (remainingMinor === 0 || daysLeft <= 0) {
    return remainingMinor;
  }
  const monthsLeft = Math.max(Math.ceil(daysLeft / 30), 1);
  return Math.trunc(remainingMinor / monthsLeft);
}
