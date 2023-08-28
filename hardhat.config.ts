import '@matterlabs/hardhat-zksync-deploy'
import '@matterlabs/hardhat-zksync-solc'
import '@matterlabs/hardhat-zksync-verify'
import '@nomicfoundation/hardhat-toolbox'
import '@matterlabs/hardhat-zksync-chai-matchers'
import { task } from 'hardhat/config'
import deploy from './script/deploy'

task('deploy')
  .addParam('privateKey', 'Private key used to deploy')
  .addParam('jsonRpc', 'JSON RPC URL where the program should be deployed')
  .setAction(async (taskArgs) => {
    await deploy(taskArgs)
  })

export default {
  networks: {
    zkSyncTestNode: {
      url: 'http://localhost:8011',
      ethNetwork: '',
      zksync: true,
    },
    zkSyncTestnet: {
      url: 'https://testnet.era.zksync.dev',
      ethNetwork: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
      zksync: true,
      verifyURL: 'https://zksync2-testnet-explorer.zksync.dev/contract_verification',
    },
    zkSyncMainnet: {
      url: 'https://mainnet.era.zksync.io',
      ethNetwork: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      zksync: true,
      verifyURL: 'https://zksync2-mainnet-explorer.zksync.io/contract_verification',
    },
  },
  defaultNetwork: 'zkSyncTestNode',
  solidity: {
    version: '0.8.17',
  },
  paths: {
    sources: './src',
  },
  zksolc: {
    version: '1.3.13',
    compilerSource: 'binary',
    settings: {
      metadata: {
        bytecodeHash: 'none',
      },
    },
  },
  mocha: {
    timeout: 1000000000000,
  },
}
