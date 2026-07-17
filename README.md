# Finance

Локальное desktop-приложение для личного бюджета одного человека.

## Стек

- Tauri 2 + Rust
- React 19 + TypeScript + Vite
- SQLite (`sqlite:finance.db`) через `tauri-plugin-sql`

## Возможности

- счета и категории (обязательные / необязательные расходы)
- доходы (+) и расходы (−) в `amount_minor`
- месячный бюджет: план, факт, остаток, свободные средства
- предупреждения о приближении к лимиту и перерасходе
- копирование бюджета на следующий месяц (явное действие)

## Запуск

```bash
npm install
npm test
npm run tauri dev
```

## Проверки

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
