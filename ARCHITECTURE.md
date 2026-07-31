# Архитектура Healz Mobile

## 1. Назначение и границы

Healz Mobile — нативная оболочка публичного `https://app.healz.ai`, а не отдельный клиент закрытого API. Приложение отвечает за mobile lifecycle, системный share, локальную подготовку медицинских документов и безопасную передачу файлов WebView. Сайт отвечает за авторизацию, список кейсов/чатов, серверную загрузку и отправку сообщения.

Это разделение сохраняет единственный источник продуктовой логики Healz. Native-код не воспроизводит auth/upload endpoint, не читает cookies и не принимает решение, в какой кейс отправлять документ.

## 2. Технологический стек

| Слой | Технология | Роль |
|---|---|---|
| Общий UI/state | React 19.2.3 + React Native 0.86.2 | WebView-shell, очередь, review |
| Runtime/build | Expo SDK 57 + CNG/Prebuild | единая конфигурация и генерация platform projects |
| Web | `react-native-webview` 13.16.1 | публичный Healz и persistent web storage |
| Responsive layout | `useWindowDimensions` + safe-area-context | fluid metrics, stacking, 1/2-column review |
| Share receiver | `expo-sharing` 57.0.8 | Android intents и iOS Share Extension lifecycle |
| Image preparation | `expo-image-manipulator` 57.0.7 | resize и HEIC conversion на устройстве |
| Native I/O | local Expo Kotlin + Swift module | bounded copy, magic validation, private staging, TTL |
| Android | API 36 / min 26 / arm64-v8a | `ACTION_SEND(_MULTIPLE)`, FileProvider, APK |
| iOS | deployment target 18.4 | Share Extension, App Group, protected files, WK open panel |

Минимальная iOS 18.4 выбрана не из-за Expo UI, а из-за публичного `WKUIDelegate` API, который позволяет надёжно передать заранее подготовленные `file://` URL следующему HTML file input. Android и iOS используют общий TypeScript state/UI, но платформенные boundary и file chooser callback реализованы нативно.

## 3. Структура репозитория

```text
HealthAi/
├── App.tsx
├── app.json
├── src/
│   ├── config.ts
│   ├── components/                 # review modal и queue banner
│   ├── files/
│   │   ├── model.ts                # queue model / selected artifact
│   │   ├── policy.ts               # чистые решения подготовки
│   │   └── prepareFile.ts          # ImageManipulator executor
│   ├── share/
│   │   ├── payloads.ts             # platform URI normalization
│   │   └── useIncomingShares.ts    # cold/warm share lifecycle
│   ├── ui/
│   │   ├── responsive.ts
│   │   └── useResponsiveLayout.ts
│   └── web/
│       ├── iosFileInputActivation.ts
│       └── urlPolicy.ts
├── modules/healz-upload-bridge/
│   ├── expo-module.config.json
│   ├── src/                         # общий TypeScript native contract
│   ├── android/src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── java/.../
│   │   │   ├── HealzUploadBridgeModule.kt
│   │   │   └── HealzUploadFileProvider.kt
│   │   └── res/xml/healz_upload_paths.xml
│   └── ios/
│       ├── HealzUploadBridge.podspec
│       └── HealzUploadBridgeModule.swift
├── patches/
│   ├── expo-sharing+57.0.8.patch
│   └── react-native-webview+13.16.1.patch
├── tests/
├── README.md
├── ARCHITECTURE.md
└── ENDPOINTS.md
```

Сгенерированные `android/` и `ios/` не являются источниками истины и исключены из Git. `expo prebuild` воспроизводит platform projects из `app.json`, Expo plugins, local module и npm packages.

Platform resolution выбирает `HealzUploadBridgeModule.android.ts` или `.ios.ts`. Web fallback сохраняет импорт без native side effects и не имитирует системный share.

## 4. Сквозной поток данных

