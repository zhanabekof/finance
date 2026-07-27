import {
  addTransaction,
  getTelegramBotSettings,
  listAccounts,
  listCategories,
  saveTelegramBotSettings,
  type Category,
  type TelegramBotSettings,
} from "./db";
import { formatMoney, parseMoneyInput } from "./money";
import { telegramHelpText } from "./telegramParse";

type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: {
    id: string;
    data?: string;
    message?: TgMessage;
  };
};

type TgMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
};

type DialogState =
  | { step: "category"; kind: "income" | "expense" }
  | {
      step: "amount";
      kind: "income" | "expense";
      categoryId: number | null;
      categoryName: string;
    };

export type TelegramBotStatus = {
  running: boolean;
  lastError: string | null;
  lastEvent: string | null;
};

type StatusListener = (status: TelegramBotStatus) => void;
type ChangedListener = () => void;

const API = "https://api.telegram.org";

class TelegramBotRunner {
  private abort: AbortController | null = null;
  private offset = 0;
  private sessions = new Map<string, DialogState>();
  private status: TelegramBotStatus = {
    running: false,
    lastError: null,
    lastEvent: null,
  };
  private listeners = new Set<StatusListener>();
  private changedListeners = new Set<ChangedListener>();

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  onChanged(listener: ChangedListener): () => void {
    this.changedListeners.add(listener);
    return () => this.changedListeners.delete(listener);
  }

  getStatus(): TelegramBotStatus {
    return this.status;
  }

  private setStatus(patch: Partial<TelegramBotStatus>) {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }

  private notifyChanged() {
    for (const listener of this.changedListeners) {
      listener();
    }
  }

  async start(): Promise<void> {
    const settings = await getTelegramBotSettings();
    if (!settings.enabled) {
      throw new Error("Бот выключен в настройках");
    }
    if (settings.serviceMode) {
      throw new Error("Включён режим фоновой службы — in-app опрос отключён");
    }
    if (!settings.botToken.trim()) {
      throw new Error("Укажите токен бота");
    }
    if (settings.defaultAccountId == null) {
      throw new Error("Выберите счёт по умолчанию");
    }

    await this.stop();
    this.abort = new AbortController();
    this.setStatus({ running: true, lastError: null, lastEvent: "Подключение…" });

    void this.loop(settings.botToken.trim(), this.abort.signal);
  }

  async stop(): Promise<void> {
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.setStatus({ running: false, lastEvent: this.status.lastEvent });
  }

  private async loop(token: string, signal: AbortSignal): Promise<void> {
    try {
      await this.api(token, "getMe", {}, signal);
      this.setStatus({ lastEvent: "Бот онлайн, жду сообщения", lastError: null });
    } catch (error) {
      this.setStatus({
        running: false,
        lastError: error instanceof Error ? error.message : String(error),
        lastEvent: "Не удалось подключиться",
      });
      return;
    }

    while (!signal.aborted) {
      try {
        const updates = await this.api<TgUpdate[]>(
          token,
          "getUpdates",
          {
            timeout: 25,
            offset: this.offset,
            allowed_updates: ["message", "callback_query"],
          },
          signal,
        );
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handleUpdate(token, update);
        }
      } catch (error) {
        if (signal.aborted) {
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.setStatus({ lastError: message, lastEvent: "Ошибка опроса, повтор…" });
        await sleep(2_000, signal);
      }
    }

    if (!signal.aborted) {
      this.setStatus({ running: false });
    }
  }

  private async handleUpdate(token: string, update: TgUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(token, update.callback_query);
      return;
    }

    const message = update.message;
    const text = message?.text?.trim();
    if (!message || !text) {
      return;
    }

    const chatId = String(message.chat.id);
    let settings = await getTelegramBotSettings();

