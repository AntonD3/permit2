import { MockERC20, Permit2 } from '../../typechain-types'
import { Wallet } from 'zksync-web3'
import { deployContract, provider, RICH_WALLET_PRIVATE_KEYS } from './shared/zkSyncUtils'
import { BigNumber, BigNumberish, ethers } from 'ethers'
import { expect } from './shared/expect'
import { buildPermitSingle, getCompactPermitSignature, PermitSingle } from './utils/PermitSignature'

const DECIMAL_MULT: BigNumber = ethers.BigNumber.from(10).pow(ethers.BigNumber.from(18))
const defaultExpiration: BigNumber = ethers.BigNumber.from(Date.now() + 50000)

describe('AllowanceTransferInvariants', function () {
  let permit2: Permit2
  let token: MockERC20
  let spender1: Wallet = new Wallet(RICH_WALLET_PRIVATE_KEYS[3].privateKey, provider)
  let spender2: Wallet = new Wallet(RICH_WALLET_PRIVATE_KEYS[2].privateKey, provider)
  let permitter1: Wallet = new Wallet(RICH_WALLET_PRIVATE_KEYS[1].privateKey, provider)
  let permitter2: Wallet = new Wallet(RICH_WALLET_PRIVATE_KEYS[0].privateKey, provider)
  let defaultNonce: BigNumberish = ethers.constants.Zero
  let chosePermitter: Wallet
  let choseSpender: Wallet
  let blockTimestamp: BigNumberish

  beforeEach(async function () {
    const timeStamp = (await provider.getBlock('latest')).timestamp
    blockTimestamp = ethers.BigNumber.from(timeStamp + 80000000)
    permit2 = <Permit2>await deployContract('Permit2')
    token = <MockERC20>await deployContract('MockERC20', ['Test0', 'TEST0', ethers.BigNumber.from(18)])

    await (await token.connect(permitter1).mint(permitter1.address, DECIMAL_MULT.mul(10000000))).wait()
    await (await token.connect(permitter2).mint(permitter2.address, DECIMAL_MULT.mul(10000000))).wait()

    await (await token.connect(permitter1).approve(permit2.address, ethers.constants.MaxUint256)).wait()
    await (await token.connect(permitter2).approve(permit2.address, ethers.constants.MaxUint256)).wait()

    chosePermitter = Math.floor(Math.random() * 2) ? permitter1 : permitter2
    choseSpender = Math.floor(Math.random() * 2) ? spender1 : spender2
  })

  describe('Spend Never Exceeds Permit', function () {
    it('spent should not exceeds permitted', async function () {
      let permitted: BigNumber = DECIMAL_MULT
      let permit: PermitSingle = buildPermitSingle(
        token.address,
        permitted,
        defaultExpiration,
        defaultNonce,
        choseSpender.address,
        blockTimestamp
      )
      let startBalanceFrom: BigNumberish = await token.connect(chosePermitter).balanceOf(chosePermitter.address)

      const sign: Uint8Array = getCompactPermitSignature(
        permit,
        chosePermitter.privateKey,
        await permit2.DOMAIN_SEPARATOR()
      )

      await (
        await permit2
          .connect(chosePermitter)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            chosePermitter.address,
            permit,
            sign
          )
      ).wait()
      await (
        await permit2
          .connect(choseSpender)
          ['transferFrom(address,address,uint160,address)'](
            chosePermitter.address,
            choseSpender.address,
            permitted,
            token.address
          )
      ).wait()

      expect(await token.connect(choseSpender).balanceOf(choseSpender.address)).to.be.equal(permitted)
      expect(await token.connect(chosePermitter).balanceOf(chosePermitter.address)).to.be.equal(
        startBalanceFrom.sub(permitted)
      )
    })
  })

  describe('Balance Equals Spent', function () {
    it('balance should equals spent', async function () {
      let permitted: BigNumber = DECIMAL_MULT
      let permit: PermitSingle = buildPermitSingle(
        token.address,
        permitted,
        defaultExpiration,
        defaultNonce,
        choseSpender.address,
        blockTimestamp
      )

      let startBalanceFrom: BigNumberish = await token.connect(chosePermitter).balanceOf(chosePermitter.address)

      const sign: Uint8Array = getCompactPermitSignature(
        permit,
        chosePermitter.privateKey,
        await permit2.DOMAIN_SEPARATOR()
      )

      await (
        await permit2
          .connect(chosePermitter)
          ['permit(address,((address,uint160,uint48,uint48),address,uint256),bytes)'](
            chosePermitter.address,
            permit,
            sign
          )
      ).wait()

      await (
        await permit2
          .connect(choseSpender)
          ['transferFrom(address,address,uint160,address)'](
            chosePermitter.address,
            choseSpender.address,
            permitted,
            token.address
          )
      ).wait()

      expect(await token.connect(choseSpender).balanceOf(choseSpender.address)).to.be.equal(
        startBalanceFrom.sub(await token.connect(chosePermitter).balanceOf(chosePermitter.address))
      )
    })
  })

  describe('Permit2 Never Holds Balance', function () {
    it('permit2 should have zero balance', async function () {
      expect(await token.connect(spender1).balanceOf(permit2.address)).to.be.equal(ethers.constants.Zero)
    })
  })
})
