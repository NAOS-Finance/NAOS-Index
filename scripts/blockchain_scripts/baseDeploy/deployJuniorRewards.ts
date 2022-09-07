import {NAOSConfig} from "../../../types/contracts/protocol/core"
import {JuniorRewards} from "../../../types"
import {assertIsString} from "../utils"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, isTestEnv, getProtocolOwner, getEthersContract, ETHERS_CONTRACT_PROVIDER, updateConfig} from "../deployHelpers"
import {DeployEffects} from "../migrations/deployEffects"

const logger = console.log

export async function deployJuniorRewards(
  deployer: ContractDeployer,
  {
    config,
    deployEffects,
  }: {
    config: NAOSConfig
    deployEffects: DeployEffects
  }
): Promise<JuniorRewards> {
  const {gf_deployer} = await deployer.getNamedAccounts()
  const contractName = "JuniorRewards"
  logger("About to deploy JuniorRewards...")
  assertIsString(gf_deployer)
  const protocol_owner = await getProtocolOwner()
  const juniorRewards = await deployer.deploy<JuniorRewards>(contractName, {
    from: gf_deployer,
    gasLimit: 4000000,
    proxy: {
      owner: protocol_owner,
      execute: {
        init: {
          methodName: "__initialize__",
          args: [protocol_owner, config.address],
        },
      },
    },
  })

  const contract = await getEthersContract<JuniorRewards>("JuniorRewards", {at: juniorRewards.address})

  // const naosConfig = await getEthersContract<NAOSConfig>("NAOSConfig", {at: configAddress})

  logger("Updating config...")
  await updateConfig(config, "address", CONFIG_KEYS.JuniorRewards, contract.address, {logger})
  // await naosConfig.setAddress(CONFIG_KEYS.JuniorRewards, contract.address)
  // await deployEffects.add({
  //   deferred: [await naosConfig.populateTransaction.setAddress(CONFIG_KEYS.StakingRewards, contract.address)],
  // })
  logger("Updated JuniorRewards config address to:", contract.address)

  return contract
}
