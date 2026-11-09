'use client';

// Independent TESTNET escrow QA harness. This is not a live poker or wagering UI.
// Nothing signs or transfers unless the explicit staging flag, testnet chain ID,
// verified contract bytecode and connected wallet are all present.
import { useEffect, useState } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { formatEther, parseEther, isAddress } from 'viem';

const TESTNET = 99801;
const enabled = process.env.NEXT_PUBLIC_ENABLE_ELYSIUM_NETWORKS === 'true';
const escrowAddress = process.env.NEXT_PUBLIC_ELYSIUM_HYPE_ESCROW || '';
const ABI = [
  { type:'function', name:'createTable', stateMutability:'nonpayable',
    inputs:[{type:'uint256',name:'buyInAmount'},{type:'uint256',name:'bigBlind'},{type:'uint8',name:'maxPlayers'},{type:'uint8',name:'gameType'},{type:'uint256',name:'roomId'}],
    outputs:[{type:'uint256'}] },
  { type:'function', name:'buyIn', stateMutability:'payable', inputs:[{type:'uint256',name:'tableId'}], outputs:[] },
  { type:'function', name:'rebuy', stateMutability:'payable', inputs:[{type:'uint256',name:'tableId'},{type:'uint256',name:'amount'}], outputs:[] },
  { type:'function', name:'refund', stateMutability:'nonpayable', inputs:[{type:'uint256',name:'tableId'}], outputs:[] },
  { type:'function', name:'claim', stateMutability:'nonpayable', inputs:[], outputs:[] },
  { type:'function', name:'activateEmergency', stateMutability:'nonpayable', inputs:[{type:'uint256',name:'tableId'}], outputs:[] },
  { type:'function', name:'emergencyCashOut', stateMutability:'nonpayable', inputs:[{type:'uint256',name:'tableId'}], outputs:[] },
  { type:'function', name:'claimable', stateMutability:'view', inputs:[{type:'address',name:'player'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'humanVerified', stateMutability:'view', inputs:[{type:'address',name:'player'}], outputs:[{type:'bool'}] },
  { type:'function', name:'getPlayerDeposit', stateMutability:'view', inputs:[{type:'uint256',name:'tableId'},{type:'address',name:'player'}], outputs:[{type:'uint256'}] },
  { type:'function', name:'getTableInfo', stateMutability:'view', inputs:[{type:'uint256',name:'tableId'}],
    outputs:[{type:'uint256',name:'id'},{type:'uint256',name:'buyIn'},{type:'uint256',name:'bigBlind'},{type:'uint8',name:'maxPlayers'},{type:'uint8',name:'gameType'},{type:'uint8',name:'status'},{type:'uint256',name:'bankroll'},{type:'uint256',name:'nonce'},{type:'uint8',name:'seated'}] },
];

const styles = {
  box: { padding:20, border:'1px solid #34343e', borderRadius:12, background:'#16171e', marginBottom:16 },
  input: { display:'block', width:'100%', padding:10, color:'white', background:'#20212a', border:'1px solid #474855', borderRadius:7, margin:'8px 0 12px' },
  button: { padding:'10px 14px', background:'#d9bd75', color:'#111', border:'none', borderRadius:7, fontWeight:700, cursor:'pointer', marginRight:8, marginBottom:8 },
};
const pretty = v => typeof v === 'bigint' ? formatEther(v) : '—';

export default function HypeStagingPage() {
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [hasCode, setHasCode] = useState(false);
  const [tableId, setTableId] = useState('1');
  const [buyInValue, setBuyInValue] = useState('0.01');
  const [bigBlindValue, setBigBlindValue] = useState('0.0001');
  const [rebuyValue, setRebuyValue] = useState('0.005');
  const [table, setTable] = useState(null);
  const [deposit, setDeposit] = useState(0n);
  const [credit, setCredit] = useState(0n);
  const [nativeBalance, setNativeBalance] = useState(0n);
  const [verified, setVerified] = useState(false);
  const [status, setStatus] = useState('No transaction submitted.');

  const ready = enabled && chainId === TESTNET && isAddress(escrowAddress) && hasCode && !!address && !!client;

  useEffect(() => {
    let cancelled = false;
    setHasCode(false);
    if (!enabled || chainId !== TESTNET || !client || !isAddress(escrowAddress)) return;
    client.getCode({ address: escrowAddress }).then(code => {
      if (!cancelled) setHasCode(!!code && code !== '0x');
    }).catch(() => { if (!cancelled) setHasCode(false); });
    return () => { cancelled = true; };
  }, [chainId, client]);

  async function refresh() {
    if (!ready) return;
    try {
      const id = BigInt(tableId);
      const [info, current, amount, isVerified, walletBal] = await Promise.all([
        client.readContract({ address:escrowAddress, abi:ABI, functionName:'getTableInfo', args:[id] }).catch(() => null),
        client.readContract({ address:escrowAddress, abi:ABI, functionName:'getPlayerDeposit', args:[id,address] }),
        client.readContract({ address:escrowAddress, abi:ABI, functionName:'claimable', args:[address] }),
        client.readContract({ address:escrowAddress, abi:ABI, functionName:'humanVerified', args:[address] }),
        client.getBalance({ address }),
      ]);
      setTable(info);
      setDeposit(current);
      setCredit(amount);
      setVerified(isVerified);
      setNativeBalance(walletBal);
    } catch(e) { setStatus(e?.shortMessage || e?.message || 'Could not read testnet.'); }
  }

  useEffect(() => {
    if (ready) refresh();
    // Explicit Refresh button is also provided; polling intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tableId, address]);

  async function send(functionName, args=[], value) {
    if (!ready) { setStatus('Blocked: wrong chain, staging disabled, or no verified escrow bytecode.'); return; }
    try {
      setStatus(`Submitting ${functionName} on Elysium testnet…`);
      const tx = await writeContractAsync({ address:escrowAddress, abi:ABI, functionName, args,
        chainId:TESTNET, ...(value === undefined ? {} : { value }) });
      setStatus(`Awaiting testnet receipt: ${tx}`);
      const receipt = await client.waitForTransactionReceipt({ hash:tx, timeout:120000 });
      if (receipt.status !== 'success') throw Error('Transaction reverted');
      setStatus(`Confirmed on Elysium testnet: ${tx}`);
      await refresh();
    } catch(e) { setStatus(e?.shortMessage || e?.message || 'Testnet transaction failed.'); }
  }

  const id = /^[1-9][0-9]*$/.test(tableId) ? BigInt(tableId) : null;
  const btn = (title, action, disabled=false) =>
    <button type="button" style={{...styles.button, opacity: disabled?0.35:1}} disabled={disabled || !ready || !id} onClick={action}>{title}</button>;

  return (
    <main style={{maxWidth:760,margin:'30px auto',padding:20,color:'#f6f0df'}}>
      <h1>Elysium / HYPE — isolated escrow testnet</h1>
      <p style={{color:'#e8b16f'}}>QA ONLY. Not a real-money game, poker lobby or production deployment. Uses valueless Elysium testnet HYPE.</p>
      <section style={styles.box}>
        <p>Staging enabled: <b>{String(enabled)}</b> · Wallet chain: <b>{chainId || 'not connected'}</b> (required 99801)</p>
        <p>Connected wallet: <code>{address || 'Connect via the normal wallet bar'}</code></p>
        <p>Escrow code verified at configured address: <b>{String(hasCode)}</b></p>
        <p>Operator authorization: <b>{verified ? 'Testnet marked' : 'Not marked'}</b> · Native balance: {pretty(nativeBalance)} test HYPE</p>
        {!ready && <p style={{color:'#eb8c77'}}>Transactions are disabled until staging flags, wallet, testnet and a deployed escrow all match.</p>}
        <button style={styles.button} onClick={refresh} disabled={!ready}>Refresh read-only state</button>
      </section>

      <section style={styles.box}>
        <h2>Table inspection</h2>
        <label>On-chain table ID<input style={styles.input} value={tableId} onChange={e=>setTableId(e.target.value)} /></label>
        {table && Number(table[0])>0 && <>
          <p>Status: {['Open','Active','Closed'][Number(table[5])] || 'Unknown'} · seats: {Number(table[8])}/{Number(table[3])} · nonce: {table[7].toString()}</p>
          <p>Buy-in: {pretty(table[1])} test HYPE · big blind: {pretty(table[2])} · bankroll: {pretty(table[6])}</p>
          <p>Your on-chain bankroll: {pretty(deposit)} · claimable credit: {pretty(credit)}</p>
        </>}
        {ready && (!table || Number(table[0])===0) && <p>Table not deployed or not found.</p>}
        {btn('Pay table buy-in', ()=>send('buyIn',[id],table?.[1]), !table || Number(table[0])===0 || !verified || Number(table[5])!==0)}
        {btn('Refund open table', ()=>send('refund',[id]), !table || Number(table[5])!==0)}
        {btn('Activate 24h emergency exit', ()=>send('activateEmergency',[id]), !table || Number(table[5])===2)}
        {btn('Exit emergency table', ()=>send('emergencyCashOut',[id]), !table || Number(table[5])!==2)}
        <label>Rebuy amount (test HYPE)<input style={styles.input} value={rebuyValue} onChange={e=>setRebuyValue(e.target.value)}/></label>
        {btn('Rebuy', ()=>{try{const amount=parseEther(rebuyValue);return send('rebuy',[id,amount],amount)}catch{setStatus('Invalid rebuy amount')}}, !table || Number(table[5])!==1)}
        <button type="button" style={styles.button} disabled={!ready || credit===0n} onClick={()=>send('claim')}>Claim credited test HYPE</button>
      </section>

      <section style={styles.box}>
        <h2>Create a test table</h2>
        <label>Buy-in (test HYPE)<input style={styles.input} value={buyInValue} onChange={e=>setBuyInValue(e.target.value)}/></label>
        <label>Big blind (test HYPE)<input style={styles.input} value={bigBlindValue} onChange={e=>setBigBlindValue(e.target.value)}/></label>
        <button type="button" style={styles.button} disabled={!ready || !verified} onClick={()=>{
          try { return send('createTable',[parseEther(buyInValue),parseEther(bigBlindValue),2,0,0]); }
          catch {setStatus('Invalid HYPE decimal amount.');}
        }}>Create heads-up test table</button>
        <p style={{fontSize:12,opacity:.75}}>Test-only verification is controlled by the operator/oracle. No automated player onboarding or live poker settlement is enabled here.</p>
      </section>

      <p aria-live="polite" style={{overflowWrap:'anywhere'}}>{status}</p>
    </main>
  );
}
