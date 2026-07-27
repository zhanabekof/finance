use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::db::{self, Settings};
use crate::money::{format_money, parse_money_input};
use crate::parse::{telegram_help_text, Kind, TelegramCategory};
use crate::session::{DialogState, Sessions};

const API: &str = "https://api.telegram.org";

fn sessions() -> &'static Sessions {
    static SESSIONS: OnceLock<Sessions> = OnceLock::new();
    SESSIONS.get_or_init(Sessions::new)
}

#[derive(Debug, Deserialize)]
struct TgResponse<T> {
    ok: bool,
    description: Option<String>,
    result: Option<T>,
}

#[derive(Debug, Deserialize)]
struct TgUpdate {
    update_id: i64,
    message: Option<TgMessage>,
    callback_query: Option<TgCallbackQuery>,
}

#[derive(Debug, Deserialize)]
struct TgMessage {
    text: Option<String>,
    chat: TgChat,
}

#[derive(Debug, Deserialize)]
struct TgChat {
    id: i64,
}

#[derive(Debug, Deserialize)]
struct TgCallbackQuery {
    id: String,
    data: Option<String>,
    message: Option<TgMessage>,
}

pub fn run_forever() -> Result<(), String> {
    let mut offset: i64 = 0;
    eprintln!("finance-telegramd: старт");

    loop {
        let conn = match db::open_db() {
            Ok(c) => c,
            Err(err) => {
                eprintln!("finance-telegramd: {err}");
                sleep_secs(5);
                continue;
            }
        };
        let settings = match db::load_settings(&conn) {
            Ok(s) => s,
            Err(err) => {
                eprintln!("finance-telegramd: настройки: {err}");
                sleep_secs(5);
                continue;
            }
        };

        if !settings.enabled {
            eprintln!("finance-telegramd: бот выключен в настройках, жду…");
            sleep_secs(10);
            continue;
        }
        if settings.bot_token.trim().is_empty() {
            eprintln!("finance-telegramd: нет токена, жду…");
            sleep_secs(10);
            continue;
        }
        if settings.default_account_id.is_none() {
            eprintln!("finance-telegramd: не выбран счёт, жду…");
            sleep_secs(10);
            continue;
        }

        let token = settings.bot_token.trim().to_string();
        match api::<serde_json::Value>(&token, "getMe", &json!({})) {
            Ok(_) => eprintln!("finance-telegramd: бот онлайн"),
            Err(err) => {
                eprintln!("finance-telegramd: getMe: {err}");
                sleep_secs(5);
                continue;
            }
        }

        loop {
            let updates = match api::<Vec<TgUpdate>>(
                &token,
                "getUpdates",
                &json!({
                    "timeout": 25,
                    "offset": offset,
                    "allowed_updates": ["message", "callback_query"],
                }),
            ) {
                Ok(u) => u,
                Err(err) => {
                    eprintln!("finance-telegramd: getUpdates: {err}");
                    sleep_secs(2);
                    break;
                }
            };

            let conn = match db::open_db() {
                Ok(c) => c,
                Err(err) => {
                    eprintln!("finance-telegramd: {err}");
                    sleep_secs(2);
                    break;
                }
            };
            let settings = match db::load_settings(&conn) {
                Ok(s) => s,
                Err(err) => {
                    eprintln!("finance-telegramd: {err}");
                    sleep_secs(2);
                    break;
                }
            };
            if !settings.enabled || settings.bot_token.trim() != token {
                eprintln!("finance-telegramd: настройки изменились, переподключение");
                break;
            }

            for update in updates {
                offset = update.update_id + 1;
                if let Err(err) = handle_update(&conn, &token, update) {
                    eprintln!("finance-telegramd: update: {err}");
                }
            }
        }
    }
}

