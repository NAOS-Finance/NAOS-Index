import chai from "chai"
import hardhat, {artifacts, web3, ethers, getNamedAccounts} from "hardhat"
import AsPromised from "chai-as-promised"
chai.use(AsPromised)
const expect = chai.expect
import mochaEach from "mocha-each"
import {time} from "@openzeppelin/test-helpers"
import BN from "bn.js"
import {
  isTestEnv,
  USDC_DECIMALS,
  NAOS_DECIMALS,
  interestAprAsBN,
  ZERO_ADDRESS,
  getContract,
  ETHERS_CONTRACT_PROVIDER,
  OWNER_ROLE,
  getEthersContract,
} from "../scripts/blockchain_scripts/deployHelpers"
import {DeploymentsExtension} from "hardhat-deploy/types"
import {
  ERC20,
  RWA,
  FixedLeverageRatioStrategy,
  NAOSConfig,
  NAOSFactory,
  PoolTokens,
  IndexPool,
  CreditLine,
  JuniorPool,
  TestNAOS,
  Verified,
  TestUniqueIdentity,
  UniqueIdentity,
  DynamicLeverageRatioStrategy,
  WithdrawQueue,
  TestBoostPool,
  JuniorRewards
} from "../types"
import {assertNonNullable} from "../scripts/blockchain_scripts/utils"
import "./types"
const decimals = new BN(String(1e18))
// const USDC_DECIMALS = new BN(String(1e6))
const RWA_DECIMALS = new BN(String(1e18))
// const NAOS_DECIMALS = new BN(String(1e18))
const SECONDS_PER_DAY = new BN(86400)
const SECONDS_PER_YEAR = SECONDS_PER_DAY.mul(new BN(365))
const UNIT_SHARE_PRICE = new BN("1000000000000000000") // Corresponds to share price of 100% (no interest or writedowns)
import ChaiBN from "chai-bn"
import {Contract, BaseContract, BigNumber, ContractReceipt, ContractTransaction, PopulatedTransaction, BigNumberish} from "ethers"
// import {TestBackerRewards} from "../typechain/truffle/TestBackerRewards"
chai.use(ChaiBN(BN))

const MAX_UINT = new BN("115792089237316195423570985008687907853269984665640564039457584007913129639935")
const rwaTolerance = decimals.div(USDC_DECIMALS)
const EMPTY_DATA = "0x"
const BLOCKS_PER_DAY = 5760
const ZERO = new BN(0)

export type $TSFixMe = any

// Helper functions. These should be pretty generic.
function bigVal(number): BN {
  return new BN(number).mul(decimals)
}

function usdcVal(number) {
  return new BN(number).mul(USDC_DECIMALS)
}

function usdcToRWA(number: BN | number) {
  if (!(number instanceof BN)) {
    number = new BN(number)
  }
  return number.mul(decimals.div(NAOS_DECIMALS))
}

function rwaToUSDC(number: BN | number) {
  if (!(number instanceof BN)) {
    number = new BN(number)
  }
  return number.div(decimals.div(NAOS_DECIMALS))
}

const getDeployedContract = async <T extends BaseContract | Contract>(
  deployments: DeploymentsExtension,
  contractName: string
): Promise<T> => {
  let deployment = await deployments.getOrNull(contractName)
  if (!deployment && contractName === "NAOSFactory") {
    deployment = await deployments.getOrNull("CreditLineFactory")
  }
  if (!deployment && isTestEnv()) {
    contractName = `Test${contractName}`
    deployment = await deployments.get(contractName)
  }
  assertNonNullable(deployment)
  return getEthersContract<T>(contractName, { at: deployment.address })
}

async function getTruffleContractAtAddress<T extends BaseContract | Contract>(
  name: string,
  address: string
): Promise<T> {
  return (await artifacts.require(name).at(address)) as T
}

