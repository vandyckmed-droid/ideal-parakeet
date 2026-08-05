import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DATES, LAST_INDEX, formatDate } from '../data/market';
import { DateWindow, describeWindow } from '../data/windows';
import { useColors } from '../theme/ThemeProvider';
import { mono, radius, space, type } from '../theme/theme';

const ITEM_HEIGHT = 44;

/**
 * Start and stop day are chosen from the trading calendar itself rather than a
 * generic date wheel. A weekend or a market holiday is not a selectable answer
 * here, so offering one would only produce a silent snap to a neighbouring
 * session and leave the header showing a date the numbers do not come from.
 */
export function WindowPicker({
  visible,
  window: win,
  onClose,
  onApply,
}: {
  visible: boolean;
  window: DateWindow;
  onClose: () => void;
  onApply: (startIndex: number, endIndex: number) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [start, setStart] = useState(win.startIndex);
  const [end, setEnd] = useState(win.endIndex);
  const [editing, setEditing] = useState<'start' | 'end'>('start');
  const listRef = useRef<FlatList<string>>(null);

  // Re-seed each time the sheet opens so it always reflects the live window.
  useEffect(() => {
    if (visible) {
      setStart(win.startIndex);
      setEnd(win.endIndex);
      setEditing('start');
    }
  }, [visible, win.startIndex, win.endIndex]);

  const selectedIndex = editing === 'start' ? start : end;

  useEffect(() => {
    if (!visible) return;
    // Defer past the modal's mount so the list has measured before scrolling.
    const t = setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: selectedIndex,
        animated: false,
        viewPosition: 0.5,
      });
    }, 60);
    return () => clearTimeout(t);
  }, [visible, editing, selectedIndex]);

  const preview: DateWindow = useMemo(
    () => ({
      startIndex: Math.min(start, end),
      endIndex: Math.max(start, end),
      preset: 'CUSTOM',
    }),
    [start, end]
  );

  const valid = preview.endIndex > preview.startIndex;

  const handleSelect = (index: number) => {
    if (editing === 'start') {
      setStart(index);
      // Advancing the start past the stop would leave an inverted window; move
      // the stop along rather than rejecting the tap.
      if (index >= end) setEnd(Math.min(LAST_INDEX, index + 1));
      setEditing('end');
    } else {
      setEnd(index);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
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
        <Text style={[type.title, { color: colors.text, marginBottom: space(1) }]}>
          Custom window
        </Text>
        <Text style={[type.caption, { color: colors.textMuted, marginBottom: space(4) }]}>
          {valid ? describeWindow(preview) : 'Stop day must follow the start day'}
        </Text>

        <View style={styles.endpoints}>
          {(['start', 'end'] as const).map((which) => {
            const active = editing === which;
            const idx = which === 'start' ? start : end;
            return (
              <Pressable
                key={which}
                onPress={() => setEditing(which)}
                style={[
                  styles.endpoint,
                  {
                    backgroundColor: active ? colors.accentMuted : colors.surface,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text style={[type.micro, { color: colors.textMuted }]}>
                  {which === 'start' ? 'START DAY' : 'STOP DAY'}
                </Text>
                <Text style={[type.bodyStrong, mono, { color: colors.text }]}>
                  {formatDate(DATES[idx])}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FlatList
          ref={listRef}
          data={DATES}
          keyExtractor={(d) => d}
          style={styles.list}
          getItemLayout={(_, index) => ({
            length: ITEM_HEIGHT,
            offset: ITEM_HEIGHT * index,
            index,
          })}
          // A failed measurement should not strand the user at the top of a
          // 500-row list; retry once the layout settles.
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex({
                index: info.index,
                animated: false,
                viewPosition: 0.5,
              });
            }, 80);
          }}
          renderItem={({ item, index }) => {
            const chosen = index === selectedIndex;
            const inRange = index >= preview.startIndex && index <= preview.endIndex;
            return (
              <Pressable
                onPress={() => handleSelect(index)}
                style={[
                  styles.dateRow,
                  {
                    backgroundColor: chosen
                      ? colors.accent
                      : inRange
                        ? colors.surface
                        : 'transparent',
                  },
                ]}
              >
                <Text
                  style={[
                    type.body,
                    mono,
                    { color: chosen ? colors.bg : colors.text },
                  ]}
                >
                  {formatDate(item)}
                </Text>
              </Pressable>
            );
          }}
        />

        <View style={styles.actions}>
          <Pressable
            onPress={onClose}
            style={[styles.button, { backgroundColor: colors.surface }]}
          >
            <Text style={[type.bodyStrong, { color: colors.text }]}>Cancel</Text>
          </Pressable>
          <Pressable
            disabled={!valid}
            onPress={() => {
              onApply(preview.startIndex, preview.endIndex);
              onClose();
            }}
            style={[
              styles.button,
              { backgroundColor: colors.accent, opacity: valid ? 1 : 0.4 },
            ]}
          >
            <Text style={[type.bodyStrong, { color: colors.bg }]}>Apply</Text>
          </Pressable>
        </View>
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
    maxHeight: '88%',
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(4),
    paddingTop: space(2),
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: space(3),
  },
  endpoints: { flexDirection: 'row', gap: space(2), marginBottom: space(3) },
  endpoint: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space(3),
    gap: space(1),
  },
  list: { flexGrow: 0, height: 260 },
  dateRow: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space(3),
    borderRadius: radius.sm,
  },
  actions: { flexDirection: 'row', gap: space(2), marginTop: space(3) },
  button: {
    flex: 1,
    paddingVertical: space(3.5),
    borderRadius: radius.md,
    alignItems: 'center',
  },
});
