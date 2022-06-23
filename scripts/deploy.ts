import hre from 'hardhat'
import {OWNER_ROLE, MINTER_ROLE, isMainnetForking, assertIsChainId, ContractDeployer} from "./blockchain_scripts/deployHelpers"
import {getDeployEffects} from "./blockchain_scripts/migrations/deployEffects"
import {deployConfig} from "./blockchain_scripts/baseDeploy/deployConfig"
import {getOrDeployUSDC} from "./blockchain_scripts/baseDeploy/getOrDeployUSDC"
import {deployFidu} from "./blockchain_scripts/baseDeploy/deployFidu"
import {deployPoolTokens} from "./blockchain_scripts/baseDeploy/deployPoolTokens"
import {deployTransferRestrictedVault} from "./blockchain_scripts/baseDeploy/deployTransferRestrictedVault"
// import {deployPool} from "./blockchain_scripts/baseDeploy/deployPool"
import {deployTranchedPool} from "./blockchain_scripts/baseDeploy/deployTranchedPool"
// import {deployCreditDesk} from "./blockchain_scripts/baseDeploy/deployCreditDesk"
import {deploySeniorPool} from "./blockchain_scripts/baseDeploy/deploySeniorPool"
import {deployBorrower} from "./blockchain_scripts/baseDeploy/deployBorrower"
import {deploySeniorPoolStrategies} from "./blockchain_scripts/baseDeploy/deploySeniorPoolStrategies"
import {deployGoldfinchFactory} from "./blockchain_scripts/baseDeploy/deployGoldfinchFactory"
import {deployClImplementation} from "./blockchain_scripts/baseDeploy/deployClImplementation"
import {deployGo} from "./blockchain_scripts/baseDeploy/deployGo"
import {deployUniqueIdentity} from "./blockchain_scripts/baseDeploy/deployUniqueIdentity"
// import {grantOwnershipOfPoolToCreditDesk} from "./blockchain_scripts/baseDeploy"
import {deployBackerRewards} from "./blockchain_scripts/baseDeploy/deployBackerRewards"


// // import {deployCommunityRewards} from "./baseDeploy/deployCommunityRewards"
// import {deployGFI} from "./baseDeploy/deployGFI"
// import {deployLPStakingRewards} from "./baseDeploy/deployLPStakingRewards"


async function main() {
  const logger = console.log
  const deployEffects = await getDeployEffects()
  const deployer = new ContractDeployer(logger, hre)
  const config = await deployConfig(deployer)
  await getOrDeployUSDC(deployer, config)
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

  // logger("Granting ownership of Pool to CreditDesk")
  // await grantOwnershipOfPoolToCreditDesk(pool, creditDesk.address)

  await deployEffects.executeDeferred()
  return uniqueIdentity
}

// module.exports = main
// module.exports.tags = ["base_deploy"]
main()
  .then(console.log)
  .catch(console.error)