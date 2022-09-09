import {NAOSFactory} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {getNamedAccounts} from "hardhat"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, getProtocolOwner, updateConfig} from "../deployHelpers"
import {DeployOpts} from "../types"

const logger = console.log

export async function deployNAOSFactory(
  deployer: ContractDeployer,
  {config}: DeployOpts
): Promise<NAOSFactory> {
  // logger("Deploying NAOS factory")
  const {gf_deployer} = await getNamedAccounts()
  assertIsString(gf_deployer)
  const accountant = await deployer.deployLibrary("Accountant", {from: gf_deployer, args: []})
  const protocol_owner = await getProtocolOwner()

  const naosFactory = await deployer.deploy<NAOSFactory>("NAOSFactory", {
    from: gf_deployer,
    proxy: {
      owner: gf_deployer,
      execute: {
        init: {
          methodName: "initialize",
          args: [protocol_owner, config.address],
        },
      },
    },
    libraries: {
      ["Accountant"]: accountant.address,
    },
  })
  const naosFactoryAddress = naosFactory.address

  await updateConfig(config, "address", CONFIG_KEYS.NAOSFactory, naosFactoryAddress, {logger})
  return naosFactory
}
