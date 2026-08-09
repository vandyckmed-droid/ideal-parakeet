import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '../theme/ThemeProvider';
import { radius, space, type } from '../theme/theme';

const ROW_HEIGHT = 48;

export type Option = { key: string; label: string; caption?: string };

/**
 * One single-select sheet, used by every "pick one of a short list" control
 * in the header - the sector filter and the number of groups.
 *
 * One tap opens it, one more picks and closes; there is no separate Apply,
 * because unlike the window picker nothing here needs two coordinated choices
 * before either one is meaningful.
 */
export function OptionSheet({
  visible,
  title,
  options,
  selected,
  footnote,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  options: Option[];
  selected: string;
  /** Optional line under the title, for stating what the choice actually does. */
  footnote?: string;
  onClose: () => void;
  onSelect: (key: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: colors.scrim }]} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.bg,
            borderColor: colors.border,
            paddingBottom: insets.bottom + space(3),
          },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        <Text style={[type.title, { color: colors.text }]}>{title}</Text>
        {footnote ? (
          <Text style={[type.caption, { color: colors.textMuted, marginTop: space(1) }]}>
            {footnote}
          </Text>
        ) : null}

        <ScrollView style={[styles.list, { marginTop: space(3) }]} showsVerticalScrollIndicator={false}>
          {options.map((opt) => {
            const chosen = opt.key === selected;
            return (
              <Pressable
                key={opt.key}
                onPress={() => {
                  onSelect(opt.key);
                  onClose();
                }}
                style={[styles.row, { backgroundColor: chosen ? colors.accentMuted : 'transparent' }]}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
              >
                <View style={styles.rowText}>
                  <Text
                    style={[
                      type.body,
                      { color: chosen ? colors.accent : colors.text, fontWeight: chosen ? '700' : '400' },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {opt.caption ? (
                    <Text style={[type.micro, { color: colors.textFaint }]}>{opt.caption}</Text>
                  ) : null}
                </View>
                {chosen && <Text style={{ color: colors.accent, fontSize: 16 }}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(4),
    paddingTop: space(2),
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space(3) },
  list: { flexGrow: 0 },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.sm,
  },
  rowText: { flex: 1, gap: 1 },
});
