# Healz Mobile

Кроссплатформенная оболочка публичного `https://app.healz.ai` на Expo / React Native. Общий WebView-shell рассчитан на iOS и Android; нативный приём PDF и изображений через системное «Поделиться» в текущей версии реализован на Android. Изменения веб-продукта не требуются.

Приватный репозиторий: [B1llioner/healz-mobile](https://github.com/B1llioner/healz-mobile). Ожидаемый release asset для прямой установки: [Healz-1.0.1-upload-fix-arm64.apk](https://github.com/B1llioner/healz-mobile/releases/download/v1.0.1/Healz-1.0.1-upload-fix-arm64.apk). Для скачивания нужно войти в GitHub. SHA-256 зафиксирован в [`artifacts/SHA256SUMS.txt`](./artifacts/SHA256SUMS.txt).

## Что работает

- мобильный WebView над `/app/chat`;
- вход по email-коду внутри сайта и persistent cookies между перезапусками;
- Android Back сначала возвращает по web-истории;
- внутренние ссылки остаются в приложении, внешние HTTP(S), `mailto:` и `tel:` открываются системно;
- адаптивные native-экраны для телефонов, планшетов, landscape и увеличенного системного шрифта;
- Android `ACTION_SEND` и `ACTION_SEND_MULTIPLE` для PDF и изображений;
- защищённая очередь до 10 файлов с review до передачи сайту;
- HEIC/HEIF → JPEG, аккуратное уменьшение крупных JPEG/PNG, выбор оригинала;
- PDF передаётся byte-for-byte без изменений;
- подготовленные файлы попадают в существующий `<input type="file" multiple>` сайта только после явного нажатия скрепки в выбранном чате;
- после handoff очередь остаётся видимой: можно подтвердить «Готово» или повторить передачу, если карточки не появились;
- собственные icon и splash из публичных фирменных assets Healz.

## Почему Expo / React Native

React Native WebView даёт изолированную оболочку вокруг удалённого сайта и позволяет оставить нативный bridge очень узким. Capacitor с remote `server.url` сильнее связывает удалённую страницу с нативным bridge и хуже подходит для медицинских документов. Expo Prebuild сохраняет общую TypeScript-кодовую базу и при этом позволяет добавить небольшой Android-модуль.

```text
Gmail / Files / Photos (Android)
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
4. Нажать «Подготовить файлы». На этом шаге загрузка ещё не начинается.
5. При необходимости войти и открыть нужный чат штатной навигацией Healz.
6. Нажать скрепку: подготовленные файлы передаются стандартному file input, после чего сайт начинает загрузку.
7. Проверить карточки. Если они не появились — нажать «Повторить» и снова скрепку; если всё в порядке — «Готово».
8. Отправить сообщение вручную.

Файлы не отправляются автоматически. Это сохраняет последний осознанный шаг пользователя перед публикацией медицинских документов. После handoff «Готово» скрывает локальную очередь, но не удаляет physical files немедленно: сайт ещё может читать `content://` во время upload, поэтому копии безопасно удалит TTL cleanup.

## Подготовка файлов

- JPEG: длинная сторона не больше 3508 px, quality 0.90; результат выбирается только при экономии не менее 10%.
- PNG: только lossless resize при превышении 3508 px.
- HEIC/HEIF: локальное преобразование в JPEG quality 0.92 для совместимости.
- WebP: оригинал, поскольку формат уже эффективно сжат.
- PDF: оригинальные байты без растрирования или перепаковки.
- Любая ошибка декодирования приводит к безопасному fallback на оригинал.

Автоматически отличить чистый скан от цифрового, подписанного или защищённого PDF штатным Android API нельзя. Растеризация может уничтожить текстовый слой, формы и электронную подпись, поэтому PDF-компрессия осознанно не входит в эту версию.

Client guardrails: максимум 10 файлов и 100 МиБ на пакет. Для локальной подготовки приложение принимает один исходник до 50 МиБ, чтобы крупный снимок можно было уменьшить; передача сайту разрешена только если выбранный оригинал или оптимизированная версия не больше 20 МиБ. Upload-предел совпадает с текущим публичным server config Healz (`0x1400000`); сервер остаётся окончательным источником ограничений.

## Privacy и границы bridge

- документы обрабатываются только локально;
- входящий `content://` копируется потоково, без чтения всего файла в память;
- тип проверяется по magic bytes, а не только по расширению;
- временные файлы лежат в private `filesDir`, Android backup выключен, TTL — 24 часа;
- native bridge не читает cookies и не получает email/OTP;
- WebView получает staged URI только на exact origin `https://app.healz.ai`, на `/app/chat` или вложенном chat route, после user gesture и без capture-flow;
- handoff разрешён только multiple-input с одной из двух наблюдавшихся сигнатур `application/pdf,image/*` или `*/*`, а staged MIME ограничены PDF, JPEG, PNG, WebP и HEIC;
- обычная скрепка работает штатно, если native queue пуста;
- отдельной нативной аналитики нет, имена и размеры документов не логируются;
- cleartext traffic и лишние storage/overlay permissions заблокированы.

## Адаптивность

Native UI рассчитывается от фактического окна через `useWindowDimensions` и safe-area insets. Отступы, радиусы, preview и заголовки меняются плавно по clamped interpolation: значения не становятся слишком тесными на маленьком телефоне и не раздуваются на планшете. Review-панель ограничена шириной 760 pt, читаемый текст — 620 pt; карточки переключаются между одной и двумя колонками только при достаточной ширине. При узком окне или большом `fontScale` заголовки, детали файла и actions складываются вертикально. Минимальная touch-target — 48 pt, ориентация приложения — `default`, поэтому поддерживаются portrait и landscape.

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
adb install -r Healz-1.0.1-upload-fix-arm64.apk
```

Release-параметры: package `ai.healz.mobile`, versionName/versionCode `1.0.1` / `2`, min/target/compile SDK `26` / `36` / `36`, ABI `arm64-v8a`. SHA-256 APK: `a840b29c01a0c8055ca8b9544c6bfe766298f8d14cabf69b4f81345924e1f9fe`.

Подтверждены clean prebuild/assembleRelease, lintVital, v2-подпись, package/SDK/ABI, 42/42 unit/contract tests, TypeScript и Expo Doctor 20/20. В это число входят 9 responsive-тестов и отдельные VM-тесты iOS-активации file input: exact origin/path, trusted tap, DOM identity, синхронный picker, подавление отложенного дубля и безопасное восстановление после React re-render. На физическом Android после установки отдельно нужно проверить cold-restart авторизации, share нескольких файлов из Gmail/Files/галереи, читаемость HEIC, передачу файлов по скрепке, Back и внешние ссылки.

## Структура

- `App.tsx` — WebView, Back/external navigation и верхнеуровневая очередь.
- `src/share/` — приём raw share payloads без небезопасной resolver-копии.
- `src/files/` — политика подготовки и выбор original/prepared.
- `src/ui/` — чистая responsive-математика и hook фактического размера окна/safe area.
- `modules/healz-upload-bridge/` — потоковый Android import, magic-byte validation, private staging и TTL.
- `patches/` — минимальный origin-guarded file chooser handoff.
- `ARCHITECTURE.md` — подробные слои, потоки данных, state machine и security boundaries.
- `ENDPOINTS.md` — наблюдавшийся web-контракт и актуальная сверка live bundle.
- `tests/` — unit- и статические contract-тесты критических политик.

## Фирменные материалы

Иконка получена с публичного сайта владельца продукта: `https://app.healz.ai/android-chrome-512x512.png` (копия зафиксирована в `assets/healz-icon.png`). Wordmark: `https://app.healz.ai/logos/healz-logo.svg`. Эти материалы не объявляются open source; они используются как фирменные assets Healz.

Репозиторий — приватный прототип без публичной лицензии на исходный код. Зависимости сохраняют собственные лицензии; внешняя публикация требует отдельного license/SBOM review. В Git нельзя добавлять keystore, пароли, cookie/OTP/token, реальные документы или production signing profiles.

## Известные ограничения

- receive-share API в Expo SDK 57 помечен Experimental, поэтому release нужно проверить из Gmail, Files и Photos на реальном устройстве;
- APK этой сдачи arm64-only и рассчитан на современные Android-телефоны;
- срок серверной web-сессии определяет Healz; приложение не обходит server logout;
- изменение маршрута `/app/chat` или атрибутов file input потребует повторной smoke-проверки;
- общий WebView-shell, сессия, навигация и обычный file picker предусмотрены для iOS; добавлены privacy strings камеры/фототеки, landscape и iOS-only document-start shim, который сохраняет trusted tap при известной 400-мс задержке публичного composer; custom `Share → Healz` пока остаётся Android-only;
- локальная iOS-сборка сейчас заблокирована отсутствующим компонентом платформы iOS 26.5 в Xcode; после его установки проект можно собрать и поставить на подключённый iPhone.

`npm audit --omit=dev` для зафиксированного lockfile показывает 12 moderate findings в одной build-time цепочке Expo config → `xcode@3.0.1` → `uuid@7.0.3`; она не входит в Android runtime. `npm audit fix --force` не применён, потому что нарушает совместимость Expo SDK 57.

## Подпись прототипа

APK собран release-вариантом и валидно подписан v2, но использует template debug certificate. Этого достаточно для прямой установки и тестирования; для Google Play/пилота нужен стабильный закрытый upload key или EAS credentials. APK с другой подписью нельзя установить поверх прототипа: сначала нужно удалить эту версию.
