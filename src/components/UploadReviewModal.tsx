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

import { COLORS } from '../config';
import { formatBytes, selectedFile, type QueuedFile } from '../files/model';

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

function FilePreview({ item }: { item: QueuedFile }) {
  if (!item.original.mimeType.startsWith('image/')) {
    return (
      <View style={styles.pdfPreview} accessibilityLabel="PDF">
        <Text style={styles.pdfLabel}>PDF</Text>
      </View>
    );
  }

  return <Image source={{ uri: item.original.uri }} style={styles.previewImage} />;
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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Документы для Healz</Text>
            <Text style={styles.subtitle}>Проверка и подготовка выполняются только на телефоне.</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={styles.close}>Скрыть</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {issues.map((issue, index) => (
            <View key={`${issue}-${index}`} style={styles.issueBox}>
              <Text style={styles.issueText}>{issue}</Text>
            </View>
          ))}

          {files.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>Подходящих файлов нет</Text>
              <Text style={styles.emptyText}>Поделитесь PDF или изображением из почты, Файлов или галереи.</Text>
            </View>
          ) : null}

          {files.map((item) => {
            const chosen = selectedFile(item);
            return (
              <View key={item.id} style={styles.fileCard}>
                <View style={styles.fileTopRow}>
                  <FilePreview item={item} />
                  <View style={styles.fileCopy}>
                    <Text style={styles.fileName} numberOfLines={2}>{item.original.name}</Text>
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
                      style={[styles.choice, !item.useOriginal && styles.choiceActive]}
                      onPress={() => onUseOriginalChange(item.id, false)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: !item.useOriginal }}
                    >
                      <Text style={[styles.choiceText, !item.useOriginal && styles.choiceTextActive]}>
                        Оптимизированный · {formatBytes(item.prepared.size)}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.choice, item.useOriginal && styles.choiceActive]}
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

                <Pressable onPress={() => onRemove(item.id)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.remove}>Убрать из очереди</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footerHint}>
            Дальше выберите нужные кейс и чат в Healz, затем нажмите скрепку.
          </Text>
          <Pressable
            style={[
              styles.primaryButton,
              (files.length === 0 || hasPreparingFiles || staging) && styles.primaryButtonDisabled,
            ]}
            disabled={files.length === 0 || hasPreparingFiles || staging}
            onPress={onContinue}
            accessibilityRole="button"
          >
            {staging ? <ActivityIndicator color="#FFFFFF" /> : (
              <Text style={styles.primaryButtonText}>Выбрать кейс и чат</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  headerCopy: { flex: 1 },
  title: { color: COLORS.heading, fontSize: 22, lineHeight: 27, fontWeight: '700' },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  close: { color: COLORS.accent, fontSize: 15, fontWeight: '600', paddingTop: 4 },
  content: { padding: 16, gap: 12 },
  issueBox: { borderRadius: 12, padding: 12, backgroundColor: '#FBECEF' },
  issueText: { color: COLORS.danger, fontSize: 13, lineHeight: 18 },
  emptyBox: { alignItems: 'center', padding: 28, borderRadius: 16, backgroundColor: COLORS.surface },
  emptyTitle: { color: COLORS.heading, fontSize: 17, fontWeight: '700' },
  emptyText: { color: COLORS.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  fileCard: { padding: 14, borderRadius: 16, backgroundColor: COLORS.surface, gap: 12 },
  fileTopRow: { flexDirection: 'row', gap: 12 },
  previewImage: { width: 64, height: 80, borderRadius: 10, backgroundColor: COLORS.surfaceWarm, resizeMode: 'cover' },
  pdfPreview: { width: 64, height: 80, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBECEF' },
  pdfLabel: { color: COLORS.danger, fontSize: 15, fontWeight: '800' },
  fileCopy: { flex: 1, minWidth: 0 },
  fileName: { color: COLORS.heading, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  fileMeta: { color: COLORS.text, fontSize: 13, marginTop: 5 },
  note: { color: COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 5 },
  processingRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 7 },
  processingText: { color: COLORS.accent, fontSize: 12 },
  choiceRow: { gap: 8 },
  choice: { paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10 },
  choiceActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  choiceText: { color: COLORS.text, fontSize: 13 },
  choiceTextActive: { color: '#6E317F', fontWeight: '600' },
  remove: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },
  footer: { padding: 16, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, backgroundColor: COLORS.surface },
  footerHint: { color: COLORS.muted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  primaryButton: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.accent },
  primaryButtonDisabled: { opacity: 0.45 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
