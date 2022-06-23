import {TestERC20} from "../../../types/contracts/protocol/test"
// import {TestERC20Instance} from "../../../types/contracts/protocol/core"
// import {assertIsString} from "@goldfinch-eng/utils"
import BN from "bn.js"
import {getNamedAccounts} from "hardhat"
import {CONFIG_KEYS} from "../configKeys"
import {
  ContractDeployer,
  assertIsChainId,
  getUSDCAddress,
  getProtocolOwner,
  USDCDecimals,
  getContract,
  TRUFFLE_CONTRACT_PROVIDER,
  ETHERS_CONTRACT_PROVIDER,
  updateConfig,
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
    const initialAmount = String(new BN("100000000").mul(USDCDecimals))
    const decimalPlaces = String(new BN(6))
    // assertIsString(gf_deployer)
    const fakeUSDC = await deployer.deploy("TestERC20", {
      from: gf_deployer,
      args: [initialAmount, decimalPlaces],
    })
    usdcAddress = fakeUSDC.address
    const usdcContract = await getContract<TestERC20, any>("TestERC20", ETHERS_CONTRACT_PROVIDER, {from: gf_deployer})
    await usdcContract.mint(gf_deployer, initialAmount)
    // console.log(usdcAddress, usdcContract.address, initialAmount.toString(), (await usdcContract.balanceOf(gf_deployer)).toString(), (await usdcContract.totalSupply()).toString())
    // console.log(await usdcContract.mint(gf_deployer, initialAmount))
    // console.log(usdcAddress, usdcContract.address, initialAmount.toString(), (await usdcContract.balanceOf(gf_deployer)).toString(), (await usdcContract.totalSupply()).toString())
    await usdcContract.transfer(protocolOwner, String(new BN(10000000).mul(USDCDecimals)))
  }
  await updateConfig(config, "address", CONFIG_KEYS.USDC, usdcAddress, logger)
  return usdcAddress
}
