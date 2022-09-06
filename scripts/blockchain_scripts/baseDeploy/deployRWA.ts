import {NAOSConfig, RWA} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {getNamedAccounts} from "hardhat"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, getProtocolOwner, updateConfig} from "../deployHelpers"

const logger = console.log

export async function deployRWA(deployer: ContractDeployer, config: NAOSConfig): Promise<RWA> {
  logger("About to deploy RWA...")
  const {gf_deployer} = await getNamedAccounts()
  assertIsString(gf_deployer)
  const protocol_owner = await getProtocolOwner()
  const rwa = await deployer.deploy<RWA>("RWA", {
    from: gf_deployer,
    proxy: {
      owner: protocol_owner,
      execute: {
        init: {
          methodName: "__initialize__",
          args: [protocol_owner, "RWA", "RWA", config.address],
        },
      },
    },
  })
  const fiduAddress = rwa.address

  await updateConfig(config, "address", CONFIG_KEYS.RWA, fiduAddress, {logger})
  return rwa
}
