import { describe, expect, it } from "vitest";
import {
  averageDailyExpense,
  buildCategoryShares,
  daysElapsedInMonthUtc,
  daysInMonthUtc,
  formatPercent,
  savingsRate,
} from "./analytics";
import {
  buildBudgetSummary,
  monthBoundsUtc,
  monthsOfYear,
  nextYear,
  nextYearMonth,
  splitYearlyMinorAcrossMonths,
  yearBoundsUtc,
  NEAR_LIMIT_RATIO,
} from "./budget";
import { buildGoalProgress, suggestedMonthlyContribution } from "./goals";
import { formatMoney, parseMoneyInput, sumMinor } from "./money";
import {
  assertStatementFileLimits,
  MAX_STATEMENT_BYTES,
  parseBankStatementCsv,
  parseKaspiGoldStatementLines,
  parsePdfStatementLines,
  parseStatementDate,
  splitCsvLine,
} from "./statementImport";

describe("money", () => {
  it("parses income and expense amounts into minor units", () => {
    expect(parseMoneyInput("1500.50", "KZT")).toBe(150050);
    expect(parseMoneyInput("-42,10", "KZT")).toBe(-4210);
    expect(parseMoneyInput("0.01", "USD")).toBe(1);
    expect(parseMoneyInput("12.", "KZT")).toBe(1200);
  });

  it("rejects oversized fractional precision", () => {
    expect(() => parseMoneyInput("1.234", "KZT")).toThrow(/Максимум/);
  });

  it("formats minor units with currency", () => {
    expect(formatMoney(150050, "KZT")).toContain("1");
    expect(formatMoney(-4210, "KZT")).toContain("42");
  });

  it("sums large and zero values safely", () => {
    expect(sumMinor([0, 1, -1, 9_000_000_000])).toBe(9_000_000_000);
  });
});

describe("analytics", () => {
  it("computes savings rate and average daily expense", () => {
    expect(savingsRate(100_00, 40_00)).toBeCloseTo(0.6);
    expect(savingsRate(0, 10_00)).toBeNull();
    expect(averageDailyExpense(310_00, 31)).toBe(10_00);
    expect(averageDailyExpense(100_00, 0)).toBe(0);
  });

  it("builds category shares sorted by amount", () => {
    const shares = buildCategoryShares([
      { categoryId: 1, categoryName: "Кафе", isEssential: false, amountMinor: 20_00 },
      { categoryId: 2, categoryName: "Продукты", isEssential: true, amountMinor: 80_00 },
    ]);
    expect(shares[0]?.categoryName).toBe("Продукты");
    expect(shares[0]?.shareRatio).toBeCloseTo(0.8);
    expect(formatPercent(0.8)).toBe("80%");
  });

  it("resolves month day helpers", () => {
    expect(daysInMonthUtc("2026-02")).toBe(28);
    expect(daysElapsedInMonthUtc("2020-01", new Date("2020-01-15T12:00:00Z"))).toBe(15);
    expect(daysElapsedInMonthUtc("2019-01", new Date("2020-01-15T12:00:00Z"))).toBe(31);
  });
});

