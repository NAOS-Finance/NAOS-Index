import {
  getProtocolOwner,
  getEthersContract,
  interestAprAsBN,
  MAX_UINT,
  TRANCHES,
  isUSDTEnv
} from "../../scripts/blockchain_scripts/deployHelpers"
import {
  Accountant,
  CreditLine,
  ERC20,
  NAOSFactory,
  TestAccountant,
  JuniorPool,
} from "../../types"
import hre, {deployments, getNamedAccounts} from "hardhat"
import {FixtureFunc} from "hardhat-deploy/types"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {asNonNullable, assertNonNullable} from "../../scripts/blockchain_scripts/utils"
import {
  $TSFixMe,
  BN,
  deployContracts,
  deployAllContracts,
  DeployAllContractsOptions,
  erc20Approve,
  getDeployedContract,
  usdcVal,
  bnToHex
} from "../testHelpers"
import { BigNumberish } from "ethers"
import {expect} from 'chai'

type FixtureFuncWithOptions<T, O> = (hre: HardhatRuntimeEnvironment, options: O) => Promise<T>
export function createFixtureWithRequiredOptions<T, O>(func: FixtureFuncWithOptions<T, O>) {
  return deployments.createFixture(func as FixtureFunc<T, O>)
}

/**
 * Deploy all contracts as a fixture
 *
 * Note: this is a re-usable fixture that creates a cached snapshot, calling
 *        this function multiple times results in reverting the EVM unless different parameters are given
 */
export const deployBaseFixture = deployments.createFixture(
  async ({deployments}, options?: DeployAllContractsOptions) => {
    const {gf_deployer: deployer} = await getNamedAccounts()
    assertNonNullable(deployer)
    const deployed = await deployAllContracts(deployments, options)

    await deployments.deploy("Accountant", {from: deployer})
    await deployments.deploy("TranchingLogic", {from: deployer})

    return deployed
  }
)

export const deployFixture = deployments.createFixture(
  async ({deployments}, options?: DeployAllContractsOptions) => {
    const {gf_deployer: deployer} = await getNamedAccounts()
    assertNonNullable(deployer)
    const deployed = await deployContracts(deployments, options)

    await deployments.deploy("Accountant", {from: deployer})
    await deployments.deploy("TranchingLogic", {from: deployer})

    return deployed
  }
)

interface CreditLineParams {
  config: string
  owner: string
  borrower: string
  maxLimit: BN | string
  interestApr: BN | string
  paymentPeriodInDays: BN | string
  termInDays: BN | string
  lateFeeApr: BN | string
  principalGracePeriodInDays: BN | string
}

/**
 * Deploy a credit line without calling initialize
 *
 * Note: this is a re-usable fixture that creates a cached snapshot, calling
 *        this function multiple times results in reverting the EVM unless different parameters are given
 */
export const deployUninitializedCreditLineFixture = createFixtureWithRequiredOptions(
  async ({deployments, getNamedAccounts}) => {
    const {gf_deployer: deployer} = await getNamedAccounts()
    assertNonNullable(deployer)

    const accountantDeploy = await deployments.get("Accountant")

    await deployments.deploy("TestAccountant", {
      from: deployer,
      libraries: {["Accountant"]: accountantDeploy.address},
    })

    await deployments.deploy("CreditLine", {
      from: deployer,
      libraries: {["Accountant"]: accountantDeploy.address},
    })

    const creditLine = await getDeployedContract<CreditLine>(deployments, "CreditLine")
    const testAccountant = await getDeployedContract<TestAccountant>(deployments, "TestAccountant")
    const accountant = await getDeployedContract<Accountant>(deployments, "Accountant")

    assertNonNullable(creditLine)
    assertNonNullable(testAccountant)
    assertNonNullable(accountant)

    return {
      creditLine,
      accountant,
      testAccountant,
    }
  }
)

/**
 * Deploy a credit line and call initialize on it
 *
 * Note: this is a re-usable fixture that creates a cached snapshot, calling
 *        this function multiple times results in reverting the EVM unless different parameters are given
 */
