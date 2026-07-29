# Архитектура Healz Mobile

## 1. Назначение и границы

Healz Mobile — нативная оболочка публичного `https://app.healz.ai`, а не отдельный клиент закрытого API. Приложение отвечает за мобильный lifecycle, системный share, локальную подготовку документов и безопасную передачу файлов WebView. Сайт отвечает за авторизацию, продуктовую навигацию, загрузку документа и отправку сообщения.

Это разделение сохраняет единственный источник бизнес-логики Healz и уменьшает риск рассинхронизации мобильной версии с вебом.

## 2. Технологический стек

| Слой | Технология | Роль |
|---|---|---|
| Общий UI/state | React 19.2.3 + React Native 0.86.0 | WebView-shell, очередь, review |
| Runtime/build | Expo SDK 57 + CNG/Prebuild | единая конфигурация и native generation |
| Web | `react-native-webview` 13.16.1 | публичный Healz и persistent web storage |
| Responsive layout | `useWindowDimensions` + safe-area-context | fluid metrics, stacking, 1/2-column review |
| Share receiver | `expo-sharing` 57.0.7 | Android `ACTION_SEND(_MULTIPLE)` lifecycle |
| Image preparation | `expo-image-manipulator` 57.0.6 | resize/HEIC conversion на устройстве |
| Native I/O | local Expo Kotlin module | bounded streaming copy, validation, FileProvider, staging |
| Android | API 36 / min 26 / arm64-v8a | устанавливаемый APK для современных телефонов |
| iOS | общий Expo/RN WebView-shell | сессия, навигация и штатный picker; без Share Extension |

## 3. Структура репозитория

```text
HealthAi/
├── App.tsx                         # корневой coordinator
├── app.json                        # CNG/native configuration
├── src/
│   ├── config.ts                   # origin, лимиты, palette
│   ├── components/                 # review modal и queue banner
│   ├── files/
│   │   ├── model.ts                # queue model / selected artifact
│   │   ├── policy.ts               # чистые тестируемые решения
│   │   └── prepareFile.ts          # ImageManipulator executor
│   ├── share/useIncomingShares.ts  # raw share lifecycle
│   ├── ui/
│   │   ├── responsive.ts           # чистая fluid layout-математика
│   │   └── useResponsiveLayout.ts  # window/fontScale/safe-area hook
│   └── web/urlPolicy.ts            # internal/external/block
├── modules/healz-upload-bridge/
│   ├── expo-module.config.json
│   ├── src/                         # TypeScript native contract/fallbacks
│   └── android/src/main/
│       ├── AndroidManifest.xml
│       ├── java/.../
│       │   ├── HealzUploadBridgeModule.kt
│       │   └── HealzUploadFileProvider.kt
│       └── res/xml/healz_upload_paths.xml
├── patches/react-native-webview+13.16.1.patch
├── tests/
├── assets/
├── artifacts/SHA256SUMS.txt
├── README.md
├── ARCHITECTURE.md
├── ENDPOINTS.md
└── package.json
```

Сгенерированные `android/` и `ios/` не являются источниками истины и исключены из Git. `npx expo prebuild` воспроизводит platform project из `app.json`, local module и npm packages.

Platform resolution выбирает Android native module только для `.android.ts`. Базовая/iOS-реализация оставляет lifecycle methods безопасными no-op и явно отклоняет share mutations: общий WebView-shell запускается, но не имитирует отсутствующую iOS Share Extension.

## 4. Компоненты runtime

### `App.tsx`

Корневой координатор:

- создаёт WebView и хранит `canGoBack`;
- применяет URL policy и запускает внешние приложения;
- принимает импортированные batch results;
- управляет очередью `QueuedFile[]`;
- запускает подготовку строго последовательно;
- открывает review modal;
- stage-ит выбранные версии для WebView;
- отслеживает handoff по `nonce`, сохраняя очередь в состоянии `handedOff` до решения пользователя;
- получает responsive geometry из фактического окна, safe area и `fontScale`;
- показывает loading/error/ready states.

Очередь дублируется в `queueRef`, чтобы async share/prepare callbacks работали с актуальным состоянием, а не со stale React closure.

### `useIncomingShares`

Слушает cold start, `AppState → active` и deep link `healz://expo-sharing` при warm intent. Используется только `Sharing.getSharedPayloads()`.

`useIncomingShare()` и `getResolvedSharedPayloadsAsync()` намеренно не используются: resolver делает дополнительную неограниченную cache-копию и может перезаписать два файла с одинаковым именем.

Raw `content://` передаётся native importer. `Sharing.clearSharedPayloads()` вызывается только после завершённого native import; до этого Android URI grant ещё нужен.

### `policy.ts` и `prepareFile.ts`

