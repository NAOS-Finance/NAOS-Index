require('dotenv').config()
import "@nomiclabs/hardhat-ethers"
// import "@nomiclabs/hardhat-waffle"
import "@nomiclabs/hardhat-web3"
import "@nomiclabs/hardhat-truffle5"
// import '@openzeppelin/hardhat-upgrades'
import "@typechain/hardhat"
import "hardhat-gas-reporter"
import "hardhat-contract-sizer"
import "hardhat-deploy"

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more
/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  namedAccounts: {
    protocol_owner: {
      default: 0,
      1: "0xc840B3e21FF0EBA77468AD450d868D4362cF67fE",
      4: "0x12B82166fd044aC854D3Fc15C48B5719Ca8Dfb94",
      5: "0xBA1827Efe12593dBFf5e67b67A7Ab2888EF94765",
      31337: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    },
    gf_deployer: {
      default: 1,
      1: "0xa083880F7a5df37Bf00a25380C3eB9AF9cD92D8f",
      4: "0x12B82166fd044aC854D3Fc15C48B5719Ca8Dfb94",
      5: "0x9A84E62244CA4f45A8dd87b9f6B97C812EDeF653",
      31337: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    },
    temp_multisig: {
      1: "0x60d2be34bce277f5f5889adfd4991baefa17461c",
      4: "0x80B9823A6D12Cc00d70E184b2b310d360220E792",
      5: "0xBA1827Efe12593dBFf5e67b67A7Ab2888EF94765",
      31337: "0x60d2be34bce277f5f5889adfd4991baefa17461c",
    },
  },
  // gasReporter: {
  //   enabled: process.env.REPORT_GAS ? true : false,
  //   coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  //   currency: "USD",
  //   src: "contracts/protocol",
  // },
  // contractSizer: {
  //   runOnCompile: true,
  //   strict: process.env.CI !== undefined,
  //   except: [":Test.*", ":MigratedTranchedPool$"],
  // },
  // docgen: {
  //   // Cf. https://github.com/OpenZeppelin/solidity-docgen/blob/master/src/config.ts
  //   outputDir: "solidity-docgen-docs",
  //   pages: "files",
  //   templates: "docs-templates",
  // },
  typechain: {
    outDir: './types',
    target: 'ethers-v5',
    alwaysGenerateOverloads: false,
    // externalArtifacts: [],
  },
  solidity: {
    compilers: [
      // {
      //   version: "0.5.15",
      //   settings: {
      //     optimizer: {
      //       enabled: true,
      //       runs: 200
      //     }
      //   }
      // },
      // {
      //   version: "0.6.0",
      //   settings: {
      //     optimizer: {
      //       enabled: true,
      //       runs: 200
      //     }
      //   }
      // },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100
          }
        }
      },
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 100
          }
        }
      },
    ],
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  },
  defaultNetwork: "localhost",
  networks: {
    hardhat: {
      mining: {
        mempool: {
          order: "fifo",
        },
      },
      allowUnlimitedContractSize: true,
      timeout: 1800000,
      accounts: {mnemonic: "test test test test test test test test test test test junk"},
    //   chainId: process.env.HARDHAT_FORK === "mainnet" ? 1 : 31337,
    //   forking: process.env.HARDHAT_FORK
    //     ? {
    //         url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
    //         blockNumber: 14762303, // May-12-2022 05:07:13 PM +UTC
    //       }
    //     : undefined,
    },
    goerli: {
      url: 'https://eth-goerli.g.alchemy.com/v2/EuYRPrN3oUqZ2eKQ-5xL4k6d4v3d2vLj',
      accounts: [
        process.env.PRIVATE_KEY_1,
        process.env.PRIVATE_KEY_2
      ]
    }
  },
  mocha: {
    // timeout: 0,
    reporter: "list",
  }
}
