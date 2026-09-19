import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  CATEGORY_LABELS,
  CATEGORY_OUTCOMES,
  formatRate,
  receptionRates,
  OUTCOME_LABELS,
} from '@/lib/volleyball-stats';
import type { Category, MatchCounts, Outcome, PlayInput } from '@/lib/volleyball-stats';
import { InputHighlight } from '@/lib/input-highlight';

const CATEGORIES: readonly Category[] = ['spike', 'dig', 'reception', 'serve', 'block'];
const INPUT_CATEGORIES: readonly Category[] = ['spike', 'dig', 'block', 'reception', 'serve'];
const COLORS: Record<Outcome, string> = {
  success: '#16794a',
  ace: '#1565a8',
  regular: '#6d4c1f',
  miss: '#b33a3a',
  failure: '#b33a3a',
  jumped: '#6d4c1f',
  touch: '#1565a8',
  blockPoint: '#16794a',
  receptionA: '#16794a',
  receptionB: '#1565a8',
  receptionMiss: '#b33a3a',
};

const rates = (category: Category, counts: Record<string, number>) => {
  if (category === 'reception') return receptionRates(counts as MatchCounts['reception']);
  if (category === 'block') {
    return [
      { label: '成功率', value: formatRate(counts.blockPoint, counts.total) },
      { label: 'ワンタッチ率', value: formatRate(counts.touch, counts.total) },
    ];
  }
  if (category === 'serve') {
    return [
      { label: '決定率', value: formatRate(counts.ace, counts.total) },
      { label: 'ミス率', value: formatRate(counts.miss, counts.total) },
    ];
  }
  return [{
    label: '成功率',
    value: formatRate(counts.success, counts.total),
  }];
};