fn handle_update(
    conn: &rusqlite::Connection,
    token: &str,
    update: TgUpdate,
) -> Result<(), String> {
    if let Some(callback) = update.callback_query {
        return handle_callback(conn, token, callback);
    }

    let Some(message) = update.message else {
        return Ok(());
    };
    let Some(text) = message.text.as_deref().map(str::trim).filter(|t| !t.is_empty()) else {
        return Ok(());
    };
    let chat_id = message.chat.id.to_string();
    let mut settings = db::load_settings(conn)?;

    if is_command(text, "start") || text == "Меню" {
        if settings.allowed_chat_id.is_none() {
            db::set_allowed_chat_id(conn, &chat_id)?;
            settings.allowed_chat_id = Some(chat_id.clone());
            sessions().clear(&chat_id);
            reply_menu(
                token,
                &chat_id,
                "Чат привязан к Finance.\nВыберите действие в меню ниже.",
            )?;
            return Ok(());
        }
        if settings.allowed_chat_id.as_deref() != Some(chat_id.as_str()) {
            reply(token, &chat_id, "Этот бот уже привязан к другому чату.", None)?;
            return Ok(());
        }
        sessions().clear(&chat_id);
        reply_menu(
            token,
            &chat_id,
            "Меню Finance. Выберите расход или доход.",
        )?;
        return Ok(());
    }

    if let Some(allowed) = &settings.allowed_chat_id {
        if allowed != &chat_id {
            return Ok(());
        }
    } else {
        reply(
            token,
            &chat_id,
            "Сначала отправьте /start, чтобы привязать чат к Finance.",
            None,
        )?;
        return Ok(());
    }

    if is_command(text, "help") || text == "Помощь" {
        sessions().clear(&chat_id);
        reply_menu(token, &chat_id, &telegram_help_text())?;
        return Ok(());
    }

    if is_command(text, "status") || text == "Статус" {
        reply_menu(
            token,
            &chat_id,
            &format!(
                "Бот активен (фоновая служба).\nЧат: {}\nСчёт id: {}",
                settings.allowed_chat_id.as_deref().unwrap_or("—"),
                settings
                    .default_account_id
                    .map(|id| id.to_string())
                    .unwrap_or_else(|| "—".into())
            ),
        )?;
        return Ok(());
    }

    if text == "Отмена" || is_command(text, "cancel") {
        sessions().clear(&chat_id);
        reply_menu(token, &chat_id, "Отменено. Выберите действие в меню.")?;
        return Ok(());
    }

    if text == "Расход" || text == "Доход" {
        let kind = if text == "Доход" {
            Kind::Income
        } else {
            Kind::Expense
        };
        return start_kind_flow(conn, token, &chat_id, kind);
    }

    if let Some(state) = sessions().get(&chat_id) {
        match state {
            DialogState::AwaitingCategory { .. } => {
                reply(
                    token,
                    &chat_id,
                    "Выберите категорию кнопкой под сообщением или нажмите Отмена.",
                    Some(cancel_inline()),
                )?;
                return Ok(());
            }
            DialogState::AwaitingAmount {
                kind,
                category_id,
                category_name,
            } => {
                match save_amount(conn, &settings, kind, category_id, &category_name, text) {
                    Ok(result) => {
                        sessions().clear(&chat_id);
                        reply_menu(token, &chat_id, &result)?;
                    }
                    Err(err) => {
                        reply(
                            token,
                            &chat_id,
                            &format!("{err}\nВведите сумму числом, например: 500 или 1200,50"),
                            Some(cancel_inline()),
                        )?;
                    }
                }
                return Ok(());
            }
        }
    }

    reply_menu(
        token,
        &chat_id,
        "Используйте меню: нажмите «Расход» или «Доход».",
    )?;
    Ok(())
}

