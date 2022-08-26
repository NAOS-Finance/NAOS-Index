import {TestNAOS} from "../../../types"
import BN from "bn.js"
import {getNamedAccounts} from "hardhat"
import {CONFIG_KEYS} from "../configKeys"
import {assertIsString} from "../utils"
import {
  ContractDeployer,
  assertIsChainId,
  getNAOSAddress,
  getProtocolOwner,
  NAOS_DECIMALS,
  getContract,
  ETHERS_CONTRACT_PROVIDER,
  updateConfig,
  isTestEnv,
} from "../deployHelpers"

const logger = console.log

export async function getOrDeployNAOS(deployer: ContractDeployer, config) {
  const {gf_deployer} = await getNamedAccounts()
  const chainId = await deployer.getChainId()
  assertIsChainId(chainId)
  let naosAddress = getNAOSAddress(chainId)
  const protocolOwner = await getProtocolOwner()
  if (!naosAddress) {
    logger("We don't have a NAOS address for this network, so deploying a fake NAOS")
    const initialAmount = String(new BN("100000000").mul(NAOS_DECIMALS))
    const decimalPlaces = String(new BN(18))
    assertIsString(gf_deployer)
    const fakeNAOS = await deployer.deploy("TestNAOS", {
      from: gf_deployer,
      args: [initialAmount, decimalPlaces],
    })
    naosAddress = fakeNAOS.address
    const naosContract = await getContract<TestNAOS, any>("TestNAOS", ETHERS_CONTRACT_PROVIDER, {from: gf_deployer})
    await naosContract.transfer(protocolOwner, String(new BN(100000000).mul(NAOS_DECIMALS)))
  }
  await updateConfig(config, "address", CONFIG_KEYS.NAOS, naosAddress, logger)
  return naosAddress
}