```text
external app
   │
   ├─ Android: ACTION_SEND(_MULTIPLE) + content:// read grant
   │
   └─ iOS: Share Extension + unique file copy in App Group
                │
                ▼
       expo-sharing payload metadata
                │
                ▼
   platform importer: bounded copy → magic sniff → UUID queue directory
                │
                ▼
        QueuedFile(original, prepared?)
                │ sequential image preparation
                ▼
          user review / artifact choice
                │ stageForWebView
                ▼
   native handshake(nonce, createdAt, exact local URLs)
                │ user opens case/chat and taps paperclip
                ▼
   Android WebChromeClient / iOS WKUIDelegate open panel
                │
                ▼
       site <input type=file multiple> → site upload
```

В этом потоке нет промежуточного HTTP-сервера, base64/DataTransfer и прямого multipart из React Native. Документ покидает native storage только через штатный file chooser самого сайта.

## 5. Приём системного share

### 5.1 Общий lifecycle

`useIncomingShares` проверяет payload при cold start, при `AppState → active` и при deep link `healz://expo-sharing`. Reentrancy guard не допускает параллельного drain одного payload.

`payloads.ts` пропускает только `shareType=file|image` и platform URI:

- Android — только `content://`;
- iOS — только `file://`.

Text, URL, audio и video отбрасываются. Claimed MIME и имя передаются как hint; окончательное имя sanitizes native module, а тип определяется по байтам.

На Android используется raw `getSharedPayloads()`, чтобы importer успел прочитать URI пока действует grant. На iOS `getResolvedSharedPayloadsAsync()` используется для `originalName`/resolved metadata; при ошибке остаётся raw App Group URL. `clearSharedPayloads()` вызывается только после завершённого native import.

### 5.2 Android share target

Expo config plugin регистрирует `ACTION_SEND` и `ACTION_SEND_MULTIPLE` для PDF, octet-stream и изображений; wildcard разрешён только для mixed multiple batch, потому что некоторые приложения маркируют набор PDF+image как `*/*`.

Importer:

1. Получает временный `content://` grant.
2. Читает display name/size через `ContentResolver`.
3. Копирует поток 64 КиБ в `filesDir/healz-pending/<uuid>/incoming.tmp`.
4. Останавливает поток при превышении лимита.
5. Определяет MIME по magic bytes.
6. Переименовывает в sanitized original name с нормализованным расширением.
7. После копирования больше не зависит от lifetime исходного grant.

Исходный файл и его URI provider не изменяются.

### 5.3 iOS Share Extension и App Group

`expo-sharing` генерирует отдельный target:

- bundle ID: `ai.healz.mobile.ShareExtension`;
- display name в share sheet: `Healz`;
- App Group: `group.ai.healz.mobile`;
- activation rule: до 10 images и до 10 files.

Extension копирует attachment в App Group container, записывает payload metadata в App Group `UserDefaults` и открывает host app через scheme. Patch `expo-sharing+57.0.8.patch` устраняет риски template и добавляет воспроизводимую Xcode capability-конфигурацию:

- physical name всегда UUID + extension, поэтому два `analysis.pdf` не перезаписывают друг друга;
- исходное имя отдельно сохраняется в `metadata.originalName` и показывается пользователю;
- reentrancy guard обрабатывает один extension lifecycle один раз, а host открывается только после успешного persistent metadata write;
- 50 МиБ проверяются до и после file copy и до Data write; после `copyItem` transit mtime заменяется фактическим временем приёма, а при ошибке persistence regular non-symlink файлы удаляются только после canonical App Group boundary check;
- error logs обезличены и не интерполируют имя, URL или путь документа.

Swift importer не доверяет URL из metadata. Он принимает только canonical regular file внутри configured App Group, запрещает symlink, использует security-scoped access при необходимости и потоково копирует байты в `Application Support/healz-pending/<uuid>`. Все owned transit sources удаляются после batch — успешные, unsupported, oversize и элементы сверх лимита. Очистка payload metadata не заменяет physical cleanup.

Share Extension и incoming receive API Expo SDK 57 помечены Experimental. Кроме того, generated extension открывает containing app способом, который Expo считает нежелательным для production App Store flow; перед публикацией нужен отдельный review Apple policy. Simulator build подтверждает компиляцию и embedding обоих targets, но полный runtime smoke-test через системное «Поделиться» выполняется на реальном iPhone только под Apple Team с App Groups.

