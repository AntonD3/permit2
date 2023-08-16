import { expect } from 'chai'
import { ethers } from 'ethers'
import {deployContract, provider, RICH_WALLET_PRIVATE_KEYS} from './shared/zkSyncUtils'
import { MockEIP712WithCustomChainID, Permit2 } from '../../typechain-types'
import { Wallet } from 'zksync-web3'

describe('EIP712', function () {
  const TYPE_HASH = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
  )
  const NAME_HASH = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('Permit2'))

  let permit2: Permit2
  let EIP712WithCustomChainID: MockEIP712WithCustomChainID
  let owner: Wallet = new Wallet(RICH_WALLET_PRIVATE_KEYS[0].privateKey, provider)

  describe('Test Domain Separator', function () {
    beforeEach('Deploy Permit2', async () => {
      permit2 = <Permit2>await deployContract('Permit2')
      EIP712WithCustomChainID = (await deployContract('MockEIP712WithCustomChainID')) as MockEIP712WithCustomChainID
    })

    describe('Domain separator should match with encoded separator', function () {
      it('should match with encoded separator', async () => {
        const chainId: number = +(await provider.getNetwork()).chainId

        const expectedDomainSeparator = ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ['bytes32', 'bytes32', 'uint256', 'address'],
            [TYPE_HASH, NAME_HASH, ethers.BigNumber.from(chainId), permit2.address]
          )
        )
        expect(await permit2.connect(owner).DOMAIN_SEPARATOR()).to.equal(expectedDomainSeparator)
      })
    })

    describe('Domain separator after fork should match', function () {
      it('should change domain_separator after change chainID', async () => {
        const newChainId: number = (await provider.getNetwork()).chainId + 11

        await (await EIP712WithCustomChainID.connect(owner).setChainID(ethers.BigNumber.from(newChainId))).wait()
        const expectedDomainSeparator = ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ['bytes32', 'bytes32', 'uint256', 'address'],
            [TYPE_HASH, NAME_HASH, ethers.BigNumber.from(newChainId), EIP712WithCustomChainID.address]
          )
        )

        let newDomainSeparator = await EIP712WithCustomChainID.connect(owner).DOMAIN_SEPARATOR()
        await expect(newDomainSeparator).to.be.equal(expectedDomainSeparator)
      })
    })
  })
})