    if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text) || text === "Меню") {
      if (!settings.allowedChatId) {
        await saveTelegramBotSettings({ ...settings, allowedChatId: chatId });
        settings = await getTelegramBotSettings();
        this.sessions.delete(chatId);
        await this.replyMenu(
          token,
          chatId,
          "Чат привязан к Finance.\nВыберите действие в меню ниже.",
        );
        this.setStatus({ lastEvent: `Привязан чат ${chatId}`, lastError: null });
        return;
      }
      if (settings.allowedChatId !== chatId) {
        await this.reply(token, chatId, "Этот бот уже привязан к другому чату.");
        return;
      }
      this.sessions.delete(chatId);
      await this.replyMenu(token, chatId, "Меню Finance. Выберите расход или доход.");
      return;
    }

    if (settings.allowedChatId && settings.allowedChatId !== chatId) {
      return;
    }
    if (!settings.allowedChatId) {
      await this.reply(
        token,
        chatId,
        "Сначала отправьте /start, чтобы привязать чат к Finance.",
      );
      return;
    }

    if (/^\/help(?:@\w+)?(?:\s|$)/i.test(text) || text === "Помощь") {
      this.sessions.delete(chatId);
      await this.replyMenu(token, chatId, telegramHelpText(settings.serviceMode));
      return;
    }

    if (/^\/status(?:@\w+)?(?:\s|$)/i.test(text) || text === "Статус") {
      await this.replyMenu(
        token,
        chatId,
        `Бот активен.\nЧат: ${settings.allowedChatId}\nСчёт id: ${settings.defaultAccountId ?? "—"}`,
      );
      return;
    }

    if (text === "Отмена" || /^\/cancel(?:@\w+)?(?:\s|$)/i.test(text)) {
      this.sessions.delete(chatId);
      await this.replyMenu(token, chatId, "Отменено. Выберите действие в меню.");
      return;
    }

    if (text === "Расход" || text === "Доход") {
      await this.startKindFlow(token, chatId, text === "Доход" ? "income" : "expense");
      return;
    }

    const state = this.sessions.get(chatId);
    if (state?.step === "category") {
      await this.reply(
        token,
        chatId,
        "Выберите категорию кнопкой под сообщением или нажмите Отмена.",
        this.cancelInline(),
      );
      return;
    }

    if (state?.step === "amount") {
      try {
        const result = await this.saveAmount(
          settings,
          state.kind,
          state.categoryId,
          state.categoryName,
          text,
        );
        this.sessions.delete(chatId);
        await this.replyMenu(token, chatId, result);
        this.setStatus({ lastEvent: `Операция: ${state.kind}`, lastError: null });
        this.notifyChanged();
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        await this.reply(
          token,
          chatId,
          `${messageText}\nВведите сумму числом, например: 500 или 1200,50`,
          this.cancelInline(),
        );
        this.setStatus({ lastError: messageText });
      }
      return;
    }

    await this.replyMenu(
      token,
      chatId,
      "Используйте меню: нажмите «Расход» или «Доход».",
    );
  }

  private async handleCallback(
    token: string,
    callback: NonNullable<TgUpdate["callback_query"]>,
  ): Promise<void> {
    const chatId = callback.message ? String(callback.message.chat.id) : null;
    if (!chatId) {
      return;
    }
    await this.api(token, "answerCallbackQuery", { callback_query_id: callback.id });

    const settings = await getTelegramBotSettings();
    if (!settings.allowedChatId || settings.allowedChatId !== chatId) {
      return;
    }

    const data = callback.data ?? "";
    if (data === "cancel" || data === "menu") {
      this.sessions.delete(chatId);
      await this.replyMenu(token, chatId, "Отменено. Выберите действие в меню.");
      return;
    }

    if (data.startsWith("kind:")) {
      const kind = data === "kind:i" ? "income" : "expense";
      await this.startKindFlow(token, chatId, kind);
      return;
    }

    if (data.startsWith("cat:")) {
      const [, kindCode, idRaw] = data.split(":");
      const kind = kindCode === "i" ? "income" : "expense";
      const categoryId = idRaw === "0" ? null : Number(idRaw);
      if (categoryId != null && !Number.isSafeInteger(categoryId)) {
        await this.reply(token, chatId, "Некорректная категория.");
        return;
      }

      const categories = await listCategories(kind);
      const categoryName =
        categoryId == null
          ? "Без категории"
          : (categories.find((c) => c.id === categoryId)?.name ?? null);

      if (categoryId != null && !categoryName) {
        await this.reply(token, chatId, "Категория не найдена.");
        return;
      }
      if (kind === "expense" && categoryId == null) {
        await this.reply(
          token,
          chatId,
          "Для расхода нужна категория. Выберите из списка.",
          this.categoriesKeyboard(kind, categories),
        );
        return;
      }

      this.sessions.set(chatId, {
        step: "amount",
        kind,
        categoryId,
        categoryName: categoryName ?? "Без категории",
      });
      const kindLabel = kind === "expense" ? "расхода" : "дохода";
      await this.reply(
        token,
        chatId,
        `Категория: ${categoryName}\nВведите сумму ${kindLabel} числом:\nнапример 500 или 1 200,50`,
        this.cancelInline(),
      );
    }
  }

  private async startKindFlow(
    token: string,
    chatId: string,
    kind: "income" | "expense",
  ): Promise<void> {
    const categories = await listCategories(kind);
    if (kind === "expense" && categories.length === 0) {
      await this.replyMenu(
        token,
        chatId,
        "Нет категорий расходов — создайте их в приложении Finance.",
      );
      return;
    }

    this.sessions.set(chatId, { step: "category", kind });
    const title =
      kind === "expense"
        ? "Расход — выберите категорию:"
        : "Доход — выберите категорию (или «Без категории»):";
    await this.reply(token, chatId, title, this.categoriesKeyboard(kind, categories));
  }

  private async saveAmount(
    settings: TelegramBotSettings,
    kind: "income" | "expense",
    categoryId: number | null,
    categoryName: string,
    amountText: string,
  ): Promise<string> {
    if (settings.defaultAccountId == null) {
      throw new Error("Не выбран счёт по умолчанию");
    }
    const accounts = await listAccounts();
    const account = accounts.find((row) => row.id === settings.defaultAccountId);
    if (!account) {
      throw new Error("Счёт по умолчанию не найден");
    }

    const cleaned = amountText.trim().replace(/^[-+−—]\s*/, "");
    await addTransaction({
      accountId: account.id,
      categoryId,
      title: categoryName,
      amountInput: cleaned,
      kind,
      currency: account.currency,
    });

    let minor = parseMoneyInput(cleaned, account.currency);
    minor = kind === "expense" ? -Math.abs(minor) : Math.abs(minor);

    return [
      "Записал:",
      `${kind === "expense" ? "Расход" : "Доход"} ${formatMoney(minor, account.currency)}`,
      `Категория: ${categoryName}`,
      `Счёт: ${account.name}`,
      "",
      "Можно добавить следующую операцию из меню.",
    ].join("\n");
  }

  private mainKeyboard() {
    return {
      keyboard: [
        [{ text: "Расход" }, { text: "Доход" }],
        [{ text: "Статус" }, { text: "Помощь" }],
        [{ text: "Меню" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }

  private categoriesKeyboard(kind: "income" | "expense", categories: Category[]) {
    const kindCode = kind === "income" ? "i" : "e";
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    let row: Array<{ text: string; callback_data: string }> = [];
    for (const category of categories) {
      row.push({
        text: category.name,
        callback_data: `cat:${kindCode}:${category.id}`,
      });
      if (row.length === 2) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) {
      rows.push(row);
    }
    if (kind === "income") {
      rows.push([{ text: "Без категории", callback_data: `cat:${kindCode}:0` }]);
    }
    rows.push([{ text: "Отмена", callback_data: "cancel" }]);
    return { inline_keyboard: rows };
  }

  private cancelInline() {
    return {
      inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]],
    };
  }

  private async replyMenu(token: string, chatId: string, text: string): Promise<void> {
    await this.reply(token, chatId, text, this.mainKeyboard());
  }

  private async reply(
    token: string,
    chatId: string,
    text: string,
    replyMarkup?: unknown,
  ): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }
    await this.api(token, "sendMessage", body);
  }

  private async api<T = unknown>(
    token: string,
    method: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const payload = (await response.json()) as {
      ok: boolean;
      description?: string;
      result?: T;
    };
    if (!payload.ok) {
      throw new Error(payload.description || `Telegram API error (${response.status})`);
    }
    return payload.result as T;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => resolve(), ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export const telegramBot = new TelegramBotRunner();
