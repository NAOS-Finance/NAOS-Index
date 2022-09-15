/* global web3 */
import hre from "hardhat"
const {deployments, artifacts, web3} = hre
import {expect, BN, usdcVal, createPoolWithCreditLine, bnToHex, bnToBnjs} from "./testHelpers"
import {interestAprAsBN, LEVERAGE_RATIO_DECIMALS, TRANCHES} from "../scripts/blockchain_scripts/deployHelpers"
import {CONFIG_KEYS} from "../scripts/blockchain_scripts/configKeys"
import {assertNonNullable} from "../scripts/blockchain_scripts/utils/type"
import {expectEvent} from "@openzeppelin/test-helpers"
import {deployBaseFixture} from "./util/fixtures"
// TODO: with artifacts.require, we don't need bnToBnjs (maybe it's truffle/web3 contract object)
const FixedLeverageRatioStrategy = artifacts.require("FixedLeverageRatioStrategy")

const EXPECTED_LEVERAGE_RATIO: BN = new BN(String(4e18))

const setupTest = deployments.createFixture(async ({deployments}) => {
  const [owner, borrower] = await web3.eth.getAccounts()
  assertNonNullable(owner)
  assertNonNullable(borrower)

  const {indexPool, naosConfig, naosFactory, usdc} = await deployBaseFixture()

  await naosConfig.bulkAddToGoList([owner, borrower])

  const juniorInvestmentAmount = usdcVal(10000)
  const limit = juniorInvestmentAmount.mul(new BN(10))
  const interestApr = interestAprAsBN("5.00")
  const paymentPeriodInDays = new BN(30)
  const termInDays = new BN(365)
  const lateFeeApr = new BN(0)
  const juniorFeePercent = new BN(20)
  const {juniorPool} = await createPoolWithCreditLine({
    people: {owner, borrower},
    naosFactory,
    juniorFeePercent: bnToHex(juniorFeePercent),
    limit: bnToHex(limit),
    interestApr: bnToHex(interestApr),
    paymentPeriodInDays: bnToHex(paymentPeriodInDays),
    termInDays: bnToHex(termInDays),
    lateFeeApr: bnToHex(lateFeeApr),
    usdc,
  })

  const strategy = await FixedLeverageRatioStrategy.new({from: owner})
  await strategy.initialize(owner, naosConfig.address)

  const seniorRole = await juniorPool.SENIOR_ROLE()
  await juniorPool.deposit(TRANCHES.Junior, bnToHex(juniorInvestmentAmount))
  await juniorPool.grantRole(seniorRole, owner)

  return {naosConfig, juniorPool, indexPool, strategy, owner, borrower, juniorInvestmentAmount}
})

