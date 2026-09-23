import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import type { TeamSide } from '@/lib/match-domain';

const display = (score: number | null) => (score === null ? '' : String(score));
const parse = (value: string): number | null | undefined => {
  if (value.trim() === '') return null;
  if (!/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
};

export function ScoreControls({
  homeName,
  awayName,
  homeScore,
  awayScore,
  disabled,
  onChange,
  hideNames = false,
}: {
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  disabled: boolean;
  onChange: (side: TeamSide, value: number) => void;
  hideNames?: boolean;
}) {
  const { width } = useWindowDimensions();
  const [homeDraft, setHomeDraft] = useState(display(homeScore));
  const [awayDraft, setAwayDraft] = useState(display(awayScore));
  const [error, setError] = useState<TeamSide | null>(null);
  useEffect(() => setHomeDraft(display(homeScore)), [homeScore]);
  useEffect(() => setAwayDraft(display(awayScore)), [awayScore]);

  const commit = (side: TeamSide, draft: string) => {
    const value = parse(draft);
    if (value === undefined || value === null) {
      setError(side);
      return;
    }
    setError(null);
    onChange(side, value);
  };

  const side = (
    teamSide: TeamSide,
    name: string,
    score: number | null,
    draft: string,
    setDraft: (value: string) => void,
  ) => {
    const decrement = (
      <Pressable
          accessibilityLabel={`${name}から1点減らす`}
          disabled={disabled || score === null || score === 0}
          onPress={() => {
            const draftScore = parse(draft);
            const currentScore = typeof draftScore === 'number' ? draftScore : score;
            if (currentScore !== null && currentScore > 0) onChange(teamSide, currentScore - 1);
          }}
          style={({ pressed }) => [styles.adjustMinus, (disabled || score === null || score === 0) && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.adjustMinusText}>−1</Text>
      </Pressable>
    );
    const input = (
      <TextInput
          accessibilityLabel={`${name}の点数`}
          editable={!disabled}
          inputMode="numeric"
          keyboardType="number-pad"
          onBlur={() => commit(teamSide, draft)}
          onChangeText={(value) => { setDraft(value); setError(null); }}
          selectTextOnFocus
          placeholder="未確定"
          placeholderTextColor="#91a4b2"
          style={[styles.input, error === teamSide && styles.inputError]}
          value={draft}
      />
    );
    const increment = (
      <Pressable
          accessibilityLabel={`${name}に1点追加`}
          disabled={disabled}
          onPress={() => {
            const draftScore = parse(draft);
            onChange(teamSide, (typeof draftScore === 'number' ? draftScore : score ?? 0) + 1);
          }}
          style={({ pressed }) => [styles.adjustPlus, disabled && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.adjustPlusText}>＋1</Text>
      </Pressable>
    );
    return (
      <View style={styles.side}>
        {!hideNames && <Text numberOfLines={2} style={styles.name}>{name}</Text>}
        <View style={styles.controls}>
        {teamSide === 'home'
          ? <>{decrement}{input}{increment}</>
          : <>{increment}{input}{decrement}</>}
        </View>
        {!hideNames && <Text style={styles.hint}>{error === teamSide ? '0以上の整数を入力' : '空欄は未確定'}</Text>}
      </View>
    );
  };

  return (
    <View style={[styles.wrapper, width < 390 && styles.narrowWrapper]}>
      {side('home', homeName, homeScore, homeDraft, setHomeDraft)}
      {side('away', awayName, awayScore, awayDraft, setAwayDraft)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'stretch', flexDirection: 'row', gap: 12 },
  narrowWrapper: { flexDirection: 'column' },
  side: { backgroundColor: '#edf6fc', borderRadius: 16, flex: 1, minWidth: 0, padding: 12 },
  name: { color: '#102a43', fontSize: 17, fontWeight: '800', minHeight: 30, textAlign: 'center' },
  controls: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  input: { backgroundColor: 'transparent', borderColor: '#b7d2e7', borderRadius: 10, borderWidth: 1, color: '#08243d', flex: 1, fontSize: 38, fontWeight: '800', minHeight: 58, minWidth: 38, paddingHorizontal: 3, textAlign: 'center' },
  inputError: { borderColor: '#b3261e', borderWidth: 2 },
  adjustPlus: { alignItems: 'center', backgroundColor: '#dcecf8', borderColor: '#b7d2e7', borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 58, minWidth: 42, paddingHorizontal: 3 },
  adjustPlusText: { color: '#0f4268', fontSize: 18, fontWeight: '800' },
  adjustMinus: { alignItems: 'center', backgroundColor: '#f7fbfe', borderColor: '#b7d2e7', borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 58, minWidth: 42, paddingHorizontal: 3 },
  adjustMinusText: { color: '#0f4268', fontSize: 17, fontWeight: '800' },
  hint: { color: '#526b80', fontSize: 11, minHeight: 16, marginTop: 3, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
