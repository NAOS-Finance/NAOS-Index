import {IndexPool} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {grantMinterRoleToPool} from "../baseDeploy"
import {CONFIG_KEYS} from "../configKeys"
import {ContractDeployer, isTestEnv, getProtocolOwner, updateConfig} from "../deployHelpers"
import {DeployOpts} from "../types"

const logger = console.log

export async function deployIndexPool(deployer: ContractDeployer, {config, rwa}: DeployOpts): Promise<IndexPool> {
  let contractName = "IndexPool"
  if (isTestEnv()) {
    contractName = `Test${contractName}`
  }
  
  const {gf_deployer} = await deployer.getNamedAccounts()
  const protocol_owner = await getProtocolOwner()
  assertIsString(protocol_owner)
  assertIsString(gf_deployer)
  const accountant = await deployer.deployLibrary("Accountant", {from: gf_deployer, args: []})
  const seniorPool = await deployer.deploy<IndexPool>(contractName, {
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
    libraries: {["Accountant"]: accountant.address},
  })
  await updateConfig(config, "address", CONFIG_KEYS.IndexPool, seniorPool.address, {logger})
  await (await config.addToGoList(seniorPool.address)).wait()
  if (rwa) {
    logger(`Granting minter role to ${contractName}`)
    await grantMinterRoleToPool(rwa, seniorPool)
  }
  return seniorPool
}
