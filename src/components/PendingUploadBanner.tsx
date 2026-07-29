import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '../config';
import { useResponsiveLayout } from '../ui/useResponsiveLayout';

type Props = {
  count: number;
  state: 'review' | 'staged' | 'handedOff';
  onOpen: () => void;
  onCancel: () => void;
};

export function PendingUploadBanner({ count, state, onOpen, onCancel }: Props) {
  const layout = useResponsiveLayout();
  const isReady = state === 'staged';
  const isHandedOff = state === 'handedOff';

  return (
    <View
      style={[
        styles.container,
        {
          gap: layout.spacing,
          paddingHorizontal: layout.gutter,
          paddingVertical: layout.sectionPadding / 2,
        },
        layout.stackBanner && styles.containerStacked,
      ]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>
          {isHandedOff
            ? `${count} файл${count === 1 ? '' : 'а'} передано в чат`
            : isReady
              ? `${count} файл${count === 1 ? '' : 'а'} готово`
              : `${count} документ${count === 1 ? '' : 'а'} ждёт проверки`}
        </Text>
        <Text style={styles.subtitle}>
          {isHandedOff
            ? 'Проверьте карточки. Если их нет, подготовьте файлы повторно.'
            : isReady
              ? 'Выберите кейс и чат, затем нажмите скрепку на сайте.'
              : 'Откройте очередь перед добавлением в Healz.'}
        </Text>
      </View>
      <View
        style={[
          styles.actions,
          layout.stackBanner && styles.actionsStacked,
        ]}
      >
        {!isReady ? (
          <Pressable
            onPress={onOpen}
            style={[styles.action, { minHeight: layout.touchTarget }]}
            accessibilityRole="button"
          >
            <Text style={styles.actionText}>{isHandedOff ? 'Повторить' : 'Проверить'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onCancel}
          style={[styles.cancelButton, { minHeight: layout.touchTarget }]}
          accessibilityRole="button"
        >
          <Text style={styles.cancel}>{isHandedOff ? 'Готово' : 'Отмена'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.accentSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D8B4E0',
  },
  containerStacked: { flexDirection: 'column', alignItems: 'stretch' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: COLORS.heading, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  subtitle: { color: COLORS.text, fontSize: 11, lineHeight: 15, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionsStacked: { alignSelf: 'stretch', justifyContent: 'flex-end' },
  action: { paddingHorizontal: 12, justifyContent: 'center', borderRadius: 9, backgroundColor: COLORS.accent },
  actionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  cancelButton: { paddingHorizontal: 8, justifyContent: 'center' },
  cancel: { color: COLORS.danger, fontSize: 12, fontWeight: '600' },
});