// async function setupBackerRewards(naos: GFI, backerRewards: BackerRewards, owner: string) {
//   const naosAmount = bigVal(100_000_000) // 100M
//   await naos.setCap(naosAmount)
//   await naos.mint(owner, naosAmount)
//   await backerRewards.setMaxInterestDollarsEligible(bigVal(1_000_000_000)) // 1B
//   await backerRewards.setTotalRewards(bigVal(3_000_000)) // 3% of 100M, 3M
// }

const tolerance = usdcVal(1).div(new BN(1000)) // 0.001$

type Expectation<T> =
  | {by: Numberish}
  | {byCloseTo: Numberish}
  | {fn: (originalValue: T, newValue: T) => any}
  | {increase: boolean}
  | {decrease: boolean}
  | {to: T; bignumber?: boolean}
  | {toCloseTo: Numberish}
  | {unchanged: boolean}
  | {beDifferent: boolean}

type ItemsAndExpectations<T = any> = Array<[() => T, Expectation<T>]>
function expectAction(action: () => any, debug?: boolean) {
  return {
    toChange: async (itemsAndExpectations: ItemsAndExpectations) => {
      const items = itemsAndExpectations.map((pair) => pair[0])
      const expectations = itemsAndExpectations.map((pair) => pair[1])
      const originalValues = (await Promise.all(items.map((i) => i()))) as any
      if (debug) {
        console.log("Original:", String(originalValues))
      }
      const actionPromise = action()
      if (actionPromise === undefined) {
        throw new Error("Expected a promise. Did you forget to return?")
      }
      await actionPromise
      const newValues = (await Promise.all(items.map((i) => i()))) as any
      if (debug) {
        console.log("New:     ", String(newValues))
      }
      expectations.forEach((expectation, i) => {
        try {
          if ("by" in expectation) {
            expect(newValues[i].sub(originalValues[i])).to.bignumber.equal(expectation.by as any)
          } else if ("byCloseTo" in expectation) {
            const onePercent = new BN(expectation.byCloseTo).div(new BN(100)).abs()
            expect(newValues[i].sub(originalValues[i])).to.bignumber.closeTo(new BN(expectation.byCloseTo), onePercent)
          } else if ("fn" in expectation) {
            expectation.fn(originalValues[i], newValues[i])
          } else if ("increase" in expectation) {
            expect(newValues[i]).to.bignumber.gt(originalValues[i])
          } else if ("decrease" in expectation) {
            expect(newValues[i]).to.bignumber.lt(originalValues[i])
          } else if ("to" in expectation) {
            if (expectation.bignumber === false) {
              // It was not originally the number we expected, but then was changed to it
              expect(originalValues[i]).to.not.eq(expectation.to)
              expect(newValues[i]).to.eq(expectation.to)
            } else {
              // It was not originally the number we expected, but then was changed to it
              expect(originalValues[i]).to.not.bignumber.eq(expectation.to)
              expect(newValues[i]).to.bignumber.eq(expectation.to)
            }
          } else if ("toCloseTo" in expectation) {
            // It was not originally the number we expected, but then was changed to it
            const onePercent = new BN(expectation.toCloseTo).div(new BN(100)).abs()
            expect(originalValues[i]).to.not.bignumber.eq(new BN(expectation.toCloseTo))
            expect(newValues[i]).to.bignumber.closeTo(new BN(expectation.toCloseTo), onePercent)
          } else if ("unchanged" in expectation) {
            expect(newValues[i]).to.bignumber.eq(originalValues[i])
          } else if ("beDifferent" in expectation) {
            expect(String(originalValues[i])).to.not.eq(String(newValues[i]))
          }
        } catch (error) {
          console.log("Expectation", i, "failed")
          throw error
        }
      })
    },
  }
}

// type DecodedLog<T extends Truffle.AnyEvent> = {
//   event: T["name"]
//   args: T["args"]
// }

