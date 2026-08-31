import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  CATEGORY_LABELS,
  CATEGORY_OUTCOMES,
  formatRate,
  OUTCOME_LABELS,
} from '@/lib/volleyball-stats';
import type { Category, MatchCounts, Outcome, PlayInput } from '@/lib/volleyball-stats';

const CATEGORIES: readonly Category[] = ['spike', 'dig', 'reception', 'serve', 'block'];
const COLORS: Record<Outcome, string> = {
  success: '#16794a',
  ace: '#1565a8',
  regular: '#6d4c1f',
  miss: '#b33a3a',
  failure: '#b33a3a',
};

const rates = (category: Category, counts: Record<string, number>) => {
  if (category === 'serve') {
    return [
      { label: '決定率', value: formatRate(counts.ace, counts.total) },
      { label: 'ミス率', value: formatRate(counts.miss, counts.total) },
    ];
  }
  return [{
    label: category === 'spike' ? '決定率' : '成功率',
    value: formatRate(counts.success, counts.total),
  }];
};

export function StatsPanel({
  counts,
  disabled = false,
  onRecord,
}: {
  counts: MatchCounts;
  disabled?: boolean;
  onRecord?: (input: PlayInput) => void;
}) {
  return (
    <View style={styles.list}>
      {CATEGORIES.map((category) => {
        const item = counts[category];
        const countItems = [
          { label: '合計', value: item.total },
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
            {onRecord && (
              <View style={styles.compactButtonRow}>
                {CATEGORY_OUTCOMES[category].map((outcome) => (
                  <Pressable
                    accessibilityLabel={`${CATEGORY_LABELS[category]} ${OUTCOME_LABELS[outcome]}`}
                    accessibilityRole="button"
                    disabled={disabled}
                    key={outcome}
                    onPress={() => onRecord({ category, outcome })}
                    style={({ pressed }) => [
                      styles.button,
                      { backgroundColor: COLORS[outcome] },
                      disabled && styles.disabled,
                      pressed && !disabled && styles.pressed,
                    ]}
                  >
                    <Text style={styles.buttonText}>{OUTCOME_LABELS[outcome]}</Text>
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
  card: { backgroundColor: '#fff', borderColor: '#d9e0e3', borderRadius: 12, borderWidth: 1, padding: 10 },
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
  compactButtonRow: { flexDirection: 'row', gap: 8, marginTop: 3 },
  button: { alignItems: 'center', borderRadius: 10, flex: 1, justifyContent: 'center', minHeight: 56, minWidth: 0, padding: 4 },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
});
