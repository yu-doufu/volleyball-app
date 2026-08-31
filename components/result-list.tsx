import { StyleSheet, Text, View } from 'react-native';

import { setResult } from '@/lib/match-domain';
import type { VolleyballMatch } from '@/lib/match-domain';

const marks = (result: ReturnType<typeof setResult>) => {
  if (result === 'home-win') return { home: '● 勝', away: '○ 負', state: '' };
  if (result === 'away-win') return { home: '○ 負', away: '● 勝', state: '' };
  if (result === 'tie') return { home: '', away: '', state: '同点' };
  if (result === 'unconfirmed') return { home: '', away: '', state: '未確定' };
  return { home: '', away: '', state: '記録中' };
};

export function ResultList({ match }: { match: VolleyballMatch }) {
  return (
    <View style={styles.table}>
      <View style={styles.header}>
        <Text numberOfLines={3} style={styles.team}>{match.homeTeam || '自チーム未設定'}</Text>
        <Text style={styles.setHeader}>セット</Text>
        <Text numberOfLines={3} style={styles.team}>{match.awayTeam || '相手未設定'}</Text>
      </View>
      {match.sets.map((set) => {
        const result = setResult(set);
        const mark = marks(result);
        return (
          <View key={set.id} style={styles.row}>
            <Text style={styles.mark}>{mark.home}</Text>
            <Text style={styles.score}>{set.status === 'completed' ? (set.finalHomeScore ?? '—') : '—'}</Text>
            <View style={styles.center}>
              <Text style={styles.number}>第{set.number}セット</Text>
              {mark.state ? <Text style={styles.state}>{mark.state}</Text> : null}
            </View>
            <Text style={styles.score}>{set.status === 'completed' ? (set.finalAwayScore ?? '—') : '—'}</Text>
            <Text style={styles.mark}>{mark.away}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  table: { backgroundColor: '#fff', borderColor: '#d9e0e3', borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  header: { alignItems: 'center', backgroundColor: '#e8eef1', flexDirection: 'row', minHeight: 48, padding: 6 },
  team: { color: '#172126', flex: 1, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  setHeader: { color: '#526168', fontSize: 12, fontWeight: '700', width: 80, textAlign: 'center' },
  row: { alignItems: 'center', borderTopColor: '#d9e0e3', borderTopWidth: 1, flexDirection: 'row', minHeight: 58, paddingHorizontal: 4 },
  mark: { color: '#263238', fontSize: 13, fontWeight: '800', textAlign: 'center', width: 43 },
  score: { color: '#111', fontSize: 22, fontWeight: '800', textAlign: 'center', width: 38 },
  center: { alignItems: 'center', flex: 1, minWidth: 70 },
  number: { color: '#344249', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  state: { color: '#8b3c24', fontSize: 12, fontWeight: '800' },
});
