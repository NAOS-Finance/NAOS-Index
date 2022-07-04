import {baseDeploy} from "./blockchain_scripts/baseDeploy"
import hre from 'hardhat'

async function main() {
  await baseDeploy(hre)
}

if (require.main === module) {
  main()
    .then(console.log)
    .catch(console.error)
}

module.exports = main
module.exports.tags = ["base_deploy"]