// This decodes logs for a single event type, and returns a decoded object in
// the same form truffle-contract uses on its receipts
// Mostly stolen from: https://github.com/OpenZeppelin/openzeppelin-test-helpers/blob/6e54db1e1f64a80c7632799776672297bbe543b3/src/expectEvent.js#L49
// function decodeLogs<T extends Truffle.AnyEvent>(logs, emitter, eventName): DecodedLog<T>[] {
//   const abi = emitter.abi
//   const address = emitter.address
//   const eventAbis = abi.filter((x) => x.type === "event" && x.name === eventName)
//   if (eventAbis.length === 0) {
//     throw new Error(`No ABI entry for event '${eventName}'`)
//   } else if (eventAbis.length > 1) {
//     throw new Error(`Multiple ABI entries for event '${eventName}', only uniquely named events are supported`)
//   }

//   const eventAbi = eventAbis[0]

//   // The first topic will equal the hash of the event signature
//   // If the signature isn't present (for example if a deployments file was passed)
//   // generate it.
//   const eventTopic = eventAbi.signature || web3.eth.abi.encodeEventSignature(eventAbi)

//   // Only decode events of type 'EventName'
//   return logs
//     .filter((log) => log.topics.length > 0 && log.topics[0] === eventTopic && (!address || log.address === address))
//     .map((log) => web3.eth.abi.decodeLog(eventAbi.inputs, log.data, log.topics.slice(1)))
//     .map((decoded) => ({event: eventName, args: decoded}))
// }

// function decodeAndGetFirstLog<T extends Truffle.AnyEvent>(logs, emitter, eventName): DecodedLog<T> {
//   return getFirstLog<T>(decodeLogs<T>(logs, emitter, eventName))
// }

// function getFirstLog<T extends Truffle.AnyEvent>(logs: DecodedLog<T>[]): DecodedLog<T> {
//   const firstLog = logs[0]
//   assertNonNullable(firstLog)
//   return firstLog
// }

// function getOnlyLog<T extends Truffle.AnyEvent>(logs: DecodedLog<T>[]): DecodedLog<T> {
//   expect(logs.length).to.equal(1)
//   return getFirstLog(logs)
// }

export type DeployAllContractsOptions = {
  deployForwarder?: {
    fromAccount: string
  }
  deployMerkleDistributor?: {
    fromAccount: string
    root: string
  }
  deployMerkleDirectDistributor?: {
    fromAccount: string
    root: string
  }
}

async function deployAllContracts(
  deployments: DeploymentsExtension,
  options: DeployAllContractsOptions = {}
): Promise<{
  // pool: Pool
  indexPool: IndexPool
  indexPoolFixedStrategy: FixedLeverageRatioStrategy
  indexPoolDynamicStrategy: DynamicLeverageRatioStrategy
  usdc: ERC20
  // creditDesk: CreditDesk
  rwa: RWA
  // rwaUSDCCurveLP: TestRWAUSDCCurveLP
  naosConfig: NAOSConfig
  naosFactory: NAOSFactory
  // forwarder: TestForwarder | null
  poolTokens: PoolTokens
  juniorPool: JuniorPool
  naos: TestNAOS
  // stakingRewards: TestStakingRewards
  // backerRewards: TestBackerRewards
  // communityRewards: CommunityRewards
  // merkleDistributor: MerkleDistributor | null
  // merkleDirectDistributor: MerkleDirectDistributor | null
  uniqueIdentity: TestUniqueIdentity
  verified: Verified
  boostPool: TestBoostPool
  withdrawQueue: WithdrawQueue
  // zapper: Zapper
}> {
  // await deployments.fixture("base_deploy")
  // const pool = await getDeployedContract<Pool>(deployments, "Pool")
  const indexPool = await getDeployedContract<IndexPool>(deployments, "IndexPool")
  const indexPoolFixedStrategy = await getDeployedContract<FixedLeverageRatioStrategy>(
    deployments,
    "FixedLeverageRatioStrategy"
  )
  const indexPoolDynamicStrategy = await getDeployedContract<DynamicLeverageRatioStrategy>(
    deployments,
    "DynamicLeverageRatioStrategy"
  )

  const usdc = await getDeployedContract<ERC20>(deployments, "USDC")
  const rwa = await getDeployedContract<RWA>(deployments, "RWA")
  const naosConfig = await getDeployedContract<NAOSConfig>(deployments, "NAOSConfig")
  const naosFactory = await getDeployedContract<NAOSFactory>(deployments, "NAOSFactory")
  const poolTokens = await getDeployedContract<PoolTokens>(deployments, "PoolTokens")
  const juniorPool = await getDeployedContract<JuniorPool>(deployments, "JuniorPool")
  const naos = await getDeployedContract<TestNAOS>(deployments, "NAOS")
  // const backerRewards = await getDeployedContract<TestBackerRewards>(deployments, "BackerRewards")

  const uniqueIdentity = await getContract<TestUniqueIdentity, any>(
    "TestUniqueIdentity",
    ETHERS_CONTRACT_PROVIDER
  )
  const verified = await getContract<Verified, Verified>("Verified", ETHERS_CONTRACT_PROVIDER)
  const withdrawQueue = await getDeployedContract<WithdrawQueue>(deployments, "WithdrawQueue")
  const boostPool = await getDeployedContract<TestBoostPool>(deployments, "TestBoostPool")

  return {
    indexPool,
    indexPoolFixedStrategy,
    indexPoolDynamicStrategy,
    usdc,
    rwa,
    naosConfig,
    naosFactory,
    // forwarder,
    poolTokens,
    juniorPool,
    naos,
    // stakingRewards,
    uniqueIdentity,
    verified,
    boostPool,
    withdrawQueue
    // backerRewards,
  }
}

