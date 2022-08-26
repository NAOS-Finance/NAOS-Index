import {OWNER_ROLE, MINTER_ROLE, isMainnetForking, assertIsChainId, ContractDeployer} from "./deployHelpers"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"
import {Fidu} from "../../types/contracts/protocol/core"
import {Logger} from "./types"
import {getDeployEffects} from "./migrations/deployEffects"
import {getOrDeployUSDC} from "./baseDeploy/getOrDeployUSDC"
import {getOrDeployNAOS} from "./baseDeploy/getOrDeployNAOS"
import {deployBorrower} from "./baseDeploy/deployBorrower"
import {deployClImplementation} from "./baseDeploy/deployClImplementation"
import {deployFidu} from "./baseDeploy/deployFidu"
import {deployGoldfinchFactory} from "./baseDeploy/deployGoldfinchFactory"
import {deployPoolTokens} from "./baseDeploy/deployPoolTokens"
import {deploySeniorPool} from "./baseDeploy/deploySeniorPool"
import {deploySeniorPoolStrategies} from "./baseDeploy/deploySeniorPoolStrategies"
import {deployTranchedPool} from "./baseDeploy/deployTranchedPool"
import {deployTransferRestrictedVault} from "./baseDeploy/deployTransferRestrictedVault"
import {deployBackerRewards} from "./baseDeploy/deployBackerRewards"
import {deployConfig} from "./baseDeploy/deployConfig"
import {deployGo} from "./baseDeploy/deployGo"
import {deployUniqueIdentity} from "./baseDeploy/deployUniqueIdentity"

const logger: Logger = console.log

export const TOKEN_LAUNCH_TIME_IN_SECONDS = 1641920400 // Tuesday, January 11, 2022 09:00:00 AM GMT-08:00

export type Deployed<T> = {
  name: string
  contract: T
}

const baseDeploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (isMainnetForking()) {
    return
  }

  const deployEffects = await getDeployEffects()

  // @ts-ignore
  const {getNamedAccounts, getChainId} = hre
  const deployer = new ContractDeployer(logger, hre)
  logger("Starting deploy...")
  const {gf_deployer} = await getNamedAccounts()
  logger("Will be deploying using the gf_deployer account:", gf_deployer)

  const chainId = await getChainId()
  assertIsChainId(chainId)
  logger("Chain id is:", chainId)
  const config = await deployConfig(deployer)
  await getOrDeployUSDC(deployer, config)
  await getOrDeployNAOS(deployer, config)
  const fidu = await deployFidu(deployer, config)
  await deployPoolTokens(deployer, {config})
  await deployTransferRestrictedVault(deployer, {config})
  await deployTranchedPool(deployer, {config, deployEffects})

  await deploySeniorPool(deployer, {config, fidu})
  await deployBorrower(deployer, {config})
  await deploySeniorPoolStrategies(deployer, {config})
  logger("Deploying GoldfinchFactory")

  await deployGoldfinchFactory(deployer, {config})
  await deployClImplementation(deployer, {config})

  const {protocol_owner: trustedSigner} = await deployer.getNamedAccounts()
  const uniqueIdentity = await deployUniqueIdentity({deployer, trustedSigner, deployEffects})

  await deployGo(deployer, {configAddress: config.address, uniqueIdentity, deployEffects})
  await deployBackerRewards(deployer, {configAddress: config.address, deployEffects})

  await deployEffects.executeDeferred()
}

export async function grantMinterRoleToPool(fidu: Fidu, pool: any) {
  if (!(await fidu.hasRole(MINTER_ROLE, pool.address))) {
    await fidu.grantRole(MINTER_ROLE, pool.address)
  }
}

export {baseDeploy, deployBackerRewards}
