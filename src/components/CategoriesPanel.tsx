import { FormEvent, useMemo, useRef, useState } from "react";
import type { Category } from "../lib/db";

type Props = {
  categories: Category[];
  onCreate: (input: {
    name: string;
    kind: "income" | "expense";
    isEssential: boolean;
  }) => Promise<void>;
  onUpdate: (input: {
    id: number;
    name: string;
    isEssential: boolean;
  }) => Promise<void>;
  onArchive: (id: number) => Promise<void>;
};

type EditorState = {
  id: number | null;
  name: string;
  kind: "income" | "expense";
  isEssential: boolean;
};

const emptyEditor = (): EditorState => ({
  id: null,
  name: "",
  kind: "expense",
  isEssential: true,
});

const SUGGESTIONS = {
  expense: ["Аренда", "Продукты", "Транспорт", "Подписки"],
  income: ["Зарплата", "Подработка", "Инвестиции", "Подарки"],
} as const;

export function CategoriesPanel({
  categories,
  onCreate,
  onUpdate,
  onArchive,
}: Props) {
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [filter, setFilter] = useState<"all" | "expense" | "income">("all");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    if (filter === "all") {
      return categories;
    }
    return categories.filter((category) => category.kind === filter);
  }, [categories, filter]);

  const expenseCount = categories.filter((c) => c.kind === "expense").length;
  const incomeCount = categories.filter((c) => c.kind === "income").length;
  const essentialExpenseCount = categories.filter(
    (c) => c.kind === "expense" && c.is_essential,
  ).length;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);
    setBusy(true);
    try {
      if (editor.id == null) {
        await onCreate({
          name: editor.name,
          kind: editor.kind,
          isEssential: editor.isEssential,
        });
      } else {
        await onUpdate({
          id: editor.id,
          name: editor.name,
          isEssential: editor.isEssential,
        });
      }
      setEditor(emptyEditor());
      setFilter("all");
      window.requestAnimationFrame(() => nameInputRef.current?.focus());
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(category: Category) {
    setLocalError(null);
    setPendingDeleteId(null);
    setEditor({
      id: category.id,
      name: category.name,
      kind: category.kind,
      isEssential: Boolean(category.is_essential),
    });
    window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }

  function cancelEdit() {
    setLocalError(null);
    setPendingDeleteId(null);
    setEditor(emptyEditor());
  }

  function selectKind(kind: "income" | "expense") {
    setLocalError(null);
    setEditor((prev) => ({
      ...prev,
      kind,
      isEssential: kind === "expense" ? true : false,
    }));
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  }

  const normalizedNames = useMemo(
    () =>
      new Set(
        categories
          .filter((category) => category.kind === editor.kind && category.id !== editor.id)
          .map((category) => category.name.toLocaleLowerCase("ru")),
      ),
    [categories, editor.id, editor.kind],
  );
  const duplicateName =
    editor.name.trim().length > 0 &&
    normalizedNames.has(editor.name.trim().toLocaleLowerCase("ru"));
  const suggestions = SUGGESTIONS[editor.kind].filter(
    (suggestion) => !normalizedNames.has(suggestion.toLocaleLowerCase("ru")),
  );

  async function confirmArchive(category: Category) {
    setLocalError(null);
    setBusy(true);
    try {
      await onArchive(category.id);
      setPendingDeleteId(null);
      if (editor.id === category.id) {
        setEditor(emptyEditor());
      }
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel categories-panel">
      <header className="panel-head">
        <div>
          <p className="eyebrow">Справочник</p>
          <h2>Категории</h2>
          <p className="muted">
            Доходы и расходы: обязательные и необязательные. Удаление только скрывает
            категорию — история операций не трогается.
          </p>
        </div>
      </header>

      <div className="category-stats">
        <div>
          <span>Расходы</span>
          <strong className="mono">{expenseCount}</strong>
        </div>
        <div>
          <span>Обязательные расходы</span>
          <strong className="mono">{essentialExpenseCount}</strong>
        </div>
        <div>
          <span>Доходы</span>
          <strong className="mono">{incomeCount}</strong>
        </div>
      </div>

      <form className={`category-form ${editor.id != null ? "editing" : ""}`} onSubmit={onSubmit}>
        <div className="category-form-head">
          <div>
            <p className="form-kicker">
              {editor.id == null ? "Добавить в справочник" : "Режим редактирования"}
            </p>
            <h3>{editor.id == null ? "Новая категория" : editor.name}</h3>
            <p className="muted">
              Категория появится в операциях, бюджете и аналитике.
            </p>
          </div>
          {editor.id != null && (
            <button type="button" className="ghost compact" onClick={cancelEdit}>
              Отменить изменения
            </button>
          )}
        </div>

        <div className="category-workspace">
          <div className="category-fields">
            <fieldset className="category-kind-field" disabled={editor.id != null}>
              <legend>1. Что вы планируете учитывать?</legend>
              <div className="category-kind-options">
                <button
                  type="button"
                  className={editor.kind === "expense" ? "selected expense-kind" : ""}
                  aria-pressed={editor.kind === "expense"}
                  onClick={() => selectKind("expense")}
                >
                  <span className="kind-symbol" aria-hidden>−</span>
                  <span>
                    <strong>Расход</strong>
                    <small>Деньги уходят со счёта</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={editor.kind === "income" ? "selected income-kind" : ""}
                  aria-pressed={editor.kind === "income"}
                  onClick={() => selectKind("income")}
                >
                  <span className="kind-symbol" aria-hidden>+</span>
                  <span>
                    <strong>Доход</strong>
                    <small>Деньги поступают на счёт</small>
                  </span>
                </button>
              </div>
              {editor.id != null && (
                <small className="field-note">Тип нельзя изменить после создания.</small>
              )}
            </fieldset>

            <div className="category-name-field">
              <label htmlFor="category-name">2. Название категории</label>
              <div className={`input-shell ${duplicateName ? "invalid" : ""}`}>
                <input
                  ref={nameInputRef}
                  id="category-name"
                  value={editor.name}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setLocalError(null);
                    setEditor((prev) => ({ ...prev, name: value }));
                  }}
                  placeholder={
                    editor.kind === "expense"
                      ? "Например, Аренда"
                      : "Например, Зарплата"
                  }
                  required
                  maxLength={80}
                  autoComplete="off"
                  aria-invalid={duplicateName}
                  aria-describedby={duplicateName ? "category-name-error" : undefined}
                />
                <span className="char-count">{editor.name.length}/80</span>
              </div>
              {duplicateName ? (
                <small id="category-name-error" className="field-error">
                  Категория с таким названием уже есть.
                </small>
              ) : (
                suggestions.length > 0 && (
                  <div className="category-suggestions" aria-label="Примеры категорий">
                    <span>Быстрый выбор:</span>
                    {suggestions.map((suggestion) => (
                      <button
                        type="button"
                        key={suggestion}
                        onClick={() =>
                          setEditor((prev) => ({ ...prev, name: suggestion }))
                        }
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>

            <fieldset className="category-priority-field">
              <legend>
                3. {editor.kind === "expense" ? "Это обязательный расход?" : "Это регулярный доход?"}
              </legend>
              <div className="priority-options">
                <label className={editor.isEssential ? "selected" : ""}>
                  <input
                    type="radio"
                    name="category-priority"
                    checked={editor.isEssential}
                    onChange={() =>
                      setEditor((prev) => ({ ...prev, isEssential: true }))
                    }
                  />
                  <span>
                    <strong>{editor.kind === "expense" ? "Обязательный" : "Регулярный"}</strong>
                    <small>
                      {editor.kind === "expense"
                        ? "Нужно оплатить в любом случае"
                        : "Ожидается постоянно"}
                    </small>
                  </span>
                </label>
                <label className={!editor.isEssential ? "selected" : ""}>
                  <input
                    type="radio"
                    name="category-priority"
                    checked={!editor.isEssential}
                    onChange={() =>
                      setEditor((prev) => ({ ...prev, isEssential: false }))
                    }
                  />
                  <span>
                    <strong>{editor.kind === "expense" ? "Необязательный" : "Нерегулярный"}</strong>
                    <small>
                      {editor.kind === "expense"
                        ? "Можно сократить или отложить"
                        : "Разовое поступление"}
                    </small>
                  </span>
                </label>
              </div>
            </fieldset>
          </div>

          <aside className="category-preview" aria-live="polite">
            <span className="metric-label">Как это будет выглядеть</span>
            <div className={`preview-card ${editor.kind}`}>
              <span className="preview-symbol" aria-hidden>
                {editor.kind === "expense" ? "−" : "+"}
              </span>
              <div>
                <strong>{editor.name.trim() || "Название категории"}</strong>
                <small>
                  {editor.kind === "expense" ? "Расход" : "Доход"} ·{" "}
                  {editor.isEssential
                    ? editor.kind === "expense"
                      ? "обязательно"
                      : "регулярно"
                    : editor.kind === "expense"
                      ? "необязательно"
                      : "нерегулярно"}
                </small>
              </div>
            </div>
            <p>
              {editor.kind === "expense"
                ? "Для этой категории можно задать месячный и годовой лимит."
                : "Доход будет учитываться в факте и норме сбережений."}
            </p>
          </aside>
        </div>

        {localError && (
          <p className="banner error" role="alert">
            {localError}
          </p>
        )}

        <div className="category-form-actions">
          <span className="muted">
            {duplicateName ? "Измените название перед сохранением" : "Все поля можно изменить позже"}
          </span>
          <button type="submit" disabled={busy || duplicateName || !editor.name.trim()}>
            {busy
              ? "Сохранение…"
              : editor.id == null
                ? `Добавить ${editor.kind === "expense" ? "расход" : "доход"}`
                : "Сохранить изменения"}
          </button>
        </div>
      </form>

      <div className="kind-toggle category-filter" role="group" aria-label="Фильтр категорий">
        <button
          type="button"
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          Все
        </button>
        <button
          type="button"
          className={filter === "expense" ? "active" : ""}
          onClick={() => setFilter("expense")}
        >
          Расходы
        </button>
        <button
          type="button"
          className={filter === "income" ? "active" : ""}
          onClick={() => setFilter("income")}
        >
          Доходы
        </button>
      </div>

      <ul className="category-list">
        {visible.map((category) => (
          <li
            key={category.id}
            className={pendingDeleteId === category.id ? "pending-delete" : ""}
          >
            <div>
              <strong>{category.name}</strong>
              <span className="muted">
                {category.kind === "expense" ? "Расход" : "Доход"}
                {category.is_essential ? " · обязательно" : " · необязательно"}
              </span>
              {pendingDeleteId === category.id && (
                <span className="delete-warning">
                  История операций сохранится. Категория исчезнет из новых записей и бюджета.
                </span>
              )}
            </div>
            <div className="row-end">
              {pendingDeleteId === category.id ? (
                <>
                  <button
                    type="button"
                    className="ghost compact"
                    disabled={busy}
                    onClick={() => setPendingDeleteId(null)}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="compact danger-solid"
                    disabled={busy}
                    onClick={() => confirmArchive(category)}
                  >
                    {busy ? "Удаление…" : "Подтвердить"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="ghost compact"
                    disabled={busy}
                    onClick={() => startEdit(category)}
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    className="ghost compact danger"
                    disabled={busy}
                    onClick={() => {
                      setLocalError(null);
                      setPendingDeleteId(category.id);
                    }}
                  >
                    Удалить
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
        {visible.length === 0 && (
          <li className="empty">Нет категорий в этом фильтре — добавьте первую выше</li>
        )}
      </ul>
    </section>
  );
}