async function deployContracts(
  deployments: DeploymentsExtension,
  options: DeployAllContractsOptions = {}
): Promise<{
  // pool: Pool
  indexPool: IndexPool
  indexPoolFixedStrategy: FixedLeverageRatioStrategy
  indexPoolDynamicStrategy: DynamicLeverageRatioStrategy
  usdc: ERC20
  // creditDesk: CreditDesk
  rwa: RWA
  // rwaUSDCCurveLP: TestRWAUSDCCurveLP
  naosConfig: NAOSConfig
  naosFactory: NAOSFactory
  // forwarder: TestForwarder | null
  poolTokens: PoolTokens
  juniorPool: JuniorPool
  naos: TestNAOS
  // stakingRewards: TestStakingRewards
  juniorRewards: JuniorRewards
  uniqueIdentity: TestUniqueIdentity
  verified: Verified
  boostPool: TestBoostPool
  withdrawQueue: WithdrawQueue
  // zapper: Zapper
}> {
  // await deployments.fixture("base_deploy")
  // const pool = await getDeployedContract<Pool>(deployments, "Pool")
  const indexPool = await getDeployedContract<IndexPool>(deployments, "IndexPool")
  const indexPoolFixedStrategy = await getDeployedContract<FixedLeverageRatioStrategy>(
    deployments,
    "FixedLeverageRatioStrategy"
  )
  const indexPoolDynamicStrategy = await getDeployedContract<DynamicLeverageRatioStrategy>(
    deployments,
    "DynamicLeverageRatioStrategy"
  )

  const usdc = await getDeployedContract<ERC20>(deployments, "TestUSDC")
  const rwa = await getDeployedContract<RWA>(deployments, "RWA")
  const naosConfig = await getDeployedContract<NAOSConfig>(deployments, "NAOSConfig")
  const naosFactory = await getDeployedContract<NAOSFactory>(deployments, "NAOSFactory")
  const poolTokens = await getDeployedContract<PoolTokens>(deployments, "PoolTokens")
  const juniorPool = await getDeployedContract<JuniorPool>(deployments, "JuniorPool")
  const naos = await getDeployedContract<TestNAOS>(deployments, "TestNAOS")
  const juniorRewards = await getDeployedContract<JuniorRewards>(deployments, "JuniorRewards")

  const uniqueIdentity = await getContract<TestUniqueIdentity, any>(
    "UniqueIdentity",
    ETHERS_CONTRACT_PROVIDER
  )
  const verified = await getContract<Verified, Verified>("Verified", ETHERS_CONTRACT_PROVIDER)
  const withdrawQueue = await getDeployedContract<WithdrawQueue>(deployments, "WithdrawQueue")
  const boostPool = await getDeployedContract<TestBoostPool>(deployments, "TestBoostPool")

  return {
    indexPool,
    indexPoolFixedStrategy,
    indexPoolDynamicStrategy,
    usdc,
    rwa,
    naosConfig,
    naosFactory,
    // forwarder,
    poolTokens,
    juniorPool,
    naos,
    juniorRewards,
    // stakingRewards,
    uniqueIdentity,
    verified,
    boostPool,
    withdrawQueue
    // backerRewards,
  }
}

