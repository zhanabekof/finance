import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  addGoal,
  addGoalContribution,
  archiveGoal,
  listGoalContributions,
  listGoals,
  updateGoal,
  type GoalContribution,
  type GoalSummary,
} from "./db";
import {
  buildGoalProgress,
  suggestedMonthlyContribution,
  type GoalProgress,
} from "./goals";
import { formatMoney } from "./money";

type Props = {
  currency: string;
  onChanged?: () => void;
};

type EditorState = {
  id: number | null;
  title: string;
  target: string;
  deadline: string;
};

type ContributeState = {
  goalId: number;
  amount: string;
  note: string;
};

const emptyEditor = (): EditorState => ({
  id: null,
  title: "",
  target: "",
  deadline: "",
});

const MONTH_OPTIONS = [
  { value: 1, label: "января" },
  { value: 2, label: "февраля" },
  { value: 3, label: "марта" },
  { value: 4, label: "апреля" },
  { value: 5, label: "мая" },
  { value: 6, label: "июня" },
  { value: 7, label: "июля" },
  { value: 8, label: "августа" },
  { value: 9, label: "сентября" },
  { value: 10, label: "октября" },
  { value: 11, label: "ноября" },
  { value: 12, label: "декабря" },
] as const;

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDeadlineParts(value: string): {
  year: number | "";
  month: number | "";
  day: number | "";
} {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { year: "", month: "", day: "" };
  }
  const [year, month, day] = value.split("-").map(Number);
  return { year: year ?? "", month: month ?? "", day: day ?? "" };
}