export const deployInitializedCreditLineFixture = createFixtureWithRequiredOptions(
  async (_hre, options: CreditLineParams) => {
    const {creditLine, ...others} = await deployUninitializedCreditLineFixture()
    assertNonNullable(options)
    const {
      config,
      owner,
      borrower,
      maxLimit,
      interestApr,
      paymentPeriodInDays,
      termInDays,
      lateFeeApr,
      principalGracePeriodInDays,
    } = options

    await creditLine.initialize(
      config,
      owner,
      borrower,
      maxLimit as BigNumberish,
      interestApr as BigNumberish,
      paymentPeriodInDays as BigNumberish,
      termInDays as BigNumberish,
      lateFeeApr as BigNumberish,
      principalGracePeriodInDays as BigNumberish
    )

    return {
      creditLine,
      ...others,
    }
  }
)

interface JuniorPoolOptions {
  borrower: string
  juniorFeePercent?: string | BN
  limit?: string | BN
  interestApr?: string | BN
  paymentPeriodInDays?: string | BN
  termInDays?: string | BN
  lateFeeApr?: string | BN
  principalGracePeriodInDays?: string | BN
  fundableAt?: string | BN
  allowedUIDTypes?: (string | BN | number)[]
  id: string
}

/**
 * Deploy a tranched pool for a give borrower using the Goldfinch factory
 *
 * Note: this is a re-usable fixture that creates a cached snapshot, calling
 *        this function multiple times results in reverting the EVM unless different parameters are given
 *
 * @param hre hardhat runtime environment
 * @param params
 * @param params.borrower the user that will eb borrowing from the pool
 * @param params.juniorFeePercent the percentage of interest the junior tranche will have allocated
 * @param params.limt the credit limit
 * @param params.interestApr interest apr
 * @param params.paymentPeriodInDays number of days in a payment period
 * @param params.fundableAt when the pool will be fundable
 * @param params.allowedUIDTypes allowed UID types
 * @param params.usdcAddress address of usdc
 * @param params.id id of fixture, when a fixture function is called with the same `id`
 *            and the same parameters, it wil result in reverting the chain to
 *            the block the fixture was created in. If the this is done multiple
 *            times in the same test it can result in incorrect behavior. If you
 *            need to create two fixtures with the same parameters in the same
 *            test block, make sure they have different id fields.
 *
 * @returns a newly created tranched pool and credit line
 */
export const deployJuniorPoolWithNAOSFactoryFixture = createFixtureWithRequiredOptions(
  async (
    hre,
    {
      borrower,
      juniorFeePercent = new BN("20"),
      limit = usdcVal(10_000),
      interestApr = interestAprAsBN("15.0"),
      paymentPeriodInDays = new BN(30),
      termInDays = new BN(365),
      lateFeeApr = interestAprAsBN("3.0"),
      principalGracePeriodInDays = new BN(185),
      fundableAt = new BN(0),
      allowedUIDTypes = [0],
      usdcAddress,
    }: JuniorPoolOptions & {usdcAddress: string}
  ) => {
    const {protocol_owner: owner} = await hre.getNamedAccounts()
    const contractName = isUSDTEnv() ? "TestUSDT" : "TestUSDC"
    const usdc = await getEthersContract(contractName, {at: usdcAddress})
    const naosFactoryDeployment = await deployments.get("NAOSFactory")
    const naosFactory = await getEthersContract<NAOSFactory>("NAOSFactory", {
      at: naosFactoryDeployment.address,
    })
    const tx: any = await naosFactory.createPool(
      borrower,
      bnToHex(juniorFeePercent as BN),
      bnToHex(limit as BN),
      bnToHex(interestApr as BN),
      bnToHex(paymentPeriodInDays as BN),
      bnToHex(termInDays as BN),
      bnToHex(lateFeeApr as BN),
      bnToHex(principalGracePeriodInDays as BN),
      bnToHex(fundableAt as BN),
      allowedUIDTypes as BigNumberish[],
      {from: owner}
    )
    const result = await tx.wait()

    const event = result.logs[result.logs.length - 1] as $TSFixMe
    assertNonNullable(event.topics)
    const pool = await getEthersContract<JuniorPool>("JuniorPool", {at: '0x' + event.topics[1].substr(26)})
    const creditLine = await getEthersContract<CreditLine>("CreditLine", {at: await pool.creditLine()})
    const juniorPool = await getEthersContract<JuniorPool>("TestJuniorPool", {at: pool.address})

    expect(await pool.creditLine()).to.be.eq(creditLine.address)

    await erc20Approve(usdc, juniorPool.address, MAX_UINT, [owner])

    // Only approve if borrower is an EOA
    await erc20Approve(usdc, juniorPool.address, MAX_UINT, [borrower])

    return {juniorPool, creditLine}
  }
)

