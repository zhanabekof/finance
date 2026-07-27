import { invoke } from "@tauri-apps/api/core";
import { FormEvent, useEffect, useState } from "react";
import {
  getTelegramBotSettings,
  listAccounts,
  saveTelegramBotSettings,
  type Account,
  type TelegramBotSettings,
} from "../lib/db";
import { telegramBot, type TelegramBotStatus } from "../lib/telegramBot";
import { telegramHelpText } from "../lib/telegramParse";

type Props = {
  onChanged: () => Promise<void> | void;
};

type DaemonStatus = {
  installed: boolean;
  running: boolean;
  platformSupported: boolean;
  binaryPath: string | null;
  detail: string;
};

export function TelegramPanel({ onChanged }: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<TelegramBotSettings>({
    enabled: false,
    serviceMode: false,
    botToken: "",
    allowedChatId: null,
    defaultAccountId: null,
  });
  const [status, setStatus] = useState<TelegramBotStatus>(telegramBot.getStatus());
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  async function reloadDaemon() {
    try {
      const next = await invoke<DaemonStatus>("telegram_daemon_status");
      setDaemon(next);
    } catch (err: unknown) {
      setDaemon({
        installed: false,
        running: false,
        platformSupported: false,
        binaryPath: null,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function reload() {
    const [nextSettings, nextAccounts] = await Promise.all([
      getTelegramBotSettings(),
      listAccounts(),
    ]);
    setSettings({
      ...nextSettings,
      defaultAccountId:
        nextSettings.defaultAccountId ?? nextAccounts[0]?.id ?? null,
    });
    setAccounts(nextAccounts);
    await reloadDaemon();
  }

  useEffect(() => {
    void reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
    return telegramBot.subscribe(setStatus);
  }, []);

  useEffect(() => {
    return telegramBot.onChanged(() => {
      void onChanged();
    });
  }, [onChanged]);

  async function applyBotRuntime(next: TelegramBotSettings) {
    if (!next.enabled) {
      await telegramBot.stop();
      return;
    }
    if (next.serviceMode) {
      await telegramBot.stop();
      return;
    }
    await telegramBot.start();
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (settings.enabled && !settings.botToken.trim()) {
        throw new Error("Укажите токен бота от @BotFather");
      }
      if (settings.enabled && settings.defaultAccountId == null) {
        throw new Error("Выберите счёт для операций из Telegram");
      }
      if (settings.enabled && settings.serviceMode) {
        const current = await invoke<DaemonStatus>("telegram_daemon_status");
        if (!current.installed || !current.running) {
          throw new Error(
            "Сначала установите фоновую службу кнопкой ниже, либо выключите режим службы",
          );
        }
      }
      await saveTelegramBotSettings(settings);
      await applyBotRuntime(settings);
      setNotice(
        settings.enabled
          ? settings.serviceMode
            ? "Настройки сохранены — бот работает через службу"
            : "Настройки сохранены, бот запущен в приложении"
          : "Бот остановлен",
      );
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      try {
        await telegramBot.stop();
      } catch {
        // ignore
      }
    } finally {
      setBusy(false);
    }
  }

  async function onClearChat() {
    setBusy(true);
    setError(null);
    try {
      const next = { ...settings, allowedChatId: null };
      await saveTelegramBotSettings(next);
      setSettings(next);
      setNotice("Привязка чата сброшена. Отправьте /start боту заново.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onInstallService() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (!settings.botToken.trim() || settings.defaultAccountId == null) {
        throw new Error("Сначала укажите токен и счёт, сохраните настройки");
      }
      await telegramBot.stop();
      const next = { ...settings, enabled: true, serviceMode: true };
      await saveTelegramBotSettings(next);
      setSettings(next);
      const status = await invoke<DaemonStatus>("install_telegram_daemon");
      setDaemon(status);
      setNotice(
        status.running
          ? "Служба установлена и запущена. Можно закрыть Finance."
          : status.detail,
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onUninstallService() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const status = await invoke<DaemonStatus>("uninstall_telegram_daemon");
      setDaemon(status);
      const next = { ...settings, serviceMode: false };
      await saveTelegramBotSettings(next);
      setSettings(next);
      if (next.enabled) {
        await telegramBot.start();
        setNotice("Служба удалена. Бот снова работает только пока открыто приложение.");
      } else {
        setNotice("Служба удалена");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const inAppRunning = status.running && !settings.serviceMode;

  return (
    <section className="data-panel telegram-panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Быстрый ввод</p>
          <h2>Telegram</h2>
          <p className="muted">
            Запись через кнопки меню в Telegram: тип → категория → сумма. С
            фоновой службой бот работает даже когда Finance закрыт.
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
        <h3>Статус</h3>
        <p className="muted">
          {settings.serviceMode
            ? daemon?.running
              ? "Служба работает (без приложения)"
              : daemon?.installed
                ? "Служба установлена, но не запущена"
                : "Режим службы, но служба не установлена"
            : inAppRunning
              ? "Бот работает в приложении"
              : "Бот остановлен"}
          {status.lastEvent && !settings.serviceMode ? ` · ${status.lastEvent}` : ""}
        </p>
        {daemon ? <p className="muted">{daemon.detail}</p> : null}
        {status.lastError && !settings.serviceMode ? (
          <p className="banner error" role="alert">
            {status.lastError}
          </p>
        ) : null}
      </div>

      <form className="data-card" onSubmit={onSave}>
        <h3>Настройки</h3>
        <label className="data-confirm">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) =>
              setSettings((prev) => ({ ...prev, enabled: event.target.checked }))
            }
          />
          <span>Включить бота</span>
        </label>

        <label>
          <span>Токен бота</span>
          <div className="telegram-token-row">
            <input
              type={showToken ? "text" : "password"}
              value={settings.botToken}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  botToken: event.target.value,
                }))
              }
              placeholder="123456:ABC…"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="ghost"
              onClick={() => setShowToken((value) => !value)}
            >
              {showToken ? "Скрыть" : "Показать"}
            </button>
          </div>
        </label>

        <label>
          <span>Счёт по умолчанию</span>
          <select
            value={settings.defaultAccountId ?? ""}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                defaultAccountId:
                  event.target.value === ""
                    ? null
                    : Number(event.target.value),
              }))
            }
            required={settings.enabled}
          >
            <option value="">Выберите счёт</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.currency}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Привязанный чат</span>
          <input
            value={settings.allowedChatId ?? ""}
            readOnly
            placeholder="Отправьте боту /start"
          />
        </label>
        {settings.allowedChatId ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void onClearChat()}
          >
            Сбросить чат
          </button>
        ) : null}

        <button type="submit" disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить и применить"}
        </button>
      </form>

      <div className="data-card">
        <h3>Фоновая служба</h3>
        <p className="muted">
          Установите службу, чтобы Telegram писал операции без открытого Finance.
          На macOS это LaunchAgent, на Linux — systemd user unit.
        </p>
        {!daemon?.platformSupported ? (
          <p className="banner error" role="alert">
            {daemon?.detail ?? "Платформа не поддерживается"}
          </p>
        ) : (
          <div className="telegram-service-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onInstallService()}
            >
              {daemon?.installed ? "Переустановить службу" : "Установить службу"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy || !daemon?.installed}
              onClick={() => void onUninstallService()}
            >
              Удалить службу
            </button>
          </div>
        )}
      </div>

      <div className="data-card">
        <h3>Как подключить</h3>
        <ol className="telegram-steps">
          <li>
            В Telegram откройте <strong>@BotFather</strong> → /newbot и скопируйте
            токен.
          </li>
          <li>Вставьте токен сюда, выберите счёт и сохраните.</li>
          <li>
            Нажмите <strong>Установить службу</strong> — бот заработает в фоне.
          </li>
          <li>
            Напишите боту <strong>/start</strong> — появятся кнопки меню.
          </li>
          <li>
            Нажмите <strong>Расход</strong> или <strong>Доход</strong>, выберите
            категорию и введите сумму.
          </li>
        </ol>
        <pre className="telegram-help">{telegramHelpText(true)}</pre>
        <p className="muted">
          Токен хранится локально в SQLite на этом устройстве. Не включайте бота на
          чужом компьютере.
        </p>
      </div>
    </section>
  );
}
