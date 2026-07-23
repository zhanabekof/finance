use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_transactions",
            sql: "CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                amount REAL NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "personal_finance_schema",
            sql: "
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    currency TEXT NOT NULL CHECK (length(currency) = 3),
                    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS categories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
                    is_essential INTEGER NOT NULL DEFAULT 0 CHECK (is_essential IN (0, 1)),
                    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
                );

                CREATE TABLE IF NOT EXISTS transactions_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    account_id INTEGER NOT NULL REFERENCES accounts(id),
                    category_id INTEGER REFERENCES categories(id),
                    title TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL,
                    currency TEXT NOT NULL CHECK (length(currency) = 3),
                    occurred_at TEXT NOT NULL,
                    transfer_group_id TEXT,
                    created_at TEXT NOT NULL
                );

                INSERT INTO accounts (name, currency, created_at)
                SELECT 'Основной', 'KZT', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                WHERE NOT EXISTS (SELECT 1 FROM accounts LIMIT 1);

                INSERT INTO categories (name, kind, is_essential, archived)
                SELECT * FROM (
                    SELECT 'Зарплата' AS name, 'income' AS kind, 0 AS is_essential, 0 AS archived
                    UNION ALL SELECT 'Прочее', 'income', 0, 0
                    UNION ALL SELECT 'Жильё', 'expense', 1, 0
                    UNION ALL SELECT 'Продукты', 'expense', 1, 0
                    UNION ALL SELECT 'Транспорт', 'expense', 1, 0
                    UNION ALL SELECT 'Коммунальные', 'expense', 1, 0
                    UNION ALL SELECT 'Здоровье', 'expense', 1, 0
                    UNION ALL SELECT 'Кафе', 'expense', 0, 0
                    UNION ALL SELECT 'Развлечения', 'expense', 0, 0
                    UNION ALL SELECT 'Покупки', 'expense', 0, 0
                ) AS seed
                WHERE NOT EXISTS (SELECT 1 FROM categories LIMIT 1);

                INSERT INTO transactions_v2 (
                    account_id, category_id, title, amount_minor, currency, occurred_at, transfer_group_id, created_at
                )
                SELECT
                    (SELECT id FROM accounts ORDER BY id LIMIT 1),
                    NULL,
                    t.title,
                    CAST(ROUND(t.amount * 100.0) AS INTEGER),
                    (SELECT currency FROM accounts ORDER BY id LIMIT 1),
                    CASE
                        WHEN t.created_at LIKE '%T%Z' THEN t.created_at
                        WHEN length(t.created_at) = 19 THEN replace(t.created_at, ' ', 'T') || '.000Z'
                        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                    END,
                    NULL,
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                FROM transactions AS t
                WHERE EXISTS (
                    SELECT 1 FROM pragma_table_info('transactions') WHERE name = 'amount'
                );

                DROP TABLE IF EXISTS transactions;
                ALTER TABLE transactions_v2 RENAME TO transactions;

                CREATE TABLE IF NOT EXISTS budgets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    year_month TEXT NOT NULL UNIQUE,
                    currency TEXT NOT NULL CHECK (length(currency) = 3),
                    planned_income_minor INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS budget_limits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    budget_id INTEGER NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
                    category_id INTEGER NOT NULL REFERENCES categories(id),
                    limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0),
                    UNIQUE (budget_id, category_id)
                );

                CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions(occurred_at);
                CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
                CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
                CREATE INDEX IF NOT EXISTS idx_budget_limits_budget_id ON budget_limits(budget_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "year_budgets",
            sql: "
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS year_budgets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    year TEXT NOT NULL UNIQUE,
                    currency TEXT NOT NULL CHECK (length(currency) = 3),
                    planned_income_minor INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS year_budget_limits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    year_budget_id INTEGER NOT NULL REFERENCES year_budgets(id) ON DELETE CASCADE,
                    category_id INTEGER NOT NULL REFERENCES categories(id),
                    limit_minor INTEGER NOT NULL CHECK (limit_minor >= 0),
                    UNIQUE (year_budget_id, category_id)
                );

                CREATE INDEX IF NOT EXISTS idx_year_budget_limits_year_budget_id
                    ON year_budget_limits(year_budget_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "savings_goals",
            sql: "
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS goals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    currency TEXT NOT NULL CHECK (length(currency) = 3),
                    target_minor INTEGER NOT NULL CHECK (target_minor > 0),
                    deadline_date TEXT,
                    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS goal_contributions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    goal_id INTEGER NOT NULL REFERENCES goals(id),
                    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
                    note TEXT,
                    contributed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_goals_archived ON goals(archived);
                CREATE INDEX IF NOT EXISTS idx_goal_contributions_goal_id
                    ON goal_contributions(goal_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "goal_contribution_transaction_link",
            sql: "
                PRAGMA foreign_keys = ON;

                ALTER TABLE goal_contributions
                    ADD COLUMN transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;

                CREATE INDEX IF NOT EXISTS idx_goal_contributions_transaction_id
                    ON goal_contributions(transaction_id);

                INSERT INTO categories (name, kind, is_essential, archived)
                SELECT 'Накопления', 'expense', 0, 0
                WHERE NOT EXISTS (
                    SELECT 1 FROM categories
                    WHERE name = 'Накопления' AND kind = 'expense' AND archived = 0
                );
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:finance.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
