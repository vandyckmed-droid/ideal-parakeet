import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors } from '../theme/ThemeProvider';
import { radius, space, type } from '../theme/theme';

type Props = {
  title: string;
  children: string;
};

/**
 * A small circled "i" that opens a short explanation on tap. For a stat whose
 * name alone doesn't say what question it answers - "2.43x" means nothing
 * without the sentence next to it, and that sentence is too long to fit
 * inline next to every figure on a card already showing three others.
 */
export function InfoButton({ title, children }: Props) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        style={[styles.circle, { borderColor: colors.textFaint }]}
        accessibilityRole="button"
        accessibilityLabel={`About ${title}`}
      >
        <Text style={[type.micro, { color: colors.textFaint }]}>i</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={[styles.scrim, { backgroundColor: colors.scrim }]}
          onPress={() => setOpen(false)}
        />
        <View style={styles.centerWrap} pointerEvents="box-none">
          <View style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            <Text style={[type.heading, { color: colors.text }]}>{title}</Text>
            <Text style={[type.body, { color: colors.textMuted, marginTop: space(2) }]}>
              {children}
            </Text>
            <Pressable
              onPress={() => setOpen(false)}
              style={[styles.closeButton, { backgroundColor: colors.surface }]}
              accessibilityRole="button"
            >
              <Text style={[type.bodyStrong, { color: colors.text }]}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  circle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space(8),
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space(5),
  },
  closeButton: {
    marginTop: space(4),
    paddingVertical: space(3),
    borderRadius: radius.md,
    alignItems: 'center',
  },
});
