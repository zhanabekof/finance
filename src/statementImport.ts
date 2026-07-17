/** Парсинг банковских выписок: PDF (основной) и CSV (запасной). */

export const MAX_STATEMENT_BYTES = 8_000_000;
export const MAX_STATEMENT_ROWS = 5_000;

export type StatementBankPresetId =
  | "auto"
  | "kaspi"
  | "halyk"
  | "generic_ru"
  | "generic_en";

export type StatementColumnMapping = {
  date: number;
  title: number;
  amount?: number;
  debit?: number;
  credit?: number;
};

export type ParsedStatementRow = {
  lineNumber: number;
  occurredAt: string;
  title: string;
  amountMinor: number;
  kind: "income" | "expense";
};

export type StatementParseIssue = {
  lineNumber: number;
  message: string;
};

export type StatementParseResult = {
  source: "pdf" | "csv";
  delimiter?: "," | ";";
  headers: string[];
  mapping?: StatementColumnMapping;
  presetId: StatementBankPresetId;
  pageCount?: number;
  rows: ParsedStatementRow[];
  issues: StatementParseIssue[];
  skipped: number;
};

type BankPreset = {
  id: Exclude<StatementBankPresetId, "auto">;
  label: string;
  aliases: {
    date: string[];
    title: string[];
    amount: string[];
    debit: string[];
    credit: string[];
  };
};

const BANK_PRESETS: BankPreset[] = [
  {
    id: "kaspi",
    label: "Kaspi",
    aliases: {
      date: ["дата", "date", "дата операции", "дата транзакции"],
      title: ["описание", "назначение", "детали", "операция", "details", "merchant"],
      amount: ["сумма", "amount", "сумма операции"],
      debit: ["списание", "расход", "debit"],
      credit: ["пополнение", "зачисление", "приход", "credit"],
    },
  },
  {
    id: "halyk",
    label: "Halyk",
    aliases: {
      date: ["дата", "date", "дата операции", "trn date"],
      title: ["описание", "назначение платежа", "details", "narrative"],
      amount: ["сумма", "amount"],
      debit: ["дебет", "списание", "debit"],
      credit: ["кредит", "зачисление", "credit"],
    },
  },
  {
    id: "generic_ru",
    label: "Универсальный (RU)",
    aliases: {
      date: ["дата", "дата операции", "дата проводки"],
      title: ["описание", "назначение", "назначение платежа", "контрагент", "операция"],
      amount: ["сумма", "сумма операции"],
      debit: ["дебет", "списание", "расход"],
      credit: ["кредит", "зачисление", "приход", "пополнение"],
    },
  },
  {
    id: "generic_en",
    label: "Generic (EN)",
    aliases: {
      date: ["date", "booking date", "transaction date", "value date"],
      title: ["description", "details", "narrative", "merchant", "payee"],
      amount: ["amount", "transaction amount"],
      debit: ["debit", "withdrawal", "money out"],
      credit: ["credit", "deposit", "money in"],
    },
  },
];

export const STATEMENT_BANK_OPTIONS: Array<{
  id: StatementBankPresetId;
  label: string;
}> = [
  { id: "auto", label: "Авто" },
  ...BANK_PRESETS.map((preset) => ({ id: preset.id, label: preset.label })),
];

export function listStatementPresets(): Array<{
  id: StatementBankPresetId;
  label: string;
}> {
  return STATEMENT_BANK_OPTIONS;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
}

function findColumn(headers: string[], aliases: string[]): number | undefined {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(normalizeHeader(alias));
    if (index >= 0) {
      return index;
    }
  }
  for (const alias of aliases) {
    const needle = normalizeHeader(alias);
    const index = normalized.findIndex(
      (header) => header.includes(needle) || needle.includes(header),
    );
    if (index >= 0) {
      return index;
    }
  }
  return undefined;
}

function scoreMapping(
  headers: string[],
  preset: BankPreset,
): { score: number; mapping: StatementColumnMapping } | null {
  const date = findColumn(headers, preset.aliases.date);
  const title = findColumn(headers, preset.aliases.title);
  if (date === undefined || title === undefined) {
    return null;
  }

  const amount = findColumn(headers, preset.aliases.amount);
  const debit = findColumn(headers, preset.aliases.debit);
  const credit = findColumn(headers, preset.aliases.credit);
  if (amount === undefined && (debit === undefined || credit === undefined)) {
    return null;
  }

  let score = 2;
  if (amount !== undefined) score += 2;
  if (debit !== undefined) score += 1;
  if (credit !== undefined) score += 1;

  return {
    score,
    mapping: { date, title, amount, debit, credit },
  };
}

