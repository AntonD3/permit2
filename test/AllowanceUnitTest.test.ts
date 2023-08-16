import fs from "fs";
import { Wallet } from "zksync-web3";
import { deployContract, provider } from "./shared/zkSyncUtils";
import { MockERC20, MockPermit2 } from "../../typechain-types";
import { BigNumber, BigNumberish, ethers } from "ethers";
import { expect } from "./shared/expect";

const RICH_WALLET_PRIVATE_KEYS = JSON.parse(
  fs.readFileSync("test/shared/rich-wallets.json", "utf8")
);

function getRandomBigInt(length: number): BigNumber {
  return ethers.BigNumber.from(ethers.utils.randomBytes(length)).sub(1);
}
describe("AllowanceUnitTest", function () {
  const from: Wallet = new Wallet(
    RICH_WALLET_PRIVATE_KEYS[0].privateKey,
    provider
  );
  const spender: Wallet = new Wallet(
    RICH_WALLET_PRIVATE_KEYS[1].privateKey,
    provider
  );

  let permit2: MockPermit2;
  let token: MockERC20;

  beforeEach(async function () {
    permit2 = <MockPermit2>await deployContract("MockPermit2");
    token = <MockERC20>(
      await deployContract("MockERC20", [
        "Test1",
        "TEST1",
        ethers.BigNumber.from(18),
      ])
    );
  });

  describe("Test Update Amount Expiration Randomly", function () {
    it("should update allowance", async function () {
      let amount: BigNumberish = getRandomBigInt(20);
      let expiration: BigNumberish = getRandomBigInt(6);

      let allowanceResult = await permit2
        .connect(from)
        .allowance(from.address, token.address, spender.address);

      await (
        await permit2.mockUpdateAmountAndExpiration(
          from.address,
          token.address,
          spender.address,
          amount,
          expiration
        )
      ).wait();

      let timestamp: BigNumberish = (await provider.getBlock("latest"))
        .timestamp;
      let timestampAfterUpdate: BigNumberish = expiration.eq(
        ethers.constants.Zero
      )
        ? timestamp
        : expiration;
      let allowanceResultAfter = await permit2
        .connect(from)
        .allowance(from.address, token.address, spender.address);

      expect(allowanceResultAfter.amount).to.be.equal(amount);
      expect(timestampAfterUpdate).to.be.equal(expiration);
      expect(allowanceResultAfter.nonce).to.be.equal(allowanceResult.nonce);
    });
  });

  describe("Test Update All Randomly", function () {
    it("should update randomly", async function () {
      let amount: BigNumberish = getRandomBigInt(20);
      let expiration: BigNumberish = getRandomBigInt(6);
      let nonce: BigNumberish = getRandomBigInt(6);

      await (
        await permit2.mockUpdateAll(
          from.address,
          token.address,
          spender.address,
          amount,
          expiration,
          nonce
        )
      ).wait();

      let nonceAfterUpdate: BigNumber = nonce.add(ethers.constants.One);

      let timestamp: BigNumberish = (await provider.getBlock("latest"))
        .timestamp;
      let timestampAfterUpdate: BigNumberish = expiration.eq(
        ethers.constants.Zero
      )
        ? timestamp
        : expiration;

      let allowanceResultAfter = await permit2
        .connect(from)
        .allowance(from.address, token.address, spender.address);

      expect(allowanceResultAfter.amount).to.be.equal(amount);
      expect(timestampAfterUpdate).to.be.equal(expiration);
      expect(allowanceResultAfter.nonce).to.be.equal(nonceAfterUpdate);
    });
  });

  describe("Test Pack And Unpack", function () {
    it("should pass the pack and unpack", async function () {
      let amount: BigNumberish = getRandomBigInt(20);
      let expiration: BigNumberish = getRandomBigInt(6);
      let nonce: BigNumberish = getRandomBigInt(6);

      let word: BigNumberish = nonce
        .shl(208)
        .or(expiration.shl(160).or(amount));

      await (
        await permit2.doStore(
          from.address,
          token.address,
          spender.address,
          word
        )
      ).wait();

      let allowanceResultAfter = await permit2
        .connect(from)
        .allowance(from.address, token.address, spender.address);

      expect(allowanceResultAfter.amount).to.be.equal(amount);
      expect(allowanceResultAfter.expiration).to.be.equal(expiration);
      expect(allowanceResultAfter.nonce).to.be.equal(nonce);

      let wordFromStore = await permit2.getStore(
        from.address,
        token.address,
        spender.address
      );

      expect(wordFromStore).to.be.equal(word);
    });
  });
});
