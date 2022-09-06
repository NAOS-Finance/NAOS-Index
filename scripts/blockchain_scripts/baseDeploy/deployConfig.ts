import {NAOSConfig} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, isTestEnv, ZERO_ADDRESS, getProtocolOwner, setInitialConfigVals} from "../deployHelpers"

const logger = console.log

export async function deployConfig(deployer: ContractDeployer): Promise<NAOSConfig> {
  const {gf_deployer} = await deployer.getNamedAccounts()
  let contractName = "NAOSConfig"
  if (isTestEnv()) {
    contractName = `Test${contractName}`
  }

  assertIsString(gf_deployer)
  const config = await deployer.deploy<NAOSConfig>(contractName, {from: gf_deployer})
  const checkAddress = await config.getAddress(CONFIG_KEYS.TreasuryReserve)
  if (checkAddress === ZERO_ADDRESS) {
    logger("Config newly deployed, initializing...")
    const protocol_owner = await getProtocolOwner()
    assertIsString(protocol_owner)
    await (await config.initialize(protocol_owner)).wait()
  }

  await setInitialConfigVals(config, logger)

  return config
}
