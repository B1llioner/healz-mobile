# Healz Mobile

Android-оболочка публичного `https://app.healz.ai` с нативным приёмом PDF и изображений из Gmail, Files и галереи. Код приложения единый на Expo / React Native; изменения веб-продукта не требуются.

Приватный репозиторий: [B1llioner/healz-mobile](https://github.com/B1llioner/healz-mobile). Готовый sideload-прототип: [Healz-1.0.0-prototype-arm64.apk](https://github.com/B1llioner/healz-mobile/releases/download/v1.0.0-prototype/Healz-1.0.0-prototype-arm64.apk). Для скачивания нужно войти в GitHub. SHA-256 зафиксирован в [`artifacts/SHA256SUMS.txt`](./artifacts/SHA256SUMS.txt).

## Что работает

- мобильный WebView над `/app/chat`;
- вход по email-коду внутри сайта и persistent cookies между перезапусками;
- Android Back сначала возвращает по web-истории;
- внутренние ссылки остаются в приложении, внешние HTTP(S), `mailto:` и `tel:` открываются системно;
- `ACTION_SEND` и `ACTION_SEND_MULTIPLE` для PDF и изображений;
- защищённая очередь до 10 файлов с review до передачи сайту;
- HEIC/HEIF → JPEG, аккуратное уменьшение крупных JPEG/PNG, выбор оригинала;
- PDF передаётся byte-for-byte без изменений;
- подготовленные файлы попадают в существующий `<input type="file" multiple>` сайта только после явного нажатия скрепки в выбранном чате;
- собственные icon и splash из публичных фирменных assets Healz.

## Почему Expo / React Native

React Native WebView даёт изолированную оболочку вокруг удалённого сайта и позволяет оставить нативный bridge очень узким. Capacitor с remote `server.url` сильнее связывает удалённую страницу с нативным bridge и хуже подходит для медицинских документов. Expo Prebuild сохраняет общую TypeScript-кодовую базу и при этом позволяет добавить небольшой Android-модуль.

```text
Gmail / Files / Photos
        │ Android Share Intent
        ▼
expo-sharing (raw content:// URI)
        │ немедленное потоковое копирование
        ▼
private files storage ──► image preparation ──► native review
        │                                     │
        └──────── original fallback ◄─────────┘
                                              │ stage
                                              ▼
WebView file chooser ──► штатный input сайта ──► POST /api/documents
```

Мобильное приложение не повторяет закрытые auth/upload API. Веб-сайт сам формирует запросы и управляет сессией; наблюдавшийся контракт описан в [ENDPOINTS.md](./ENDPOINTS.md).

## UX загрузки

1. В другом приложении выбрать один или несколько документов.
2. Нажать «Поделиться» → Healz.
3. Проверить очередь, размер и выбранную версию каждого файла.
4. Нажать «Выбрать кейс и чат».
5. При необходимости войти, открыть нужные кейс и чат штатной навигацией Healz.
6. Нажать скрепку: подготовленные файлы появятся в composer.
7. Проверить карточки и отправить сообщение вручную.

Файлы не отправляются автоматически. Это сохраняет последний осознанный шаг пользователя перед публикацией медицинских документов.

## Подготовка файлов

- JPEG: длинная сторона не больше 3508 px, quality 0.90; результат выбирается только при экономии не менее 10%.
- PNG: только lossless resize при превышении 3508 px.
- HEIC/HEIF: локальное преобразование в JPEG quality 0.92 для совместимости.
- WebP: оригинал, поскольку формат уже эффективно сжат.
- PDF: оригинальные байты без растрирования или перепаковки.
- Любая ошибка декодирования приводит к безопасному fallback на оригинал.

Автоматически отличить чистый скан от цифрового, подписанного или защищённого PDF штатным Android API нельзя. Растеризация может уничтожить текстовый слой, формы и электронную подпись, поэтому PDF-компрессия осознанно не входит в эту версию.

Client guardrails: максимум 10 файлов, 50 МБ на файл и 100 МБ на пакет. Сервер Healz остаётся окончательным источником лимитов.

## Privacy и границы bridge

- документы обрабатываются только локально;
- входящий `content://` копируется потоково, без чтения всего файла в память;
- тип проверяется по magic bytes, а не только по расширению;
- временные файлы лежат в private `filesDir`, Android backup выключен, TTL — 24 часа;
- native bridge не читает cookies и не получает email/OTP;
- WebView получает staged URI только на exact `https://app.healz.ai/app/chat`, для совместимого file input и после user gesture;
- обычная скрепка работает штатно, если native queue пуста;
- отдельной нативной аналитики нет, имена и размеры документов не логируются;
- cleartext traffic и лишние storage/overlay permissions заблокированы.

## Toolchain

- Node `>=22.13` (проверено на 22.23.1)
- Expo SDK `57` / Expo `~57.0.8`
- React Native `0.86.0`
- `react-native-webview` `13.16.1`
- JDK 17
- Android SDK / target / compile API 36
- Android Build Tools 36.0.0
- NDK 27.1.12297006
- minSdk 26; release APK собирается для `arm64-v8a`

SDK 57 работает только на React Native New Architecture. Версии native packages следует обновлять через `npx expo install`, а не независимо до npm latest.

## Локальная сборка APK

```bash
npm ci
npx expo prebuild --platform android --clean

JAVA_HOME=/path/to/jdk17 \
ANDROID_HOME=/path/to/android-sdk \
ANDROID_SDK_ROOT=/path/to/android-sdk \
npm run build:apk
```

Результат Gradle: `android/app/build/outputs/apk/release/app-release.apk`.

Проверки:

```bash
npm run typecheck
npm test
npm run verify
npx expo install --check
npx expo-doctor@latest
```

`postinstall` применяет зафиксированный `patch-package` patch к WebView 13.16.1. Он нужен только для передачи staged URI стандартному file chooser callback; при обновлении WebView patch должен пройти повторный review.

## Установка и статус проверки

```bash
adb install -r Healz-1.0.0-prototype-arm64.apk
```

Release-параметры: package `ai.healz.mobile`, versionName/versionCode `1.0.0` / `1`, min/target/compile SDK `26` / `36` / `36`, ABI `arm64-v8a`. SHA-256 APK: `a1c517225fcd26142773ce30d30868d8fb0cde8ed460b6ba0c34cbfe41e6ae65`.

Подтверждены clean prebuild/assembleRelease, lintVital, v2-подпись, package/SDK/ABI, 22/22 unit/contract tests, TypeScript и Expo Doctor 20/20. Физического Android-устройства в окружении сборки не было: после установки отдельно нужно проверить cold-restart авторизации, share нескольких файлов из Gmail/Files/галереи, читаемость HEIC, передачу файлов по скрепке, Back и внешние ссылки.

## Структура

- `App.tsx` — WebView, Back/external navigation и верхнеуровневая очередь.
- `src/share/` — приём raw share payloads без небезопасной resolver-копии.
- `src/files/` — политика подготовки и выбор original/prepared.
- `modules/healz-upload-bridge/` — потоковый Android import, magic-byte validation, private staging и TTL.
- `patches/` — минимальный origin-guarded file chooser handoff.
- `ARCHITECTURE.md` — подробные слои, потоки данных, state machine и security boundaries.
- `ENDPOINTS.md` — наблюдавшийся Playwright-контракт публичной web-интеграции.
- `tests/` — unit- и статические contract-тесты критических политик.

## Фирменные материалы

Иконка получена с публичного сайта владельца продукта: `https://app.healz.ai/android-chrome-512x512.png` (копия зафиксирована в `assets/healz-icon.png`). Wordmark: `https://app.healz.ai/logos/healz-logo.svg`. Эти материалы не объявляются open source; они используются как фирменные assets Healz.

Репозиторий — приватный прототип без публичной лицензии на исходный код. Зависимости сохраняют собственные лицензии; внешняя публикация требует отдельного license/SBOM review. В Git нельзя добавлять keystore, пароли, cookie/OTP/token, реальные документы или production signing profiles.

## Известные ограничения

- receive-share API в Expo SDK 57 помечен Experimental, поэтому release нужно проверить из Gmail, Files и Photos на реальном устройстве;
- APK этой сдачи arm64-only и рассчитан на современные Android-телефоны;
- срок серверной web-сессии определяет Healz; приложение не обходит server logout;
- изменение маршрута `/app/chat` или атрибутов file input потребует повторной smoke-проверки;
- iOS build не выполнялся по условиям задачи.

`npm audit --omit=dev` для зафиксированного lockfile показывает 12 moderate findings в одной build-time цепочке Expo config → `xcode@3.0.1` → `uuid@7.0.3`; она не входит в Android runtime. `npm audit fix --force` не применён, потому что нарушает совместимость Expo SDK 57.

## Подпись прототипа

APK собран release-вариантом и валидно подписан v2, но использует template debug certificate. Этого достаточно для прямой установки и тестирования; для Google Play/пилота нужен стабильный закрытый upload key или EAS credentials. APK с другой подписью нельзя установить поверх прототипа: сначала нужно удалить эту версию.
