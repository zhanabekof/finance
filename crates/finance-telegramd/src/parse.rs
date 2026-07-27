#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Income,
    Expense,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Income => "income",
            Kind::Expense => "expense",
        }
    }
}

#[derive(Debug, Clone)]
pub struct TelegramCategory {
    pub id: i64,
    pub name: String,
    #[allow(dead_code)]
    pub kind: Kind,
}

pub fn telegram_help_text() -> String {
    [
        "Finance — запись операций через меню.",
        "",
        "1. Нажмите «Расход» или «Доход»",
        "2. Выберите категорию",
        "3. Введите сумму числом (500 или 1200,50)",
        "",
        "Команды:",
        "/start или Меню — показать кнопки",
        "/help или Помощь — эта справка",
        "/status или Статус — статус бота",
        "",
        "Бот работает в фоне через службу Finance.",
    ]
    .join("\n")
}
