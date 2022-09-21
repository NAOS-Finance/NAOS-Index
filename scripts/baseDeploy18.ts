import {baseDeploy18} from "./blockchain_scripts/baseDeploy18"
import hre from 'hardhat'

async function main() {
  await baseDeploy18(hre)
}

if (require.main === module) {
  main()
    .then(console.log)
    .catch(console.error)
}

module.exports = main
module.exports.tags = ["base_deploy"]
