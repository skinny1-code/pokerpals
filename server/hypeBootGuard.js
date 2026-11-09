// Validates isolated Elysium testnet operation *before* opening any listener.
// No mainnet route and no signing of funds in this module.
const isAddress = value => typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
const same = (a,b) => isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();

export async function assertNativeHypeBootReady({
  provider, escrow, operatorAddress, escrowAddress, manifest,
}) {
  if (!manifest || manifest.chainId !== 99801 ||
      manifest.assetMode !== "NATIVE_HYPE_TEST_ONLY" ||
      !same(manifest.contracts?.NativeHypePokerEscrow, escrowAddress) ||
      !same(manifest.operatorSigner, operatorAddress) ||
      !isAddress(manifest.verificationOracle)) {
    throw new Error("HYPE_BOOT_MANIFEST_MISMATCH");
  }

  const [network, bytecode, signer, oracle] = await Promise.all([
    provider.getNetwork(),
    provider.getCode(escrowAddress),
    escrow.operatorSigner(),
    escrow.verificationOracle(),
  ]);
  if (BigInt(network.chainId) !== 99801n) throw new Error("HYPE_BOOT_RPC_CHAIN_MISMATCH");
  if (typeof bytecode !== "string" || bytecode === "0x" || !bytecode.startsWith("0x") ||
      bytecode.length < 4) throw new Error("HYPE_BOOT_MISSING_CODE");
  if (!same(signer, operatorAddress)) throw new Error("HYPE_BOOT_OPERATOR_MISMATCH");
  if (!same(oracle, manifest.verificationOracle)) throw new Error("HYPE_BOOT_ORACLE_MISMATCH");
  return { chainId: 99801n, escrowAddress, signer, oracle };
}
