# Healz Mobile

Кроссплатформенная оболочка публичного `https://app.healz.ai` на Expo SDK 57 / React Native. Одна кодовая база работает на Android и iOS: WebView сохраняет веб-авторизацию, а нативный слой принимает PDF и изображения из системного меню «Поделиться», локально готовит их и передаёт штатной скрепке чата. Изменения веб-продукта не нужны.

Приватный репозиторий: [B1llioner/healz-mobile](https://github.com/B1llioner/healz-mobile). Текущий Android-релиз: [Healz 1.0.2](https://github.com/B1llioner/healz-mobile/releases/tag/v1.0.2), прямой asset — [Healz-1.0.2-multishare-arm64.apk](https://github.com/B1llioner/healz-mobile/releases/download/v1.0.2/Healz-1.0.2-multishare-arm64.apk). Для скачивания из приватного репозитория нужно войти в GitHub. Контрольная сумма фиксируется в [`artifacts/SHA256SUMS.txt`](./artifacts/SHA256SUMS.txt).

## Что реализовано

- WebView над `/app/chat`, вход по email-коду и persistent cookies между перезапусками;
- Android Back сначала возвращает по web-истории;
- внутренние ссылки остаются в приложении, внешние HTTP(S), `mailto:` и `tel:` открываются системно;
- адаптивные native-экраны для телефонов, планшетов, landscape и увеличенного системного шрифта;
- Android share target через `ACTION_SEND` и `ACTION_SEND_MULTIPLE`;
- iOS Share Extension через App Group, минимальная поддерживаемая версия — iOS 18.4;
- единая защищённая review-очередь до 10 PDF/изображений;
- PDF передаётся byte-for-byte, изображения оптимизируются консервативно с сохранением оригинала;
- подготовленные файлы попадают в существующий `<input type="file" multiple>` сайта только после явного нажатия скрепки в выбранном чате;
- после handoff очередь можно подтвердить кнопкой «Готово» или повторно передать, если карточки сайта не появились;
- собственные icon и splash из публичных фирменных assets Healz.

Статус iOS честно отличается от Android-доставки: host app и Share Extension собираются и встраиваются в Simulator build, но полный системный flow на физическом iPhone пока не запускался — бесплатная Personal Team не подписывает необходимый App Groups entitlement. Для такого smoke-test нужна платная Apple Developer Team; IPA в Android-релиз не входит.

## Почему Expo / React Native

React Native WebView оставляет продуктовую и auth-логику на публичном сайте, а нативный bridge ограничивает работой с локальными файлами. Expo Prebuild сохраняет одну TypeScript-кодовую базу и при этом генерирует Android intent filters, iOS Share Extension и оба native-модуля. Прямой multipart к закрытому API не реализован: запрос загрузки и cookies остаются ответственностью сайта.

```text
Mail / Files / Photos
        │
        ├─ Android Share Intent ──► content:// grant
        │
        └─ iOS Share Extension ───► App Group copy
                                      │
                                      ▼
                         bounded native import + magic check
                                      │
                                      ▼
                    private copy ─► image preparation ─► review
                         ▲                  │                  │
                         └──── original fallback ◄────────────┘
                                                            │ stage
                                                            ▼
                     user chooses case/chat → taps paperclip
                                                            │
                                                            ▼
                               standard site input → site upload
```

Наблюдавшийся web-контракт описан в [ENDPOINTS.md](./ENDPOINTS.md), устройство native-слоёв — в [ARCHITECTURE.md](./ARCHITECTURE.md).

## UX отправки документов

1. В Почте, Файлах или галерее выбрать один или несколько PDF/изображений.
2. Нажать «Поделиться» → Healz. На iOS при первом запуске Healz может понадобиться включить через «Ещё» в списке приложений.
3. В review проверить имена, размеры и выбранную версию каждого файла; ненужные элементы можно убрать, для изображения можно оставить оригинал.
4. Нажать «Подготовить файлы». Загрузка на этом шаге ещё не начинается.
5. В WebView войти при необходимости и штатной навигацией Healz открыть нужные кейс и чат.
6. Нажать скрепку: весь подготовленный batch передаётся существующему file input сайта.
7. Проверить карточки файлов. Если они не появились — выбрать «Повторить» и нажать скрепку ещё раз; если всё в порядке — «Готово».
8. Отправить сообщение вручную.

Нативного отдельного выбора кейса нет намеренно: пользователь видит актуальные кейсы и чаты в самом Healz, а приложение не дублирует закрытую бизнес-логику. Автозагрузка и автоотправка также исключены — перед публикацией медицинских документов остаются два понятных осознанных действия: выбор чата и нажатие скрепки/Send.

## Подготовка файлов

- JPEG: длинная сторона не больше 3508 px, quality 0.90; подготовленная версия выбирается только при экономии не менее 10% либо когда она позволяет уложиться в upload-limit.
- PNG: только lossless resize при превышении 3508 px; маленький оригинал не перепаковывается.
- HEIC/HEIF: локальная конвертация в JPEG quality 0.92 для совместимости с web upload.
- WebP: остаётся оригиналом, поскольку уже эффективно сжат.
- PDF: исходные байты без растрирования, перепаковки и удаления текстового слоя, форм или подписи.
- Ошибка декодирования/оптимизации всегда приводит к безопасному fallback на оригинал.

Лимиты клиента: до 10 файлов, до 100 МиБ на batch, до 50 МиБ на входной файл для локальной подготовки и до 20 МиБ на выбранный artifact перед handoff. Сервер остаётся окончательным источником ограничений.

## Приём на платформах

### Android

`expo-sharing` регистрирует приложение в системном share sheet для одиночных и множественных PDF/изображений. Полученный `content://` URI с временным grant немедленно и потоково копируется в private `filesDir`; исходник в другом приложении не изменяется. После stage patched `RNCWebChromeClient` возвращает собственные read-only FileProvider URI только доверенному file input Healz.

### iOS 18.4+

`expo-sharing` генерирует отдельную Share Extension `ai.healz.mobile.ShareExtension`. Extension получает до 10 файлов/изображений, до и после копирования проверяет предел 50 МиБ, сохраняет каждый transit-файл под уникальным UUID в App Group `group.ai.healz.mobile`, записывает исходное имя в metadata и открывает основное приложение. Swift importer принимает только обычные нессылочные файлы из этого App Group, потоково переносит их по 64 КиБ в защищённый `Application Support/healz-pending` и очищает transit-копии, включая отклонённые audio/video payload от нестандартного share sender.

На iOS 18.4 появился публичный `WKUIDelegate` callback для open panel. Document-start shim только после доверенного tap по конкретной скрепке «вооружает» одноразовый handoff на 1.5 секунды; patched WebView возвращает staged `file://` URL. Когда очереди нет, delegate не объявляет этот callback и остаётся штатный системный picker.

Deployment target проекта зафиксирован на iOS 18.4: это честно исключает установку на версию, где надёжный native-to-file-input handoff недоступен.

## Privacy и security boundary

- содержимое документов обрабатывается только на устройстве и не логируется нативной аналитикой;
- Android и iOS host import копируют по 64 КиБ и останавливаются на лимите; iOS extension отдельно проверяет размер до и после своей App Group transit-copy;
- фактический тип проверяется по magic bytes, а не по расширению или заявленному MIME;
- одинаковые имена не конфликтуют: каждый queue item получает UUID-каталог, iOS transit-файл — UUID-имя;
- Android backup выключен; iOS private copies имеют `NSFileProtectionComplete` и исключены из backup;
- iOS importer разрешает источник только внутри App Group, отклоняет symlink/необычный файл и удаляет App Group transit-copy после обработки, включая rejected items;
- bridge не читает cookies, email, OTP или auth token;
- handoff ограничен exact origin `https://app.healz.ai`, route `/app/chat[/…]`, main frame, `multiple`, наблюдавшимся `accept` и явным user gesture;
- staged MIME ограничены PDF, JPEG, PNG, WebP и HEIC; 20 МиБ/file, 100 МиБ/batch и TTL повторно проверяются перед handoff;
- Cancel до handoff удаляет private queue сразу; после передачи только app-owned `healz-pending` копии живут максимум 24 часа, чтобы не оборвать возможный in-flight upload;
- при пустом native stage работает обычный системный picker; Android также возвращается к нему при guard miss, а iOS со staged medical files отменяет неожиданный untrusted chooser fail-closed.

## Адаптивность

Native UI рассчитывается от фактического окна через `useWindowDimensions` и safe-area insets. Отступы, радиусы, preview и заголовки плавно меняются по clamped interpolation; review-панель ограничена шириной 760 pt, читаемый контент — 620 pt. Карточки переходят в две колонки только при достаточной ширине, а при узком окне или большом `fontScale` заголовки, детали и actions складываются вертикально. Touch target не меньше 48 pt, `orientation: default` поддерживает portrait и landscape.

## Toolchain

- Node `>=22.13`;
- Expo SDK `57` / Expo `~57.0.9`;
- React Native `0.86.2`;
- `react-native-webview` `13.16.1`;
- Android: JDK 17, API/target/compile 36, Build Tools 36.0.0, NDK 27.1, minSdk 26, ABI `arm64-v8a`;
- iOS: Xcode 26, CocoaPods, deployment target 18.4.

SDK 57 использует React Native New Architecture. Native packages обновляются через `npx expo install`; оба `patch-package` файла должны проходить отдельный review при обновлении `expo-sharing` или WebView.

## Проверки

```bash
npm ci
npm run verify
npm run doctor
```

`verify` применяет patches, запускает TypeScript, unit/contract tests и проверяет совместимость Expo packages. Перед release дополнительно нужны clean prebuild обеих платформ и реальные smoke-тесты share sheet: эти пути невозможно полностью подтвердить unit-тестами.

## Сборка и установка Android APK

```bash
npm ci
npm run prebuild:android

JAVA_HOME=/path/to/jdk17 \
ANDROID_HOME=/path/to/android-sdk \
ANDROID_SDK_ROOT=/path/to/android-sdk \
npm run build:apk

adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Релизный APK: `android/app/build/outputs/apk/release/app-release.apk`. Текущая конфигурация — package `ai.healz.mobile`, version `1.0.2` / versionCode `3`, min/target/compile `26` / `36` / `36`, ABI `arm64-v8a`. Фактический asset проверен `apksigner` (APK Signature Scheme v2); SHA-256: `ddf4cb3eba2b20a561d3b617e1d4303cb02ce8cb306778045fc036a63ec10553`.

## Сборка и запуск на iPhone

Для физического iPhone нужны Xcode, matching iOS runtime, добавленный Apple ID, Developer Mode на телефоне и USB/сетевое подключение. Simulator для запуска на реальном телефоне не нужен. TestFlight для локального запуска тоже не нужен.

```bash
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
xcodebuild -downloadPlatform iOS -architectureVariant arm64

npm ci
npx expo prebuild --platform ios --clean --no-install
cd ios && pod install && cd ..
open ios/Healz.xcworkspace
```

Открывать нужно `Healz.xcworkspace`, не `.xcodeproj`. В Xcode выберите scheme/target `Healz`, подключённый iPhone и в `Signing & Capabilities` включите automatic signing для основной app и Share Extension с одной платной Apple Developer Team, в которой зарегистрированы `ai.healz.mobile` и `group.ai.healz.mobile`. Бесплатная Personal Team создаёт профиль с пустым App Groups allowlist, поэтому на ней физическая сборка Share Extension не подписывается; симуляторная сборка при этом проходит. Удалять App Group для обхода signing error нельзя, иначе входящий share перестанет работать.

CLI-эквивалент:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild -workspace ios/Healz.xcworkspace \
  -scheme Healz \
  -configuration Release \
  -destination 'id=<DEVICE_UDID>' \
  -derivedDataPath /tmp/HealzDerivedData \
  DEVELOPMENT_TEAM=<TEAM_ID> \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  build
```

### Ограничения Apple Personal Team

Проверенная бесплатная Personal Team подписывает обычную оболочку, но для host и Share Extension выдаёт provisioning profiles с пустым App Groups allowlist. Поэтому полный incoming Share на физическом iPhone требует платную Apple Developer Team с зарегистрированными `ai.healz.mobile`, `ai.healz.mobile.ShareExtension` и `group.ai.healz.mobile`. Удаление entitlements сделало бы сборку устанавливаемой, но сломало бы сам обмен файлами, поэтому такой обход намеренно не используется. Симуляторная сборка с обоими targets проходит без подписи.

## Smoke-чеклист релиза

На обеих платформах проверить на физическом устройстве:

1. Войти по email-коду, закрыть приложение, открыть снова и убедиться, что сессия сохранилась.
2. Из Почты/Files/Photos отправить один PDF, одно изображение и batch с одинаковыми именами; проверить, что в review не больше 10 элементов.
3. Сравнить мелкий текст и цифры на подготовленном изображении; убедиться, что PDF не изменён.
4. Выбрать нужные кейс и чат, нажать скрепку и дождаться карточек всех файлов.
5. Проверить «Повторить», «Готово», Cancel и обычную скрепку при пустой queue.
6. Проверить Back, внешнюю ссылку, поворот экрана и крупный системный шрифт.
7. Перезапустить приложение и убедиться, что просроченные/отменённые документы не возвращаются.

Android отдельно: share из Gmail/Files/галереи, `ACTION_SEND_MULTIPLE`, HEIC и установка release APK поверх предыдущей версии с той же подписью. iOS отдельно: появление Healz в «Поделиться → Ещё», запуск host app из extension, entitlement App Group и повторный запуск после блокировки/разблокировки телефона.

## Структура

- `App.tsx` — WebView, навигация и coordinator очереди;
- `src/share/` — нормализация Android/iOS incoming payloads;
- `src/files/` — политика подготовки и выбор original/prepared;
- `src/ui/` — responsive-математика и safe-area hook;
- `modules/healz-upload-bridge/` — Kotlin/Swift import, private staging, validation и TTL;
- `patches/expo-sharing+57.0.8.patch` — уникальные iOS transit-имена, App Groups provisioning и display name extension;
- `patches/react-native-webview+13.16.1.patch` — origin-guarded Android/iOS file chooser handoff;
- `ARCHITECTURE.md` — слои, state machine и security boundaries;
- `ENDPOINTS.md` — наблюдавшийся web-контракт;
- `tests/` — unit- и статические contract-тесты критических политик.

## Известные ограничения

- incoming-share API Expo SDK 57 помечен Experimental; каждый release нужно проверять из реальных Mail/Files/Photos/Gmail/gallery;
- iOS extension в Expo открывает containing app способом, который требует отдельного App Store review; targets компилируются в Simulator, но physical incoming-share runtime ещё требует paid Team и smoke-test;
- orphan transit-файлы iOS (например, если новый share перезаписал metadata до drain) удаляются после 24 часов при следующем запуске host или Share Extension; очистка ограничена UUID-файлами внутри App Group;
- iOS ниже 18.4 не поддерживается;
- APK arm64-only и рассчитан на современные Android-телефоны;
- срок web-сессии определяет Healz, приложение не обходит server logout;
- изменение `/app/chat`, DOM кнопки/`input accept` или поведения публичного bundle потребует повторного contract review;
- `consumed` означает передачу URL WebView, а не подтверждённый HTTP 200; поэтому очистка после handoff выполняется по TTL;
- APK прототипа подписан template debug certificate: для Google Play/пилота нужен стабильный закрытый upload key. APK с другой подписью не установится поверх старого без удаления приложения.

Иконка получена с публичного сайта владельца продукта: `https://app.healz.ai/android-chrome-512x512.png` и зафиксирована в `assets/healz-icon.png`. Репозиторий приватный; в Git нельзя добавлять keystore, cookies/OTP/tokens, реальные документы или production signing profiles.
