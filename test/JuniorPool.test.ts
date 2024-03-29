/* global web3 */
import {
  expect,
  usdcVal,
  expectAction,
  advanceTime,
  erc20Approve,
  erc20Transfer,
  getBalance,
  tolerance,
  SECONDS_PER_DAY,
  UNIT_SHARE_PRICE,
  ZERO,
  // setupBackerRewards,
  getCurrentTimestamp,
  bnToHex,
  bnToBnjs,
  bnjsToHex,
  getDeployedContract,
} from "./testHelpers"
import {interestAprAsBN, TRANCHES, MAX_UINT, OWNER_ROLE, PAUSER_ROLE, isDecimal18Env, DAI_DECIMALS, USDC_DECIMALS} from "../scripts/blockchain_scripts/deployHelpers"
import {expectEvent, time} from "@openzeppelin/test-helpers"
import hre, { ethers } from "hardhat"
import BN from "bn.js"
import BNJS from "bignumber.js"
const {deployments, artifacts, web3} = hre
import {ecsign} from "ethereumjs-util"
const CreditLine = artifacts.require("CreditLine")
import {getApprovalDigest, getWallet} from "./permitHelpers"
import {
  CreditLine,
  NAOSConfig,
  NAOSFactory,
  PoolTokens,
  TestUniqueIdentity,
  IndexPool,
  JuniorPool,
  // BackerRewards,
} from "../types"
import {CONFIG_KEYS} from "../scripts/blockchain_scripts/configKeys"
import {assertNonNullable} from "../scripts/blockchain_scripts/utils"
import {mint} from "./uniqueIdentityHelpers"
import {deployBaseFixture, deployJuniorPoolWithNAOSFactoryFixture} from "./util/fixtures"

const RESERVE_FUNDS_COLLECTED_EVENT = "ReserveFundsCollected"
const PAYMENT_APPLIED_EVENT = "PaymentApplied"
const ASSESS_EVENT = "JuniorPoolAssessed"
const EXPECTED_JUNIOR_CAPITAL_LOCKED_EVENT_ARGS = ["0", "1", "2", "__length__", "lockedUntil", "pool", "trancheId"]
const TEST_TIMEOUT = 30000
const HALF_CENT = usdcVal(1).div(new BN(200))
const depositMadeEventHash = '0xcb3ef4109dcd006671348924f00aac8398190a5ff283d6e470d74581513e1036'
const trancheLockedEventHash = '0xf839b119f21fb055e13aebac51bca6b308f52ec2d8db8306ce4d092d964e5bd0'
const investmentMadeInSeniorEventHash = '0x86da25fff7a4075a94de2ffed109ca6748c3af22736eaf7efc75e3988f899d6e'
const withdrawalMadeEventHash = '0x92f2787b755dae547f1701582fe74c7abf277ec14db316dd01abc69cacf7a259'
const reserveFundsCollectedEventHash = '0xf3583f178a8d4f8888c3683f8e948faf9b6eb701c4f1fab265a6ecad1a1ddebb'
const paymentAppliedEventHash = '0xd1055dc2c2a003a83dfacb1c38db776eab5ef89d77a8f05a3512e8cf57f953ce'
const juniorPoolAssessedEventHash = '0x81b01d94b096147dd71610cdf6d772ef4899db370b362c477b8dc5cbde448446'
const drawdownMadeEventHash = '0x7411b87a3c039bdfd8f3510b21e8bd0736265f53513735e1f4aa7b4f306b728d'
const drawdownsPausedEventHash = '0x90d9b09c68a7e1312ce22801552b47265d77db9496383d51374b4058545447d7'
const drawdownsUnpausedEventHash = '0x7184039938737267597232635b117c924371ac877d4329f2dfa5ca674c5cc4a5'

const expectPaymentRelatedEventsEmitted = (
  receipt: any,
  borrowerAddress: unknown,
  juniorPool: JuniorPool,
  amounts: {
    interest: BN
    principal: BN
    remaining: BN
    reserve: BN
  }
) => {
  assertNonNullable(receipt.logs.filter((l) => l.topics[0] === reserveFundsCollectedEventHash)[0])
  assertNonNullable(receipt.logs.filter((l) => l.topics[0] === juniorPoolAssessedEventHash)[0])
  assertNonNullable(receipt.logs.filter((l) => l.topics[0] === paymentAppliedEventHash)[0])
}
const expectPaymentRelatedEventsNotEmitted = (receipt: any) => {
  expect(receipt.logs.filter((l) => l.topics[0] === reserveFundsCollectedEventHash).length).to.eq(0)
  expect(receipt.logs.filter((l) => l.topics[0] === paymentAppliedEventHash).length).to.eq(0)
}

