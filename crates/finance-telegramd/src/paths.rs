use std::path::PathBuf;

/// App identifier must match `tauri.conf.json` → `identifier`.
pub const APP_IDENTIFIER: &str = "com.almatzhanabekov.finance";

pub fn default_db_path() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "Не найден каталог данных пользователя".to_string())?;
    Ok(base.join(APP_IDENTIFIER).join("finance.db"))
}
