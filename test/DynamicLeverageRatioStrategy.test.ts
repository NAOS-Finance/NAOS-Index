/* global web3 */
import hre from "hardhat"
import {expectEvent} from "@openzeppelin/test-helpers"
const {deployments, artifacts, web3} = hre
import {expect, BN, usdcVal, createPoolWithCreditLine, bnToHex, bnToBnjs} from "./testHelpers"
import {
  interestAprAsBN,
  LEVERAGE_RATIO_DECIMALS,
  OWNER_ROLE,
  PAUSER_ROLE,
  LEVERAGE_RATIO_SETTER_ROLE,
  TRANCHES,
} from "../scripts/blockchain_scripts/deployHelpers"
import {assertNonNullable} from "../scripts/blockchain_scripts/utils/type"
import {deployBaseFixture} from "./util/fixtures"
const DynamicLeverageRatioStrategy = artifacts.require("DynamicLeverageRatioStrategy")

const EXPECTED_LEVERAGE_RATIO: BN = new BN(String(4e18))
const LEVERAGE_RATIO_NOT_SET_REGEXP = /Leverage ratio has not been set yet\./
const LEVERAGE_RATIO_OBSOLETE_REGEXP = /Leverage ratio is obsolete\. Wait for its recalculation\./
const LEVERAGE_RATIO_EXPECTED_OBSOLETE_TIMESTAMP_REGEXP = /Expected junior tranche `lockedUntil` to have been updated\./
const DYNAMIC_LEVERAGE_RATIO_TEST_VERSION = web3.utils.keccak256("DynamicLeverageRatioStrategy test version")

const setupTest = deployments.createFixture(async ({deployments}) => {
  const [owner, borrower, person2] = await web3.eth.getAccounts()
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

  const strategy = await DynamicLeverageRatioStrategy.new({from: owner})
  await strategy.initialize(owner)

  await juniorPool.deposit(TRANCHES.Junior, bnToHex(juniorInvestmentAmount))

  const seniorRole = await juniorPool.SENIOR_ROLE()
  await juniorPool.grantRole(seniorRole, owner)

  return {naosConfig, juniorPool, indexPool, strategy, owner, borrower, juniorInvestmentAmount, person2}
})

const leverJuniorInvestment = async (
  juniorPool: any,
  strategy: any,
  juniorInvestmentAmount: BN,
  owner: any,
  borrower: any,
  investmentFn: () => Promise<BN>
) => {
  const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
  await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)

  await juniorPool.lockJuniorCapital({from: borrower})

  await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

  const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
  expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

  const amount = await investmentFn()
  expect(amount).to.bignumber.equal(usdcVal(40000))
  expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
}

const leverFractionally = async (
  juniorPool: any,
  strategy: any,
  juniorInvestmentAmount: BN,
  owner: any,
  borrower: any,
  investmentFn: () => Promise<BN>
) => {
  const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
  await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)

  await juniorPool.lockJuniorCapital({from: borrower})

  await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

  const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
  expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

  await setLeverageRatio(juniorPool, strategy, owner, new BN(String(4.5e18)))

  const leverageRatio2 = await strategy.getLeverageRatio(juniorPool.address)
  expect(leverageRatio2).to.bignumber.equal(new BN(String(4.5e18)))

  const amount = await investmentFn()
  // Analogous comment as in corresponding FixedLeverageRatioStrategy test.
  expect(amount).to.bignumber.equal(usdcVal(45000))
  expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio2).div(LEVERAGE_RATIO_DECIMALS))
}

const setLeverageRatio = async (juniorPool: any, strategy: any, owner: any, leverageRatio: BN) => {
  const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
  const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
  expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))
  await strategy.setLeverageRatio(
    juniorPool.address,
    bnToHex(leverageRatio),
    bnToHex(juniorTrancheLockedUntil),
    DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
    {from: owner}
  )

  const leverageRatio2 = await strategy.getLeverageRatio(juniorPool.address)
  expect(leverageRatio2).to.bignumber.equal(leverageRatio)
}