/**
 * Deploy a tranched pool and borrower contracts for a given borrower address
 *
 * Note: this is a re-usable fixture that creates a cached snapshot, calling
 *        this function multiple times results in reverting the EVM unless
 *        different parameters are given.
 *
 * @param hre hardhat runtime environment
 * @param params
 * @param params.borrower the user that will eb borrowing from the pool
 * @param params.juniorFeePercent the percentage of interest the junior tranche will have allocated
 * @param params.limt the credit limit
 * @param params.interestApr interest apr
 * @param params.paymentPeriodInDays number of days in a payment period
 * @param params.fundableAt when the pool will be fundable
 * @param params.allowedUIDTypes allowed UID types
 * @param params.usdcAddress address of usdc
 * @param params.id id of fixture, when a fixture function is called with the same `id`
 *            and the same parameters, it wil result in reverting the chain to
 *            the block the fixture was created in. If the this is done multiple
 *            times in the same test it can result in incorrect behavior. If you
 *            need to create two fixtures with the same parameters in the same
 *            test block, make sure they have different id fields.
 *
 * @returns a newly created tranched pool, credit line, and borrower contract
 */
export const deployJuniorPoolAndBorrowerWithNAOSFactoryFixture = createFixtureWithRequiredOptions(
  async (
    hre,
    {
      borrower,
      usdcAddress,
      juniorFeePercent = new BN("20"),
      limit = usdcVal(10_000),
      interestApr = interestAprAsBN("15.0"),
      paymentPeriodInDays = new BN(30),
      termInDays = new BN(365),
      lateFeeApr = interestAprAsBN("3.0"),
      principalGracePeriodInDays = new BN(185),
      fundableAt = new BN(0),
      allowedUIDTypes = [0],
      id,
    }: JuniorPoolOptions & {usdcAddress: string}
  ) => {
    const {protocol_owner: owner} = await hre.getNamedAccounts()

    const otherDeploys = await deployJuniorPoolWithNAOSFactoryFixture({
      usdcAddress: usdcAddress,
      borrower: owner,
      juniorFeePercent,
      limit,
      interestApr,
      paymentPeriodInDays,
      termInDays,
      lateFeeApr,
      principalGracePeriodInDays,
      fundableAt,
      allowedUIDTypes,
      id,
    })

    return {
      ...otherDeploys,
    }
  }
)

/**
 * Deploy an tranched pool without calling `initialize` on it. This can also be thought of as an "invalid pool"
 */
export const deployUninitializedJuniorPoolFixture = deployments.createFixture(async (hre) => {
  const {protocol_owner: owner} = await hre.getNamedAccounts()
  assertNonNullable(owner)

  const accountant = await hre.deployments.get("Accountant")
  const tranchingLogic = await hre.deployments.get("TranchingLogic")
  const juniorPoolResult = await hre.deployments.deploy("JuniorPool", {
    from: owner,
    libraries: {
      ["TranchingLogic"]: tranchingLogic.address,
      ["Accountant"]: accountant.address,
    },
  })
  const pool = await getEthersContract<JuniorPool>("JuniorPool", {at: juniorPoolResult.address})
  const juniorPool = await getEthersContract<JuniorPool>("TestJuniorPool", {
    at: pool.address,
  })

  return {
    juniorPool,
  }
})

/**
 * Deploy a borrower contract for a given borrower
 *
 * Note: this is a re-usable fixture that creates a cached snapshot, calling
 *        this function multiple times results in reverting the EVM unless
 *        different parameters are given. The `id` parameter is provided
 *        as a simple way to do this. If you need multiple of this fixture
 *        in the same test, provide different `id` values for each fixture.
 *
 * @param hre hardhat runtime environment
 * @param params
 * @param params.borrower address of the borrower
 * @param usdcAddress address of usdc
 * @param params.id id of fixture, when a fixture function is called with the same `id`
 *            and the same parameters, it wil result in reverting the chain to
 *            the block the fixture was created in. If the this is done multiple
 *            times in the same test it can result in incorrect behavior. If you
 *            need to create two fixtures with the same parameters in the same
 *            test block, make sure they have different id fields.
 */
