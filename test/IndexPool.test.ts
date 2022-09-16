/* global web3 */
import {
  interestAprAsBN,
  TRANCHES,
  MAX_UINT,
  OWNER_ROLE,
  PAUSER_ROLE,
  ETHDecimals,
} from "../scripts/blockchain_scripts/deployHelpers"
import {CONFIG_KEYS} from "../scripts/blockchain_scripts/configKeys"
import hre, { ethers } from "hardhat"
const {deployments, artifacts, web3} = hre
const CreditLine = artifacts.require("CreditLine")
import {
  advanceTime,
  expect,
  BN,
  getBalance,
  erc20Transfer,
  erc20Approve,
  expectAction,
  decimals,
  USDC_DECIMALS,
  SECONDS_PER_DAY,
  usdcVal,
  rwaTolerance,
  tolerance,
  bnToHex,
  bnToBnjs,
  bnjsToHex
  // decodeLogs,
  // decodeAndGetFirstLog,
} from "./testHelpers"
import {expectEvent} from "@openzeppelin/test-helpers"
import {ecsign} from "ethereumjs-util"
import {getApprovalDigest, getWallet} from "./permitHelpers"
import {assertNonNullable} from "../scripts/blockchain_scripts/utils"
import {
  deployBaseFixture,
  deployUninitializedCreditLineFixture,
  deployUninitializedJuniorPoolFixture,
  deployJuniorPoolWithNAOSFactoryFixture,
} from "./util/fixtures"
// TODO: check these event
// DepositMade,
// InvestmentMadeInSenior,
// ReserveFundsCollected,
// WithdrawalMade,
import {
  TestIndexPool,
} from "../types"
const { BigNumber } = ethers
const WITHDRAWL_FEE_DENOMINATOR = new BN(200)

const TEST_TIMEOUT = 30_000

const simulateMaliciousJuniorPool = async (naosConfig: any, person2: any): Promise<string> => {
  // Simulate someone deploying their own malicious JuniorPool using our contracts
  const {juniorPool: unknownPool} = await deployUninitializedJuniorPoolFixture()
  const {creditLine} = await deployUninitializedCreditLineFixture()
  await creditLine.initialize(
    naosConfig.address,
    person2,
    person2,
    bnToHex(usdcVal(1000)),
    bnToHex(interestAprAsBN("0")),
    bnToHex(new BN(1)),
    bnToHex(new BN(10)),
    bnToHex(interestAprAsBN("0")),
    bnToHex(new BN(30))
  )
  await unknownPool.initialize(
    naosConfig.address,
    person2,
    bnToHex(new BN(20)),
    bnToHex(usdcVal(1000)),
    bnToHex(interestAprAsBN("0")),
    bnToHex(new BN(1)),
    bnToHex(new BN(10)),
    bnToHex(interestAprAsBN("0")),
    bnToHex(new BN(30)),
    bnToHex(new BN(0)),
    []
  )
  const signer = await ethers.getSigner(person2)
  await unknownPool.connect(signer).lockJuniorCapital({from: person2})

  return unknownPool.address
}

