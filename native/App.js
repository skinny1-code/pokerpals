import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { loadTables, GAME_API_URL } from './src/api.mjs';

const GOLD = '#d9c08a', BG = '#080b0e', PANEL = '#13191e', MUTED = '#8e9da2', GREEN = '#29bd8b';
function Action({ label, onPress, disabled = false, secondary = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, disabled && styles.disabled, pressed && !disabled && { opacity: .75 }]}>
    <Text style={[styles.buttonText, secondary && { color: GOLD }, disabled && { color: MUTED }]}>{label}</Text>
  </Pressable>;
}
function Header({ view, back }) {
  return <View style={styles.header}>
    <Pressable accessibilityRole="button" onPress={back || undefined} disabled={!back}><Text style={styles.headerBrand}>{back ? '‹  ' : '♠  '}POKERPALS</Text></Pressable>
    <Text style={styles.headerTag}>NATIVE • ARBITRUM</Text>
  </View>;
}
function LobbyCard({ item, onPress }) {
  const config = item.config || {};
  return <Pressable accessibilityRole="button" accessibilityLabel={'View '+item.name} onPress={onPress} style={({ pressed })=>[styles.card, pressed && {opacity:.7}]}>
    <View style={styles.cardTop}><Text style={styles.cardTitle}>{item.name}</Text><Text style={[styles.pill,{color:item.phase==='waiting'?GOLD:GREEN}]}>{item.phase.toUpperCase()}</Text></View>
    <View style={styles.cardTop}><Text style={styles.sub}>No Limit Hold’em / {config.gameType===1?'Omaha':'Hold’em'}</Text><Text style={styles.info}>{item.seated}/{config.maxPlayers||9} seats</Text></View>
    <View style={styles.cardTop}><Text style={styles.sub}>Blinds: {config.bigBlind||'—'}</Text><Text style={styles.gold}>Buy-in: {config.buyIn ?? '—'} CHIPS</Text></View>
  </Pressable>;
}
export default function App() {
  const [tab,setTab] = useState('Lobby');
  const [tables,setTables] = useState([]);
  const [selected,setSelected] = useState(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [updated,setUpdated] = useState(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const result=await loadTables(); setTables(result);setUpdated(new Date().toLocaleTimeString()); }
    catch(e){setError(e?.message || 'Cannot reach game server');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{refresh();},[refresh]);
  const back = selected ? () => setSelected(null) : null;
  return <SafeAreaView style={styles.root}><StatusBar barStyle="light-content" backgroundColor={BG}/>
    <Header view={selected?'Table':tab} back={back}/>
    {selected ?
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>{selected.name}</Text><Text style={styles.sub}>Real table ID: {selected.id}</Text>
        <View style={styles.felt}>
          <Text style={styles.feltTitle}>♠   POKERPALS   ♠</Text>
          <Text style={styles.feltSub}>TABLE INFORMATION</Text>
          <Text style={styles.feltSeats}>{selected.seated} / {selected.config?.maxPlayers||9} PLAYERS</Text>
          <Text style={styles.feltSub}>Current phase: {selected.phase}</Text>
        </View>
        <View style={styles.card}><Text style={styles.cardTitle}>On-chain game connection</Text>
          <Text style={styles.copy}>This native client reads the live table directory. Joining a hand requires signed wallet authentication, a verified escrow deposit, and the server’s live game-state stream. Those transaction flows are not enabled in this build.</Text>
          <Action label="Join table — wallet integration pending" disabled/>
        </View>
        <Action label="Return to lobby" onPress={()=>setSelected(null)} secondary/>
      </ScrollView> :
      tab === 'Lobby' ?
      <View style={styles.main}>
        <View style={styles.titleWrap}><Text style={styles.h1}>Live tables</Text><Text style={styles.sub}>Connected to PokerPals game server</Text>
          {updated && <Text style={styles.meta}>Last refreshed: {updated}</Text>}</View>
        {error ? <View style={styles.error}><Text style={styles.errorTitle}>Cannot load live tables</Text><Text style={styles.copy}>{error}</Text><Text style={styles.meta}>Check the configured API endpoint and server health.</Text><Action label="Retry" onPress={refresh} secondary/></View> : null}
        {loading && tables.length===0?<ActivityIndicator color={GOLD} size="large" style={{marginTop:32}}/>:
          <FlatList data={tables} keyExtractor={x=>x.id} renderItem={({item})=><LobbyCard item={item} onPress={()=>setSelected(item)}/>}
            ListEmptyComponent={!error?<View style={styles.empty}><Text style={styles.cardTitle}>No live tables reported</Text><Text style={styles.copy}>The server returned an empty lobby. No tables are generated locally.</Text></View>:null}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={GOLD}/>}
            contentContainerStyle={{paddingHorizontal:18,paddingBottom:28}}/>}
      </View> :
      <ScrollView contentContainerStyle={styles.scroll}><Text style={styles.h1}>{tab}</Text>
        <View style={styles.card}><Text style={styles.cardTitle}>{tab==='Wallet'?'Wallet connection':'Native mobile client'}</Text>
          <Text style={styles.copy}>{tab==='Wallet'?'Rabby, SafePal and other compatible wallet signing requires a verified native connection workflow before real transactions can be enabled. No keys are stored by this app.':'This screen is rendered with Android/iOS native views, not a website. The current release is a test client for the live PokerPals lobby.'}</Text>
          {tab==='Wallet'?<Action label="Connect wallet — pending native integration" disabled/>:<Text style={styles.meta}>Backend: {GAME_API_URL}</Text>}
        </View></ScrollView>
    }
    <View style={styles.bottom}>
      {['Lobby','Wallet','About'].map(x=><Pressable accessibilityRole="tab" accessibilityState={{selected:tab===x&&!selected}} key={x} onPress={()=>{setSelected(null);setTab(x);}} style={[styles.tab,(tab===x&&!selected)&&styles.tabActive]}><Text style={[styles.tabText,(tab===x&&!selected)&&{color:GOLD}]}>{x==='Lobby'?'♠  ':x==='Wallet'?'◈  ':'ⓘ  '}{x}</Text></Pressable>)}
    </View>
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  root:{flex:1,backgroundColor:BG},main:{flex:1},header:{height:60,paddingHorizontal:18,backgroundColor:'#11171b',borderBottomColor:'#2c3437',borderBottomWidth:1,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  headerBrand:{color:GOLD,fontSize:17,fontWeight:'900',letterSpacing:1},headerTag:{color:MUTED,fontSize:10,letterSpacing:1.1},
  titleWrap:{padding:20,gap:6},h1:{color:'#eff3f1',fontSize:27,fontWeight:'800'},sub:{color:MUTED,fontSize:12},meta:{color:'#71858c',fontSize:11,marginTop:9},
  card:{backgroundColor:PANEL,borderColor:'#25343a',borderWidth:1,borderRadius:16,padding:17,marginVertical:7,gap:12},
  cardTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:9},cardTitle:{color:'#e9eee9',fontSize:17,fontWeight:'700',flexShrink:1},
  pill:{borderColor:'#4a4a35',borderWidth:1,borderRadius:20,paddingHorizontal:8,paddingVertical:4,fontSize:10,fontWeight:'800'},
  info:{color:'#dae2e0',fontSize:12},gold:{color:GOLD,fontSize:12,fontWeight:'700'},copy:{color:'#aebbbd',fontSize:13,lineHeight:21},
  scroll:{padding:18,paddingBottom:32,gap:12},felt:{height:270,backgroundColor:'#0d5545',borderRadius:110,borderWidth:11,borderColor:'#292322',alignItems:'center',justifyContent:'center',gap:18,marginVertical:18},
  feltTitle:{color:'#c3e0ca',fontWeight:'900',fontSize:18,letterSpacing:2},feltSub:{color:'#91b9a6',fontSize:11,letterSpacing:1},feltSeats:{color:'#eff6e9',fontSize:19,fontWeight:'800'},
  button:{paddingVertical:14,paddingHorizontal:16,backgroundColor:GOLD,borderRadius:11,alignItems:'center',marginTop:8},secondary:{backgroundColor:'#222e2e',borderWidth:1,borderColor:'#7b6a46'},disabled:{backgroundColor:'#2b3436'},
  buttonText:{color:'#152220',fontWeight:'800',fontSize:13,textAlign:'center'},bottom:{height:62,backgroundColor:'#10171c',borderTopWidth:1,borderTopColor:'#283135',flexDirection:'row'},
  tab:{flex:1,alignItems:'center',justifyContent:'center'},tabActive:{borderTopWidth:2,borderTopColor:GOLD},tabText:{color:MUTED,fontWeight:'700',fontSize:12},
  error:{marginHorizontal:18,backgroundColor:'#312324',borderColor:'#744345',borderWidth:1,padding:17,borderRadius:13,gap:8},errorTitle:{color:'#eea4a7',fontSize:15,fontWeight:'800'},
  empty:{margin:18,padding:24,backgroundColor:PANEL,borderRadius:14,gap:7}
});