function composeDeadline(
  year: number | "",
  month: number | "",
  day: number | "",
): string {
  if (year === "" || month === "" || day === "") {
    return "";
  }
  const maxDay = daysInMonthUtc(year, month);
  const safeDay = Math.min(day, maxDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function shiftMonthsFromToday(monthsAhead: number, now = new Date()): string {
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth() + monthsAhead;
  const day = now.getUTCDate();
  const target = new Date(Date.UTC(year, monthIndex, 1));
  const maxDay = daysInMonthUtc(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(day, maxDay));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(
    target.getUTCDate(),
  ).padStart(2, "0")}`;
}

function formatDeadline(value: string | null): string {
  if (!value) {
    return "Без срока";
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)));
}

function formatDaysLeft(daysLeft: number): string {
  const abs = Math.abs(daysLeft);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  let unit = "дней";
  if (mod10 === 1 && mod100 !== 11) {
    unit = "день";
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    unit = "дня";
  }
  if (daysLeft > 0) {
    return `осталось ${abs} ${unit}`;
  }
  if (daysLeft === 0) {
    return "срок сегодня";
  }
  return `просрочено на ${abs} ${unit}`;
}

function deadlineYearOptions(now = new Date()): number[] {
  const start = now.getUTCFullYear();
  return Array.from({ length: 12 }, (_, index) => start + index);
}

const DEADLINE_PRESETS = [
  { id: "1m", label: "1 месяц", months: 1 },
  { id: "3m", label: "3 месяца", months: 3 },
  { id: "6m", label: "6 месяцев", months: 6 },
  { id: "1y", label: "1 год", months: 12 },
] as const;

function formatContributionDate(iso: string): string {
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

function progressLabel(progress: GoalProgress): string {
  if (progress.status === "done") {
    return "Достигнута";
  }
  if (progress.status === "near") {
    return "Почти";
  }
  if (progress.daysLeft != null && progress.daysLeft < 0) {
    return "Срок прошёл";
  }
  return "В процессе";
}

export function GoalsPanel({ currency, onChanged }: Props) {
  const [goals, setGoals] = useState<GoalSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [contribute, setContribute] = useState<ContributeState | null>(null);
  const [historyGoalId, setHistoryGoalId] = useState<number | null>(null);
  const [history, setHistory] = useState<GoalContribution[]>([]);
  const [pendingArchiveId, setPendingArchiveId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  async function reload() {
    const rows = await listGoals(showArchived);
    setGoals(rows);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showArchived]);

  const activeGoals = useMemo(
    () => goals.filter((goal) => !goal.archived),
    [goals],
  );
  const archivedGoals = useMemo(
    () => goals.filter((goal) => goal.archived),
    [goals],
  );

  const totals = useMemo(() => {
    let target = 0;
    let saved = 0;
    for (const goal of activeGoals) {
      if (goal.currency !== currency) {
        continue;
      }
      target += goal.target_minor;
      saved += goal.saved_minor;
    }
    return { target, saved, remaining: Math.max(target - saved, 0) };
  }, [activeGoals, currency]);

  async function onSubmitGoal(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (editor.id == null) {
        await addGoal({
          title: editor.title,
          currency,
          targetInput: editor.target,
          deadlineDate: editor.deadline || null,
        });
      } else {
        await updateGoal({
          id: editor.id,
          title: editor.title,
          targetInput: editor.target,
          deadlineDate: editor.deadline || null,
        });
      }
      setEditor(emptyEditor());
      await reload();
      onChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitContribution(event: FormEvent) {
    event.preventDefault();
    if (!contribute) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await addGoalContribution({
        goalId: contribute.goalId,
        amountInput: contribute.amount,
        note: contribute.note,
      });
      const goalId = contribute.goalId;
      setContribute(null);
      await reload();
      if (historyGoalId === goalId) {
        setHistory(await listGoalContributions(goalId));
      }
      onChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmArchive(id: number) {
    setError(null);
    setBusy(true);
    try {
      await archiveGoal(id);
      setPendingArchiveId(null);
      if (editor.id === id) {
        setEditor(emptyEditor());
      }
      if (contribute?.goalId === id) {
        setContribute(null);
      }
      if (historyGoalId === id) {
        setHistoryGoalId(null);
        setHistory([]);
      }
      await reload();
      onChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory(goalId: number) {
    if (historyGoalId === goalId) {
      setHistoryGoalId(null);
      setHistory([]);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const rows = await listGoalContributions(goalId);
      setHistoryGoalId(goalId);
      setHistory(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(goal: GoalSummary) {
    setPendingArchiveId(null);
    setContribute(null);
    setEditor({
      id: goal.id,
      title: goal.title,
      target: minorToDraft(goal.target_minor),
      deadline: goal.deadline_date ?? "",
    });
  }

  const visibleGoals = showArchived ? goals : activeGoals;

  return (
    <section className="panel goals-panel">
      <header className="panel-head goals-head">
        <div>
          <p className="eyebrow">Горизонт</p>
          <h2>Цели</h2>
          <p className="muted">
            Накопления к сроку: прогресс считается из пополнений, операции не
            меняются.
          </p>
        </div>
        <div className="goals-totals">
          <div>
            <span>Цель</span>
            <strong className="mono">{formatMoney(totals.target, currency)}</strong>
          </div>
          <div>
            <span>Накоплено</span>
            <strong className="mono income">{formatMoney(totals.saved, currency)}</strong>
          </div>
          <div>
            <span>Осталось</span>
            <strong className="mono">{formatMoney(totals.remaining, currency)}</strong>
          </div>
        </div>
      </header>

      {error && (
        <p className="banner error" role="alert">
          {error}
        </p>
      )}

      <div className="goals-workspace">
        <form className="goal-form" onSubmit={onSubmitGoal}>
          <div className="goal-form-head">
            <h3>{editor.id == null ? "Новая цель" : "Редактирование"}</h3>
            {editor.id != null && (
              <button
                type="button"
                className="ghost compact"
                onClick={() => setEditor(emptyEditor())}
              >
                Отмена
              </button>
            )}
          </div>

          <label>
            <span>Название</span>
            <input
              value={editor.title}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setEditor((prev) => ({ ...prev, title: value }));
              }}
              placeholder="Например, Отпуск"
              maxLength={80}
              required
            />
          </label>

          <div className="goal-form-row">
            <label>
              <span>Сумма цели</span>
              <input
                className="mono"
                value={editor.target}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setEditor((prev) => ({ ...prev, target: value }));
                }}
                placeholder="0.00"
                inputMode="decimal"
                required
              />
            </label>
          </div>

          <fieldset className="goal-deadline">
            <legend>Срок</legend>
            <div className="goal-deadline-presets" role="group" aria-label="Быстрый срок">
              {DEADLINE_PRESETS.map((preset) => {
                const presetValue = shiftMonthsFromToday(preset.months);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={editor.deadline === presetValue ? "active" : ""}
                    onClick={() =>
                      setEditor((prev) => ({ ...prev, deadline: presetValue }))
                    }
                  >
                    {preset.label}
                  </button>
                );
              })}
              <button
                type="button"
                className={editor.deadline === "" ? "active" : ""}
                onClick={() => setEditor((prev) => ({ ...prev, deadline: "" }))}
              >
                Без срока
              </button>
            </div>

            <div className="goal-deadline-picks">
              {(() => {
                const parts = parseDeadlineParts(editor.deadline);
                const year =
                  parts.year === "" ? new Date().getUTCFullYear() : parts.year;
                const month = parts.month === "" ? 1 : parts.month;
                const maxDay = daysInMonthUtc(year, month);
                return (
                  <>
                    <label>
                      <span>День</span>
                      <select
                        value={parts.day}
                        onChange={(e) => {
                          const day =
                            e.currentTarget.value === ""
                              ? ""
                              : Number(e.currentTarget.value);
                          setEditor((prev) => {
                            const current = parseDeadlineParts(prev.deadline);
                            const nextYear =
                              current.year === ""
                                ? new Date().getUTCFullYear()
                                : current.year;
                            const nextMonth = current.month === "" ? 1 : current.month;
                            return {
                              ...prev,
                              deadline: composeDeadline(nextYear, nextMonth, day),
                            };
                          });
                        }}
                        aria-label="День срока"
                      >
                        <option value="">—</option>
                        {Array.from({ length: maxDay }, (_, index) => index + 1).map(
                          (day) => (
                            <option key={day} value={day}>
                              {day}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label>
                      <span>Месяц</span>
                      <select
                        value={parts.month}
                        onChange={(e) => {
                          const month =
                            e.currentTarget.value === ""
                              ? ""
                              : Number(e.currentTarget.value);
                          setEditor((prev) => {
                            const current = parseDeadlineParts(prev.deadline);
                            const nextYear =
                              current.year === ""
                                ? new Date().getUTCFullYear()
                                : current.year;
                            const nextDay = current.day === "" ? 1 : current.day;
                            return {
                              ...prev,
                              deadline: composeDeadline(nextYear, month, nextDay),
                            };
                          });
                        }}
                        aria-label="Месяц срока"
                      >
                        <option value="">—</option>
                        {MONTH_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Год</span>
                      <select
                        value={parts.year}
                        onChange={(e) => {
                          const year =
                            e.currentTarget.value === ""
                              ? ""
                              : Number(e.currentTarget.value);
                          setEditor((prev) => {
                            const current = parseDeadlineParts(prev.deadline);
                            const nextMonth = current.month === "" ? 1 : current.month;
                            const nextDay = current.day === "" ? 1 : current.day;
                            return {
                              ...prev,
                              deadline: composeDeadline(year, nextMonth, nextDay),
                            };
                          });
                        }}
                        aria-label="Год срока"
                      >
                        <option value="">—</option>
                        {deadlineYearOptions().map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                );
              })()}
            </div>

            <p className="muted goal-deadline-summary">
              {editor.deadline
                ? `До ${formatDeadline(editor.deadline)}`
                : "Срок не задан — цель без дедлайна"}
            </p>
          </fieldset>

          <p className="muted goal-form-hint">Валюта цели: {currency}</p>

          <button type="submit" disabled={busy || !editor.title.trim()}>
            {busy
              ? "Сохранение…"
              : editor.id == null
                ? "Создать цель"
                : "Сохранить изменения"}
          </button>
        </form>

        <div className="goals-board">
          <div className="goals-toolbar">
            <h3>Ваши цели</h3>
            <label className="goals-archive-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.currentTarget.checked)}
              />
              Показать архив
            </label>
          </div>

          {loading ? (
            <p className="muted">Загрузка целей…</p>
          ) : visibleGoals.length === 0 ? (
            <div className="goals-empty">
              <strong>Пока нет целей</strong>
              <p>Создайте первую слева — например, резерв или крупную покупку.</p>
            </div>
          ) : (
            <ul className="goal-list">
              {visibleGoals.map((goal) => {
                const progress = buildGoalProgress({
                  targetMinor: goal.target_minor,
                  savedMinor: goal.saved_minor,
                  deadlineDate: goal.deadline_date,
                });
                const monthly =
                  progress.daysLeft != null && progress.daysLeft > 0
                    ? suggestedMonthlyContribution(
                        progress.remainingMinor,
                        progress.daysLeft,
                      )
                    : null;
                const isContributing = contribute?.goalId === goal.id;
                const isHistory = historyGoalId === goal.id;

                return (
                  <li
                    key={goal.id}
                    className={`goal-card status-${progress.status}${
                      goal.archived ? " archived" : ""
                    }`}
                  >
                    <div className="goal-card-head">
                      <div>
                        <strong>{goal.title}</strong>
                        <span className="muted">
                          {goal.deadline_date
                            ? `До ${formatDeadline(goal.deadline_date)}`
                            : "Без срока"}
                          {progress.daysLeft != null && !goal.archived
                            ? ` · ${formatDaysLeft(progress.daysLeft)}`
                            : ""}
                        </span>
                      </div>
                      <em className={`goal-status ${progress.status}`}>
                        {goal.archived ? "Архив" : progressLabel(progress)}
                      </em>
                    </div>

                    <div className="goal-meter" aria-hidden>
                      <i
                        style={{
                          width: `${Math.min(progress.usageRatio * 100, 100)}%`,
                        }}
                      />
                    </div>

                    <div className="goal-stats">
                      <div>
                        <span>Накоплено</span>
                        <strong className="mono">
                          {formatMoney(goal.saved_minor, goal.currency)}
                        </strong>
                      </div>
                      <div>
                        <span>Цель</span>
                        <strong className="mono">
                          {formatMoney(goal.target_minor, goal.currency)}
                        </strong>
                      </div>
                      <div>
                        <span>Осталось</span>
                        <strong className="mono">
                          {formatMoney(progress.remainingMinor, goal.currency)}
                        </strong>
                      </div>
                      <div>
                        <span>Прогресс</span>
                        <strong className="mono">
                          {Math.round(progress.usageRatio * 100)}%
                        </strong>
                      </div>
                    </div>

                    {monthly != null && monthly > 0 && !goal.archived && (
                      <p className="muted goal-pace">
                        Чтобы успеть: около{" "}
                        <span className="mono">
                          {formatMoney(monthly, goal.currency)}
                        </span>{" "}
                        в месяц
                      </p>
                    )}

                    {!goal.archived && (
                      <div className="goal-actions">
                        <button
                          type="button"
                          className="ghost compact"
                          disabled={busy}
                          onClick={() =>
                            setContribute({
                              goalId: goal.id,
                              amount: "",
                              note: "",
                            })
                          }
                        >
                          Пополнить
                        </button>
                        <button
                          type="button"
                          className="ghost compact"
                          disabled={busy}
                          onClick={() => startEdit(goal)}
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          className="ghost compact"
                          disabled={busy}
                          onClick={() => toggleHistory(goal.id)}
                        >
                          {isHistory ? "Скрыть историю" : "История"}
                        </button>
                        {pendingArchiveId === goal.id ? (
                          <>
                            <button
                              type="button"
                              className="ghost compact"
                              disabled={busy}
                              onClick={() => setPendingArchiveId(null)}
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              className="danger-solid compact"
                              disabled={busy}
                              onClick={() => confirmArchive(goal.id)}
                            >
                              В архив
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="ghost compact danger"
                            disabled={busy}
                            onClick={() => setPendingArchiveId(goal.id)}
                          >
                            Архив
                          </button>
                        )}
                      </div>
                    )}

                    {isContributing && contribute && (
                      <form className="goal-contribute" onSubmit={onSubmitContribution}>
                        <label>
                          <span>Сумма</span>
                          <input
                            className="mono"
                            value={contribute.amount}
                            onChange={(e) => {
                              const value = e.currentTarget.value;
                              setContribute((prev) =>
                                prev ? { ...prev, amount: value } : prev,
                              );
                            }}
                            placeholder="0.00"
                            inputMode="decimal"
                            required
                            autoFocus
                          />
                        </label>
                        <label>
                          <span>Заметка</span>
                          <input
                            value={contribute.note}
                            onChange={(e) => {
                              const value = e.currentTarget.value;
                              setContribute((prev) =>
                                prev ? { ...prev, note: value } : prev,
                              );
                            }}
                            placeholder="Необязательно"
                          />
                        </label>
                        <div className="goal-contribute-actions">
                          <button
                            type="button"
                            className="ghost compact"
                            onClick={() => setContribute(null)}
                          >
                            Отмена
                          </button>
                          <button type="submit" disabled={busy}>
                            {busy ? "…" : "Добавить"}
                          </button>
                        </div>
                      </form>
                    )}

                    {isHistory && (
                      <ul className="goal-history">
                        {history.map((row) => (
                          <li key={row.id}>
                            <span>{formatContributionDate(row.contributed_at)}</span>
                            <span className="muted">{row.note || "Пополнение"}</span>
                            <strong className="mono income">
                              +{formatMoney(row.amount_minor, goal.currency)}
                            </strong>
                          </li>
                        ))}
                        {history.length === 0 && (
                          <li className="empty">Пополнений пока нет</li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {showArchived && archivedGoals.length === 0 && activeGoals.length > 0 && (
            <p className="muted">В архиве пусто.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function minorToDraft(amountMinor: number): string {
  const abs = Math.abs(amountMinor);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}
