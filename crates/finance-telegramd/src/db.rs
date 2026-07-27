use rusqlite::{params, Connection, OptionalExtension};

use crate::parse::{Kind, TelegramCategory};
use crate::paths;

pub struct Settings {
    pub enabled: bool,
    pub bot_token: String,
    pub allowed_chat_id: Option<String>,
    pub default_account_id: Option<i64>,
}

pub struct Account {
    pub id: i64,
    pub name: String,
    pub currency: String,
}

pub fn open_db() -> Result<Connection, String> {
    let path = paths::default_db_path()?;
    if !path.exists() {
        return Err(format!(
            "База не найдена: {}. Сначала откройте приложение Finance.",
            path.display()
        ));
    }
    let conn = Connection::open(&path).map_err(|e| format!("SQLite: {e}"))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| format!("SQLite pragma: {e}"))?;
    Ok(conn)
}

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("SQLite: {e}"))
}

pub fn load_settings(conn: &Connection) -> Result<Settings, String> {
    let enabled = get_setting(conn, "telegram.enabled")?.as_deref() == Some("1");
    let bot_token = get_setting(conn, "telegram.bot_token")?.unwrap_or_default();
    let allowed_chat_id = get_setting(conn, "telegram.allowed_chat_id")?
        .filter(|v| !v.trim().is_empty());
    let default_account_id = get_setting(conn, "telegram.default_account_id")?
        .and_then(|v| v.parse::<i64>().ok());
    Ok(Settings {
        enabled,
        bot_token,
        allowed_chat_id,
        default_account_id,
    })
}

pub fn set_allowed_chat_id(conn: &Connection, chat_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params!["telegram.allowed_chat_id", chat_id],
    )
    .map_err(|e| format!("SQLite: {e}"))?;
    Ok(())
}

pub fn get_account(conn: &Connection, id: i64) -> Result<Option<Account>, String> {
    conn.query_row(
        "SELECT id, name, currency FROM accounts WHERE id = ?1 AND archived = 0",
        params![id],
        |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                currency: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("SQLite: {e}"))
}

pub fn list_categories(conn: &Connection, kind: Kind) -> Result<Vec<TelegramCategory>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, kind FROM categories
             WHERE archived = 0 AND kind = ?1
             ORDER BY name ASC",
        )
        .map_err(|e| format!("SQLite: {e}"))?;
    let rows = stmt
        .query_map(params![kind.as_str()], |row| {
            let kind_raw: String = row.get(2)?;
            let kind = if kind_raw == "income" {
                Kind::Income
            } else {
                Kind::Expense
            };
            Ok(TelegramCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                kind,
            })
        })
        .map_err(|e| format!("SQLite: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("SQLite: {e}"))?);
    }
    Ok(out)
}

pub fn insert_transaction(
    conn: &Connection,
    account_id: i64,
    category_id: Option<i64>,
    title: &str,
    amount_minor: i64,
    currency: &str,
) -> Result<(), String> {
    let now = utc_now_iso();
    conn.execute(
        "INSERT INTO transactions (
            account_id, category_id, title, amount_minor, currency,
            occurred_at, transfer_group_id, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)",
        params![
            account_id,
            category_id,
            title,
            amount_minor,
            currency,
            now,
            now
        ],
    )
    .map_err(|e| format!("SQLite: {e}"))?;
    Ok(())
}

fn utc_now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Prefer SQLite's UTC stamp for consistency with the app migrations.
    // Fallback format if needed — we use SQLite via a tiny helper query when possible.
    let _ = secs;
    // Fixed layout compatible with app ISO timestamps.
    chrono_lite_now()
}

fn chrono_lite_now() -> String {
    // Use SQLite datetime when connection is available; here produce RFC3339-ish UTC
    // without extra deps via `strftime` style from a one-shot connection isn't ideal.
    // Format from libc local isn't UTC — open ephemeral? Better: use ureq-free approach.
    // We'll use a simple UTC formatter via `time` crate... avoid deps: call date command? No.
    // Use `humantime`? Keep it simple with SystemTime + manual UTC calc.
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs() as i64;
    let millis = duration.subsec_millis();
    let (y, mo, d, h, mi, s) = civil_from_days(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z")
}

/// Convert Unix seconds to UTC civil date/time (Howard Hinnant algorithm).
fn civil_from_days(unix_secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = unix_secs.div_euclid(86_400);
    let tod = unix_secs.rem_euclid(86_400) as u32;
    let h = tod / 3600;
    let mi = (tod % 3600) / 60;
    let s = tod % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d, h, mi, s)
}