async function erc721Approve(erc721: any, accountToApprove: string, tokenId: BN, fromAccounts: (string | undefined)[]) {
  for (const fromAccount of fromAccounts) {
    const signer = await ethers.getSigner(fromAccount as string)
    await erc721.connect(signer).approve(accountToApprove, bnToHex(tokenId))
  }
}

async function erc20Approve(erc20: any, accountToApprove: string, amount: BN, fromAccounts: (string | undefined)[]) {
  for (const fromAccount of fromAccounts) {
    const signer = await ethers.getSigner(fromAccount as string)
    await erc20.connect(signer).approve(accountToApprove, bnToHex(amount))
  }
}

async function erc20Transfer(erc20, toAccounts, amount, fromAccount) {
  for (const toAccount of toAccounts) {
    const signer = await ethers.getSigner(fromAccount as string)
    await erc20.connect(signer).transfer(toAccount, bnToHex(amount))
  }
}

async function getCurrentTimestamp(): Promise<BN> {
  return await time.latest()
}

export type Numberish = BN | string | number
async function advanceTime({days, seconds, toSecond}: {days?: Numberish; seconds?: Numberish; toSecond?: Numberish}) {
  let secondsPassed, newTimestamp
  const currentTimestamp = await getCurrentTimestamp()

  if (days) {
    secondsPassed = SECONDS_PER_DAY.mul(new BN(days))
    newTimestamp = currentTimestamp.add(secondsPassed)
  } else if (seconds) {
    secondsPassed = new BN(seconds)
    newTimestamp = currentTimestamp.add(secondsPassed)
  } else if (toSecond) {
    newTimestamp = new BN(toSecond)
  }
  // Cannot verified backward
  expect(newTimestamp).to.bignumber.gt(currentTimestamp)

  await ethers.provider.send("evm_setNextBlockTimestamp", [newTimestamp.toNumber()])
  return newTimestamp
}

async function mineBlock(): Promise<void> {
  await ethers.provider.send("evm_mine", [])
}

async function getBalance(address, erc20) {
  if (typeof address !== "string") {
    throw new Error("Address must be a string")
  }
  if (erc20) {
    return new BN((await erc20.balanceOf(address)).toString())
  }
  return new BN((await web3.eth.getBalance(address)).toString())
}

