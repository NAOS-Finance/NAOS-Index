import hre, { ethers } from "hardhat"
const {deployments, artifacts, web3} = hre
import {expect, expectAction, BN, usdcVal, bnToHex, bnToBnjs} from "./testHelpers"
import {expectEvent} from "@openzeppelin/test-helpers"
import {NAOSFactory, NAOSConfig} from "../types"
import {interestAprAsBN} from "../scripts/blockchain_scripts/deployHelpers"
import {deployBaseFixture} from "./util/fixtures"

// TODO: update expect event
describe("NAOSFactory", async () => {
  const testSetup = deployments.createFixture(async ({deployments, getNamedAccounts}) => {
    const {naosFactory, naosConfig, ...deployed} = await deployBaseFixture()
    const [owner, borrower, otherPerson] = await web3.eth.getAccounts()
    const borrowerRole = await naosFactory.BORROWER_ROLE()
    await naosFactory.grantRole(borrowerRole, borrower as string, {from: owner})
    return {
      naosFactory,
      naosConfig,
      owner: owner as string,
      borrower: borrower as string,
      otherPerson: otherPerson as string,
      ...deployed,
    }
  })

  let owner: string
  let otherPerson: string
  let borrower: string
  let naosFactory: NAOSFactory
  let naosConfig: NAOSConfig
  beforeEach(async function () {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({owner, otherPerson, borrower, naosConfig, naosFactory} = await testSetup())
  })

  describe("createPool", () => {
    const juniorFeePercent = new BN(20)
    const limit = usdcVal(5000)
    const interestApr = interestAprAsBN("0.05")
    const paymentPeriodInDays = new BN("30")
    const principalGracePeriod = new BN("30")
    const termInDays = new BN("360")
    const lateFeeApr = new BN("0")
    const fundableAt = new BN("0")
    const allowedUIDTypes = []

    it("user with admin role can call", async () => {
      const caller = owner
      const adminRole = await naosFactory.OWNER_ROLE()

      expect(await naosFactory.hasRole(adminRole, caller)).to.be.true

      const signer = await ethers.getSigner(caller)
      const tx = await naosFactory.connect(signer).createPool(
        borrower,
        bnToHex(juniorFeePercent),
        bnToHex(limit),
        bnToHex(interestApr),
        bnToHex(paymentPeriodInDays),
        bnToHex(termInDays),
        bnToHex(lateFeeApr),
        bnToHex(principalGracePeriod),
        bnToHex(fundableAt),
        allowedUIDTypes,
      )
      const receipt = await tx.wait()

      // expectEvent(tx, "PoolCreated")
    })

    it("user with borrower role can call", async () => {
      const caller = borrower
      const borrowerRole = await naosFactory.BORROWER_ROLE()

      expect(await naosFactory.hasRole(borrowerRole, caller)).to.be.true

      const signer = await ethers.getSigner(caller)
      const tx = await naosFactory.connect(signer).createPool(
        borrower,
        bnToHex(juniorFeePercent),
        bnToHex(limit),
        bnToHex(interestApr),
        bnToHex(paymentPeriodInDays),
        bnToHex(termInDays),
        bnToHex(lateFeeApr),
        bnToHex(principalGracePeriod),
        bnToHex(fundableAt),
        allowedUIDTypes,
      )
      // const receipt = await tx.wait()

      // expectEvent(receipt, "PoolCreated")
    })

    it("users without the admin or borrower role cannot create a pool", async () => {
      const caller = otherPerson
      const borrowerRole = await naosFactory.BORROWER_ROLE()
      const adminRole = await naosFactory.OWNER_ROLE()

      expect(await naosFactory.hasRole(borrowerRole, caller)).to.be.false
      expect(await naosFactory.hasRole(adminRole, caller), borrower).to.be.false

      const signer = await ethers.getSigner(caller)
      expect(
        naosFactory.connect(signer).createPool(
          borrower,
          bnToHex(juniorFeePercent),
          bnToHex(limit),
          bnToHex(interestApr),
          bnToHex(paymentPeriodInDays),
          bnToHex(termInDays),
          bnToHex(lateFeeApr),
          bnToHex(principalGracePeriod),
          bnToHex(fundableAt),
          allowedUIDTypes,
        )
      ).to.be.rejectedWith(/Must have admin or borrower role to perform this action/i)
    })
  })

  describe("grantRole", async () => {
    it("owner can grant borrower role", async () => {
      const borrowerRole = await naosFactory.BORROWER_ROLE()
      await naosFactory.grantRole(borrowerRole, otherPerson, {from: owner})
      expect(await naosFactory.hasRole(borrowerRole, otherPerson)).to.be.true
    })

    it("others cannot grant borrower role", async () => {
      const borrowerRole = await naosFactory.BORROWER_ROLE()
      expect(naosFactory.grantRole(borrowerRole, otherPerson, {from: otherPerson})).to.be.rejectedWith(
        /AccessControl: sender must be an admin to grant/i
      )
      expect(await naosFactory.hasRole(borrowerRole, otherPerson)).to.be.false
    })
  })

  describe("performUgrade", async () => {
    const performUpgradeSetup = deployments.createFixture(async () => {
      const {naosFactory, ...others} = await testSetup()
      await naosFactory.performUpgrade({from: owner})
      return {naosFactory, ...others}
    })

    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/no-extra-semi
      ;({naosFactory} = await performUpgradeSetup())
    })

    it("makes OWNER_ROLE admin of BORROWER_ROLE", async () => {
      const borrowerRole = await naosFactory.BORROWER_ROLE()
      const ownerRole = await naosFactory.OWNER_ROLE()

      expect(await naosFactory.getRoleAdmin(borrowerRole)).to.eq(ownerRole)
    })
  })

  describe("updateNAOSConfig", async () => {
    describe("setting it", async () => {
      it("emits an event", async () => {
        const newConfig = await deployments.deploy("NAOSConfig", {from: owner})
        await naosConfig.setNAOSConfig(newConfig.address, {from: owner})
        const signer = await ethers.getSigner(owner)
        const tx = await naosFactory.connect(signer).updateNAOSConfig()
        const receipt = await tx.wait()
        // expectEvent(tx, "NAOSConfigUpdated", {
        //   who: owner,
        //   configAddress: newConfig.address,
        // })
      })
    })
  })
})
