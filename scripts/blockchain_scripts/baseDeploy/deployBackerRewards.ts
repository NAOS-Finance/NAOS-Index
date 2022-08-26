import {GoldfinchConfig} from "../../../types/contracts/protocol/core"
import {BackerRewards} from "../../../types/contracts/rewards"
import {assertIsString} from "../utils"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, isTestEnv, getProtocolOwner, getEthersContract, ETHERS_CONTRACT_PROVIDER} from "../deployHelpers"
import {DeployEffects} from "../migrations/deployEffects"

const logger = console.log

export async function deployBackerRewards(
  deployer: ContractDeployer,
  {
    configAddress,
    deployEffects,
  }: {
    configAddress: string
    deployEffects: DeployEffects
  }
): Promise<BackerRewards> {
  const {gf_deployer} = await deployer.getNamedAccounts()
  const contractName = "BackerRewards"
  logger("About to deploy BackerRewards...")
  assertIsString(gf_deployer)
  const protocol_owner = await getProtocolOwner()
  const backerRewards = await deployer.deploy<BackerRewards>(contractName, {
    from: gf_deployer,
    gasLimit: 4000000,
    proxy: {
      owner: protocol_owner,
      execute: {
        init: {
          methodName: "__initialize__",
          args: [protocol_owner, configAddress],
        },
      },
    },
  })

  const contract = await getEthersContract<BackerRewards>("BackerRewards", {at: backerRewards.address})

  const goldfinchConfig = await getEthersContract<GoldfinchConfig>("GoldfinchConfig", {at: configAddress})

  logger("Updating config...")
  await deployEffects.add({
    deferred: [await goldfinchConfig.populateTransaction.setAddress(CONFIG_KEYS.BackerRewards, contract.address)],
  })
  logger("Updated BackerRewards config address to:", contract.address)

  return contract
}