const createPoolWithCreditLine = async ({
  people,
  naosFactory,
  usdc,
  juniorFeePercent = bnToHex(new BN("20")),
  interestApr = bnToHex(interestAprAsBN("15.0")),
  paymentPeriodInDays = bnToHex(new BN(30)),
  termInDays = bnToHex(new BN(365)),
  limit = bnToHex(usdcVal(10000)),
  lateFeeApr = bnToHex(interestAprAsBN("3.0")),
  principalGracePeriodInDays = bnToHex(new BN(185)),
  fundableAt = bnToHex(new BN(0)),
  allowedUIDTypes = [0],
}: {
  people: {owner: string; borrower: string}
  usdc: ERC20
  naosFactory: NAOSFactory
  juniorFeePercent?: Numberish
  interestApr?: Numberish
  paymentPeriodInDays?: Numberish
  termInDays?: Numberish
  limit?: Numberish
  lateFeeApr?: Numberish
  principalGracePeriodInDays?: Numberish
  fundableAt?: Numberish
  allowedUIDTypes?: Numberish[]
}): Promise<{juniorPool: JuniorPool; creditLine: CreditLine}> => {
  const thisOwner = people.owner
  const thisBorrower = people.borrower

  if (!thisBorrower) {
    throw new Error("No borrower is set. Set one in a beforeEach, or pass it in explicitly")
  }

  if (!thisOwner) {
    throw new Error("No owner is set. Please set one in a beforeEach or pass it in explicitly")
  }

  const tx: any = await naosFactory.createPool(
    thisBorrower,
    juniorFeePercent as BigNumberish,
    limit as BigNumberish,
    interestApr as BigNumberish,
    paymentPeriodInDays as BigNumberish,
    termInDays as BigNumberish,
    lateFeeApr as BigNumberish,
    principalGracePeriodInDays as BigNumberish,
    fundableAt as BigNumberish,
    allowedUIDTypes as BigNumberish[],
    {from: thisOwner}
  )
  const result = await tx.wait()

  const event = result.logs[result.logs.length - 1] as $TSFixMe
  const pool = await getTruffleContractAtAddress<JuniorPool>("JuniorPool", '0x' + event.topics[1].substr(26))
  const creditLine = await getTruffleContractAtAddress<CreditLine>("CreditLine", await pool.creditLine())

  await erc20Approve(usdc, pool.address, usdcVal(100000), [thisOwner])

  // Only approve if borrower is an EOA (could be a borrower contract)
  if ((await web3.eth.getCode(thisBorrower)) === "0x") {
    await erc20Approve(usdc, pool.address, usdcVal(100000), [thisBorrower])
  }

  const juniorPool = await getTruffleContractAtAddress<JuniorPool>("TestJuniorPool", pool.address)
  return {juniorPool, creditLine}
}

// async function toTruffle<T extends Truffle.Contract = Truffle.Contract>(
//   address: Truffle.Contract | BaseContract | string,
//   contractName: string,
//   opts?: {}
// ): Promise<T> {
//   const truffleContract = await artifacts.require(contractName)
//   address = typeof address === "string" ? address : address.address
//   if (opts) {
//     truffleContract.defaults(opts)
//   }
//   return truffleContract.at(address)
// }

const genDifferentHexString = (hex: string): string => `${hex.slice(0, -1)}${hex[hex.length - 1] === "1" ? "2" : "1"}`

// async function toEthers<T>(truffleContract: Truffle.Contract): Promise<T> {
//   return (await ethers.getContractAt(truffleContract.abi, truffleContract.address)) as unknown as T
// }

async function fundWithEthFromLocalWhale(userToFund: string, amount: BN) {
  const [protocol_owner] = await ethers.getSigners()
  assertNonNullable(protocol_owner)
  await protocol_owner.sendTransaction({
    to: userToFund,
    value: ethers.utils.parseEther(amount.toString()),
  })
}

export function expectProxyOwner({toBe, forContracts}: {toBe: () => Promise<string>; forContracts: string[]}) {
  describe("proxy owners", async () => {
    forContracts.forEach((contractName) => {
      it(`sets the correct proxy owner for ${contractName}`, async () => {
        const proxyDeployment = await hardhat.deployments.get(`${contractName}_Proxy`)
        const proxyContract = await ethers.getContractAt(proxyDeployment.abi, proxyDeployment.address)
        expect(await proxyContract.owner()).to.eq(await toBe())
      })
    })
  })
}

export type RoleExpectation = {contractName: string; roles: string[]; address: () => Promise<string>}
export function expectRoles(expectations: RoleExpectation[]) {
  describe("roles", async () => {
    for (const {contractName, roles, address} of expectations) {
      for (const role of roles) {
        it(`assigns the ${role} role`, async () => {
          const addr = await address()
          const deployment = await hardhat.deployments.get(contractName)
          const contract = await ethers.getContractAt(deployment.abi, deployment.address)

          expect(await contract.hasRole(role, addr)).to.be.true
        })
      }
    }
  })
}

