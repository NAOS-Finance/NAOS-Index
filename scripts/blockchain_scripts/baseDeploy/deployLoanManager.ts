import {assertIsString} from "../utils"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, getProtocolOwner, assertIsChainId, isTestEnv, updateConfig} from "../deployHelpers"
import {DeployOpts} from "../types"

const logger = console.log

export async function deployLoanManager(deployer: ContractDeployer, {config}: DeployOpts) {
  const {gf_deployer} = await deployer.getNamedAccounts()
  const protocol_owner = await getProtocolOwner()
  assertIsString(protocol_owner)
  assertIsString(gf_deployer)
  const chainId = await deployer.getChainId()
  assertIsChainId(chainId)

  let contractName = "LoanManager"

  // if (isTestEnv()) {
  //   contractName = "TestLoanManager"
  // }

  logger("About to deploy Loan Manager...")
  const loanManager = await deployer.deploy(contractName, {
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
  await updateConfig(config, "address", CONFIG_KEYS.LoanManager, loanManager.address, {logger})
  return loanManager
}