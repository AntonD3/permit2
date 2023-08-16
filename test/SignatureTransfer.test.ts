import { BigNumber, BigNumberish, ethers } from "ethers";
import { MockERC20, Permit2 } from "../../typechain-types";
import { deployContract, provider } from "./shared/zkSyncUtils";
import { Wallet } from "zksync-web3";
import fs from "fs";
import { expect } from "./shared/expect";
import {
  getCompactPermitTransferSignature,
  getPermitBatchTransferSignature,
  getPermitBatchWitnessSignature,
  getPermitTransferSignature,
  getPermitWitnessTransferSignature,
  MockWitness,
  PermitBatchTransferFrom,
  PermitTransferFrom,
  SignatureTransferDetails,
  TokenPermissions,
} from "./utils/PermitSignature";

const RICH_WALLET_PRIVATE_KEYS = JSON.parse(
  fs.readFileSync("test/shared/rich-wallets.json", "utf8")
);

describe("SignatureTransferTest", function () {
  const DECIMAL_MULT: BigNumber = ethers.BigNumber.from(10).pow(
    ethers.BigNumber.from(18)
  );

  const _PERMIT_TRANSFER_TYPEHASH_STUB =
    "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,";
  const _PERMIT_BATCH_WITNESS_TRANSFER_TYPEHASH_STUB =
    "PermitBatchWitnessTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline,";
  const WITNESS_TYPE_STRING =
    "MockWitness witness)MockWitness(uint256 value,address person,bool test)TokenPermissions(address token,uint256 amount)";
  const FULL_EXAMPLE_WITNESS_TYPEHASH: string = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(
      "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,MockWitness witness)MockWitness(uint256 value,address person,bool test)TokenPermissions(address token,uint256 amount)"
    )
  );
  const FULL_EXAMPLE_WITNESS_BATCH_TYPEHASH: string = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(
      "PermitBatchWitnessTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline,MockWitness witness)MockWitness(uint256 value,address person,bool test)TokenPermissions(address token,uint256 amount)"
    )
  );

  let token0: MockERC20;
  let token1: MockERC20;
  let permit2: Permit2;
  let owner: Wallet;
  let ownerDirty: Wallet;
  let spender: Wallet;
  let receiver: Wallet;
  let dirtyNonce: BigNumber = ethers.constants.One;
  let defaultAmount: BigNumber = DECIMAL_MULT.mul(10);
  let fromPrivateKey: string;
  let fromPrivateKeyDirty: string;
  let DOMAIN_SEPARATOR: string;

  fromPrivateKey = RICH_WALLET_PRIVATE_KEYS[0].privateKey;
  fromPrivateKeyDirty = RICH_WALLET_PRIVATE_KEYS[3].privateKey;

  owner = new Wallet(fromPrivateKey, provider);
  ownerDirty = new Wallet(fromPrivateKeyDirty, provider);

  spender = new Wallet(RICH_WALLET_PRIVATE_KEYS[1].privateKey, provider);
  receiver = new Wallet(RICH_WALLET_PRIVATE_KEYS[2].privateKey, provider);

  beforeEach(async function () {
    permit2 = <Permit2>await deployContract("Permit2");

    token0 = <MockERC20>(
      await deployContract("MockERC20", [
        "Test0",
        "TEST0",
        ethers.BigNumber.from(18),
      ])
    );
    token1 = <MockERC20>(
      await deployContract("MockERC20", [
        "Test1",
        "TEST1",
        ethers.BigNumber.from(18),
      ])
    );

    DOMAIN_SEPARATOR = await permit2.DOMAIN_SEPARATOR();

    await mint(owner.address, owner);
    await mint(ownerDirty.address, ownerDirty);

    await approve(permit2.address, owner);
    await approve(permit2.address, ownerDirty);

    await (
      await permit2
        .connect(ownerDirty)
        .invalidateNonces(token0.address, spender.address, dirtyNonce)
    ).wait();
    await (
      await permit2
        .connect(ownerDirty)
        .invalidateNonces(token1.address, spender.address, dirtyNonce)
    ).wait();
  });

  async function mint(address: string, from: Wallet) {
    await (
      await token0
        .connect(from)
        .mint(address, defaultAmount.mul(ethers.BigNumber.from(10000)))
    ).wait();
    await (
      await token1
        .connect(from)
        .mint(address, defaultAmount.mul(ethers.BigNumber.from(10000)))
    ).wait();
  }

  async function approve(address: string, from: Wallet) {
    await (
      await token0.connect(from).approve(address, ethers.constants.MaxUint256)
    ).wait();
    await (
      await token1.connect(from).approve(address, ethers.constants.MaxUint256)
    ).wait();
  }

  describe("Test Correct Witness Typehashes", function () {
    it("should correct computing typehashes", async function () {
      expect(
        ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["string", "string"],
            [_PERMIT_TRANSFER_TYPEHASH_STUB, WITNESS_TYPE_STRING]
          )
        )
      ).to.be.equal(FULL_EXAMPLE_WITNESS_TYPEHASH);

      expect(
        ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["string", "string"],
            [_PERMIT_BATCH_WITNESS_TRANSFER_TYPEHASH_STUB, WITNESS_TYPE_STRING]
          )
        )
      ).to.be.equal(FULL_EXAMPLE_WITNESS_BATCH_TYPEHASH);
    });
  });

  describe("Test Permit TransferFrom", function () {
    let permit: PermitTransferFrom;
    let sign: ethers.utils.BytesLike;
    let startBalanceFrom: BigNumber;
    let startBalanceTo: BigNumber;
    let transferDetails: SignatureTransferDetails;

    it("should correct work transferFrom", async function () {
      permit = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      sign = getPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      startBalanceFrom = await token0.connect(owner).balanceOf(owner.address);
      startBalanceTo = await token0.connect(owner).balanceOf(receiver.address);

      transferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sign)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo.add(defaultAmount));
    });
  });

  describe("Test Permit TransferFrom CompactSig", function () {
    it("should correct work transferFrom with compact signature ", async function () {
      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      let sig: Uint8Array = getCompactPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      expect(sig.length).to.be.equal(64);

      let startBalanceFrom: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);

      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sig)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo.add(defaultAmount));
    });
  });

  describe("Test Permit TransferFrom Incorrect Sig Length", function () {
    it("should revert transferFrom if sig length was incorrect", async function () {
      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      let sig: ethers.utils.BytesLike = getPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );
      let sigExtra: Uint8Array = ethers.utils.concat([
        sig,
        ethers.utils.toUtf8Bytes("123"),
      ]);
      expect(sigExtra.length).to.be.equal(68);

      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };

      await expect(
        permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sigExtra)
      ).to.be.revertedWithCustomError(permit2, "InvalidSignatureLength");
    });
  });

  describe("Test Permit TransferFrom To Spender", function () {
    it("should correct work transferFrom to spender ", async function () {
      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };
      let sign: ethers.utils.BytesLike = getPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let startBalanceFrom: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo: BigNumberish = await token0
        .connect(owner)
        .balanceOf(ethers.constants.AddressZero);

      let transferDetails: SignatureTransferDetails = {
        to: ethers.constants.AddressZero,
        requestedAmount: defaultAmount,
      };

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sign)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(ethers.constants.AddressZero)
      ).to.be.equal(startBalanceTo.add(defaultAmount));
    });
  });

  describe("Test Permit TransferFrom Invalid Nonce", function () {
    it("should revert transferFrom with invalid nonce ", async function (): Promise<void> {
      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      let sign: ethers.utils.BytesLike = getPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };
      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sign)
      ).wait();

      await expect(
        permit2
          .connect(owner)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sign)
      ).to.be.revertedWithCustomError(permit2, "InvalidNonce");
    });
  });

  describe("Test Permit TransferFrom Random Nonce And Amount", function () {
    it("should correct work transferFrom with random nonce and amount ", async function () {
      let nonce: BigNumberish = ethers.BigNumber.from(
        Math.floor(Math.random() * 100)
      );
      let amount: BigNumberish = ethers.BigNumber.from(
        Math.floor(Math.random() * 100)
      ).mul(DECIMAL_MULT);

      await (await token0.connect(owner).mint(owner.address, amount)).wait();

      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: amount,
        },
        nonce: nonce,
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };
      permit.permitted.amount = amount;
      let sign: ethers.utils.BytesLike = getPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let startBalanceFrom: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);
      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: amount,
      };

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sign)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom.sub(amount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo.add(amount));
    });
  });

  describe("Test Permit Transfer Spend Less Than Full", function () {
    it("should correct work transferFrom if spend less than full ", async function () {
      let nonce = ethers.BigNumber.from(Math.floor(Math.random() * 100));
      let amount = ethers.BigNumber.from(Math.floor(Math.random() * 100)).mul(
        DECIMAL_MULT
      );

      await (await token0.connect(owner).mint(owner.address, amount)).wait();

      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: amount,
        },
        nonce: nonce,
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      let sign = getPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let startBalanceFrom = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo = await token0
        .connect(owner)
        .balanceOf(receiver.address);

      let amountToSpend = amount.div(ethers.BigNumber.from(2));

      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: amountToSpend,
      };

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sign)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom.sub(amountToSpend)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo.add(amountToSpend));
    });
  });

  describe("Test Permit Batch TransferFrom", function () {
    it("should correct work permitBatch transferFrom ", async function () {
      let permit: PermitBatchTransferFrom = {
        permitted: [
          { token: token0.address, amount: defaultAmount },
          { token: token1.address, amount: defaultAmount },
        ],
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };
      let sig = getPermitBatchTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let toAmountPairs: SignatureTransferDetails[] = [
        {
          requestedAmount: defaultAmount,
          to: receiver.address,
        },
        {
          requestedAmount: defaultAmount,
          to: ethers.constants.AddressZero,
        },
      ];

      let startBalanceFrom0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceFrom1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);
      let startBalanceTo1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(ethers.constants.AddressZero);

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"
          ](permit, toAmountPairs, owner.address, sig)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom0.sub(defaultAmount)
      );
      expect(await token1.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom1.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo0.add(defaultAmount));
      expect(
        await token1.connect(owner).balanceOf(ethers.constants.AddressZero)
      ).to.be.equal(startBalanceTo1.add(defaultAmount));
    });
  });

  describe("Test Permit Batch Multi Permit Single Transfer", function () {
    it("should correct work permitBatch multi single transfer ", async function () {
      let permit: PermitBatchTransferFrom = {
        permitted: [
          { token: token0.address, amount: defaultAmount },
          { token: token1.address, amount: defaultAmount },
        ],
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let toAmountPairs: SignatureTransferDetails[] = [
        {
          requestedAmount: ethers.constants.Zero,
          to: ethers.constants.AddressZero,
        },
        {
          requestedAmount: defaultAmount,
          to: ethers.constants.AddressZero,
        },
      ];

      let startBalanceFrom0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceFrom1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);
      let startBalanceTo1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(ethers.constants.AddressZero);

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"
          ](permit, toAmountPairs, owner.address, sig)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom0
      );
      expect(await token1.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom1.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equals(startBalanceTo0);
      expect(
        await token1.connect(owner).balanceOf(ethers.constants.AddressZero)
      ).to.be.equal(startBalanceTo1.add(defaultAmount));
    });
  });

  describe("Test Permit Batch TransferFrom Single Recipient", function () {
    it("should correct work permitBatch single recipient ", async function () {
      let permit: PermitBatchTransferFrom = {
        permitted: [
          { token: token0.address, amount: defaultAmount },
          { token: token1.address, amount: defaultAmount },
        ],
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let toAmountPairs: SignatureTransferDetails[] = [
        {
          requestedAmount: defaultAmount,
          to: receiver.address,
        },
        { requestedAmount: defaultAmount, to: receiver.address },
      ];

      let startBalanceFrom0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceFrom1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);
      let startBalanceTo1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(receiver.address);

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"
          ](permit, toAmountPairs, owner.address, sig)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom0.sub(defaultAmount)
      );
      expect(await token1.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom1.sub(defaultAmount)
      );
      expect(
        await token1.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo0.add(defaultAmount));
      expect(
        await token1.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo1.add(defaultAmount));
    });
  });

  describe("Test Permit Batch Transfer Multi Addr", function () {
    it("should correct work permitBatch multi address ", async function () {
      let permit: PermitBatchTransferFrom = {
        permitted: [
          { token: token0.address, amount: defaultAmount },
          { token: token1.address, amount: defaultAmount },
        ],
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );
      let startBalanceFrom0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceFrom1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(spender.address);
      let startBalanceTo1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(receiver.address);

      let toAmountPairs: SignatureTransferDetails[] = [
        {
          requestedAmount: defaultAmount,
          to: spender.address,
        },
        { requestedAmount: defaultAmount, to: receiver.address },
      ];

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"
          ](permit, toAmountPairs, owner.address, sig)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom0.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(spender.address)
      ).to.be.equal(startBalanceTo0.add(defaultAmount));
      expect(await token1.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom1.sub(defaultAmount)
      );
      expect(
        await token1.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo1.add(defaultAmount));
    });
  });

  describe("Test PermitBatch Transfer Single Recipient Many Tokens", function () {
    it("should correct work permitBatch single recipient many tokens ", async function () {
      await (
        await token0
          .connect(owner)
          .mint(owner.address, defaultAmount.mul(ethers.BigNumber.from(12)))
      ).wait();
      let tokenPermissions: TokenPermissions[] = [];
      for (let i: number = 0; i < 10; i++) {
        tokenPermissions.push({ token: token0.address, amount: defaultAmount });
      }

      let permit: PermitBatchTransferFrom = {
        permitted: tokenPermissions,
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchTransferSignature(
        spender.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let startBalanceFrom0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(spender.address);

      let toAmountPairs: SignatureTransferDetails[] = [];
      for (let i: number = 0; i < 10; i++) {
        toAmountPairs.push({
          requestedAmount: defaultAmount,
          to: spender.address,
        });
      }

      await (
        await permit2
          .connect(spender)
          [
            "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"
          ](permit, toAmountPairs, owner.address, sig)
      ).wait();

      expect(await token0.balanceOf(owner.address)).to.be.equal(
        startBalanceFrom0.sub(defaultAmount.mul(ethers.BigNumber.from(10)))
      );
      expect(await token0.balanceOf(spender.address)).to.be.equal(
        startBalanceTo0.add(defaultAmount.mul(ethers.BigNumber.from(10)))
      );
    });
  });

  describe("Test PermitBatchTransfer Invalid Amounts Length Mismatch", function () {
    it("should revert permitBatch invalid amounts length mismatch ", async function () {
      let tokens: string[] = [token0.address, token0.address];
      let tokenPermissions: TokenPermissions[] = [];

      for (let i: number = 0; i < tokens.length; i++) {
        tokenPermissions.push({ token: tokens[i], amount: defaultAmount });
      }

      let permit: PermitBatchTransferFrom = {
        permitted: tokenPermissions,
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchTransferSignature(
        spender.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );
      let toAmountPairs: SignatureTransferDetails[] = [
        { requestedAmount: defaultAmount, to: spender.address },
      ];

      await expect(
        permit2
          .connect(owner)
          [
            "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"
          ](permit, toAmountPairs, owner.address, sig)
      ).to.be.revertedWithCustomError(permit2, "LengthMismatch");
    });
  });

  describe("Test Gas SinglePermit TransferFrom", function () {
    it("should work permitBatch ", async function () {
      let permit: PermitTransferFrom = {
        permitted: { token: token0.address, amount: defaultAmount },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sign: ethers.utils.BytesLike = getPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let startBalanceFrom: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);

      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sign)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo.add(defaultAmount));
    });
  });

  describe("Test Gas Single Permit Batch Transfer From", function () {
    it("should work permitBatch transferFrom ", async function () {
      let permit: PermitBatchTransferFrom = {
        permitted: [{ token: token0.address, amount: defaultAmount }],
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let toAmountPairs: SignatureTransferDetails[] = [
        { requestedAmount: defaultAmount, to: receiver.address },
      ];

      let startBalanceFrom0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"
          ](permit, toAmountPairs, owner.address, sig)
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom0.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo0.add(defaultAmount));
    });
  });

  describe("Test Gas Multiple PermitBatchTransferFrom", function () {
    it("should work multiple permitBatchTransferFrom ", async function () {
      let tokens: string[] = [token0.address, token1.address, token1.address];
      let tokenPermissions: TokenPermissions[] = [];

      for (let i: number = 0; i < tokens.length; i++) {
        tokenPermissions.push({ token: tokens[i], amount: defaultAmount });
      }

      let permit: PermitBatchTransferFrom = {
        permitted: tokenPermissions,
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let to: string[] = [receiver.address, receiver.address, spender.address];

      let toAmountPairs: SignatureTransferDetails[] = [];

      for (let i: number = 0; i < to.length; i++) {
        toAmountPairs.push({ requestedAmount: defaultAmount, to: to[i] });
      }

      let startBalanceFrom0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceFrom1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);
      let startBalanceTo1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(receiver.address);
      let startBalanceToThis1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(spender.address);

      await (
        await permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes)"
          ](permit, toAmountPairs, owner.address, sig)
      ).wait();

      expect(await token0.balanceOf(owner.address)).to.be.equal(
        startBalanceFrom0.sub(defaultAmount)
      );
      expect(await token1.balanceOf(receiver.address)).to.be.equal(
        startBalanceTo0.add(defaultAmount)
      );
      expect(await token1.balanceOf(owner.address)).to.be.equal(
        startBalanceFrom1.sub(ethers.constants.Two.mul(defaultAmount))
      );
      expect(await token1.balanceOf(receiver.address)).to.be.equal(
        startBalanceTo1.add(defaultAmount)
      );
      expect(await token1.balanceOf(spender.address)).to.be.equal(
        startBalanceToThis1.add(defaultAmount)
      );
    });
  });

  describe("Test Permit Batch TransferFrom Typed Witness", function () {
    it("should work permitBatchTransferFrom with typed witness ", async function () {
      let witnessData: MockWitness = {
        value: ethers.BigNumber.from(10000000),
        person: ethers.utils.computeAddress(
          "0xaf129e76043751847d86f5c46635f839b4e017348204075f198496c0ac11b40c"
        ),
        test: true,
      };

      let witness: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "bool"],
          [witnessData.value, witnessData.person, witnessData.test]
        )
      );
      let tokens: string[] = [token0.address, token1.address];

      let tokenPermissions: TokenPermissions[] = [];
      for (let i: number = 0; i < tokens.length; i++) {
        tokenPermissions.push({ token: tokens[i], amount: defaultAmount });
      }

      let permit: PermitBatchTransferFrom = {
        permitted: tokenPermissions,
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchWitnessSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        FULL_EXAMPLE_WITNESS_BATCH_TYPEHASH,
        witness,
        DOMAIN_SEPARATOR
      );

      let to: string[] = [receiver.address, ethers.constants.AddressZero];

      let toAmountPairs: SignatureTransferDetails[] = [
        {
          requestedAmount: defaultAmount,
          to: to[0],
        },
        {
          requestedAmount: defaultAmount,
          to: to[1],
        },
      ];

      let startBalanceFrom0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceFrom1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo0: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);
      let startBalanceTo1: BigNumberish = await token1
        .connect(owner)
        .balanceOf(ethers.constants.AddressZero);

      await (
        await permit2
          .connect(receiver)
          [
            "permitWitnessTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes32,string,bytes)"
          ](
            permit,
            toAmountPairs,
            owner.address,
            witness,
            WITNESS_TYPE_STRING,
            sig
          )
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom0.sub(defaultAmount)
      );
      expect(await token1.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom1.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo0.add(defaultAmount));
      expect(
        await token1.connect(owner).balanceOf(ethers.constants.AddressZero)
      ).to.be.equal(startBalanceTo1.add(defaultAmount));
    });
  });

  describe("Test PermitBatchTransferFromTypedWitness Invalid Type", function () {
    it("should revert PermitBatchTransferFromTypedWitness with invalid type ", async function () {
      let witnessData: MockWitness = {
        value: 10000000,
        person: ethers.utils.computeAddress(
          "0xaf129e76043751847d86f5c46635f839b4e017348204075f198496c0ac11b40c"
        ),
        test: true,
      };

      let witness: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "bool"],
          [witnessData.value, witnessData.person, witnessData.test]
        )
      );
      let tokens: string[] = [token0.address, token1.address];

      let tokenPermissions: TokenPermissions[] = [];
      for (let i: number = 0; i < tokens.length; i++) {
        tokenPermissions.push({ token: tokens[i], amount: defaultAmount });
      }

      let permit: PermitBatchTransferFrom = {
        permitted: tokenPermissions,
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchWitnessSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        FULL_EXAMPLE_WITNESS_BATCH_TYPEHASH,
        witness,
        DOMAIN_SEPARATOR
      );

      let to: string[] = [receiver.address, ethers.constants.AddressZero];
      let toAmountPairs: SignatureTransferDetails[] = [
        {
          requestedAmount: defaultAmount,
          to: to[0],
        },
        { requestedAmount: defaultAmount, to: to[1] },
      ];

      await expect(
        permit2
          .connect(receiver)
          [
            "permitWitnessTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes32,string,bytes)"
          ](permit, toAmountPairs, owner.address, witness, "fake type", sig)
      ).to.be.revertedWithCustomError(permit2, "InvalidSigner");
    });
  });

  describe("Test Permit Batch Transfer From Typed Witness Invalid TypeHash", function () {
    it("should revert PermitBatchTransferFromTypedWitness with invalid typehash ", async function () {
      let witnessData: MockWitness = {
        value: 10000000,
        person: ethers.utils.computeAddress(
          "0xaf129e76043751847d86f5c46635f839b4e017348204075f198496c0ac11b40c"
        ),
        test: true,
      };
      let witness: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "bool"],
          [witnessData.value, witnessData.person, witnessData.test]
        )
      );

      let tokens: string[] = [token0.address, token1.address];
      let tokenPermissions: TokenPermissions[] = [];
      for (let i: number = 0; i < tokens.length; i++) {
        tokenPermissions.push({ token: tokens[i], amount: defaultAmount });
      }

      let permit: PermitBatchTransferFrom = {
        permitted: tokenPermissions,
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchWitnessSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("fake type")),
        witness,
        DOMAIN_SEPARATOR
      );

      let to: string[] = [receiver.address, ethers.constants.AddressZero];

      let toAmountPairs: SignatureTransferDetails[] = [
        {
          requestedAmount: defaultAmount,
          to: to[0],
        },
        { requestedAmount: defaultAmount, to: to[1] },
      ];

      await expect(
        permit2
          .connect(receiver)
          [
            "permitWitnessTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes32,string,bytes)"
          ](
            permit,
            toAmountPairs,
            owner.address,
            witness,
            WITNESS_TYPE_STRING,
            sig
          )
      ).to.be.revertedWithCustomError(permit2, "InvalidSigner");
    });
  });

  describe("Test PermitBatchTransferFromTypedWitness Invalid Witness", function () {
    it("should revert PermitBatchTransferFromTypedWitness with invalid witness ", async function () {
      let witnessData: MockWitness = {
        value: 10000000,
        person: ethers.utils.computeAddress(
          "0xaf129e76043751847d86f5c46635f839b4e017348204075f198496c0ac11b40c"
        ),
        test: true,
      };
      let witness: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "bool"],
          [witnessData.value, witnessData.person, witnessData.test]
        )
      );

      let tokens: string[] = [token0.address, token1.address];
      let tokenPermissions: TokenPermissions[] = [];
      for (let i: number = 0; i < tokens.length; i++) {
        tokenPermissions.push({ token: tokens[i], amount: defaultAmount });
      }

      let permit: PermitBatchTransferFrom = {
        permitted: tokenPermissions,
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 5000000),
      };

      let sig: ethers.utils.BytesLike = getPermitBatchWitnessSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        FULL_EXAMPLE_WITNESS_BATCH_TYPEHASH,
        witness,
        DOMAIN_SEPARATOR
      );

      let to: string[] = [receiver.address, ethers.constants.AddressZero];

      let toAmountPairs: SignatureTransferDetails[] = [
        {
          requestedAmount: defaultAmount,
          to: to[0],
        },
        { requestedAmount: defaultAmount, to: to[1] },
      ];

      await expect(
        permit2
          .connect(receiver)
          [
            "permitWitnessTransferFrom(((address,uint256)[],uint256,uint256),(address,uint256)[],address,bytes32,string,bytes)"
          ](
            permit,
            toAmountPairs,
            owner.address,
            ethers.utils.keccak256(
              ethers.utils.solidityPack(
                ["bytes32"],
                [ethers.utils.formatBytes32String("bad witness")]
              )
            ),
            WITNESS_TYPE_STRING,
            sig
          )
      ).to.be.revertedWithCustomError(permit2, "InvalidSigner");
    });
  });

  describe("Test Invalidate Unordered Nonces", function () {
    it("should revert with invalid nonces ", async function () {
      let nonce: BigNumberish = ethers.constants.Zero;
      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: nonce,
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      let sign: ethers.utils.BytesLike = getPermitTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        DOMAIN_SEPARATOR
      );

      let bitmap: BigNumberish = await permit2
        .connect(owner)
        .nonceBitmap(owner.address, nonce);
      expect(bitmap).to.be.equals(ethers.constants.Zero);

      await expect(permit2.connect(owner).invalidateUnorderedNonces(nonce, 1))
        .to.emit(permit2, "UnorderedNonceInvalidation")
        .withArgs(owner.address, nonce, 1);
      bitmap = await permit2.connect(owner).nonceBitmap(owner.address, nonce);
      expect(bitmap).to.be.equals(ethers.constants.One);

      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };

      await expect(
        permit2
          .connect(receiver)
          [
            "permitTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes)"
          ](permit, transferDetails, owner.address, sign)
      ).to.be.revertedWithCustomError(permit2, "InvalidNonce");
    });
  });

  describe("Test PermitTransferFromTypedWitness", function () {
    it("should work permitBatchTransferFrom with typed witness ", async function () {
      let witnessData: MockWitness = {
        value: 10000000,
        person: ethers.utils.computeAddress(
          "0xaf129e76043751847d86f5c46635f839b4e017348204075f198496c0ac11b40c"
        ),
        test: true,
      };
      let witness: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "bool"],
          [witnessData.value, witnessData.person, witnessData.test]
        )
      );

      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      let sig: ethers.utils.BytesLike = getPermitWitnessTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        FULL_EXAMPLE_WITNESS_TYPEHASH,
        witness,
        DOMAIN_SEPARATOR
      );

      let startBalanceFrom: BigNumberish = await token0
        .connect(owner)
        .balanceOf(owner.address);
      let startBalanceTo: BigNumberish = await token0
        .connect(owner)
        .balanceOf(receiver.address);

      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };

      await (
        await permit2
          .connect(receiver)
          [
            "permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes)"
          ](
            permit,
            transferDetails,
            owner.address,
            witness,
            WITNESS_TYPE_STRING,
            sig
          )
      ).wait();

      expect(await token0.connect(owner).balanceOf(owner.address)).to.be.equal(
        startBalanceFrom.sub(defaultAmount)
      );
      expect(
        await token0.connect(owner).balanceOf(receiver.address)
      ).to.be.equal(startBalanceTo.add(defaultAmount));
    });
  });

  describe("Test Permit Transfer From Typed Witness Invalid Type", function () {
    it("should revert permitBatchTransferFromTyped Witness with invalid type ", async function () {
      let witnessData: MockWitness = {
        value: 10000000,
        person: ethers.utils.computeAddress(
          "0xaf129e76043751847d86f5c46635f839b4e017348204075f198496c0ac11b40c"
        ),
        test: true,
      };

      let witness: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "bool"],
          [witnessData.value, witnessData.person, witnessData.test]
        )
      );
      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      let sig: ethers.utils.BytesLike = getPermitWitnessTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        FULL_EXAMPLE_WITNESS_TYPEHASH,
        witness,
        DOMAIN_SEPARATOR
      );
      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };

      await expect(
        permit2
          .connect(receiver)
          [
            "permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes)"
          ](
            permit,
            transferDetails,
            owner.address,
            witness,
            ethers.utils.formatBytes32String("fake typedef"),
            sig
          )
      ).to.be.revertedWithCustomError(permit2, "InvalidSigner");
    });
  });

  describe("Test PermitTransferFromTypedWitness Invalid Typehash", function () {
    it("should revert permitTransferTypedWitness with invalid typehash ", async function () {
      let witnessData: MockWitness = {
        value: 10000000,
        person: ethers.utils.computeAddress(
          "0xaf129e76043751847d86f5c46635f839b4e017348204075f198496c0ac11b40c"
        ),
        test: true,
      };

      let witness: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256", "address", "bool"],
          [witnessData.value, witnessData.person, witnessData.test]
        )
      );
      let permit: PermitTransferFrom = {
        permitted: {
          token: token0.address,
          amount: defaultAmount,
        },
        nonce: await owner.getNonce(),
        deadline: ethers.BigNumber.from(Date.now() + 50000),
      };

      let sig: ethers.utils.BytesLike = getPermitWitnessTransferSignature(
        receiver.address,
        permit,
        fromPrivateKey,
        ethers.utils.formatBytes32String("fake typehash"),
        witness,
        DOMAIN_SEPARATOR
      );
      let transferDetails: SignatureTransferDetails = {
        to: receiver.address,
        requestedAmount: defaultAmount,
      };

      await expect(
        permit2
          .connect(owner)
          [
            "permitWitnessTransferFrom(((address,uint256),uint256,uint256),(address,uint256),address,bytes32,string,bytes)"
          ](
            permit,
            transferDetails,
            owner.address,
            witness,
            WITNESS_TYPE_STRING,
            sig
          )
      ).to.be.revertedWithCustomError(permit2, "InvalidSigner");
    });
  });
});
