// Testnet-only endpoint: marks a wallet address as human-verified on PokerEscrow.
// Called by the table page when a player can't buy in due to humanVerified == false.
// On mainnet, human verification goes through the antibot oracle process instead.
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const MARK_HUMAN_ABI = parseAbi([
  'function markHuman(address player, bool status) external',
  'function humanVerified(address) external view returns (bool)',
]);

export async function POST(req) {
  // Fail closed: only serve on explicit testnet chain ID
  if (process.env.NEXT_PUBLIC_CHAIN_ID !== '421614') {
    return Response.json({ error: 'Verification via API only available on testnet' }, { status: 403 });
  }

  const deployerKey = process.env.DEPLOYER_KEY;
  const rpc         = process.env.ARB_SEPOLIA_RPC;
  const escrowAddr  = process.env.NEXT_PUBLIC_ESCROW;

  if (!deployerKey || !escrowAddr) {
    return Response.json({ error: 'Server not configured (DEPLOYER_KEY or NEXT_PUBLIC_ESCROW missing)' }, { status: 500 });
  }

  let address;
  try {
    ({ address } = await req.json());
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: 'Invalid Ethereum address' }, { status: 400 });
  }

  try {
    const transport   = http(rpc || 'https://sepolia-rollup.arbitrum.io/rpc');
    const key         = deployerKey.startsWith('0x') ? deployerKey : `0x${deployerKey}`;
    const account     = privateKeyToAccount(key);
    const wallet      = createWalletClient({ account, chain: arbitrumSepolia, transport });
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });

    const hash = await wallet.writeContract({
      address:      escrowAddr,
      abi:          MARK_HUMAN_ABI,
      functionName: 'markHuman',
      args:         [address, true],
    });

    // Wait for the tx to be mined so success === humanVerified on-chain
    await publicClient.waitForTransactionReceipt({ hash });

    return Response.json({ success: true, hash });
  } catch (e) {
    return Response.json({ error: e.shortMessage || e.message }, { status: 500 });
  }
}
