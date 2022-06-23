import {baseDeploy} from "./blockchain_scripts/baseDeploy"
import hre from 'hardhat'

async function main() {
  await baseDeploy(hre)
}

// module.exports = main
// module.exports.tags = ["base_deploy"]
main()
  .then(console.log)
  .catch(console.error)