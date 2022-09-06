import hre from 'hardhat'
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {MAINNET_CHAIN_ID} from "./blockchain_scripts/deployHelpers"
import {createTestPool} from "./blockchain_scripts/setUpForTesting"

async function main() {
  await createTestPool(hre)
}

if (require.main === module) {
  main()
    .then(console.log)
    .catch(console.error)
}

module.exports = main
module.exports.dependencies = ["base_deploy"]
module.exports.tags = ["deploy_junior_pool"]
module.exports.skip = async ({getChainId}: HardhatRuntimeEnvironment) => {
  const chainId = await getChainId()
  return String(chainId) === MAINNET_CHAIN_ID
}
