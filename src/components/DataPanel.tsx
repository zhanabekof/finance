import { useRef, useState } from "react";
import {
  backupFileName,
  downloadBackupJson,
  exportFinanceBackup,
  readBackupFile,
  restoreFinanceBackup,
} from "../lib/backup";
import { currentYearMonth } from "../lib/budget";
import { exportConsultantReportPdf } from "../lib/reportPdf";
import { MonthSwitcher } from "./MonthSwitcher";

type Props = {
  currency: string;
  defaultYearMonth?: string;
  onRestored: () => Promise<void> | void;
};

function isYearMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function DataPanel({
  currency,
  defaultYearMonth = currentYearMonth(),
  onRestored,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [reportMonth, setReportMonth] = useState(
    isYearMonth(defaultYearMonth) ? defaultYearMonth : currentYearMonth(),
  );

  async function onExportBackup() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const backup = await exportFinanceBackup();
      downloadBackupJson(backup, backupFileName());
      setNotice("Бэкап сохранён в загрузках");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onExportReport() {
    setError(null);
    setNotice(null);
    if (!isYearMonth(reportMonth)) {
      setError("Выберите корректный месяц для отчёта");
      return;
    }
    setBusy(true);
    try {
      const filename = await exportConsultantReportPdf(reportMonth, currency);
      setNotice(`PDF-отчёт сохранён: ${filename}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onFileChosen(file: File | null) {
    setError(null);
    setNotice(null);
    if (!file) {
      return;
    }
    if (!confirmRestore) {
      setError("Сначала подтвердите, что готовы заменить все данные");
      return;
    }
    setBusy(true);
    try {
      const backup = await readBackupFile(file);
      await restoreFinanceBackup(backup);
      setConfirmRestore(false);
      setNotice("Данные восстановлены из бэкапа");
      await onRestored();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  }

  return (
    <section className="data-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Локально</p>
          <h2>Данные</h2>
          <p className="muted">
            Бэкап хранит полную историю. PDF-отчёт — разбор месяца в формате
            финансового консультанта с пояснениями и рекомендациями.
          </p>
        </div>
      </div>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="banner notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="data-card">
        <h3>PDF-отчёт консультанта</h3>
        <p className="muted">
          Итоги, план/факт бюджета, структура расходов, цели и понятные шаги на
          ближайшие недели. Файл формируется на устройстве.
        </p>
        <label className="data-report-month">
          <span>Месяц отчёта</span>
          <MonthSwitcher
            value={reportMonth}
            onChange={setReportMonth}
            ariaLabel="Месяц PDF-отчёта"
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void onExportReport()}>
          {busy ? "Готовлю…" : "Скачать PDF-отчёт"}
        </button>
      </div>

      <div className="data-card">
        <h3>Резервная копия</h3>
        <p className="muted">
          Сохраните JSON-файл со всей финансовой историей. Файл можно хранить в
          любом надёжном месте.
        </p>
        <button type="button" disabled={busy} onClick={() => void onExportBackup()}>
          {busy ? "Готовлю…" : "Скачать бэкап"}
        </button>
      </div>

      <div className="data-card data-card-danger">
        <h3>Восстановление</h3>
        <p className="muted">
          Текущие данные будут удалены и заменены содержимым файла. Это действие
          нельзя отменить без другого бэкапа.
        </p>
        <label className="data-confirm">
          <input
            type="checkbox"
            checked={confirmRestore}
            onChange={(event) => setConfirmRestore(event.target.checked)}
          />
          <span>Понимаю, что все текущие данные будут заменены</span>
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => void onFileChosen(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          className="danger-solid"
          disabled={busy || !confirmRestore}
          onClick={() => fileRef.current?.click()}
        >
          Выбрать файл бэкапа
        </button>
      </div>
    </section>
  );
}
