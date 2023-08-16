import { MockERC20, Permit2 } from '../../typechain-types'
import { deployContract, provider } from './shared/zkSyncUtils'
import { Wallet } from 'zksync-web3'
import fs from 'fs'
import { BigNumber, BigNumberish, ethers } from 'ethers'
import {
  AllowanceTransferDetails,
  buildAllowanceTransferDetails,
  buildPermitBatch,
  buildPermitDetails,
  buildPermitSingle,
  getCompactPermitSignature,
  getPermitBatchSignature,
  getPermitSignature,
  PermitBatch,
  PermitDetails,
  PermitSingle,
  TokenSpenderPair,
} from './utils/PermitSignature'
import { expect } from './shared/expect'

const RICH_WALLET_PRIVATE_KEYS = JSON.parse(fs.readFileSync('test/shared/rich-wallets.json', 'utf8'))
const DECIMAL_MULT: BigNumber = ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18))

describe('AllowanceTransferTest', function () {
  const defaultExpiration: BigNumber = ethers.BigNumber.from(Date.now() + 50000)
  let token0: MockERC20
  let token1: MockERC20
  let permit2: Permit2
  let from: Wallet
  let fromDirty: Wallet
  let spender: Wallet = new Wallet(RICH_WALLET_PRIVATE_KEYS[0].privateKey, provider)
  let receiver: Wallet = new Wallet(RICH_WALLET_PRIVATE_KEYS[1].privateKey, provider)
  let address3: Wallet = new Wallet(RICH_WALLET_PRIVATE_KEYS[2].privateKey, provider)

  let defaultAmount: BigNumber = DECIMAL_MULT
  let defaultNonce: BigNumberish = ethers.constants.Zero
  let dirtyNonce: BigNumberish = ethers.constants.One
  let MINT_AMOUNT_ERC20: BigNumber = defaultAmount.mul(10)

  let fromPrivateKey: string
  let fromPrivateKeyDirty: string
  let blockTimestamp: BigNumberish

  beforeEach(async function () {
    const timeStamp = (await provider.getBlock('latest')).timestamp
    blockTimestamp = ethers.BigNumber.from(timeStamp + 80000000)

    permit2 = <Permit2>await deployContract('Permit2')

    fromPrivateKey = RICH_WALLET_PRIVATE_KEYS[3].privateKey
    // There are only 4 rich accounts, so let's create a new one and pop up it.
    fromPrivateKeyDirty = ethers.utils.hexlify(ethers.utils.randomBytes(32))

    from = new Wallet(fromPrivateKey, provider)
    fromDirty = new Wallet(fromPrivateKeyDirty, provider)
    await (
      await from.transfer({
        to: fromDirty.address,
        amount: ethers.utils.parseEther('1.0'),
      })
    ).wait()

    token0 = <MockERC20>await deployContract('MockERC20', ['Test0', 'TEST0', ethers.BigNumber.from(18)])
    token1 = <MockERC20>await deployContract('MockERC20', ['Test1', 'TEST1', ethers.BigNumber.from(18)])

    await mint(from.address, from)

    await approve(permit2.address, from)
    await mint(fromDirty.address, fromDirty)
    await approve(permit2.address, fromDirty)

    await (await permit2.connect(fromDirty).invalidateNonces(token0.address, spender.address, dirtyNonce)).wait()
    await (await permit2.connect(fromDirty).invalidateNonces(token1.address, spender.address, dirtyNonce)).wait()

    await mint(receiver.address, receiver)
  })

  async function mint(address: string, from: Wallet) {
    await (await token0.connect(from).mint(address, MINT_AMOUNT_ERC20)).wait()
    await (await token1.connect(from).mint(address, MINT_AMOUNT_ERC20)).wait()
  }

  async function approve(address: string, from: Wallet) {
    await (await token0.connect(from).approve(address, ethers.constants.MaxUint256)).wait()
    await (await token1.connect(from).approve(address, ethers.constants.MaxUint256)).wait()
  }

  describe('Test Approve', function () {
    it('approve should work correct', async function () {
      await expect(permit2.connect(from).approve(token0.address, spender.address, defaultAmount, defaultExpiration))
        .to.emit(permit2, 'Approval')
        .withArgs(from.address, token0.address, spender.address, defaultAmount, defaultExpiration)

      let result = await permit2.allowance(from.address, token0.address, spender.address)
      expect(result.amount).to.be.equal(defaultAmount)
      expect(result.expiration).to.be.equal(defaultExpiration)
      expect(result.nonce).to.be.equal(0)
    })
  })

  describe('Test set allowance', function () {
    it('permit should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      const sign = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()

      let result = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(result.amount).to.be.equal(defaultAmount)
      expect(result.expiration).to.be.equal(defaultExpiration)
      expect(result.nonce).to.be.equal(ethers.constants.One)
    })
  })

  describe('Test Set Allowance CompactSig', function () {
    it('allowance with compact sig should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let signature: Uint8Array = getCompactPermitSignature(
        permitSingle,
        fromPrivateKey,
        await permit2.DOMAIN_SEPARATOR()
      )
      expect(signature.length).to.be.eq(64)

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            from.address,
            permitSingle,
            signature
          )
      ).wait()
      let allowanceResult = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(allowanceResult.amount).to.be.equal(defaultAmount)
      expect(allowanceResult.expiration).to.be.equal(defaultExpiration)
      expect(allowanceResult.nonce).to.be.equal(ethers.constants.One)
    })
  })

  describe('Test Set Allowance Incorrect Sig Length', function () {
    it('allowance with incorrect sig length should revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let signature: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())
      let signatureExtra: Uint8Array = ethers.utils.concat([signature, [1]])
      expect(signatureExtra.length).to.be.equal(66)
      await expect(
        permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            from.address,
            permitSingle,
            signatureExtra
          )
      ).to.be.revertedWithCustomError(permit2, 'InvalidSignatureLength')
    })
  })

  describe('Test Set Allowance Dirty Write', function () {
    it('allowance dirty write should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        dirtyNonce,
        spender.address,
        blockTimestamp
      )
      let signature: Uint8Array = getPermitSignature(
        permitSingle,
        fromPrivateKeyDirty,
        await permit2.DOMAIN_SEPARATOR()
      )

      await (
        await permit2
          .connect(fromDirty)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            fromDirty.address,
            permitSingle,
            signature
          )
      ).wait()

      let allowanceResult = await permit2
        .connect(fromDirty)
        .allowance(fromDirty.address, token0.address, spender.address)

      expect(allowanceResult.amount).to.be.equal(defaultAmount)
      expect(allowanceResult.expiration).to.be.equal(defaultExpiration)
      expect(allowanceResult.nonce).to.be.equal(ethers.constants.Two)
    })
  })

  describe('Test Set Allowance Batch Different Nonces', function () {
    it('AllowanceBatch with different nonces should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )

      let signature: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            from.address,
            permitSingle,
            signature
          )
      ).wait()

      let allowanceResult = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(allowanceResult.amount).to.be.equal(defaultAmount)
      expect(allowanceResult.expiration).to.be.equal(defaultExpiration)
      expect(allowanceResult.nonce).to.be.equal(ethers.constants.One)

      let address: string[] = [token0.address, token1.address]
      let permitDetails: PermitDetails[] = []

      permitDetails.push(buildPermitDetails(address[0], defaultAmount, defaultExpiration, dirtyNonce))
      permitDetails.push(buildPermitDetails(address[1], defaultAmount, defaultExpiration, ethers.constants.Zero))

      let permitBatch: PermitBatch = buildPermitBatch(permitDetails, spender.address, blockTimestamp)

      let signatureBatch: string = getPermitBatchSignature(
        permitBatch,
        fromPrivateKey,
        await permit2.DOMAIN_SEPARATOR()
      )

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)'](
            from.address,
            permitBatch,
            signatureBatch
          )
      ).wait()

      let allowanceBatchResult0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(allowanceBatchResult0.amount).to.be.equal(defaultAmount)
      expect(allowanceBatchResult0.expiration).to.be.equal(defaultExpiration)
      expect(allowanceBatchResult0.nonce).to.be.equal(ethers.constants.Two)

      let allowanceBatchResult1 = await permit2.connect(from).allowance(from.address, token1.address, spender.address)
      expect(allowanceBatchResult1.amount).to.be.equal(defaultAmount)
      expect(allowanceBatchResult1.expiration).to.be.equal(defaultExpiration)
      expect(allowanceBatchResult1.nonce).to.be.equal(ethers.constants.One)
    })
  })

  describe('Test Set Allowance Batch', function () {
    it('permit should not revert', async function () {
      let tokens: string[] = [token0.address, token1.address]
      let permitDetails: PermitDetails[] = []

      permitDetails.push(buildPermitDetails(tokens[0], defaultAmount, defaultExpiration, defaultNonce))
      permitDetails.push(buildPermitDetails(tokens[1], defaultAmount, defaultExpiration, defaultNonce))

      let permitBatch: PermitBatch = buildPermitBatch(permitDetails, spender.address, blockTimestamp)

      const sign = getPermitBatchSignature(permitBatch, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)'](from.address, permitBatch, sign)
      ).wait()

      let allowanceBatchResult0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(allowanceBatchResult0.amount).to.be.equal(defaultAmount)
      expect(allowanceBatchResult0.expiration).to.be.equal(defaultExpiration)
      expect(allowanceBatchResult0.nonce).to.be.equal(ethers.constants.One)

      let allowanceBatchResult1 = await permit2.connect(from).allowance(from.address, token1.address, spender.address)
      expect(allowanceBatchResult1.amount).to.be.equal(defaultAmount)
      expect(allowanceBatchResult1.expiration).to.be.equal(defaultExpiration)
      expect(allowanceBatchResult1.nonce).to.be.equal(ethers.constants.One)
    })
  })

  describe('Test Set Allowance Batch Event', function () {
    it('permit should not revert', async function () {
      let tokens: string[] = [token0.address, token1.address]
      let permitDetails: PermitDetails[] = []

      permitDetails.push(buildPermitDetails(tokens[0], defaultAmount, defaultExpiration, defaultNonce))
      permitDetails.push(buildPermitDetails(tokens[1], defaultAmount, defaultExpiration, defaultNonce))

      let permitBatch: PermitBatch = buildPermitBatch(permitDetails, spender.address, blockTimestamp)

      const sign: string = getPermitBatchSignature(permitBatch, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await expect(
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)'](from.address, permitBatch, sign)
      )
        .to.emit(permit2, 'Permit')
        .withArgs(from.address, tokens[0], spender.address, defaultAmount, defaultExpiration, defaultNonce)
        .to.emit(permit2, 'Permit')
        .withArgs(from.address, tokens[1], spender.address, defaultAmount, defaultExpiration, defaultNonce)

      let allowanceBatchResult0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(allowanceBatchResult0.amount).to.be.equal(defaultAmount)
      expect(allowanceBatchResult0.expiration).to.be.equal(defaultExpiration)
      expect(allowanceBatchResult0.nonce).to.be.equal(ethers.constants.One)

      let allowanceBatchResult1 = await permit2.connect(from).allowance(from.address, token1.address, spender.address)
      expect(allowanceBatchResult1.amount).to.be.equal(defaultAmount)
      expect(allowanceBatchResult1.expiration).to.be.equal(defaultExpiration)
      expect(allowanceBatchResult1.nonce).to.be.equal(ethers.constants.One)
    })
  })

  describe('Test Set Allowance Batch Dirty Write', function () {
    it('permit should not revert', async function () {
      let tokens: string[] = [token0.address, token1.address]
      let permitDetails: PermitDetails[] = []

      permitDetails.push(buildPermitDetails(tokens[0], defaultAmount, defaultExpiration, dirtyNonce))
      permitDetails.push(buildPermitDetails(tokens[1], defaultAmount, defaultExpiration, dirtyNonce))

      let permitBatch: PermitBatch = buildPermitBatch(permitDetails, spender.address, blockTimestamp)

      const sign: string = getPermitBatchSignature(permitBatch, fromPrivateKeyDirty, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(fromDirty)
          ['permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)'](
            fromDirty.address,
            permitBatch,
            sign
          )
      ).wait()

      let allowanceBatchResult0 = await permit2
        .connect(fromDirty)
        .allowance(fromDirty.address, token0.address, spender.address)
      expect(allowanceBatchResult0.amount).to.be.equal(defaultAmount)
      expect(allowanceBatchResult0.expiration).to.be.equal(defaultExpiration)
      expect(allowanceBatchResult0.nonce).to.be.equal(ethers.constants.Two)

      let allowanceBatchResult1 = await permit2
        .connect(fromDirty)
        .allowance(fromDirty.address, token1.address, spender.address)
      expect(allowanceBatchResult1.amount).to.be.equal(defaultAmount)
      expect(allowanceBatchResult1.expiration).to.be.equal(defaultExpiration)
      expect(allowanceBatchResult1.nonce).to.be.equal(ethers.constants.Two)
    })
  })

  describe('Test SetAllowanceTransfer', function () {
    it('SetAllowanceTransfer should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let startBalanceFrom: BigNumberish = await token0.balanceOf(from.address)
      let startBalanceTo: BigNumberish = await token0.balanceOf(ethers.constants.AddressZero)

      const sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()

      let allowanceResult = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(allowanceResult.amount).to.be.equal(defaultAmount)

      await (
        await permit2
          .connect(spender)
          ['transferFrom(address,address,uint160,address)'](
            from.address,
            ethers.constants.AddressZero,
            defaultAmount,
            token0.address
          )
      ).wait()

      expect(await token0.balanceOf(from.address)).to.be.equal(startBalanceFrom.sub(defaultAmount))
      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(startBalanceTo.add(defaultAmount))
    })
  })

  describe('Test TransferFrom With GasSnapshot', function () {
    it('transferFrom should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let startBalanceFrom: BigNumber = await token0.balanceOf(from.address)
      let startBalanceTo: BigNumber = await token0.balanceOf(ethers.constants.AddressZero)

      const sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()

      let allowanceResult = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(allowanceResult.amount).to.be.equal(defaultAmount)

      await (
        await permit2
          .connect(spender)
          ['transferFrom(address,address,uint160,address)'](
            from.address,
            ethers.constants.AddressZero,
            defaultAmount,
            token0.address
          )
      ).wait()

      expect(await token0.balanceOf(from.address)).to.be.equal(startBalanceFrom.sub(defaultAmount))
      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(startBalanceTo.add(defaultAmount))
    })
  })

  describe('Test Batch TransferFrom With Gas Snapshot', function () {
    it('transferFrom should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      const sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      let startBalanceFrom: BigNumberish = await token0.balanceOf(from.address)
      let startBalanceTo: BigNumberish = await token0.balanceOf(ethers.constants.AddressZero)
      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()

      let allowanceResult = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(allowanceResult.amount).to.be.equal(defaultAmount)

      let owners = []
      owners.push(from.address)
      owners.push(from.address)
      owners.push(from.address)

      let transferDetails: AllowanceTransferDetails[] = []
      transferDetails.push(
        buildAllowanceTransferDetails(
          token0.address,
          ethers.constants.One.pow(18),
          from.address,
          ethers.constants.AddressZero
        )
      )
      transferDetails.push(
        buildAllowanceTransferDetails(
          token0.address,
          ethers.constants.One.pow(18),
          from.address,
          ethers.constants.AddressZero
        )
      )
      transferDetails.push(
        buildAllowanceTransferDetails(
          token0.address,
          ethers.constants.One.pow(18),
          from.address,
          ethers.constants.AddressZero
        )
      )

      await (
        await permit2.connect(spender)['transferFrom((address,address,uint160,address)[])'](transferDetails)
      ).wait()

      expect(await token0.balanceOf(from.address)).to.be.equal(
        startBalanceFrom.sub(ethers.constants.One.pow(18).mul(3))
      )
      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(
        startBalanceTo.add(ethers.constants.One.pow(18).mul(3))
      )

      allowanceResult = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(allowanceResult.amount).to.be.equal(defaultAmount.sub(ethers.constants.One.pow(18).mul(3)))
    })
  })

  describe('Test Set Allowance Transfer DirtyNonce Dirty Transfer', function () {
    it('transferFrom should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        dirtyNonce,
        spender.address,
        blockTimestamp
      )
      let startBalanceFrom: BigNumberish = await token0.balanceOf(fromDirty.address)

      const sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKeyDirty, await permit2.DOMAIN_SEPARATOR())

      await (await token0.mint(address3.address, defaultAmount)).wait()
      let startBalanceTo: BigNumberish = await token0.balanceOf(address3.address)

      expect(startBalanceTo).to.be.equal(defaultAmount)

      await (
        await permit2
          .connect(fromDirty)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            fromDirty.address,
            permitSingle,
            sign
          )
      ).wait()

      let allowanceResult = await permit2
        .connect(fromDirty)
        .allowance(fromDirty.address, token0.address, spender.address)
      expect(allowanceResult.amount).to.be.equal(defaultAmount)

      await (
        await permit2
          .connect(spender)
          ['transferFrom(address,address,uint160,address)'](
            fromDirty.address,
            address3.address,
            defaultAmount,
            token0.address
          )
      ).wait()

      expect(await token0.balanceOf(fromDirty.address)).to.be.equal(startBalanceFrom.sub(defaultAmount))
      expect(await token0.balanceOf(address3.address)).to.be.equal(startBalanceTo.add(defaultAmount))
    })
  })

  describe('Test Set Allowance Invalid Signature', function () {
    it('permit with invalid signature should revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        ethers.constants.AddressZero,
        blockTimestamp
      )
      const sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKeyDirty, await permit2.DOMAIN_SEPARATOR())
      await expect(
        permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).to.be.revertedWithCustomError(permit2, 'InvalidSigner')
    })
  })

  describe('Test Set Allowance Deadline Passed', function () {
    it('permit with passed deadline should revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        ethers.constants.Two
      )
      const sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())
      await expect(
        permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).to.be.revertedWithCustomError(permit2, 'SignatureExpired')
    })
  })

  describe('Test Max Allowance', function () {
    it('transferFrom should not revert', async function () {
      let maxAllowance = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffff')
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        maxAllowance,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let startBalanceFrom: BigNumberish = await token0.balanceOf(from.address)
      let startBalanceTo: BigNumberish = await token0.balanceOf(ethers.constants.AddressZero)

      const sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()

      let allowanceResult = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(allowanceResult.amount).to.be.equal(maxAllowance)

      await (
        await permit2
          .connect(spender)
          ['transferFrom(address,address,uint160,address)'](
            from.address,
            ethers.constants.AddressZero,
            defaultAmount,
            token0.address
          )
      ).wait()

      allowanceResult = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(allowanceResult.amount).to.be.equal(maxAllowance)
      expect(await token0.balanceOf(from.address)).to.be.equal(startBalanceFrom.sub(defaultAmount))
      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(startBalanceTo.add(defaultAmount))
    })
  })

  describe('Test Max Allowance Dirty Write', function () {
    it('max allowance transferFrom should not revert', async function () {
      let maxAllowance = BigNumber.from('0xffffffffffffffffffffffffffffffffffffffff')
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        maxAllowance,
        defaultExpiration,
        dirtyNonce,
        spender.address,
        blockTimestamp
      )
      let sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKeyDirty, await permit2.DOMAIN_SEPARATOR())
      let startBalanceFrom: BigNumberish = await token0.balanceOf(fromDirty.address)
      let startBalanceTo: BigNumberish = await token0.balanceOf(ethers.constants.AddressZero)

      await (
        await permit2
          .connect(fromDirty)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            fromDirty.address,
            permitSingle,
            sign
          )
      ).wait()

      let startAllowedAmount0 = await permit2
        .connect(fromDirty)
        .allowance(fromDirty.address, token0.address, spender.address)
      expect(startAllowedAmount0.amount).to.be.equal(maxAllowance)
      await (
        await permit2
          .connect(spender)
          ['transferFrom(address,address,uint160,address)'](
            fromDirty.address,
            ethers.constants.AddressZero,
            defaultAmount,
            token0.address
          )
      ).wait()

      let endAllowedAmount0 = await permit2
        .connect(fromDirty)
        .allowance(fromDirty.address, token0.address, spender.address)
      expect(endAllowedAmount0.amount).to.be.equal(maxAllowance)

      expect(await token0.balanceOf(fromDirty.address)).to.be.equal(startBalanceFrom.sub(defaultAmount))
      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(startBalanceTo.add(defaultAmount))
    })
  })

  describe('Test Partial Allowance', function () {
    it('Partial Allowance should not reverted', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      let transferAmount: BigNumberish = ethers.BigNumber.from(5).pow(18)
      let startBalanceFrom: BigNumberish = await token0.balanceOf(from.address)
      let startBalanceTo: BigNumberish = await token0.balanceOf(ethers.constants.AddressZero)

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()

      let startAllowedAmount0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(startAllowedAmount0.amount).to.be.equal(defaultAmount)
      await (
        await permit2
          .connect(spender)
          ['transferFrom(address,address,uint160,address)'](
            from.address,
            ethers.constants.AddressZero,
            transferAmount,
            token0.address
          )
      ).wait()

      let endAllowedAmount0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(endAllowedAmount0.amount).to.be.equal(defaultAmount.sub(transferAmount))

      expect(await token0.balanceOf(from.address)).to.be.equal(startBalanceFrom.sub(transferAmount))
      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(startBalanceTo.add(transferAmount))
    })
  })

  describe('Test Reuse Ordered Nonce Invalid', function () {
    it('Reused Ordered Nonce Invalid should reverted', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()

      let result = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result.nonce).to.be.equal(ethers.constants.One)
      expect(result.amount).to.be.equal(defaultAmount)
      expect(result.expiration).to.be.equal(defaultExpiration)

      await expect(
        permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).to.be.revertedWithCustomError(permit2, 'InvalidNonce')
    })
  })

  describe('Test Invalidate Nonces', function () {
    it('Invalidate Nonces should revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await expect(
        await permit2.connect(from).invalidateNonces(token0.address, spender.address, ethers.BigNumber.from(1))
      )
        .to.emit(permit2, 'NonceInvalidation')
        .withArgs(from.address, token0.address, spender.address, ethers.BigNumber.from(1), defaultNonce)

      let result = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(result.nonce).to.be.equal(1)

      await expect(
        permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).to.be.revertedWithCustomError(permit2, 'InvalidNonce')
    })
  })

  describe('Test Invalidate Multiple Nonces', function () {
    it('Invalidate Multiple Nonces should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()

      let result = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result.nonce).to.be.equal(ethers.constants.One)

      permitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        result.nonce,
        spender.address,
        blockTimestamp
      )
      sign = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await expect(
        await permit2.connect(from).invalidateNonces(token0.address, spender.address, ethers.BigNumber.from(33))
      )
        .to.emit(permit2, 'NonceInvalidation')
        .withArgs(from.address, token0.address, spender.address, ethers.BigNumber.from(33), result.nonce)

      result = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result.nonce).to.be.equal(ethers.BigNumber.from(33))

      await expect(
        permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).to.be.revertedWithCustomError(permit2, 'InvalidNonce')
    })
  })

  describe('Test Invalidate Nonces Invalid', function () {
    it('Invalidate Nonces Invalid should revert ', async function () {
      await expect(
        permit2.connect(fromDirty).invalidateNonces(token0.address, spender.address, ethers.constants.Zero)
      ).to.be.revertedWithCustomError(permit2, 'InvalidNonce')
    })
  })

  describe('Test Excessive Invalidation', function () {
    it('ExcessiveInvalidation should revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())
      let numInvalidate: BigNumberish = ethers.utils.parseUnits('65535', 0)

      await expect(
        permit2.connect(from).invalidateNonces(token0.address, spender.address, numInvalidate.add(ethers.constants.One))
      ).to.be.revertedWithCustomError(permit2, 'ExcessiveInvalidation')

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()
      let result = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result.nonce).to.be.equal(ethers.constants.One)
    })
  })

  describe('Test BatchTransferFrom', function () {
    it('BatchTransferFrom should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())
      let startBalanceFrom: BigNumberish = await token0.balanceOf(from.address)
      let startBalanceTo: BigNumberish = await token0.balanceOf(ethers.constants.AddressZero)

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()
      let result = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(result.amount).to.be.equal(defaultAmount)

      let transferDetails: AllowanceTransferDetails[] = []
      let transferAmount: BigNumber = ethers.BigNumber.from(1)

      transferDetails.push(
        buildAllowanceTransferDetails(token0.address, transferAmount, from.address, ethers.constants.AddressZero)
      )
      transferDetails.push(
        buildAllowanceTransferDetails(token0.address, transferAmount, from.address, ethers.constants.AddressZero)
      )
      transferDetails.push(
        buildAllowanceTransferDetails(token0.address, transferAmount, from.address, ethers.constants.AddressZero)
      )

      await (
        await permit2.connect(spender)['transferFrom((address,address,uint160,address)[])'](transferDetails)
      ).wait()

      let amount: BigNumberish = transferAmount.mul(3)
      expect(await token0.balanceOf(from.address)).to.be.equal(startBalanceFrom.sub(amount))
      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(startBalanceTo.add(amount))

      result = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result.amount).to.be.equal(defaultAmount.sub(amount))
    })
  })

  describe('Test BatchTransferFrom MultiToken', function () {
    it('BatchTransferFrom should not revert', async function () {
      let tokens: string[] = [token0.address, token1.address]
      let permitDetails: PermitDetails[] = []

      permitDetails.push(buildPermitDetails(tokens[0], defaultAmount, defaultExpiration, defaultNonce))
      permitDetails.push(buildPermitDetails(tokens[1], defaultAmount, defaultExpiration, defaultNonce))

      let permitBatch: PermitBatch = buildPermitBatch(permitDetails, spender.address, blockTimestamp)

      const sign: string = getPermitBatchSignature(permitBatch, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      let startBalanceFrom0: BigNumberish = await token0.balanceOf(from.address)
      let startBalanceFrom1: BigNumberish = await token1.balanceOf(from.address)
      let startBalanceTo0: BigNumberish = await token0.balanceOf(ethers.constants.AddressZero)
      let startBalanceTo1: BigNumberish = await token1.balanceOf(ethers.constants.AddressZero)

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)'](from.address, permitBatch, sign)
      ).wait()

      let result0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result0.amount).to.be.equal(defaultAmount)

      let result1 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result1.amount).to.be.equal(defaultAmount)

      let owners = []
      owners.push(from.address)
      owners.push(from.address)

      let transferDetails: AllowanceTransferDetails[] = []
      let transferAmount: BigNumber = ethers.BigNumber.from(1)

      transferDetails.push(
        buildAllowanceTransferDetails(token0.address, transferAmount, from.address, ethers.constants.AddressZero)
      )

      transferDetails.push(
        buildAllowanceTransferDetails(token1.address, transferAmount, from.address, ethers.constants.AddressZero)
      )

      await (
        await permit2.connect(spender)['transferFrom((address,address,uint160,address)[])'](transferDetails)
      ).wait()

      let amount: BigNumberish = ethers.constants.One.pow(18)
      expect(await token0.balanceOf(from.address)).to.be.equal(startBalanceFrom0.sub(amount))
      expect(await token1.balanceOf(from.address)).to.be.equal(startBalanceFrom1.sub(amount))

      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(startBalanceTo0.add(amount))
      expect(await token0.balanceOf(ethers.constants.AddressZero)).to.be.equal(startBalanceTo1.add(amount))

      result0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result0.amount).to.be.equal(defaultAmount.sub(amount))
      result1 = await permit2.connect(from).allowance(from.address, token1.address, spender.address)
      expect(result1.amount).to.be.equal(defaultAmount.sub(amount))
    })
  })

  describe('Test BatchTransferFrom Different Owners', function () {
    it('BatchTransferFrom should not revert', async function () {
      let permitSingle: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        defaultNonce,
        spender.address,
        blockTimestamp
      )
      let sign: Uint8Array = getPermitSignature(permitSingle, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      let permitSingleDirty: PermitSingle = buildPermitSingle(
        token0.address,
        defaultAmount,
        defaultExpiration,
        dirtyNonce,
        spender.address,
        blockTimestamp
      )
      let signDirty: Uint8Array = getPermitSignature(
        permitSingleDirty,
        fromPrivateKeyDirty,
        await permit2.DOMAIN_SEPARATOR()
      )

      let startBalanceFrom: BigNumberish = await token0.balanceOf(from.address)
      let startBalanceTo: BigNumberish = await token0.balanceOf(spender.address)
      let startBalanceFromDirty: BigNumberish = await token0.balanceOf(fromDirty.address)

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](from.address, permitSingle, sign)
      ).wait()
      await (
        await permit2
          .connect(fromDirty)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            fromDirty.address,
            permitSingleDirty,
            signDirty
          )
      ).wait()

      let result0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result0.amount).to.be.equal(defaultAmount)

      let result1 = await permit2.connect(fromDirty).allowance(fromDirty.address, token0.address, spender.address)
      expect(result1.amount).to.be.equal(defaultAmount)

      let transferDetails: AllowanceTransferDetails[] = []

      let transferAmount: BigNumber = ethers.constants.One.pow(18)
      transferDetails.push({
        token: token0.address,
        amount: transferAmount,
        from: from.address,
        to: spender.address,
      })

      transferDetails.push({
        token: token0.address,
        amount: transferAmount,
        from: fromDirty.address,
        to: spender.address,
      })

      await (
        await permit2.connect(spender)['transferFrom((address,address,uint160,address)[])'](transferDetails)
      ).wait()

      let amount: BigNumberish = ethers.BigNumber.from(2).mul(ethers.constants.One.pow(18))
      expect(await token0.balanceOf(from.address)).to.be.equal(startBalanceFrom.sub(transferAmount))
      expect(await token0.balanceOf(fromDirty.address)).to.be.equal(startBalanceFromDirty.sub(transferAmount))
      expect(await token0.balanceOf(spender.address)).to.be.equal(startBalanceTo.add(amount))

      result0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result0.amount).to.be.equal(defaultAmount.sub(transferAmount))

      result1 = await permit2.connect(fromDirty).allowance(fromDirty.address, token0.address, spender.address)
      expect(result1.amount).to.be.equal(defaultAmount.sub(transferAmount))
    })
  })

  describe('Test Lockdown', function () {
    it('should pass lockdown test', async function () {
      let tokens: string[] = [token0.address, token1.address]
      let permitDetails: PermitDetails[] = []

      permitDetails.push(buildPermitDetails(tokens[0], defaultAmount, defaultExpiration, defaultNonce))
      permitDetails.push(buildPermitDetails(tokens[1], defaultAmount, defaultExpiration, defaultNonce))

      let permitBatch: PermitBatch = buildPermitBatch(permitDetails, spender.address, blockTimestamp)

      const sign: string = getPermitBatchSignature(permitBatch, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)'](from.address, permitBatch, sign)
      ).wait()

      let result0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)

      expect(result0.amount).to.be.equal(defaultAmount)
      expect(result0.expiration).to.be.equal(defaultExpiration)
      expect(result0.nonce).to.be.equal(ethers.constants.One)

      let result1 = await permit2.connect(from).allowance(from.address, token1.address, spender.address)
      expect(result1.amount).to.be.equal(defaultAmount)
      expect(result1.expiration).to.be.equal(defaultExpiration)
      expect(result1.nonce).to.be.equal(ethers.constants.One)

      let approvals: TokenSpenderPair[] = []

      approvals.push({
        token: token0.address,
        spender: spender.address,
      })

      approvals.push({
        token: token1.address,
        spender: spender.address,
      })

      await (await permit2.connect(from).lockdown(approvals)).wait()

      result0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result0.amount).to.be.equal(ethers.constants.Zero)
      expect(result0.expiration).to.be.equal(defaultExpiration)
      expect(result0.nonce).to.be.equal(ethers.constants.One)

      result1 = await permit2.connect(from).allowance(from.address, token1.address, spender.address)
      expect(result1.amount).to.be.equal(ethers.constants.Zero)
      expect(result1.expiration).to.be.equal(defaultExpiration)
      expect(result1.nonce).to.be.equal(ethers.constants.One)
    })
  })

  describe('Test Lockdown Event', function () {
    it('should pass lockdown', async function () {
      let tokens: string[] = [token0.address, token1.address]
      let permitDetails: PermitDetails[] = []

      permitDetails.push(buildPermitDetails(tokens[0], defaultAmount, defaultExpiration, defaultNonce))
      permitDetails.push(buildPermitDetails(tokens[1], defaultAmount, defaultExpiration, defaultNonce))

      let permitBatch: PermitBatch = buildPermitBatch(permitDetails, spender.address, blockTimestamp)

      const sign: string = getPermitBatchSignature(permitBatch, fromPrivateKey, await permit2.DOMAIN_SEPARATOR())

      await (
        await permit2
          .connect(from)
          ['permit(address,((address,uint160,uint48,uint48)[],address,uint256),bytes)'](from.address, permitBatch, sign)
      ).wait()

      let result0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result0.amount).to.be.equal(defaultAmount)
      expect(result0.expiration).to.be.equal(defaultExpiration)
      expect(result0.nonce).to.be.equal(ethers.constants.One)

      let result1 = await permit2.connect(from).allowance(from.address, token1.address, spender.address)
      expect(result1.amount).to.be.equal(defaultAmount)
      expect(result1.expiration).to.be.equal(defaultExpiration)
      expect(result1.nonce).to.be.equal(ethers.constants.One)

      let approvals: TokenSpenderPair[] = []

      approvals.push({
        token: token0.address,
        spender: spender.address,
      })

      approvals.push({
        token: token1.address,
        spender: spender.address,
      })
      await expect(permit2.connect(from).lockdown(approvals))
        .to.emit(permit2, 'Lockdown')
        .withArgs(from.address, token0.address, spender.address)

      result0 = await permit2.connect(from).allowance(from.address, token0.address, spender.address)
      expect(result0.amount).to.be.equal(ethers.constants.Zero)
      expect(result0.expiration).to.be.equal(defaultExpiration)
      expect(result0.nonce).to.be.equal(ethers.constants.One)

      result1 = await permit2.connect(from).allowance(from.address, token1.address, spender.address)
      expect(result1.amount).to.be.equal(ethers.constants.Zero)
      expect(result1.expiration).to.be.equal(defaultExpiration)
      expect(result1.nonce).to.be.equal(ethers.constants.One)
    })
  })
})
