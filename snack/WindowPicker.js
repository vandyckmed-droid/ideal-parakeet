import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColors, mono, radius, space, type } from './theme';
import { describeWindow, formatDate } from './stats';

const ITEM_HEIGHT = 44;

/**
 * Start and stop day are picked from the trading calendar itself. A weekend or
 * a market holiday is not a selectable answer here, so offering one would only
 * produce a silent snap to a neighbouring session and leave the header showing
 * a date the numbers do not come from.
 */
export function WindowPicker({ visible, window: win, dates, onClose, onApply }) {
  const colors = useColors();
  const last = dates.length - 1;

  const [start, setStart] = useState(win.startIndex);
  const [end, setEnd] = useState(win.endIndex);
  const [editing, setEditing] = useState('start');
  const listRef = useRef(null);

  useEffect(() => {
    if (visible) {
      setStart(win.startIndex);
      setEnd(win.endIndex);
      setEditing('start');
    }
  }, [visible, win.startIndex, win.endIndex]);

  const selected = editing === 'start' ? start : end;

  useEffect(() => {
    if (!visible) return;
    // Defer past the modal's mount so the list has measured before scrolling.
    const t = setTimeout(() => {
      if (listRef.current) {
        try {
          listRef.current.scrollToIndex({ index: selected, animated: false, viewPosition: 0.5 });
        } catch (e) {}
      }
    }, 80);
    return () => clearTimeout(t);
  }, [visible, editing, selected]);

  const preview = useMemo(
    () => ({ startIndex: Math.min(start, end), endIndex: Math.max(start, end), preset: 'CUSTOM' }),
    [start, end]
  );
  const valid = preview.endIndex > preview.startIndex;

  const select = (i) => {
    if (editing === 'start') {
      setStart(i);
      // Moving the start past the stop would invert the window; carry the stop
      // along rather than rejecting the tap.
      if (i >= end) setEnd(Math.min(last, i + 1));
      setEditing('end');
    } else {
      setEnd(i);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={[s.scrim, { backgroundColor: colors.scrim }]} onPress={onClose} />
      <View style={[s.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <View style={[s.grabber, { backgroundColor: colors.border }]} />
        <Text style={[type.title, { color: colors.text, marginBottom: space(1) }]}>Custom window</Text>
        <Text style={[type.caption, { color: colors.textMuted, marginBottom: space(4) }]}>
          {valid ? describeWindow(preview) : 'Stop day must follow the start day'}
        </Text>

        <View style={s.endpoints}>
          {['start', 'end'].map((which) => {
            const active = editing === which;
            const idx = which === 'start' ? start : end;
            return (
              <Pressable
                key={which}
                onPress={() => setEditing(which)}
                style={[
                  s.endpoint,
                  {
                    backgroundColor: active ? colors.accentMuted : colors.surface,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text style={[type.micro, { color: colors.textMuted }]}>
                  {which === 'start' ? 'START DAY' : 'STOP DAY'}
                </Text>
                <Text style={[type.bodyStrong, mono, { color: colors.text }]}>{formatDate(dates[idx])}</Text>
              </Pressable>
            );
          })}
        </View>

        <FlatList
          ref={listRef}
          data={dates}
          keyExtractor={(d) => d}
          style={s.list}
          initialNumToRender={20}
          getItemLayout={(_, index) => ({ length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index, index })}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              if (listRef.current) {
                try {
                  listRef.current.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.5 });
                } catch (e) {}
              }
            }, 100);
          }}
          renderItem={({ item, index }) => {
            const chosen = index === selected;
            const inRange = index >= preview.startIndex && index <= preview.endIndex;
            return (
              <Pressable
                onPress={() => select(index)}
                style={[
                  s.dateRow,
                  { backgroundColor: chosen ? colors.accent : inRange ? colors.surface : 'transparent' },
                ]}
              >
                <Text style={[type.body, mono, { color: chosen ? colors.bg : colors.text }]}>{formatDate(item)}</Text>
              </Pressable>
            );
          }}
        />

        <View style={s.actions}>
          <Pressable onPress={onClose} style={[s.button, { backgroundColor: colors.surface }]}>
            <Text style={[type.bodyStrong, { color: colors.text }]}>Cancel</Text>
          </Pressable>
          <Pressable
            disabled={!valid}
            onPress={() => {
              onApply(preview.startIndex, preview.endIndex);
              onClose();
            }}
            style={[s.button, { backgroundColor: colors.accent, opacity: valid ? 1 : 0.4 }]}
          >
            <Text style={[type.bodyStrong, { color: colors.bg }]}>Apply</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%',
    borderTopLeftRadius: radius.lg + 4, borderTopRightRadius: radius.lg + 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space(4), paddingTop: space(2), paddingBottom: space(8),
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space(3) },
  endpoints: { flexDirection: 'row', gap: space(2), marginBottom: space(3) },
  endpoint: { flex: 1, borderRadius: radius.md, borderWidth: 1, padding: space(3), gap: space(1) },
  list: { flexGrow: 0, height: 240 },
  dateRow: { height: ITEM_HEIGHT, justifyContent: 'center', paddingHorizontal: space(3), borderRadius: radius.sm },
  actions: { flexDirection: 'row', gap: space(2), marginTop: space(3) },
  button: { flex: 1, paddingVertical: space(3.5), borderRadius: radius.md, alignItems: 'center' },
});
