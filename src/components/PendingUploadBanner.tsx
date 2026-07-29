import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLORS } from '../config';

type Props = {
  count: number;
  staged: boolean;
  onOpen: () => void;
  onCancel: () => void;
};

export function PendingUploadBanner({ count, staged, onOpen, onCancel }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.copy}>
        <Text style={styles.title}>
          {staged ? `${count} файл${count === 1 ? '' : 'а'} готово` : `${count} документ${count === 1 ? '' : 'а'} ждёт проверки`}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {staged
            ? 'Выберите кейс и чат, затем нажмите скрепку на сайте.'
            : 'Откройте очередь перед добавлением в Healz.'}
        </Text>
      </View>
      {!staged ? (
        <Pressable onPress={onOpen} style={styles.action} accessibilityRole="button">
          <Text style={styles.actionText}>Проверить</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
        <Text style={styles.cancel}>Отмена</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.accentSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D8B4E0',
  },
  copy: { flex: 1 },
  title: { color: COLORS.heading, fontSize: 13, fontWeight: '700' },
  subtitle: { color: COLORS.text, fontSize: 11, lineHeight: 15, marginTop: 2 },
  action: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: COLORS.accent },
  actionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  cancel: { color: COLORS.danger, fontSize: 12, fontWeight: '600' },
});
