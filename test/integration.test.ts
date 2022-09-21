import hre from "hardhat"
const {deployments, web3, artifacts, ethers} = hre
import {
  expect,
  BN,
  usdcVal,
  getBalance,
  erc20Approve,
  erc20Transfer,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  usdcToRWA,
  expectAction,
  rwaToUSDC,
  advanceTime,
  Numberish,
  bigVal,
  bnToHex
} from "./testHelpers"
import {CONFIG_KEYS} from "../scripts/blockchain_scripts/configKeys"
import {TRANCHES, interestAprAsBN, INTEREST_DECIMALS, ETHDecimals, MAX_UINT, isDecimal18Env} from "../scripts/blockchain_scripts/deployHelpers"
import {time} from "@openzeppelin/test-helpers"
import {deployBaseFixture} from "./util/fixtures"
// import {GFIInstance, StakingRewardsInstance} from "../typechain/truffle"
// import {STAKING_REWARDS_PARAMS} from "../scripts/blockchain_scripts/migrations/v2.2/deploy"
const JuniorPool = artifacts.require("JuniorPool")
const CreditLine = artifacts.require("CreditLine")

// eslint-disable-next-line no-unused-vars
let accounts, owner, underwriter, borrower, investor1, investor2
let rwa, naosConfig, reserve, usdc, indexPool, creditLine, juniorPool, naosFactory, poolTokens

const ONE_HUNDRED = new BN(100)

const TEST_TIMEOUT = 60000

