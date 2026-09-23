import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

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
const TONES: Record<Outcome, 'primary' | 'secondary' | 'destructive'> = {
  success: 'primary', ace: 'primary', regular: 'secondary', miss: 'destructive', failure: 'destructive',
  jumped: 'secondary', touch: 'secondary', blockPoint: 'primary', receptionA: 'secondary',
  receptionB: 'secondary', receptionMiss: 'destructive',
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
  const { width } = useWindowDimensions();
  const inlineInput = Boolean(onRecord) && width >= 390;
  const desktopInput = Boolean(onRecord) && width >= 720;
  const statsButtonFontSize = width >= 390 ? 18 : width >= 360 ? 16 : 14;
  const compactCountFontSize = width >= 390 ? 12 : width >= 360 ? 11 : 10;
  const compactRateFontSize = width >= 390 ? 11 : 10;
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
    <View style={onRecord ? styles.inputPanel : styles.list}>
      {(onRecord ? INPUT_CATEGORIES : CATEGORIES).map((category, categoryIndex) => {
        const item = counts[category];
        const countItems = [
          { label: category === 'block' ? 'ブロックジャンプ数' : category === 'reception' ? '本数' : '合計', value: item.total },
          ...CATEGORY_OUTCOMES[category].map((outcome) => ({
            label: OUTCOME_LABELS[outcome],
            value: item[outcome],
          })),
        ];
        const countContent = countItems.map((count, index) => (
          <View key={count.label} style={styles.countItem}>
            <Text numberOfLines={1} style={onRecord ? [styles.compactCount, { fontSize: compactCountFontSize }] : styles.count}>
              {count.label} {count.value}
            </Text>
            {index < countItems.length - 1 && (
              <Text numberOfLines={1} style={onRecord ? [styles.compactCount, { fontSize: compactCountFontSize }] : styles.count}>／</Text>
            )}
          </View>
        ));
        const rateContent = rates(category, item).map((metric) => (
          <View key={metric.label} style={styles.rateItem}>
            <Text numberOfLines={1} style={onRecord ? [styles.compactRate, { fontSize: compactRateFontSize }] : styles.rate}>{metric.label}</Text>
            <Text numberOfLines={1} style={onRecord ? [styles.compactRate, { fontSize: compactRateFontSize }] : styles.rate}> {metric.value}</Text>
          </View>
        ));
        return (
          <View key={category} style={onRecord ? [styles.inputSection, inlineInput && styles.inlineSection, desktopInput && styles.desktopInputSection, categoryIndex > 0 && styles.sectionDivider] : styles.card}>
            {onRecord ? (
              <>
                <View style={[styles.inputTopRow, inlineInput && styles.inlineTopRow]}>
                  <Text style={styles.title}>{CATEGORY_LABELS[category]}</Text>
                  <View style={[styles.compactButtonRow, inlineInput && styles.inlineButtonRow]}>
                    {CATEGORY_OUTCOMES[category].map((outcome) => (
                      <Pressable
                        accessibilityLabel={`${CATEGORY_LABELS[category]} ${OUTCOME_LABELS[outcome]}`}
                        accessibilityRole="button"
                        disabled={disabled}
                        key={outcome}
                        onPress={() => record({ category, outcome })}
                        style={({ pressed }) => [
                          styles.button,
                          TONES[outcome] === 'primary' && styles.primaryButton,
                          TONES[outcome] === 'secondary' && styles.secondaryButton,
                          TONES[outcome] === 'destructive' && styles.destructiveButton,
                          disabled && styles.disabled,
                          pressed && !disabled && styles.pressed,
                        ]}
                      >
                        <Text numberOfLines={1} style={[styles.buttonText, { fontSize: statsButtonFontSize }, TONES[outcome] !== 'primary' && styles.darkButtonText, TONES[outcome] === 'destructive' && styles.destructiveButtonText]}>{OUTCOME_LABELS[outcome]}</Text>
                        {highlight === `${category}:${outcome}` && !disabled && (
                          <View pointerEvents="none" style={styles.highlighted}/>
                        )}
                      </Pressable>
                    ))}
                    {CATEGORY_OUTCOMES[category].length === 2 && <View pointerEvents="none" style={styles.buttonPlaceholder}/>}
                  </View>
                </View>
                <View style={styles.inputCountRow}>
                  <View style={styles.compactCountGroup}>{countContent}</View>
                  <View style={styles.compactRateGroup}>{rateContent}</View>
                </View>
              </>
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
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  card: { backgroundColor: '#fff', borderColor: '#d9e0e3', borderRadius: 12, borderWidth: 1, padding: 9 },
  inputPanel: { backgroundColor: '#fff', borderColor: '#e4edf3', borderRadius: 18, borderWidth: 1, overflow: 'hidden', shadowColor: '#17324d', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  inputSection: { paddingHorizontal: 14, paddingVertical: 10 },
  inlineSection: { paddingHorizontal: 10 },
  desktopInputSection: { paddingHorizontal: 5, paddingVertical: 5 },
  sectionDivider: { borderTopColor: '#e2edf4', borderTopWidth: 1 },
  title: { color: '#102a43', fontSize: 18, fontWeight: '800' },
  inputTopRow: { alignItems: 'stretch', gap: 6 },
  inlineTopRow: { alignItems: 'center', flexDirection: 'row' },
  inputCountRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  compactCountGroup: { alignItems: 'flex-end', flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', marginTop: 0 },
  compactCount: { color: '#526b80', fontSize: 12, fontWeight: '700', lineHeight: 14 },
  compactRateGroup: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', gap: 4, marginTop: 0, maxWidth: '100%' },
  compactRate: { color: '#526b80', fontSize: 11, fontWeight: '600', lineHeight: 13 },
  summary: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 2 },
  countGroup: { flexDirection: 'row', flexGrow: 1, flexShrink: 1, flexWrap: 'wrap', minWidth: 180 },
  countItem: { flexDirection: 'row', flexShrink: 0 },
  count: { color: '#263238', fontSize: 16, fontWeight: '700', lineHeight: 22 },
  rateGroup: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginLeft: 'auto', maxWidth: '100%' },
  rateItem: { flexDirection: 'row', flexShrink: 0 },
  rate: { color: '#53636a', fontSize: 14, fontWeight: '600' },
  compactButtonRow: { flexDirection: 'row', gap: 8, marginTop: 0, width: '100%' },
  inlineButtonRow: { flex: 1, minWidth: 0 },
  button: { alignItems: 'center', borderRadius: 12, flex: 1, justifyContent: 'center', minHeight: 50, minWidth: 0, padding: 4 },
  buttonPlaceholder: { flex: 1, minHeight: 50 },
  primaryButton: { backgroundColor: '#08688f' },
  secondaryButton: { backgroundColor: '#e5f1fa', borderColor: '#b7d2e7', borderWidth: 1 },
  destructiveButton: { backgroundColor: '#f8e8e8', borderColor: '#e7b8b8', borderWidth: 1 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  darkButtonText: { color: '#123651' },
  destructiveButtonText: { color: '#9d1e1e' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
  highlighted: { position: 'absolute', top: 3, bottom: 3, left: 3, right: 3, borderColor: '#fff', borderWidth: 2, borderRadius: 7 },
  legacy: { borderTopWidth: 1, borderTopColor: '#d9e0e3', marginTop: 5, paddingTop: 5 },
});
