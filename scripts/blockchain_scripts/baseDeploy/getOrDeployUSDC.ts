import {TestUSDT} from "../../../types"
import BN from "bn.js"
import {getNamedAccounts} from "hardhat"
import {CONFIG_KEYS} from "../configKeys"
import {assertIsString} from "../utils"
import {
  ContractDeployer,
  assertIsChainId,
  getUSDCAddress,
  getProtocolOwner,
  USDC_DECIMALS,
  getContract,
  ETHERS_CONTRACT_PROVIDER,
  updateConfig,
  isUSDTEnv
} from "../deployHelpers"

const logger = console.log

export async function getOrDeployUSDC(deployer: ContractDeployer, config) {
  const {gf_deployer} = await getNamedAccounts()
  const chainId = await deployer.getChainId()
  assertIsChainId(chainId)
  let usdcAddress = getUSDCAddress(chainId)
  const protocolOwner = await getProtocolOwner()
  if (!usdcAddress) {
    logger("We don't have a USDC address for this network, so deploying a fake USDC")
    const initialAmount = String(new BN("100000000").mul(USDC_DECIMALS))
    const decimalPlaces = String(new BN(6))
    assertIsString(gf_deployer)
    const contractName = isUSDTEnv() ? "TestUSDT" : "TestUSDC"
    const args = isUSDTEnv() ? [initialAmount, "TestUSDT", "TestUSDT", decimalPlaces] : [initialAmount, String(decimalPlaces)]
    const fakeUSDC = await deployer.deploy(contractName, {
      from: gf_deployer,
      args: args,
    })
    usdcAddress = fakeUSDC.address
    const usdcContract = await getContract<TestUSDT, any>(contractName, ETHERS_CONTRACT_PROVIDER, {from: gf_deployer})
    await usdcContract.transfer(protocolOwner, String(new BN(100000000).mul(USDC_DECIMALS)))
  }
  await updateConfig(config, "address", CONFIG_KEYS.USDC, usdcAddress, logger)
  return usdcAddress
}