fn handle_callback(
    conn: &rusqlite::Connection,
    token: &str,
    callback: TgCallbackQuery,
) -> Result<(), String> {
    let chat_id = callback
        .message
        .as_ref()
        .map(|m| m.chat.id.to_string())
        .ok_or_else(|| "callback без chat".to_string())?;
    let data = callback.data.as_deref().unwrap_or("");

    answer_callback(token, &callback.id)?;

    let settings = db::load_settings(conn)?;
    if let Some(allowed) = &settings.allowed_chat_id {
        if allowed != &chat_id {
            return Ok(());
        }
    } else {
        return Ok(());
    }

    if data == "cancel" || data == "menu" {
        sessions().clear(&chat_id);
        reply_menu(token, &chat_id, "Отменено. Выберите действие в меню.")?;
        return Ok(());
    }

    if let Some(kind_code) = data.strip_prefix("kind:") {
        let kind = if kind_code == "i" {
            Kind::Income
        } else {
            Kind::Expense
        };
        return start_kind_flow(conn, token, &chat_id, kind);
    }

    if let Some(rest) = data.strip_prefix("cat:") {
        // cat:e:12 or cat:i:0
        let mut parts = rest.split(':');
        let kind_code = parts.next().unwrap_or("e");
        let id_raw = parts.next().unwrap_or("0");
        let kind = if kind_code == "i" {
            Kind::Income
        } else {
            Kind::Expense
        };
        let category_id = if id_raw == "0" {
            None
        } else {
            Some(
                id_raw
                    .parse::<i64>()
                    .map_err(|_| "Некорректная категория".to_string())?,
            )
        };

        let categories = db::list_categories(conn, kind)?;
        let category_name = match category_id {
            None => "Без категории".to_string(),
            Some(id) => categories
                .iter()
                .find(|c| c.id == id)
                .map(|c| c.name.clone())
                .ok_or_else(|| "Категория не найдена".to_string())?,
        };

        if kind == Kind::Expense && category_id.is_none() {
            reply(
                token,
                &chat_id,
                "Для расхода нужна категория. Выберите из списка.",
                Some(categories_keyboard(kind, &categories)),
            )?;
            return Ok(());
        }

        sessions().set(
            &chat_id,
            DialogState::AwaitingAmount {
                kind,
                category_id,
                category_name: category_name.clone(),
            },
        );
        let kind_label = if kind == Kind::Expense {
            "расхода"
        } else {
            "дохода"
        };
        reply(
            token,
            &chat_id,
            &format!(
                "Категория: {category_name}\nВведите сумму {kind_label} числом:\nнапример 500 или 1 200,50"
            ),
            Some(cancel_inline()),
        )?;
        return Ok(());
    }

    Ok(())
}

fn start_kind_flow(
    conn: &rusqlite::Connection,
    token: &str,
    chat_id: &str,
    kind: Kind,
) -> Result<(), String> {
    let categories = db::list_categories(conn, kind)?;
    if kind == Kind::Expense && categories.is_empty() {
        reply_menu(
            token,
            chat_id,
            "Нет категорий расходов — создайте их в приложении Finance.",
        )?;
        return Ok(());
    }

    sessions().set(chat_id, DialogState::AwaitingCategory { kind });
    let title = if kind == Kind::Expense {
        "Расход — выберите категорию:"
    } else {
        "Доход — выберите категорию (или «Без категории»):"
    };
    reply(
        token,
        chat_id,
        title,
        Some(categories_keyboard(kind, &categories)),
    )?;
    Ok(())
}

