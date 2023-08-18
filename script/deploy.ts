import { Wallet, Provider, utils } from 'zksync-web3'
import * as ethers from 'ethers'

const CREATE2_FACTORY_ADDRESS = '0xa51baf6a9c0ef5Db8C1898d5aDD92Bf3227d6088'
const CREATE2_FACTORY_ABI = ['function deploy(bytes32 _salt, bytes32 _bytecodehash, bytes calldata _calldata)']

const SALT = '0x18e1e988135bdcd793f3224d203216c44d10b17b9faf570e830350ea3a53e38e'

export default async function deploy(args: any) {
  console.log(`Running deploy script for the permit2 contract`)

  let url: URL
  try {
    url = new URL(args.jsonRpc)
  } catch (error) {
    console.error('Invalid JSON RPC URL', (error as Error).message)
    process.exit(1)
  }

  const wallet = new Wallet(args.privateKey, new Provider({ url: url.href }))

  const hre = require('hardhat')
  const artifact = hre.artifacts.readArtifactSync('Permit2')

  const iface = new ethers.utils.Interface(CREATE2_FACTORY_ABI)
  const calldata = iface.encodeFunctionData('deploy', [SALT, utils.hashBytecode(artifact.bytecode), []])

  const factoryDeps = [artifact.bytecode]

  const tx: ethers.providers.TransactionRequest = {
    to: CREATE2_FACTORY_ADDRESS,

    data: calldata,

    customData: {
      factoryDeps,
    },
  }

  const receipt = await (await wallet.sendTransaction(tx)).wait()
  console.log(`Permit2 deploy transaction hash: ${receipt.transactionHash}`)
}