describe("DynamicLeverageRatioStrategy", () => {
  describe("ownership", async () => {
    let strategy, owner

    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/no-extra-semi
      ;({strategy, owner} = await setupTest())
    })

    it("should be owned by the owner", async () => {
      expect(await strategy.hasRole(OWNER_ROLE, owner)).to.equal(true)
    })
    it("should give owner the PAUSER_ROLE", async () => {
      expect(await strategy.hasRole(PAUSER_ROLE, owner)).to.equal(true)
    })
    it("should give owner the LEVERAGE_RATIO_SETTER_ROLE", async () => {
      expect(await strategy.hasRole(LEVERAGE_RATIO_SETTER_ROLE, owner)).to.equal(true)
    })
  })

  describe("getLeverageRatio", () => {
    describe("lifecycle / chronology", () => {
      context("junior tranche is not locked and senior tranche is not locked", () => {
        let juniorPool, strategy

        beforeEach(async () => {
          // eslint-disable-next-line @typescript-eslint/no-extra-semi
          ;({juniorPool, strategy} = await setupTest())
        })

        it("does not return the leverage ratio", async () => {
          const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
          const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
          expect(juniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))

          const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
          await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)
        })
      })

      context("junior tranche is locked and senior tranche is not locked", () => {
        context("leverage ratio has not been set", () => {
          let juniorPool, strategy, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, strategy, borrower} = await setupTest())
          })

          it("does not return the leverage ratio", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
            await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)
          })
        })
        context("leverage ratio has been set", () => {
          let juniorPool, strategy, owner, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, strategy, owner, borrower} = await setupTest())
          })

          it("returns the leverage ratio", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})
            await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)
          })

          it("does not return the leverage ratio if its locked-until timestamp is obsolete", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})
            await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

            // const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
            // const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
            // await juniorPool._modifyJuniorTrancheLockedUntil(juniorTrancheLockedUntil.add(new BN(1)))

            // const obsoleteLeverageRatio = strategy.getLeverageRatio(juniorPool.address)
            // await expect(obsoleteLeverageRatio).to.be.rejectedWith(LEVERAGE_RATIO_OBSOLETE_REGEXP)
          })
        })
      })

      context("junior tranche is locked and senior tranche is locked", () => {
        context("leverage ratio has not been set", () => {
          let juniorPool, strategy, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, strategy, borrower} = await setupTest())
          })

          it("does not return the leverage ratio", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})
            await juniorPool.lockPool({from: borrower})

            const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
            await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)
          })
        })
        context("leverage ratio has been set", () => {
          let juniorPool, strategy, owner, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, strategy, owner, borrower} = await setupTest())
          })

          it("returns the leverage ratio", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})
            await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)
            await juniorPool.lockPool({from: borrower})

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)
          })

          it("does not return the leverage ratio if its locked-until timestamp is not obsolete", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})
            await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

            const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
            const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)

            await juniorPool.lockPool({from: borrower})

            // await juniorPool._modifyJuniorTrancheLockedUntil(juniorTrancheLockedUntil)

            // const leverageRatio2 = strategy.getLeverageRatio(juniorPool.address)
            // await expect(leverageRatio2).to.be.rejectedWith(LEVERAGE_RATIO_EXPECTED_OBSOLETE_TIMESTAMP_REGEXP)
          })
        })
      })
    })
  })

  describe("setLeverageRatio", () => {
    describe("base", () => {
      let juniorPool, strategy, owner, borrower

      beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-extra-semi
        ;({juniorPool, strategy, owner, borrower} = await setupTest())
      })

      it("allows setting the leverage ratio to the minimum value of 0", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))
        const result = strategy.setLeverageRatio(
          juniorPool.address,
          new BN(0),
          juniorTrancheLockedUntil,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        await expect(result).to.be.fulfilled
      })
      it("allows setting the leverage ratio to the maximum value of 10 (adjusted for decimals)", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))
        const result = strategy.setLeverageRatio(
          juniorPool.address,
          new BN(String(10e18)),
          juniorTrancheLockedUntil,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        await expect(result).to.be.fulfilled
      })
      it("rejects setting the leverage ratio to greater than 10 (adjusted for decimals)", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))
        const result = strategy.setLeverageRatio(
          juniorPool.address,
          new BN(String(10e18)).add(new BN(1)),
          juniorTrancheLockedUntil,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        await expect(result).to.be.rejectedWith(/Leverage ratio must not exceed 10 \(adjusted for decimals\)\./)
      })
      it("rejects setting the leverage ratio with a locked-until timestamp of 0", async () => {
        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))
        const result = strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          new BN(0),
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        await expect(result).to.be.rejectedWith(/Cannot set leverage ratio if junior tranche is not locked\./)
      })
      it("rejects setting the leverage ratio with a locked-until timestamp less than that of the junior tranche", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(1))
        const result = strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil.sub(new BN(1)),
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        await expect(result).to.be.rejectedWith(/Invalid `juniorTrancheLockedUntil` timestamp\./)
      })
      it("rejects setting the leverage ratio with a locked-until timestamp greater than that of the junior tranche", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))
        const result = strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil.add(new BN(1)),
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        await expect(result).to.be.rejectedWith(/Invalid `juniorTrancheLockedUntil` timestamp\./)
      })
      it("sets the leverage ratio, for a locked-until timestamp that equals that of the junior tranche, while the senior tranche is unlocked", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))

        const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)
        const seniorTrancheLockedUntil = new BN(seniorTranche.lockedUntil)
        expect(seniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))

        await strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )

        const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)
      })
      it("rejects setting the leverage ratio, for a locked-until timestamp that equals that of the junior tranche, while the senior tranche is locked", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))

        await juniorPool.lockPool({from: borrower})

        const juniorTranche2 = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil2 = new BN(juniorTranche2.lockedUntil)
        expect(juniorTrancheLockedUntil2).to.be.bignumber.gt(juniorTrancheLockedUntil)

        const seniorTranche2 = await juniorPool.getTranche(TRANCHES.Senior)
        const seniorTrancheLockedUntil2 = new BN(seniorTranche2.lockedUntil)
        expect(seniorTrancheLockedUntil2).to.be.bignumber.equal(juniorTrancheLockedUntil2)

        const result = strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil2,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        await expect(result).to.be.rejectedWith(/Cannot set leverage ratio if senior tranche is locked\./)
      })
      it("allows setting the leverage ratio even if it's already been set", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

        const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

        await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO.mul(new BN(2)))

        const leverageRatio2 = await strategy.getLeverageRatio(juniorPool.address)
        expect(leverageRatio2).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO.mul(new BN(2)))
      })
      it("emits a LeverageRatioUpdated event", async () => {
        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))

        const receipt = await strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        expectEvent(receipt, "LeverageRatioUpdated", {
          pool: juniorPool.address,
          leverageRatio: EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil,
          version: DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
        })
      })
    })
    describe("onlySetterRole modifier", () => {
      let juniorPool, strategy, owner, borrower, person2

      beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-extra-semi
        ;({juniorPool, strategy, owner, borrower, person2} = await setupTest())
      })

      it("allows the owner, as the setter role, to set the leverage ratio", async () => {
        const ownerSetter = await strategy.hasRole(LEVERAGE_RATIO_SETTER_ROLE, owner)
        expect(ownerSetter).to.equal(true)

        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))

        const result = strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: owner}
        )
        await expect(result).to.be.fulfilled
      })
      it("allows a non-owner, as the setter role, to set the leverage ratio", async () => {
        await strategy.grantRole(LEVERAGE_RATIO_SETTER_ROLE, person2, {from: owner})
        const nonOwnerSetter = await strategy.hasRole(LEVERAGE_RATIO_SETTER_ROLE, person2)
        expect(nonOwnerSetter).to.equal(true)

        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))

        const result = strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: person2}
        )
        await expect(result).to.be.fulfilled
      })
      it("prohibits a non-owner who does not have the setter role from setting the leverage ratio", async () => {
        const nonOwnerSetter = await strategy.hasRole(LEVERAGE_RATIO_SETTER_ROLE, person2)
        expect(nonOwnerSetter).to.equal(false)

        await juniorPool.lockJuniorCapital({from: borrower})

        const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
        const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
        expect(juniorTrancheLockedUntil).to.be.bignumber.gt(new BN(0))

        const result = strategy.setLeverageRatio(
          juniorPool.address,
          EXPECTED_LEVERAGE_RATIO,
          juniorTrancheLockedUntil,
          DYNAMIC_LEVERAGE_RATIO_TEST_VERSION,
          {from: person2}
        )
        await expect(result).to.be.rejectedWith(/Must have leverage-ratio setter role to perform this action/)
      })
    })
  })

  describe("estimateInvestment", () => {
    describe("calculation", () => {
      let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

      beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-extra-semi
        ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
      })

      it("levers junior investment using the leverageRatio", async () => {
        await leverJuniorInvestment(juniorPool, strategy, juniorInvestmentAmount, owner, borrower, async () => {
          return await strategy.estimateInvestment(juniorPool.address)
        })
      })

      it("correctly handles decimal places, for a fractional leverageRatio", async () => {
        await leverFractionally(juniorPool, strategy, juniorInvestmentAmount, owner, borrower, async () => {
          return await strategy.estimateInvestment(juniorPool.address)
        })
      })
    })

    describe("lifecycle / chronology", () => {
      context("junior tranche is not locked and senior tranche is not locked", () => {
        let juniorPool, indexPool, strategy

        beforeEach(async () => {
          // eslint-disable-next-line @typescript-eslint/no-extra-semi
          ;({juniorPool, indexPool, strategy} = await setupTest())
        })

        it("does not return investment amount", async () => {
          const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
          await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)

          const juniorTranche = await juniorPool.getTranche(TRANCHES.Junior)
          const juniorTrancheLockedUntil = new BN(juniorTranche.lockedUntil)
          expect(juniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))

          const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)
          const seniorTrancheLockedUntil = new BN(seniorTranche.lockedUntil)
          expect(seniorTrancheLockedUntil).to.be.bignumber.equal(new BN(0))

          const amount = strategy.estimateInvestment(juniorPool.address)
          await expect(amount).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)
        })
      })

      context("junior tranche is locked and senior tranche is not locked", () => {
        context("leverage ratio has not been set", () => {
          let juniorPool, indexPool, strategy, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, borrower} = await setupTest())
          })

          it("does not return investment amount", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)

            const amount = strategy.estimateInvestment(juniorPool.address)
            await expect(amount).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)
          })
        })
        context("leverage ratio has been set", () => {
          context("base", () => {
            let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

            beforeEach(async () => {
              // eslint-disable-next-line @typescript-eslint/no-extra-semi
              ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
            })

            it("returns investment amount", async () => {
              await juniorPool.lockJuniorCapital({from: borrower})

              await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

              const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
              expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

              const amount = await strategy.estimateInvestment(juniorPool.address)
              expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
            })
          })

          context("senior principal is already partially invested", () => {
            let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

            beforeEach(async () => {
              // eslint-disable-next-line @typescript-eslint/no-extra-semi
              ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
            })

            it("would invest up to the levered amount", async () => {
              await juniorPool.lockJuniorCapital({from: borrower})

              await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

              const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
              expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

              const existingSeniorPrincipal = juniorInvestmentAmount.add(new BN(10))
              await juniorPool.deposit(TRANCHES.Senior, existingSeniorPrincipal)

              const amount = await strategy.estimateInvestment(juniorPool.address)
              expect(amount).to.bignumber.equal(
                juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS).sub(existingSeniorPrincipal)
              )
            })
          })

          context("senior principal already exceeds investment amount", () => {
            let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

            beforeEach(async () => {
              // eslint-disable-next-line @typescript-eslint/no-extra-semi
              ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
            })

            it("does not invest", async () => {
              await juniorPool.lockJuniorCapital({from: borrower})

              await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

              const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
              expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

              const existingSeniorPrincipal = juniorInvestmentAmount.add(
                juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS).add(new BN(1))
              )
              await juniorPool.deposit(TRANCHES.Senior, existingSeniorPrincipal)

              const amount = await strategy.estimateInvestment(juniorPool.address)
              expect(amount).to.bignumber.equal(new BN(0))
            })
          })
        })
      })

      context("junior tranche is locked and senior tranche is locked", () => {
        context("leverage ratio has not been set", () => {
          let juniorPool, indexPool, strategy, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, borrower} = await setupTest())
          })

          it("does not return investment amount", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})
            await juniorPool.lockPool({from: borrower})

            const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
            await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)

            const amount = strategy.estimateInvestment(juniorPool.address)
            await expect(amount).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)
          })
        })
        context("leverage ratio has been set", () => {
          let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
          })

          it("returns investment amount", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

            const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
            expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

            await juniorPool.lockPool({from: borrower})

            const amount = await strategy.estimateInvestment(juniorPool.address)
            expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
          })
        })
      })
    })
  })

  describe("invest", () => {
    describe("calculation", () => {
      let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

      beforeEach(async () => {
        // eslint-disable-next-line @typescript-eslint/no-extra-semi
        ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
      })

      it("levers junior investment using the leverageRatio", async () => {
        await leverJuniorInvestment(juniorPool, strategy, juniorInvestmentAmount, owner, borrower, async () => {
          return await strategy.invest(juniorPool.address)
        })
      })

      it("correctly handles decimal places, for a fractional leverageRatio", async () => {
        await leverFractionally(juniorPool, strategy, juniorInvestmentAmount, owner, borrower, async () => {
          return await strategy.invest(juniorPool.address)
        })
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
          const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
          await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)

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
        context("leverage ratio has not been set", () => {
          let juniorPool, indexPool, strategy, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, borrower} = await setupTest())
          })

          it("does not invest", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})

            const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
            await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)

            const amount = strategy.invest(juniorPool.address)
            await expect(amount).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)
          })
        })
        context("leverage ratio has been set", () => {
          context("base", () => {
            let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

            beforeEach(async () => {
              // eslint-disable-next-line @typescript-eslint/no-extra-semi
              ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
            })

            it("invests", async () => {
              await juniorPool.lockJuniorCapital({from: borrower})

              await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

              const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
              expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

              const amount = await strategy.invest(juniorPool.address)
              expect(amount).to.bignumber.equal(juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS))
            })
          })

          context("senior principal is already partially invested", () => {
            let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

            beforeEach(async () => {
              // eslint-disable-next-line @typescript-eslint/no-extra-semi
              ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
            })

            it("invests up to the levered amount", async () => {
              await juniorPool.lockJuniorCapital({from: borrower})

              await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

              const leverageRatio = await strategy.getLeverageRatio(juniorPool.address)
              expect(leverageRatio).to.bignumber.equal(EXPECTED_LEVERAGE_RATIO)

              const existingSeniorPrincipal = juniorInvestmentAmount.add(new BN(10))
              await juniorPool.deposit(TRANCHES.Senior, existingSeniorPrincipal)

              const amount = await strategy.invest(juniorPool.address)
              expect(amount).to.bignumber.equal(
                juniorInvestmentAmount.mul(leverageRatio).div(LEVERAGE_RATIO_DECIMALS).sub(existingSeniorPrincipal)
              )
            })
          })

          context("senior principal already exceeds investment amount", () => {
            let juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower

            beforeEach(async () => {
              // eslint-disable-next-line @typescript-eslint/no-extra-semi
              ;({juniorPool, indexPool, strategy, juniorInvestmentAmount, owner, borrower} = await setupTest())
            })

            it("does not invest", async () => {
              await juniorPool.lockJuniorCapital({from: borrower})

              await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)

              const existingSeniorPrincipal = juniorInvestmentAmount.add(
                juniorInvestmentAmount.mul(EXPECTED_LEVERAGE_RATIO).div(LEVERAGE_RATIO_DECIMALS).add(new BN(1))
              )
              await juniorPool.deposit(TRANCHES.Senior, existingSeniorPrincipal)

              const amount = await strategy.invest(juniorPool.address)
              expect(amount).to.bignumber.equal(new BN(0))
            })
          })
        })
      })

      context("junior tranche is locked and senior tranche is locked", () => {
        context("leverage ratio has not been set", () => {
          let juniorPool, indexPool, strategy, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, borrower} = await setupTest())
          })

          it("does not invest", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})
            await juniorPool.lockPool({from: borrower})

            const leverageRatioNotSet = strategy.getLeverageRatio(juniorPool.address)
            await expect(leverageRatioNotSet).to.be.rejectedWith(LEVERAGE_RATIO_NOT_SET_REGEXP)

            const amount = await strategy.invest(juniorPool.address)
            expect(amount).to.bignumber.equal(new BN(0))
          })
        })
        context("leverage ratio has been set", () => {
          let juniorPool, indexPool, strategy, owner, borrower

          beforeEach(async () => {
            // eslint-disable-next-line @typescript-eslint/no-extra-semi
            ;({juniorPool, indexPool, strategy, owner, borrower} = await setupTest())
          })

          it("does not invest", async () => {
            await juniorPool.lockJuniorCapital({from: borrower})
            await setLeverageRatio(juniorPool, strategy, owner, EXPECTED_LEVERAGE_RATIO)
            await juniorPool.lockPool({from: borrower})

            const amount = await strategy.invest(juniorPool.address)
            expect(amount).to.bignumber.equal(new BN(0))
          })
        })
      })
    })
  })
})
