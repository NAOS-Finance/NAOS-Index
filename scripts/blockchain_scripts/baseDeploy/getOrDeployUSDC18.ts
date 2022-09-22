import {TestUSDC} from "../../../types"
import BN from "bn.js"
import {getNamedAccounts} from "hardhat"
import {CONFIG_KEYS} from "../configKeys"
import {assertIsString} from "../utils"
import {
  ContractDeployer,
  assertIsChainId,
  getUSDCAddress,
  getProtocolOwner,
  getContract,
  ETHERS_CONTRACT_PROVIDER,
  updateConfig,
  DAI_DECIMALS
} from "../deployHelpers"

const logger = console.log

export async function getOrDeployUSDC18(deployer: ContractDeployer, config) {
  const {gf_deployer} = await getNamedAccounts()
  const chainId = await deployer.getChainId()
  assertIsChainId(chainId)
  let usdcAddress = getUSDCAddress(chainId)
  const protocolOwner = await getProtocolOwner()
  if (!usdcAddress) {
    logger("We don't have a USDC address for this network, so deploying a fake USDC")
    const decimalPlaces = new BN(18)
    const initialAmount = String(new BN("100000000").mul(DAI_DECIMALS))
    assertIsString(gf_deployer)
    const fakeUSDC = await deployer.deploy("TestUSDC", {
      from: gf_deployer,
      args: [initialAmount, String(decimalPlaces)],
    })
    usdcAddress = fakeUSDC.address
    const usdcContract = await getContract<TestUSDC, any>("TestUSDC", ETHERS_CONTRACT_PROVIDER, {from: gf_deployer})
    await usdcContract.transfer(protocolOwner, String(new BN(100000000).mul(DAI_DECIMALS)))
  }
  await updateConfig(config, "address", CONFIG_KEYS.USDC, usdcAddress, logger)
  return usdcAddress
}
