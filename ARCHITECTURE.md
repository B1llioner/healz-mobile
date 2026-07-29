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
| Share receiver | `expo-sharing` 57.0.7 | Android `ACTION_SEND(_MULTIPLE)` lifecycle |
| Image preparation | `expo-image-manipulator` 57.0.6 | resize/HEIC conversion на устройстве |
| Native I/O | local Expo Kotlin module | bounded streaming copy, validation, FileProvider, staging |
| Android | API 36 / min 26 / arm64-v8a | устанавливаемый APK для современных телефонов |

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

Сгенерированные `android/` и `ios/` не являются источниками истины и исключены из Git. `npx expo prebuild` воспроизводит Android-проект из `app.json`, local module и npm packages.

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
- отслеживает handoff по `nonce`;
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

`UploadReviewModal` показывает локальный preview, имя, размер, результат подготовки и выбор original/prepared. `PendingUploadBanner` сохраняет видимость очереди после закрытия modal и объясняет следующий user gesture.

UI никогда не вызывает отправку сообщения. CTA только stage-ит документы и возвращает пользователя в web-flow.

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
consumed/handed-off
     │ WebView/site owns upload UI
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

Используется `filesDir`, потому что Android может очистить обычный cache между share и завершением OTP. `android.allowBackup=false`, TTL составляет 24 часа, а Cancel удаляет документы сразу.

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
| `importSharedFiles` | raw URI + claimed MIME | valid files + per-file issues | sequential stream, magic sniff, 50/100 МБ, unique UUID |
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

Hard limits дублируются в native и TypeScript: 10 файлов, 50 МБ на один и 100 МБ на batch. Native stream останавливается сразу после превышения, partial file удаляется.

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
2. Проверяет `https`, exact host `app.healz.ai`, path `/app/chat`.
3. Отклоняет capture flow.
4. Проверяет `acceptTypes`, MIME каждого файла и `multiple`.
5. Проверяет exact own FileProvider authority.
6. Атомарно снимает stage и записывает consumed nonce.
7. Возвращает `Uri[]` callback.
8. При любой другой ситуации вызывает оригинальный RN WebView picker.

Patch pinned к `react-native-webview@13.16.1`; `postinstall` падает при несовместимом обновлении вместо тихой потери security checks.

## 11. WebView и сессия

Start URL: `https://app.healz.ai/app/chat`. Неавторизованный сайт сам отвечает 307 на `/`. Вход и OTP остаются web UI.

Сохранение сессии обеспечивают Android WebView CookieManager и `incognito=false`, `sharedCookiesEnabled`, `thirdPartyCookiesEnabled`, `domStorageEnabled`, `cacheMode=LOAD_DEFAULT`. Приложение не читает HttpOnly cookies и не дублирует token в AsyncStorage/SecureStore.

URL policy:

- exact HTTPS origin Healz → внутри;
- external HTTP(S), `mailto:`, `tel:` → Android Linking;
- `javascript:`, `data:`, `file:`, `content:`, `intent:` и malformed → block.

## 12. Security boundaries

В Git запрещены keystore и пароли, local env, cookies/OTP/tokens, реальные документы и production signing profiles.

| Риск | Мера |
|---|---|
| Чужой origin просит staged документы | exact scheme/host/path guard в native WebChromeClient |
| Другой input на том же сайте | chat path + document acceptTypes + multiple checks |
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
- Process restart после native import, но до stage оставляет orphan до TTL; persisted queue index — следующий этап.

## 14. Build и CNG

Источник native configuration — `app.json`: intent filters, package/scheme, API/ABI, icon/splash, permission removals, cleartext/backup policy. Local Expo module обнаруживается через `expo-module.config.json`, patch применяется после `npm ci`. Clean Android build не требует ручного изменения generated project.

## 15. Расширение после MVP

1. Публичный upload-completion event — удалять physical files сразу после подтверждённой загрузки.
2. Persisted encrypted queue index — восстанавливать review после process death.
3. PDF classification в isolated process с исключением signatures/forms/encryption/text.
4. iOS Share Extension: общий TS policy/UI уже переносимы; нужен Swift importer/provider.
5. Server-advertised limits вместо консервативных client guardrails.
