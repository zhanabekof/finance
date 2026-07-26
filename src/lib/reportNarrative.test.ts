import { describe, expect, it } from "vitest";
import type { AnalyticsOverview } from "./analytics";
import {
  buildConsultantReport,
  reportPdfFileName,
} from "./reportNarrative";

function sampleOverview(
  overrides: Partial<AnalyticsOverview> = {},
): AnalyticsOverview {
  const base: AnalyticsOverview = {
    currency: "KZT",
    yearMonth: "2026-07",
    year: "2026",
    balanceMinor: 500_000_00,
    accounts: [
      {
        accountId: 1,
        name: "Основной",
        currency: "KZT",
        balanceMinor: 500_000_00,
      },
    ],
    month: {
      incomeMinor: 400_000_00,
      expenseMinor: 250_000_00,
      netMinor: 150_000_00,
      savingsRate: 0.375,
      avgDailyExpenseMinor: 10_000_00,
      daysElapsed: 25,
      daysInMonth: 31,
      essentialExpenseMinor: 180_000_00,
      discretionaryExpenseMinor: 70_000_00,
      uncategorizedExpenseMinor: 0,
      expenseCategories: [
        {
          categoryId: 1,
          categoryName: "Продукты",
          isEssential: true,
          amountMinor: 90_000_00,
          shareRatio: 0.36,
        },
      ],
      incomeCategories: [],
    },
    yearFlow: {
      incomeMinor: 400_000_00,
      expenseMinor: 250_000_00,
      netMinor: 150_000_00,
      savingsRate: 0.375,
      essentialExpenseMinor: 180_000_00,
      discretionaryExpenseMinor: 70_000_00,
      expenseCategories: [],
      months: [
        {
          yearMonth: "2026-07",
          incomeMinor: 400_000_00,
          expenseMinor: 250_000_00,
          netMinor: 150_000_00,
        },
      ],
    },
    monthBudget: {
      currency: "KZT",
      plannedIncomeMinor: 400_000_00,
      allocatedMinor: 300_000_00,
      freeMinor: 100_000_00,
      actualIncomeMinor: 400_000_00,
      actualExpenseMinor: 250_000_00,
      categories: [
        {
          categoryId: 1,
          categoryName: "Продукты",
          isEssential: true,
          kind: "expense",
          planMinor: 100_000_00,
          actualMinor: 90_000_00,
          remainingMinor: 10_000_00,
          usageRatio: 0.9,
          status: "near",
        },
      ],
    },
    yearBudget: {
      plannedIncomeMinor: 4_800_000_00,
      allocatedMinor: 3_600_000_00,
      freeMinor: 1_200_000_00,
      actualIncomeMinor: 400_000_00,
      actualExpenseMinor: 250_000_00,
      categories: [],
      months: [],
    },
    alerts: [
      {
        categoryId: 1,
        categoryName: "Продукты",
        isEssential: true,
        kind: "expense",
        planMinor: 100_000_00,
        actualMinor: 90_000_00,
        remainingMinor: 10_000_00,
        usageRatio: 0.9,
        status: "near",
      },
    ],
    recentTransactions: [],
  };
  return { ...base, ...overrides };
}

describe("consultant report", () => {
  it("builds narrative with recommendations and health label", () => {
    const report = buildConsultantReport(sampleOverview(), [], new Date("2026-07-26T12:00:00Z"));
    expect(report.title).toContain("отчёт");
    expect(report.periodLabel.toLowerCase()).toContain("2026");
    expect(report.health.tone).toBe("watch");
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.sections.some((section) => section.heading.includes("Бюджет"))).toBe(
      true,
    );
    expect(report.executiveSummary.length).toBeGreaterThan(40);
  });

  it("flags overspend as risk and suggests category action", () => {
    const report = buildConsultantReport(
      sampleOverview({
        alerts: [
          {
            categoryId: 2,
            categoryName: "Кафе",
            isEssential: false,
            kind: "expense",
            planMinor: 30_000_00,
            actualMinor: 50_000_00,
            remainingMinor: -20_000_00,
            usageRatio: 50 / 30,
            status: "over",
          },
        ],
        monthBudget: {
          currency: "KZT",
          plannedIncomeMinor: 400_000_00,
          allocatedMinor: 300_000_00,
          freeMinor: 100_000_00,
          actualIncomeMinor: 400_000_00,
          actualExpenseMinor: 320_000_00,
          categories: [],
        },
      }),
    );
    expect(report.health.tone).toBe("risk");
    expect(report.recommendations.some((tip) => tip.includes("Кафе"))).toBe(true);
  });

  it("names pdf file with year-month", () => {
    expect(reportPdfFileName("2026-07", new Date("2026-07-26T00:00:00Z"))).toBe(
      "finance-report-2026-07-2026-07-26.pdf",
    );
  });
});