## 6. Общая очередь и UX

### `App.tsx`

Корневой coordinator:

- создаёт WebView и хранит `canGoBack`;
- применяет URL policy и запускает внешние приложения;
- принимает результаты native import;
- управляет `QueuedFile[]` и сохраняет актуальный массив в `queueRef` для async callbacks;
- запускает подготовку строго последовательно;
- показывает review и queue banner;
- stage-ит выбранные artifacts;
- опрашивает handoff state по nonce;
- сохраняет очередь в `handedOff` до решения пользователя.

### Review

`UploadReviewModal` показывает preview, исходное имя, размеры и результат подготовки. Пользователь может удалить элемент и выбрать original/prepared. CTA «Подготовить файлы» только создаёт native stage; upload не стартует.

Очередь остаётся поверх WebView, пока пользователь штатной навигацией выбирает кейс и чат. Нативного case/chat selector нет: это предотвратило бы синхронизацию с закрытой web-моделью и могло бы отправить документ не в тот контекст.

После нажатия скрепки `PendingUploadBanner` переходит в `handedOff`. Если карточки не появились, «Повторить» возвращает review и позволяет stage-ить те же private files. «Готово» скрывает React queue, но не удаляет physical files немедленно: сайт может продолжать читать URL во время upload. UI никогда не нажимает Send.

### Responsive layout

`useResponsiveLayout` получает фактические `width`, `height`, `fontScale` и safe-area insets. `createResponsiveLayout` плавно интерполирует padding, gap, radii, preview и title size между ограниченными значениями. Структурные пороги:

- review panel не шире 760 pt, readable content — 620 pt;
- две колонки только при content width не меньше 680 pt и `fontScale < 1.3`;
- banner/header/details складываются вертикально при недостатке ширины;
- touch targets не меньше 48 pt;
- safe areas применяются со всех сторон;
- `orientation: default` разрешает portrait и landscape.

## 7. Подготовка документов

`policy.ts` — чистая тестируемая логика, `prepareFile.ts` — executor через `expo-image-manipulator`.

| Формат | Политика |
|---|---|
| PDF | байты не меняются; без rasterize/repack |
| JPEG | max long edge 3508 px, quality 0.90 |
| PNG | lossless resize только при необходимости |
| HEIC/HEIF | JPEG quality 0.92 для совместимости |
| WebP | original |

JPEG/PNG output используется только если он экономит не менее 10% либо превращает слишком большой original в artifact до 20 МиБ. HEIC conversion считается compatibility conversion. При decode/render/adopt error всегда остаётся original. Original не удаляется при успешной подготовке, поэтому выбор обратим до handoff.

PDF не сжимается сознательно: автоматическая растеризация может уничтожить searchable text, формы, embedded metadata и электронную подпись, а простой rewrite способен изменить документ без заметного визуального сигнала.

Файлы готовятся последовательно, чтобы несколько больших снимков не конкурировали за память.

## 8. Лимиты и type validation

Hard limits дублируются в TypeScript, Kotlin, Swift и WebView handoff:

- 10 файлов;
- 100 МиБ на batch;
- 50 МиБ на входной файл для локальной подготовки;
- 20 МиБ на выбранный artifact перед передачей сайту;
- TTL private data/stage — 24 часа.

Раздельные file limits позволяют принять большой camera scan, уменьшить его и передать только safe artifact. Stream останавливается сразу при 50 МиБ; staging повторно проверяет actual file size и batch.

Magic allowlist:

- PDF: `%PDF-`;
- JPEG: `FF D8 FF`;
- PNG: полная 8-byte signature;
- WebP: `RIFF....WEBP`;
- HEIC/HEIF: ISO BMFF `ftyp` + allowlisted brand.

GIF, TIFF, BMP, audio и video отклоняются. Extension/MIME от отправителя используются только для первоначальной маршрутизации.

## 9. Private storage и handshake

### Android