describe("JuniorPool", () => {
  let owner,
    borrower,
    otherPerson,
    naosConfig: NAOSConfig,
    usdc,
    uniqueIdentity: TestUniqueIdentity,
    poolTokens: PoolTokens,
    naosFactory: NAOSFactory,
    creditLine: CreditLine,
    treasury,
    backerRewards: any,
    juniorPool: JuniorPool,
    // gfi: NAOS,
    indexPool: IndexPool
  const limit = usdcVal(1000)
  let interestApr = interestAprAsBN("5.00")
  const paymentPeriodInDays = new BN(30)
  let termInDays = new BN(365)
  const principalGracePeriodInDays = new BN(185)
  const fundableAt = new BN(0)
  const lateFeeApr = new BN(0)
  const juniorFeePercent = new BN(20)
  const decimals = DAI_DECIMALS
  const decimal = isDecimal18Env() ? USDC_DECIMALS : DAI_DECIMALS
  const decimalsDelta = decimals.div(decimal)

  const testSetup = deployments.createFixture(async ({deployments}) => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({usdc, naosConfig, naosFactory, poolTokens, uniqueIdentity, indexPool } =
      await deployBaseFixture())
    await naosConfig.bulkAddToGoList([owner, borrower, otherPerson])
    await naosConfig.setTreasuryReserve(treasury)
    // await setupBackerRewards(gfi, backerRewards, owner)
    await erc20Transfer(usdc, [otherPerson], usdcVal(20000), owner)
    await erc20Transfer(usdc, [borrower], usdcVal(10000), owner)

    await erc20Approve(usdc, indexPool.address, usdcVal(1000), [otherPerson])
    const signer = await ethers.getSigner(otherPerson)
    await indexPool.connect(signer).deposit(bnToHex(usdcVal(1000)))

    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    const {juniorPool, creditLine} = await deployJuniorPoolWithNAOSFactoryFixture({
      usdcAddress: usdc.address,
      borrower,
      principalGracePeriodInDays,
      limit,
      interestApr,
      paymentPeriodInDays,
      termInDays,
      fundableAt,
      lateFeeApr,
      juniorFeePercent,
      id: "JuniorPool",
    })
    await juniorPool.grantRole(await juniorPool.SENIOR_ROLE(), owner)
    return {juniorPool, creditLine}
  })

  const getTrancheAmounts = async (trancheInfo) => {
    const interestAmount = await juniorPool.sharePriceToUsdc(
      trancheInfo.interestSharePrice,
      trancheInfo.principalDeposited
    )
    const principalAmount = await juniorPool.sharePriceToUsdc(
      trancheInfo.principalSharePrice,
      trancheInfo.principalDeposited
    )
    return [interestAmount, principalAmount]
  }

  beforeEach(async () => {
    // Pull in our unlocked accounts
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[owner, borrower, treasury, otherPerson] = await web3.eth.getAccounts()
    ;({juniorPool, creditLine} = await testSetup())
  })

  describe("initialization", async () => {
    it("sets the right defaults", async () => {
      const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
      const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)
      expect(bnToBnjs(juniorTranche.principalSharePrice)).to.bignumber.eq(UNIT_SHARE_PRICE)
      expect(bnToBnjs(juniorTranche.interestSharePrice)).to.bignumber.eq("0")
      expect(bnToBnjs(juniorTranche.principalDeposited)).to.bignumber.eq("0")
      expect(bnToBnjs(juniorTranche.lockedUntil)).to.bignumber.eq("0")

      expect(bnToBnjs(seniorTranche.principalSharePrice)).to.bignumber.eq(UNIT_SHARE_PRICE)
      expect(bnToBnjs(seniorTranche.interestSharePrice)).to.bignumber.eq("0")
      expect(bnToBnjs(seniorTranche.principalDeposited)).to.bignumber.eq("0")
      expect(bnToBnjs(seniorTranche.lockedUntil)).to.bignumber.eq("0")

      expect(bnToBnjs(await juniorPool.allowedUIDTypes(0))).to.bignumber.equal(new BN(0))
      expect(await juniorPool.creditLine()).to.eq(creditLine.address)
    })

    it("grants the senior pool the SENIOR_ROLE", async () => {
      const seniorRole = await juniorPool.SENIOR_ROLE()
      expect(await juniorPool.hasRole(seniorRole, indexPool.address)).to.be.true
    })
  })

  describe("migrateCreditLine", async () => {
    it("should create a new creditline", async () => {
      const creditLine = await CreditLine.at(await juniorPool.creditLine())
      await expectAction(async () =>
        juniorPool.migrateCreditLine(
          await creditLine.borrower(),
          bnToHex(await creditLine.limit()),
          bnToHex(await creditLine.interestApr()),
          bnToHex(await creditLine.paymentPeriodInDays()),
          bnToHex(await creditLine.termInDays()),
          bnToHex(await creditLine.lateFeeApr()),
          bnToHex(await creditLine.principalGracePeriodInDays())
        )
      ).toChange([[juniorPool.creditLine, {beDifferent: true}]])
    })

    it("should allow governance, but not the borrower to migrate", async () => {
      const creditLine = await CreditLine.at(await juniorPool.creditLine())
      let signer = await ethers.getSigner(owner)
      await expect(
        juniorPool.connect(signer).migrateCreditLine(
          await creditLine.borrower(),
          bnToHex(await creditLine.limit()),
          bnToHex(await creditLine.interestApr()),
          bnToHex(await creditLine.paymentPeriodInDays()),
          bnToHex(await creditLine.termInDays()),
          bnToHex(await creditLine.lateFeeApr()),
          bnToHex(await creditLine.principalGracePeriodInDays())
        )
      ).to.be.fulfilled

      signer = await ethers.getSigner(borrower)
      await expect(
        juniorPool.connect(signer).migrateCreditLine(
          await creditLine.borrower(),
          bnToHex(await creditLine.limit()),
          bnToHex(await creditLine.interestApr()),
          bnToHex(await creditLine.paymentPeriodInDays()),
          bnToHex(await creditLine.termInDays()),
          bnToHex(await creditLine.lateFeeApr()),
          bnToHex(await creditLine.principalGracePeriodInDays())
        )
      ).to.be.rejectedWith(/Must have admin role/)
    })

    it("should set new values you send it", async () => {
      const maxLimit = usdcVal(1234)
      const borrower = otherPerson
      const interestApr = interestAprAsBN("12.3456")
      const paymentPeriodInDays = new BN(123)
      const termInDays = new BN(321)
      const lateFeeApr = interestAprAsBN("0.9783")
      const principalGracePeriodInDays = new BN(30)

      const clFnFromPool = async (pool, fnName) => (await CreditLine.at(await pool.creditLine()))[fnName]()
      // Limit starts at 0 until drawdown happens.
      expect(await clFnFromPool(juniorPool, "limit")).to.bignumber.eq("0")

      await expectAction(async () =>
        juniorPool.migrateCreditLine(
          borrower,
          bnToHex(maxLimit),
          bnToHex(interestApr),
          bnToHex(paymentPeriodInDays),
          bnToHex(termInDays),
          bnToHex(lateFeeApr),
          bnToHex(principalGracePeriodInDays)
        )
      ).toChange([
        [async () => await juniorPool.creditLine(), {beDifferent: true}],
        [async () => clFnFromPool(juniorPool, "maxLimit"), {to: maxLimit}],
        [async () => clFnFromPool(juniorPool, "borrower"), {to: borrower, bignumber: false}],
        [async () => clFnFromPool(juniorPool, "interestApr"), {to: interestApr}],
        [async () => clFnFromPool(juniorPool, "paymentPeriodInDays"), {to: paymentPeriodInDays}],
        [async () => clFnFromPool(juniorPool, "termInDays"), {to: termInDays}],
        [async () => clFnFromPool(juniorPool, "lateFeeApr"), {to: lateFeeApr}],
        [async () => clFnFromPool(juniorPool, "principalGracePeriodInDays"), {to: principalGracePeriodInDays}],
      ])

      // Limit does not change
      expect(await clFnFromPool(juniorPool, "limit")).to.bignumber.eq("0")
    })

    it("should copy over the accounting vars", async () => {
      const originalCl = await CreditLine.at(await juniorPool.creditLine())
      const amount = usdcVal(15)
      let signer = await ethers.getSigner(otherPerson)
      await usdc.connect(signer).transfer(originalCl.address, bnToHex(amount))
      const originalBalance = await originalCl.balance()

      // Drawdown so that the credit line has a balance
      signer = await ethers.getSigner(borrower)
      await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(1000)))
      await juniorPool.connect(signer).lockJuniorCapital()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(1000)))

      juniorPool.migrateCreditLine(
        borrower,
        bnToHex(limit),
        bnToHex(interestApr),
        bnToHex(paymentPeriodInDays),
        bnToHex(termInDays),
        bnToHex(lateFeeApr),
        bnToHex(principalGracePeriodInDays)
      )
      const newCl = await CreditLine.at(await juniorPool.creditLine())

      expect(bnToBnjs(originalBalance)).to.bignumber.eq(bnToBnjs(await newCl.balance()))
      expect(bnToBnjs(await originalCl.termEndTime())).to.bignumber.eq(bnToBnjs(await newCl.termEndTime()))
      expect(bnToBnjs(await originalCl.nextDueTime())).to.bignumber.eq(bnToBnjs(await newCl.nextDueTime()))
    })

    it("should send any funds to the new creditline, and close out the old", async () => {
      const creditLine = await CreditLine.at(await juniorPool.creditLine())
      const amount = usdcVal(15)
      let signer = await ethers.getSigner(otherPerson)
      await usdc.connect(signer).transfer(creditLine.address, bnToHex(amount))

      // Drawdown so that the credit line has a balance
      signer = await ethers.getSigner(borrower)
      await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(1000)))
      await juniorPool.connect(signer).lockJuniorCapital()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(1000)))

      await expectAction(async () =>
        juniorPool.migrateCreditLine(
          borrower,
          bnToHex(limit),
          bnToHex(interestApr),
          bnToHex(paymentPeriodInDays),
          bnToHex(termInDays),
          bnToHex(lateFeeApr),
          bnToHex(principalGracePeriodInDays)
        )
      ).toChange([
        [creditLine.balance, {to: new BN(0)}],
        [creditLine.limit, {to: new BN(0)}],
        [() => getBalance(creditLine.address, usdc), {to: new BN(0)}],
      ])
      // New creditline should have the usdc
      expect(await getBalance(await juniorPool.creditLine(), usdc)).to.bignumber.eq(amount)
    })

    it("should reassign the LOCKER_ROLE to the new borrower", async () => {
      const newBorrower = otherPerson
      await juniorPool.migrateCreditLine(
        newBorrower,
        bnToHex(limit),
        bnToHex(interestApr),
        bnToHex(paymentPeriodInDays),
        bnToHex(termInDays),
        bnToHex(lateFeeApr),
        bnToHex(principalGracePeriodInDays)
      )
      const lockerRole = await juniorPool.LOCKER_ROLE()

      expect(await juniorPool.hasRole(lockerRole, newBorrower)).to.be.true
      expect(await juniorPool.hasRole(lockerRole, borrower)).to.be.false
    })
  })

  // describe("emergency shutdown", async () => {
  //   it("should pause the pool and sweep funds", async () => {
  //     const amount = usdcVal(10)
  //     const signer = await ethers.getSigner(owner)
  //     await usdc.connect(signer).transfer(juniorPool.address, bnToHex(amount))
  //     await usdc.connect(signer).transfer(creditLine.address, bnToHex(amount))
  //     await expectAction(juniorPool.connect(signer).emergencyShutdown).toChange([
  //       [juniorPool.paused, {to: true, bignumber: false}],
  //       [() => getBalance(juniorPool.address, usdc), {to: ZERO}],
  //       [() => getBalance(creditLine.address, usdc), {to: ZERO}],
  //       [() => getBalance(treasury, usdc), {by: amount.mul(new BN(2))}],
  //     ])
  //   })
  //   it("should emit an event", async () => {
  //     const txn = await juniorPool.emergencyShutdown()
  //     expectEvent(txn, "EmergencyShutdown", {pool: juniorPool.address})
  //   })

  //   it("can only be called by governance", async () => {
  //     const signer = await ethers.getSigner(otherPerson)
  //     await expect(juniorPool.connect(signer).emergencyShutdown()).to.be.rejectedWith(/Must have admin role/)
  //   })
  // })

  describe("setLimit and setMaxLimit", async () => {
    const newLimit = new BN(500)
    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/no-extra-semi
      ;({juniorPool, creditLine} = await deployJuniorPoolWithNAOSFactoryFixture({
        usdcAddress: usdc.address,
        borrower,
        principalGracePeriodInDays,
        limit,
        interestApr,
        paymentPeriodInDays,
        termInDays,
        fundableAt,
        lateFeeApr,
        juniorFeePercent,
        id: "JuniorPool",
      }))
      await juniorPool.grantRole(await juniorPool.SENIOR_ROLE(), owner)
    })
    it("can only be called by governance", async () => {
      const signer = await ethers.getSigner(otherPerson)
      await expect(juniorPool.connect(signer).setLimit(bnToHex(newLimit))).to.be.rejectedWith(/Must have admin role/)
      await expect(juniorPool.connect(signer).setMaxLimit(bnToHex(newLimit))).to.be.rejectedWith(/Must have admin role/)
    })
    it("should update the JuniorPool limit", async () => {
      const clFnFromPool = async (pool, fnName) => (await CreditLine.at(await pool.creditLine()))[fnName]()
      await expectAction(() => juniorPool.setLimit(bnToHex(newLimit))).toChange([
        [async () => clFnFromPool(juniorPool, "limit"), {to: newLimit}],
        [async () => clFnFromPool(juniorPool, "maxLimit"), {unchanged: true}],
      ])
      await expectAction(() => juniorPool.setMaxLimit(bnToHex(newLimit))).toChange([
        [async () => clFnFromPool(juniorPool, "limit"), {unchanged: true}],
        [async () => clFnFromPool(juniorPool, "maxLimit"), {to: newLimit}],
      ])
    })
  })

  describe("deposit", async () => {
    describe("junior tranche", async () => {
      it("fails if not legacy golisted and does not have allowed UID token", async () => {
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).setAllowedUIDTypes([])
        await naosConfig.bulkRemoveFromGoList([owner])
        signer = await ethers.getSigner(owner)
        await expect(juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(1)))).to.be.rejectedWith(
          /Address not go-listed/
        )
      })

      it("fails if not legacy golisted and has incorrect UID token", async () => {
        await naosConfig.bulkRemoveFromGoList([owner])
        await uniqueIdentity.setSupportedUIDTypes([1, 2, 3], [true, true, true])
        const uidTokenId = new BN(3)
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, owner)
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).setAllowedUIDTypes([1])

        signer = await ethers.getSigner(owner)
        await expect(juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(1)))).to.be.rejectedWith(
          /Address not go-listed/
        )
      })

      it("if granted allowed UID token, does not fail for go-listed error", async () => {
        await uniqueIdentity.setSupportedUIDTypes([1, 2, 3], [true, true, true])
        const uidTokenId = new BN(1)
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, owner)
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).setAllowedUIDTypes([1])

        signer = await ethers.getSigner(owner)
        await expect(juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(1)))).to.be.fulfilled
      })

      it("does not allow deposits when pool is locked", async () => {
        const signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await expect(juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Tranche locked/)
      })

      it("does not allow 0 value deposits", async () => {
        await expect(juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(0)))).to.be.rejectedWith(/Must deposit > zero/)
      })

      it("fails for invalid tranches", async () => {
        await expect(juniorPool.deposit(0, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Unsupported tranche/)
      })

      it("updates the tranche info and mints the token", async () => {
        expect(bnToBnjs(await poolTokens.balanceOf(owner))).to.bignumber.eq("0")

        const tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        const receipt = await tx.wait()
        const depositMadeLog = receipt.logs.filter((l) => l.topics[0] === depositMadeEventHash)[0]
        assertNonNullable(depositMadeLog)

        const tokenId = parseInt(depositMadeLog.topics[depositMadeLog.topics.length - 1], 16)
        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)

        expect(bnToBnjs(juniorTranche.principalDeposited)).to.bignumber.eq(usdcVal(10))
        expect(bnToBnjs(seniorTranche.principalDeposited)).to.bignumber.eq("0")

        expect(bnToBnjs(await poolTokens.balanceOf(owner))).to.bignumber.eq("1")
        expect(bnToBnjs(await usdc.balanceOf(juniorPool.address))).to.bignumber.eq(usdcVal(10))

        const tokenInfo = await poolTokens.getTokenInfo(tokenId)
        expect(bnToBnjs(tokenInfo.principalAmount)).to.bignumber.eq(usdcVal(10))
        expect(bnToBnjs(tokenInfo.tranche)).to.bignumber.eq("2")
        expect(bnToBnjs(tokenInfo.principalRedeemed)).to.bignumber.eq("0")
        expect(bnToBnjs(tokenInfo.interestRedeemed)).to.bignumber.eq("0")
      })

      describe("multiple deposits", async () => {
        it("Keeps track of them correctly", async () => {
          await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
          await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(5)))
          const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
          const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)

          expect(bnToBnjs(juniorTranche.principalDeposited)).to.bignumber.eq(usdcVal(15))
          expect(bnToBnjs(seniorTranche.principalDeposited)).to.bignumber.eq("0")
          // TODO: Eventually should just be a single NFT
          expect(bnToBnjs(await poolTokens.balanceOf(owner))).to.bignumber.eq("2")
          expect(bnToBnjs(await usdc.balanceOf(juniorPool.address))).to.bignumber.eq(usdcVal(15))
        })
      })
    })

    describe("senior tranche", async () => {
      context("when locking the pool", () => {
        it("emits junior and senior locking events", async () => {
          const startingTimeInSeconds = new BN(1e10)
          const drawdownTimePeriod = await naosConfig.getNumber(CONFIG_KEYS.DrawdownPeriodInSeconds)
          const expectedLockedUntil = startingTimeInSeconds.add(bnToBnjs(drawdownTimePeriod))
          const signer = await ethers.getSigner(owner)
          await juniorPool.connect(signer).lockJuniorCapital() // needs to be locked before we can lock the pool

          // because we're making an assertion based on a time calculation, we
          // need to advance the blockchain to a known point in time
          await advanceTime({toSecond: startingTimeInSeconds})
          const tx = await juniorPool.connect(signer).lockPool()
          const receipt = await tx.wait()
          const trancheLockedLogs = receipt.logs.filter((l) => l.topics[0] === trancheLockedEventHash)
          assertNonNullable(trancheLockedLogs)
          expect(trancheLockedLogs.length).to.equal(2)
        })
      })

      it("does not allow deposits when pool is locked", async () => {
        const signer = await ethers.getSigner(borrower)
        await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()
        await expect(juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Tranche locked/)
      })

      it("allows deposits from the senior pool", async () => {
        let signer = await ethers.getSigner(owner)
        await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        await juniorPool.connect(signer).lockJuniorCapital()

        signer = await ethers.getSigner(borrower)
        await expect(juniorPool.connect(signer).deposit(TRANCHES.Senior, bnToHex(usdcVal(10)))).to.be.rejectedWith(
          /Req SENIOR_ROLE/i
        )
        const tx = await indexPool.invest(juniorPool.address)
        const receipt = await tx.wait()
        const investmentMadeInSeniorLog = receipt.logs.filter((l) => l.topics[0] === investmentMadeInSeniorEventHash)[0]
        assertNonNullable(investmentMadeInSeniorLog)
      })

      it("forbids deposits from accounts without the SENIOR_ROLE", async () => {
        const seniorRole = await juniorPool.SENIOR_ROLE()
        const signer = await ethers.getSigner(borrower)
        expect(await juniorPool.hasRole(seniorRole, borrower)).to.be.false
        await expect(juniorPool.connect(signer).deposit(TRANCHES.Senior, bnToHex(usdcVal(10)))).to.be.rejectedWith(
          /Req SENIOR_ROLE/i
        )
      })

      it("fails for invalid tranches", async () => {
        await expect(juniorPool.deposit(3, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Unsupported tranche/)
      })

      it("does not allow 0 value deposits", async () => {
        await expect(juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(0)))).to.be.rejectedWith(/Must deposit > zero/)
      })

      it("updates the tranche info and mints the token", async () => {
        const juniorDeposits = usdcVal(10)
        expect(bnToBnjs(await poolTokens.balanceOf(owner))).to.bignumber.eq("0")
        await juniorPool.deposit(2, bnToHex(juniorDeposits))
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        const seniorDeposits = await indexPool.estimateInvestment(juniorPool.address)
        const totalDeposits = seniorDeposits.add(bnToHex(juniorDeposits))
        const seniorInvestResponse = await indexPool.invest(juniorPool.address)
        const seniorInvestReceipt = await seniorInvestResponse.wait()
        const depositMadeLog = seniorInvestReceipt.logs.filter((l) => l.topics[0] === depositMadeEventHash)[0]
        assertNonNullable(depositMadeLog)

        const seniorTokenId = parseInt(depositMadeLog.topics[depositMadeLog.topics.length - 1], 16)
        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)

        expect(bnToBnjs(juniorTranche.principalDeposited)).to.bignumber.eq(juniorDeposits)
        expect(bnToBnjs(seniorTranche.principalDeposited)).to.bignumber.eq(bnToBnjs(seniorDeposits))

        expect(bnToBnjs(await poolTokens.balanceOf(owner))).to.bignumber.eq("1")
        expect(bnToBnjs(await usdc.balanceOf(juniorPool.address))).to.bignumber.eq(bnToBnjs(totalDeposits))

        const seniorTokenInfo = await poolTokens.getTokenInfo(seniorTokenId)
        expect(bnToBnjs(seniorTokenInfo.tranche)).to.bignumber.eq("1")
        expect(bnToBnjs(seniorTokenInfo.principalRedeemed)).to.bignumber.eq("0")
        expect(bnToBnjs(seniorTokenInfo.interestRedeemed)).to.bignumber.eq("0")
      })

      describe("multiple deposits", async () => {
        it("Keeps track of them correctly", async () => {
          await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(10)))
          await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(5)))
          const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
          const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)

          expect(bnToBnjs(juniorTranche.principalDeposited)).to.bignumber.eq("0")
          expect(bnToBnjs(seniorTranche.principalDeposited)).to.bignumber.eq(usdcVal(15))
          // TODO: Eventually should just be a single NFT
          expect(bnToBnjs(await poolTokens.balanceOf(owner))).to.bignumber.eq("2")
          expect(bnToBnjs(await usdc.balanceOf(juniorPool.address))).to.bignumber.eq(usdcVal(15))
        })
      })
    })
  })

  describe("depositWithPermit", async () => {
    it("deposits using permit", async () => {
      const otherPersonAddress = otherPerson.toLowerCase()
      const juniorPoolAddress = juniorPool.address.toLowerCase()
      const nonce = await usdc.nonces(otherPersonAddress)
      const deadline = MAX_UINT
      const value = usdcVal(100)

      // Create signature for permit
      const digest = await getApprovalDigest({
        token: usdc,
        owner: otherPersonAddress,
        spender: juniorPoolAddress,
        value,
        nonce,
        deadline,
      })
      const wallet = await getWallet(otherPersonAddress)
      assertNonNullable(wallet)
      const {v, r, s} = ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(wallet.privateKey.slice(2), "hex"))

      const signer = await ethers.getSigner(otherPersonAddress)
      const tx = await (juniorPool as any).connect(signer).depositWithPermit(TRANCHES.Junior, bnToHex(value), bnToHex(deadline), v, r, s)

      // Verify deposit was correct
      const receipt = await tx.wait()
      const depositMadeLog = receipt.logs.filter((l) => l.topics[0] === depositMadeEventHash)[0]
      assertNonNullable(depositMadeLog)

      const tokenId = parseInt(depositMadeLog.topics[depositMadeLog.topics.length - 1], 16)
      const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
      const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)

      expect(bnToBnjs(juniorTranche.principalDeposited)).to.bignumber.eq(usdcVal(100))
      expect(bnToBnjs(seniorTranche.principalDeposited)).to.bignumber.eq("0")

      expect(bnToBnjs(await poolTokens.balanceOf(otherPersonAddress))).to.bignumber.eq("1")
      expect(bnToBnjs(await usdc.balanceOf(juniorPool.address))).to.bignumber.eq(usdcVal(100))

      const tokenInfo = await poolTokens.getTokenInfo(tokenId)
      expect(bnToBnjs(tokenInfo.principalAmount)).to.bignumber.eq(usdcVal(100))
      expect(bnToBnjs(tokenInfo.tranche)).to.bignumber.eq(TRANCHES.Junior.toString())
      expect(bnToBnjs(tokenInfo.principalRedeemed)).to.bignumber.eq("0")
      expect(bnToBnjs(tokenInfo.interestRedeemed)).to.bignumber.eq("0")

      // Verify that permit creates allowance for amount only
      expect(bnToBnjs(await usdc.allowance(otherPersonAddress, juniorPoolAddress))).to.bignumber.eq("0")
    })
  })

  describe("availableToWithdraw", async () => {
    it("returns redeemable interest and principal", async () => {
      // Total junior tranche investment is split between 2 people
      await erc20Approve(usdc, juniorPool.address, usdcVal(100000), [otherPerson])
      let signer = await ethers.getSigner(otherPerson)
      await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(500)), {from: otherPerson})
      let tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(500)))
      const receipt = await tx.wait()
      const depositMadeLog = receipt.logs.filter((l) => l.topics[0] === depositMadeEventHash)[0]
      assertNonNullable(depositMadeLog)

      const tokenId = parseInt(depositMadeLog.topics[depositMadeLog.topics.length - 1], 16)

      signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()

      // Should be zero while tranche is locked
      let {0: interestRedeemable, 1: principalRedeemable} = await juniorPool.availableToWithdraw(tokenId)
      expect(bnToBnjs(interestRedeemable)).to.bignumber.equal(new BN(0))
      expect(bnToBnjs(principalRedeemable)).to.bignumber.equal(new BN(0))

      await juniorPool.connect(signer).lockPool()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(1000)))
      const payAmount = usdcVal(1050)
      await advanceTime({days: termInDays.toNumber()})
      await erc20Approve(usdc, juniorPool.address, payAmount, [borrower])

      tx = await juniorPool.connect(signer).pay(bnToHex(payAmount))
      const receipt2 = await tx.wait()
      expectPaymentRelatedEventsEmitted(receipt2, borrower, juniorPool, {
        interest: usdcVal(50),
        principal: usdcVal(1000),
        remaining: new BN(0),
        reserve: usdcVal(5),
      })

      // Total amount owed to junior:
      //   interest_accrued = 1000 * 0.05 = 50
      //   protocol_fee = interest_accrued * 0.1 = 5
      //   1000 + interest_accrued - protocol_fee = 1045
      // Amount owed to one of the junior investors:
      //   1045 / 2 = 522.5
      ;({0: interestRedeemable, 1: principalRedeemable} = await juniorPool.availableToWithdraw(tokenId))
      expect(bnToBnjs(interestRedeemable)).to.bignumber.equal(usdcVal(2250).div(new BN(100)))
      expect(bnToBnjs(principalRedeemable)).to.bignumber.equal(usdcVal(500))
    })
  })

  describe("withdraw", async () => {
    describe("validations", async () => {
      it("fails if not legacy golisted and does not have allowed UID token", async () => {
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).setAllowedUIDTypes([0])
        signer = await ethers.getSigner(owner)
        const tx = await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(1)))
        await naosConfig.bulkRemoveFromGoList([owner])
        const receipt = await tx.wait()
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

        await expect(juniorPool.connect(signer).withdraw(tokenId, bnToHex(usdcVal(1)))).to.be.rejectedWith(
          /Address not go-listed/
        )
      })
      it("if granted allowed UID token, does not fail for go-listed error", async () => {
        await uniqueIdentity.setSupportedUIDTypes([1, 2, 3], [true, true, true])
        const uidTokenId = new BN(1)
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, owner)
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).setAllowedUIDTypes([1])
        signer = await ethers.getSigner(owner)
        const tx = await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(1)))
        const receipt = await tx.wait()
        await naosConfig.bulkRemoveFromGoList([owner])
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

        await expect(juniorPool.connect(signer).withdraw(tokenId, bnToHex(usdcVal(1)))).to.be.fulfilled
      })

      it("does not allow you to withdraw if you don't own the pool token", async () => {
        let signer = await ethers.getSigner(owner)
        const tx = await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        const receipt = await tx.wait()
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

        signer = await ethers.getSigner(otherPerson)
        await expect(juniorPool.connect(signer).withdraw(tokenId, bnToHex(usdcVal(10)))).to.be.rejectedWith(
          /Not token owner/
        )
        await expect(juniorPool.connect(signer).withdrawMax(tokenId)).to.be.rejectedWith(/Not token owner/)
      })
      // TODO: fix this
      // it("does not allow you to withdraw if pool token is from a different pool", async () => {
      //   let signer = await ethers.getSigner(owner)
      //   await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
      //   // eslint-disable-next-line @typescript-eslint/no-extra-semi
      //   const {juniorPool: otherJuniorPool} = await deployJuniorPoolWithNAOSFactoryFixture({
      //     usdcAddress: usdc.address,
      //     borrower,
      //     principalGracePeriodInDays,
      //     limit,
      //     interestApr,
      //     paymentPeriodInDays,
      //     termInDays,
      //     fundableAt,
      //     lateFeeApr,
      //     juniorFeePercent,
      //     id: "newPool",
      //   })
      //   await juniorPool.grantRole(await juniorPool.SENIOR_ROLE(), owner)

      //   const tx = await otherJuniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
      //   // const logs = decodeLogs<DepositMade>(otherReceipt.receipt.rawLogs, otherJuniorPool, "DepositMade")
      //   // const firstLog = getFirstLog(logs)
      //   // const otherTokenId = firstLog.args.tokenId
      //   const receipt = await tx.wait()
      //   const log = receipt.logs.filter((l) => l.address.toLowerCase() === otherJuniorPool.address.toLowerCase())[0]
      //   const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

      //   await expect(juniorPool.connect(signer).withdraw(tokenId, bnToHex(usdcVal(10)))).to.be.rejectedWith(
      //     /Invalid sender/
      //   )
      // })
      it("does not allow you to withdraw if no amount is available", async () => {
        const signer = await ethers.getSigner(owner)
        const tx = await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        const receipt = await tx.wait()
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

        await expect(juniorPool.connect(signer).withdrawMax(tokenId)).to.be.fulfilled
        await expect(juniorPool.connect(signer).withdraw(tokenId, bnToHex(usdcVal(10)))).to.be.rejectedWith(
          /Invalid redeem amount/
        )
      })

      it("does not allow you to withdraw zero amounts", async () => {
        const signer = await ethers.getSigner(owner)
        const tx = await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        const receipt = await tx.wait()
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

        await expect(juniorPool.connect(signer).withdraw(tokenId, bnToHex(usdcVal(0)))).to.be.rejectedWith(
          /Must withdraw more than zero/
        )
      })
    })
    describe("before the pool is locked", async () => {
      it("lets you withdraw everything you put in", async () => {
        const tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        const receipt = await tx.wait()
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

        await juniorPool.withdraw(tokenId, bnToHex(usdcVal(10)))
        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        expect(bnToBnjs(juniorTranche.principalDeposited)).to.bignumber.eq("0")
        expect(bnToBnjs(await usdc.balanceOf(juniorPool.address))).to.bignumber.eq("0")

        const tokenInfo = await poolTokens.getTokenInfo(tokenId)
        // TODO: fix this | Before lock, principalAmount is decremented on withdraw (rather than incrementing principalRedeemed)
        // expect(bnToBnjs(tokenInfo.principalAmount)).to.bignumber.eq(usdcVal(0))
        // expect(bnToBnjs(tokenInfo.principalRedeemed)).to.bignumber.eq(usdcVal(0))
        // expect(bnToBnjs(tokenInfo.interestRedeemed)).to.bignumber.eq("0")
      })
    })

    describe("after the pool is locked", async () => {
      it("does not let you withdraw if no payments have come back", async () => {
        const tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        const receipt = await tx.wait()
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

        const signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()

        await expect(juniorPool.withdraw(tokenId, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Tranche is locked/)
      })

      it("lets you withdraw pro-rata share of payments", async () => {
        // Total junior tranche investment is split between 2 people
        await erc20Approve(usdc, juniorPool.address, usdcVal(100000), [otherPerson])
        let signer = await ethers.getSigner(otherPerson)
        await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(500)))
        const tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(500)))
        let receipt = await tx.wait()
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

        signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(1000)))
        await advanceTime({days: termInDays.toNumber()})
        const payAmount = usdcVal(1050)
        await erc20Approve(usdc, juniorPool.address, payAmount, [borrower])

        const tx2 = await juniorPool.pay(bnToHex(payAmount))
        expectPaymentRelatedEventsEmitted(await tx2.wait(), borrower, juniorPool, {
          interest: usdcVal(50),
          principal: usdcVal(1000),
          remaining: new BN(0),
          reserve: usdcVal(5),
        })

        // Total amount owed to junior:
        //   interest_accrued = 1000 * 0.05 = 50
        //   protocol_fee = interest_accrued * 0.1 = 5
        //   1000 + interest_accrued - protocol_fee = 1045
        // Amount owed to one of the junior investors:
        //   1045 / 2 = 522.5
        await expectAction(async () => juniorPool.withdraw(tokenId, bnToHex(usdcVal(52250).div(new BN(100))))).toChange([
          [async () => await getBalance(owner, usdc), {by: usdcVal(52250).div(new BN(100))}],
        ])
        const tokenInfo = await poolTokens.getTokenInfo(tokenId)
        expect(bnToBnjs(tokenInfo.principalAmount)).to.bignumber.eq(usdcVal(500))
        // After lock, principalRedeemed is incremented on withdraw
        expect(bnToBnjs(tokenInfo.principalRedeemed)).to.bignumber.eq(usdcVal(500))
        expect(bnToBnjs(tokenInfo.interestRedeemed)).to.bignumber.eq(usdcVal(225).div(new BN(10)))

        // After withdrawing the max, the junior investor should not be able to withdraw more
        await expect(juniorPool.withdraw(tokenId, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Invalid redeem amount/)
      })

      it("emits a WithdrawalMade event", async () => {
        const tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(1000)))
        // const logs = decodeLogs<DepositMade>(response.receipt.rawLogs, juniorPool, "DepositMade")
        // const firstLog = getFirstLog(logs)
        // const tokenId = firstLog.args.tokenId
        const receipt = await tx.wait()
        const depositMadeLog = receipt.logs.filter((l) => l.topics[0] === depositMadeEventHash)[0]
        assertNonNullable(depositMadeLog)

        const tokenId = parseInt(depositMadeLog.topics[depositMadeLog.topics.length - 1], 16)

        const signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(1000)))
        await advanceTime({days: termInDays.toNumber()})
        const payAmount = usdcVal(1050)
        await erc20Approve(usdc, juniorPool.address, payAmount, [borrower])

        const tx2 = await juniorPool.connect(signer).pay(bnToHex(payAmount))
        expectPaymentRelatedEventsEmitted(await tx2.wait(), borrower, juniorPool, {
          interest: usdcVal(50),
          principal: usdcVal(1000),
          remaining: new BN(0),
          reserve: usdcVal(5),
        })

        // Total amount owed to junior:
        //   principal = 1000
        //   interest_accrued = 1000 * 0.05 = 50
        //   protocol_fee = interest_accrued * 0.1 = 5
        //   principal + interest_accrued - protocol_fee = 1045
        const txn = await juniorPool.withdraw(tokenId, bnToHex(usdcVal(1045)))
        const wreceipt = await txn.wait()
        const wlog = wreceipt.logs.filter((l) => l.topics[0] === withdrawalMadeEventHash)[0]
        assertNonNullable(wlog)
      })
    })

    it("does not allow you to withdraw during the drawdown period", async () => {
      let tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
      let receipt = await tx.wait()
      let log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
      const juniorTokenId = parseInt(log.topics[log.topics.length - 1], 16)

      let signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()

      await expect(juniorPool.withdraw(juniorTokenId, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Tranche is locked/)

      tx = await indexPool.invest(juniorPool.address)
      receipt = await tx.wait()
      log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
      const seniorTokenId = parseInt(log.topics[log.topics.length - 1], 16)
      await juniorPool.connect(signer).lockPool()

      await expect(juniorPool.withdraw(seniorTokenId, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Not token owner/i)

      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(25)))

      await advanceTime({days: 2})

      // After the drawdown period, each tranche can withdraw unused capital
      await expectAction(async () => juniorPool.withdrawMax(juniorTokenId)).toChange([
        [async () => await getBalance(owner, usdc), {by: usdcVal(5)}],
      ])
      await expectAction(async () => indexPool.redeem(seniorTokenId)).toChange([
        [async () => await getBalance(indexPool.address, usdc), {by: usdcVal(20)}],
      ])
    })
  })

  describe("withdrawMultiple", async () => {
    let firstToken, secondToken, thirdTokenFromDifferentUser

    beforeEach(async () => {
      let tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(100)))
      let receipt = await tx.wait()
      let log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
      firstToken = parseInt(log.topics[log.topics.length - 1], 16)

      tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(400)))
      receipt = await tx.wait()
      log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
      secondToken = parseInt(log.topics[log.topics.length - 1], 16)

      await erc20Approve(usdc, juniorPool.address, usdcVal(100000), [otherPerson])
      let signer = await ethers.getSigner(otherPerson)
      tx = await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(500)))
      receipt = await tx.wait()
      log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
      thirdTokenFromDifferentUser = parseInt(log.topics[log.topics.length - 1], 16)

      signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()
      await juniorPool.connect(signer).lockPool()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(500)))
      // Move past drawdown window
      await advanceTime({days: 5})
      // Mine a block so the timestamp takes effect for view functions
      await hre.ethers.provider.send("evm_mine", [])
    })

    describe("validations", async () => {
      it("reverts if any token id is not owned by the sender", async () => {
        await expect(
          juniorPool.withdrawMultiple([firstToken, thirdTokenFromDifferentUser], [bnToHex(usdcVal(50)), bnToHex(usdcVal(200))])
        ).to.be.rejectedWith(/Not token owner/)
      })

      it("reverts if any amount exceeds withdrawable amount for that token", async () => {
        await expect(
          juniorPool.withdrawMultiple([firstToken, secondToken], [bnToHex(usdcVal(50)), bnToHex(usdcVal(250))])
        ).to.be.rejectedWith(/Invalid redeem amount/)
      })

      it("reverts if array lengths don't match", async () => {
        await expect(
          juniorPool.withdrawMultiple([firstToken, thirdTokenFromDifferentUser], [bnToHex(usdcVal(50))])
        ).to.be.rejectedWith(/TokensIds and Amounts mismatch/)
      })
    })

    it("should withdraw from multiple token ids simultaneously", async () => {
      await expectAction(async () =>
        juniorPool.withdrawMultiple([firstToken, secondToken], [bnToHex(usdcVal(50)), bnToHex(usdcVal(200))])
      ).toChange([
        [async () => await getBalance(owner, usdc), {by: usdcVal(250)}],
        [async () => bnToBnjs((await juniorPool.availableToWithdraw(firstToken))[1]), {to: usdcVal(0)}],
        [async () => bnToBnjs((await juniorPool.availableToWithdraw(secondToken))[1]), {to: usdcVal(0)}],
      ])
    })
  })

  describe("withdrawMax", async () => {
    it("should withdraw the max", async () => {
      // Total junior tranche investment is split between 2 people
      await erc20Approve(usdc, juniorPool.address, usdcVal(100000), [otherPerson])
      let signer = await ethers.getSigner(otherPerson)
      await juniorPool.connect(signer).deposit(TRANCHES.Junior, bnToHex(usdcVal(500)))
      let tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(500)))
      const receipt = await tx.wait()
      const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
      const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

      signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()
      await juniorPool.connect(signer).lockPool()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(1000)))
      const payAmount = usdcVal(1050)
      await advanceTime({days: termInDays.toNumber()})
      await erc20Approve(usdc, juniorPool.address, payAmount, [borrower])

      tx = await juniorPool.connect(signer).pay(bnToHex(payAmount))
      expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
        interest: usdcVal(50),
        principal: usdcVal(1000),
        remaining: new BN(0),
        reserve: usdcVal(5),
      })

      // Total amount owed to junior:
      //   interest_accrued = 1000 * 0.05 = 50
      //   protocol_fee = interest_accrued * 0.1 = 5
      //   1000 + interest_accrued - protocol_fee = 1045
      // Amount owed to one of the junior investors:
      //   1045 / 2 = 522.5
      await expectAction(async () => juniorPool.withdrawMax(tokenId)).toChange([
        [async () => await getBalance(owner, usdc), {by: usdcVal(52250).div(new BN(100))}],
      ])
      // Nothing left to withdraw
      await expect(juniorPool.withdrawMax(tokenId)).to.be.rejectedWith(/Must withdraw more than zero/)
    })

    it("emits a WithdrawalMade event", async () => {
      const tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(1000)))
      const receipt = await tx.wait()
      const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
      const tokenId = parseInt(log.topics[log.topics.length - 1], 16)

      let signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()
      await juniorPool.connect(signer).lockPool()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(1000)))
      await advanceTime({days: termInDays.toNumber()})
      const payAmount = usdcVal(1050)
      await erc20Approve(usdc, juniorPool.address, payAmount, [borrower])

      const tx2 = await juniorPool.connect(signer).pay(bnToHex(payAmount))
      expectPaymentRelatedEventsEmitted(await tx2.wait(), borrower, juniorPool, {
        interest: usdcVal(50),
        principal: usdcVal(1000),
        remaining: new BN(0),
        reserve: usdcVal(5),
      })

      // Total amount owed to junior:
      //   principal = 1000
      //   interest_accrued = 1000 * 0.05 = 50
      //   protocol_fee = interest_accrued * 0.1 = 5
      //   principal + interest_accrued - protocol_fee = 1045
      const wtx = await juniorPool.withdrawMax(tokenId)
      const wreceipt = await wtx.wait()
      const wlog = wreceipt.logs.filter((l) => l.topics[0] === withdrawalMadeEventHash)[0]
      assertNonNullable(wlog)
    })

    describe("when deposits are over the limit", async () => {
      it("lets you withdraw the unused amounts", async () => {
        const juniorDeposit = limit
        const seniorDeposit = limit.mul(new BN(4))
        let tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(juniorDeposit))
        let receipt = await tx.wait()
        let log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const juniorTokenId = parseInt(log.topics[log.topics.length - 1], 16)
        tx = await juniorPool.deposit(TRANCHES.Senior,bnToHex(seniorDeposit))
        receipt = await tx.wait()
        log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        const seniorTokenId = parseInt(log.topics[log.topics.length - 1], 16)
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()

        expect(bnToBnjs(await creditLine.limit())).to.bignumber.eq(limit)

        await expectAction(async () => juniorPool.connect(signer).drawdown(bnToHex(limit))).toChange([
          [async () => bnToBnjs(await creditLine.balance()), {to: limit}],
          [async () => bnToBnjs(await usdc.balanceOf(borrower)), {by: limit}],
          [async () => bnToBnjs(await usdc.balanceOf(juniorPool.address)), {to: limit.mul(new BN(4))}], // 5x limit was deposited. 4x still remaining
        ])

        advanceTime({days: termInDays.toNumber()})

        // Only 20% of the capital was used, so remaining 80% should be available for drawdown
        await expectAction(async () => juniorPool.withdrawMax(juniorTokenId)).toChange([
          [() => getBalance(owner, usdc), {by: juniorDeposit.mul(new BN(80)).div(new BN(100))}],
        ])
        await expectAction(async () => juniorPool.withdrawMax(seniorTokenId)).toChange([
          [() => getBalance(owner, usdc), {by: seniorDeposit.mul(new BN(80)).div(new BN(100))}],
        ])

        // Fully pay off the loan, TODO: check whether we approve before?
        await erc20Approve(usdc, juniorPool.address, limit.add(limit.mul(new BN(5)).div(new BN(100))), [borrower])
        const tx2 = await juniorPool.connect(signer).pay(bnToHex(limit.add(limit.mul(new BN(5)).div(new BN(100)))))
        expectPaymentRelatedEventsEmitted(await tx2.wait(), borrower, juniorPool, {
          interest: usdcVal(50),
          principal: usdcVal(1000),
          remaining: new BN(0),
          reserve: usdcVal(5),
        })

        // Remaining 20% of principal should be withdrawn
        const tx3 = await juniorPool.withdrawMax(juniorTokenId)
        const wreceipt3 = await tx3.wait()
        const wlog3 = wreceipt3.logs.filter((l) => l.topics[0] === withdrawalMadeEventHash)[0]
        assertNonNullable(wlog3)

        const tx4 = await juniorPool.withdrawMax(seniorTokenId)
        const wreceipt4 = await tx4.wait()
        const wlog4 = wreceipt4.logs.filter((l) => l.topics[0] === withdrawalMadeEventHash)[0]
        assertNonNullable(wlog4)
      })
    })
  })
  describe("setAllowedUIDTypes", () => {
    it("sets array of id types", async () => {
      let signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).setAllowedUIDTypes([1])
      expect(bnToBnjs(await juniorPool.allowedUIDTypes(0))).to.bignumber.equal(new BN(1))
      await juniorPool.connect(signer).setAllowedUIDTypes([1, 2])
      expect(bnToBnjs(await juniorPool.allowedUIDTypes(0))).to.bignumber.equal(new BN(1))
      expect(bnToBnjs(await juniorPool.allowedUIDTypes(1))).to.bignumber.equal(new BN(2))
    })

    it("getAllowedUIDTypes", async () => {
      const signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).setAllowedUIDTypes([1])
      expect(bnToBnjs(await juniorPool.allowedUIDTypes(0))).to.bignumber.equal(new BN(1))
      // expect(await (await juniorPool.getAllowedUIDTypes()).map((x) => x.toNumber())).to.deep.equal([1])

      await juniorPool.connect(signer).setAllowedUIDTypes([1, 2])
      expect(bnToBnjs(await juniorPool.allowedUIDTypes(0))).to.bignumber.equal(new BN(1))
      expect(bnToBnjs(await juniorPool.allowedUIDTypes(1))).to.bignumber.equal(new BN(2))
      // expect(await (await juniorPool.getAllowedUIDTypes()).map((x) => x.toNumber())).to.deep.equal([1, 2])
    })

    it("validate must be locker", async () => {
      let signer = await ethers.getSigner(borrower)
      await expect(juniorPool.connect(signer).setAllowedUIDTypes([1])).to.be.fulfilled
      signer = await ethers.getSigner(owner)
      await expect(juniorPool.connect(signer).setAllowedUIDTypes([1])).to.be.fulfilled
      signer = await ethers.getSigner(otherPerson)
      await expect(juniorPool.connect(signer).setAllowedUIDTypes([1])).to.be.rejectedWith(
        /Must have locker role/
      )
    })

    it("validate no principal has been deposited to jr pool", async () => {
      await uniqueIdentity.setSupportedUIDTypes([1, 2, 3], [true, true, true])
      let signer = await ethers.getSigner(borrower)
      await expect(juniorPool.connect(signer).setAllowedUIDTypes([1])).to.be.fulfilled
      const uidTokenId = new BN(1)
      const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
      await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, owner)
      await juniorPool.connect(signer).setAllowedUIDTypes([1])

      let ow = await ethers.getSigner(owner)
      await expect(juniorPool.connect(ow).deposit(TRANCHES.Junior, bnToHex(usdcVal(1)))).to.be.fulfilled

      await expect(juniorPool.connect(signer).setAllowedUIDTypes([1])).to.be.rejectedWith(/Must not have balance/)
    })

    it("validate no principal has been deposited to sr pool", async () => {
      await uniqueIdentity.setSupportedUIDTypes([1, 2, 3], [true, true, true])
      let signer = await ethers.getSigner(borrower)
      await expect(juniorPool.connect(signer).setAllowedUIDTypes([1])).to.be.fulfilled
      const uidTokenId = new BN(1)
      const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
      await mint(hre, uniqueIdentity, uidTokenId, expiresAt, new BN(0), owner, undefined, owner)
      await juniorPool.connect(signer).setAllowedUIDTypes([1])

      let ow = await ethers.getSigner(owner)
      await expect(juniorPool.connect(ow).deposit(TRANCHES.Senior, bnToHex(usdcVal(1)))).to.be.fulfilled

      await expect(juniorPool.connect(signer).setAllowedUIDTypes([1])).to.be.rejectedWith(/Must not have balance/)
    })
  })

  describe("access controls", () => {
    const LOCKER_ROLE = web3.utils.keccak256("LOCKER_ROLE")
    it("sets the owner to governance", async () => {
      expect(await juniorPool.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await juniorPool.hasRole(OWNER_ROLE, borrower)).to.equal(false)
      expect(await juniorPool.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE)
    })

    it("sets the pauser to governance", async () => {
      expect(await juniorPool.hasRole(PAUSER_ROLE, owner)).to.equal(true)
      expect(await juniorPool.hasRole(PAUSER_ROLE, borrower)).to.equal(false)
      expect(await juniorPool.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE)
    })

    it("sets the locker to borrower and governance", async () => {
      expect(await juniorPool.hasRole(LOCKER_ROLE, borrower)).to.equal(true)
      expect(await juniorPool.hasRole(LOCKER_ROLE, owner)).to.equal(true)
      expect(await juniorPool.hasRole(LOCKER_ROLE, otherPerson)).to.equal(false)
      expect(await juniorPool.getRoleAdmin(LOCKER_ROLE)).to.equal(OWNER_ROLE)
    })

    it("allows the owner to set new addresses as roles", async () => {
      expect(await juniorPool.hasRole(OWNER_ROLE, otherPerson)).to.equal(false)
      let signer = await ethers.getSigner(owner)
      await juniorPool.connect(signer).grantRole(OWNER_ROLE, otherPerson)
      expect(await juniorPool.hasRole(OWNER_ROLE, otherPerson)).to.equal(true)
    })

    it("should not allow anyone else to add an owner", async () => {
      const signer = await ethers.getSigner(borrower)
      return expect(juniorPool.connect(signer).grantRole(OWNER_ROLE, otherPerson)).to.be.rejected
    })
  })

  describe("pausability", () => {
    describe("after pausing", async () => {
      let tokenId: BN

      beforeEach(async () => {
        const tx = await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))
        const receipt = await tx.wait()
        const log = receipt.logs.filter((l) => l.address.toLowerCase() === juniorPool.address.toLowerCase())[0]
        tokenId = new BN(log.topics[log.topics.length - 1].substr(2), 16)

        await juniorPool.pause()
      })

      it("disallows deposits", async () => {
        await expect(juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))).to.be.rejectedWith(/Pausable: paused/)

        const nonce = await usdc.nonces(owner)
        const deadline = MAX_UINT
        const digest = await getApprovalDigest({
          token: usdc,
          owner: owner,
          spender: juniorPool.address,
          value: usdcVal(10),
          nonce,
          deadline,
        })
        const wallet = await getWallet(owner)
        assertNonNullable(wallet)
        const {v, r, s} = ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(wallet.privateKey.slice(2), "hex"))
        await expect(
          (juniorPool as any).depositWithPermit(TRANCHES.Junior, bnToHex(usdcVal(10)), bnToHex(deadline), v, r, s)
        ).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows withdrawing", async () => {
        await expect(juniorPool.withdraw(bnToHex(tokenId), bnToHex(usdcVal(5)))).to.be.rejectedWith(/Pausable: paused/)
        await expect(juniorPool.withdrawMax(bnToHex(tokenId))).to.be.rejectedWith(/Pausable: paused/)
        await expect(juniorPool.withdrawMultiple([bnToHex(tokenId)], [bnToHex(usdcVal(5))])).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows drawdown", async () => {
        let signer = await ethers.getSigner(borrower)
        await expect(juniorPool.connect(signer).drawdown(bnToHex(usdcVal(10)))).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows pay", async () => {
        let signer = await ethers.getSigner(borrower)
        await expect(juniorPool.connect(signer).pay(bnToHex(usdcVal(10)))).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows assess", async () => {
        let signer = await ethers.getSigner(borrower)
        await expect(juniorPool.connect(signer).assess()).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows lockJuniorCapital", async () => {
        let signer = await ethers.getSigner(borrower)
        await expect(juniorPool.connect(signer).lockJuniorCapital()).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows lockPool", async () => {
        let signer = await ethers.getSigner(borrower)
        await expect(juniorPool.connect(signer).lockPool()).to.be.rejectedWith(/Pausable: paused/)
      })

      it("allows unpausing", async () => {
        let signer = await ethers.getSigner(borrower)
        await juniorPool.unpause()
        await expect(juniorPool.withdraw(bnToHex(tokenId), bnToHex(usdcVal(10)))).to.be.fulfilled
        await expect(juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(10)))).to.be.fulfilled
        await expect(juniorPool.lockJuniorCapital()).to.be.fulfilled
        await expect(juniorPool.lockPool()).to.be.fulfilled
        await expect(juniorPool.connect(signer).drawdown(bnToHex(usdcVal(10)))).to.be.fulfilled
        // do we approve before?
        await erc20Approve(usdc, juniorPool.address, usdcVal(10), [borrower])
        await expect(juniorPool.connect(signer).pay(bnToHex(usdcVal(10)))).to.be.fulfilled
      })
    })

    describe("actually pausing", async () => {
      it("should allow the owner to pause", async () => {
        let signer = await ethers.getSigner(owner)
        await expect(juniorPool.connect(signer).pause()).to.be.fulfilled
      })
      it("should disallow non-owner to pause", async () => {
        let signer = await ethers.getSigner(borrower)
        await expect(juniorPool.connect(signer).pause()).to.be.rejectedWith(/Must have pauser role/)
      })
    })
  })

  describe("locking", async () => {
    describe("junior tranche", async () => {
      describe("as the borrower", async () => {
        it("locks the junior tranche", async () => {
          const actor = await ethers.getSigner(borrower)
          await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(10)))
          const oneDayFromNow = (await time.latest()).add(SECONDS_PER_DAY)
          await expectAction(async () => {
            const tx = await juniorPool.connect(actor).lockJuniorCapital()

            const receipt = await tx.wait()
            const trancheLockedLog = receipt.logs.filter((l) => l.topics[0] === trancheLockedEventHash)[0]
            assertNonNullable(trancheLockedLog)
            const trancheId = parseInt(trancheLockedLog.data.substr(0, 66), 16)
            expect(trancheId.toString()).to.equal(TRANCHES.Junior.toString())

            return receipt
          }).toChange([
            [async () => bnToBnjs((await juniorPool.getTranche(TRANCHES.Junior)).lockedUntil), {increase: true}],
            [async () => bnToBnjs((await juniorPool.getTranche(TRANCHES.Junior)).principalSharePrice), {unchanged: true}],
          ])
          // Should be locked upto approximately 1 day from now (plus or minus a few seconds)
          expect(bnToBnjs((await juniorPool.getTranche(TRANCHES.Junior)).lockedUntil)).to.be.bignumber.closeTo(
            bnToBnjs(oneDayFromNow),
            new BN(5)
          )
        })
      })

      describe("as the owner", async () => {
        it("locks the junior tranche", async () => {
          await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(10)))
          const oneDayFromNow = (await time.latest()).add(SECONDS_PER_DAY)
          await expectAction(async () => {
            let signer = await ethers.getSigner(borrower)
            const tx = await juniorPool.connect(signer).lockJuniorCapital()
            const receipt = await tx.wait()
            const trancheLockedLog = receipt.logs.filter((l) => l.topics[0] === trancheLockedEventHash)[0]
            assertNonNullable(trancheLockedLog)
            const trancheId = parseInt(trancheLockedLog.data.substr(0, 66), 16)
            expect(trancheId.toString()).to.equal(TRANCHES.Junior.toString())

            return receipt
          }).toChange([
            [async () => bnToBnjs((await juniorPool.getTranche(TRANCHES.Junior)).lockedUntil), {increase: true}],
            [async () => bnToBnjs((await juniorPool.getTranche(TRANCHES.Junior)).principalSharePrice), {unchanged: true}],
          ])
          // Should be locked upto approximately 1 day from now (plus or minus a few seconds)
          expect(bnToBnjs((await juniorPool.getTranche(TRANCHES.Junior)).lockedUntil)).to.be.bignumber.closeTo(
            oneDayFromNow,
            new BN(5)
          )
        })
      })

      describe("as someone else", async () => {
        it("does not lock", async () => {
          const actor = await ethers.getSigner(otherPerson)
          await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(10)))
          await expect(juniorPool.connect(actor).lockJuniorCapital()).to.be.rejectedWith(/Must have locker role/)
        })
      })

      it("does not allow locking twice", async () => {
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await expect(juniorPool.connect(signer).lockJuniorCapital()).to.be.rejectedWith(/already locked/)
      })
    })

    describe("senior tranche", async () => {
      beforeEach(async () => {
        let signer = await ethers.getSigner(borrower)
        await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(8)))
        await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(2)))
        await juniorPool.connect(signer).lockJuniorCapital()
      })

      describe("as the borrower", async () => {
        it("locks the senior tranche", async () => {
          const actor = await ethers.getSigner(borrower)

          const oneDayFromNow = (await time.latest()).add(SECONDS_PER_DAY)

          await expectAction(async () => juniorPool.connect(actor).lockPool()).toChange([
            [async () => bnToBnjs((await juniorPool.getTranche(TRANCHES.Senior)).lockedUntil), {increase: true}],
            [async () => bnToBnjs((await juniorPool.getTranche(TRANCHES.Senior)).principalSharePrice), {unchanged: true}],
            // Limit is total of senior and junior deposits
            [async () => bnToBnjs(await creditLine.limit()), {to: usdcVal(10)}],
          ])

          const seniorLockedUntil = (await juniorPool.getTranche(TRANCHES.Senior)).lockedUntil
          expect(bnToBnjs(seniorLockedUntil)).to.be.bignumber.closeTo(bnToBnjs(oneDayFromNow), new BN(5))
          // Junior is also locked to the same time
          expect(bnToBnjs((await juniorPool.getTranche(TRANCHES.Junior)).lockedUntil)).to.be.bignumber.eq(bnToBnjs(seniorLockedUntil))
        })
      })

      describe("as the owner", async () => {
        it("locks the senior tranche", async () => {
          const actor = await ethers.getSigner(owner)
          const oneDayFromNow = (await time.latest()).add(SECONDS_PER_DAY)

          await expectAction(async () => juniorPool.connect(actor).lockPool()).toChange([
            [async () => bnToBnjs((await juniorPool.getTranche(TRANCHES.Senior)).lockedUntil), {increase: true}],
            [async () => bnToBnjs((await juniorPool.getTranche(TRANCHES.Senior)).principalSharePrice), {unchanged: true}],
            // Limit is total of senior and junior deposits
            [async () => bnToBnjs(await creditLine.limit()), {to: usdcVal(10)}],
          ])
          const seniorLockedUntil = (await juniorPool.getTranche(TRANCHES.Senior)).lockedUntil
          expect(bnToBnjs(seniorLockedUntil)).to.be.bignumber.closeTo(bnToBnjs(oneDayFromNow), new BN(5))
          // Junior is also locked to the same time
          expect(bnToBnjs((await juniorPool.getTranche(TRANCHES.Junior)).lockedUntil)).to.be.bignumber.eq(bnToBnjs(seniorLockedUntil))
        })
      })

      describe("as someone else", async () => {
        it("does not lock", async () => {
          const actor = await ethers.getSigner(otherPerson)
          await expect(juniorPool.connect(actor).lockPool()).to.be.rejectedWith(/Must have locker role/)
        })
      })

      it("does not allow locking twice", async () => {
        const actor = await ethers.getSigner(owner)
        await juniorPool.connect(actor).lockPool()
        await expect(juniorPool.connect(actor).lockPool()).to.be.rejectedWith(/Lock cannot be extended/)
      })
    })
  })

  describe("drawdown", async () => {
    describe("when deposits are over the limit", async () => {
      it("does not adjust the limit up", async () => {
        await juniorPool.deposit(TRANCHES.Junior, bnToHex(limit.mul(new BN(2))))
        await juniorPool.deposit(TRANCHES.Senior, bnToHex(limit.mul(new BN(4))))
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()

        expect(bnToBnjs(await creditLine.limit())).to.bignumber.eq(limit)
      })
    })

    describe("when deposits are under the limit", async () => {
      it("adjusts the limit down", async () => {
        await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(2)))
        await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(8)))
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()

        expect(bnToBnjs(await creditLine.limit())).to.bignumber.eq(usdcVal(10))
        expect(bnToBnjs(await creditLine.limit())).to.bignumber.lt(limit)
      })
    })

    describe("when pool is already locked", async () => {
      beforeEach(async () => {
        await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(2)))
        await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(8)))
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()
      })

      describe("validations", async () => {
        it("does not allow drawing down more than the limit", async () => {
          await expect(juniorPool.drawdown(bnToHex(usdcVal(20)))).to.be.rejectedWith(/Insufficient funds in slice/)
        })

        it("does not allow drawing down 0", async () => {
          await expect(juniorPool.drawdown(bnToHex(usdcVal(0)))).to.be.rejectedWith(/Invalid drawdown amount/)
        })

        it("does not allow drawing down when payments are late", async () => {
          await juniorPool.drawdown(bnToHex(usdcVal(5)))
          await advanceTime({days: paymentPeriodInDays.mul(new BN(3))})
          await expect(juniorPool.drawdown(bnToHex(usdcVal(5)))).to.be.rejectedWith(
            /Cannot drawdown when payments are past due/
          )
        })
      })

      context("locking drawdowns", async () => {
        it("governance can lock and unlock drawdowns", async () => {
          await expect(juniorPool.drawdown(bnToHex(usdcVal(1)))).to.be.fulfilled
          const pauseTxn = await juniorPool.pauseDrawdowns()
          assertNonNullable((await pauseTxn.wait()).logs.filter((l) => l.topics[0] === drawdownsPausedEventHash)[0])
          await expect(juniorPool.drawdown(bnToHex(usdcVal(1)))).to.be.rejectedWith(/Drawdowns are paused/)
          const unpauseTxn = await juniorPool.unpauseDrawdowns()
          assertNonNullable((await unpauseTxn.wait()).logs.filter((l) => l.topics[0] === drawdownsUnpausedEventHash)[0])
          await expect(juniorPool.drawdown(bnToHex(usdcVal(1)))).to.be.fulfilled
        })

        it("only governance can toggle it", async () => {
          let signer = await ethers.getSigner(borrower)
          await expect(juniorPool.connect(signer).pauseDrawdowns()).to.be.rejectedWith(/Must have admin role/)
          await expect(juniorPool.connect(signer).unpauseDrawdowns()).to.be.rejectedWith(/Must have admin role/)
        })
      })

      it("draws down the capital to the borrower", async () => {
        await expectAction(async () => juniorPool.drawdown(bnToHex(usdcVal(10)))).toChange([
          [async () => bnToBnjs(await usdc.balanceOf(borrower)), {by: usdcVal(10)}],
        ])
      })

      it("emits an event", async () => {
        const receipt = await juniorPool.drawdown(bnToHex(usdcVal(10)))
        assertNonNullable((await receipt.wait()).logs.filter((l) => l.topics[0] === drawdownMadeEventHash)[0])
      })

      it("it updates the creditline accounting variables", async () => {
        await expectAction(async () => juniorPool.drawdown(bnToHex(usdcVal(10)))).toChange([
          [async () => bnToBnjs(await creditLine.balance()), {by: usdcVal(10)}],
          [async () => bnToBnjs(await creditLine.lastFullPaymentTime()), {increase: true}],
          [async () => bnToBnjs(await creditLine.nextDueTime()), {increase: true}],
          [async () => bnToBnjs(await creditLine.interestAccruedAsOf()), {increase: true}],
        ])
      })

      it("supports multiple drawdowns", async () => {
        await expectAction(async () => juniorPool.drawdown(bnToHex(usdcVal(7)))).toChange([
          [async () => bnToBnjs(await creditLine.balance()), {by: usdcVal(7)}],
          // [async () => bnToBnjs(await creditLine.lastFullPaymentTime()), {increase: true}],
          // [async () => bnToBnjs(await creditLine.nextDueTime()), {increase: true}],
          [async () => bnToBnjs(await creditLine.interestAccruedAsOf()), {increase: true}],
        ])

        await expectAction(async () => juniorPool.drawdown(bnToHex(usdcVal(3)))).toChange([
          [async () => bnToBnjs(await creditLine.balance()), {by: usdcVal(3)}],
          // [async () => bnToBnjs(await creditLine.lastFullPaymentTime()), {increase: true}],
          // [async () => bnToBnjs(await creditLine.nextDueTime()), {increase: true}],
          // [async () => bnToBnjs(await creditLine.interestAccruedAsOf()), {increase: true}],
        ])
      })

      it("sets the principal share price to be proportional to the amount drawn down", async () => {
        let juniorPrincipalAmount, seniorPrincipalAmount
        ;[, juniorPrincipalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
        ;[, seniorPrincipalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))

        // Before any drawdown, the share price should be 1 to reflect the full amounts deposited
        expect(bnToBnjs(juniorPrincipalAmount)).to.bignumber.eq(usdcVal(2))
        expect(bnToBnjs(seniorPrincipalAmount)).to.bignumber.eq(usdcVal(8))

        await juniorPool.drawdown(bnToHex(usdcVal(5)))
        ;[, juniorPrincipalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
        ;[, seniorPrincipalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))

        expect(bnToBnjs(juniorPrincipalAmount)).to.bignumber.eq(usdcVal(1)) // 50% of 2$
        expect(bnToBnjs(seniorPrincipalAmount)).to.bignumber.eq(usdcVal(4)) // 50% of 8$

        await juniorPool.drawdown(bnToHex(usdcVal(5)))
        ;[, juniorPrincipalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
        ;[, seniorPrincipalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
        expect(bnToBnjs(juniorPrincipalAmount)).to.bignumber.eq(usdcVal(0)) // 0% of 2$
        expect(bnToBnjs(seniorPrincipalAmount)).to.bignumber.eq(usdcVal(0)) // 0% of 8$
      })
    })
  })

  describe("tranching", async () => {
    let juniorPool, creditLine
    beforeEach(async () => {
      // 100$ creditline with 10% interest. Senior tranche gets 8% of the total interest, and junior tranche gets 2%
      interestApr = interestAprAsBN("10.00")
      termInDays = new BN(365)
      ;({juniorPool, creditLine} = await deployJuniorPoolWithNAOSFactoryFixture({
        usdcAddress: usdc.address,
        borrower,
        interestApr,
        termInDays,
        principalGracePeriodInDays,
        limit,
        paymentPeriodInDays,
        fundableAt,
        lateFeeApr,
        id: "JuniorPool",
      }))
      await juniorPool.grantRole(await juniorPool.SENIOR_ROLE(), owner)
    })

    it("calculates share price using term start time", async () => {
      await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(100)))
      let signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()
      await juniorPool.connect(signer).lockPool()

      // Start loan term halfOfTerm days from now
      const halfOfTerm = termInDays.div(new BN(2))
      await advanceTime({days: halfOfTerm.toNumber()})
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))

      // Advance termInDays total days from now
      await advanceTime({days: halfOfTerm.add(new BN(1)).toNumber()})

      const expectedJuniorInterest = (new BN("4438356")).mul(decimalsDelta)
      const expectedProtocolFee = (new BN("493150")).mul(decimalsDelta)
      const expectedTotalInterest = expectedJuniorInterest.add(expectedProtocolFee)

      // TODO: do we approve brfore?
      await erc20Approve(usdc, juniorPool.address, usdcVal(5), [borrower])
      const tx = await juniorPool.connect(signer).pay(bnToHex(usdcVal(5)))
      expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
        interest: expectedTotalInterest,
        principal: usdcVal(5).sub(expectedTotalInterest),
        remaining: new BN(0),
        reserve: expectedProtocolFee,
      })

      const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
      const juniorInterestAmount = await juniorPool.sharePriceToUsdc(
        bnjsToHex(juniorTranche.interestSharePrice),
        bnjsToHex(juniorTranche.principalDeposited)
      )

      // Should be around half of full term's interest, since the drawdown happened 6 months
      // from this payment:
      // ~$4.43 (rather than ~$5, since interest is accrued at last second of prior period)
      const deviation = isDecimal18Env() ? new BN(1000000000000) : new BN(0)

      expect(bnToBnjs(juniorInterestAmount)).to.bignumber.closeTo(expectedJuniorInterest, deviation)
      expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.closeTo(expectedProtocolFee, deviation)
    })

    context("only junior investment", async () => {
      it("still works", async () => {
        await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(100)))
        let signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))

        // Ensure a full term has passed
        await advanceTime({days: termInDays.toNumber()})
        // TODO: do we approve before?
        await erc20Approve(usdc, juniorPool.address, usdcVal(110), [borrower])
        const tx = await juniorPool.connect(signer).pay(bnToHex(usdcVal(110)))
        expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
          interest: usdcVal(10),
          principal: usdcVal(100),
          remaining: new BN(0),
          reserve: usdcVal(1),
        })

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)

        const [juniorInterestAmount, juniorPrincipalAmount] = await getTrancheAmounts(juniorTranche)
        const [seniorInterestAmount, seniorPrincipalAmount] = await getTrancheAmounts(seniorTranche)

        expect(bnToBnjs(seniorInterestAmount)).to.bignumber.eq(new BN(0))
        expect(bnToBnjs(seniorPrincipalAmount)).to.bignumber.eq(new BN(0))
        expect(bnToBnjs(juniorInterestAmount)).to.bignumber.eq(usdcVal(9))
        expect(bnToBnjs(juniorPrincipalAmount)).to.bignumber.eq(usdcVal(100))
        expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq(usdcVal(1))
      })
    })

    context("junior and senior are invested", async () => {
      beforeEach(async () => {
        let signer = await ethers.getSigner(owner)
        usdc.connect(signer).transfer(borrower, bnToHex(usdcVal(15))) // Transfer money for interest payment
        expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq("0")

        await juniorPool.deposit(TRANCHES.Junior, bnToHex(usdcVal(20)))
        await juniorPool.deposit(TRANCHES.Senior, bnToHex(usdcVal(80)))
        signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))
      })

      describe("when full payment is received", async () => {
        it("distributes across senior and junior tranches correctly", async () => {
          // Ensure a full term has passed
          await advanceTime({days: termInDays.toNumber()})

          let signer = await ethers.getSigner(borrower)
          // do we approve before?
          await erc20Approve(usdc, juniorPool.address, usdcVal(10).add(usdcVal(100)), [borrower])
          const tx = await juniorPool.connect(signer).pay(bnToHex(usdcVal(10).add(usdcVal(100))))
          expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
            interest: usdcVal(10),
            principal: usdcVal(100),
            remaining: new BN(0),
            reserve: usdcVal(1),
          })

          expect(bnToBnjs(await creditLine.interestApr())).to.bignumber.eq(interestAprAsBN("10"))

          // 100$ loan, with 10% interest. 80% senior and 20% junior. Junior fee of 20%. Reserve fee of 10%
          // Senior share of interest 8$. Net interest = 8 * (100 - junior fee percent + reserve fee percent) = 5.6
          // Junior share of interest 2$. Net interest = 2 + (8 * junior fee percent) - (2 * reserve fee percent) = 3.4
          // Protocol fee = 1$. Total = 5.6 + 3.4 + 1 = 10
          let interestAmount, principalAmount
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(56).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(80))
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(34).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(20))

          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq(usdcVal(1))
        })

        it("distributes across senior and junior tranches correctly for multiple payments", async () => {
          // Advance to the half way point
          const halfway = SECONDS_PER_DAY.mul(termInDays).div(new BN(2))
          await advanceTime({seconds: halfway.toNumber()})

          // Principal payment should be 0, while interest payment should be slightly less than half. This
          // is because interest is accrued from the most recent nextDueTime rather than the current timestamp.
          // 180.0 / 365 * 10 = 4.93150684931506 (180 because we round to the most recent time in paymentPeriodInDays)
          const interestPayment = (new BN("4931506")).mul(decimalsDelta)
          const expectedProtocolFee = interestPayment.div(new BN(10))
          let signer = await ethers.getSigner(borrower)
          // do we approve before?
          await erc20Approve(usdc, juniorPool.address, interestPayment, [borrower])
          const tx = await juniorPool.connect(signer).pay(bnToHex(interestPayment))
          expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
            interest: interestPayment,
            principal: new BN(0),
            remaining: new BN(0),
            reserve: expectedProtocolFee,
          })

          let seniorInterestAmount, seniorPrincipalAmount, juniorInterestAmount, juniorPrincipalAmount
          ;[seniorInterestAmount, seniorPrincipalAmount] = await getTrancheAmounts(
            await juniorPool.getTranche(TRANCHES.Senior)
          )
          const deviation = isDecimal18Env() ? new BN(10000000000000) : new BN(0)

          expect(bnToBnjs(seniorInterestAmount)).to.bignumber.closeTo((new BN("2761643")).mul(decimalsDelta), deviation)
          expect(bnToBnjs(seniorPrincipalAmount)).to.bignumber.eq(usdcVal(0))
          ;[juniorInterestAmount, juniorPrincipalAmount] = await getTrancheAmounts(
            await juniorPool.getTranche(TRANCHES.Junior)
          )
          expect(bnToBnjs(juniorInterestAmount)).to.bignumber.closeTo((new BN("1676713")).mul(decimalsDelta), deviation)
          expect(bnToBnjs(juniorPrincipalAmount)).to.bignumber.eq(usdcVal(0))

          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.closeTo(expectedProtocolFee, deviation)

          // Now advance to the end of the loan period and collect interest again, now the numbers should match the full
          //amounts in the previous test

          await advanceTime({seconds: halfway.toNumber()})
          // Collect the remaining interest and the principal
          const interestPayment2 = (new BN("5068493")).mul(decimalsDelta)
          const expectedProtocolFee2 = interestPayment2.div(new BN(10))
          await erc20Approve(usdc, juniorPool.address, interestPayment2.add(usdcVal(100)), [borrower])
          const tx2 = await juniorPool.connect(signer).pay(bnToHex(interestPayment2.add(usdcVal(100))))
          expectPaymentRelatedEventsEmitted(await tx2.wait(), borrower, juniorPool, {
            interest: interestPayment2,
            principal: usdcVal(100),
            remaining: new BN(0),
            reserve: expectedProtocolFee2,
          })
          ;[seniorInterestAmount, seniorPrincipalAmount] = await getTrancheAmounts(
            await juniorPool.getTranche(TRANCHES.Senior)
          )
          expect(bnToBnjs(seniorInterestAmount)).to.bignumber.closeTo(usdcVal(56).div(new BN(10)), tolerance)
          expect(bnToBnjs(seniorPrincipalAmount)).to.bignumber.eq(usdcVal(80))
          ;[juniorInterestAmount, juniorPrincipalAmount] = await getTrancheAmounts(
            await juniorPool.getTranche(TRANCHES.Junior)
          )
          expect(bnToBnjs(juniorInterestAmount)).to.bignumber.closeTo(usdcVal(34).div(new BN(10)), tolerance)
          expect(bnToBnjs(juniorPrincipalAmount)).to.bignumber.closeTo(usdcVal(20), deviation)

          const expectedTotalProtocolFee = expectedProtocolFee.add(expectedProtocolFee2)
          expect(usdcVal(1)).to.bignumber.closeTo(expectedTotalProtocolFee, tolerance)
          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.closeTo(expectedTotalProtocolFee, deviation)
        })
      })

      describe("when there is an interest shortfall", async () => {
        it("distributes to the senior tranche first before the junior", async () => {
          // Ensure a full term has passed
          await advanceTime({days: termInDays.toNumber()})

          const interestPayment = usdcVal(6)
          const expectedProtocolFee = interestPayment.div(new BN(10))
          await erc20Approve(usdc, juniorPool.address, interestPayment, [owner])
          const tx = await juniorPool.pay(bnToHex(interestPayment))
          expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
            interest: interestPayment,
            principal: new BN(0),
            remaining: new BN(0),
            reserve: expectedProtocolFee,
          })

          let interestAmount, principalAmount
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
          // Senior interest amount should be 5.6, but we deducted 0.6$ of protocol fee first,
          // so they only received 5.4
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(54).div(new BN(10)))
          // No principal payment until interest is received
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(0))
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(0).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(0))

          // 10% of 6$ of interest collected
          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq(usdcVal(6).div(new BN(10)))

          // Second partial payment. Senior is made whole first and then junior is paid for subsequent interest
          // payments
          const interestPayment2 = usdcVal(3)
          const expectedProtocolFee2 = interestPayment2.div(new BN(10))
          await erc20Approve(usdc, juniorPool.address, interestPayment2, [owner])
          const tx2 = await juniorPool.pay(bnToHex(interestPayment2))
          expectPaymentRelatedEventsEmitted(await tx2.wait(), borrower, juniorPool, {
            interest: interestPayment2,
            principal: new BN(0),
            remaining: new BN(0),
            reserve: expectedProtocolFee2,
          })
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
          // Senior interest filled upto 5.6
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(56).div(new BN(10)))
          // No principal available yet
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(0))
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
          // Should be 3.4$, but we only have 2.5$ available (of 3$, 0.2 went to fill the principal interest, and 0.3 to the fee)
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(25).div(new BN(10)))
          // Still no principal available for the junior
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(0))

          // 0.6$ (from previous interest collection) + 0.3$ => 0.9$
          let expectedTotalProtocolFee = expectedProtocolFee.add(expectedProtocolFee2)
          expect(usdcVal(9).div(new BN(10))).to.bignumber.eq(expectedTotalProtocolFee)
          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq(expectedTotalProtocolFee)

          // Final interest payment and first principal payment. Interest is fully paid, and senior gets all of
          // the principal
          const interestPayment3 = usdcVal(1)
          const expectedProtocolFee3 = interestPayment3.div(new BN(10))
          await erc20Approve(usdc, juniorPool.address, interestPayment3.add(usdcVal(10)), [owner])
          const tx3 = await juniorPool.pay(bnToHex(interestPayment3.add(usdcVal(10))))
          expectPaymentRelatedEventsEmitted(await tx3.wait(), borrower, juniorPool, {
            interest: interestPayment3,
            principal: usdcVal(10),
            remaining: new BN(0),
            reserve: expectedProtocolFee3,
          })
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
          // Interest unchanged, gets the entire principal portion
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(56).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(10))
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
          // Full 3.4 of interest, but no principal yet
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(34).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(0))

          // 1$ of total interest collected
          expectedTotalProtocolFee = expectedTotalProtocolFee.add(expectedProtocolFee3)
          expect(usdcVal(1)).to.bignumber.eq(expectedTotalProtocolFee)
          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq(expectedTotalProtocolFee)

          await erc20Approve(usdc, juniorPool.address, usdcVal(90), [owner])
          const tx4 = await juniorPool.pay(bnToHex(usdcVal(90)))
          expectPaymentRelatedEventsEmitted(await tx4.wait(), borrower, juniorPool, {
            interest: new BN(0),
            principal: usdcVal(90),
            remaining: new BN(0),
            reserve: new BN(0),
          })
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
          // Interest still unchanged, principal is fully paid off
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(56).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(80))
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
          // Interest unchanged, principal also fully paid
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(34).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(20))

          // No additional fees collected (payments were all principal)
          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq(expectedTotalProtocolFee)
        })
      })

      describe("when there is extra interest", async () => {
        // This test is the same as the interest shortfall test, except we'll do it in two payments, and there's an
        // extra 1$ of interest in the last payment
        it("distributes the extra interest solely to the junior", async () => {
          // Ensure a full term has passed
          await advanceTime({days: termInDays.toNumber()})

          const interestPayment = usdcVal(10)
          const expectedProtocolFee = interestPayment.div(new BN(10))
          await erc20Approve(usdc, juniorPool.address, interestPayment.add(usdcVal(99)), [owner])
          const tx = await juniorPool.pay(bnToHex(interestPayment.add(usdcVal(99))))
          expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
            interest: interestPayment,
            principal: usdcVal(99),
            remaining: new BN(0),
            reserve: expectedProtocolFee,
          })

          let interestAmount, principalAmount
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
          // Senior interest and principal fully paid
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(56).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(80))
          // Junior interest fully paid, last 1$ of principal still outstanding
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(34).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(19))

          // Full 1$ protocol fee (10% of 10$ of total interest) collected
          expect(usdcVal(1)).to.bignumber.eq(expectedProtocolFee)
          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq(expectedProtocolFee)

          // 1$ of junior principal remaining, but any additional payment on top of that goes to junior interest
          const interestPayment2 = usdcVal(1)
          const expectedProtocolFee2 = interestPayment2.div(new BN(10))
          await erc20Approve(usdc, juniorPool.address, interestPayment2.add(usdcVal(1)), [owner])
          const tx2 = await juniorPool.pay(bnToHex(interestPayment2.add(usdcVal(1))))
          expectPaymentRelatedEventsEmitted(await tx2.wait(), borrower, juniorPool, {
            interest: new BN(0),
            principal: usdcVal(1),
            remaining: interestPayment2,
            reserve: expectedProtocolFee2,
          })
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
          // Unchanged
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(56).div(new BN(10)))
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(80))
          ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
          // Additional 0.9 of interest (1$ - 10% protocol fee)
          expect(bnToBnjs(interestAmount)).to.bignumber.eq(usdcVal(43).div(new BN(10)))
          // Principal unchanged, we don't expect any new principal back
          expect(bnToBnjs(principalAmount)).to.bignumber.eq(usdcVal(20))

          // Additional 0.1$ of interest collected
          const expectedTotalProtocolFee = expectedProtocolFee.add(expectedProtocolFee2)
          expect(usdcVal(11).div(new BN(10))).to.bignumber.eq(expectedTotalProtocolFee)
          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.eq(expectedTotalProtocolFee)
        })
      })

      describe("early repayments", async () => {
        it("should apply the additional principal payment according to the leverage ratio", async () => {
          // Advance to the half way point
          const halfway = SECONDS_PER_DAY.mul(termInDays).div(new BN(2))
          await advanceTime({seconds: halfway.toNumber()})

          const deviation = isDecimal18Env() ? new BN(10000000000000) : new BN(0)

          // Principal payment should be split by leverage ratio, while interest payment should be slightly less than half. This
          // is because interest is accrued from the most recent nextDueTime rather than the current timestamp.
          const expectedSeniorInterest = (new BN("2761643")).mul(decimalsDelta)
          const expectedJuniorInterest = (new BN("1676713")).mul(decimalsDelta)
          const expectedProtocolFee = (new BN("493150")).mul(decimalsDelta)
          const totalPartialInterest = expectedSeniorInterest.add(expectedJuniorInterest).add(expectedProtocolFee)
          // 180.0 / 365 * 10 = 4.93150684931506 (180 because we round to the most recent time in paymentPeriodInDays)
          expect((totalPartialInterest)).to.bignumber.closeTo((new BN("4931506").mul(decimalsDelta)), deviation)

          let signer = await ethers.getSigner(borrower)
          await erc20Approve(usdc, juniorPool.address, usdcVal(50).add(totalPartialInterest), [borrower])
          const tx = await juniorPool.connect(signer).pay(bnToHex(usdcVal(50).add(totalPartialInterest)))
          expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
            interest: totalPartialInterest,
            principal: usdcVal(50),
            remaining: new BN(0),
            reserve: expectedProtocolFee,
          })

          let seniorInterestAmount, seniorPrincipalAmount, juniorInterestAmount, juniorPrincipalAmount
          ;[seniorInterestAmount, seniorPrincipalAmount] = await getTrancheAmounts(
            await juniorPool.getTranche(TRANCHES.Senior)
          )
          expect(bnToBnjs(seniorInterestAmount)).to.bignumber.closeTo(expectedSeniorInterest, deviation)
          expect(bnToBnjs(seniorPrincipalAmount)).to.bignumber.closeTo(usdcVal(40), deviation)
          ;[juniorInterestAmount, juniorPrincipalAmount] = await getTrancheAmounts(
            await juniorPool.getTranche(TRANCHES.Junior)
          )
          expect(bnToBnjs(juniorInterestAmount)).to.bignumber.closeTo(expectedJuniorInterest, deviation)
          expect(bnToBnjs(juniorPrincipalAmount)).to.bignumber.closeTo(usdcVal(10), deviation)

          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.closeTo(expectedProtocolFee, deviation)

          // Now advance to the end of the loan period and collect interest again. Now the total interest owed should
          // be the interested accrued above * 1.5 (i.e. with a 100$ drawdown and 10% interest, we accrue 5$ for the
          // first 6 months. And since we pay back 50% of principal in the middle, we accrued additional 50% of the 5$,
          // for a total of 7.5$ of interest at the end)

          await advanceTime({seconds: halfway.toNumber()})

          const receipt2 = await juniorPool.assess()
          expectPaymentRelatedEventsNotEmitted(await receipt2.wait())

          // 185.0 / 365 * 5 = 2.5342465753424657 (185 because that's the number of days left in the term for interest to accrue)
          const remainingInterest = (new BN("2534246")).mul(decimalsDelta)
          const expectedProtocolFee2 = remainingInterest.div(new BN(10))
          expect(bnToBnjs(await creditLine.interestOwed())).to.bignumber.closeTo(remainingInterest, deviation)
          expect(bnToBnjs(await creditLine.principalOwed())).to.bignumber.closeTo(usdcVal(50), deviation)

          // Collect the remaining interest and the principal
          await erc20Approve(usdc, juniorPool.address, usdcVal(50).add(remainingInterest), [borrower])
          const tx3 = await juniorPool.connect(signer).pay(bnToHex(usdcVal(50).add(remainingInterest)))
          expectPaymentRelatedEventsEmitted(await tx3.wait(), borrower, juniorPool, {
            interest: remainingInterest,
            principal: usdcVal(50),
            remaining: new BN(0),
            reserve: expectedProtocolFee2,
          })
          ;[seniorInterestAmount, seniorPrincipalAmount] = await getTrancheAmounts(
            await juniorPool.getTranche(TRANCHES.Senior)
          )
          // We would normally expect 7.5$ of total interest (10% interest on 100$ for 182.5 days and 10% interest on
          // 50$ for 182.5 days). But because we round to the nearest nextDueTime in the past, these amounts are slightly
          // less: we collected 10% interest on 100$ for 180 days and 10% interest on 50$ for 185 days. So total
          // interest collected is 7.465753424657534 rather than 7.5

          // Senior = 7.465753424657534 * (leverage ratio of 0.8) * (1- junior fee of 20% - protocol fee of 10%) = 4.18
          expect(bnToBnjs(seniorInterestAmount)).to.bignumber.closeTo(usdcVal(418).div(new BN(100)), tolerance)
          expect(bnToBnjs(seniorPrincipalAmount)).to.bignumber.eq(usdcVal(80))
          ;[juniorInterestAmount, juniorPrincipalAmount] = await getTrancheAmounts(
            await juniorPool.getTranche(TRANCHES.Junior)
          )
          // Junior = 7.465753424657534 - senior interest - 10% protocol fee = 2.5383561643835613
          expect(bnToBnjs(juniorInterestAmount)).to.bignumber.closeTo(usdcVal(2538).div(new BN(1000)), tolerance)
          expect(bnToBnjs(juniorPrincipalAmount)).to.bignumber.closeTo(usdcVal(20), deviation)

          // Total protocol fee should be 10% of total interest
          const expectedTotalProtocolFee = expectedProtocolFee.add(expectedProtocolFee2)
          const totalInterest = totalPartialInterest.add(remainingInterest)
          expect(totalInterest.div(new BN(10))).to.bignumber.closeTo(expectedTotalProtocolFee, tolerance)
          expect(bnToBnjs(await usdc.balanceOf(treasury))).to.bignumber.closeTo(expectedTotalProtocolFee, deviation)
        })
      })

      // describe("Calls BackerRewards", () => {
      //   it("Updates accRewardsPerPrincipalDollar", async () => {
      //     // Ensure a full term has passed
      //     await advanceTime({days: termInDays.toNumber()})
      //     let accRewardsPerPrincipalDollar = await backerRewards.pools(juniorPool.address)
      //     expect(accRewardsPerPrincipalDollar).to.bignumber.equal(new BN(0))

      //     const receipt = await juniorPool.pay(usdcVal(10).add(usdcVal(100)), {from: borrower})
      //     expectPaymentRelatedEventsEmitted(receipt, borrower, juniorPool, {
      //       interest: usdcVal(10),
      //       principal: usdcVal(100),
      //       remaining: new BN(0),
      //       reserve: usdcVal(1),
      //     })

      //     expect(await creditLine.interestApr()).to.bignumber.eq(interestAprAsBN("10"))

      //     // 100$ loan, with 10% interest. 80% senior and 20% junior. Junior fee of 20%. Reserve fee of 10%
      //     // Senior share of interest 8$. Net interest = 8 * (100 - junior fee percent + reserve fee percent) = 5.6
      //     // Junior share of interest 2$. Net interest = 2 + (8 * junior fee percent) - (2 * reserve fee percent) = 3.4
      //     // Protocol fee = 1$. Total = 5.6 + 3.4 + 1 = 10
      //     let interestAmount, principalAmount
      //     ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Senior))
      //     expect(interestAmount).to.bignumber.eq(usdcVal(56).div(new BN(10)))
      //     expect(principalAmount).to.bignumber.eq(usdcVal(80))
      //     ;[interestAmount, principalAmount] = await getTrancheAmounts(await juniorPool.getTranche(TRANCHES.Junior))
      //     expect(interestAmount).to.bignumber.eq(usdcVal(34).div(new BN(10)))
      //     expect(principalAmount).to.bignumber.eq(usdcVal(20))

      //     expect(await usdc.balanceOf(treasury)).to.bignumber.eq(usdcVal(1))

      //     // accRewardsPerPrincipalDollar = await backerRewards.pools(juniorPool.address)
      //     // expect(accRewardsPerPrincipalDollar).to.not.equal(new BN(0))
      //   })
      // })
    })
  })

  describe("multiple drawdowns", async () => {
    // Reference: https://docs.google.com/spreadsheets/d/1d1rJ1vMhQ1-fdW9YhMPJKWrhylp6rXQ8dakDe4pN0RY/edit#gid=0

    let juniorPool: JuniorPool, creditLine: CreditLine
    beforeEach(async () => {
      interestApr = interestAprAsBN("10.00")
      termInDays = new BN(365)
      ;({juniorPool, creditLine} = await deployJuniorPoolWithNAOSFactoryFixture({
        usdcAddress: usdc.address,
        borrower,
        interestApr,
        termInDays,
        principalGracePeriodInDays,
        limit,
        paymentPeriodInDays,
        fundableAt,
        lateFeeApr,
        id: "JuniorPool",
      }))
      await juniorPool.grantRole(await juniorPool.SENIOR_ROLE(), owner)
    })

    async function depositAndGetTokenId(pool: JuniorPool, tranche, value): Promise<BN> {
      const tx = await pool.deposit(tranche, bnToHex(value))
      const receipt = await tx.wait()
      const log = receipt.logs.filter((l) => l.address.toLowerCase() === pool.address.toLowerCase())[0]
      return new BN(log.topics[log.topics.length - 1].substr(2), 16)
    }

    async function investAndGetTokenId(pool: JuniorPool): Promise<BN> {
      const tx = await indexPool.invest(pool.address)
      const receipt = await tx.wait()
      const log = receipt.logs.filter((l) => l.address.toLowerCase() === pool.address.toLowerCase())[0]
      return new BN(log.topics[log.topics.length - 1].substr(2), 16)
    }

    async function expectAvailable(tokenId: BN, expectedInterestInUSD: string, expectedPrincipalInUSD: string) {
      const {"0": actualInterest, "1": actualPrincipal} = await juniorPool.availableToWithdraw(bnToHex(tokenId))
      const de = isDecimal18Env() ? new BNJS(DAI_DECIMALS.toString()) : new BNJS(USDC_DECIMALS.toString())
      expect(bnToBnjs(actualInterest)).to.bignumber.closeTo(((new BNJS(parseFloat(expectedInterestInUSD)).multipliedBy(de)).toString()), HALF_CENT)
      expect(bnToBnjs(actualPrincipal)).to.bignumber.closeTo((new BNJS(parseFloat(expectedPrincipalInUSD)).multipliedBy(de)).toString(), HALF_CENT)
    }

    describe("initializeNextSlice", async () => {
      it("creates a new slice", async () => {
        let signer = await ethers.getSigner(borrower)
        const firstSliceJunior = await depositAndGetTokenId(juniorPool, "2", usdcVal(20))
        await juniorPool.connect(signer).lockJuniorCapital()
        const firstSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()

        expect((await poolTokens.getTokenInfo(bnToHex(firstSliceJunior))).tranche.toString()).to.eq(TRANCHES.Junior.toString())
        expect((await poolTokens.getTokenInfo(bnToHex(firstSliceSenior))).tranche.toString()).to.eq(TRANCHES.Senior.toString())

        await expectAction(async () => juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))).toChange([
          [async () => bnToBnjs(await juniorPool.numSlices()), {to: new BN(2)}],
        ])

        const secondSliceJunior = await depositAndGetTokenId(juniorPool, "4", usdcVal(20))
        await juniorPool.connect(signer).lockJuniorCapital()
        const secondSliceSenior = await investAndGetTokenId(juniorPool) // stop here
        expect((await poolTokens.getTokenInfo(bnToHex(secondSliceJunior))).tranche.toString()).to.eq("4")
        expect((await poolTokens.getTokenInfo(bnToHex(secondSliceSenior))).tranche.toString()).to.eq("3")

        const secondSliceJuniorInfo = await juniorPool.getTranche("4")
        const secondSliceSeniorInfo = await juniorPool.getTranche("3")
        expect(bnToBnjs(secondSliceJuniorInfo.id)).to.bignumber.eq("4")
        expect(bnToBnjs(secondSliceJuniorInfo.principalDeposited)).to.bignumber.eq(usdcVal(20))
        expect(bnToBnjs(secondSliceSeniorInfo.id)).to.bignumber.eq("3")
        expect(bnToBnjs(secondSliceSeniorInfo.principalDeposited)).to.bignumber.eq(usdcVal(80))
      })

      it("does not allow creating a slice when current slice is still active", async () => {
        let signer = await ethers.getSigner(borrower)
        await expect(juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))).to.be.rejectedWith(
          /Current slice still active/
        )

        await juniorPool.connect(signer).lockJuniorCapital()

        // Senior must also be locked
        await expect(juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))).to.be.rejectedWith(
          /Current slice still active/
        )

        await juniorPool.connect(signer).lockPool()

        await expect(juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))).to.not.be.rejected
      })

      it("does not allow creating a slice when borrower is late", async () => {
        let signer = await ethers.getSigner(borrower)
        await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(20))
        await juniorPool.connect(signer).lockJuniorCapital()
        await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()

        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))

        // Advance half way through
        const halfOfTerm = termInDays.div(new BN(2))
        await advanceTime({days: halfOfTerm.toNumber() + 1})

        await juniorPool.assess()
        await expect(juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))).to.be.rejectedWith(
          /Creditline is late/
        )
      })

      it("does not allow depositing before the fundableAt", async () => {
        let signer = await ethers.getSigner(borrower)
        await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(20))
        await juniorPool.connect(signer).lockJuniorCapital()
        await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))

        // one day in the future
        const newFundableAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await juniorPool.connect(signer).initializeNextSlice(bnToHex(newFundableAt))
        await expect(juniorPool.deposit("3", bnToHex(usdcVal(10)))).to.be.rejectedWith(/Not open for funding/)

        // advance 2 days, and it should work
        await advanceTime({days: 2})
        await expect(juniorPool.deposit("3", bnToHex(usdcVal(10)))).to.be.fulfilled
      })

      it("does not allow creating a slice beyond the principal graceperiod", async () => {
        let signer = await ethers.getSigner(borrower)
        await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(20))
        await juniorPool.connect(signer).lockJuniorCapital()
        await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))

        // Go through 1 payment period and pay everything off we will be current on payments
        await advanceTime({days: paymentPeriodInDays.add(new BN(2))})
        await erc20Approve(usdc, juniorPool.address, usdcVal(101), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(101)))

        // Advance most of the way through
        await advanceTime({days: termInDays.toNumber() - 30})
        await hre.ethers.provider.send("evm_mine", [])

        expect(await creditLine.withinPrincipalGracePeriod()).to.be.false
        await expect(juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))).to.be.rejectedWith(
          /Beyond principal grace period/
        )
      })

      it("does not allow creating more than 5 slices", async () => {
        let signer = await ethers.getSigner(borrower)
        for (let i = 0; i < 4; i++) {
          await juniorPool.connect(signer).lockJuniorCapital()
          await juniorPool.connect(signer).lockPool()
          await juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))
        }
        await juniorPool.connect(signer).lockJuniorCapital()
        await juniorPool.connect(signer).lockPool()

        await expect(juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))).to.be.rejectedWith(
          /Cannot exceed 5 slices/
        )
      })
    })

    it("does not allow payments when pool is unlocked", async () => {
      let signer = await ethers.getSigner(borrower)
      await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(20))
      await juniorPool.connect(signer).lockJuniorCapital()
      await investAndGetTokenId(juniorPool)
      await juniorPool.connect(signer).lockPool()

      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))
      await juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))
      await advanceTime({days: termInDays.div(new BN(2))})

      await erc20Approve(usdc, juniorPool.address, usdcVal(100), [borrower])
      await expect(juniorPool.connect(signer).pay(bnToHex(usdcVal(100)))).to.be.rejectedWith(/Pool is not locked/)
    })

    it("distributes interest correctly across different drawdowns", async () => {
      let signer = await ethers.getSigner(borrower)
      const firstSliceJunior = await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(20))
      await juniorPool.connect(signer).lockJuniorCapital()
      const firstSliceSenior = await investAndGetTokenId(juniorPool) // stop here
      await juniorPool.connect(signer).lockPool()

      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))

      // Advance half way through, and pay back interest owed.
      const halfOfTerm = termInDays.div(new BN(2))
      await advanceTime({days: halfOfTerm.toNumber() + 1})

      const expectedNetInterest = (new BN("4438356")).mul(decimalsDelta)
      const expectedProtocolFee = (new BN("493150")).mul(decimalsDelta)
      const expectedExcessPrincipal = (new BN(68494)).mul(decimalsDelta)
      const expectedTotalInterest = expectedNetInterest.add(expectedProtocolFee)

      await erc20Approve(usdc, juniorPool.address, usdcVal(5), [borrower])
      const tx = await juniorPool.connect(signer).pay(bnToHex(usdcVal(5)))
      expectPaymentRelatedEventsEmitted(await tx.wait(), borrower, juniorPool, {
        interest: expectedTotalInterest,
        principal: expectedExcessPrincipal,
        remaining: new BN(0),
        reserve: expectedProtocolFee,
      })
      await expectAvailable(firstSliceJunior, "1.675", "0.01")
      await expectAvailable(firstSliceSenior, "2.76", "0.05")

      await juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))
      const secondSliceJunior = await depositAndGetTokenId(juniorPool, 4, usdcVal(60))
      await juniorPool.connect(signer).lockJuniorCapital()
      const secondSliceSenior = await investAndGetTokenId(juniorPool)
      await juniorPool.connect(signer).lockPool()

      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(300)))

      await advanceTime({days: halfOfTerm.toNumber() + 1})
      await hre.ethers.provider.send("evm_mine", [])

      // Available to withdraw for initial depositors should not change
      await expectAvailable(firstSliceJunior, "1.675", "0.01")
      await expectAvailable(firstSliceSenior, "2.76", "0.05")

      await erc20Approve(usdc, juniorPool.address, usdcVal(420), [borrower])
      const secondReceipt = await juniorPool.connect(signer).pay(bnToHex(usdcVal(420)))
      // const paymentEvent = decodeAndGetFirstLog<PaymentApplied>(
      //   secondReceipt.receipt.rawLogs,
      //   juniorPool,
      //   "PaymentApplied"
      // )
      // const expectedInterest = new BN(20023919)
      // const expectedReserve = new BN(2006847)
      // const expectedRemaining = new BN(44575)
      // expect(paymentEvent.args.interestAmount).to.bignumber.closeTo(expectedInterest, HALF_CENT)
      // expect(paymentEvent.args.principalAmount).to.bignumber.closeTo(
      //   usdcVal(400).sub(expectedExcessPrincipal),
      //   HALF_CENT
      // )
      // expect(paymentEvent.args.remainingAmount).to.bignumber.closeTo(expectedRemaining, HALF_CENT)
      // expect(paymentEvent.args.reserveAmount).to.bignumber.closeTo(expectedReserve, HALF_CENT)

      // const sharePriceEvents = decodeLogs<SharePriceUpdated>(
      //   secondReceipt.receipt.rawLogs,
      //   juniorPool,
      //   "SharePriceUpdated"
      // )
      // expect(sharePriceEvents.length).to.eq(4)
      // const tranches = sharePriceEvents.map((e) => e.args.tranche.toString()).sort()
      // expect(tranches).to.deep.eq(["1", "2", "3", "4"]) // Every tranche should have an share price update event

      expect(bnToBnjs(await creditLine.balance())).to.bignumber.eq("0")

      // The interest is a little bit different from the the spreadsheet model because payment period interest calculation
      // rounding. Because of that we pay off some of the principal in the first payment which changes the interest owed
      // the rest of term
      await expectAvailable(firstSliceJunior, "3.400", "20.00")
      await expectAvailable(firstSliceSenior, "5.553", "80.00")
      await expectAvailable(secondSliceJunior, "5.171", "60.00")
      await expectAvailable(secondSliceSenior, "8.375", "240.00")
    })

    describe("when there is a shortfall", async () => {
      it("distributes the payment across all senior tranches first before junior", async () => {
        let signer = await ethers.getSigner(borrower)
        const firstSliceJunior = await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(20))
        await juniorPool.connect(signer).lockJuniorCapital()
        const firstSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()

        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))

        // Advance half way through, and pay back what's owed. Then
        const halfOfTerm = termInDays.div(new BN(2))
        await advanceTime({days: halfOfTerm.toNumber() + 1})

        await erc20Approve(usdc, juniorPool.address, usdcVal(5), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(5)))
        await expectAvailable(firstSliceJunior, "1.675", "0.01")
        await expectAvailable(firstSliceSenior, "2.76", "0.05")

        await juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))

        const secondSliceJunior = await depositAndGetTokenId(juniorPool, 4, usdcVal(60))
        await juniorPool.connect(signer).lockJuniorCapital()
        const secondSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(300)))

        await advanceTime({days: halfOfTerm.toNumber() + 1})
        await hre.ethers.provider.send("evm_mine", [])

        // Pay 10$ of interest. This should go entirely to both senior tranche's interest
        await erc20Approve(usdc, juniorPool.address, usdcVal(10), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(10)))

        // First slice: Junior is unchanged. Senior receives it's share of interest
        await expectAvailable(firstSliceJunior, "1.675", "0.01")
        await expectAvailable(firstSliceSenior, "5.011", "0.05")
        // Second slice: Junior doesn't receive anything yet. Senior receives it's share of interest. No principal yet
        await expectAvailable(secondSliceJunior, "0", "0")
        await expectAvailable(secondSliceSenior, "6.75", "0")

        // Pay remaining interest and partial interest payment
        await erc20Approve(usdc, juniorPool.address, usdcVal(110), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(110)))
        // First slice: Junior receives remaining interest, no principal. Senior receives it's share of principal
        await expectAvailable(firstSliceJunior, "3.390", "0.01")
        await expectAvailable(firstSliceSenior, "5.553", "25.04")

        // Second slice: Junior receives remaining interest, no principal. Senior receives it's share of principal
        await expectAvailable(secondSliceJunior, "5.140", "0")
        await expectAvailable(secondSliceSenior, "8.375", "74.99")

        // pay off remaining
        await erc20Approve(usdc, juniorPool.address, usdcVal(300), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(300)))
        expect(bnToBnjs(await creditLine.balance())).to.bignumber.eq("0")
        // Everyone made whole
        await expectAvailable(firstSliceJunior, "3.399", "20.00")
        await expectAvailable(firstSliceSenior, "5.553", "80.00")
        await expectAvailable(secondSliceJunior, "5.171", "60.00")
        await expectAvailable(secondSliceSenior, "8.375", "240.00")
      }).timeout(TEST_TIMEOUT)
    })

    describe("when the principal was drawn down disproportionately", async () => {
      it("distributes interest according to ratio of principal deployed", async () => {
        let signer = await ethers.getSigner(borrower)
        const firstSliceJunior = await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(40))
        await juniorPool.connect(signer).lockJuniorCapital()
        const firstSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()

        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))

        // Advance half way through, and pay back what's owed. Then
        const halfOfTerm = termInDays.div(new BN(2))
        await advanceTime({days: halfOfTerm.toNumber() + 1})

        await erc20Approve(usdc, juniorPool.address, usdcVal(5), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(5)))
        await expectAvailable(firstSliceJunior, "1.675", "20.01")
        await expectAvailable(firstSliceSenior, "2.76", "80.05")

        await juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))
        const secondSliceJunior = await depositAndGetTokenId(juniorPool, 4, usdcVal(60))
        await juniorPool.connect(signer).lockJuniorCapital()
        const secondSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()

        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(300)))

        await advanceTime({days: halfOfTerm.toNumber() + 1})
        await hre.ethers.provider.send("evm_mine", [])

        // Available to withdraw for initial depositors should not change
        await expectAvailable(firstSliceJunior, "1.675", "20.01")
        await expectAvailable(firstSliceSenior, "2.76", "80.05")

        await erc20Approve(usdc, juniorPool.address, usdcVal(420), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(420)))
        expect(bnToBnjs(await creditLine.balance())).to.bignumber.eq("0")

        await expectAvailable(firstSliceJunior, "3.399", "40.00")
        await expectAvailable(firstSliceSenior, "5.553", "160.00")
        await expectAvailable(secondSliceJunior, "5.171", "60.00")
        await expectAvailable(secondSliceSenior, "8.375", "240.00")
      })
    })

    describe("full term of the loan", async () => {
      it("distributes interest and principal correctly", async () => {
        let signer = await ethers.getSigner(borrower)
        const firstSliceJunior = await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(40))
        await juniorPool.connect(signer).lockJuniorCapital()
        const firstSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))
        await juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))
        const secondSliceJunior = await depositAndGetTokenId(juniorPool, 4, usdcVal(60))
        await juniorPool.connect(signer).lockJuniorCapital()
        const secondSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()

        // The spreadsheet assumed 300, but for half the term, since this is going to be for the full term, drawdown
        // half the amount so the same amount of interest will be owed.
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(150)))

        await advanceTime({days: termInDays.toNumber() + 1})
        await hre.ethers.provider.send("evm_mine", [])

        await erc20Approve(usdc, juniorPool.address, usdcVal(275), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(275)))
        expect(bnToBnjs(await creditLine.balance())).to.bignumber.eq("0")

        // Exactly matches the interest and principal owed for each tranche from the spreadsheet
        await expectAvailable(firstSliceJunior, "3.4", "40.00")
        await expectAvailable(firstSliceSenior, "5.6", "160.00")
        await expectAvailable(secondSliceJunior, "5.1", "60.00")
        await expectAvailable(secondSliceSenior, "8.4", "240.00")
      })

      it("distributes all excess payments to the junoir tranches only", async () => {
        let signer = await ethers.getSigner(borrower)
        const firstSliceJunior = await depositAndGetTokenId(juniorPool, TRANCHES.Junior, usdcVal(40))
        await juniorPool.connect(signer).lockJuniorCapital()
        const firstSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))
        await juniorPool.connect(signer).initializeNextSlice(bnToHex(fundableAt))
        const secondSliceJunior = await depositAndGetTokenId(juniorPool, 4, usdcVal(60))
        await juniorPool.connect(signer).lockJuniorCapital()
        const secondSliceSenior = await investAndGetTokenId(juniorPool)
        await juniorPool.connect(signer).lockPool()

        // The spreadsheet assumed 300, but for half the term, since this is going to be for the full term, drawdown
        // half the amount so the same amount of interest will be owed.
        await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(150)))

        await advanceTime({days: termInDays.toNumber() + 1})
        await hre.ethers.provider.send("evm_mine", [])

        await erc20Approve(usdc, juniorPool.address, usdcVal(280), [borrower])
        await juniorPool.connect(signer).pay(bnToHex(usdcVal(280)))
        expect(bnToBnjs(await creditLine.balance())).to.bignumber.eq("0")

        // Excess interest is given to the junior tranches in proportion to principal deployed
        // 5$ of excess interest => 4.5 after fees. 100/(100+150) * 4.5 = 1.8 additional to first slice
        // And 150/(100+150) * 4.5 = 2.7 additional to the second slice junior. Senior tranches unchanged
        await expectAvailable(firstSliceJunior, "5.2", "40.00")
        await expectAvailable(firstSliceSenior, "5.6", "160.00")
        await expectAvailable(secondSliceJunior, "7.8", "60.00")
        await expectAvailable(secondSliceSenior, "8.4", "240.00")
      })
    })
  })
})