`policy.ts` — чистая логика без React Native API:

- нужен ли image preparation;
- формат, quality и resize target;
- достаточно ли 10% экономии;
- помещается ли следующий файл в очередь.

`prepareFile.ts` исполняет решение:

1. Получает размеры изображения.
2. Создаёт `ImageManipulator` context.
3. При необходимости уменьшает длинную сторону.
4. Сохраняет JPEG/PNG во временный cache Expo.
5. Передаёт output native bridge.
6. Bridge переносит его в устойчивый private pending directory и удаляет temporary output.
7. При любой ошибке возвращается original fallback.

PDF и WebP возвращаются без преобразования. Файлы обрабатываются последовательно, чтобы два больших изображения не конкурировали за память.

### Review UI

`UploadReviewModal` показывает локальный preview, полное имя, размер, результат подготовки и выбор original/prepared. CTA «Подготовить файлы» только создаёт native stage: подсказка прямо сообщает, что upload ещё не начался. `PendingUploadBanner` сохраняет видимость очереди после закрытия modal и объясняет следующий user gesture.

После `consumed` banner переходит в `handedOff`, но не очищает очередь. Если карточки не появились, «Повторить» возвращает в review и позволяет stage-ить те же private files заново. «Готово» скрывает React-очередь, но намеренно не удаляет physical files: сайт может всё ещё читать `content://` после file chooser callback. Копии удалит TTL cleanup. UI никогда не вызывает отправку сообщения.

### Responsive layout

`useResponsiveLayout` получает `width`, `height` и `fontScale` через `useWindowDimensions`, а insets — через safe-area-context. Чистая `createResponsiveLayout` сначала вычисляет usable geometry, затем плавно интерполирует отступы, gaps, радиусы, preview и размер заголовка между нижней и верхней границей ширины. Поэтому изменение окна, rotation и Split View пересчитывают layout без таблицы моделей устройств.

Структурные решения остаются дискретными и зависят от доступного бюджета:

- review-panel ограничена 760 pt, readable content — 620 pt;
- карточки образуют две колонки только при content width не меньше 680 pt и `fontScale < 1.3`;
- banner, modal header и file details складываются вертикально, когда ширины с учётом крупного текста недостаточно;
- touch targets не меньше 48 pt;
- safe areas применяются со всех четырёх сторон;
- `orientation: default` разрешает portrait и landscape.

## 5. Состояния файла и очереди

```text
raw content://
     │ native bounded copy
     ▼
original / preparing
     ├─ preparation success ─► ready(original + prepared)
     ├─ not worth compressing ► fallback(original)
     └─ decode/error ─────────► fallback(original)

ready/fallback
     │ user chooses version
     ▼
staged(nonce)
     │ user opens correct chat and taps paperclip
     ▼
consumed (URI handed to WebView/site upload)
     │
     ▼
handedOff (React queue retained)
     ├─ cards absent ─► review/re-stage
     └─ user confirms «Готово» ─► hide queue; keep physical files
                                      │
                                      ▼
                                  TTL cleanup
```

`consumed` означает «URI передан file chooser callback», а не подтверждённый HTTP 200. Поэтому physical files в этот момент не удаляются.

## 6. Native storage

```text
context.filesDir/
└── healz-pending/
    └── <uuid>/
        ├── <sanitized-original-name>       # неизменные байты
        └── prepared/
            └── <sanitized-output-name>     # максимум один artifact
```

Используется `filesDir`, потому что Android может очистить обычный cache между share и завершением OTP. `android.allowBackup=false`, TTL составляет 24 часа. Cancel до handoff удаляет документы сразу; после handoff «Готово» оставляет physical files до TTL, чтобы не оборвать возможный in-flight upload.

Одинаковые исходные имена безопасны: каждый файл получает UUID-каталог. Входное имя проходит sanitization и не участвует в выборе parent directory.

### SharedPreferences handshake

Private preferences `healz_upload_bridge` содержат только версию schema, nonce, timestamp и metadata staged URI:

```json
{
  "version": 1,
  "nonce": "uuid",
  "createdAt": 0,
  "files": [
    {
      "id": "uuid",
      "uri": "content://ai.healz.mobile.HealzUploadFileProvider/...",
      "name": "analysis.pdf",
      "mimeType": "application/pdf",
      "size": 12345
    }
  ]
}
```

В preferences нет содержимого документа, email, cookie или OTP. `nonce` связывает React state с атомарным handoff.

## 7. Native module API

