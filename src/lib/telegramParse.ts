export type ParsedTelegramOp = {
  kind: "income" | "expense";
  amountInput: string;
  categoryHint: string | null;
  title: string;
};

export type TelegramCategory = {
  id: number;
  name: string;
  kind: "income" | "expense";
};

/**
 * Parse a Telegram message into an operation draft.
 *
 * Examples:
 *   -500 продукты кофе
 *   расход 1 200,50 кафе обед
 *   +100000 зарплата
 *   доход 50000 фриланс проект
 */
export function parseTelegramOperation(raw: string): ParsedTelegramOp {
  let text = raw.trim();
  if (!text) {
    throw new Error("Пустое сообщение");
  }

  text = text.replace(/^\/add(?:@\w+)?\s+/i, "").trim();
  if (!text || text.startsWith("/")) {
    throw new Error("Не похоже на операцию. Пример: −500 продукты кофе");
  }

  let kind: "income" | "expense" | null = null;
  const kindMatch = /^(расход|доход|expense|income)(?:\s+|:\s*|\s*-\s*)?/i.exec(text);
  if (kindMatch) {
    const word = kindMatch[1]!.toLowerCase();
    kind = word === "доход" || word === "income" ? "income" : "expense";
    text = text.slice(kindMatch[0].length).trim();
  }

  // Leading sign before amount
  let sign: "-" | "+" | null = null;
  if (text.startsWith("-") || text.startsWith("−") || text.startsWith("—")) {
    sign = "-";
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    sign = "+";
    text = text.slice(1).trim();
  }

  const amountMatch = /^(\d[\d\s]*(?:[.,]\d{1,2})?)/.exec(text);
  if (!amountMatch) {
    throw new Error("Не вижу сумму. Пример: −500 продукты кофе");
  }

  const amountRaw = amountMatch[1]!.replace(/\s/g, "").replace(",", ".");
  text = text.slice(amountMatch[0].length).trim();

  if (kind == null) {
    if (sign === "+") {
      kind = "income";
    } else {
      // Default and explicit minus → expense
      kind = "expense";
    }
  }

  const rest = text.replace(/\s+/g, " ").trim();
  return {
    kind,
    amountInput: amountRaw,
    categoryHint: rest || null,
    title: rest || (kind === "expense" ? "Расход из Telegram" : "Доход из Telegram"),
  };
}

/** Match category by name prefix / exact (case-insensitive, Russian). */
export function resolveTelegramCategory(
  categories: TelegramCategory[],
  kind: "income" | "expense",
  hint: string | null,
): { categoryId: number | null; title: string } {
  const pool = categories.filter((c) => c.kind === kind);
  if (!hint) {
    return {
      categoryId: null,
      title: kind === "expense" ? "Расход из Telegram" : "Доход из Telegram",
    };
  }

  const normalized = hint.toLowerCase();
  const sorted = [...pool].sort((a, b) => b.name.length - a.name.length);

  for (const category of sorted) {
    const name = category.name.toLowerCase();
    if (normalized === name || normalized.startsWith(`${name} `)) {
      const remainder = hint.slice(category.name.length).trim();
      return {
        categoryId: category.id,
        title: remainder || category.name,
      };
    }
  }

  // Token exact match on first word
  const first = normalized.split(/\s+/)[0] ?? "";
  const byToken = pool.find((c) => c.name.toLowerCase() === first);
  if (byToken) {
    const remainder = hint.slice(byToken.name.length).trim();
    return {
      categoryId: byToken.id,
      title: remainder || byToken.name,
    };
  }

  return { categoryId: null, title: hint };
}

export function telegramHelpText(serviceMode = false): string {
  return [
    "Finance — запись операций через меню.",
    "",
    "1. Нажмите «Расход» или «Доход»",
    "2. Выберите категорию",
    "3. Введите сумму числом (500 или 1200,50)",
    "",
    "Команды:",
    "/start или Меню — показать кнопки",
    "/help или Помощь — эта справка",
    "/status или Статус — статус бота",
    "",
    serviceMode
      ? "Бот работает в фоне через службу Finance."
      : "Без службы бот работает, пока открыто приложение Finance.",
  ].join("\n");
}
