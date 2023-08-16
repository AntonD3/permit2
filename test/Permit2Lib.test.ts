import { BigNumber, ethers } from 'ethers'
import { Wallet } from 'zksync-web3'
import {
  MockERC20,
  MockNonPermitERC20,
  MockPermitWithLargerDS,
  MockPermitWithSmallDS,
  Permit2,
  MockPermit2LibTest,
  MockNonPermitNonERC20WithDS,
  MockSafeERC20,
} from '../typechain-types'
import {deployContract, provider, RICH_WALLET_PRIVATE_KEYS, walletDeployContract} from './shared/zkSyncUtils'
import { expect } from './shared/expect'
import {
  buildPermitSingle,
  getPermitSignatureSeparated,
  PermitSingle,
  signDigestSeparate,
} from './utils/PermitSignature'

const _PERMIT_DETAILS_TYPEHASH: string = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes('PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)')
)
const UINT48_MAX: BigNumber = ethers.BigNumber.from(281474976710655)
const UINT160_MAX: BigNumber = ethers.BigNumber.from(2).pow(ethers.BigNumber.from(160)).sub(1)
const DECIMAL_MULT: BigNumber = ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18))
const PERMIT_DEPLOYER_PK: string = '0x7f2f89394abc81f86bf66c81852b9f203a329e4b89af8cd7177807f0178a5e12'
const PERMIT_DEPLOYER: Wallet = new Wallet(PERMIT_DEPLOYER_PK, provider)
const PK = RICH_WALLET_PRIVATE_KEYS[0].privateKey
const PK_OWNER: Wallet = new Wallet(PK, provider)
const CAFE_PK = RICH_WALLET_PRIVATE_KEYS[1].privateKey
const CAFE: Wallet = new Wallet(CAFE_PK, provider)
const BOB_PK = RICH_WALLET_PRIVATE_KEYS[2].privateKey
const BOB: Wallet = new Wallet(BOB_PK, provider)
const wallet_PK = RICH_WALLET_PRIVATE_KEYS[3].privateKey
const wallet: Wallet = new Wallet(wallet_PK, provider)
const DECIMALS: BigNumber = ethers.BigNumber.from(18)