describe("IndexPool", () => {
  let accounts, owner, person2, person3, reserve, borrower

  let indexPool: TestIndexPool, indexPoolFixedStrategy, usdc, rwa, naosConfig, juniorPool, creditLine

  const interestApr = interestAprAsBN("5.00")
  const paymentPeriodInDays = new BN(30)
  const lateFeeApr = new BN(0)
  const limit = usdcVal(100000)
  const termInDays = new BN(365)
  const juniorFeePercent = new BN(20)
  const depositAmount = new BN(4).mul(USDC_DECIMALS)
  const withdrawAmount = new BN(2).mul(USDC_DECIMALS)
  const decimalsDelta = decimals.div(USDC_DECIMALS)
  const depositMadeEventHash = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

  const makeDeposit = async (person?: string, amount?: BN) => {
    amount = amount || depositAmount
    person = person || person2
    const signer = await ethers.getSigner(person as string)
    return await indexPool.connect(signer).deposit(bnToHex(amount))
  }
  const makeWithdraw = async (person?: string, usdcAmount?: BN) => {
    usdcAmount = usdcAmount || withdrawAmount
    person = person || person2
    const signer = await ethers.getSigner(person as string)
    return await indexPool.connect(signer).withdraw(bnToHex(usdcAmount))
  }

  const makeWithdrawInRWA = async (person, rwaAmount) => {
    const signer = await ethers.getSigner(person)
    return await indexPool.connect(signer).withdrawInRWA(bnToHex(rwaAmount))
  }

  const setupTest = deployments.createFixture(async ({deployments}) => {
    const {
      indexPool: _indexPool,
      indexPoolFixedStrategy,
      usdc,
      rwa,
      naosFactory,
      naosConfig,
      poolTokens,
    } = await deployBaseFixture()
    // A bit of setup for our test users
    await erc20Approve(usdc, _indexPool.address, usdcVal(100000), [person2])
    await erc20Transfer(usdc, [person2, person3], usdcVal(10000), owner)
    await naosConfig.setTreasuryReserve(reserve)

    await naosConfig.bulkAddToGoList([owner, person2, person3, reserve, _indexPool.address])
    ;({juniorPool, creditLine} = await deployJuniorPoolWithNAOSFactoryFixture({
      borrower,
      usdcAddress: usdc.address,
      limit,
      interestApr,
      paymentPeriodInDays,
      termInDays,
      lateFeeApr,
      juniorFeePercent,
      id: "JuniorPool",
    }))

    return {
      usdc,
      indexPool: _indexPool as TestIndexPool,
      indexPoolFixedStrategy,
      juniorPool,
      creditLine,
      rwa,
      naosConfig,
      poolTokens,
    }
  })

  beforeEach(async () => {
    // Pull in our unlocked accounts
    accounts = await web3.eth.getAccounts()
    ;[owner, person2, person3, reserve] = accounts
    borrower = person2
    ;({usdc, indexPool, indexPoolFixedStrategy, juniorPool, creditLine, rwa, naosConfig} = await setupTest())
  })

  describe("Access Controls", () => {
    it("sets the owner", async () => {
      expect(await indexPool.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await indexPool.getRoleAdmin(OWNER_ROLE)).to.equal(OWNER_ROLE)
    })

    it("sets the pauser", async () => {
      expect(await indexPool.hasRole(PAUSER_ROLE, owner)).to.equal(true)
      expect(await indexPool.getRoleAdmin(PAUSER_ROLE)).to.equal(OWNER_ROLE)
    })

    it("allows the owner to set new addresses as roles", async () => {
      expect(await indexPool.hasRole(OWNER_ROLE, person2)).to.equal(false)
      await indexPool.grantRole(OWNER_ROLE, person2, {from: owner})
      expect(await indexPool.hasRole(OWNER_ROLE, person2)).to.equal(true)
    })

    it("should not allow anyone else to add an owner", async () => {
      return expect(indexPool.grantRole(OWNER_ROLE, person2, {from: person3})).to.be.rejected
    })
  })

  describe("Pausability", () => {
    describe("after pausing", async () => {
      const testSetup = deployments.createFixture(async () => {
        await makeDeposit()
        await indexPool.pause()
        await naosConfig.addToGoList(indexPool.address)
      })

      beforeEach(async () => {
        await testSetup()
      })

      it("disallows deposits", async () => {
        return expect(makeDeposit()).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows withdrawing", async () => {
        return expect(makeWithdraw()).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows invest", async () => {
        await expect(indexPool.invest(juniorPool.address)).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows redeem", async () => {
        return expect(indexPool.redeem(juniorPool.address)).to.be.rejectedWith(/Pausable: paused/)
      })

      it("disallows writedown", async () => {
        return expect(indexPool.writedown(juniorPool.address)).to.be.rejectedWith(/Pausable: paused/)
      })

      it("allows unpausing", async () => {
        await indexPool.unpause()
        return expect(makeDeposit()).to.be.fulfilled
      })
    })

    describe("actually pausing", async () => {
      it("should allow the owner to pause", async () => {
        return expect(indexPool.pause()).to.be.fulfilled
      })
      it("should disallow non-owner to pause", async () => {
        const signer = await ethers.getSigner(person2)
        return expect(indexPool.connect(signer).pause()).to.be.rejectedWith(/Must have pauser role/)
      })
    })
  })

  describe("updateNAOSConfig", () => {
    describe("setting it", async () => {
      it("should allow the owner to set it", async () => {
        await naosConfig.setAddress(CONFIG_KEYS.NAOSConfig, person2)
        return expectAction(() => indexPool.updateNAOSConfig({from: owner})).toChange([
          [() => indexPool.config(), {to: person2, bignumber: false}],
        ])
      })
      it("should disallow non-owner to set", async () => {
        const signer = await ethers.getSigner(person2)
        return expect(indexPool.connect(signer).updateNAOSConfig()).to.be.rejectedWith(/Must have admin/)
      })

      it("should emit an event", async () => {
        const newConfig = await deployments.deploy("NAOSConfig", {from: owner})

        await naosConfig.setNAOSConfig(newConfig.address)
        const tx = await indexPool.updateNAOSConfig({from: owner})
        // const receipt = await tx.wait()
        // expectEvent(tx, "NAOSConfigUpdated", {
        //   who: owner,
        //   configAddress: newConfig.address,
        // })
      })
    })
  })

  describe("deposit", () => {
    describe("before you have approved the senior pool to transfer funds on your behalf", async () => {
      it("should fail", async () => {
        const expectedErr = /transfer amount exceeds allowance/
        return expect(makeDeposit(person3)).to.be.rejectedWith(expectedErr)
      })
    })

    describe("after you have approved the senior pool to transfer funds", async () => {
      let capitalProvider

      const testSetup = deployments.createFixture(async () => {
        let signer = await ethers.getSigner(person2)
        await usdc.connect(signer).approve(indexPool.address, bnToHex(new BN(100000).mul(USDC_DECIMALS)))
        signer = await ethers.getSigner(owner)
        await usdc.connect(signer).approve(indexPool.address, bnToHex(new BN(100000).mul(USDC_DECIMALS)))
        capitalProvider = person2
      })

      beforeEach(async () => {
        await testSetup()
      })

      it("increases the senior pool's balance of the ERC20 token when you call deposit", async () => {
        const balanceBefore = await getBalance(indexPool.address, usdc)
        await makeDeposit()
        const balanceAfter = await getBalance(indexPool.address, usdc)
        const delta = balanceAfter.sub(balanceBefore)
        expect(delta).to.bignumber.equal(depositAmount)
      })

      it("decreases the depositors balance of the ERC20 token when you call deposit", async () => {
        const balanceBefore = await getBalance(capitalProvider, usdc)
        await makeDeposit()
        const balanceAfter = await getBalance(capitalProvider, usdc)
        const delta = balanceBefore.sub(balanceAfter)
        expect(delta).to.bignumber.equal(depositAmount)
      })

      it("gives the depositor the correct amount of RWA", async () => {
        await makeDeposit()
        const rwaBalance = await getBalance(person2, rwa)
        expect(rwaBalance).to.bignumber.equal(depositAmount.mul(decimalsDelta))
      })

      it("tracks other accounting correctly on RWA", async () => {
        const totalSupplyBefore = await rwa.totalSupply()
        await makeDeposit()
        const totalSupplyAfter = await rwa.totalSupply()
        expect(bnToBnjs(totalSupplyAfter.sub(totalSupplyBefore))).to.bignumber.equal(depositAmount.mul(decimalsDelta))
      })

      // it("emits an event with the correct data", async () => {
      //   const result = await makeDeposit()
      //   const event = decodeAndGetFirstLog<DepositMade>(result.receipt.rawLogs, indexPool, "DepositMade")

      //   expect(event.event).to.equal("DepositMade")
      //   expect(event.args.capitalProvider).to.equal(capitalProvider)
      //   expect(event.args.amount).to.bignumber.equal(depositAmount)
      //   expect(event.args.shares).to.bignumber.equal(depositAmount.mul(decimalsDelta))
      // })

      it("increases the totalShares, even when two different people deposit", async () => {
        const secondDepositAmount = new BN(1).mul(USDC_DECIMALS)
        await makeDeposit()
        await makeDeposit(owner, secondDepositAmount)
        const totalShares = await rwa.totalSupply()
        const totalDeposited = depositAmount.mul(decimalsDelta).add(secondDepositAmount.mul(decimalsDelta))
        expect(bnToBnjs(totalShares)).to.bignumber.equal(totalDeposited)
      })
    })
  })

  describe("depositWithPermit", async () => {
    it("deposits with permit", async () => {
      const capitalProviderAddress = person2.toLowerCase()
      const nonce = await usdc.nonces(capitalProviderAddress)
      const deadline = MAX_UINT
      const value = usdcVal(100)

      // Create signature for permit
      const digest = await getApprovalDigest({
        token: usdc,
        owner: capitalProviderAddress,
        spender: indexPool.address.toLowerCase(),
        value,
        nonce,
        deadline,
      })
      const wallet = await getWallet(capitalProviderAddress)
      assertNonNullable(wallet)
      const {v, r, s} = ecsign(Buffer.from(digest.slice(2), "hex"), Buffer.from(wallet.privateKey.slice(2), "hex"))

      // Sanity check that deposit is correct
      // const signer = await ethers.getSigner(capitalProviderAddress)
      // await expectAction(() =>
      //   (indexPool as any).conenct(signer).depositWithPermit(value, deadline, v, r, s)
      // ).toChange([
      //   [() => getBalance(person2, usdc), {by: value.neg()}],
      //   [() => getBalance(indexPool.address, usdc), {by: value}],
      //   [() => getBalance(person2, rwa), {by: value.mul(decimalsDelta)}],
      // ])

      // // Verify that permit creates allowance for amount only
      // expect(bnToBnjs(await usdc.allowance(person2, indexPool.address))).to.bignumber.eq("0")
    })
  })

  describe("getNumShares", () => {
    it("calculates correctly", async () => {
      const amount = 3000
      const sharePrice = await indexPool.sharePrice()
      const numShares = await indexPool._getNumShares(amount)
      expect(bnToBnjs(numShares)).to.bignumber.equal(
        new BN(amount).mul(decimals.div(USDC_DECIMALS)).mul(decimals).div(bnToBnjs(sharePrice))
      )
    })
  })

  describe("hard limits", async () => {
    describe("totalFundsLimit", async () => {
      describe("once it's set", async () => {
        const limit = new BN(5000)
        const testSetup = deployments.createFixture(async () => {
          await naosConfig.setNumber(CONFIG_KEYS.TotalFundsLimit, bnToHex(limit.mul(USDC_DECIMALS)))
        })

        beforeEach(async () => {
          await testSetup()
        })

        it("should accept deposits before the limit is reached", async () => {
          return expect(makeDeposit(person2, new BN(1000).mul(USDC_DECIMALS))).to.be.fulfilled
        })

        it("should accept everything right up to the limit", async () => {
          return expect(makeDeposit(person2, new BN(limit).mul(USDC_DECIMALS))).to.be.fulfilled
        })

        it("should fail if you're over the limit", async () => {
          return expect(makeDeposit(person2, new BN(limit).add(new BN(1)).mul(USDC_DECIMALS))).to.be.rejectedWith(
            /put the index pool over the total limit/
          )
        })
      })
    })
  })

  describe("assets matching liabilities", async () => {
    describe("when there is a super tiny rounding error", async () => {
      it("should still work", async () => {
        // This share price will cause a rounding error of 1 atomic unit.
        const testSharePrice = new BN(String(1.23456789 * (ETHDecimals as any)))
        await indexPool._setSharePrice(bnToHex(testSharePrice))

        return expect(makeDeposit(person2, new BN(2500).mul(USDC_DECIMALS))).to.be.fulfilled
      })
    })
  })

  describe("USDC Mantissa", async () => {
    it("should equal 1e6", async () => {
      expect(bnToBnjs(await indexPool.usdcMantissa())).to.bignumber.equal(USDC_DECIMALS)
    })
  })

  describe("RWA Mantissa", async () => {
    it("should equal 1e18", async () => {
      expect(bnToBnjs(await indexPool.rwaMantissa())).to.bignumber.equal(decimals)
    })
  })

  describe("usdcToRWA", async () => {
    it("should equal 1e12", async () => {
      expect(bnToBnjs(await indexPool.usdcToRWA(bnToHex(new BN(1))))).to.bignumber.equal(new BN(1e12))
    })
  })

  describe("estimateInvestment", () => {
    const juniorInvestmentAmount = usdcVal(10000)
    const testSetup = deployments.createFixture(async () => {
      await erc20Approve(usdc, indexPool.address, usdcVal(100000), [owner])
      await makeDeposit(owner, usdcVal(100000))
      await naosConfig.addToGoList(indexPool.address)
      await juniorPool.deposit(TRANCHES.Junior, bnToHex(juniorInvestmentAmount))
    })

    beforeEach(async () => {
      await testSetup()
    })

    context("Pool is not valid", () => {
      it("reverts", async () => {
        const unknownPoolAddress = await simulateMaliciousJuniorPool(naosConfig, person2)

        await expect(indexPool.invest(unknownPoolAddress)).to.be.rejectedWith(/Pool must be valid/)
      }).timeout(TEST_TIMEOUT)
    })

    // it("should return the strategy's estimated investment", async () => {
    //   expect(await naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy)).to.equal(indexPoolFixedStrategy.address)
    //   const investmentAmount = await indexPoolFixedStrategy.estimateInvestment.call(
    //     indexPool.address,
    //     juniorPool.address
    //   )
    //   const estimate = await indexPool.estimateInvestment(juniorPool.address)
    //   await expect(bnToBnjs(estimate)).to.bignumber.equal(bnToBnjs(investmentAmount))
    // })
  })

  describe("invest", () => {
    const juniorInvestmentAmount = usdcVal(10000)

    const testSetup = deployments.createFixture(async () => {
      await erc20Approve(usdc, indexPool.address, usdcVal(100000), [owner])
      await makeDeposit(owner, usdcVal(100000))
      await naosConfig.addToGoList(indexPool.address)
      await juniorPool.deposit(TRANCHES.Junior, bnToHex(juniorInvestmentAmount))
    })

    beforeEach(async () => {
      await testSetup()
    })

    context("called by non-governance", async () => {
      it("should not revert", async () => {
        return expect(indexPool.invest(juniorPool.address, {from: person2})).to.not.be.rejectedWith(
          /Must have admin role to perform this action/i
        )
      })
    })

    context("Pool is not valid", () => {
      it("reverts", async () => {
        const unknownPoolAddress = await simulateMaliciousJuniorPool(naosConfig, person2)

        await expect(indexPool.invest(unknownPoolAddress)).to.be.rejectedWith(/Pool must be valid/)
      }).timeout(TEST_TIMEOUT)
    })

    context("Pool's senior tranche is not empty", () => {
      it("allows investing in the senior tranche", async () => {
        await juniorPool._setSeniorTranchePrincipalDeposited(bnToHex(new BN(1)))
        const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)
        expect(bnToBnjs(seniorTranche.principalDeposited)).to.bignumber.equal(new BN(1))

        const signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        expect(await naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy)).to.equal(
          indexPoolFixedStrategy.address
        )
        const investmentAmount = await indexPoolFixedStrategy.invest(juniorPool.address)

        await indexPool.invest(juniorPool.address)

        const seniorTranche2 = await juniorPool.getTranche(TRANCHES.Senior)
        expect(bnToBnjs(seniorTranche2.principalDeposited)).to.bignumber.equal(bnToBnjs(investmentAmount).add(new BN(1)))
      })
    })

    context("strategy amount is > 0", () => {
      it("should deposit amount into the senior tranche", async () => {
        // Make the strategy invest
        const signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        expect(await naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy)).to.equal(
          indexPoolFixedStrategy.address
        )
        const investmentAmount = await indexPoolFixedStrategy.invest(juniorPool.address)

        // await expectAction(async () => await indexPool.invest(juniorPool.address)).toChange([
        //   [async () => await getBalance(indexPool.address, usdc), {by: investmentAmount.neg()}],
        //   [
        //     async () => new BN((await juniorPool.getTranche(TRANCHES.Senior)).principalDeposited),
        //     {by: investmentAmount},
        //   ],
        // ])
      })

      it("should emit an InvestmentMadeInSenior event", async () => {
        // Make the strategy invest
        const signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        expect(await naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy)).to.equal(
          indexPoolFixedStrategy.address
        )
        const investmentAmount = await indexPoolFixedStrategy.invest(juniorPool.address)

        const receipt = await indexPool.invest(juniorPool.address)
        // const event = decodeAndGetFirstLog<InvestmentMadeInSenior>(
        //   receipt.receipt.rawLogs,
        //   indexPool,
        //   "InvestmentMadeInSenior"
        // )

        // expect(event.event).to.equal("InvestmentMadeInSenior")
        // expect(event.args.juniorPool).to.equal(juniorPool.address)
        // expect(event.args.amount).to.bignumber.equal(investmentAmount)
      })

      it("should track the investment in the assets calculation", async () => {
        // Make the strategy invest
        const signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        expect(await naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy)).to.equal(
          indexPoolFixedStrategy.address
        )
        const investmentAmount = await indexPoolFixedStrategy.invest(juniorPool.address)

        // await expectAction(() => indexPool.invest(juniorPool.address)).toChange([
        //   [indexPool.totalLoansOutstanding, {by: bnToBnjs(investmentAmount)}],
        //   [() => getBalance(indexPool.address, usdc), {by: bnToBnjs(investmentAmount).neg()}],
        //   [indexPool.assets, {by: new BN(0)}], // loans outstanding + balance cancel out
        // ])
      })
    })

    context("strategy amount is 0", async () => {
      it("reverts", async () => {
        // Junior tranche is still open, so investment amount should be 0
        expect(await naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy)).to.equal(
          indexPoolFixedStrategy.address
        )
        const investmentAmount = await indexPoolFixedStrategy.invest(juniorPool.address)
        expect(bnToBnjs(investmentAmount)).to.bignumber.equal(new BN(0))

        await expect(indexPool.invest(juniorPool.address)).to.be.rejectedWith(/amount must be positive/)
      })
    })

    context("strategy amount exceeds tranched pool's limit", async () => {
      it("allows investing in the senior tranche", async () => {
        // NOTE: This test is a relic from when we considered prohibiting an investment
        // amount that exceeded the tranched pool's limit, but then decided we didn't want
        // to prohibit that, so that we are able to maintain the leverage ratio in a case
        // where the juniors take "more than their share".

        const expectedMaxLimit = usdcVal(100000)
        const creditLine = await CreditLine.at(await juniorPool.creditLine())
        expect(bnToBnjs(await creditLine.maxLimit())).to.bignumber.equal(expectedMaxLimit)

        const signer = await ethers.getSigner(borrower)
        await juniorPool.connect(signer).lockJuniorCapital()
        expect(await naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy)).to.equal(
          indexPoolFixedStrategy.address
        )
        const investmentAmount = await indexPoolFixedStrategy.invest(juniorPool.address)

        const reducedLimit = investmentAmount.sub(BigNumber.from(1))
        await juniorPool._setLimit(bnjsToHex(reducedLimit))
        expect(bnToBnjs(await creditLine.limit())).to.bignumber.equal(bnToBnjs(reducedLimit))

        await indexPool.invest(juniorPool.address)

        const seniorTranche = await juniorPool.getTranche(TRANCHES.Senior)
        expect(bnToBnjs(seniorTranche.principalDeposited)).to.bignumber.equal(bnToBnjs(investmentAmount))
      })
    })
  })

  describe("redeem", async () => {
    let tokenAddress, reserveAddress, poolTokens
    const juniorInvestmentAmount = usdcVal(100)

    beforeEach(async () => {
      reserveAddress = await naosConfig.getAddress(CONFIG_KEYS.TreasuryReserve)
      tokenAddress = await naosConfig.getAddress(CONFIG_KEYS.PoolTokens)
      poolTokens = await artifacts.require("PoolTokens").at(tokenAddress)

      await erc20Approve(usdc, indexPool.address, usdcVal(100000), [owner])
      await makeDeposit(owner, usdcVal(100000))
      await naosConfig.addToGoList(indexPool.address)

      await juniorPool.deposit(TRANCHES.Junior, bnToHex(juniorInvestmentAmount))
    })

    it("should redeem the maximum from the JuniorPool", async () => {
      // Make the senior pool invest
      const signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()
      await indexPool.invest(juniorPool.address)

      // Simulate repayment ensuring a full term has passed
      await juniorPool.connect(signer).lockPool()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))
      await advanceTime({days: termInDays.toNumber()})
      const payAmount = usdcVal(105)
      await erc20Approve(usdc, juniorPool.address, payAmount, [borrower])
      await juniorPool.connect(signer).pay(bnToHex(payAmount))

      const tokenId = await poolTokens.tokenOfOwnerByIndex(indexPool.address, 0)

      const balanceBefore = await usdc.balanceOf(indexPool.address)
      const tokenInfoBefore = await poolTokens.getTokenInfo(tokenId)
      const originalReserveBalance = await getBalance(reserveAddress, usdc)

      await indexPool.redeem(bnToHex(tokenId))

      const balanceAfter = await usdc.balanceOf(indexPool.address)
      const tokenInfoAfter = await poolTokens.getTokenInfo(tokenId)
      const newReserveBalance = await getBalance(reserveAddress, usdc)

      const interestRedeemed = new BN(tokenInfoAfter.interestRedeemed).sub(new BN(tokenInfoBefore.interestRedeemed))
      const principalRedeemed = new BN(tokenInfoAfter.principalRedeemed).sub(new BN(tokenInfoBefore.principalRedeemed))

      // Junior contributed 100$, senior levered by 4x (400$). Total limit 500$. Since
      // everything was paid back, senior can redeem full amount.
      expect(principalRedeemed).to.bignumber.equal(usdcVal(400))
      // $5 of interest * (4/5) * (1 - (0.2 + 0.1)) = $2.8 where 0.2 is juniorFeePercent and 0.1 is protocolFee
      expect(interestRedeemed).to.bignumber.equal(new BN(2.8 * USDC_DECIMALS.toNumber()))

      expect(bnToBnjs(balanceAfter)).to.bignumber.gte(bnToBnjs(balanceBefore))
      expect(bnToBnjs(balanceAfter.sub(balanceBefore))).to.bignumber.equal(interestRedeemed.add(principalRedeemed))
      expect(newReserveBalance).to.bignumber.eq(originalReserveBalance)
    })

    it("should adjust the share price accounting for new interest redeemed", async () => {
      // Make the senior pool invest
      const signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()
      await indexPool.connect(signer).invest(juniorPool.address)

      // Simulate repayment ensuring a full term has passed
      await juniorPool.connect(signer).lockPool()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))
      await advanceTime({days: termInDays.toNumber()})
      const payAmount = usdcVal(105)
      await erc20Approve(usdc, juniorPool.address, payAmount, [borrower])
      await juniorPool.connect(signer).pay(bnToHex(payAmount))

      const tokenId = await poolTokens.tokenOfOwnerByIndex(indexPool.address, 0)

      const tokenInfoBefore = await poolTokens.getTokenInfo(tokenId)
      const originalSharePrice = await indexPool.sharePrice()

      await indexPool.redeem(bnToHex(tokenId))

      const tokenInfoAfter = await poolTokens.getTokenInfo(tokenId)
      const newSharePrice = await indexPool.sharePrice()

      const interestRedeemed = bnToBnjs(tokenInfoAfter.interestRedeemed).sub(bnToBnjs(tokenInfoBefore.interestRedeemed))

      const expectedSharePrice = interestRedeemed
        .mul(decimals.div(USDC_DECIMALS))
        .mul(decimals)
        .div(bnToBnjs(await rwa.totalSupply()))
        .add(bnToBnjs(originalSharePrice))

      expect(bnToBnjs(newSharePrice)).to.bignumber.gt(bnToBnjs(originalSharePrice))
      expect(bnToBnjs(newSharePrice)).to.bignumber.equal(expectedSharePrice)
    })

    it("should emit events for interest, principal, and reserve", async () => {
      // Make the senior pool invest
      const signer = await ethers.getSigner(borrower)
      await juniorPool.connect(signer).lockJuniorCapital()
      await indexPool.invest(juniorPool.address)

      // Simulate repayment ensuring a full term has passed
      await juniorPool.connect(signer).lockPool()
      await juniorPool.connect(signer).drawdown(bnToHex(usdcVal(100)))
      await advanceTime({days: termInDays.toNumber()})
      const payAmount = usdcVal(105)
      await erc20Approve(usdc, juniorPool.address, payAmount, [borrower])
      await juniorPool.connect(signer).pay(bnToHex(payAmount))

      const tokenId = await poolTokens.tokenOfOwnerByIndex(indexPool.address, 0)

      const tokenInfoBefore = await poolTokens.getTokenInfo(bnToHex(tokenId))

      const receipt = await indexPool.redeem(bnToHex(tokenId))

      const tokenInfoAfter = await poolTokens.getTokenInfo(bnToHex(tokenId))
      const interestRedeemed = new BN(tokenInfoAfter.interestRedeemed).sub(new BN(tokenInfoBefore.interestRedeemed))
      const principalRedeemed = new BN(tokenInfoAfter.principalRedeemed).sub(new BN(tokenInfoBefore.principalRedeemed))

      // expectEvent(receipt, "InterestCollected", {
      //   payer: juniorPool.address,
      //   amount: interestRedeemed,
      // })

      // expectEvent(receipt, "PrincipalCollected", {
      //   payer: juniorPool.address,
      //   amount: principalRedeemed,
      // })

      // // No reserve funds should be collected for a regular redeem
      // expectEvent.notEmitted(receipt, "ReserveFundsCollected")
    })
  })
})