describe("budget", () => {
  it("computes plan, fact, remaining, free funds and overspend", () => {
    const summary = buildBudgetSummary({
      currency: "KZT",
      plannedIncomeMinor: 500_000_00,
      limits: [
        {
          categoryId: 1,
          categoryName: "Продукты",
          isEssential: true,
          limitMinor: 100_000_00,
          kind: "expense",
        },
        {
          categoryId: 2,
          categoryName: "Кафе",
          isEssential: false,
          limitMinor: 40_000_00,
          kind: "expense",
        },
      ],
      expenseActuals: [
        { categoryId: 1, spentMinor: 95_000_00 },
        { categoryId: 2, spentMinor: 50_000_00 },
      ],
      actualIncomeMinor: 480_000_00,
    });

    expect(summary.allocatedMinor).toBe(140_000_00);
    expect(summary.freeMinor).toBe(360_000_00);
    expect(summary.categories[0]?.status).toBe("near");
    expect(summary.categories[0]?.usageRatio).toBeGreaterThanOrEqual(NEAR_LIMIT_RATIO);
    expect(summary.categories.find((c) => c.categoryId === 2)?.status).toBe("over");
    expect(summary.categories.find((c) => c.categoryId === 2)?.remainingMinor).toBe(
      -10_000_00,
    );
  });

  it("plans income by category and keeps expense allocation separate", () => {
    const summary = buildBudgetSummary({
      currency: "KZT",
      plannedIncomeMinor: 0,
      limits: [
        {
          categoryId: 10,
          categoryName: "Зарплата",
          isEssential: true,
          limitMinor: 400_000_00,
          kind: "income",
        },
        {
          categoryId: 11,
          categoryName: "Подработка",
          isEssential: false,
          limitMinor: 100_000_00,
          kind: "income",
        },
        {
          categoryId: 1,
          categoryName: "Продукты",
          isEssential: true,
          limitMinor: 80_000_00,
          kind: "expense",
        },
      ],
      expenseActuals: [{ categoryId: 1, spentMinor: 20_000_00 }],
      incomeActuals: [
        { categoryId: 10, spentMinor: 400_000_00 },
        { categoryId: 11, spentMinor: 50_000_00 },
      ],
      actualIncomeMinor: 450_000_00,
    });

    expect(summary.plannedIncomeMinor).toBe(500_000_00);
    expect(summary.allocatedMinor).toBe(80_000_00);
    expect(summary.freeMinor).toBe(420_000_00);
    expect(summary.categories.find((c) => c.categoryId === 10)?.kind).toBe("income");
    expect(summary.categories.find((c) => c.categoryId === 11)?.remainingMinor).toBe(
      50_000_00,
    );
  });

  it("does not mutate operations when only plan numbers change", () => {
    const expenseActuals = [{ categoryId: 1, spentMinor: 10_00 }];
    const before = buildBudgetSummary({
      currency: "USD",
      plannedIncomeMinor: 100_00,
      limits: [
        {
          categoryId: 1,
          categoryName: "Food",
          isEssential: true,
          limitMinor: 50_00,
          kind: "expense",
        },
      ],
      expenseActuals,
      actualIncomeMinor: 100_00,
    });
    const after = buildBudgetSummary({
      currency: "USD",
      plannedIncomeMinor: 200_00,
      limits: [
        {
          categoryId: 1,
          categoryName: "Food",
          isEssential: true,
          limitMinor: 80_00,
          kind: "expense",
        },
      ],
      expenseActuals,
      actualIncomeMinor: 100_00,
    });

    expect(before.categories[0]?.actualMinor).toBe(10_00);
    expect(after.categories[0]?.actualMinor).toBe(10_00);
    expect(expenseActuals[0]?.spentMinor).toBe(10_00);
  });

  it("advances periods and builds UTC bounds", () => {
    expect(nextYearMonth("2026-12")).toBe("2027-01");
    expect(nextYear("2026")).toBe("2027");
    expect(monthsOfYear("2026")).toHaveLength(12);
    expect(monthsOfYear("2026")[0]).toBe("2026-01");
    expect(monthsOfYear("2026")[11]).toBe("2026-12");

    const monthBounds = monthBoundsUtc("2026-07");
    expect(monthBounds.startIso).toBe("2026-07-01T00:00:00.000Z");
    expect(monthBounds.endIso).toBe("2026-08-01T00:00:00.000Z");

    const yearBounds = yearBoundsUtc("2026");
    expect(yearBounds.startIso).toBe("2026-01-01T00:00:00.000Z");
    expect(yearBounds.endIso).toBe("2027-01-01T00:00:00.000Z");
  });

  it("splits yearly amounts across months without losing remainder", () => {
    const parts = splitYearlyMinorAcrossMonths(100);
    expect(parts).toHaveLength(12);
    expect(sumMinor(parts)).toBe(100);
    expect(parts.slice(0, 4)).toEqual([9, 9, 9, 9]);
    expect(parts.slice(4)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
  });
});

describe("goals", () => {
  it("tracks progress, remaining and near/done status", () => {
    const open = buildGoalProgress({
      targetMinor: 100_000_00,
      savedMinor: 40_000_00,
      deadlineDate: "2026-12-31",
      now: new Date("2026-07-17T12:00:00Z"),
    });
    expect(open.status).toBe("open");
    expect(open.remainingMinor).toBe(60_000_00);
    expect(open.daysLeft).toBeGreaterThan(0);

    const near = buildGoalProgress({
      targetMinor: 100_00,
      savedMinor: 90_00,
    });
    expect(near.status).toBe("near");
    expect(near.usageRatio).toBeCloseTo(0.9);

    const done = buildGoalProgress({
      targetMinor: 50_00,
      savedMinor: 55_00,
    });
    expect(done.status).toBe("done");
    expect(done.remainingMinor).toBe(0);
  });

  it("suggests monthly pace without floating money math", () => {
    expect(suggestedMonthlyContribution(12_000_00, 90)).toBe(4_000_00);
    expect(suggestedMonthlyContribution(0, 30)).toBe(0);
    expect(suggestedMonthlyContribution(100_00, 0)).toBe(100_00);
  });
});

describe("statement import", () => {
  it("parses CSV with signed amount and DD.MM.YYYY dates", () => {
    const csv = [
      "Дата;Описание;Сумма",
      "15.07.2026;Продукты;-1500,50",
      "16.07.2026;Зарплата;250000,00",
      "17.07.2026;Пусто;0",
    ].join("\n");

    const result = parseBankStatementCsv(csv, { currency: "KZT", presetId: "kaspi" });
    expect(result.source).toBe("csv");
    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBe(1);
    expect(result.rows[0]?.amountMinor).toBe(-150050);
    expect(result.rows[0]?.kind).toBe("expense");
    expect(result.rows[1]?.amountMinor).toBe(25000000);
    expect(result.rows[1]?.occurredAt.startsWith("2026-07-16")).toBe(true);
  });

  it("parses debit/credit columns and rejects oversized files", () => {
    const csv = [
      "Date,Details,Debit,Credit",
      "2026-01-02,Coffee,12.00,",
      "2026-01-03,Payroll,,1000.00",
    ].join("\n");
    const result = parseBankStatementCsv(csv, { currency: "USD", presetId: "auto" });
    expect(result.rows[0]?.amountMinor).toBe(-1200);
    expect(result.rows[1]?.amountMinor).toBe(100000);

    expect(() =>
      assertStatementFileLimits({ byteLength: MAX_STATEMENT_BYTES + 1, textLength: 10 }),
    ).toThrow(/8 МБ/);
  });

  it("splits quoted CSV fields", () => {
    expect(splitCsvLine('a,"b,c",d', ",")).toEqual(["a", "b,c", "d"]);
    expect(parseStatementDate("01/02/2026")).toBe("2026-02-01T12:00:00.000Z");
  });

  it("parses Kaspi Gold PDF lines with YY dates and tenge amounts", () => {
    expect(parseStatementDate("17.07.26")).toBe("2026-07-17T12:00:00.000Z");

    const result = parseKaspiGoldStatementLines(
      [
        "ВЫПИСКА",
        "по Kaspi Gold за период с 18.07.25 по 18.07.26",
        "Дата Сумма Операция Детали",
        "17.07.26 - 2 400,00 ₸ Покупка ИП АЛИ КҮШ",
        "16.07.26 + 49 400,00 ₸ Пополнение С карты другого банка",
        "14.07.26 - 11 095,17 ₸ Покупка OPENAI *CHATGPT SUBSCR",
        "(- 23,20 USD)",
        "04.07.26 + 1 669,00 ₸ Покупка WOLT.COM",
        "Доступно на 18.07.26 + 19 801,28 ₸",
      ],
      { currency: "KZT" },
    );

    expect(result.presetId).toBe("kaspi");
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]).toMatchObject({
      title: "Покупка ИП АЛИ КҮШ",
      amountMinor: -240000,
      kind: "expense",
    });
    expect(result.rows[1]?.amountMinor).toBe(4940000);
    expect(result.rows[1]?.kind).toBe("income");
    expect(result.rows[2]?.amountMinor).toBe(-1109517);
    expect(result.rows[3]?.amountMinor).toBe(166900);
    expect(result.rows[3]?.kind).toBe("income");

    const auto = parsePdfStatementLines(
      ["АО «Kaspi Bank»", "17.07.26 - 900,00 ₸ Покупка Magnum"],
      { currency: "KZT", presetId: "auto" },
    );
    expect(auto.presetId).toBe("kaspi");
    expect(auto.rows[0]?.amountMinor).toBe(-90000);
  });
});