describe("NAOS", async function () {
  this.timeout(TEST_TIMEOUT)

  let limit = usdcVal(10000)
  let interestApr = interestAprAsBN("25")
  let lateFeeApr = interestAprAsBN("0")
  const juniorFeePercent = new BN(20)
  const allowedUIDTypes = [0]
  let paymentPeriodInDays = new BN(1)
  let termInDays = new BN(365)
  const principalGracePeriod = new BN(185)
  const fundableAt = new BN(0)
  let paymentPeriodInSeconds = SECONDS_PER_DAY.mul(paymentPeriodInDays)

  const setupTest = deployments.createFixture(async ({deployments}) => {
    const {indexPool, usdc, rwa, naosConfig, naosFactory, poolTokens, naos} =
      await deployBaseFixture()

    // Approve transfers for our test accounts
    await erc20Approve(usdc, indexPool.address, usdcVal(100000), [owner, underwriter, borrower, investor1, investor2])
    // Some housekeeping so we have a usable creditDesk for tests, and a indexPool with funds
    await erc20Transfer(usdc, [underwriter, investor1, investor2], usdcVal(100000), owner)
    // Add all web3 accounts to the GoList
    await naosConfig.bulkAddToGoList(accounts)

    const naosToLoadIntoStakingRewards = bigVal(1_000_000)
    // await naos.mint(owner, naosToLoadIntoStakingRewards)
    // await erc20Approve(naos, stakingRewards.address, MAX_UINT, [owner])
    // await erc20Approve(usdc, stakingRewards.address, MAX_UINT, [owner])
    // await stakingRewards.loadRewards(naosToLoadIntoStakingRewards)
    // await stakingRewards.setRewardsParameters(
    //   STAKING_REWARDS_PARAMS.targetCapacity.toString(),
    //   STAKING_REWARDS_PARAMS.minRate.toString(),
    //   STAKING_REWARDS_PARAMS.maxRate.toString(),
    //   STAKING_REWARDS_PARAMS.minRateAtPercent.toString(),
    //   STAKING_REWARDS_PARAMS.maxRateAtPercent.toString()
    // )
    // await stakingRewards.depositAndStake(usdcVal(5000), {from: owner})
    // await stakingRewards.kick(0)
    let underwriter_signer = await ethers.getSigner(underwriter as string);
    await indexPool.connect(underwriter_signer).deposit(String(usdcVal(10000)));
    // await indexPool.deposit(String(usdcVal(10000)), {from: underwriter})
    // Set the reserve to a separate address for easier separation. The current owner account gets used for many things in tests.
    await naosConfig.setTreasuryReserve(reserve)
    return {indexPool, usdc, rwa, naosConfig, naosFactory, poolTokens, naos}
  })

  beforeEach(async () => {
    accounts = await web3.eth.getAccounts()
    ;[owner, underwriter, borrower, investor1, investor2, reserve] = accounts
    ;({usdc, indexPool, rwa, naosConfig, naosFactory, poolTokens} = await setupTest())
  })

  describe("functional test", async () => {
    async function assertCreditLine(
      balance,
      interestOwed,
      collectedPayment,
      nextDueTime,
      interestAccruedAsOf,
      lastFullPaymentTime
    ) {
      expect(await creditLine.balance()).to.bignumber.equal(balance)
      expect(await creditLine.interestOwed()).to.bignumber.equal(interestOwed)
      expect(await creditLine.principalOwed()).to.bignumber.equal("0") // Principal owed is always 0
      expect(await getBalance(creditLine.address, usdc)).to.bignumber.equal(collectedPayment)
      expect(await creditLine.nextDueTime()).to.bignumber.equal(new BN(nextDueTime))
      expect(await creditLine.interestAccruedAsOf()).to.bignumber.equal(new BN(interestAccruedAsOf))
      expect(await creditLine.lastFullPaymentTime()).to.bignumber.equal(new BN(lastFullPaymentTime))
    }

    async function createJuniorPool({
      _paymentPeriodInDays,
      _borrower,
      _limit,
      _interestApr,
      _termInDays,
      _lateFeesApr,
      _allowedUIDTypes,
    }: {
      _paymentPeriodInDays?: Numberish
      _borrower?: string
      _limit?: Numberish
      _interestApr?: Numberish
      _termInDays?: Numberish
      _lateFeesApr?: Numberish
      _allowedUIDTypes?: Array<Numberish>
    } = {}) {
      let owner_signer = await ethers.getSigner(owner as string)
      let result = await naosFactory.connect(owner_signer).createPool(
        borrower || _borrower,
        bnToHex(juniorFeePercent),
        bnToHex(limit) || _limit,
        bnToHex(interestApr) || _interestApr,
        _paymentPeriodInDays || bnToHex(paymentPeriodInDays),
        bnToHex(termInDays) || _termInDays,
        bnToHex(lateFeeApr) || _lateFeesApr,
        bnToHex(principalGracePeriod),
        bnToHex(fundableAt),
        allowedUIDTypes || _allowedUIDTypes
      )
      result = await result.wait();
      const poolCreatedEvent = result.logs[result.logs.length - 1]
      // keccack256(PoolCreated(address,address))
      expect(poolCreatedEvent.topics[0]).to.eq("0x4f2ce4e40f623ca765fc0167a25cb7842ceaafb8d82d3dec26ca0d0e0d2d4896")
      juniorPool = await JuniorPool.at(`0x${poolCreatedEvent.topics[1].slice(-40)}`)
      creditLine = await CreditLine.at(await juniorPool.creditLine())
      await erc20Approve(usdc, juniorPool.address, usdcVal(100000), [owner, borrower, investor1, investor2])
      return juniorPool
    }

    async function depositToSeniorPool(amount, investor?) {
      investor = investor || investor1
      let investor_signer = await ethers.getSigner(investor as string)
      await indexPool.connect(investor_signer).deposit(amount)
    }

    async function depositToPool(pool, amount, investor?, tranche?) {
      investor = investor || investor1
      tranche = tranche || TRANCHES.Junior
      await pool.deposit(tranche, amount, {from: investor})
    }

    async function lockAndLeveragePool(pool) {
      await pool.lockJuniorCapital({from: borrower})
      await indexPool.invest(pool.address)
    }

    async function drawdown(pool, amount, _borrower?) {
      _borrower = _borrower || borrower
      await pool.drawdown(bnToHex(amount), {from: _borrower})
    }

    async function makePayment(pool, amount, _borrower?) {
      _borrower = _borrower || borrower
      // let borrower_signer = await ethers.getSigner(_borrower as string)
      // await pool.connect(borrower_signer).pay(amount)
      await pool.pay(amount, {from: _borrower})
    }

    function getPercent(number, percent) {
      return number.mul(percent).div(ONE_HUNDRED)
    }

    async function calculateInterest(pool, cl, timeInDays, tranche) {
      const numSeconds = timeInDays.mul(SECONDS_PER_DAY)
      const totalInterestPerYear = (await cl.balance()).mul(await cl.interestApr()).div(INTEREST_DECIMALS)
      const totalExpectedInterest = totalInterestPerYear.mul(numSeconds).div(SECONDS_PER_YEAR)
      if (tranche === null) {
        return totalExpectedInterest
      }
      // To get the senior interest, first we need to scale by levarage ratio
      const juniorTotal = new BN((await pool.getTranche(TRANCHES.Junior)).principalDeposited)
      const seniorTotal = new BN((await pool.getTranche(TRANCHES.Senior)).principalDeposited)
      const seniorLeveragePercent = ONE_HUNDRED.mul(seniorTotal).div(seniorTotal.add(juniorTotal))
      // const reserveFeePercent = ONE_HUNDRED.div(await naosConfig.getNumber(CONFIG_KEYS.ReserveDenominator))
      const reserveFeePercent = ONE_HUNDRED.div(new BN(10))
      const seniorInterest = totalExpectedInterest.mul(seniorLeveragePercent).div(ONE_HUNDRED)

      if (tranche === TRANCHES.Senior) {
        const seniorFractionNetFees = ONE_HUNDRED.sub(reserveFeePercent).sub(juniorFeePercent)
        return getPercent(seniorInterest, seniorFractionNetFees)
      } else if (tranche === TRANCHES.Junior) {
        const juniorLeveragePercent = ONE_HUNDRED.mul(juniorTotal).div(seniorTotal.add(juniorTotal))
        let juniorInterest = getPercent(totalExpectedInterest, juniorLeveragePercent)
        // Subtract fees
        juniorInterest = getPercent(juniorInterest, ONE_HUNDRED.sub(reserveFeePercent))
        // Add junior fee
        const juniorFee = getPercent(seniorInterest, juniorFeePercent)
        return juniorInterest.add(juniorFee)
      }
    }

    async function getPoolTokenFor(owner, index?) {
      return poolTokens.tokenOfOwnerByIndex(owner, index || 0)
    }

    async function assessPool(pool) {
      await pool.assess()
      const tokenId = await getPoolTokenFor(indexPool.address)
      await indexPool.redeem(tokenId)
      await indexPool.writedown(tokenId)
    }

    async function afterWithdrawalFees(grossAmount) {
      // const feeDenominator = await naosConfig.getNumber(CONFIG_KEYS.WithdrawFeeDenominator)
      return grossAmount.sub(grossAmount.div(new BN(200)))
    }

    async function withdrawFromSeniorPool(usdcAmount, investor?) {
      investor = investor || investor1
      if (usdcAmount === "max") {
        const numShares = await getBalance(investor, rwa)
        const maxAmount = (await indexPool.sharePrice()).mul(numShares)
        usdcAmount = rwaToUSDC(maxAmount.div(ETHDecimals))
      }
      let investor_signer = await ethers.getSigner(investor as string)
      return indexPool.connect(investor_signer).withdraw(usdcAmount)
      // return indexPool.withdraw(usdcAmount, {from: investor})
    }

    async function withdrawFromSeniorPoolInRWA(rwaAmount, investor) {
      let investor_signer = await ethers.getSigner(investor as string)
      return indexPool.connect(investor_signer).withdrawInRWA(rwaAmount)
      // return indexPool.withdrawInRWA(rwaAmount, {from: investor})
    }

    async function withdrawFromPool(pool, usdcAmount, investor?) {
      investor = investor || investor1
      const tokenId = await getPoolTokenFor(investor)
      if (usdcAmount === "max") {
        let investor_signer = await ethers.getSigner(investor as string)
        return pool.connect(investor_signer).withdrawMax(tokenId)
        // return pool.withdrawMax(tokenId, {from: investor})
      } else {
        let investor_signer = await ethers.getSigner(investor as string)
        return pool.connect(investor_signer).withdraw(tokenId, usdcAmount)
        // return pool.withdraw(tokenId, usdcAmount, {from: investor})
      }
    }

    describe("scenarios", async () => {
      it("should accrue interest with multiple investors", async () => {
        const amount = usdcVal(10000)
        const juniorAmount = usdcVal(1000)
        const drawdownAmount = amount.div(new BN(10))
        const paymentPeriodInDays = new BN(15)
        juniorPool = await createJuniorPool({_paymentPeriodInDays: bnToHex(paymentPeriodInDays)})
        await depositToSeniorPool(bnToHex(amount))
        await depositToSeniorPool(bnToHex(amount), investor2)
        await depositToPool(juniorPool, bnToHex(juniorAmount))
        await depositToPool(juniorPool, bnToHex(juniorAmount), investor2)
        // await expectAction(async () => {
        //   await depositToSeniorPool(amount)
        //   await depositToSeniorPool(amount, investor2)
        //   await depositToPool(juniorPool, juniorAmount)
        //   await depositToPool(juniorPool, juniorAmount, investor2)
        // })
        // .toChange([
        //   [async () => await getBalance(investor1, rwa), {by: usdcToRWA(amount)}],
        //   [async () => await getBalance(investor2, rwa), {by: usdcToRWA(amount)}],
        //   [async () => await getBalance(investor1, poolTokens), {by: new BN(1)}],
        //   [async () => await getBalance(investor2, poolTokens), {by: new BN(1)}],
        // ])
        await lockAndLeveragePool(juniorPool)
        await drawdown(juniorPool, drawdownAmount, borrower)
        const totalInterest = await calculateInterest(juniorPool, creditLine, paymentPeriodInDays, null)
        const expectedSeniorInterest = await calculateInterest(
          juniorPool,
          creditLine,
          paymentPeriodInDays,
          TRANCHES.Senior
        )
        const expectedJuniorInterest = await calculateInterest(
          juniorPool,
          creditLine,
          paymentPeriodInDays,
          TRANCHES.Junior
        )

        await advanceTime({days: 10})
        // Just a hack to get interestOwed and other accounting vars to update
        await drawdown(juniorPool, new BN(1), borrower)
        await expectAction(() => makePayment(juniorPool, totalInterest))
        // .toChange([
        //   [indexPool.sharePrice, {by: "0x0"}],
        // ])
        await advanceTime({days: 5})
        await expectAction(() => assessPool(juniorPool))
        // .toChange([
        //   [indexPool.sharePrice, {increase: true}],
        //   [creditLine.interestOwed, {to: "0x0"}],
        // ])

        // There was 10k already in the pool, so each investor has a third
        const grossExpectedReturn = amount.add(expectedSeniorInterest.div(new BN(3)))
        const expectedReturn = await afterWithdrawalFees(grossExpectedReturn)
        const availableRWA = await getBalance(investor2, rwa)
        await expectAction(async () => {
          await withdrawFromSeniorPool("max")
          await withdrawFromSeniorPoolInRWA(bnToHex(availableRWA), investor2) // Withdraw everything in rwa terms
        })
        // .toChange([
        //   [() => getBalance(investor1, usdc), {byCloseTo: expectedReturn}],
        //   [() => getBalance(investor2, usdc), {byCloseTo: expectedReturn}], // Also ensures share price is correctly incorporated
        // ])

        // Only 2 junior investors, and both were for the same amount. 10% was drawdown, so 90% of junior principal is redeemable
        const principalFractionUsed = (await creditLine.balance()).mul(ONE_HUNDRED).div(limit)
        const juniorPrincipalAvailable = getPercent(juniorAmount, ONE_HUNDRED.sub(principalFractionUsed))
        const expectedJuniorReturn = juniorPrincipalAvailable.add(expectedJuniorInterest.div(new BN(2)))
        await expectAction(async () => {
          await withdrawFromPool(juniorPool, "max")
          await withdrawFromPool(juniorPool, expectedJuniorReturn, investor2)
        })
        // .toChange([
        //   [() => getBalance(investor1, usdc), {byCloseTo: expectedJuniorReturn}],
        //   [() => getBalance(investor2, usdc), {byCloseTo: expectedJuniorReturn}],
        // ])
      })

      it("should handle writedowns correctly", async () => {
        const amount = usdcVal(10000)
        const juniorAmount = usdcVal(1000)
        const drawdownAmount = amount.div(new BN(2))
        await depositToSeniorPool(bnToHex(amount))
        await depositToSeniorPool(bnToHex(amount), investor2)
        await createJuniorPool({_paymentPeriodInDays: bnToHex(paymentPeriodInDays)})
        await depositToPool(juniorPool, bnToHex(juniorAmount))
        await depositToPool(juniorPool, bnToHex(juniorAmount), investor2)
        await lockAndLeveragePool(juniorPool)
        await drawdown(juniorPool, drawdownAmount, borrower)

        await naosConfig.setNumber(CONFIG_KEYS.LatenessGracePeriodInDays, bnToHex(paymentPeriodInDays))
        // Advance to a point where we would definitely write them down
        const fourPeriods = (await creditLine.paymentPeriodInDays()).mul(new BN(4))
        await advanceTime({days: fourPeriods.toNumber()})
        // TODO:
        // await expectAction(() => assessPool(juniorPool)).toChange([
        //   [indexPool.totalWritedowns, {increase: true}],
        //   [creditLine.interestOwed, {increase: true}],
        //   [indexPool.sharePrice, {decrease: true}],
        // ])

        // All the main actions should still work as expected!
        await expect(drawdown(juniorPool, new BN(10))).to.be.rejected
        await depositToSeniorPool(bnToHex(new BN(10)))
        // TODO:
        // await withdrawFromSeniorPool(bnToHex(new BN(10)))
        await makePayment(juniorPool, bnToHex(new BN(10)))
      })

      // This test fails now, but should pass once we fix late fee logic.
      // We *should* charge interest after term end date, when you're so late that
      // you're past the grace period. But currently we don't charge any.
      xit("should accrue interest correctly after the term end date", async () => {
        const amount = usdcVal(10000)
        const drawdownAmount = amount.div(new BN(2))

        await depositToSeniorPool(amount)
        await depositToSeniorPool(amount, investor2)
        const creditLine = await createJuniorPool({
          _paymentPeriodInDays: paymentPeriodInDays,
          _lateFeesApr: interestAprAsBN("3.0"),
        })
        await drawdown(creditLine.address, drawdownAmount, borrower)

        // Advance to a point where we would definitely writethem down
        const termLength = await creditLine.termInDays()
        await advanceTime({days: termLength.toNumber()})

        await assessPool(creditLine.address)

        const termInterestTotalWithLateFees = drawdownAmount.mul(interestApr.add(lateFeeApr)).div(INTEREST_DECIMALS)
        expect(await creditLine.interestOwed()).to.bignumber.equal(termInterestTotalWithLateFees)

        // advance more time
        const clPaymentPeriodInDays = await creditLine.paymentPeriodInDays()
        await advanceTime({days: clPaymentPeriodInDays.toNumber()})

        await assessPool(juniorPool)
        expect(await creditLine.interestOwed()).to.bignumber.gt(termInterestTotalWithLateFees)
      })
    })

    describe("credit lines and interest rates", async () => {
      beforeEach(async () => {
        limit = usdcVal(10000)
        interestApr = interestAprAsBN("25")
        lateFeeApr = interestAprAsBN("0")
        paymentPeriodInDays = new BN(1)
        termInDays = new BN(365)
        paymentPeriodInSeconds = SECONDS_PER_DAY.mul(paymentPeriodInDays)
      })

      describe("drawdown and isLate", async () => {
        it("should not think you're late if it's not past the nextDueTime", async () => {
          await createJuniorPool({_paymentPeriodInDays: bnToHex(new BN(30))})
          await depositToPool(juniorPool, usdcVal(200))
          await lockAndLeveragePool(juniorPool)
          await expect(drawdown(juniorPool, new BN(1000))).to.be.fulfilled
          await advanceTime({days: 10})
          // This drawdown will accumulate and record some interest
          await expect(drawdown(juniorPool, new BN(1))).to.be.fulfilled
          // This one should still work, because you still aren't late...
          await expect(drawdown(juniorPool, new BN(1))).to.be.fulfilled
        })
      })

      it("calculates interest correctly", async () => {
        let currentTime = await advanceTime({days: 1})
        await createJuniorPool()
        await depositToPool(juniorPool, usdcVal(2000))
        await lockAndLeveragePool(juniorPool)

        let interestAccruedAsOf = currentTime
        await assertCreditLine("0", "0", "0", 0, currentTime, 0)

        currentTime = await advanceTime({days: 1})
        await drawdown(juniorPool, usdcVal(2000))

        let nextDueTime = (await time.latest()).add(SECONDS_PER_DAY.mul(paymentPeriodInDays))
        interestAccruedAsOf = currentTime
        const lastFullPaymentTime = currentTime
        await assertCreditLine(usdcVal(2000), "0", "0", nextDueTime, currentTime, lastFullPaymentTime)

        currentTime = await advanceTime({days: 1})

        await juniorPool.assess({from: borrower})

        const totalInterestPerYear = usdcVal(2000).mul(interestApr).div(INTEREST_DECIMALS)
        const secondsPassed = nextDueTime.sub(interestAccruedAsOf)
        let expectedInterest = totalInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)
        nextDueTime = nextDueTime.add(paymentPeriodInSeconds)

        const amount = isDecimal18Env() ? "1369863013698630136" : "1369863"
        expect(expectedInterest).to.bignumber.eq(amount)

        await assertCreditLine(
          usdcVal(2000),
          expectedInterest,
          "0",
          nextDueTime,
          nextDueTime.sub(paymentPeriodInSeconds),
          lastFullPaymentTime
        )

        currentTime = await advanceTime({days: 1})
        expectedInterest = expectedInterest.mul(new BN(2)) // 2 days of interest
        nextDueTime = nextDueTime.add(paymentPeriodInSeconds)

        await juniorPool.assess({from: borrower})

        await assertCreditLine(
          usdcVal(2000),
          expectedInterest,
          "0",
          nextDueTime,
          nextDueTime.sub(paymentPeriodInSeconds),
          lastFullPaymentTime
        )
      })
    })
  })
})
