import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePersistentMatch } from '@/hooks/use-persistent-match';

import {
  CATEGORY_LABELS,
  CATEGORY_OUTCOMES,
  describeInput,
  formatRate,
  OUTCOME_LABELS,
} from '@/lib/volleyball-stats';
import type { Category, Outcome } from '@/lib/volleyball-stats';

const CATEGORIES: readonly Category[] = [
  'serve',
  'reception',
  'block',
  'dig',
  'spike',
];

const OUTCOME_COLORS: Record<Outcome, string> = {
  success: '#16794a',
  ace: '#1565a8',
  regular: '#6d4c1f',
  miss: '#b33a3a',
  failure: '#b33a3a',
};

const detailText = (category: Category, counts: Record<string, number>): string => {
  const details = CATEGORY_OUTCOMES[category]
    .map((outcome) => `${OUTCOME_LABELS[outcome]} ${counts[outcome]}`)
    .join('／');
  return `合計 ${counts.total}／${details}`;
};

const rateText = (category: Category, counts: Record<string, number>): string => {
  if (category === 'serve') {
    return `決定率 ${formatRate(counts.ace, counts.total)}　ミス率 ${formatRate(counts.miss, counts.total)}`;
  }

  const label = category === 'spike' ? '決定率' : '成功率';
  return `${label} ${formatRate(counts.success, counts.total)}`;
};

export default function InputScreen() {
  const { state, status, canInput, apply, retry } = usePersistentMatch();
  const lastInput = state.history[state.history.length - 1];
  const hasError = status.phase === 'load-error' || status.phase === 'save-error';
  const statusText =
    status.phase === 'loading'
      ? '記録を読み込み中…'
      : status.phase === 'saving'
        ? '保存中…'
        : status.phase === 'saved'
          ? '端末内に保存済み'
          : status.phase === 'load-error'
            ? `復元失敗：${status.message}`
            : `未保存：${status.message}`;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>試合記録・通常モード</Text>
        <View style={styles.statusRow}>
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={2}
            style={[styles.statusText, hasError && styles.statusError]}
          >
            {statusText}
          </Text>
          {hasError && (
            <Pressable
              accessibilityRole="button"
              onPress={() => void retry()}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <Text style={styles.retryButtonText}>再試行</Text>
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        {CATEGORIES.map((category) => {
          const counts = state.counts[category];

          return (
            <View key={category} style={styles.card}>
              <Text style={styles.categoryTitle}>{CATEGORY_LABELS[category]}</Text>
              <Text style={styles.counts}>{detailText(category, counts)}</Text>
              <Text style={styles.rate}>{rateText(category, counts)}</Text>

              <View style={styles.buttonRow}>
                {CATEGORY_OUTCOMES[category].map((outcome) => (
                  <Pressable
                    accessibilityHint={`${CATEGORY_LABELS[category]}の${OUTCOME_LABELS[outcome]}を1件追加します`}
                    accessibilityLabel={`${CATEGORY_LABELS[category]} ${OUTCOME_LABELS[outcome]}`}
                    accessibilityRole="button"
                    disabled={!canInput}
                    key={outcome}
                    onPress={() => apply({ type: 'record', input: { category, outcome } })}
                    style={({ pressed }) => [
                      styles.inputButton,
                      { backgroundColor: OUTCOME_COLORS[outcome] },
                      !canInput && styles.inputButtonDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.inputButtonText}>{OUTCOME_LABELS[outcome]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.undoArea}>
        <Text style={styles.lastInput} numberOfLines={2}>
          直前の入力：{describeInput(lastInput)}
        </Text>
        <Pressable
          accessibilityHint="直前の入力1件を取り消します"
          accessibilityRole="button"
          disabled={!lastInput || !canInput}
          onPress={() => apply({ type: 'undo' })}
          style={({ pressed }) => [
            styles.undoButton,
            (!lastInput || !canInput) && styles.undoButtonDisabled,
            pressed && lastInput && canInput && styles.pressed,
          ]}
        >
          <Text style={styles.undoButtonText}>1つ戻す</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f7f8',
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 8,
  },
  title: {
    color: '#172126',
    fontSize: 23,
    fontWeight: '800',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
  },
  statusText: {
    color: '#356447',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  statusError: {
    color: '#a33a20',
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#7d2f1d',
    borderRadius: 7,
    justifyContent: 'center',
    minHeight: 34,
    minWidth: 68,
    paddingHorizontal: 10,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  scrollContent: {
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#d9e0e3',
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
  },
  categoryTitle: {
    color: '#172126',
    fontSize: 20,
    fontWeight: '800',
  },
  counts: {
    color: '#263238',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 2,
  },
  rate: {
    color: '#53636a',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  inputButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 56,
    minWidth: 0,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  inputButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  inputButtonDisabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  undoArea: {
    backgroundColor: '#ffffff',
    borderTopColor: '#d9e0e3',
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 7,
    paddingBottom: 8,
  },
  lastInput: {
    color: '#344249',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 5,
  },
  undoButton: {
    alignItems: 'center',
    backgroundColor: '#263238',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
  },
  undoButtonDisabled: {
    backgroundColor: '#aeb8bd',
  },
  undoButtonText: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '800',
  },
});