| Метод | Вход | Результат | Гарантии |
|---|---|---|---|
| `importSharedFiles` | raw URI + claimed MIME | valid files + per-file issues | sequential stream, magic sniff, 50 МиБ/raw и 100 МиБ/batch, unique UUID |
| `adoptPreparedFile` | UUID + Expo cache URI | prepared artifact | source только private cache, MIME сверяется с magic, один artifact |
| `stageForWebView` | выбранные queue records | nonce/count | URI принадлежит указанному UUID, own FileProvider, atomic commit |
| `getStageStatus` | nonce | none/staged/consumed | TTL и наличие physical item проверяются |
| `clearStage` | — | void | удаляет handshake, но не physical files |
| `discardFiles` | UUID[] | void | удаляет только указанные private directories |
| `cleanupExpired` | — | void | удаляет данные/handshake старше 24 часов |

Importer принимает только `content://`. После копирования остальные слои используют только canonical private paths.

## 8. Type validation и лимиты

Claimed MIME и расширение не считаются доказательством. Native importer распознаёт:

- PDF: `%PDF-`;
- JPEG: `FF D8 FF`;
- PNG: полная 8-byte signature;
- WebP: `RIFF....WEBP`;
- HEIC/HEIF: ISO BMFF `ftyp` + allowlisted brand.

GIF/TIFF/BMP/видео/аудио отклоняются. Wildcard `*/*` есть только в multiple Android intent filter, потому что смешанный PDF+image batch часто так маркируется отправителем; после входа wildcard немедленно сужается magic allowlist.

Hard limits дублируются в native и TypeScript: 10 файлов, 100 МиБ на batch, 50 МиБ на исходник для локальной подготовки и 20 МиБ на выбранный artifact при staging. Раздельные file limits важны: крупный снимок до 50 МиБ можно импортировать и уменьшить, но сайт получает только результат в пределах текущего публичного `documents.maxFileSize = 0x1400000`. Native import stream останавливается сразу после 50 МиБ, staging повторно проверяет 20 МиБ, partial file при отказе удаляется.

## 9. FileProvider

Свой `HealzUploadFileProvider`:

- `exported=false`;
- `grantUriPermissions=true`;
- authority `ai.healz.mobile.HealzUploadFileProvider`;
- XML разрешает только `filesDir/healz-pending/`, а не весь app storage.

Сайт не получает raw filesystem path. Chromium видит read-only `content://` URI после file chooser callback.

## 10. WebView handoff patch

Публичный RN WebView API не предоставляет способ заранее вернуть native-selected URI следующему HTML file input. Base64/DataTransfer расходует память, localhost bridge расширяет attack surface, а прямой multipart повторяет закрытый auth/upload API.

Поэтому pinned `patch-package` меняет только `RNCWebChromeClient.onShowFileChooser`:

1. Читает tiny JSON из private SharedPreferences.
2. Проверяет exact origin `https://app.healz.ai` и path `/app/chat` либо вложенный `/app/chat/...`.
3. Отклоняет capture flow.
4. Требует `multiple` и ровно одну из двух наблюдавшихся chooser-сигнатур: `application/pdf,image/*` или `*/*`.
5. Разрешает staged MIME только из explicit allowlist: PDF, JPEG, PNG, WebP, HEIC.
6. Проверяет exact own FileProvider authority.
7. Атомарно снимает stage и записывает consumed nonce.
8. Возвращает `Uri[]` callback.
9. При любой другой ситуации вызывает оригинальный RN WebView picker.

Текущий live chat bundle `1137-99fb558b172124ac.js` сначала рендерит multiple-input с `accept="application/pdf,image/*"`, а обработчик скрепки через 400 мс меняет тот же input на `*/*`, снимает `capture` и вызывает `click()`. Поэтому patch принимает ровно обе реально достижимые сигнатуры, но не любой произвольный chooser на странице.

Именно mutation до `*/*` ломала прежний handoff guard: он ожидал исходную пару PDF/image и не потреблял stage, когда WebChromeClient уже видел wildcard. В `1.0.1` обе наблюдавшиеся формы считаются идентичностью одного и того же composer-input при сохранении остальных security checks.

Patch pinned к `react-native-webview@13.16.1`; `postinstall` падает при несовместимом обновлении вместо тихой потери security checks.

### iOS file-input activation

На iOS `react-native-webview` оставляет file upload системному `WKWebView`: текущий `WKUIDelegate` не переопределяет iOS open panel, поэтому дополнительных entitlements или доступа к `file://` не требуется. Однако live composer вызывает `input.click()` только через 400 мс после tap, а WebKit вправе требовать синхронную user activation для file dialog.

`src/web/iosFileInputActivation.ts` генерирует iOS-only document-start shim. Capture-listener сохраняет исходный React event и срабатывает только при exact HTTPS origin, пути `/app/chat` или вложенном, trusted primary click, точных class tokens кнопки, одном hidden multiple input с наблюдавшимся accept и непосредственной DOM-связи input → trigger. Он синхронно вызывает оригинальный `HTMLInputElement.prototype.click`, после чего на 700 мс shadow-ит `click` только этого экземпляра, чтобы отложенный вызов сайта не открыл второй picker. Собственный descriptor сохраняется и восстанавливается; timer замыкается на старом node и не затрагивает новый input после React re-render. Prototype не изменяется, Android этот script не получает, а несовпадение DOM оставляет штатный handler сайта fallback-ом.

