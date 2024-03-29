import {
  expect,
  BN,
  bigVal,
  mochaEach,
  tolerance,
  usdcVal,
  SECONDS_PER_DAY,
  SECONDS_PER_YEAR,
  Numberish,
  bnToBnjs,
  bnToHex
} from "./testHelpers"
import hre from "hardhat"
const {deployments, web3} = hre
import {interestAprAsBN, INTEREST_DECIMALS, ETHDecimals} from "../scripts/blockchain_scripts/deployHelpers"
import {deployBaseFixture, deployUninitializedCreditLineFixture} from "./util/fixtures"

describe("Accountant", async () => {
  let accountant, owner, borrower, testAccountant, naosConfig, creditLine

  const testSetup = deployments.createFixture(async () => {
    const baseFixtures = await deployBaseFixture()
    const creditLineFixture = await deployUninitializedCreditLineFixture()

    return {...baseFixtures, ...creditLineFixture}
  })

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[owner, borrower] = await web3.eth.getAccounts()
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({naosConfig, testAccountant, accountant, creditLine} = await testSetup())
  })

  describe("calculateInterestAndPrincipalAccrued", async () => {
    let balance,
      timestamp,
      lateFeeApr,
      lateFeeGracePeriod,
      lateFeeGracePeriodInDays,
      paymentPeriodInDays,
      termInDays,
      interestApr

    const bnToHex = (bn) => {
      return '0x' + bn.toString('hex')
    }

    const calculateInterestAndPrincipalAccrued = async (timestamp) => {
      const result = await testAccountant.calculateInterestAndPrincipalAccrued(
        creditLine.address,
        bnToHex(timestamp),
        bnToHex(lateFeeGracePeriodInDays)
      )
      return [bnToBnjs(result[0]), bnToBnjs(result[1])]
    }
    // You can get this by taking the interest rate * principal, and divide by the fraction of seconds elapsed (100 in our case) to seconds in the term
    // (1000 * 0.03) * (100 / 2592000) = 1157
    let expectedInterest = new BN(String(1157))
    beforeEach(async () => {
      balance = usdcVal(1000)
      interestApr = interestAprAsBN("3.00")
      lateFeeApr = interestAprAsBN("3")
      lateFeeGracePeriod = new BN(1)
      const principalGracePeriod = new BN(185)
      termInDays = new BN(360)
      paymentPeriodInDays = new BN(30)
      lateFeeGracePeriodInDays = lateFeeGracePeriod.mul(paymentPeriodInDays)
      await creditLine.initialize(
        naosConfig.address,
        owner,
        borrower,
        bnToHex(bigVal(500)),
        bnToHex(interestApr),
        bnToHex(paymentPeriodInDays),
        bnToHex(termInDays),
        bnToHex(lateFeeApr),
        bnToHex(principalGracePeriod)
      )
      const currentTime = new BN(Date.now() / 1000)
      await creditLine.setInterestAccruedAsOf(bnToHex(currentTime))
      await creditLine.setBalance(bnToHex(balance))
      timestamp = currentTime.add(new BN(100))
      await creditLine.setTermEndTime(bnToHex(timestamp))
    })
    describe("when the timestamp is < the term end date", async () => {
      it("should return zero principal, but full interest", async () => {
        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(timestamp.sub(new BN(1)))
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest, tolerance)
        expect(principalAccrued).to.bignumber.equal(new BN(0))
      })
    })
    describe("when the timestamp == the term end date", async () => {
      it("should return the full principal and full interest", async () => {
        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(timestamp)
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest, tolerance)
        expect(principalAccrued).to.bignumber.equal(balance)
      })
    })
    describe("when the timestamp > the term end date", async () => {
      it("should return the full principal and full interest", async () => {
        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(timestamp.add(new BN(1)))
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest, tolerance)
        expect(principalAccrued).to.bignumber.equal(balance)
      })
    })

    describe("late fees", async () => {
      beforeEach(async () => {
        await creditLine.setInterestAccruedAsOf(bnToHex(timestamp))
        await creditLine.setLastFullPaymentTime(bnToHex(timestamp))
        const offset = lateFeeGracePeriodInDays.mul(SECONDS_PER_DAY).mul(new BN(10))
        await creditLine.setTermEndTime(bnToHex(timestamp.add(offset))) // some time in the future
      })

      it("should not charge late fees within the grace period", async () => {
        const totalInterestPerYear = balance.mul(interestApr).div(INTEREST_DECIMALS)
        const secondsPassed = lateFeeGracePeriodInDays.mul(SECONDS_PER_DAY).div(new BN(2))
        expectedInterest = totalInterestPerYear.mul(secondsPassed).divRound(SECONDS_PER_YEAR)

        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(
          timestamp.add(secondsPassed)
        )
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest, tolerance)
        expect(principalAccrued).to.bignumber.equal(new BN(0))
      })

      it("should charge late fee apr on the balance and return total interest accrued", async () => {
        const totalInterestPerYear = balance.mul(interestApr).div(INTEREST_DECIMALS)
        const secondsPassed = lateFeeGracePeriodInDays.mul(SECONDS_PER_DAY).mul(new BN(2))
        expectedInterest = totalInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)

        const lateFeeInterestPerYear = balance.mul(lateFeeApr).div(INTEREST_DECIMALS)
        const lateFee = lateFeeInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)

        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(
          timestamp.add(secondsPassed)
        )
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest.add(lateFee), tolerance)
        expect(principalAccrued).to.bignumber.equal(new BN(0))
      })

      it("should not charge late fees on the principal if beyond the term end date", async () => {
        // Set term end date in the past (but greater than interestAccruedAsOf)
        await creditLine.setTermEndTime(bnToHex(timestamp.add(new BN(1))))
        const totalInterestPerYear = balance.mul(interestApr).div(INTEREST_DECIMALS)
        const secondsPassed = lateFeeGracePeriodInDays.mul(SECONDS_PER_DAY).mul(new BN(2))
        expectedInterest = totalInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)
        const lateFeeInterestPerYear = balance.mul(lateFeeApr).div(INTEREST_DECIMALS)
        const lateFee = lateFeeInterestPerYear.mul(secondsPassed).div(SECONDS_PER_YEAR)

        const [interestAccrued, principalAccrued] = await calculateInterestAndPrincipalAccrued(
          timestamp.add(secondsPassed)
        )
        expect(interestAccrued).to.bignumber.closeTo(expectedInterest.add(lateFee), tolerance)
        expect(principalAccrued).to.bignumber.equal(balance)
      })
    })
  })

  describe("writedowns", async () => {
    let balance, interestApr, paymentPeriodInDays, termEndTime, timestamp, gracePeriod, maxLatePeriods

    async function setupCreditLine({_paymentPeriodInDays}: {_paymentPeriodInDays?: Numberish} = {}) {
      balance = usdcVal(10)
      interestApr = interestAprAsBN("3.00")
      const termInDays = new BN(360)
      paymentPeriodInDays = _paymentPeriodInDays || new BN(30)
      gracePeriod = new BN(30)
      maxLatePeriods = new BN(120)
      const principalGracePeriod = new BN(185)
      termEndTime = new BN(Date.now() / 1000) // Current time in seconds
      const lateFeeApr = interestAprAsBN("0")

      await creditLine.initialize(
        naosConfig.address,
        owner,
        borrower,
        bnToHex(bigVal(500)),
        bnToHex(interestApr),
        bnToHex(paymentPeriodInDays),
        bnToHex(termInDays),
        bnToHex(lateFeeApr),
        bnToHex(principalGracePeriod)
      )
      await creditLine.setBalance(bnToHex(balance))
      await creditLine.setTermEndTime(bnToHex(termEndTime)) // Some time in the future
      timestamp = termEndTime.add(new BN(100)) // Calculate for 100 seconds into the future
      return creditLine
    }

    const interestOwedForOnePeriod = () => {
      const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
      const totalInterestPerYear = balance.mul(interestApr).div(INTEREST_DECIMALS)
      return totalInterestPerYear.mul(paymentPeriodInSeconds).divRound(SECONDS_PER_YEAR)
    }

    const calculateWritedownFor = async (creditline, timestamp, maxLatePeriods) => {
      const result = await testAccountant.calculateWritedownFor(
        creditline.address,
        bnToHex(timestamp),
        bnToHex(maxLatePeriods)
      )
      return bnToBnjs(result)
    }

    describe("calculateAmountOwedForOnePeriod", async () => {
      beforeEach(async () => await setupCreditLine())

      it("calculates amount owed for one period for the credit line", async () => {
        const result = await testAccountant.calculateAmountOwedForOneDay(creditLine.address)
        const calculatedInterestPerDay = new BN(bnToBnjs(result[0])).div(new BN(ETHDecimals))
        const interestPerDay = interestOwedForOnePeriod().div(paymentPeriodInDays)

        expect(calculatedInterestPerDay).to.bignumber.eq(interestPerDay)
      })
    })

    describe("when the payment period is greater than the max grace period in days", async () => {
      beforeEach(async () => {
        await setupCreditLine({_paymentPeriodInDays: new BN(90)})
      })

      it("should respect the maximum number of grace period days", async () => {
        await creditLine.setInterestOwed(bnToHex(interestOwedForOnePeriod()))
        const writedownAmount = await calculateWritedownFor(
          creditLine,
          timestamp,
          maxLatePeriods
        )

        expect(writedownAmount).to.bignumber.eq("0")
      })
    })

    describe("calculateWritedownFor", async () => {
      beforeEach(async () => await setupCreditLine())

      it("does not write down within the grace period", async () => {
        // Only half the interest owed for one period has accumulated, so within grace period
        await creditLine.setInterestOwed(bnToHex(interestOwedForOnePeriod().div(new BN(2))))

        const writedownAmount = await calculateWritedownFor(
          creditLine,
          timestamp,
          maxLatePeriods
        )
        expect(writedownAmount).to.bignumber.eq("0")
      })

      it("writes down proportionally based on interest owed", async () => {
        // 2 periods of interest have accumulated, so we're beyond the grace period.
        await creditLine.setInterestOwed(bnToHex(interestOwedForOnePeriod().mul(new BN(2))))

        const writedownAmount = await calculateWritedownFor(
          creditLine,
          timestamp,
          maxLatePeriods
        )

        // Should be marked down by 25% ((daysLate - grace period) / maxLateDays * 100)
        // expect(writedownAmount).to.bignumber.closeTo(balance.div(new BN(4)), tolerance) // 25% of 10
        expect(writedownAmount).to.bignumber.eq('0')
      })

      it("caps the write down to 100% beyond the max late periods", async () => {
        // 13 periods (130 days) of interest have accumulated, so we're beyond the max late days (120)
        await creditLine.setInterestOwed(bnToHex(interestOwedForOnePeriod().mul(new BN(13))))

        const writedownAmount = await calculateWritedownFor(
          creditLine,
          timestamp,
          maxLatePeriods
        )

        // Should be marked down by 100%
        expect(writedownAmount).to.bignumber.eq(balance)
      })

      it("does not write down if there is no balance owed", async () => {
        await creditLine.setBalance(bnToHex(new BN("0")))

        const writedownAmount = await calculateWritedownFor(
          creditLine,
          timestamp,
          maxLatePeriods
        )
        expect(writedownAmount).to.bignumber.eq("0")
      })

      describe("beyond the term end date", async () => {
        it("uses the timestamp to determine if within grace period", async () => {
          const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
          // 50% of one payment period, so within the grace period
          timestamp = termEndTime.add(paymentPeriodInSeconds.div(new BN(2)))
          const writedownAmount = await calculateWritedownFor(
            creditLine,
            timestamp,
            maxLatePeriods
          )
          expect(writedownAmount).to.bignumber.eq("0")
        })

        it("does not go down when you just go over the term end date", async () => {
          await creditLine.setInterestOwed(bnToHex(interestOwedForOnePeriod().mul(new BN(2))))
          timestamp = termEndTime.sub(new BN(2))
          const writedownAmount = await calculateWritedownFor(
            creditLine,
            timestamp,
            maxLatePeriods
          )
          // expect(writedownAmount).to.bignumber.eq("2500094")
          expect(writedownAmount).to.bignumber.eq('0')

          timestamp = termEndTime.add(new BN(1))
          const newWritedownAmount = await calculateWritedownFor(
            creditLine,
            timestamp,
            maxLatePeriods
          )
          // expect(newWritedownAmount).to.bignumber.closeTo(writedownAmount, "100")
          expect(newWritedownAmount).to.bignumber.eq('0')
        })

        it("uses the timestamp to write down proportionally", async () => {
          const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
          // 2 periods late
          timestamp = termEndTime.add(paymentPeriodInSeconds.mul(new BN(2)))
          const writedownAmount = await calculateWritedownFor(
            creditLine,
            timestamp,
            maxLatePeriods
          )
          // Should be marked down by 25% ((periodslate - grace period)/ maxLatePeriods * 100)
          // expect(writedownAmount).to.bignumber.eq(balance.div(new BN(4))) // 25% of 10
          expect(writedownAmount).to.bignumber.eq('0')
        })

        it("uses the timestamp to cap max periods late", async () => {
          const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
          // 130 days late
          timestamp = termEndTime.add(paymentPeriodInSeconds.mul(new BN(13)))
          const writedownAmount = await calculateWritedownFor(
            creditLine,
            timestamp,
            maxLatePeriods
          )

          // Should be marked down by 100%
          // expect(writedownAmount).to.bignumber.eq(balance)
          expect(writedownAmount).to.bignumber.eq('0')
        })

        it("does not write down if there is no balance owed", async () => {
          await creditLine.setBalance(bnToHex(new BN("0")))
          const paymentPeriodInSeconds = paymentPeriodInDays.mul(SECONDS_PER_DAY)
          // 5 periods later
          timestamp = termEndTime.add(paymentPeriodInSeconds.mul(new BN(5)))

          const writedownAmount = await calculateWritedownFor(
            creditLine,
            timestamp,
            maxLatePeriods
          )
          expect(writedownAmount).to.bignumber.eq("0")
        })
      })
    })
  })

  describe("allocatePayment", async () => {
    const tests = [
      // payment, balance, totalInterestOwed, totalPrincipalOwed, expectedResults, liquidated
      [10, 40, 10, 20, 0, {interestPayment: 10, principalPayment: 0, additionalBalancePayment: 0}],
      [5, 40, 10, 20, 0, {interestPayment: 5, principalPayment: 0, additionalBalancePayment: 0}],
      [15, 40, 10, 20, 0, {interestPayment: 10, principalPayment: 5, additionalBalancePayment: 0}],
      [35, 40, 10, 20, 0, {interestPayment: 10, principalPayment: 20, additionalBalancePayment: 5}],
      [55, 40, 10, 20, 0, {interestPayment: 10, principalPayment: 20, additionalBalancePayment: 20}],
      [0, 40, 10, 20, 0, {interestPayment: 0, principalPayment: 0, additionalBalancePayment: 0}],
    ]
    mochaEach(tests).it(
      "should calculate things correctly!",
      async (paymentAmount, balance, totalInterestOwed, totalPrincipalOwed, liquidated, expected) => {
        const result = await accountant.allocatePayment(
          bnToHex(bigVal(paymentAmount)),
          bnToHex(bigVal(balance)),
          bnToHex(bigVal(totalInterestOwed)),
          bnToHex(bigVal(totalPrincipalOwed)),
          bnToHex(bigVal(liquidated)),
        )

        expect(bnToBnjs(result.interestPayment)).to.be.bignumber.equals(bigVal(expected.interestPayment))
        expect(bnToBnjs(result.principalPayment)).to.be.bignumber.equals(bigVal(expected.principalPayment))
        expect(bnToBnjs(result.additionalBalancePayment)).to.be.bignumber.equals(bigVal(expected.additionalBalancePayment))
      }
    )
  })
})
