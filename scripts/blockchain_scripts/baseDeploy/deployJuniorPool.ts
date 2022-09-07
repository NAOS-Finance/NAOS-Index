import {NAOSConfig} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {ContractDeployer, isTestEnv} from "../deployHelpers"
import {DeployEffects} from "../migrations/deployEffects"

export async function deployJuniorPool(
  deployer: ContractDeployer,
  {config, deployEffects}: {config: NAOSConfig; deployEffects: DeployEffects}
) {
  const logger = console.log
  const {gf_deployer} = await deployer.getNamedAccounts()

  logger("About to deploy JuniorPool...")
  let contractName = "JuniorPool"
  // TODO: contract too large error
  if (isTestEnv()) {
    contractName = `Test${contractName}`
  }

  assertIsString(gf_deployer)
  const tranchingLogic = await deployer.deployLibrary("TranchingLogic", {from: gf_deployer, args: []})
  logger("About to deploy JuniorPool implementation...")
  const juniorPoolImpl = await deployer.deploy(contractName, {
    from: gf_deployer,
    libraries: {["TranchingLogic"]: tranchingLogic.address},
  })
  logger("Updating config...")
  await config.setJuniorPoolImplementation(juniorPoolImpl.address)
  // await deployEffects.add({
  //   deferred: [await config.populateTransaction.setJuniorPoolImplementation(juniorPoolImpl.address)],
  // })
  logger("Updated juniorPoolImplementation config address to:", juniorPoolImpl.address)
  return juniorPoolImpl
}
