import {GoldfinchConfig} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {ContractDeployer, isTestEnv} from "../deployHelpers"
import {DeployEffects} from "../migrations/deployEffects"

export async function deployTranchedPool(
  deployer: ContractDeployer,
  {config, deployEffects}: {config: GoldfinchConfig; deployEffects: DeployEffects}
) {
  const logger = console.log
  const {gf_deployer} = await deployer.getNamedAccounts()

  logger("About to deploy TranchedPool...")
  let contractName = "TranchedPool"
  // if (isTestEnv()) {
  //   contractName = `Test${contractName}`
  // }

  assertIsString(gf_deployer)
  const tranchingLogic = await deployer.deployLibrary("TranchingLogic", {from: gf_deployer, args: []})
  logger("About to deploy TranchedPool implementation...")
  const tranchedPoolImpl = await deployer.deploy(contractName, {
    from: gf_deployer,
    libraries: {["TranchingLogic"]: tranchingLogic.address},
  })
  logger("Updating config...")
  await deployEffects.add({
    deferred: [await config.populateTransaction.setTranchedPoolImplementation(tranchedPoolImpl.address)],
  })
  logger("Updated TranchedPoolImplementation config address to:", tranchedPoolImpl.address)
  return tranchedPoolImpl
}
