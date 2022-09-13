import hre from "hardhat"
const {deployments, artifacts, web3} = hre
import {expect, expectAction, BN} from "./testHelpers"
import {CONFIG_KEYS} from "../scripts/blockchain_scripts/configKeys"
import {OWNER_ROLE, PAUSER_ROLE, GO_LISTER_ROLE} from "../scripts/blockchain_scripts/deployHelpers"
const NAOSConfig = artifacts.require("NAOSConfig")
const TestTheConfig = artifacts.require("TestTheConfig")
const TOTAL_FUNDS_LIMIT_KEY = CONFIG_KEYS.TotalFundsLimit

describe("NAOSConfig", () => {
  let owner, person2, person3, naosConfig, accounts

  const baseSetupTest = async () => {
    // Pull in our unlocked accounts
    accounts = await web3.eth.getAccounts()
    ;[owner, person2, person3] = accounts

    naosConfig = await NAOSConfig.new({from: owner})
    await naosConfig.initialize(owner)
  }

  beforeEach(async () => {
    await baseSetupTest()
  })

  describe("ownership", async () => {
    it("should be owned by the owner", async () => {
      expect(await naosConfig.hasRole(OWNER_ROLE, owner)).to.be.true
    })
    it("should give owner the PAUSER_ROLE", async () => {
      expect(await naosConfig.hasRole(PAUSER_ROLE, owner)).to.be.true
    })
    it("should give owner the GO_LISTER_ROLE", async () => {
      expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.be.true
    })
  })

  describe("the order of the enum...", async () => {
    let testTheConfigContract
    beforeEach(async () => {
      testTheConfigContract = await TestTheConfig.new({from: owner})
      await naosConfig.grantRole(OWNER_ROLE, testTheConfigContract.address, {from: owner})
    })
    it("should never change", async () => {
      await testTheConfigContract.testTheEnums(naosConfig.address)

      // The expected values here are just hardcoded in the test enums contract
      // The whole point here is to assure we have a test that fails if we change the order
      expect(await naosConfig.getNumber(CONFIG_KEYS.TotalFundsLimit)).to.bignumber.equal(new BN(2))
      expect(await naosConfig.getNumber(CONFIG_KEYS.ReserveDenominator)).to.bignumber.equal(new BN(4))
      expect(await naosConfig.getNumber(CONFIG_KEYS.WithdrawFeeDenominator)).to.bignumber.equal(new BN(5))
      expect(await naosConfig.getNumber(CONFIG_KEYS.LatenessGracePeriodInDays)).to.bignumber.equal(new BN(6))
      expect(await naosConfig.getNumber(CONFIG_KEYS.LatenessMaxDays)).to.bignumber.equal(new BN(7))
      expect(await naosConfig.getNumber(CONFIG_KEYS.DrawdownPeriodInSeconds)).to.bignumber.equal(new BN(8))
      expect(await naosConfig.getNumber(CONFIG_KEYS.LeverageRatio)).to.bignumber.equal(new BN(10))

      // Addresses
      expect(await naosConfig.getAddress(CONFIG_KEYS.NAOSFactory)).to.equal(
        "0x0afFE1972479c386A2Ab21a27a7f835361B6C0e9"
      )
      expect(await naosConfig.getAddress(CONFIG_KEYS.TreasuryReserve)).to.equal(
        "0xECd9C93B79AE7C1591b1fB5323BD777e86E150d5"
      )
      expect(await naosConfig.getAddress(CONFIG_KEYS.NAOSConfig)).to.equal(
        "0x0000000000000000000000000000000000000008"
      )
    })
  })

  describe("initializeFromOtherConfig", async () => {
    it("should copy over the vals from the other config", async () => {
      const newNAOSConfig = await NAOSConfig.new({from: owner})
      await newNAOSConfig.initialize(owner)

      const randomAddress1 = person2
      const randomAddress2 = person3
      const randomNumber1 = new BN(42)
      const randomNumber2 = new BN(84)
      // Just doing the first 4 to show the looping works
      await naosConfig.setAddress(0, randomAddress1, {from: owner})
      await naosConfig.setAddress(1, randomAddress2, {from: owner})
      await naosConfig.setAddress(2, randomAddress1, {from: owner})
      await naosConfig.setAddress(3, randomAddress2, {from: owner})

      // Just doing the first 4 to show the looping works
      await naosConfig.setNumber(0, randomNumber1, {from: owner})
      await naosConfig.setNumber(1, randomNumber2, {from: owner})
      await naosConfig.setNumber(2, randomNumber1, {from: owner})
      await naosConfig.setNumber(3, randomNumber2, {from: owner})

      await expectAction(() => newNAOSConfig.initializeFromOtherConfig(naosConfig.address, 4, 4)).toChange([
        [async () => await newNAOSConfig.getAddress(0), {to: randomAddress1, bignumber: false}],
        [async () => await newNAOSConfig.getAddress(1), {to: randomAddress2, bignumber: false}],
        [async () => await newNAOSConfig.getAddress(2), {to: randomAddress1, bignumber: false}],
        [async () => await newNAOSConfig.getAddress(3), {to: randomAddress2, bignumber: false}],

        [async () => await newNAOSConfig.getNumber(0), {to: randomNumber1}],
        [async () => await newNAOSConfig.getNumber(1), {to: randomNumber2}],
        [async () => await newNAOSConfig.getNumber(2), {to: randomNumber1}],
        [async () => await newNAOSConfig.getNumber(3), {to: randomNumber2}],
      ])
    })
  })

  describe("setAddress", async () => {
    let address
    beforeEach(() => {
      // Just using a random address for testing purposes
      address = person3
    })
    it("should fail if it isn't the owner", async () => {
      return expect(naosConfig.setAddress(CONFIG_KEYS.IndexPool, address, {from: person2})).to.be.rejectedWith(
        /Must have admin role/
      )
    })

    it("should set the address", async () => {
      await naosConfig.setAddress(CONFIG_KEYS.IndexPool, address, {from: owner})
      const newAddress = await naosConfig.getAddress(CONFIG_KEYS.IndexPool)
      expect(newAddress).to.equal(address)
    })

    it("should set the address only once", async () => {
      await naosConfig.setAddress(CONFIG_KEYS.IndexPool, address, {from: owner})
      const newAddress = await naosConfig.getAddress(CONFIG_KEYS.IndexPool)

      const anotherAddress = person2
      await expect(naosConfig.setAddress(CONFIG_KEYS.IndexPool, anotherAddress, {from: owner})).to.be.rejectedWith(
        /already been initialized/
      )
      // It was not updated
      expect(await naosConfig.getAddress(CONFIG_KEYS.IndexPool)).to.equal(newAddress)
    })

    it("should fire an event", async () => {
      const result = await naosConfig.setAddress(CONFIG_KEYS.IndexPool, address, {from: owner})
      const event = result.logs[0]

      expect(event.event).to.equal("AddressUpdated")
      expect(event.args.owner).to.equal(owner)
      expect(event.args.index).to.bignumber.equal(new BN(9))
      expect(event.args.oldValue).to.match(/0x0000000/)
      expect(event.args.newValue).to.equal(address)
    })
  })

  describe("setTreasuryReserve", async () => {
    context("not admin", async () => {
      it("reverts", async () => {
        const address = "0x0000000000000000000000000000000000000001"
        await expect(naosConfig.setTreasuryReserve(address, {from: person2})).to.be.rejectedWith(
          /Must have admin role/
        )
      })
    })

    it("allows setting multiple times", async () => {
      const firstAddress = "0x0000000000000000000000000000000000000001"
      const secondAddress = "0x0000000000000000000000000000000000000002"

      await expectAction(() => naosConfig.setTreasuryReserve(firstAddress, {from: owner})).toChange([
        [() => naosConfig.getAddress(CONFIG_KEYS.TreasuryReserve), {to: firstAddress, bignumber: false}],
      ])
      await expectAction(() => naosConfig.setTreasuryReserve(secondAddress, {from: owner})).toChange([
        [() => naosConfig.getAddress(CONFIG_KEYS.TreasuryReserve), {to: secondAddress, bignumber: false}],
      ])
    })
  })

  describe("setSeniorPoolStrategy", async () => {
    context("not admin", async () => {
      it("reverts", async () => {
        const address = "0x0000000000000000000000000000000000000001"
        await expect(naosConfig.setIndexPoolStrategy(address, {from: person2})).to.be.rejectedWith(
          /Must have admin role/
        )
      })
    })

    it("allows setting multiple times", async () => {
      const firstAddress = "0x0000000000000000000000000000000000000001"
      const secondAddress = "0x0000000000000000000000000000000000000002"

      await expectAction(() => naosConfig.setIndexPoolStrategy(firstAddress, {from: owner})).toChange([
        [() => naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy), {to: firstAddress, bignumber: false}],
      ])
      await expectAction(() => naosConfig.setIndexPoolStrategy(secondAddress, {from: owner})).toChange([
        [() => naosConfig.getAddress(CONFIG_KEYS.IndexPoolStrategy), {to: secondAddress, bignumber: false}],
      ])
    })
  })

  describe("setNumber", async () => {
    describe("setting totalFundsLimit", async () => {
      const limit = new BN(1000)
      it("should fail if it isn't the owner", async () => {
        return expect(naosConfig.setNumber(TOTAL_FUNDS_LIMIT_KEY, limit, {from: person2})).to.be.rejectedWith(
          /Must have admin role/
        )
      })

      it("should set the limit", async () => {
        await naosConfig.setNumber(TOTAL_FUNDS_LIMIT_KEY, limit)
        const newLimit = await naosConfig.getNumber(TOTAL_FUNDS_LIMIT_KEY)
        expect(newLimit).to.bignumber.equal(limit)
      })

      it("should fire an event", async () => {
        const result = await naosConfig.setNumber(TOTAL_FUNDS_LIMIT_KEY, limit)
        const event = result.logs[0]

        expect(event.event).to.equal("NumberUpdated")
        expect(event.args.owner).to.equal(owner)
        expect(event.args.index).to.bignumber.equal(new BN(0))
        expect(event.args.oldValue).to.bignumber.equal(new BN(0))
        expect(event.args.newValue).to.bignumber.equal(new BN(limit))
      })
    })
  })

  describe("go listing", async () => {
    describe("addToGoList", async () => {
      beforeEach(async () => {
        await baseSetupTest()
      })

      it("should add someone to the go list", async () => {
        expect(await naosConfig.goList(person2)).to.be.false
        await naosConfig.addToGoList(person2)
        expect(await naosConfig.goList(person2)).to.be.true
      })
      it("should allow the owner, as a go-lister, to add someone", async () => {
        const ownerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, owner)
        expect(ownerGoLister).to.be.true
        const goListed = await naosConfig.goList(person2)
        expect(goListed).to.be.false
        return expect(naosConfig.addToGoList(person2, {from: owner})).to.be.fulfilled
      })
      it("should allow a non-owner, as a go-lister, to add someone", async () => {
        await naosConfig.grantRole(GO_LISTER_ROLE, person3, {from: owner})
        const nonOwnerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, person3)
        expect(nonOwnerGoLister).to.be.true
        const goListed = await naosConfig.goList(person2)
        expect(goListed).to.be.false
        return expect(naosConfig.addToGoList(person2, {from: person3})).to.be.fulfilled
      })
      it("should dis-allow a non-owner who is not a go-lister from adding someone", async () => {
        const nonOwnerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, person2)
        expect(nonOwnerGoLister).to.be.false
        const goListed = await naosConfig.goList(person3)
        expect(goListed).to.be.false
        return expect(naosConfig.addToGoList(person3, {from: person2})).to.be.rejectedWith(
          /Must have go-lister role to perform this action/
        )
      })
    })

    describe("bulkAddToGoList", async () => {
      beforeEach(async () => {
        await baseSetupTest()
      })

      it("should add many people to the go list", async () => {
        expect(await naosConfig.goList(person2)).to.be.false
        expect(await naosConfig.goList(person3)).to.be.false

        await naosConfig.bulkAddToGoList([person2, person3])

        expect(await naosConfig.goList(person2)).to.be.true
        expect(await naosConfig.goList(person3)).to.be.true
      })
      it("should allow the owner, as a go-lister, to add someone", async () => {
        const ownerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, owner)
        expect(ownerGoLister).to.be.true
        const goListed = await naosConfig.goList(person2)
        expect(goListed).to.be.false
        return expect(naosConfig.bulkAddToGoList([person2], {from: owner})).to.be.fulfilled
      })
      it("should allow a non-owner, as a go-lister, to add someone", async () => {
        await naosConfig.grantRole(GO_LISTER_ROLE, person3, {from: owner})
        const nonOwnerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, person3)
        expect(nonOwnerGoLister).to.be.true
        const goListed = await naosConfig.goList(person2)
        expect(goListed).to.be.false
        return expect(naosConfig.bulkAddToGoList([person2], {from: person3})).to.be.fulfilled
      })
      it("should dis-allow a non-owner who is not a go-lister from adding someone", async () => {
        const nonOwnerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, person2)
        expect(nonOwnerGoLister).to.be.false
        const goListed = await naosConfig.goList(person3)
        expect(goListed).to.be.false
        return expect(naosConfig.bulkAddToGoList([person3], {from: person2})).to.be.rejectedWith(
          /Must have go-lister role to perform this action/
        )
      })
    })

    describe("removeFromGoList", async () => {
      beforeEach(async () => {
        await baseSetupTest()
      })

      it("should remove someone from the go list", async () => {
        await naosConfig.addToGoList(person2)
        expect(await naosConfig.goList(person2)).to.be.true
        await naosConfig.removeFromGoList(person2)
        expect(await naosConfig.goList(person2)).to.be.false
      })
      it("should allow the owner, as a go-lister, to remove someone", async () => {
        const ownerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, owner)
        expect(ownerGoLister).to.be.true
        await naosConfig.addToGoList(person2)
        const goListed = await naosConfig.goList(person2)
        expect(goListed).to.be.true
        return expect(naosConfig.removeFromGoList(person2, {from: owner})).to.be.fulfilled
      })
      it("should allow a non-owner, as a go-lister, to remove someone", async () => {
        await naosConfig.grantRole(GO_LISTER_ROLE, person3, {from: owner})
        const nonOwnerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, person3)
        expect(nonOwnerGoLister).to.be.true
        await naosConfig.addToGoList(person2)
        const goListed = await naosConfig.goList(person2)
        expect(goListed).to.be.true
        return expect(naosConfig.removeFromGoList(person2, {from: person3})).to.be.fulfilled
      })
      it("should dis-allow a non-owner who is not a go-lister from removing someone", async () => {
        const nonOwnerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, person2)
        expect(nonOwnerGoLister).to.be.false
        await naosConfig.addToGoList(person3)
        const goListed = await naosConfig.goList(person3)
        expect(goListed).to.be.true
        return expect(naosConfig.removeFromGoList(person3, {from: person2})).to.be.rejectedWith(
          /Must have go-lister role to perform this action/
        )
      })
    })

    describe("bulkRemoveFromGoList", async () => {
      beforeEach(async () => {
        await baseSetupTest()
      })

      it("should remove someone from the go list", async () => {
        await naosConfig.bulkAddToGoList([person2, person3])
        expect(await naosConfig.goList(person2)).to.be.true
        expect(await naosConfig.goList(person3)).to.be.true

        await naosConfig.bulkRemoveFromGoList([person2, person3])
        expect(await naosConfig.goList(person2)).to.be.false
        expect(await naosConfig.goList(person3)).to.be.false
      })
      it("should allow the owner, as a go-lister, to remove someone", async () => {
        const ownerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, owner)
        expect(ownerGoLister).to.be.true
        await naosConfig.bulkAddToGoList([person2])
        const goListed = await naosConfig.goList(person2)
        expect(goListed).to.be.true
        return expect(naosConfig.bulkRemoveFromGoList([person2], {from: owner})).to.be.fulfilled
      })
      it("should allow a non-owner, as a go-lister, to remove someone", async () => {
        await naosConfig.grantRole(GO_LISTER_ROLE, person3, {from: owner})
        const nonOwnerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, person3)
        expect(nonOwnerGoLister).to.be.true
        await naosConfig.bulkAddToGoList([person2])
        const goListed = await naosConfig.goList(person2)
        expect(goListed).to.be.true
        return expect(naosConfig.bulkRemoveFromGoList([person2], {from: person3})).to.be.fulfilled
      })
      it("should dis-allow a non-owner who is not a go-lister from removing someone", async () => {
        const nonOwnerGoLister = await naosConfig.hasRole(GO_LISTER_ROLE, person2)
        expect(nonOwnerGoLister).to.be.false
        await naosConfig.bulkAddToGoList([person3])
        const goListed = await naosConfig.goList(person3)
        expect(goListed).to.be.true
        return expect(naosConfig.bulkRemoveFromGoList([person3], {from: person2})).to.be.rejectedWith(
          /Must have go-lister role to perform this action/
        )
      })
    })
  })
})
