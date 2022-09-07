import {NAOSConfig} from "../../../types/contracts/protocol/core"
import {IndexStakingPool} from "../../../types"
import {assertIsString} from "../utils"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, isTestEnv, getProtocolOwner, getEthersContract, ETHERS_CONTRACT_PROVIDER, updateConfig} from "../deployHelpers"
import {DeployEffects} from "../migrations/deployEffects"

const logger = console.log

export async function deployIndexStakingPool(
  deployer: ContractDeployer,
  {
    config,
    deployEffects,
  }: {
    config: NAOSConfig
    deployEffects: DeployEffects
  }
): Promise<IndexStakingPool> {
  const {gf_deployer} = await deployer.getNamedAccounts()
  const contractName = "IndexStakingPool"
  logger("About to deploy IndexStakingPool...")
  assertIsString(gf_deployer)
  const protocol_owner = await getProtocolOwner()
  const indexStakingPool = await deployer.deploy<IndexStakingPool>(contractName, {
    from: gf_deployer,
    gasLimit: 4000000,
    args: [await config.getAddress(CONFIG_KEYS.NAOS), await config.getAddress(CONFIG_KEYS.BoostPool), protocol_owner]
  })

  const contract = await getEthersContract<IndexStakingPool>("IndexStakingPool", {at: indexStakingPool.address})

  // const naosConfig = await getEthersContract<NAOSConfig>("NAOSConfig", {at: configAddress})

  logger("Updating config...")
  await updateConfig(config, "address", CONFIG_KEYS.StakingRewards, contract.address, {logger})
  // await naosConfig.setAddress(CONFIG_KEYS.JuniorRewards, contract.address)
  // await deployEffects.add({
  //   deferred: [await naosConfig.populateTransaction.setAddress(CONFIG_KEYS.StakingRewards, contract.address)],
  // })
  logger("Updated IndexStakingPool config address to:", contract.address)

  return contract
}
