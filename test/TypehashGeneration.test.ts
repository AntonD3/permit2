import { BigNumber, ethers } from "ethers";
import {
  PermitBatchTransferFrom,
  PermitDetails,
  PermitSingle,
  PermitTransferFrom,
  signDigest,
  TokenPermissions,
} from "./utils/PermitSignature";
import { deployContract, provider } from "./shared/zkSyncUtils";
import { Wallet } from "zksync-web3";
import { expect } from "./shared/expect";
import { PermitHashMock } from "../../typechain-types";
import fs from "fs";

const RICH_WALLET_PRIVATE_KEYS = JSON.parse(
  fs.readFileSync("test/shared/rich-wallets.json", "utf8")
);
class MockWitness {
  constructor(person: string, amount: BigNumber) {
    this.person = person;
    this.amount = amount;
  }
  person: string;
  amount: BigNumber;
}
describe("TypehashGeneration", function () {
  const WITNESS_TYPE_HASH = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("MockWitness(address person,uint256 amount)")
  );
  const PRIVATE_KEY_OWNER = RICH_WALLET_PRIVATE_KEYS[0].privateKey;
  const PRIVATE_KEY_SPENDER = RICH_WALLET_PRIVATE_KEYS[1].privateKey;

  let from: string;
  let verifyingContract: string;
  let chainId: number;
  let token1: string;
  let token2: string;
  let spender: string;
  let amount: BigNumber;
  let expiration: number;
  let sigDeadline: BigNumber;
  let nonce: BigNumber;
  let DOMAIN_SEPARATOR: string;
  let hashLib: PermitHashMock;
  let wallet: Wallet;
  let person: string;

  before(async function () {
    from = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    verifyingContract = "0xCe71065D4017F316EC606Fe4422e11eB2c47c246";
    chainId = 1;
    token1 = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
    token2 = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    spender = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
    amount = ethers.BigNumber.from(100);
    expiration = 946902158100;
    sigDeadline = ethers.BigNumber.from(146902158100);
    nonce = ethers.BigNumber.from(0);
    DOMAIN_SEPARATOR = buildDomainSeparator();
    hashLib = <PermitHashMock>await deployContract("PermitHashMock");
    wallet = new Wallet(
      "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110",
      provider
    );
    person = "0xd5F5175D014F28c85F7D67A111C2c9335D7CD771";
  });
  function buildDomainSeparator(): string {
    const nameHash: string = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("Permit2")
    );
    const typeHash: string = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(
        "EIP712Domain(string name,uint256 chainId,address verifyingContract)"
      )
    );

    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32", "uint256", "address"],
        [typeHash, nameHash, chainId, verifyingContract]
      )
    );
  }
  function hashTypedWitness(
    typehash: string,
    typedWitness: MockWitness
  ): string {
    const encodedWitness = ethers.utils.defaultAbiCoder.encode(
      ["bytes32", "address", "uint256"],
      [typehash, typedWitness.person, typedWitness.amount]
    );
    return ethers.utils.keccak256(encodedWitness);
  }
  async function getLocalSingleWitnessHash(
    amountToHash: BigNumber,
    typehashStub: string
  ) {
    let permitTransferFrom: PermitTransferFrom = {
      permitted: {
        token: token1,
        amount: amountToHash,
      },
      nonce: nonce,
      deadline: sigDeadline,
    };
    const witness: MockWitness = new MockWitness(person, amount);

    let hashedWitness = hashTypedWitness(WITNESS_TYPE_HASH, witness);
    let spender = new Wallet(PRIVATE_KEY_SPENDER, provider);
    let permitTrasferFromWitnessHash = await hashLib
      .connect(spender)
      .hashWithWitness(permitTransferFrom, hashedWitness, typehashStub);

    return ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ["string", "bytes32", "bytes32"],
        ["\x19\x01", DOMAIN_SEPARATOR, permitTrasferFromWitnessHash]
      )
    );
  }
  async function getLocalBatchedWitnessHash(
    amountToHash: BigNumber,
    typehashStub: string
  ) {
    let witness: MockWitness = new MockWitness(person, amount);
    let hashedWitness = hashTypedWitness(WITNESS_TYPE_HASH, witness);
    let permitted: TokenPermissions[] = [];
    permitted.push({
      token: token1,
      amount: ethers.BigNumber.from(amountToHash),
    });

    permitted.push({
      token: token2,
      amount: ethers.BigNumber.from(amountToHash),
    });

    let permitBatchTransferFrom: PermitBatchTransferFrom = {
      permitted: permitted,
      nonce: nonce,
      deadline: sigDeadline,
    };

    const permitBatchTransferFromWitnessHash = await hashLib
      .connect(wallet)
      .hashWithWitnessBatch(
        permitBatchTransferFrom,
        hashedWitness,
        typehashStub
      );
    return ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ["string", "bytes32", "bytes32"],
        ["\x19\x01", DOMAIN_SEPARATOR, permitBatchTransferFromWitnessHash]
      )
    );
  }

  describe("TestPermitSingle", function () {
    it("should not revert, validating that from is indeed the signer ", async function () {
      const details: PermitDetails = {
        token: token1,
        amount: ethers.BigNumber.from(amount),
        expiration: ethers.BigNumber.from(expiration),
        nonce: ethers.BigNumber.from(nonce),
      };

      const permit: PermitSingle = {
        details: details,
        spender: spender,
        sigDeadline: ethers.BigNumber.from(sigDeadline),
      };

      const permitHash = await hashLib.connect(wallet).hashPermitSingle(permit);

      const hashedPermit = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", DOMAIN_SEPARATOR, permitHash]
        )
      );

      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });

  describe("TestPermitBatch", function () {
    it("should not revert, validating that from is indeed the signer ", async function () {
      const r =
        "0x3d298c897075538134ee0003bba9b149fac6e4b3496e34272f6731c32be2a710";
      const s =
        "0x682657710eb4208db1eb6a6dac08b375f171733604e4e1deed30d49e22d0c42f";
      const v = "0x1c";

      const sig = ethers.utils.concat([r, s, v]);

      let details: PermitDetails[] = [];

      details.push({
        token: token1,
        amount: ethers.BigNumber.from(amount),
        expiration: ethers.BigNumber.from(expiration),
        nonce: ethers.BigNumber.from(nonce),
      });

      details.push({
        token: token2,
        amount: ethers.BigNumber.from(amount),
        expiration: ethers.BigNumber.from(expiration),
        nonce: ethers.BigNumber.from(nonce),
      });

      const permit = {
        details: details,
        spender: spender,
        sigDeadline: ethers.BigNumber.from(sigDeadline),
      };

      const permitHash = await hashLib.connect(wallet).hashPermitBatch(permit);
      const hashedPermit = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", DOMAIN_SEPARATOR, permitHash]
        )
      );
      await expect(
        hashLib
          .connect(wallet)
          .verify(ethers.utils.hexlify(sig), hashedPermit, from)
      ).to.be.not.reverted;
    });
  });

  describe("TestPermitTransferFrom", async function () {
    it("should not revert, validating that from is indeed the signer", async function () {
      let permit: PermitTransferFrom = {
        permitted: {
          token: token1,
          amount: amount,
        },
        nonce: nonce,
        deadline: sigDeadline,
      };
      const permitHash = await hashLib
        .connect(wallet)
        .hashPermitTransferFrom(permit);

      const hashedPermit = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", DOMAIN_SEPARATOR, permitHash]
        )
      );

      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });

  describe("TestPermitBatchTransferFrom", function () {
    it("should not revert, validating that from is indeed the signer", async function () {
      let permitted: TokenPermissions[] = [];
      permitted.push({
        token: token1,
        amount: ethers.BigNumber.from(amount),
      });

      permitted.push({
        token: token2,
        amount: ethers.BigNumber.from(amount),
      });

      const permitBatchTransferFrom: PermitBatchTransferFrom = {
        permitted: permitted,
        nonce: nonce,
        deadline: sigDeadline,
      };

      const permitBatchTransferFromHash =
        await hashLib.hashPermitBatchTransferFrom(permitBatchTransferFrom);

      const hashedPermit = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["string", "bytes32", "bytes32"],
          ["\x19\x01", DOMAIN_SEPARATOR, permitBatchTransferFromHash]
        )
      );
      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });

  describe("TestPermitTransferFromWithWitness", async function () {
    it("should not revert, validating that from is indeed the signer", async function () {
      const WITNESS_TYPE_STRING_STUB: string =
        "MockWitness witness)MockWitness(address person,uint256 amount)TokenPermissions(address token,uint256 amount)";
      const hashedPermit = await getLocalSingleWitnessHash(
        amount,
        WITNESS_TYPE_STRING_STUB
      );

      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });

  describe("Test Permit Transfer From With Witness Incorrect Typehash Stub", async function () {
    it("should not revert, validating that from is indeed the signer", async function () {
      const INCORRECT_WITNESS_TYPE_STRING_STUB: string =
        "MockWitness witness)TokenPermissions(address token,uint256 amount)MockWitness(address person,uint256 amount)";
      const hashedPermit = await getLocalSingleWitnessHash(
        amount,
        INCORRECT_WITNESS_TYPE_STRING_STUB
      );

      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });

  describe("Test Permit Transfer From With Witness Incorrect Permit Data", async function () {
    it("should not revert, validating that from is indeed the signer", async function () {
      const WITNESS_TYPE_STRING_STUB: string =
        "MockWitness witness)MockWitness(address person,uint256 amount)TokenPermissions(address token,uint256 amount)";
      let incorrectAmount = ethers.BigNumber.from(10000000000);
      const hashedPermit = await getLocalSingleWitnessHash(
        incorrectAmount,
        WITNESS_TYPE_STRING_STUB
      );

      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });

  describe("Test Permit Batch Transfer From With Witness", async function () {
    it("should not revert, validating that from is indeed the signer", async function () {
      const WITNESS_TYPE_STRING_STUB: string =
        "MockWitness witness)MockWitness(address person,uint256 amount)TokenPermissions(address token,uint256 amount)";
      const hashedPermit = await getLocalBatchedWitnessHash(
        amount,
        WITNESS_TYPE_STRING_STUB
      );

      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });

  describe("Test Permit Batch Transfer From With Witness Incorrect TypehashStub", async function () {
    it("should not revert, validating that from is indeed the signer", async function () {
      const WITNESS_TYPE_STRING_STUB: string =
        "MockWitness witness)TokenPermissions(address token,uint256 amount)MockWitness(address person,uint256 amount)";
      const hashedPermit = await getLocalBatchedWitnessHash(
        amount,
        WITNESS_TYPE_STRING_STUB
      );

      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });

  describe("Test Permit Batch Transfer From With Witness Incorrect Permit Data", async function () {
    it("should not revert, validating that from is indeed the signer", async function () {
      const WITNESS_TYPE_STRING_STUB: string =
        "MockWitness witness)TokenPermissions(address token,uint256 amount)MockWitness(address person,uint256 amount)";
      const hashedPermit = await getLocalBatchedWitnessHash(
        amount,
        WITNESS_TYPE_STRING_STUB
      );

      await expect(
        hashLib.verify(
          signDigest(hashedPermit, PRIVATE_KEY_OWNER),
          hashedPermit,
          ethers.utils.computeAddress(PRIVATE_KEY_OWNER)
        )
      ).to.be.not.reverted;
    });
  });
});