```text
context.filesDir/
└── healz-pending/
    └── <uuid>/
        ├── <sanitized-original-name>
        └── prepared/<sanitized-output-name>
```

`android.allowBackup=false`. FileProvider экспортирован как `false`, разрешает read grants и публикует только `filesDir/healz-pending`, не весь app storage.

### iOS

```text
Library/Application Support/
└── healz-pending/
    └── <uuid>/
        ├── <sanitized-original-name>
        └── prepared/<sanitized-output-name>
```

Directory/files получают `NSFileProtectionComplete` и `NSURLIsExcludedFromBackupKey`. Source для prepared artifact может находиться только внутри private Caches. UUID и canonical containment проверяются при каждом adopt/stage/discard.

### Stage record

Платформенное private preferences хранилище содержит только schema, nonce, timestamp и metadata локальных URL:

```json
{
  "version": 1,
  "nonce": "uuid",
  "createdAt": 0,
  "files": [
    {
      "id": "uuid",
      "uri": "content://... или file://...",
      "name": "analysis.pdf",
      "mimeType": "application/pdf",
      "size": 12345
    }
  ]
}
```

Android использует private `SharedPreferences healz_upload_bridge`; iOS — app-local `UserDefaults.standard`. В record нет document bytes, email, cookies или OTP. Consumed marker записывается до удаления stage, чтобы polling видел `staged` либо `consumed`, но не transient `none`.

## 10. File chooser handoff

Публичный React Native WebView API не умеет заранее вернуть staged URLs следующему HTML input. Base64/DataTransfer увеличивает память и расширяет JS attack surface, localhost bridge создаёт лишний transport, прямой multipart дублирует закрытый API. Поэтому pinned patch меняет узкие platform callbacks и fail-closed guards.

### 10.1 Android WebChromeClient

`RNCWebChromeClient.onShowFileChooser`:

1. Проверяет exact HTTPS host `app.healz.ai`, default/443 port и `/app/chat[/…]`.
2. Требует `MODE_OPEN_MULTIPLE`, no capture и accept `application/pdf,image/*` либо `*/*`.
3. Читает stage не старше 24 часов.
4. Проверяет MIME allowlist и exact own FileProvider authority.
5. Атомарно записывает consumed nonce и снимает stage.
6. Возвращает `Uri[]` callback.
7. Если stage/guard не подходит, вызывает исходный RN WebView picker.

Две accept-сигнатуры отражают live composer: input сначала имеет `application/pdf,image/*`, затем перед `click()` меняется на `*/*`. Остальные guards сохраняют identity медицинского multiple-input.

### 10.2 iOS WKUIDelegate

На iOS public open-panel delegate доступен с 18.4. Поток состоит из двух независимых проверок:

1. `iosFileInputActivation.ts` на document-start ловит только trusted primary tap на exact DOM relation кнопки и одного hidden multiple input на chat route.
2. Перед синхронным `input.click()` script отправляет `HealzUploadChooser` message с version/path/multiple/accept.
3. Native script handler принимает только main frame, exact URL/path, точный accept и существующий valid stage; arm одноразовый и живёт 1.5 секунды.
4. WebView временно объявляет optional `webView:runOpenPanelWithParameters:...` только когда valid stage существует. UIDelegate reset нужен, потому что WebKit кэширует наличие optional methods.
5. Open panel требует тот же armed path, main frame, multiple selection и запрет directory selection.
6. Каждый URL заново проверяется: UUID ownership, canonical path внутри `Application Support/healz-pending`, regular file, MIME, 20 МиБ/file, 100 МиБ/batch и TTL.
7. Consumed marker записывается раньше удаления stage; callback получает `[URL]`, затем delegate refresh возвращает стандартное поведение.

Если stage отсутствует, optional callback не рекламируется и системный picker работает штатно. Если stage существует, но click не прошёл arm/main-frame guards, медицинские URL не выдаются; такой неожиданный input может быть отменён fail-closed. Это лучше, чем передать staged документы другому chooser на той же странице.