export const deployBorrowerWithNAOSFactoryFixture = createFixtureWithRequiredOptions(
  async (hre, {borrower, usdcAddress}: {borrower: string; usdcAddress: string; id: string}) => {
    const {protocol_owner: owner} = await hre.getNamedAccounts()
    assertNonNullable(owner)
    const naosFactoryDeployment = await hre.deployments.get("NAOSFactory")
    const naosFactory = await getEthersContract<NAOSFactory>("NAOSFactory", {
      at: naosFactoryDeployment.address,
    })
    const contractName = isUSDTEnv() ? "TestUSDT" : "TestUSDC"
    const usdc = await getEthersContract<ERC20>(contractName, {at: asNonNullable(usdcAddress)})

    // const result: any = await naosFactory.createBorrower(borrower, {from: owner})
    // const event = result.logs[result.logs.length - 1] as $TSFixMe
    // const borrowerContract = await getEthersContract<Borrower>("Borrower", {at: event.args.borrower})
    // await usdc.approve(borrowerContract.address, MAX_UINT as any, {from: borrower})

    // return {borrowerContract}
    return {usdc}
  }
)

/**
 * Deploy a funded tranched pool for a given borrower
 *
 * Note: this is a re-usable fixture that creates a cached snapshot, calling
 *        this function multiple times results in reverting the EVM unless
 *        different parameters are given. The `id` parameter is provided
 *        as a simple way to do this. If you need multiple of this fixture
 *        in the same test, provide different `id` values for each fixture.
 *
 * @param hre hardhat runtime environment
 * @param params
 * @param juniorTrancheAmount amount of USDC to deposit into the junior tranche
 * @param seniorTrancheAmount amount of USDC to deposit into the senior tranche
 * @param usdcAddress address of USDC contract
 * @param borrower address of borrower
 * @param borrowerContractAddress address of borrower contract
 * @param params.id id of fixture, when a fixture function is called with the same `id`
 *            and the same parameters, it wil result in reverting the chain to
 *            the block the fixture was created in. If the this is done multiple
 *            times in the same test it can result in incorrect behavior. If you
 *            need to create two fixtures with the same parameters in the same
 *            test block, make sure they have different id fields.
 *
 * @returns a funded tranched pool and credit line
 */
export const deployFundedJuniorPool = createFixtureWithRequiredOptions(
  async (
    hre,
    {
      seniorTrancheAmount = usdcVal(8_000),
      juniorTrancheAmount = usdcVal(2_000),
      usdcAddress,
      borrower,
      borrowerContractAddress,
      id,
    }: {
      usdcAddress: string
      borrower: string
      borrowerContractAddress: string
      seniorTrancheAmount?: BN
      juniorTrancheAmount?: BN
      id: string
    }
  ) => {
    const {protocol_owner: owner} = await hre.getNamedAccounts()
    assertNonNullable(owner)
    const {juniorPool, creditLine} = await deployJuniorPoolWithNAOSFactoryFixture({
      borrower: borrowerContractAddress,
      usdcAddress,
      id,
    })

    // const borrowerContract = await getEthersContract<Borrower>("Borrower", {at: borrowerContractAddress})
    const usdc = await getEthersContract<ERC20>("ERC20", {at: usdcAddress})

    await erc20Approve(usdc, juniorPool.address, MAX_UINT, [owner])

    const seniorRole = await juniorPool.SENIOR_ROLE()
    await juniorPool.grantRole(seniorRole, owner)
    await juniorPool.deposit(TRANCHES.Junior, juniorTrancheAmount as any)
    await juniorPool.lockJuniorCapital({from: owner})
    await juniorPool.deposit(TRANCHES.Senior, seniorTrancheAmount as any)
    await juniorPool.lockPool({from: owner})
    await juniorPool.revokeRole(seniorRole, owner) // clean up

    return {
      juniorPool,
      creditLine,
    }
  }
)