describe('Permit2Lib', function () {
  let PERMIT_TYPEHASH: string = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
  )
  let TOKEN_DOMAIN_SEPARATOR: string
  let PERMIT2_DOMAIN_SEPARATOR: string
  let TEST_SML_DS_DOMAIN_SEPARATOR: string
  let TEST_LG_DS_DOMAIN_SEPARATOR: string

  let permit2: Permit2
  let permit2Lib: MockPermit2LibTest
  let token: MockERC20
  let safeERC20: MockSafeERC20

  let nonPermitToken: MockNonPermitERC20
  let lessDSToken: MockPermitWithSmallDS
  let largeDSToken: MockPermitWithLargerDS
  let largerNonStandardDSToken: MockNonPermitNonERC20WithDS

  let amount: BigNumber = DECIMAL_MULT.mul(ethers.BigNumber.from(1000000))

  let blockTimestamp: BigNumber

  before(async function () {
    //TODO: Rewrite with create2 deploy script with special salt
    let permit2Address = '0x28D81506519D32a212fB098658abf4a9CCe60d59' //precalculated
    permit2 = <Permit2>await walletDeployContract(PERMIT_DEPLOYER, 'Permit2')

    if (permit2Address != permit2.address) {
      permit2 = await permit2.attach(permit2Address)
    }

    permit2Lib = <MockPermit2LibTest>await deployContract('MockPermit2LibTest')
    safeERC20 = <MockSafeERC20>await deployContract('MockSafeERC20')

    token = <MockERC20>await deployContract('MockERC20', ['Test', 'MOCK', DECIMALS])

    nonPermitToken = <MockNonPermitERC20>await deployContract('MockNonPermitERC20', ['Test', 'MOCK', DECIMALS])
    lessDSToken = <MockPermitWithSmallDS>await deployContract('MockPermitWithSmallDS', ['Test', 'MOCK', DECIMALS])
    largeDSToken = <MockPermitWithLargerDS>await deployContract('MockPermitWithLargerDS', ['Test', 'MOCK', DECIMALS])
    largerNonStandardDSToken = <MockNonPermitNonERC20WithDS>await deployContract('MockNonPermitNonERC20WithDS')

    TOKEN_DOMAIN_SEPARATOR = await token.DOMAIN_SEPARATOR()
    PERMIT2_DOMAIN_SEPARATOR = await permit2.DOMAIN_SEPARATOR()
    TEST_SML_DS_DOMAIN_SEPARATOR = await lessDSToken.DOMAIN_SEPARATOR()
    TEST_LG_DS_DOMAIN_SEPARATOR = await largeDSToken.DOMAIN_SEPARATOR()

    await (await token.connect(wallet).mint(wallet.address, amount)).wait()
    await (await token.connect(wallet).approve(wallet.address, amount)).wait()
    await (await token.connect(PK_OWNER).approve(permit2.address, amount)).wait()

    await (await lessDSToken.connect(wallet).mint(wallet.address, amount)).wait()
    await (await lessDSToken.connect(wallet).approve(wallet.address, amount)).wait()
    await (await lessDSToken.connect(wallet).approve(permit2.address, amount)).wait()

    await (await lessDSToken.connect(wallet).mint(PK_OWNER.address, amount)).wait()
    await (await lessDSToken.connect(PK_OWNER).approve(permit2.address, amount)).wait()

    await (await token.connect(wallet).mint(PK_OWNER.address, amount)).wait()
    await (await token.connect(PK_OWNER).approve(permit2.address, amount)).wait()

    await (await nonPermitToken.connect(wallet).mint(wallet.address, amount)).wait()
    await (await nonPermitToken.connect(wallet).approve(wallet.address, amount)).wait()
    await (await nonPermitToken.connect(wallet).approve(permit2.address, amount)).wait()

    await (await nonPermitToken.connect(wallet).mint(PK_OWNER.address, amount)).wait()
    await (await nonPermitToken.connect(PK_OWNER).approve(permit2.address, amount)).wait()
  })

  beforeEach(async function () {
    let timestamp: number = (await provider.getBlock('latest')).timestamp
    blockTimestamp = ethers.BigNumber.from(timestamp + 80000000)

    let allowanceBefore = await permit2.connect(wallet).allowance(PK_OWNER.address, token.address, CAFE.address)
    let permitSingle: PermitSingle = buildPermitSingle(
      token.address,
      DECIMAL_MULT,
      UINT48_MAX,
      allowanceBefore.nonce,
      CAFE.address,
      blockTimestamp
    )
    let sign = getPermitSignatureSeparated(permitSingle, PK, PERMIT2_DOMAIN_SEPARATOR)

    await (
      await permit2Lib
        .connect(wallet)
        .permit2(
          token.address,
          PK_OWNER.address,
          CAFE.address,
          DECIMAL_MULT,
          blockTimestamp,
          ethers.BigNumber.from(sign.v),
          sign.r,
          sign.s
        )
    ).wait()

    let allowanceMiddle = await permit2
      .connect(wallet)
      .allowance(PK_OWNER.address, nonPermitToken.address, CAFE.address)

    permitSingle = buildPermitSingle(
      nonPermitToken.address,
      DECIMAL_MULT,
      UINT48_MAX,
      allowanceMiddle.nonce,
      CAFE.address,
      blockTimestamp
    )

    sign = await getPermitSignatureSeparated(permitSingle, PK, PERMIT2_DOMAIN_SEPARATOR)

    await (
      await permit2Lib
        .connect(wallet)
        .permit2(
          nonPermitToken.address,
          PK_OWNER.address,
          CAFE.address,
          DECIMAL_MULT,
          blockTimestamp,
          sign.v,
          sign.r,
          sign.s
        )
    ).wait()
  })

  describe('Test Standard Permit', function () {
    it('permit should not revert', async function () {
      let hash: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [
            PERMIT_TYPEHASH,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            await token.connect(PK_OWNER).nonces(PK_OWNER.address),
            blockTimestamp,
          ]
        )
      )

      const message: string = ethers.utils.keccak256(
        ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', TOKEN_DOMAIN_SEPARATOR, hash])
      )

      const sign = signDigestSeparate(message, PK)

      await expect(
        token
          .connect(wallet)
          .permit(
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).to.be.not.reverted
    })
  })

  describe('Test OZ SafePermit', function () {
    it('SafePermit should not revert', async function () {
      let hash: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [
            PERMIT_TYPEHASH,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            await token.connect(PK_OWNER).nonces(PK_OWNER.address),
            blockTimestamp,
          ]
        )
      )

      let message: string = ethers.utils.keccak256(
        ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', TOKEN_DOMAIN_SEPARATOR, hash])
      )

      const sign = signDigestSeparate(message, PK)
      await (
        await safeERC20
          .connect(PK_OWNER)
          .safePermit(
            token.address,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()
    })
  })

  describe('Test Permit2', function () {
    it('should not revert', async function () {
      let hash: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [
            PERMIT_TYPEHASH,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            await token.connect(PK_OWNER).nonces(PK_OWNER.address),
            blockTimestamp,
          ]
        )
      )

      let message: string = ethers.utils.keccak256(
        ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', TOKEN_DOMAIN_SEPARATOR, hash])
      )

      const sign = signDigestSeparate(message, PK)
      await (
        await permit2Lib
          .connect(wallet)
          .permit2(
            token.address,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()
    })
  })

  describe('Test Permit2 Invalid Amount', function () {
    it('should revert with invalid amount', async function () {
      let result = await permit2.connect(wallet).allowance(PK_OWNER.address, nonPermitToken.address, CAFE.address)

      let permit: PermitSingle = buildPermitSingle(
        nonPermitToken.address,
        UINT160_MAX,
        UINT48_MAX,
        result.nonce,
        CAFE.address,
        blockTimestamp
      )

      const sign = getPermitSignatureSeparated(permit, PK, PERMIT2_DOMAIN_SEPARATOR)
      let amount: BigNumber = ethers.BigNumber.from(2).pow(170)

      await expect(
        permit2Lib
          .connect(wallet)
          .permit2(
            nonPermitToken.address,
            PK_OWNER.address,
            CAFE.address,
            amount,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).to.be.revertedWithCustomError(permit2Lib, 'UnsafeCast')
    })
  })

  describe('Test Standard TransferFrom', function () {
    it('TransferFrom should not revert', async function () {
      let randomAddress = ethers.utils.hexlify(ethers.utils.randomBytes(20))
      await (await token.connect(wallet).transferFrom(wallet.address, randomAddress, DECIMAL_MULT)).wait()
    })
  })

  describe('Test Open-Zeppelin SafeTransferFrom', function () {
    it('SafeTransferFrom should not revert', async function () {
      await (await token.connect(wallet).approve(safeERC20.address, ethers.constants.MaxUint256)).wait()
      await expect(safeERC20.connect(wallet).safeTransferFrom(token.address, wallet.address, BOB.address, DECIMAL_MULT))
        .to.be.not.reverted
    })
  })

  describe('Test TransferFrom2', function () {
    it('TransferFrom2 should not revert', async function () {
      await (await token.connect(wallet).approve(permit2Lib.address, ethers.constants.MaxUint256)).wait()
      await expect(permit2Lib.connect(wallet).transferFrom2(token.address, wallet.address, BOB.address, DECIMAL_MULT))
        .to.be.not.reverted
    })
  })

  describe('Test Permit2 Full', function () {
    it('Permit2 should not revert', async function () {
      const result = await permit2.connect(wallet).allowance(PK_OWNER.address, token.address, CAFE.address)

      let permit: PermitSingle = buildPermitSingle(
        token.address,
        DECIMAL_MULT,
        UINT48_MAX,
        result.nonce,
        CAFE.address,
        blockTimestamp
      )

      const sign = getPermitSignatureSeparated(permit, PK, PERMIT2_DOMAIN_SEPARATOR)

      await (
        await permit2Lib
          .connect(wallet)
          .permit2(
            token.address,
            PK_OWNER.address,
            CAFE.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()
    })
  })

  describe('Test Permit2 Non Permit Token', function () {
    it('Test Permit2 with Non Permit Token should not revert', async function () {
      const result = await permit2.connect(wallet).allowance(PK_OWNER.address, nonPermitToken.address, CAFE.address)

      let permit: PermitSingle = buildPermitSingle(
        nonPermitToken.address,
        DECIMAL_MULT,
        UINT48_MAX,
        result.nonce,
        CAFE.address,
        blockTimestamp
      )

      const sign = getPermitSignatureSeparated(permit, PK, PERMIT2_DOMAIN_SEPARATOR)

      await (
        await permit2Lib
          .connect(wallet)
          .permit2(
            nonPermitToken.address,
            PK_OWNER.address,
            CAFE.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()
    })
  })

  describe('Test Permit2 Smaller DS', function () {
    it('Permit2 with Smaller DS should not revert', async function () {
      let result = await permit2.connect(wallet).allowance(PK_OWNER.address, lessDSToken.address, CAFE.address)

      let permit: PermitSingle = buildPermitSingle(
        lessDSToken.address,
        DECIMAL_MULT,
        UINT48_MAX,
        result.nonce,
        CAFE.address,
        blockTimestamp
      )

      const sign = getPermitSignatureSeparated(permit, PK, PERMIT2_DOMAIN_SEPARATOR)

      await (
        await permit2Lib
          .connect(wallet)
          .permit2(
            lessDSToken.address,
            PK_OWNER.address,
            CAFE.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()
      result = await permit2.connect(wallet).allowance(PK_OWNER.address, lessDSToken.address, CAFE.address)

      expect(result.amount).to.be.equal(DECIMAL_MULT)
    })
  })

  describe('Test Permit2 Larger DS', function () {
    it('Permit2 with Larger DS should not revert', async function () {
      let result = await permit2.connect(wallet).allowance(PK_OWNER.address, largeDSToken.address, CAFE.address)

      let permit: PermitSingle = buildPermitSingle(
        largeDSToken.address,
        DECIMAL_MULT,
        UINT48_MAX,
        result.nonce,
        CAFE.address,
        blockTimestamp
      )

      const sign = getPermitSignatureSeparated(permit, PK, PERMIT2_DOMAIN_SEPARATOR)
      await (
        await permit2Lib
          .connect(wallet)
          .permit2(
            largeDSToken.address,
            PK_OWNER.address,
            CAFE.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()

      result = await permit2.connect(wallet).allowance(PK_OWNER.address, largeDSToken.address, CAFE.address)

      expect(result.amount).to.be.equal(DECIMAL_MULT)
    })
  })

  describe('Test Permit2 Larger DS Revert', function () {
    it('Permit2 with Larger DS should revert', async function () {
      let permitHash: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [
            _PERMIT_DETAILS_TYPEHASH,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            await token.connect(PK_OWNER).nonces(PK_OWNER.address),
            blockTimestamp,
          ]
        )
      )

      let message: string = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ['string', 'bytes32', 'bytes32'],
          ['\x19\x01', TEST_LG_DS_DOMAIN_SEPARATOR, permitHash]
        )
      )

      const sign = signDigestSeparate(message, PK)

      await expect(
        permit2Lib
          .connect(wallet)
          .permit2(
            largeDSToken.address,
            PK_OWNER.address,
            CAFE.address,
            ethers.BigNumber.from(10000),
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).to.be.revertedWithCustomError(permit2, 'InvalidSigner')
    })
  })

  describe('Test Permit2 SmallerDSToken No Revert', function () {
    it('Permit2 with SmallerDSToken should not revert', async function () {
      let permitHash: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [
            PERMIT_TYPEHASH,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            await lessDSToken.connect(PK_OWNER).nonces(PK_OWNER.address),
            blockTimestamp,
          ]
        )
      )

      let message: string = ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ['string', 'bytes32', 'bytes32'],
          ['\x19\x01', TEST_SML_DS_DOMAIN_SEPARATOR, permitHash]
        )
      )

      const sign = signDigestSeparate(message, PK)

      await expect(
        permit2Lib
          .connect(wallet)
          .permit2(
            lessDSToken.address,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).to.be.not.reverted
    })
  })

  describe('Test TransferFrom2 Full', function () {
    it('TransferFrom2 should not revert', async function () {
      await (await token.connect(PK_OWNER).approve(permit2Lib.address, ethers.constants.MaxUint256)).wait()
      await expect(permit2Lib.connect(CAFE).transferFrom2(token.address, PK_OWNER.address, BOB.address, DECIMAL_MULT))
        .to.be.not.reverted
    })
  })

  describe('Test TransferFrom2 NonPermitToken', function () {
    it('TransferFrom2 with token without permit should not revert', async function () {
      await (await nonPermitToken.connect(PK_OWNER).approve(permit2Lib.address, ethers.constants.MaxUint256)).wait()
      await expect(
        permit2Lib.connect(CAFE).transferFrom2(nonPermitToken.address, PK_OWNER.address, BOB.address, DECIMAL_MULT)
      ).to.be.not.reverted
    })
  })

  describe('Test TransferFrom2 InvalidAmount', function () {
    it('TransferFrom2 with invalid amount should revert', async function () {
      await (await token.connect(PK_OWNER).approve(CAFE.address, ethers.constants.MaxUint256)).wait()
      await expect(
        permit2Lib
          .connect(CAFE)
          .transferFrom2(token.address, PK_OWNER.address, CAFE.address, ethers.constants.Two.pow(170))
      ).to.be.revertedWithCustomError(permit2Lib, 'UnsafeCast')
    })
  })

  describe('Test Open-Zappelin SafePermit Plus OZ Safe TransferFrom', function () {
    it('TransferFrom should not revert', async function () {
      let permitHash: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [
            PERMIT_TYPEHASH,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            await token.connect(PK_OWNER).nonces(PK_OWNER.address),
            blockTimestamp,
          ]
        )
      )

      let message: string = ethers.utils.keccak256(
        ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', TOKEN_DOMAIN_SEPARATOR, permitHash])
      )

      const sign = signDigestSeparate(message, PK)

      await (await token.connect(PK_OWNER).approve(safeERC20.address, ethers.constants.MaxUint256)).wait()
      await (
        await safeERC20
          .connect(BOB)
          .safePermit(
            token.address,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()
      await expect(safeERC20.connect(BOB).safeTransferFrom(token.address, PK_OWNER.address, BOB.address, DECIMAL_MULT))
        .to.be.not.reverted
    })
  })

  describe('Test Permit2 Plus TransferFrom2', function () {
    it('should not revert', async function () {
      let hash: string = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
          [
            PERMIT_TYPEHASH,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            await token.connect(PK_OWNER).nonces(PK_OWNER.address),
            blockTimestamp,
          ]
        )
      )

      let message: string = ethers.utils.keccak256(
        ethers.utils.solidityPack(['string', 'bytes32', 'bytes32'], ['\x19\x01', TOKEN_DOMAIN_SEPARATOR, hash])
      )

      const sign = signDigestSeparate(message, PK)

      await (await token.connect(PK_OWNER).approve(permit2Lib.address, ethers.constants.MaxUint256)).wait()
      await (
        await permit2Lib
          .connect(BOB)
          .permit2(
            token.address,
            PK_OWNER.address,
            BOB.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()

      await expect(permit2Lib.connect(BOB).transferFrom2(token.address, PK_OWNER.address, BOB.address, DECIMAL_MULT)).to
        .be.not.reverted
    })
  })

  describe('Test Permit2 Plus TransferFrom2 With NonPermit', function () {
    it('TransferFrom2 should not revert', async function () {
      let result = await permit2.connect(wallet).allowance(PK_OWNER.address, nonPermitToken.address, CAFE.address)
      let permit: PermitSingle = buildPermitSingle(
        nonPermitToken.address,
        DECIMAL_MULT,
        UINT48_MAX,
        result.nonce,
        CAFE.address,
        blockTimestamp
      )

      const sign = getPermitSignatureSeparated(permit, PK, PERMIT2_DOMAIN_SEPARATOR)
      await (await nonPermitToken.connect(PK_OWNER).approve(permit2Lib.address, ethers.constants.MaxUint256)).wait()

      await (
        await permit2Lib
          .connect(CAFE)
          .permit2(
            nonPermitToken.address,
            PK_OWNER.address,
            CAFE.address,
            DECIMAL_MULT,
            blockTimestamp,
            ethers.BigNumber.from(sign.v),
            sign.r,
            sign.s
          )
      ).wait()
      await expect(
        permit2Lib.connect(CAFE).transferFrom2(nonPermitToken.address, PK_OWNER.address, BOB.address, DECIMAL_MULT)
      ).to.be.not.reverted
    })
  })

  describe('Test Permit2 DSLessToken', function () {
    it('should be true', async function () {
      await expect(await permit2Lib.connect(wallet).testPermit2Code(lessDSToken.address)).to.be.true
    })
  })

  describe('Test Permit2 DS More Token', function () {
    it('should be false', async function () {
      await expect(await permit2Lib.connect(wallet).testPermit2Code(largerNonStandardDSToken.address)).to.be.false
    })
  })

  describe('Test Permit2 DS More 32 Token', function () {
    it('should be false', async function () {
      await expect(await permit2Lib.connect(wallet).testPermit2Code(largeDSToken.address)).to.be.false
    })
  })
})