Document shim также синхронно сохраняет user activation и на 700 мс подавляет только delayed duplicate `click()` текущего live composer. Он shadow-ит метод одного input instance, не prototype; cleanup descriptor-safe и не затрагивает replacement node.

Patch закреплён на `react-native-webview@13.16.1`; `postinstall` должен падать при несовместимом update вместо тихой потери guards.

## 11. Состояния файла и очереди

```text
OS share payload
     │ bounded native import
     ▼
original / preparing
     ├─ useful preparation ─► ready(original + prepared)
     ├─ savings < 10% ──────► ready(original)
     └─ decode/error ───────► fallback(original)

ready/fallback
     │ user chooses artifact
     ▼
staged(nonce)
     │ user selects case/chat and taps paperclip
     ▼
consumed (URL handed to WebView)
     │
     ▼
handedOff (React queue retained)
     ├─ cards absent ─► review/re-stage
     └─ user «Готово» ─► hide queue; keep files until TTL
```

`consumed` не означает server HTTP 200. Без публичного upload-completion event приложение не удаляет file immediately после callback.

## 12. WebView, сессия и URL policy

Start URL: `https://app.healz.ai/app/chat`; неавторизованный сайт сам выполняет redirect на auth UI. Persistent session обеспечивают штатные WebView stores: `incognito=false`, `sharedCookiesEnabled`, `thirdPartyCookiesEnabled`, `domStorageEnabled`, default cache. Приложение не копирует token в AsyncStorage/SecureStore.

URL policy:

- exact HTTPS origin Healz → внутри WebView;
- external HTTP(S), `mailto:`, `tel:` → `Linking`;
- `javascript:`, `data:`, `file:`, `content:`, `intent:` и malformed → block.

## 13. Security boundaries

| Риск | Мера |
|---|---|
| Чужой origin просит staged docs | exact scheme/host/port/path guard в native callback |
| Другой input на chat page | trusted DOM message, main frame, multiple, exact accept, no capture/directories |
| Поддельное расширение/MIME | magic-byte detection на import и повторная проверка при stage |
| Path traversal | UUID parse, sanitize name, canonical containment |
| iOS symlink/App Group escape | regular non-symlink + canonical App Group boundary |
| URI grant истекает во время OTP | немедленная bounded private copy |
| Два одинаковых имени | UUID directory и UUID iOS transit filename |
| OOM на batch | 64 КиБ stream и последовательная image preparation |
| Незаметная порча | original сохраняется, PDF byte-for-byte, quality floor и savings threshold |
| Случайная отправка | выбор чата, реальный tap по скрепке и ручной Send |
| Backup/cleartext/storage permissions | Android backup off, iOS no-backup/file protection, HTTPS-only, blocked permissions |
| Утечка через logs/analytics | content/name не логируются приложением, native analytics отсутствует |

В Git запрещены keystore, passwords, cookies/OTP/token, реальные документы и production signing profiles.

## 14. Cleanup и failure semantics

- Ошибка/unsupported одного элемента не прерывает valid элементы batch.
- iOS App Group source удаляется после попытки import независимо от результата; file-backed audio/video из нестандартного sender тоже направляются в importer ради reject + cleanup.
- Потерянная при межпроцессной гонке App Group metadata не оставляет файл навсегда: host и extension при активации удаляют transit regular non-symlink UUID-файлы старше 24 часов после canonical boundary check.
- Partial destination удаляется при превышении лимита, I/O или magic error.
- Image decode/compression error либо низкая экономия → original.
- Cancel до handoff удаляет UUID directories сразу и очищает stage.
- Site offline → WebView показывает error state; private queue сохраняется.
- Закрытый review → queue остаётся в banner.
- Android guard miss → standard picker; stage остаётся.
- iOS stage absent → standard picker; armed guard miss никогда не отдаёт staged URLs.
- Handoff без карточек → «Повторить» создаёт новый nonce для тех же private files.
- «Готово» после handoff → React state скрывается, physical files остаются до TTL.
- `cleanupExpired` удаляет UUID directories и stage/consumed metadata старше 24 часов.
- Process death после native import может оставить orphan до TTL; persisted encrypted queue index не входит в MVP.

