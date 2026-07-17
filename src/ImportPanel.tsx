import { FormEvent, useMemo, useRef, useState } from "react";
import {
  importTransactions,
  type Account,
  type Category,
} from "./db";
import { formatMoney } from "./money";
import {
  listStatementPresets,
  parseBankStatementCsv,
  type ParsedStatementRow,
  type StatementBankPresetId,
  type StatementParseResult,
} from "./statementImport";

type Props = {
  accounts: Account[];
  categories: Category[];
  onImported: () => Promise<void> | void;
};

type PreviewRow = ParsedStatementRow & {
  selected: boolean;
  categoryId: number | "";
};

function formatImportDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function ImportPanel({ accounts, categories, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [presetId, setPresetId] = useState<StatementBankPresetId>("auto");
  const [accountId, setAccountId] = useState<number | "">(
    accounts[0]?.id ?? "",
  );
  const [defaultExpenseCategoryId, setDefaultExpenseCategoryId] = useState<
    number | ""
  >(categories.find((category) => category.kind === "expense")?.id ?? "");
  const [defaultIncomeCategoryId, setDefaultIncomeCategoryId] = useState<
    number | ""
  >(categories.find((category) => category.kind === "income")?.id ?? "");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<StatementParseResult | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const expenseCategories = useMemo(
    () => categories.filter((category) => category.kind === "expense"),
    [categories],
  );
  const incomeCategories = useMemo(
    () => categories.filter((category) => category.kind === "income"),
    [categories],
  );
  const selectedRows = rows.filter((row) => row.selected);
  const selectedIncome = selectedRows.filter((row) => row.kind === "income").length;
  const selectedExpense = selectedRows.filter((row) => row.kind === "expense").length;

  function defaultCategoryFor(kind: "income" | "expense"): number | "" {
    return kind === "expense" ? defaultExpenseCategoryId : defaultIncomeCategoryId;
  }

  async function onFileChosen(file: File | null) {
    setError(null);
    setNotice(null);
    setParseResult(null);
    setRows([]);
    setFileName(null);

    if (!file) {
      return;
    }
    if (!selectedAccount) {
      setError("Сначала выберите счёт");
      return;
    }
    if (!/\.csv$/i.test(file.name) && file.type && !file.type.includes("csv") && file.type !== "text/plain") {
      setError("Поддерживается CSV-выписка (.csv)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Файл слишком большой (максимум 2 МБ)");
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseBankStatementCsv(text, {
        currency: selectedAccount.currency,
        presetId,
      });
      setFileName(file.name);
      setParseResult(parsed);
      setRows(
        parsed.rows.map((row) => ({
          ...row,
          selected: true,
          categoryId: defaultCategoryFor(row.kind),
        })),
      );
      setNotice(
        `Распознано ${parsed.rows.length} операций` +
          (parsed.issues.length > 0 ? `, ошибок строк: ${parsed.issues.length}` : "") +
          (parsed.skipped > 0 ? `, пропущено нулевых: ${parsed.skipped}` : ""),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function applyDefaultCategories() {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        categoryId: defaultCategoryFor(row.kind),
      })),
    );
  }

  async function onImport(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (accountId === "") {
      setError("Выберите счёт");
      return;
    }
    if (selectedRows.length === 0) {
      setError("Отметьте хотя бы одну операцию");
      return;
    }

    for (const row of selectedRows) {
      if (row.kind === "expense" && row.categoryId === "") {
        setError("У всех расходов должна быть категория");
        return;
      }
    }

    setBusy(true);
    try {
      const result = await importTransactions({
        accountId,
        skipDuplicates: true,
        rows: selectedRows.map((row) => ({
          title: row.title,
          amountMinor: row.amountMinor,
          occurredAt: row.occurredAt,
          categoryId: row.categoryId === "" ? null : row.categoryId,
        })),
      });
      setNotice(
        `Импортировано: ${result.imported}` +
          (result.skippedDuplicates > 0
            ? `, пропущено дублей: ${result.skippedDuplicates}`
            : ""),
      );
      setParseResult(null);
      setRows([]);
      setFileName(null);
      await onImported();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel import-panel">
      <header className="panel-head import-head">
        <div>
          <p className="eyebrow">Выписки</p>
          <h2>Импорт</h2>
          <p className="muted">
            Загрузите CSV из банка, проверьте строки и запишите операции на счёт.
            Файл остаётся только на этом устройстве.
          </p>
        </div>
      </header>

      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="banner notice" role="status">
          {notice}
        </p>
      )}

      <form className="import-setup" onSubmit={onImport}>
        <div className="import-setup-grid">
          <label>
            <span>Счёт</span>
            <select
              value={accountId}
              onChange={(e) =>
                setAccountId(
                  e.currentTarget.value === "" ? "" : Number(e.currentTarget.value),
                )
              }
              required
            >
              {accounts.length === 0 && <option value="">Нет счетов</option>}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.currency}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Формат банка</span>
            <select
              value={presetId}
              onChange={(e) =>
                setPresetId(e.currentTarget.value as StatementBankPresetId)
              }
            >
              {listStatementPresets().map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Категория расходов по умолчанию</span>
            <select
              value={defaultExpenseCategoryId}
              onChange={(e) =>
                setDefaultExpenseCategoryId(
                  e.currentTarget.value === "" ? "" : Number(e.currentTarget.value),
                )
              }
            >
              <option value="">Не выбрана</option>
              {expenseCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Категория доходов по умолчанию</span>
            <select
              value={defaultIncomeCategoryId}
              onChange={(e) =>
                setDefaultIncomeCategoryId(
                  e.currentTarget.value === "" ? "" : Number(e.currentTarget.value),
                )
              }
            >
              <option value="">Без категории</option>
              {incomeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="import-file-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            onChange={(e) => onFileChosen(e.currentTarget.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="ghost"
            disabled={busy || accountId === ""}
            onClick={() => fileInputRef.current?.click()}
          >
            {busy ? "Читаю файл…" : "Выбрать CSV"}
          </button>
          <button
            type="button"
            className="ghost"
            disabled={rows.length === 0}
            onClick={applyDefaultCategories}
          >
            Проставить категории
          </button>
          <span className="muted">
            {fileName
              ? `${fileName}${parseResult ? ` · ${parseResult.presetId}` : ""}`
              : "CSV до 2 МБ, до 2000 строк"}
          </span>
        </div>

        {rows.length > 0 && (
          <>
            <div className="import-summary">
              <div>
                <span>К импорту</span>
                <strong className="mono">{selectedRows.length}</strong>
              </div>
              <div>
                <span>Доходы</span>
                <strong className="mono income">{selectedIncome}</strong>
              </div>
              <div>
                <span>Расходы</span>
                <strong className="mono expense">{selectedExpense}</strong>
              </div>
              <div>
                <span>Ошибок строк</span>
                <strong className="mono">{parseResult?.issues.length ?? 0}</strong>
              </div>
            </div>

            <div className="import-table-wrap">
              <table className="import-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && rows.every((row) => row.selected)}
                        onChange={(e) => {
                          const checked = e.currentTarget.checked;
                          setRows((prev) =>
                            prev.map((row) => ({ ...row, selected: checked })),
                          );
                        }}
                        aria-label="Выбрать все"
                      />
                    </th>
                    <th>Дата</th>
                    <th>Описание</th>
                    <th>Сумма</th>
                    <th>Категория</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.lineNumber}-${index}`} className={row.kind}>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => {
                            const checked = e.currentTarget.checked;
                            setRows((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, selected: checked }
                                  : item,
                              ),
                            );
                          }}
                          aria-label={`Строка ${row.lineNumber}`}
                        />
                      </td>
                      <td>{formatImportDate(row.occurredAt)}</td>
                      <td>
                        <strong>{row.title}</strong>
                      </td>
                      <td
                        className={`mono ${row.amountMinor >= 0 ? "income" : "expense"}`}
                      >
                        {selectedAccount
                          ? formatMoney(row.amountMinor, selectedAccount.currency)
                          : row.amountMinor}
                      </td>
                      <td>
                        <select
                          value={row.categoryId}
                          onChange={(e) => {
                            const value =
                              e.currentTarget.value === ""
                                ? ""
                                : Number(e.currentTarget.value);
                            setRows((prev) =>
                              prev.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, categoryId: value }
                                  : item,
                              ),
                            );
                          }}
                        >
                          <option value="">
                            {row.kind === "expense" ? "Выберите" : "Без категории"}
                          </option>
                          {(row.kind === "expense"
                            ? expenseCategories
                            : incomeCategories
                          ).map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {parseResult && parseResult.issues.length > 0 && (
              <details className="import-issues">
                <summary>Проблемные строки ({parseResult.issues.length})</summary>
                <ul>
                  {parseResult.issues.slice(0, 20).map((issue) => (
                    <li key={`${issue.lineNumber}-${issue.message}`}>
                      Строка {issue.lineNumber}: {issue.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="import-actions">
              <p className="muted">
                Дубликаты с тем же счётом, суммой, датой и описанием будут пропущены.
              </p>
              <button type="submit" disabled={busy || selectedRows.length === 0}>
                {busy ? "Импортирую…" : `Импортировать ${selectedRows.length}`}
              </button>
            </div>
          </>
        )}
      </form>
    </section>
  );
}
