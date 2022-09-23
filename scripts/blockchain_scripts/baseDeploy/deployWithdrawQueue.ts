import { parseUnits } from "ethers/lib/utils";

import {assertIsString} from "../utils"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, getProtocolOwner, assertIsChainId, isTestEnv, updateConfig} from "../deployHelpers"
import {DeployOpts} from "../types"

const logger = console.log

export async function deployWithdrawQueue(deployer: ContractDeployer, {config}: DeployOpts) {
  const {gf_deployer} = await deployer.getNamedAccounts()
  const protocol_owner = await getProtocolOwner()
  assertIsString(protocol_owner)
  assertIsString(gf_deployer)
  const chainId = await deployer.getChainId()
  assertIsChainId(chainId)

  let contractName = "WithdrawQueue"

  // if (isTestEnv()) {
  //   contractName = "TestWithdrawQueue"
  // }

  logger("About to deploy Withdraw Queue...")
  const withdrawQueue = await deployer.deploy(contractName, {
    from: gf_deployer,
    proxy: {
      owner: protocol_owner,
      execute: {
        init: {
          methodName: "initialize",
          args: [protocol_owner, config.address],
        },
      },
    },
  })
  await withdrawQueue.setCeiling(parseUnits("5000", 18))
  await updateConfig(config, "address", CONFIG_KEYS.WithdrawQueue, withdrawQueue.address, {logger})
  return withdrawQueue
}