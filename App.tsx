import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import HealzUploadBridge, {
  type ImportBatchResult,
} from './modules/healz-upload-bridge';
import { PendingUploadBanner } from './src/components/PendingUploadBanner';
import { UploadReviewModal } from './src/components/UploadReviewModal';
import { COLORS, HEALZ_START_URL, MAX_UPLOAD_FILE_BYTES } from './src/config';
import {
  describeIssue,
  selectedFile,
  toStageInput,
  type QueuedFile,
} from './src/files/model';
import { canAppendToQueue } from './src/files/policy';
import { prepareImportedFile } from './src/files/prepareFile';
import { useIncomingShares } from './src/share/useIncomingShares';
import { useResponsiveLayout } from './src/ui/useResponsiveLayout';
import { createIosFileInputActivationScript } from './src/web/iosFileInputActivation';
import { classifyNavigation } from './src/web/urlPolicy';

type ActiveStage = {
  nonce: string;
  count: number;
  status: 'staged' | 'handedOff';
};

const iosFileInputActivationScript = createIosFileInputActivationScript();

function HealzApp() {
  const layout = useResponsiveLayout();
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const queueRef = useRef<QueuedFile[]>([]);
  const stageRef = useRef<ActiveStage | null>(null);
  const preparationChainRef = useRef<Promise<void>>(Promise.resolve());

  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [stage, setStage] = useState<ActiveStage | null>(null);
  const [staging, setStaging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const updateQueue = useCallback((updater: (current: QueuedFile[]) => QueuedFile[]) => {
    const next = updater(queueRef.current);
    queueRef.current = next;
    setQueue(next);
  }, []);

  const updateStage = useCallback((next: ActiveStage | null) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const prepareBatch = useCallback((ids: string[]) => {
    const run = async () => {
      for (const id of ids) {
        const current = queueRef.current.find((item) => item.id === id);
        if (!current) continue;
        const result = await prepareImportedFile(current.original);
        updateQueue((items) => items.map((item) =>
          item.id === id
            ? {
                ...item,
                prepared: result.prepared,
                useOriginal: result.prepared == null,
                state: result.prepared ? 'ready' : 'fallback',
                note: result.note,
              }
            : item,
        ));
      }
    };

    const scheduled = preparationChainRef.current.then(run, run);
    preparationChainRef.current = scheduled.catch(() => undefined);
    return scheduled;
  }, [updateQueue]);

  const handleImportedBatch = useCallback((result: ImportBatchResult) => {
    const previousStage = stageRef.current;
    if (previousStage) {
      void HealzUploadBridge.clearStage();
      updateStage(null);
    }

    // Once a batch has been handed to the website, a later Android share must
    // start a fresh logical queue. The old private files stay alive until TTL
    // cleanup because the website may still be streaming their content URIs.
    if (previousStage?.status === 'handedOff') {
      queueRef.current = [];
      setQueue([]);
      setIssues([]);
    }

    const existing = queueRef.current;
    let count = existing.length;
    let totalBytes = existing.reduce((sum, item) => sum + item.original.size, 0);
    const accepted = [] as QueuedFile[];
    const rejectedIds: string[] = [];

    for (const file of result.files) {
      if (!canAppendToQueue({ currentCount: count, currentBytes: totalBytes, nextBytes: file.size })) {
        rejectedIds.push(file.id);
        continue;
      }
      accepted.push({
        id: file.id,
        original: file,
        prepared: null,
        useOriginal: true,
        state: file.mimeType.startsWith('image/') && file.mimeType !== 'image/webp'
          ? 'preparing'
          : 'fallback',
        note: null,
      });
      count += 1;
      totalBytes += file.size;
    }

    if (rejectedIds.length > 0) {
      void HealzUploadBridge.discardFiles(rejectedIds);
      setIssues((current) => [...current, 'Лишние файлы не добавлены: лимит — 10 файлов и 100 МБ на пакет.']);
    }
    if (result.issues.length > 0) {
      setIssues((current) => [...current, ...result.issues.map(describeIssue)]);
    }
    if (accepted.length > 0) {
      updateQueue((current) => [...current, ...accepted]);
      setReviewVisible(true);
      void prepareBatch(accepted.map((file) => file.id));
    } else if (result.issues.length > 0 || rejectedIds.length > 0) {
      setReviewVisible(true);
    }
  }, [prepareBatch, updateQueue, updateStage]);

  useIncomingShares({
    onBatch: handleImportedBatch,
    onError: (message) => {
      setIssues((current) => [...current, message]);
      setReviewVisible(true);
    },
  });

  useEffect(() => {
    void HealzUploadBridge.cleanupExpired();
  }, []);

  useEffect(() => {
    if (!stage || stage.status !== 'staged') return;
    let cancelled = false;
    const poll = () => {
      void HealzUploadBridge.getStageStatus(stage.nonce).then((status) => {
        const current = stageRef.current;
        if (
          cancelled
          || current?.nonce !== stage.nonce
          || current.status !== 'staged'
        ) return;
        if (status.state === 'none') {
          // Native TTL cleanup also removes the private files. Do not leave a
          // misleading "ready" banner pointing at a stage that cannot exist.
          queueRef.current = [];
          setQueue([]);
          setIssues([]);
          setReviewVisible(false);
          updateStage(null);
          setNotice('Подготовленные файлы устарели. Поделитесь ими с Healz ещё раз.');
          return;
        }
        if (status.state !== 'consumed') return;
        updateStage({ ...stage, status: 'handedOff' });
        setNotice('Файлы переданы скрепке Healz. Проверьте карточки перед отправкой сообщения.');
      }).catch(() => undefined);
    };
    poll();
    const interval = setInterval(poll, 700);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [stage, updateStage]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!reviewVisible) return;
    Keyboard.dismiss();
    webViewRef.current?.injectJavaScript(
      'if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); true;',
    );
  }, [reviewVisible]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (reviewVisible) {
        setReviewVisible(false);
        return true;
      }
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [reviewVisible]);

  const removeFile = useCallback((id: string) => {
    updateQueue((items) => items.filter((item) => item.id !== id));
    void HealzUploadBridge.discardFiles([id]);
  }, [updateQueue]);

  const cancelQueue = useCallback(() => {
    const ids = queueRef.current.map((item) => item.id);
    queueRef.current = [];
    setQueue([]);
    setIssues([]);
    setReviewVisible(false);
    updateStage(null);
    void HealzUploadBridge.discardFiles(ids);
  }, [updateStage]);

  const dismissHandedOffQueue = useCallback(() => {
    // The website may still be streaming the content URI after the chooser
    // callback. Hide the local queue, but let TTL cleanup remove physical files
    // later instead of invalidating an in-flight upload.
    queueRef.current = [];
    setQueue([]);
    setIssues([]);
    setReviewVisible(false);
    updateStage(null);
  }, [updateStage]);

  const stageFiles = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    if (queueRef.current.some((item) => item.state === 'preparing')) return;
    if (queueRef.current.some((item) => selectedFile(item).size > MAX_UPLOAD_FILE_BYTES)) {
      setIssues((current) => [
        ...current.filter((issue) => !issue.startsWith('Перед загрузкой каждый файл')),
        'Перед загрузкой каждый файл должен быть не больше 20 МБ. Выберите оптимизированную версию или уберите файл.',
      ]);
      setReviewVisible(true);
      return;
    }
    setStaging(true);
    try {
      const result = await HealzUploadBridge.stageForWebView(
        queueRef.current.map(toStageInput),
      );
      updateStage({ ...result, status: 'staged' });
      setReviewVisible(false);
      setIssues([]);
    } catch {
      setIssues((current) => [
        ...current,
        'Не удалось подготовить передачу в WebView. Файлы сохранены в очереди.',
      ]);
    } finally {
      setStaging(false);
    }
  }, [updateStage]);

  const openExternal = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {
      setNotice('Не удалось открыть внешнюю ссылку.');
    });
  }, []);

  const retry = useCallback(() => {
    setLoadError(false);
    setLoading(true);
    setWebViewKey((key) => key + 1);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'right', 'bottom', 'left']}>
      <StatusBar style="dark" />

      {queue.length > 0 ? (
        <PendingUploadBanner
          count={queue.length}
          state={stage?.status ?? 'review'}
          onOpen={() => setReviewVisible(true)}
          onCancel={stage?.status === 'handedOff' ? dismissHandedOffQueue : cancelQueue}
        />
      ) : null}

      <View style={styles.webContainer}>
        <WebView
          key={webViewKey}
          ref={webViewRef}
          source={{ uri: HEALZ_START_URL }}
          style={styles.webView}
          originWhitelist={['https://*', 'http://*', 'mailto:*', 'tel:*']}
          javaScriptEnabled
          domStorageEnabled
          incognito={false}
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          mixedContentMode="never"
          allowFileAccess={false}
          mediaPlaybackRequiresUserAction
          setSupportMultipleWindows
          applicationNameForUserAgent="HealzMobile/1.0.1"
          injectedJavaScriptBeforeContentLoaded={
            Platform.OS === 'ios' ? iosFileInputActivationScript : undefined
          }
          onLoadStart={() => {
            setLoading(true);
            setLoadError(false);
          }}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setLoadError(true);
          }}
          onNavigationStateChange={(navigation) => {
            canGoBackRef.current = navigation.canGoBack;
          }}
          onShouldStartLoadWithRequest={(request) => {
            const decision = classifyNavigation(request.url);
            if (decision === 'internal') return true;
            if (decision === 'external') openExternal(request.url);
            return false;
          }}
          onOpenWindow={({ nativeEvent }) => {
            const decision = classifyNavigation(nativeEvent.targetUrl);
            if (decision === 'external') {
              openExternal(nativeEvent.targetUrl);
            } else if (decision === 'internal') {
              webViewRef.current?.injectJavaScript(
                `window.location.href = ${JSON.stringify(nativeEvent.targetUrl)}; true;`,
              );
            }
          }}
          onRenderProcessGone={() => retry()}
        />

        {loading ? (
          <View
            style={[
              styles.loadingBar,
              {
                top: layout.spacing,
                right: layout.gutter,
                borderRadius: layout.radius,
              },
            ]}
            pointerEvents="none"
          >
            <ActivityIndicator size="small" color={COLORS.accent} />
          </View>
        ) : null}

        {loadError ? (
          <ScrollView
            style={styles.errorOverlay}
            contentContainerStyle={[
              styles.errorContent,
              { padding: layout.gutter },
            ]}
            alwaysBounceVertical={false}
          >
            <View style={{ width: layout.readableWidth }}>
              <Text
                style={[styles.errorTitle, { fontSize: layout.titleSize }]}
                accessibilityRole="alert"
              >
                Не удалось открыть Healz
              </Text>
              <Text style={styles.errorText}>Проверьте интернет-соединение. Очередь документов останется на телефоне.</Text>
              <Pressable
                style={[
                  styles.retryButton,
                  { minHeight: layout.touchTarget, borderRadius: layout.radius },
                ]}
                onPress={retry}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Повторить</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : null}
      </View>

      {notice ? (
        <View style={styles.noticeLayer} pointerEvents="box-none">
          <View
            style={[
              styles.notice,
              {
                width: layout.noticeWidth,
                bottom: layout.gutter,
                padding: layout.sectionPadding,
                borderRadius: layout.radius,
              },
            ]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        </View>
      ) : null}

      <UploadReviewModal
        visible={reviewVisible}
        files={queue}
        issues={issues}
        staging={staging}
        onClose={() => setReviewVisible(false)}
        onContinue={() => void stageFiles()}
        onRemove={removeFile}
        onUseOriginalChange={(id, useOriginal) => {
          updateQueue((items) => items.map((item) =>
            item.id === id ? { ...item, useOriginal } : item,
          ));
        }}
      />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <HealzApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  webContainer: { flex: 1, backgroundColor: COLORS.background },
  webView: { flex: 1, backgroundColor: COLORS.background },
  loadingBar: { position: 'absolute', padding: 7, backgroundColor: 'rgba(255,255,255,0.92)' },
  errorOverlay: { ...StyleSheet.absoluteFill, backgroundColor: COLORS.background },
  errorContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  errorTitle: { color: COLORS.heading, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorText: { color: COLORS.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  retryButton: { alignSelf: 'center', marginTop: 20, minWidth: 140, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 10, backgroundColor: COLORS.accent },
  retryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  noticeLayer: { ...StyleSheet.absoluteFill, alignItems: 'center' },
  notice: { position: 'absolute', backgroundColor: '#23382F' },
  noticeText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
