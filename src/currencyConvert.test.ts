import { describe, expect, it } from "vitest";
import {
  convertAmountMinor,
  formatFxRate,
  rateFromTo,
} from "./currencyConvert";

const rates = {
  USD: 1,
  EUR: 0.9,
  KZT: 500,
  JPY: 150,
};

describe("currencyConvert", () => {
  it("converts between currencies using shared base rates", () => {
    // 100.00 USD → 50_000.00 KZT at 500 KZT/USD
    expect(convertAmountMinor(10_000, "USD", "KZT", rates)).toBe(5_000_000);
    // 50_000.00 KZT → 100.00 USD
    expect(convertAmountMinor(5_000_000, "KZT", "USD", rates)).toBe(10_000);
    // 100.00 USD → 90.00 EUR
    expect(convertAmountMinor(10_000, "USD", "EUR", rates)).toBe(9_000);
  });

  it("returns the same amount for identical currencies", () => {
    expect(convertAmountMinor(12_345, "KZT", "KZT", rates)).toBe(12_345);
  });

  it("rounds to the target currency minor unit", () => {
    // 1.00 USD → 150 JPY (0 fraction digits)
    expect(convertAmountMinor(100, "USD", "JPY", rates)).toBe(150);
    // 1 KZT minor (0.01 KZT) → ~0.003 JPY → rounds to 0
    expect(convertAmountMinor(1, "KZT", "JPY", rates)).toBe(0);
  });

  it("rejects missing rates and unsafe amounts", () => {
    expect(() => convertAmountMinor(100, "USD", "GBP", rates)).toThrow(/Нет курса/);
    expect(() => convertAmountMinor(1.5, "USD", "EUR", rates)).toThrow(/Некорректная сумма/);
  });

  it("builds cross rates and formatted quotes", () => {
    expect(rateFromTo("USD", "KZT", rates)).toBe(500);
    expect(rateFromTo("KZT", "USD", rates)).toBeCloseTo(0.002);
    expect(formatFxRate("USD", "KZT", rates)).toContain("500");
    expect(formatFxRate("USD", "KZT", rates)).toContain("USD");
  });
});
