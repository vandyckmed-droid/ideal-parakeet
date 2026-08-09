// Mirrors src/components/SectorPicker.tsx - if these two ever disagree, the
// .tsx file is the one that is wrong.
//
// The sector filter, as a single-select sheet rather than a row of pills.
// Eleven sectors plus "All" made the old horizontal chip rail a wide strip of
// mostly-off-screen buttons - the very thing the rest of the header had
// already moved away from. One tap opens this, one more tap picks a sector
// and closes it; there is no separate Apply, unlike the window picker, since
// nothing here needs two coordinated choices before either is meaningful.

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useColors, radius, space, type } from './theme';

const ROW_HEIGHT = 48;

export function SectorPicker({ visible, sectors, sector, onClose, onSelect }) {
  const colors = useColors();
  const options = [null, ...sectors];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[s.scrim, { backgroundColor: colors.scrim }]} onPress={onClose} />
      <View style={[s.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <View style={[s.grabber, { backgroundColor: colors.border }]} />
        <Text style={[type.title, { color: colors.text, marginBottom: space(3) }]}>Sector</Text>

        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {options.map((opt) => {
            const chosen = opt === sector;
            return (
              <Pressable
                key={opt || 'all'}
                onPress={() => {
                  onSelect(opt);
                  onClose();
                }}
                style={[s.row, { backgroundColor: chosen ? colors.accentMuted : 'transparent' }]}
                accessibilityRole="button"
                accessibilityState={{ selected: chosen }}
              >
                <Text
                  style={[
                    type.body,
                    { color: chosen ? colors.accent : colors.text, fontWeight: chosen ? '700' : '400' },
                  ]}
                >
                  {opt || 'All sectors'}
                </Text>
                {chosen && <Text style={{ color: colors.accent, fontSize: 16 }}>✓</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '80%',
    borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(4), paddingTop: space(2), paddingBottom: space(8),
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space(3) },
  list: { flexGrow: 0 },
  row: {
    height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: space(3), borderRadius: radius.sm,
  },
});