## 15. CNG, build и signing

Источник native configuration — `app.json`:

- scheme/package/bundle ID `healz` / `ai.healz.mobile`;
- Android intent filters через `expo-sharing`;
- iOS Share Extension `ai.healz.mobile.ShareExtension`;
- App Group `group.ai.healz.mobile` на host и extension;
- iOS activation max 10 files/images и deployment target 18.4;
- Android API/ABI, no backup/cleartext и blocked permissions;
- icon/splash, orientation и iOS camera/photo privacy strings.

Clean generation:

```bash
npm ci
npx expo prebuild --platform android --clean --no-install
npx expo prebuild --platform ios --clean --no-install
cd ios && pod install && cd ..
```

Checks:

```bash
npm run verify
npm run doctor
```

`verify` применяет оба patches, выполняет TypeScript, unit/contract tests и `expo install --check`. Contract tests должны проверять platform URI filtering, iOS arm message, exact route/origin/accept, magic/limits/storage guards, plugin IDs/activation rule и patch invariants. Native builds остаются обязательными, потому что Swift/Objective-C/Kotlin/Java не компилируются TypeScript suite.

Android release:

```bash
npm run prebuild:android
npm run build:apk
```

iOS physical-device Release требует automatic signing обоих targets одной Team и provisioning App Group. При CLI build нужны `-allowProvisioningUpdates` и при первом подключении `-allowProvisioningDeviceRegistration`.

### Apple signing

Share Extension требует платную Apple Developer Team, в которой зарегистрированы bundle IDs host/extension и App Group. На проверенной бесплатной Personal Team Xcode создаёт краткоживущие профили, но возвращает пустой `com.apple.security.application-groups` allowlist, поэтому production entitlements не подписываются. Personal Team остаётся пригодной для оболочки без Share Extension, а полный on-device test incoming Share выполняется только под Team с App Groups. При signing error проверяются Team на обоих targets, зарегистрированные identifiers, Developer Mode, доверие сертификату и устройство в provisioning profile.

После iOS build нужно проверить:

- `Healz.app/PlugIns/expo-sharing-extension.appex` существует;
- `codesign` entitlements host и extension содержат `group.ai.healz.mobile`;
- embedded profiles содержат правильные Team/device;
- app устанавливается, появляется в share sheet и получает batch из Files/Photos/Mail.

## 16. Smoke-проверки

Unit/contract tests не заменяют physical smoke. Минимальная release matrix:

1. Auth по email-коду, force quit, повторный запуск и сохранение session.
2. Одиночные PDF/JPEG/HEIC и mixed multiple batch из Mail/Files/Photos или Gmail/gallery.
3. Два файла с одинаковым именем, unsupported type, oversize и 11 элементов.
4. Читаемость мелких цифр после image preparation; byte hash PDF до/после private copy.
5. Выбор кейса/чата, handoff по скрепке и появление всех web cards.
6. «Повторить», «Готово», Cancel и stock picker с пустой queue.
7. Android Back/external links; iOS extension → host app; rotation и large font.
8. Restart/lock-unlock и TTL cleanup без возврата отменённых документов.

## 17. Ограничения и следующие шаги

Текущие ограничения:

- incoming receive в Expo SDK 57 Experimental;
- iOS только 18.4+;
- iOS open-containing-app behavior extension требует production/App Store review;
- Android APK arm64-only;
- DOM route/class/accept guards зависят от наблюдаемого публичного web bundle;
- session lifetime и server file limits определяет Healz;
- нет server upload-completion event, поэтому cleanup после handoff выполняется по TTL;
- бесплатная Personal Team не подписывает текущую App Group; для полного iOS smoke нужна Team с App Groups.

Приоритетные улучшения:

1. Публичный upload-completion event для немедленной безопасной очистки.
2. Persisted encrypted queue index для восстановления review после process death.
3. Server-advertised limits вместо дублированных client constants.
4. Release signing: стабильный Android upload key и paid Apple team/TestFlight.
5. Регулярный automated live-DOM contract smoke для composer input.