export function StatsPanel({
  counts,
  disabled = false,
  onRecord,
  highlightResetKey = '',
}: {
  counts: MatchCounts;
  disabled?: boolean;
  onRecord?: (input: PlayInput) => boolean;
  highlightResetKey?: string;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const feedback = useRef<InputHighlight | null>(null);
  useLayoutEffect(() => {
    const controller = new InputHighlight(setHighlight);
    feedback.current = controller;
    setHighlight(null);
    return () => {
      controller.dispose();
      feedback.current = null;
    };
  }, [highlightResetKey]);
  const record = (input: PlayInput) => {
    if (disabled || !onRecord) return;
    feedback.current?.record(input, onRecord);
  };
  return (
    <View style={styles.list}>
      {(onRecord ? INPUT_CATEGORIES : CATEGORIES).map((category) => {
        const item = counts[category];
        const countItems = [
          { label: category === 'block' ? '総ジャンプ数' : category === 'reception' ? '本数' : '合計', value: item.total },
          ...CATEGORY_OUTCOMES[category].map((outcome) => ({
            label: OUTCOME_LABELS[outcome],
            value: item[outcome],
          })),
        ];
        const countContent = countItems.map((count, index) => (
          <View key={count.label} style={styles.countItem}>
            <Text style={onRecord ? styles.compactCount : styles.count}>
              {count.label} {count.value}
            </Text>
            {index < countItems.length - 1 && (
              <Text style={onRecord ? styles.compactCount : styles.count}>／</Text>
            )}
          </View>
        ));
        const rateContent = rates(category, item).map((metric) => (
          <View key={metric.label} style={styles.rateItem}>
            <Text style={onRecord ? styles.compactRate : styles.rate}>{metric.label}</Text>
            <Text style={onRecord ? styles.compactRate : styles.rate}> {metric.value}</Text>
          </View>
        ));
        return (
          <View key={category} style={styles.card}>
            {onRecord ? (
              <View style={styles.compactHeader}>
                <View style={styles.compactLeft}>
                  <Text style={styles.title}>{CATEGORY_LABELS[category]}</Text>
                  <View style={styles.compactCountGroup}>{countContent}</View>
                </View>
                <View style={styles.compactRateGroup}>{rateContent}</View>
              </View>
            ) : (
              <>
                <Text style={styles.title}>{CATEGORY_LABELS[category]}</Text>
                <View style={styles.summary}>
                  <View style={styles.countGroup}>{countContent}</View>
                  <View style={styles.rateGroup}>{rateContent}</View>
                </View>
              </>
            )}
            {category === 'block' && (
              <>
                {item.legacyTotal > 0 && (
                  <View style={styles.legacy}>
                    <Text style={styles.count}>旧記録：本数 {item.legacyTotal}／成功 {item.success}／失敗 {item.failure}</Text>
                    <Text style={styles.rate}>旧成功率 {formatRate(item.success, item.legacyTotal)}</Text>
                  </View>
                )}
              </>
            )}
            {category === 'reception' && (
              <>
                {item.legacyTotal > 0 && (
                  <View style={styles.legacy}>
                    <Text style={styles.count}>旧記録：本数 {item.legacyTotal}／成功 {item.success}／ミス {item.miss}</Text>
                    <Text style={styles.rate}>旧成功率 {formatRate(item.success, item.legacyTotal)}</Text>
                  </View>
                )}
              </>
            )}
            {onRecord && (
              <View style={styles.compactButtonRow}>
                {CATEGORY_OUTCOMES[category].map((outcome) => (
                  <Pressable
                    accessibilityLabel={`${CATEGORY_LABELS[category]} ${OUTCOME_LABELS[outcome]}`}
                    accessibilityRole="button"
                    disabled={disabled}
                    key={outcome}
                    onPress={() => record({ category, outcome })}
                    style={({ pressed }) => [
                      styles.button,
                      { backgroundColor: COLORS[outcome] },
                      disabled && styles.disabled,
                      pressed && !disabled && styles.pressed,
                    ]}
                  >
                    <Text style={styles.buttonText}>{OUTCOME_LABELS[outcome]}</Text>
                    {highlight === `${category}:${outcome}` && !disabled && (
                      <View pointerEvents="none" style={styles.highlighted}/>
                    )}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: { backgroundColor: '#fff', borderColor: '#d9e0e3', borderRadius: 12, borderWidth: 1, padding: 9 },
  title: { color: '#172126', fontSize: 20, fontWeight: '800' },
  compactHeader: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 1 },
  compactLeft: { alignItems: 'flex-end', flexDirection: 'row', flexGrow: 1, flexShrink: 1, flexWrap: 'wrap', minWidth: 180 },
  compactCountGroup: { alignItems: 'flex-end', flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', marginLeft: 6 },
  compactCount: { color: '#3f4c52', fontSize: 12, fontWeight: '700', lineHeight: 15 },
  compactRateGroup: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', gap: 5, justifyContent: 'flex-end', marginLeft: 'auto', maxWidth: '100%' },
  compactRate: { color: '#53636a', fontSize: 11, fontWeight: '600', lineHeight: 14 },
  summary: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2 },
  countGroup: { flexDirection: 'row', flexGrow: 1, flexShrink: 1, flexWrap: 'wrap', minWidth: 180 },
  countItem: { flexDirection: 'row', flexShrink: 0 },
  count: { color: '#263238', fontSize: 16, fontWeight: '700', lineHeight: 22 },
  rateGroup: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginLeft: 'auto', maxWidth: '100%' },
  rateItem: { flexDirection: 'row', flexShrink: 0 },
  rate: { color: '#53636a', fontSize: 14, fontWeight: '600' },
  compactButtonRow: { flexDirection: 'row', gap: 8, marginTop: 5 },
  button: { alignItems: 'center', borderRadius: 10, flex: 1, justifyContent: 'center', minHeight: 56, minWidth: 0, padding: 4 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  highlighted: { position: 'absolute', top: 3, bottom: 3, left: 3, right: 3, borderColor: '#fff', borderWidth: 2, borderRadius: 7 },
  legacy: { borderTopWidth: 1, borderTopColor: '#d9e0e3', marginTop: 5, paddingTop: 5 },
});
