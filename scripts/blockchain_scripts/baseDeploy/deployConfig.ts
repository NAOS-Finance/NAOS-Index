import {GoldfinchConfig} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, ZERO_ADDRESS, getProtocolOwner, setInitialConfigVals} from "../deployHelpers"

const logger = console.log

export async function deployConfig(deployer: ContractDeployer): Promise<GoldfinchConfig> {
  const {gf_deployer} = await deployer.getNamedAccounts()
  const contractName = "GoldfinchConfig"

  assertIsString(gf_deployer)
  const config = await deployer.deploy<GoldfinchConfig>(contractName, {from: gf_deployer})
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