fn save_amount(
    conn: &rusqlite::Connection,
    settings: &Settings,
    kind: Kind,
    category_id: Option<i64>,
    category_name: &str,
    amount_text: &str,
) -> Result<String, String> {
    let account_id = settings
        .default_account_id
        .ok_or_else(|| "Не выбран счёт по умолчанию".to_string())?;
    let account = db::get_account(conn, account_id)?
        .ok_or_else(|| "Счёт по умолчанию не найден".to_string())?;

    let cleaned = amount_text
        .trim()
        .trim_start_matches(['+', '-', '−', '—'])
        .trim();
    let mut minor = parse_money_input(cleaned, &account.currency)?;
    minor = match kind {
        Kind::Expense => -minor.abs(),
        Kind::Income => minor.abs(),
    };

    let title = category_name.to_string();
    db::insert_transaction(
        conn,
        account.id,
        category_id,
        &title,
        minor,
        &account.currency,
    )?;

    Ok([
        "Записал:",
        &format!(
            "{} {}",
            if kind == Kind::Expense {
                "Расход"
            } else {
                "Доход"
            },
            format_money(minor, &account.currency)
        ),
        &format!("Категория: {category_name}"),
        &format!("Счёт: {}", account.name),
        "",
        "Можно добавить следующую операцию из меню.",
    ]
    .join("\n"))
}

fn main_keyboard() -> Value {
    json!({
        "keyboard": [
            [{"text": "Расход"}, {"text": "Доход"}],
            [{"text": "Статус"}, {"text": "Помощь"}],
            [{"text": "Меню"}]
        ],
        "resize_keyboard": true,
        "is_persistent": true
    })
}

fn categories_keyboard(kind: Kind, categories: &[TelegramCategory]) -> Value {
    let kind_code = if kind == Kind::Income { "i" } else { "e" };
    let mut rows: Vec<Vec<Value>> = Vec::new();
    let mut row: Vec<Value> = Vec::new();

    for category in categories {
        row.push(json!({
            "text": category.name,
            "callback_data": format!("cat:{kind_code}:{}", category.id)
        }));
        if row.len() == 2 {
            rows.push(std::mem::take(&mut row));
        }
    }
    if !row.is_empty() {
        rows.push(row);
    }

    if kind == Kind::Income {
        rows.push(vec![json!({
            "text": "Без категории",
            "callback_data": format!("cat:{kind_code}:0")
        })]);
    }

    rows.push(vec![json!({
        "text": "Отмена",
        "callback_data": "cancel"
    })]);

    json!({ "inline_keyboard": rows })
}

fn cancel_inline() -> Value {
    json!({
        "inline_keyboard": [[{"text": "Отмена", "callback_data": "cancel"}]]
    })
}

fn is_command(text: &str, name: &str) -> bool {
    let lower = text.to_lowercase();
    let bare = format!("/{name}");
    let with_at = format!("/{name}@");
    lower == bare
        || lower.starts_with(&format!("{bare} "))
        || lower.starts_with(&with_at)
}

fn reply_menu(token: &str, chat_id: &str, text: &str) -> Result<(), String> {
    reply(token, chat_id, text, Some(main_keyboard()))
}

fn reply(
    token: &str,
    chat_id: &str,
    text: &str,
    reply_markup: Option<Value>,
) -> Result<(), String> {
    let mut body = json!({ "chat_id": chat_id, "text": text });
    if let Some(markup) = reply_markup {
        body["reply_markup"] = markup;
    }
    api::<serde_json::Value>(token, "sendMessage", &body)?;
    Ok(())
}

fn answer_callback(token: &str, callback_id: &str) -> Result<(), String> {
    api::<serde_json::Value>(
        token,
        "answerCallbackQuery",
        &json!({ "callback_query_id": callback_id }),
    )?;
    Ok(())
}

fn api<T: serde::de::DeserializeOwned>(
    token: &str,
    method: &str,
    body: &serde_json::Value,
) -> Result<T, String> {
    let url = format!("{API}/bot{token}/{method}");
    let response = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(body.clone())
        .map_err(|e| format!("HTTP: {e}"))?;
    let payload: TgResponse<T> = response
        .into_json()
        .map_err(|e| format!("JSON: {e}"))?;
    if !payload.ok {
        return Err(payload
            .description
            .unwrap_or_else(|| "Telegram API error".into()));
    }
    payload
        .result
        .ok_or_else(|| "Telegram API: пустой result".into())
}

fn sleep_secs(secs: u64) {
    std::thread::sleep(std::time::Duration::from_secs(secs));
}
