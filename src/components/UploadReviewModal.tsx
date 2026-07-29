import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, MAX_UPLOAD_FILE_BYTES } from '../config';
import { formatBytes, selectedFile, type QueuedFile } from '../files/model';
import { useResponsiveLayout } from '../ui/useResponsiveLayout';

type Props = {
  visible: boolean;
  files: QueuedFile[];
  issues: string[];
  staging: boolean;
  onClose: () => void;
  onContinue: () => void;
  onRemove: (id: string) => void;
  onUseOriginalChange: (id: string, useOriginal: boolean) => void;
};

function FilePreview({
  item,
  width,
  height,
}: {
  item: QueuedFile;
  width: number;
  height: number;
}) {
  const previewStyle = { width, height, borderRadius: Math.min(12, width * 0.16) };

  if (!item.original.mimeType.startsWith('image/')) {
    return (
      <View style={[styles.pdfPreview, previewStyle]} accessibilityLabel="PDF">
        <Text style={styles.pdfLabel}>PDF</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: item.original.uri }}
      style={[styles.previewImage, previewStyle]}
      resizeMode="cover"
      accessibilityLabel={`Предпросмотр ${item.original.name}`}
    />
  );
}

export function UploadReviewModal({
  visible,
  files,
  issues,
  staging,
  onClose,
  onContinue,
  onRemove,
  onUseOriginalChange,
}: Props) {
  const hasPreparingFiles = files.some((file) => file.state === 'preparing');
  const hasOversizedSelection = files.some(
    (file) => selectedFile(file).size > MAX_UPLOAD_FILE_BYTES,
  );
  const isContinueDisabled = files.length === 0
    || hasPreparingFiles
    || hasOversizedSelection
    || staging;
  const layout = useResponsiveLayout();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea} edges={['top', 'right', 'bottom', 'left']}>
        <View style={[styles.panel, { maxWidth: layout.modalMaxWidth }]}>
          <View
            style={[
              styles.header,
              {
                gap: layout.spacing,
                paddingHorizontal: layout.gutter,
                paddingVertical: layout.sectionPadding,
              },
              layout.stackModalHeader && styles.headerStacked,
            ]}
          >
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { fontSize: layout.titleSize }]}>Документы для Healz</Text>
              <Text style={styles.subtitle}>Проверка и подготовка выполняются только на телефоне.</Text>
            </View>
            <Pressable
              onPress={onClose}
              style={[
                styles.closeButton,
                { minHeight: layout.touchTarget },
                layout.stackModalHeader && styles.closeButtonStacked,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.close}>Скрыть</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[
              styles.content,
              {
                gap: layout.spacing,
                paddingHorizontal: layout.gutter,
                paddingVertical: layout.sectionPadding,
              },
            ]}
          >
            {issues.map((issue, index) => (
              <View
                key={`${issue}-${index}`}
                style={[styles.issueBox, { borderRadius: layout.radius }]}
              >
                <Text style={styles.issueText}>{issue}</Text>
              </View>
            ))}

            {files.length === 0 ? (
              <View
                style={[
                  styles.emptyBox,
                  {
                    borderRadius: layout.radius,
                    padding: layout.cardPadding * 2,
                  },
                ]}
              >
                <Text style={styles.emptyTitle}>Подходящих файлов нет</Text>
                <Text style={styles.emptyText}>Поделитесь PDF или изображением из почты, Файлов или галереи.</Text>
              </View>
            ) : null}

            <View style={[styles.fileGrid, { gap: layout.spacing }]}>
              {files.map((item) => {
                const chosen = selectedFile(item);
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.fileCard,
                      {
                        width: layout.fileCardWidth,
                        padding: layout.cardPadding,
                        borderRadius: layout.radius,
                        gap: layout.spacing,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.fileTopRow,
                        { gap: layout.spacing },
                        layout.stackFileDetails && styles.fileTopRowStacked,
                      ]}
                    >
                      <FilePreview
                        item={item}
                        width={layout.previewWidth}
                        height={layout.previewHeight}
                      />
                      <View style={styles.fileCopy}>
                        <Text style={styles.fileName}>{item.original.name}</Text>
                        <Text style={styles.fileMeta}>
                          {item.prepared && !item.useOriginal
                            ? `${formatBytes(item.original.size)} → ${formatBytes(item.prepared.size)}`
                            : formatBytes(chosen.size)}
                        </Text>
                        {item.state === 'preparing' ? (
                          <View style={styles.processingRow}>
                            <ActivityIndicator size="small" color={COLORS.accent} />
                            <Text style={styles.processingText}>Аккуратно уменьшаем…</Text>
                          </View>
                        ) : (
                          <Text style={styles.note}>{item.note}</Text>
                        )}
                      </View>
                    </View>

                    {item.prepared ? (
                      <View style={styles.choiceRow}>
                        <Pressable
                          style={[
                            styles.choice,
                            { minHeight: layout.touchTarget },
                            !item.useOriginal && styles.choiceActive,
                          ]}
                          onPress={() => onUseOriginalChange(item.id, false)}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: !item.useOriginal }}
                        >
                          <Text style={[styles.choiceText, !item.useOriginal && styles.choiceTextActive]}>
                            Оптимизированный · {formatBytes(item.prepared.size)}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[
                            styles.choice,
                            { minHeight: layout.touchTarget },
                            item.useOriginal && styles.choiceActive,
                          ]}
                          onPress={() => onUseOriginalChange(item.id, true)}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: item.useOriginal }}
                        >
                          <Text style={[styles.choiceText, item.useOriginal && styles.choiceTextActive]}>
                            Оригинал · {formatBytes(item.original.size)}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}

                    <Pressable
                      onPress={() => onRemove(item.id)}
                      style={[styles.removeButton, { minHeight: layout.touchTarget }]}
                      accessibilityRole="button"
                    >
                      <Text style={styles.remove}>Убрать из очереди</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View
            style={[
              styles.footer,
              {
                gap: layout.spacing,
                paddingHorizontal: layout.gutter,
                paddingVertical: layout.sectionPadding,
              },
            ]}
          >
            <Text style={styles.footerHint}>
              {hasOversizedSelection
                ? 'Выбранный вариант больше 20 МБ. Выберите оптимизированную версию или уберите файл.'
                : 'Загрузка ещё не началась. После подготовки откройте нужный чат и нажмите скрепку.'}
            </Text>
            <Pressable
              style={[
                styles.primaryButton,
                { minHeight: Math.max(52, layout.touchTarget) },
                isContinueDisabled && styles.primaryButtonDisabled,
              ]}
              disabled={isContinueDisabled}
              onPress={onContinue}
              accessibilityRole="button"
            >
              {staging ? <ActivityIndicator color="#FFFFFF" /> : (
                <Text style={styles.primaryButtonText}>Подготовить файлы</Text>
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, alignItems: 'center', backgroundColor: COLORS.background },
  panel: { flex: 1, width: '100%', backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerStacked: { flexDirection: 'column' },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: COLORS.heading, lineHeight: 29, fontWeight: '700' },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  closeButton: { justifyContent: 'center', paddingHorizontal: 4 },
  closeButtonStacked: { alignSelf: 'flex-start' },
  close: { color: COLORS.accent, fontSize: 15, fontWeight: '600' },
  scrollView: { flex: 1 },
  content: { flexGrow: 1 },
  issueBox: { borderRadius: 12, padding: 12, backgroundColor: '#FBECEF' },
  issueText: { color: COLORS.danger, fontSize: 13, lineHeight: 18 },
  emptyBox: { alignItems: 'center', backgroundColor: COLORS.surface },
  emptyTitle: { color: COLORS.heading, fontSize: 17, fontWeight: '700' },
  emptyText: { color: COLORS.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  fileGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  fileCard: { backgroundColor: COLORS.surface },
  fileTopRow: { flexDirection: 'row' },
  fileTopRowStacked: { flexDirection: 'column' },
  previewImage: { backgroundColor: COLORS.surfaceWarm },
  pdfPreview: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBECEF' },
  pdfLabel: { color: COLORS.danger, fontSize: 15, fontWeight: '800' },
  fileCopy: { flex: 1, minWidth: 0 },
  fileName: { color: COLORS.heading, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  fileMeta: { color: COLORS.text, fontSize: 13, marginTop: 5 },
  note: { color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  processingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  processingText: { color: COLORS.accent, fontSize: 12 },
  choiceRow: { gap: 8 },
  choice: { justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10 },
  choiceActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  choiceText: { color: COLORS.text, fontSize: 13 },
  choiceTextActive: { color: '#6E317F', fontWeight: '600' },
  removeButton: { alignSelf: 'flex-start', justifyContent: 'center' },
  remove: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, backgroundColor: COLORS.surface },
  footerHint: { color: COLORS.muted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  primaryButton: { borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.accent },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