export function resolveMapping(
  headers: string[],
  presetId: StatementBankPresetId,
): { presetId: Exclude<StatementBankPresetId, "auto">; mapping: StatementColumnMapping } {
  if (presetId !== "auto") {
    const preset = BANK_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      throw new Error("Неизвестный шаблон банка");
    }
    const scored = scoreMapping(headers, preset);
    if (!scored) {
      throw new Error(`Не удалось сопоставить колонки для шаблона «${preset.label}»`);
    }
    return { presetId: preset.id, mapping: scored.mapping };
  }

  let best: {
    presetId: Exclude<StatementBankPresetId, "auto">;
    mapping: StatementColumnMapping;
    score: number;
  } | null = null;

  for (const preset of BANK_PRESETS) {
    const scored = scoreMapping(headers, preset);
    if (!scored) continue;
    if (!best || scored.score > best.score) {
      best = { presetId: preset.id, mapping: scored.mapping, score: scored.score };
    }
  }

  if (!best) {
    throw new Error("Не удалось определить колонки даты, описания и суммы");
  }
  return { presetId: best.presetId, mapping: best.mapping };
}

export function detectDelimiter(sampleLine: string): "," | ";" {
  const commas = (sampleLine.match(/,/g) ?? []).length;
  const semis = (sampleLine.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

export function splitCsvLine(line: string, delimiter: "," | ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export function parseMoneyToMinor(raw: string, currency: string): number {
  const cleaned = raw
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, "")
    .replace(/[^\d,.\-+()]/g, "");

  if (!cleaned || cleaned === "-" || cleaned === "+" || cleaned === "()") {
    return 0;
  }

  let negative = cleaned.includes("-") || (cleaned.startsWith("(") && cleaned.endsWith(")"));
  let body = cleaned.replace(/[()+\-]/g, "");

  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      body = body.replace(/\./g, "").replace(",", ".");
    } else {
      body = body.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    const fraction = body.length - lastComma - 1;
    body = fraction === 3 && !body.includes(".") ? body.replace(/,/g, "") : body.replace(",", ".");
  }

  if (!/^\d+(\.\d+)?$/.test(body)) {
    throw new Error(`Некорректная сумма: ${raw}`);
  }

  const [wholePart, fractionPart = ""] = body.split(".");
  const fraction = (fractionPart + "00").slice(0, 2);
  const minor = Number(wholePart) * 100 + Number(fraction);
  if (!Number.isSafeInteger(minor)) {
    throw new Error("Сумма слишком большая");
  }

  void currency;
  return negative ? -minor : minor;
}

export function parseStatementDate(raw: string): string {
  const value = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(value);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}T12:00:00.000Z`;
  }

  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(value);
  if (dmy) {
    const day = dmy[1]!.padStart(2, "0");
    const month = dmy[2]!.padStart(2, "0");
    const year = dmy[3]!;
    return `${year}-${month}-${day}T12:00:00.000Z`;
  }

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (mdy) {
    const month = mdy[1]!.padStart(2, "0");
    const day = mdy[2]!.padStart(2, "0");
    const year = mdy[3]!;
    return `${year}-${month}-${day}T12:00:00.000Z`;
  }

  throw new Error(`Некорректная дата: ${raw}`);
}

function buildAmountMinor(
  cells: string[],
  mapping: StatementColumnMapping,
  currency: string,
): number {
  if (mapping.amount !== undefined) {
    return parseMoneyToMinor(cells[mapping.amount] ?? "", currency);
  }

  const debit = parseMoneyToMinor(cells[mapping.debit!] ?? "", currency);
  const credit = parseMoneyToMinor(cells[mapping.credit!] ?? "", currency);
  if (debit !== 0 && credit !== 0) {
    throw new Error("В строке заполнены и дебет, и кредит");
  }
  if (debit !== 0) {
    return debit > 0 ? -debit : debit;
  }
  if (credit !== 0) {
    return credit < 0 ? -credit : credit;
  }
  return 0;
}

export function assertStatementFileLimits(input: {
  byteLength: number;
  textLength?: number;
}): void {
  if (input.byteLength <= 0) {
    throw new Error("Файл пустой");
  }
  if (input.byteLength > MAX_STATEMENT_BYTES) {
    throw new Error("Файл слишком большой (максимум 8 МБ)");
  }
  if (input.textLength !== undefined && input.textLength > MAX_STATEMENT_BYTES) {
    throw new Error("Файл слишком большой после чтения");
  }
}

const DATE_PREFIX =
  /^(\d{1,2}[./]\d{1,2}[./]\d{4}|\d{4}-\d{2}-\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/;

const AMOUNT_TAIL =
  /([+-]?\(?\d{1,3}(?:[\s\u00a0]\d{3})*(?:[.,]\d{1,2})?\)?|[+-]?\d+[.,]\d{1,2}|\(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[.,]\d{1,2})?\))\s*$/;

const INCOME_HINT =
  /пополнен|зачислен|приход|перевод\s+на|incoming|deposit|salary|зарплат|возврат|refund|credit/i;
const EXPENSE_HINT =
  /списан|оплат|покупк|перевод\s+с|withdrawal|purchase|payment|debit|комисс/i;

const NOISE_LINE =
  /^(стр\.|страница|page|итого|total|баланс|balance|выписка|statement|период|period|счет|account|клиент|fio|бИН|иИН)/i;

function inferPdfBank(lines: string[]): Exclude<StatementBankPresetId, "auto"> {
  const sample = lines.slice(0, 40).join(" ").toLowerCase();
  if (sample.includes("kaspi")) return "kaspi";
  if (sample.includes("halyk") || sample.includes("халык") || sample.includes("народный банк")) {
    return "halyk";
  }
  if (/[а-яё]/i.test(sample)) return "generic_ru";
  return "generic_en";
}

function applyTitleSignHints(title: string, amountMinor: number, amountRaw: string): number {
  if (amountMinor === 0) return 0;

  const explicitSign =
    amountRaw.includes("-") ||
    amountRaw.includes("+") ||
    (amountRaw.includes("(") && amountRaw.includes(")"));

  if (explicitSign) {
    return amountMinor;
  }
  if (INCOME_HINT.test(title) && !EXPENSE_HINT.test(title)) {
    return Math.abs(amountMinor);
  }
  if (EXPENSE_HINT.test(title)) {
    return -Math.abs(amountMinor);
  }
  // Без знака и явных подсказок — типичный расход по карте
  return -Math.abs(amountMinor);
}

/** Разбор текстовых строк выписки (после извлечения из PDF). */
export function parsePdfStatementLines(
  lines: string[],
  input: {
    currency: string;
    presetId?: StatementBankPresetId;
  },
): StatementParseResult {
  if (lines.length === 0) {
    throw new Error("В PDF нет текста — возможно, это скан без распознавания");
  }
  if (lines.length > MAX_STATEMENT_ROWS * 3) {
    throw new Error("Слишком много строк в PDF");
  }

  const presetId =
    input.presetId && input.presetId !== "auto"
      ? input.presetId
      : inferPdfBank(lines);

  const rows: ParsedStatementRow[] = [];
  const issues: StatementParseIssue[] = [];
  let skipped = 0;
  let lineNumber = 0;

  for (let i = 0; i < lines.length; i += 1) {
    lineNumber = i + 1;
    let line = lines[i]!.replace(/\u00a0/g, " ").trim();
    if (!line || NOISE_LINE.test(line)) {
      continue;
    }

    const dateMatch = DATE_PREFIX.exec(line);
    if (!dateMatch) {
      continue;
    }

    let rest = line.slice(dateMatch[0].length).trim();
    let amountRaw: string | null = null;
    const amountMatch = AMOUNT_TAIL.exec(rest);
    if (amountMatch) {
      amountRaw = amountMatch[1]!;
      rest = rest.slice(0, amountMatch.index).trim();
    } else if (i + 1 < lines.length) {
      // Сумма на следующей строке (частый формат мобильных выписок)
      const next = lines[i + 1]!.replace(/\u00a0/g, " ").trim();
      const nextAmount = AMOUNT_TAIL.exec(next);
      if (nextAmount && nextAmount[0] === next) {
        amountRaw = nextAmount[1]!;
        i += 1;
      }
    }

    if (!amountRaw) {
      continue;
    }

    try {
      const occurredAt = parseStatementDate(dateMatch[0]!.trim());
      let amountMinor = parseMoneyToMinor(amountRaw, input.currency);
      amountMinor = resolveAmountSign(rest, amountMinor);
      amountMinor = applyTitleSignHints(rest, amountMinor);

      const title = (rest || "Импорт выписки").slice(0, 120);
      if (amountMinor === 0) {
        skipped += 1;
        continue;
      }

      rows.push({
        lineNumber,
        occurredAt,
        title,
        amountMinor,
        kind: amountMinor < 0 ? "expense" : "income",
      });

      if (rows.length > MAX_STATEMENT_ROWS) {
        throw new Error(`Слишком много операций (максимум ${MAX_STATEMENT_ROWS})`);
      }
    } catch (err: unknown) {
      issues.push({
        lineNumber,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (rows.length === 0) {
    throw new Error(
      issues[0]
        ? `Не удалось прочитать операции. Пример: строка ${issues[0].lineNumber} — ${issues[0].message}`
        : "Не найдено операций с датой и суммой. Нужен PDF с текстовым слоем, не скан.",
    );
  }

  return {
    source: "pdf",
    headers: ["дата", "описание", "сумма"],
    presetId,
    rows,
    issues,
    skipped,
  };
}

type PdfJsTextItem = {
  str?: string;
  transform?: number[];
};

type PdfJsPage = {
  getTextContent: () => Promise<{ items: PdfJsTextItem[] }>;
};

type PdfJsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
};

/** Извлекает строки текста из PDF (pdf.js). */
export async function extractPdfTextLines(data: ArrayBuffer): Promise<{
  lines: string[];
  pageCount: number;
}> {
  const pdfjs = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
  const pdf = (await loadingTask.promise) as PdfJsDocument;
  const allLines: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items.filter(
      (item): item is PdfJsTextItem & { str: string; transform: number[] } =>
        typeof item.str === "string" &&
        item.str.trim().length > 0 &&
        Array.isArray(item.transform),
    );

    items.sort((a, b) => {
      const yDiff = (b.transform[5] ?? 0) - (a.transform[5] ?? 0);
      if (Math.abs(yDiff) > 2) return yDiff;
      return (a.transform[4] ?? 0) - (b.transform[4] ?? 0);
    });

    const pageLines: string[] = [];
    let currentY: number | null = null;
    let currentParts: string[] = [];

    const flush = () => {
      const text = currentParts.join(" ").replace(/\s+/g, " ").trim();
      if (text) pageLines.push(text);
      currentParts = [];
    };

    for (const item of items) {
      const y = item.transform[5] ?? 0;
      if (currentY === null || Math.abs(y - currentY) <= 2.5) {
        currentParts.push(item.str);
        currentY = currentY === null ? y : currentY;
      } else {
        flush();
        currentParts.push(item.str);
        currentY = y;
      }
    }
    flush();
    allLines.push(...pageLines);
  }

  return { lines: allLines, pageCount: pdf.numPages };
}

export async function parseBankStatementPdf(
  data: ArrayBuffer,
  input: {
    currency: string;
    presetId?: StatementBankPresetId;
  },
): Promise<StatementParseResult> {
  assertStatementFileLimits({ byteLength: data.byteLength });
  const { lines, pageCount } = await extractPdfTextLines(data);
  const parsed = parsePdfStatementLines(lines, input);
  return { ...parsed, pageCount };
}

export function parseBankStatementCsv(
  text: string,
  input: {
    currency: string;
    presetId?: StatementBankPresetId;
  },
): StatementParseResult {
  const cleaned = text.replace(/^\uFEFF/, "");
  assertStatementFileLimits({
    byteLength: new TextEncoder().encode(cleaned).length,
    textLength: cleaned.length,
  });

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("В файле нет строк данных");
  }
  if (lines.length - 1 > MAX_STATEMENT_ROWS) {
    throw new Error(`Слишком много строк (максимум ${MAX_STATEMENT_ROWS})`);
  }

  const delimiter = detectDelimiter(lines[0]!);
  const headers = splitCsvLine(lines[0]!, delimiter);
  if (headers.length < 2) {
    throw new Error("Слишком мало колонок в заголовке");
  }

  const resolved = resolveMapping(headers, input.presetId ?? "auto");
  const rows: ParsedStatementRow[] = [];
  const issues: StatementParseIssue[] = [];
  let skipped = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const cells = splitCsvLine(lines[index]!, delimiter);
    try {
      const title = (cells[resolved.mapping.title] ?? "").trim() || "Импорт выписки";
      if (title.length > 200) {
        throw new Error("Слишком длинное описание");
      }
      const occurredAt = parseStatementDate(cells[resolved.mapping.date] ?? "");
      const amountMinor = buildAmountMinor(cells, resolved.mapping, input.currency);
      if (amountMinor === 0) {
        skipped += 1;
        continue;
      }
      rows.push({
        lineNumber,
        occurredAt,
        title: title.slice(0, 120),
        amountMinor,
        kind: amountMinor < 0 ? "expense" : "income",
      });
    } catch (err: unknown) {
      issues.push({
        lineNumber,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (rows.length === 0) {
    throw new Error(
      issues[0]
        ? `Не удалось прочитать операции. Пример: строка ${issues[0].lineNumber} — ${issues[0].message}`
        : "Не найдено ни одной операции",
    );
  }

  return {
    source: "csv",
    delimiter,
    headers,
    mapping: resolved.mapping,
    presetId: resolved.presetId,
    rows,
    issues,
    skipped,
  };
}