describe("FixedLeverageRatioStrategy", () => {
  describe("getLeverageRatio", () => {
    let naosConfig, juniorPool, strategy

    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/no-extra-semi
      ;({naosConfig, juniorPool, strategy} = await setupTest())
    })

    it("returns the leverage ratio maintained by Goldfinch config, unadjusted for the relevant number of decimal places", async () => {
      const configLeverageRatio = await naosConfig.getNumber(CONFIG_KEYS.LeverageRatio)
      expect(bnToBnjs(configLeverageRatio)).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

      const strategyLeverageRatio = await strategy.getLeverageRatio(juniorPool.address)
      expect(strategyLeverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)
    })
  })

  describe("estimateInvestment", () => {
    describe("calculation", () => {
      let naosConfig, juniorPool, indexPool, strategy, owner, juniorInvestmentAmount

      beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-extra-semi
        ;({naosConfig, juniorPool, indexPool, strategy, owner, juniorInvestmentAmount} = await setupTest())
      })

      it("levers junior investment using the leverageRatio", async () => {
        const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

        const amount = await strategy.estimateInvestment(juniorPool.address)
        expect(amount).to.bignumber.equal(usdcVal(40000))
        expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
      })

      it("correctly handles decimal places, for a fractional leverageRatio", async () => {
        const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

        await naosConfig.setNumber(CONFIG_KEYS.LeverageRatio, bnToHex(new BN(String(4.5e18))), {from: owner})

        const leverageRatio2 = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio2).to.bignumber.equal(new BN(String(4.5e18)))

        const amount = await strategy.estimateInvestment(juniorPool.address)
        // If the leverage ratio's decimals were handled incorrectly by `strategy.estimateInvestment()` --
        // i.e. if the adjustment by LEVERAGE_RATIO_DECIMALS were applied to the leverage ratio directly,
        // rather than to the product of the junior investment amount and the leverage ratio --, we'd expect
        // the effective multiplier to have been floored to 4, rather than be 4.5. So we check that the
        // effective multipler was indeed 4.5.
        expect(amount).to.bignumber.equal(usdcVal(45000))
        expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio2).div(LEVERAGE_RATIO_DECIMALS))
      })
    })

    describe("lifecycle / chronology", () => {
      context("junior tranche is not locked and senior tranche is not locked", () => {
        let juniorPool, indexPool, strategy, juniorInvestmentAmount

        beforeEach(async () => {
          // eslint-disable-next-line @typescript-eslint/no-extra-semi
          ;({juniorPool, indexPool, strategy, juniorInvestmentAmount} = await setupTest())
        })

        it("returns investment amount", async () => {
          const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
          const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
          expect(juniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))

          const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)
          const seniorTrancheLockedUntil = new BN(seniorTranche.lockedUntil)
          expect(seniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))

          const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
          expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

          const amount = await strategy.estimateInvestment(juniorPool.address)
          expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
        })
      })

      context("junior tranche is locked and senior tranche is not locked", () => {
        context("base", () => {
          let juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount} = await setupTest())
          })

          it("returns investment amount", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

            const amount = await strategy.estimateInvestment(juniorPool.address)
            expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
          })
        })

        context("senior principal is already partially invested", () => {
          let juniorPool, indexPool, strategy, juniorInvestmentAmount, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, borrower} = await setupTest())
          })

          it("would invest up to the levered amount", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

            const existingSeniorPrincipal = juniorInvestmentAmount.add(new BN(10))
            await juniorPool.deposit(TRANCHES.Senior, bnToHex(existingSeniorPrincipal))

            const amount = await strategy.estimateInvestment(juniorPool.address)
            expect(amount).to.bignumber.equal(
              juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS).sub(existingSeniorPrincipal)
            )
          })
        })

        context("senior principal already exceeds investment amount", () => {
          let juniorPool, indexPool, strategy, juniorInvestmentAmount, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, borrower} = await setupTest())
          })

          it("would not invest", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

            const existingSeniorPrincipal = juniorInvestmentAmount.add(
              juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS).add(new BN(1))
            )
            await juniorPool.deposit(TRANCHES.Senior, bnToHex(existingSeniorPrincipal))

            const amount = await strategy.estimateInvestment(juniorPool.address)
            expect(amount).to.bignumber.equal(new BN(0))
          })
        })
      })

      context("junior tranche is locked and senior tranche is locked", () => {
        let juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount

        beforeEach(async () => {
          // eslint-disable-next-line @typescript-eslint/no-extra-semi
          ;({juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount} = await setupTest())
        })

        it("returns investment amount", async () => {
          await juniorPool.lockJuniorCapital({from: borrower})
          await juniorPool.lockPool({from: borrower})

          const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
          expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

          const amount = await strategy.estimateInvestment(juniorPool.address)
          expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
        })
      })
    })
  })

  describe("invest", () => {
    describe("calculation", () => {
      let naosConfig, juniorPool, indexPool, strategy, owner, borrower, juniorInvestmentAmount

      beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-extra-semi
        ;({naosConfig, juniorPool, indexPool, strategy, owner, borrower, juniorInvestmentAmount} =
          await setupTest())
      })

      it("levers junior investment using the leverageRatio", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

        const amount = await strategy.invest(juniorPool.address)
        expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
      })

      it("correctly handles decimal places, for a fractional leverageRatio", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

        await naosConfig.setNumber(CONFIG_KEYS.LeverageRatio, bnToHex(new BN(String(4.5e18))), {from: owner})

        const leverageRatio2 = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio2).to.bignumber.equal(new BN(String(4.5e18)))

        const amount = await strategy.invest(juniorPool.address)
        expect(amount).to.bignumber.equal(usdcVal(45000))
        expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio2).div(LEVERAGE_RATIO_DECIMALS))
      })
    })

    describe("lifecycle / chronology", () => {
      context("junior tranche is not locked and senior tranche is not locked", () => {
        let juniorPool, indexPool, strategy

        beforeEach(async () => {
          // eslint-disable-next-line @typescript-eslint/no-extra-semi
          ;({juniorPool, indexPool, strategy} = await setupTest())
        })

        it("does not invest", async () => {
          const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
          const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
          expect(juniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))

          const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)
          const seniorTrancheLockedUntil = new BN(seniorTranche.lockedUntil)
          expect(seniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))

          const amount = await strategy.invest(juniorPool.address)
          expect(amount).to.bignumber.equal(new BN(0))
        })
      })

      context("junior tranche is locked and senior tranche is not locked", () => {
        context("base", () => {
          let juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount} = await setupTest())
          })

          it("invests", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

            const amount = await strategy.invest(juniorPool.address)
            expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
          })
        })

        context("senior principal is already partially invested", () => {
          let juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount} = await setupTest())
          })

          it("invests up to the levered amount", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

            const existingSeniorPrincipal = juniorInvestmentAmount.add(new BN(10))
            await juniorPool.deposit(TRANCHES.Senior, bnToHex(existingSeniorPrincipal))

            const amount = await strategy.invest(juniorPool.address)
            expect(amount).to.bignumber.equal(
              juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS).sub(existingSeniorPrincipal)
            )
          })
        })

        context("senior principal already exceeds investment amount", () => {
          let juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, borrower, juniorInvestmentAmount} = await setupTest())
          })

          it("does not invest", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

            const existingSeniorPrincipal = juniorInvestmentAmount.add(
              juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS).add(new BN(1))
            )
            await juniorPool.deposit(TRANCHES.Senior, bnToHex(existingSeniorPrincipal))

            const amount = await strategy.invest(juniorPool.address)
            expect(amount).to.bignumber.equal(new BN(0))
          })
        })
      })

      context("junior tranche is locked and senior tranche is locked", () => {
        let juniorPool, indexPool, strategy, borrower

        beforeEach(async () => {
          // eslint-disable-next-line @typescript-eslint/no-extra-semi
          ;({juniorPool, indexPool, strategy, borrower} = await setupTest())
        })

        it("does not invest", async () => {
          await juniorPool.lockJuniorCapital({from: borrower})
          await juniorPool.lockPool({from: borrower})

          const amount = await strategy.invest(juniorPool.address)
          expect(amount).to.bignumber.equal(new BN(0))
        })
      })
    })
  })
})
