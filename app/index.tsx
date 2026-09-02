import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ResultList } from '@/components/result-list';
import { ScoreControls } from '@/components/score-controls';
import { StatsPanel } from '@/components/stats-panel';
import { useMatchDatabase } from '@/hooks/use-match-database';
import {
  aggregateMatchStats, completeCurrentSet, completeMatch, deriveSet,
  editCompletedSetScore, getActiveMatch, getCurrentSet, recordStat,
  setScore, startMatch, startNextSet, undoCurrentSet, updateMatchInfo,
} from '@/lib/match-domain';
import type { SetOperation, VolleyballMatch, VolleyballSet } from '@/lib/match-domain';
import { describeInput } from '@/lib/volleyball-stats';

type Screen = 'home' | 'setup' | 'live' | 'finish-set' | 'after-set' | 'finish-match' | 'history' | 'detail' | 'set-stats';
const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const newId = () => `match-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const shown = (n: number | null) => n === null ? '' : String(n);
const parsed = (s: string) => /^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : null;

function Button({ title, onPress, disabled = false, danger = false }: { title: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, danger && styles.danger, disabled && styles.disabled, pressed && styles.pressed]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}

function Status({ value, retry }: { value: ReturnType<typeof useMatchDatabase>['status']; retry: () => Promise<unknown> }) {
  const error = value.phase === 'load-error' || value.phase === 'save-error';
  const savedAt = Platform.OS === 'web' ? 'この端末のSafari内に保存済み' : '端末内に保存済み';
  const text = value.phase === 'loading' ? '記録を読み込み中…' : value.phase === 'saving' ? '保存中…（完了表示まで閉じないでください）' : value.phase === 'saved' ? (value.migrated ? `旧記録を移行・${savedAt}` : savedAt) : value.phase === 'load-error' ? `復元失敗：${value.message}` : `未保存：${value.message}`;
  return <View style={styles.statusRow}><Text numberOfLines={2} style={[styles.status, error && styles.error]}>{text}</Text>{error && <Pressable onPress={() => void retry()} style={styles.retry}><Text style={styles.retryText}>再試行</Text></Pressable>}</View>;
}

function Setup({ defaultHome, match, cancel, submit }: { defaultHome: string; match?: VolleyballMatch; cancel: () => void; submit: (v: { date: string; homeTeam: string; awayTeam: string }) => void }) {
  const [date, setDate] = useState(match?.date ?? today());
  const [homeTeam, setHome] = useState(match?.homeTeam ?? defaultHome);
  const [awayTeam, setAway] = useState(match?.awayTeam ?? '');
  const [error, setError] = useState('');
  const go = () => !date.trim() || !homeTeam.trim() || !awayTeam.trim() ? setError('日付・両チーム名を入力してください。') : submit({ date: date.trim(), homeTeam: homeTeam.trim(), awayTeam: awayTeam.trim() });
  return <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>{match ? '移行した記録の試合情報' : '新しい試合'}</Text>{match && <Text style={styles.warning}>旧記録の実際の日付・チーム名を入力してください。</Text>}<Text style={styles.label}>日付</Text><TextInput onChangeText={setDate} style={styles.input} value={date}/><Text style={styles.label}>自チーム（左）</Text><TextInput onChangeText={setHome} style={styles.input} value={homeTeam}/><Text style={styles.label}>相手チーム（右・必須）</Text><TextInput onChangeText={setAway} style={styles.input} value={awayTeam}/><Text style={styles.error}>{error}</Text><Button onPress={go} title={match ? '情報を保存して記録へ' : '試合開始'}/><Button onPress={cancel} title="戻る"/></ScrollView>;
}

function operationText(op: SetOperation | undefined) {
  if (!op) return 'このセットにはまだ操作がありません';
  return op.type === 'stat' ? describeInput(op.input) : `${op.side === 'home' ? '自チーム' : '相手チーム'}点数を ${op.value} に変更`;
}

function ScoreEdit({ set, save }: { set: VolleyballSet; save: (h: number | null, a: number | null) => void }) {
  const [home, setHome] = useState(shown(set.finalHomeScore)); const [away, setAway] = useState(shown(set.finalAwayScore)); const [msg, setMsg] = useState('');
  const go = () => { const h = home.trim() ? parsed(home) : null; const a = away.trim() ? parsed(away) : null; if ((home.trim() && h === null) || (away.trim() && a === null)) return setMsg('0以上の整数か空欄にしてください'); save(h, a); setMsg('変更しました（保存状態は画面上部）'); };
  return <View style={styles.edit}><Text style={styles.editLabel}>第{set.number}セット</Text><TextInput inputMode="numeric" onChangeText={setHome} style={styles.smallInput} value={home}/><Text>−</Text><TextInput inputMode="numeric" onChangeText={setAway} style={styles.smallInput} value={away}/><Pressable onPress={go} style={styles.smallButton}><Text style={styles.retryText}>修正</Text></Pressable>{!!msg && <Text style={styles.editMsg}>{msg}</Text>}</View>;
}

export default function AppScreen() {
  const store = useMatchDatabase(); const { database, canOperate, update, updateAndWait } = store;
  const [screen, setScreen] = useState<Screen>('home'); const [matchId, setMatchId] = useState<string | null>(null); const [setId, setSetId] = useState<string | null>(null);
  const [endHome, setEndHome] = useState(''); const [endAway, setEndAway] = useState(''); const [confirmOdd, setConfirmOdd] = useState(false); const [message, setMessage] = useState('');
  const active = database ? getActiveMatch(database) : null; const selected = database?.matches.find(m => m.id === matchId) ?? null; const currentSet = active ? getCurrentSet(active) : null; const current = currentSet ? deriveSet(currentSet) : null;
  const resume = () => active && setScreen(!active.date || !active.homeTeam || !active.awayTeam ? 'setup' : currentSet ? 'live' : 'after-set');
  const startEndSet = () => { if (!current) return; setEndHome(shown(current.homeScore)); setEndAway(shown(current.awayScore)); setConfirmOdd(false); setMessage(''); setScreen('finish-set'); };
  const endSet = (force: boolean) => { const h = endHome.trim() ? parsed(endHome) : null; const a = endAway.trim() ? parsed(endAway) : null; if ((endHome.trim() && h === null) || (endAway.trim() && a === null)) return setMessage('点数は0以上の整数か空欄にしてください。'); if (!force && (h === null || a === null || h === a)) return setConfirmOdd(true); update(db => completeCurrentSet(db, { home: h, away: a })); setScreen('after-set'); };
  const endMatch = async () => { const ok = await updateAndWait(db => completeMatch(db, new Date().toISOString())); if (ok) { setMatchId(null); setScreen('history'); } else setMessage('保存に失敗したため、この画面に留まっています。'); };

  let body: React.ReactNode;
  if (!database) body = <View style={styles.center}><Text style={styles.title}>記録を準備しています</Text></View>;
  else if (screen === 'setup') body = <Setup defaultHome={database.defaultHomeTeam} match={active ?? undefined} cancel={() => setScreen('home')} submit={value => { if (active) update(db => updateMatchInfo(db, active.id, value)); else update(db => startMatch(db, value, { id: newId(), now: new Date().toISOString() })); setScreen('live'); }}/>;
  else if (screen === 'home') body = <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>バレーボール試合記録</Text>{active && <View style={styles.card}><Text style={styles.cardTitle}>{active.migratedFromV1 ? '移行した記録があります' : '記録中の試合'}</Text><Text>{active.homeTeam || '自チーム未設定'} − {active.awayTeam || '相手未設定'}</Text><Button onPress={resume} title="記録を再開"/></View>}{!active && <Button disabled={!canOperate} onPress={() => setScreen('setup')} title="新しい試合を開始"/>}{active && <Text style={styles.warning}>記録中の試合を終了するまで、新規試合は開始できません。</Text>}<Button onPress={() => setScreen('history')} title="過去試合を見る"/></ScrollView>;
  else if (screen === 'live' && active && currentSet && current) body = <View style={styles.flex}><View style={styles.liveHead}><Text style={styles.setTitle}>第{currentSet.number}セット・このセットのスタッツ</Text><ScoreControls homeName={active.homeTeam || '自チーム未設定'} awayName={active.awayTeam || '相手未設定'} homeScore={current.homeScore} awayScore={current.awayScore} disabled={!canOperate} onChange={(side, value) => update(db => setScore(db, side, value))}/></View><ScrollView contentContainerStyle={styles.stats} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"><StatsPanel counts={current.stats.counts} disabled={!canOperate} onRecord={input => update(db => recordStat(db, input))}/><Button onPress={startEndSet} title="セット終了"/></ScrollView><View style={styles.undo}><Text numberOfLines={2} style={styles.last}>直前：{operationText(current.lastOperation)}</Text><Button disabled={!current.lastOperation || !canOperate} onPress={() => update(undoCurrentSet)} title="1つ戻す"/></View></View>;
  else if (screen === 'finish-set' && active && currentSet) body = <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>第{currentSet.number}セット終了確認</Text><Text style={styles.warning}>確定後、通常のUndoではこのセットをまたいで戻せません。</Text><Text style={styles.label}>{active.homeTeam || '自チーム未設定'}（左）</Text><TextInput inputMode="numeric" onChangeText={setEndHome} placeholder="未確定" style={styles.input} value={endHome}/><Text style={styles.label}>{active.awayTeam || '相手未設定'}（右）</Text><TextInput inputMode="numeric" onChangeText={setEndAway} placeholder="未確定" style={styles.input} value={endAway}/><Text style={styles.error}>{message}</Text><Button onPress={() => endSet(false)} title="最終点数を確認して確定"/>{confirmOdd && <View style={styles.warningBox}><Text style={styles.warning}>同点または未確定です。途中終了として保存しますか？</Text><Button danger onPress={() => endSet(true)} title="同点・未確定のまま確定"/></View>}<Button onPress={() => setScreen('live')} title="記録へ戻る"/></ScrollView>;
  else if (screen === 'after-set' && active) body = <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>セットを確定しました</Text><ResultList match={active}/><Text style={styles.warning}>確定済みセットは通常のUndo対象外です。</Text><Button onPress={() => { update(startNextSet); setScreen('live'); }} title="次のセットへ"/><Button danger onPress={() => setScreen('finish-match')} title="試合終了へ"/></ScrollView>;
  else if (screen === 'finish-match' && active) body = <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>試合終了の確認</Text><ResultList match={active}/><Text style={styles.section}>終了セットの点数修正</Text>{active.sets.filter(s => s.status === 'completed').map(s => <ScoreEdit key={s.id} set={s} save={(h,a) => update(db => editCompletedSetScore(db, active.id, s.id, { home:h, away:a }))}/>)}<Text style={styles.error}>{message}</Text><Button danger disabled={!canOperate} onPress={() => void endMatch()} title="試合終了を確定"/><Button onPress={() => setScreen('after-set')} title="戻る"/></ScrollView>;
  else if (screen === 'history') { const done = database.matches.filter(m => m.status === 'completed'); body = <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>過去試合</Text>{done.map(m => <Pressable key={m.id} onPress={() => { setMatchId(m.id); setScreen('detail'); }} style={styles.match}><Text style={styles.cardTitle}>{m.date || '日付未設定'}</Text><Text numberOfLines={2}>{m.homeTeam || '自チーム未設定'} − {m.awayTeam || '相手未設定'}</Text></Pressable>)}{done.length === 0 && <Text>終了した試合はありません。</Text>}<Button onPress={() => setScreen('home')} title="ホームへ"/></ScrollView>; }
  else if (screen === 'detail' && selected) body = <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>試合詳細</Text><Text>{selected.date || '日付未設定'}</Text><ResultList match={selected}/><Text style={styles.section}>終了セットの点数修正</Text>{selected.sets.filter(s => s.status === 'completed').map(s => <View key={s.id}><ScoreEdit set={s} save={(h,a) => update(db => editCompletedSetScore(db, selected.id, s.id, { home:h, away:a }))}/><Pressable onPress={() => { setSetId(s.id); setScreen('set-stats'); }} style={styles.link}><Text style={styles.linkText}>第{s.number}セットのスタッツを見る</Text></Pressable></View>)}<Text style={styles.section}>試合全体の合計スタッツ</Text><StatsPanel counts={aggregateMatchStats(selected)}/><Button onPress={() => setScreen('history')} title="一覧へ戻る"/></ScrollView>;
  else if (screen === 'set-stats' && selected && selected.sets.find(s => s.id === setId)) { const set = selected.sets.find(s => s.id === setId)!; body = <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>第{set.number}セットのスタッツ</Text><StatsPanel counts={deriveSet(set).stats.counts}/><Button onPress={() => setScreen('detail')} title="試合詳細へ戻る"/></ScrollView>; }
  else body = <View style={styles.center}><Text>画面を表示できません。</Text><Button onPress={() => setScreen('home')} title="ホームへ"/></View>;
  return <SafeAreaView style={styles.safe}><Status retry={store.retry} value={store.status}/>{body}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe:{backgroundColor:'#f5f7f8',flex:1},flex:{flex:1},center:{flex:1,justifyContent:'center',padding:16},page:{gap:12,padding:14,paddingBottom:30},title:{color:'#172126',fontSize:24,fontWeight:'800'},section:{color:'#263238',fontSize:19,fontWeight:'800',marginTop:8},label:{color:'#263238',fontSize:16,fontWeight:'800'},input:{backgroundColor:'#fff',borderColor:'#788991',borderRadius:8,borderWidth:1,color:'#111',fontSize:18,minHeight:52,paddingHorizontal:10},
  statusRow:{alignItems:'center',backgroundColor:'#fff',flexDirection:'row',gap:8,minHeight:38,paddingHorizontal:12},status:{color:'#356447',flex:1,fontSize:13,fontWeight:'700'},error:{color:'#a33a20',fontWeight:'700'},retry:{backgroundColor:'#7d2f1d',borderRadius:7,padding:8},retryText:{color:'#fff',fontWeight:'800'},button:{alignItems:'center',backgroundColor:'#174e78',borderRadius:10,justifyContent:'center',minHeight:56,padding:10},danger:{backgroundColor:'#8c3025'},buttonText:{color:'#fff',fontSize:18,fontWeight:'800',textAlign:'center'},disabled:{opacity:.45},pressed:{opacity:.7},
  card:{backgroundColor:'#fff',borderColor:'#d9e0e3',borderRadius:10,borderWidth:1,gap:8,padding:12},cardTitle:{color:'#172126',fontSize:18,fontWeight:'800'},warning:{color:'#8b3c24',fontSize:14,fontWeight:'700'},warningBox:{backgroundColor:'#fff2df',borderRadius:8,gap:8,padding:10},liveHead:{backgroundColor:'#e8eef1',paddingHorizontal:10,paddingTop:4},setTitle:{color:'#172126',fontSize:16,fontWeight:'800',textAlign:'center'},stats:{gap:8,padding:10},undo:{backgroundColor:'#fff',borderTopColor:'#d9e0e3',borderTopWidth:1,padding:8},last:{color:'#344249',fontSize:13,fontWeight:'700',marginBottom:4},
  match:{backgroundColor:'#fff',borderColor:'#d9e0e3',borderRadius:9,borderWidth:1,minHeight:64,padding:10},link:{alignItems:'center',justifyContent:'center',minHeight:44},linkText:{color:'#145a86',fontSize:15,fontWeight:'800',textDecorationLine:'underline'},edit:{alignItems:'center',backgroundColor:'#fff',borderRadius:8,flexDirection:'row',flexWrap:'wrap',gap:6,padding:8},editLabel:{fontSize:13,fontWeight:'800',width:70},smallInput:{borderColor:'#788991',borderRadius:6,borderWidth:1,fontSize:18,minHeight:42,textAlign:'center',width:52},smallButton:{backgroundColor:'#174e78',borderRadius:6,justifyContent:'center',minHeight:42,paddingHorizontal:10},editMsg:{color:'#356447',fontSize:11,width:'100%'},
});
