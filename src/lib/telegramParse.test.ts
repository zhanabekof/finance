import { describe, expect, it } from "vitest";
import {
  parseTelegramOperation,
  resolveTelegramCategory,
} from "./telegramParse";

describe("telegramParse", () => {
  it("parses expense with leading minus and category hint", () => {
    expect(parseTelegramOperation("-500 продукты кофе")).toEqual({
      kind: "expense",
      amountInput: "500",
      categoryHint: "продукты кофе",
      title: "продукты кофе",
    });
  });

  it("parses income keyword and spaced amount", () => {
    expect(parseTelegramOperation("доход 150 000,50 зарплата аванс")).toEqual({
      kind: "income",
      amountInput: "150000.50",
      categoryHint: "зарплата аванс",
      title: "зарплата аванс",
    });
  });

  it("resolves category name from the start of the hint", () => {
    const categories = [
      { id: 1, name: "Продукты", kind: "expense" as const },
      { id: 2, name: "Кафе", kind: "expense" as const },
    ];
    expect(resolveTelegramCategory(categories, "expense", "продукты кофе")).toEqual({
      categoryId: 1,
      title: "кофе",
    });
  });

  it("requires a category-looking hint for expenses without match", () => {
    const categories = [{ id: 1, name: "Продукты", kind: "expense" as const }];
    expect(resolveTelegramCategory(categories, "expense", "просто текст")).toEqual({
      categoryId: null,
      title: "просто текст",
    });
  });
});