## 11. WebView и сессия

Start URL: `https://app.healz.ai/app/chat`. Неавторизованный сайт сам отвечает 307 на `/`. Вход и OTP остаются web UI.

Сохранение сессии обеспечивают штатные persistent storage платформенного WebView и `incognito=false`, `sharedCookiesEnabled`, `thirdPartyCookiesEnabled`, `domStorageEnabled`, `cacheMode=LOAD_DEFAULT`. На Android cookies хранит WebView CookieManager, на iOS — WKWebView data store. Приложение не читает HttpOnly cookies и не дублирует token в AsyncStorage/SecureStore.

URL policy:

- exact HTTPS origin Healz → внутри;
- external HTTP(S), `mailto:`, `tel:` → React Native Linking;
- `javascript:`, `data:`, `file:`, `content:`, `intent:` и malformed → block.

## 12. Security boundaries

В Git запрещены keystore и пароли, local env, cookies/OTP/tokens, реальные документы и production signing profiles.

| Риск | Мера |
|---|---|
| Чужой origin просит staged документы | exact scheme/host/path guard в native WebChromeClient |
| Другой input на том же сайте | chat path + exact observed accept-signature + multiple + no-capture checks |
| Поддельное расширение/MIME | magic-byte detection |
| Path traversal через имя/ID | UUID parse, sanitize, canonical containment |
| URI permission истекает во время OTP | немедленная bounded copy в private `filesDir` |
| Два одинаковых имени | отдельный UUID directory |
| OOM на большом batch | streaming import и последовательная image preparation |
| Незаметная порча документа | original сохраняется; PDF byte-for-byte; quality floor |
| Случайная автоотправка | реальный tap по скрепке и ручной Send |
| Backup/cleartext/storage permissions | backup off, HTTPS-only, blocked permissions |
| Утечка в логи/analytics | content/name не логируются; native analytics отсутствует |

## 13. Failure semantics

- Unsupported/ошибка одного файла не прерывает остальные элементы batch.
- Image decode/compression error или экономия <10% → original.
- Сайт offline → WebView error overlay; private queue сохраняется.
- Закрытый review → queue остаётся в banner.
- Cancel → pending UUID directories удаляются.
- WebView guard не прошёл → standard picker; stage не потребляется.
- Handoff состоялся, но карточки не появились → private queue остаётся в `handedOff`, пользователь может повторно stage-ить файлы.
- «Готово» после handoff → React queue скрывается, private files остаются доступными возможному in-flight upload до TTL cleanup.
- Process restart после native import, но до stage оставляет orphan до TTL; persisted queue index — следующий этап.

## 14. Build и CNG

Источник native configuration — `app.json`: intent filters, package/scheme, API/ABI, icon/splash, permission removals, cleartext/backup policy, `orientation: default` и iOS privacy strings камеры/фототеки. Local Expo module обнаруживается через `expo-module.config.json`, patch применяется после `npm ci`. Clean prebuild не требует ручного изменения generated project.

Текущий suite содержит 42 unit/contract-теста. Девять из них проверяют responsive-математику; VM-тесты iOS shim проверяют exact origin/path, trusted gesture, точную DOM-идентичность, синхронный вызов, подавление 400-мс дубля и descriptor-safe cleanup после React re-render.

## 15. Статус платформ

Один TypeScript/WebView-shell используется для iOS и Android. На обеих платформах предусмотрены auth/session, web-навигация, external links, responsive native overlay и штатный file picker сайта. Для iOS заданы `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, поддержка iPad и landscape.

Custom pipeline `Share → Healz` (`expo-sharing` receiver, Kotlin importer, FileProvider и WebChromeClient handoff) сейчас Android-only. Для iOS нужна отдельная Share Extension и Swift importer/provider, при этом TS policy и review UI можно переиспользовать. Локальная iOS-сборка пока заблокирована до установки компонента платформы iOS 26.5 в Xcode; это ограничение toolchain, а не отдельная кодовая база.

## 16. Расширение после MVP

1. Публичный upload-completion event — удалять physical files сразу после подтверждённой загрузки.
2. Persisted encrypted queue index — восстанавливать review после process death.
3. PDF classification в isolated process с исключением signatures/forms/encryption/text.
4. iOS Share Extension: общий TS policy/UI уже переносимы; нужен Swift importer/provider.
5. Server-advertised limits вместо консервативных client guardrails.
