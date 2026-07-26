import { FormEvent, useEffect, useState } from "react";
import {
  addAccount,
  archiveAccount,
  getAccountBalances,
  updateAccount,
  type Account,
} from "../lib/db";
import { formatMoney } from "../lib/money";

type Props = {
  accounts: Account[];
  onChanged: () => Promise<void> | void;
};

const CURRENCY_OPTIONS = ["KZT", "USD", "EUR", "RUB"] as const;

export function AccountsPanel({ accounts, onChanged }: Props) {
  const [balances, setBalances] = useState<
    { accountId: number; name: string; currency: string; balanceMinor: number }[]
  >([]);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<string>("KZT");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reloadBalances() {
    setBalances(await getAccountBalances());
  }

  useEffect(() => {
    void reloadBalances().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [accounts]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await addAccount({ name, currency });
      setName("");
      setNotice("Счёт создан");
      await onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit(event: FormEvent) {
    event.preventDefault();
    if (editingId == null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await updateAccount({ id: editingId, name: editName });
      setEditingId(null);
      setNotice("Счёт обновлён");
      await onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onArchive(id: number) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await archiveAccount(id);
      setNotice("Счёт архивирован. История операций сохранена.");
      await onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="accounts-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Кошелёк</p>
          <h2>Счета</h2>
          <p className="muted">
            Архивация скрывает счёт из списков, но не удаляет операции.
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

      <div className="accounts-workspace">
        <form className="account-form" onSubmit={onCreate}>
          <h3>Новый счёт</h3>
          <label>
            <span>Название</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, Kaspi"
              required
            />
          </label>
          <label>
            <span>Валюта</span>
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {CURRENCY_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Сохраняю…" : "Создать счёт"}
          </button>
        </form>

        <ul className="account-list">
          {accounts.length === 0 ? (
            <li className="empty muted">Нет активных счетов</li>
          ) : (
            accounts.map((account) => {
              const balance = balances.find((row) => row.accountId === account.id);
              const isEditing = editingId === account.id;
              return (
                <li key={account.id}>
                  {isEditing ? (
                    <form className="account-edit" onSubmit={onSaveEdit}>
                      <input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        required
                        autoFocus
                      />
                      <div className="account-edit-actions">
                        <button type="submit" disabled={busy}>
                          Сохранить
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setEditingId(null)}
                        >
                          Отмена
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div>
                        <strong>{account.name}</strong>
                        <span className="muted"> {account.currency}</span>
                        <p className="mono">
                          {balance
                            ? formatMoney(balance.balanceMinor, balance.currency)
                            : "…"}
                        </p>
                      </div>
                      <div className="account-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setEditingId(account.id);
                            setEditName(account.name);
                          }}
                        >
                          Переименовать
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          disabled={busy || accounts.length <= 1}
                          onClick={() => void onArchive(account.id)}
                        >
                          В архив
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </section>
  );
}
