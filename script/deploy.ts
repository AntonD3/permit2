import { Wallet, Provider, utils } from 'zksync-web3'
import * as ethers from 'ethers'

// TODO
const SALT = '0x0000000000000000000000000000000000000000000000000000000000000000'

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

  const ABI = ['function deploy(bytes32 _salt, bytes32 _bytecodehash, bytes calldata _calldata)']
  const iface = new ethers.utils.Interface(ABI)
  const calldata = iface.encodeFunctionData('deploy', [SALT, utils.hashBytecode(artifact.bytecode), []])

  const factoryDeps = [artifact.bytecode]

  const tx: ethers.providers.TransactionRequest = {
    to: args.create2Factory,

    data: calldata,

    customData: {
      factoryDeps,
    },
  }

  const receipt = await (await wallet.sendTransaction(tx)).wait()
  console.log(`Permit2 deploy transaction hash: ${receipt.transactionHash}`)
}
