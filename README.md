# Finance

Локальное приложение для личных финансов одного человека: доходы, расходы, бюджет, цели и аналитика. Данные хранятся на устройстве в SQLite — без аккаунтов и облака.

## Возможности

- **Обзор** — баланс, cashflow, план/факт по бюджету
- **Операции** — доходы, расходы и переводы по счетам и категориям
- **Бюджет** — месяц и год: лимиты по категориям, свободные средства, копирование плана
- **Цели** — накопления с пополнениями (пишутся в операции)
- **Счета** — несколько счетов, архивация без потери истории
- **Данные** — JSON-бэкап и PDF-отчёт консультанта с пояснениями
- **Конвертер** — курсы валют по открытому API
- **Импорт** — PDF-выписки (Kaspi Gold и др.)
- **Категории** — обязательные и необязательные расходы

Приоритеты: точность расчётов, сохранность истории, приватность, простой UX.

## Стек

| Слой | Технологии |
|------|------------|
| Оболочка | Tauri 2, Rust |
| UI | React 19, TypeScript, Vite |
| БД | SQLite (`sqlite:finance.db`) через `tauri-plugin-sql` |

Деньги в логике считаются в минорных единицах (`amount_minor`: тиыны / центы), валюта — ISO 4217 (`KZT`, `USD`, …).

## Требования

- Node.js 20+
- Rust (stable)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) для вашей ОС
- для iOS: macOS + Xcode

## Быстрый старт (desktop)

```bash
npm install
npm test
npm run tauri dev
```

Сборка приложения:

```bash
npm run tauri build
```

## Releases (GitHub Actions)

Workflow [`.github/workflows/release.yml`](./.github/workflows/release.yml) собирает desktop-пакеты для:

- macOS Apple Silicon (`aarch64`)
- macOS Intel (`x86_64`)
- Linux x64 (AppImage / deb)
- Windows x64 (msi / nsis)

**Как выпустить**

1. В настройках репозитория: **Settings → Actions → General → Workflow permissions → Read and write permissions**.
2. Поднимите версию в `package.json` и `src-tauri/tauri.conf.json` (и при желании в `src-tauri/Cargo.toml`).
3. Закоммитьте и создайте тег:

```bash
git tag v0.1.1
git push origin v0.1.1
```

Либо запустите workflow вручную: **Actions → Release → Run workflow**.

Сборка создаёт **draft** release с артефактами — проверьте файлы и нажмите **Publish release**. Подписи Apple/Windows в CI пока нет (для личного использования обычно достаточно).

## Установка на iPhone

1. Подключите телефон, доверьте компьютеру.
2. Соберите фронт и откройте Xcode-проект:

```bash
npm run build
open src-tauri/gen/apple/finance.xcodeproj
```

3. В Xcode выберите свой iPhone, Team (Apple ID) и нажмите **Run**.
4. При первом запуске: **Настройки → Основные → VPN и управление устройством → Доверить**.

Либо из терминала:

```bash
npm run tauri -- ios dev
```

На бесплатном Apple ID приложение нужно периодически переустанавливать (~7 дней).

## Структура

```
src/
  App.tsx, main.tsx, App.css   # оболочка UI
  components/                  # панели и виджеты
  lib/
    db.ts                      # единственная точка доступа к SQLite
    money.ts, budget.ts, …     # доменная логика
src-tauri/
  src/lib.rs                   # миграции и плагины Tauri
  capabilities/                # минимальные разрешения
```

Правила для агентов и домена — в [`AGENTS.md`](./AGENTS.md).

## Скрипты

| Команда | Назначение |
|---------|------------|
| `npm run tauri dev` | desktop в режиме разработки |
| `npm run build` | TypeScript + Vite production build |
| `npm test` | Vitest |
| `npm run tauri build` | установочный пакет desktop |
| GitHub Actions `Release` | draft-релизы macOS / Windows / Linux по тегу `v*` |
| `cargo check --manifest-path src-tauri/Cargo.toml` | проверка Rust |

## Приватность

- Финансовые данные по умолчанию только локально.
- Нет регистрации, ролей и совместного доступа.
- Импорт PDF считается недоверенным: проверяются формат, размер и значения.
- Конвертеру для курсов нужен интернет; остальное работает офлайн.

## Лицензия

Приватный проект (`private` в `package.json`). Распространение и лицензия — на усмотрение автора.
