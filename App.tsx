import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import HealzUploadBridge, {
  type ImportBatchResult,
} from './modules/healz-upload-bridge';
import { PendingUploadBanner } from './src/components/PendingUploadBanner';
import { UploadReviewModal } from './src/components/UploadReviewModal';
import { COLORS, HEALZ_START_URL } from './src/config';
import { describeIssue, toStageInput, type QueuedFile } from './src/files/model';
import { canAppendToQueue } from './src/files/policy';
import { prepareImportedFile } from './src/files/prepareFile';
import { useIncomingShares } from './src/share/useIncomingShares';
import { classifyNavigation } from './src/web/urlPolicy';

type ActiveStage = { nonce: string; count: number };

function HealzApp() {
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
    if (stageRef.current) {
      void HealzUploadBridge.clearStage();
      updateStage(null);
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
    if (!stage) return;
    const interval = setInterval(() => {
      void HealzUploadBridge.getStageStatus(stage.nonce).then((status) => {
        if (status.state !== 'consumed') return;
        updateStage(null);
        queueRef.current = [];
        setQueue([]);
        setIssues([]);
        setNotice('Файлы переданы в Healz. Проверьте карточки в сообщении перед отправкой.');
      });
    }, 700);
    return () => clearInterval(interval);
  }, [stage, updateStage]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);

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

  const stageFiles = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    if (queueRef.current.some((item) => item.state === 'preparing')) return;
    setStaging(true);
    try {
      const result = await HealzUploadBridge.stageForWebView(
        queueRef.current.map(toStageInput),
      );
      updateStage(result);
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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <StatusBar style="dark" />

      {queue.length > 0 ? (
        <PendingUploadBanner
          count={queue.length}
          staged={stage != null}
          onOpen={() => setReviewVisible(true)}
          onCancel={cancelQueue}
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
          applicationNameForUserAgent="HealzMobile/1.0"
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
          <View style={styles.loadingBar} pointerEvents="none">
            <ActivityIndicator size="small" color={COLORS.accent} />
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.errorOverlay}>
            <Text style={styles.errorTitle}>Не удалось открыть Healz</Text>
            <Text style={styles.errorText}>Проверьте интернет-соединение. Очередь документов останется на телефоне.</Text>
            <Pressable style={styles.retryButton} onPress={retry} accessibilityRole="button">
              <Text style={styles.retryText}>Повторить</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
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
    <SafeAreaProvider>
      <HealzApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  webContainer: { flex: 1, backgroundColor: COLORS.background },
  webView: { flex: 1, backgroundColor: COLORS.background },
  loadingBar: { position: 'absolute', top: 10, right: 12, borderRadius: 20, padding: 7, backgroundColor: 'rgba(255,255,255,0.92)' },
  errorOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: COLORS.background },
  errorTitle: { color: COLORS.heading, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  errorText: { color: COLORS.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  retryButton: { marginTop: 20, minWidth: 140, alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13, borderRadius: 12, backgroundColor: COLORS.accent },
  retryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  notice: { position: 'absolute', left: 14, right: 14, bottom: Platform.OS === 'android' ? 18 : 26, padding: 13, borderRadius: 12, backgroundColor: '#23382F' },
  noticeText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
