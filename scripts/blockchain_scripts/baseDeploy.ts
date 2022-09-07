import {OWNER_ROLE, MINTER_ROLE, isMainnetForking, assertIsChainId, ContractDeployer} from "./deployHelpers"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {DeployFunction} from "hardhat-deploy/types"
import {RWA} from "../../types/contracts/protocol/core"
import {Logger} from "./types"
import {getDeployEffects} from "./migrations/deployEffects"
import {getOrDeployUSDC} from "./baseDeploy/getOrDeployUSDC"
import {getOrDeployNAOS} from "./baseDeploy/getOrDeployNAOS"
// import {deployBorrower} from "./baseDeploy/deployBorrower"
import {deployClImplementation} from "./baseDeploy/deployClImplementation"
import {deployRWA} from "./baseDeploy/deployRWA"
import {deployNAOSFactory} from "./baseDeploy/deployNAOSFactory"
import {deployPoolTokens} from "./baseDeploy/deployPoolTokens"
import {deployIndexPool} from "./baseDeploy/deployIndexPool"
import {deployIndexPoolStrategies} from "./baseDeploy/deployIndexPoolStrategies"
import {deployJuniorPool} from "./baseDeploy/deployJuniorPool"
import {deployJuniorRewards} from "./baseDeploy/deployJuniorRewards"
import {deployConfig} from "./baseDeploy/deployConfig"
import {deployVerified} from "./baseDeploy/deployVerified"
import {deployWithdrawQueue} from "./baseDeploy/deployWithdrawQueue"
import {deployBoostPool} from "./baseDeploy/deployBoostPool"
import {deployLoanManager} from "./baseDeploy/deployLoanManager"
import {deployUniqueIdentity} from "./baseDeploy/deployUniqueIdentity"
import {deployIndexStakingPool} from "./baseDeploy/deployIndexStakingPool"

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
  const rwa = await deployRWA(deployer, config)
  await deployPoolTokens(deployer, {config})
  await deployJuniorPool(deployer, {config, deployEffects})

  await deployIndexPool(deployer, {config, rwa})
  // // await deployBorrower(deployer, {config})
  await deployIndexPoolStrategies(deployer, {config})
  logger("Deploying NAOSFactory")

  await deployNAOSFactory(deployer, {config})
  await deployClImplementation(deployer, {config})

  const {protocol_owner: trustedSigner} = await deployer.getNamedAccounts()
  const uniqueIdentity = await deployUniqueIdentity({deployer, trustedSigner, deployEffects})

  await deployVerified(deployer, {config: config, uniqueIdentity, deployEffects})
  await deployWithdrawQueue(deployer, {config})
  await deployBoostPool(deployer, {config})
  await deployLoanManager(deployer, {config})
  await deployJuniorRewards(deployer, {config: config, deployEffects})
  await deployIndexStakingPool(deployer, {config: config, deployEffects})

  // await deployEffects.executeDeferred()
}

export async function grantMinterRoleToPool(rwa: RWA, pool: any) {
  if (!(await rwa.hasRole(MINTER_ROLE, pool.address))) {
    await rwa.grantRole(MINTER_ROLE, pool.address)
  }
}

export {baseDeploy}
