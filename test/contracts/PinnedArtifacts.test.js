import { expect } from "chai";
import { readdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * scripts/artifacts/*.json are pinned ABI + bytecode, committed so the
 * standalone deploy scripts (deployHandle, redeployHandle, deployLottery) can
 * run without a Hardhat compile. Pinned bytecode silently going stale is the
 * worst kind of drift: the script deploys, succeeds, and ships the OLD contract.
 *
 * This bit for real — PokerHandle and HandleRenderer stayed pinned at their
 * pre-rebrand bytecode through the Saloon rename, so deploying from them would
 * have minted ERC-721s permanently named "PokerVsPlayer Handle" with
 * "POKERVSPLAYER" baked into the on-chain SVG. Name and symbol are immutable.
 *
 * Regenerate after any contract change:
 *   npm run compile && npm run sync:artifacts
 */
describe("pinned deploy artifacts", () => {
  const PINNED_DIR   = "scripts/artifacts";
  const COMPILED_DIR = "artifacts/contracts";

  const compiledPath = (name) => {
    for (const dir of readdirSync(COMPILED_DIR)) {
      const p = join(COMPILED_DIR, dir, `${name}.json`);
      if (existsSync(p)) return p;
    }
    return null;
  };

  const pinnedNames = readdirSync(PINNED_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(/\.json$/, ""));

  it("there are pinned artifacts to check", () => {
    expect(pinnedNames.length).to.be.greaterThan(0);
  });

  for (const name of pinnedNames) {
    it(`${name}: pinned bytecode matches the compiled contract`, () => {
      const p = compiledPath(name);
      expect(p, `no compiled artifact for ${name} — run npm run compile`).to.not.equal(null);
      const pinned   = JSON.parse(readFileSync(join(PINNED_DIR, `${name}.json`), "utf8"));
      const compiled = JSON.parse(readFileSync(p, "utf8"));
      expect(pinned.bytecode,
        `${name} is stale — run: npm run compile && npm run sync:artifacts`
      ).to.equal(compiled.bytecode);
    });

    it(`${name}: pinned ABI matches the compiled contract`, () => {
      const p = compiledPath(name);
      const pinned   = JSON.parse(readFileSync(join(PINNED_DIR, `${name}.json`), "utf8"));
      const compiled = JSON.parse(readFileSync(p, "utf8"));
      const names = a => a.filter(x => x.type === "function").map(x => x.name).sort();
      expect(names(pinned.abi),
        `${name} ABI is stale — run: npm run compile && npm run sync:artifacts`
      ).to.deep.equal(names(compiled.abi));
    });
  }

  it("no pinned artifact still carries a pre-rebrand string", () => {
    const stale = ["PokerVsPlayer", "POKERVSPLAYER", "PokerChips", "All In", "ALLIN"];
    for (const name of pinnedNames) {
      const { bytecode } = JSON.parse(readFileSync(join(PINNED_DIR, `${name}.json`), "utf8"));
      const text = Buffer.from(bytecode.slice(2), "hex").toString("latin1");
      for (const s of stale) {
        expect(text.includes(s), `${name} bytecode still contains "${s}"`).to.equal(false);
      }
    }
  });
});