export function expectOwnerRole({toBe, forContracts}: {toBe: () => Promise<string>; forContracts: string[]}) {
  const expectations: RoleExpectation[] = forContracts.map((contract) => ({
    contractName: contract,
    roles: [OWNER_ROLE],
    address: toBe,
  }))
  expectRoles(expectations)
}

/**
 * Mine multiple transactions in the same block, returning the receipts
 *
 * NOTE (READ!!!): if your transactions are timing out, and you're passing many
 *                  the reason is that most likely there isn't enough block space
 *                  given the transactions you're trying to mine. In the current
 *                  state of the code this will happen if there are more than 15
 *                  because we hardcode the gas limit.
 *
 * @param txs populated transactions to mine
 * @param timeout time(ms) to wait before throwing an error
 * @returns transactions receipts
 */
export async function mineInSameBlock(txs: PopulatedTransaction[], timeout = 5_000): Promise<ContractReceipt[]> {
  const numberOfTransactionsThatCanFitWithHardcodedGasLimit = 15
  if (txs.length > numberOfTransactionsThatCanFitWithHardcodedGasLimit) {
    throw new Error(
      `too many transcations! limit = ${numberOfTransactionsThatCanFitWithHardcodedGasLimit}, found = ${txs.length}`
    )
  }

  let handle

  const error = new Error(
    `Failed to mine transactions under ${timeout} ms. Is your tx using too much gas for one block?`
  )
  const rejectAfterTimeout = new Promise((_resolve, reject) => {
    handle = setTimeout(() => reject(error), timeout)
  })

  try {
    // disable automine so that the transactions all enter the mempool
    await ethers.provider.send("evm_setAutomine", [false])
    const receipts: ContractTransaction[] = []
    for (let tx of txs) {
      const signer = await ethers.getSigner(tx.from as string)

      // Ethers gas estimation is horrible, and calling ethers.provider.estimateGas is
      // _insanely_ slow. So instead we're giving each transaction a very comfortable gas
      // limit
      tx = {
        ...tx,
        gasLimit: BigNumber.from("2000000"),
      }

      const receipt = await signer.sendTransaction(tx)
      receipts.push(receipt)
    }
    await ethers.provider.send("evm_mine", [])
    const values = await Promise.race([Promise.all(receipts.map((tx) => tx.wait())), rejectAfterTimeout])
    clearTimeout(handle)
    return values as ContractReceipt[]
  } finally {
    // we need to make sure we turn auto mining back on in case of a failure
    // otherwise it'll make every transaction globally timeout
    await ethers.provider.send("evm_setAutomine", [true])
  }
}

export function dbg<T>(x: T): T {
  console.trace(x)
  return x
}

export const bnToHex = (bn: BN): string => {
  return '0x' + bn.toString('hex')
}

export const bnToBnjs = (bn: BigNumber): BN => {
  return new BN(bn.toString())
}

export const bnjsToHex = (bn: BigNumber): string => {
  return bn.toHexString()
}

export {
  hardhat,
  chai,
  expect,
  decimals,
  USDC_DECIMALS,
  RWA_DECIMALS,
  NAOS_DECIMALS,
  BN,
  MAX_UINT,
  tolerance,
  rwaTolerance,
  ZERO_ADDRESS,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  EMPTY_DATA,
  BLOCKS_PER_DAY,
  UNIT_SHARE_PRICE,
  ZERO,
  bigVal,
  usdcVal,
  mochaEach,
  getBalance,
  getDeployedContract,
  // getTruffleContractAtAddress,
  rwaToUSDC,
  usdcToRWA,
  expectAction,
  deployAllContracts,
  deployContracts,
  erc721Approve,
  erc20Approve,
  erc20Transfer,
  getCurrentTimestamp,
  advanceTime,
  mineBlock,
  createPoolWithCreditLine,
  // decodeLogs,
  // getFirstLog,
  // decodeAndGetFirstLog,
  // getOnlyLog,
  // toTruffle,
  genDifferentHexString,
  // toEthers,
  fundWithEthFromLocalWhale,
  // setupBackerRewards,
}
