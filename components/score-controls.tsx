import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
}: {
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  disabled: boolean;
  onChange: (side: TeamSide, value: number) => void;
}) {
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
        <Text numberOfLines={2} style={styles.name}>{name}</Text>
        <View style={styles.controls}>
          {teamSide === 'home'
            ? <>{decrement}{input}{increment}</>
            : <>{increment}{input}{decrement}</>}
        </View>
        <Text style={styles.hint}>{error === teamSide ? '0以上の整数を入力' : '空欄は未確定'}</Text>
      </View>
    );
  };

  return (
    <View style={styles.wrapper}>
      {side('home', homeName, homeScore, homeDraft, setHomeDraft)}
      <Text style={styles.dash}>−</Text>
      {side('away', awayName, awayScore, awayDraft, setAwayDraft)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  side: { flex: 1, minWidth: 0 },
  name: { color: '#172126', fontSize: 15, fontWeight: '800', minHeight: 38, textAlign: 'center' },
  controls: { flexDirection: 'row', gap: 5 },
  input: { backgroundColor: '#fff', borderColor: '#73838b', borderRadius: 8, borderWidth: 1, color: '#111', flex: 1, fontSize: 24, fontWeight: '800', minHeight: 50, minWidth: 36, paddingHorizontal: 5, textAlign: 'center' },
  inputError: { borderColor: '#b3261e', borderWidth: 2 },
  adjustPlus: { alignItems: 'center', backgroundColor: '#174e78', borderRadius: 8, justifyContent: 'center', minHeight: 50, minWidth: 48, paddingHorizontal: 5 },
  adjustPlusText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  adjustMinus: { alignItems: 'center', backgroundColor: '#e8eef1', borderColor: '#aab8c2', borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 50, minWidth: 42, paddingHorizontal: 4 },
  adjustMinusText: { color: '#344249', fontSize: 17, fontWeight: '800' },
  dash: { color: '#172126', fontSize: 24, fontWeight: '800', paddingTop: 30 },
  hint: { color: '#766', fontSize: 11, minHeight: 16, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
