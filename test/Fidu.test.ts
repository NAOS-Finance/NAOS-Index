import hre, { ethers } from "hardhat"
const {deployments, artifacts, web3} = hre
import {expectEvent} from "@openzeppelin/test-helpers"
import {expect, bigVal, expectAction, bnToHex} from "./testHelpers"
import {OWNER_ROLE} from "../scripts/blockchain_scripts/deployHelpers"
import {CONFIG_KEYS} from "../scripts/blockchain_scripts/configKeys"
import {deployBaseFixture} from "./util/fixtures"
const GoldfinchConfig = artifacts.require("GoldfinchConfig")
const Fidu = artifacts.require("Fidu")

describe("Fidu", () => {
  const testSetup = deployments.createFixture(async ({deployments, getNamedAccounts}) => {
    // Just to be crystal clear
    const {protocol_owner} = await getNamedAccounts()
    owner = protocol_owner

    const {fidu, goldfinchConfig} = await deployBaseFixture()

    return {fidu, goldfinchConfig}
  })

  let owner, person2, goldfinchConfig, fidu
  beforeEach(async () => {
    // Pull in our unlocked accounts
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[owner, person2] = await web3.eth.getAccounts()
    ;({fidu, goldfinchConfig} = await testSetup())
  })

  describe("Initialization", async () => {
    // beforeEach(async () => {
    //   goldfinchConfig = await GoldfinchConfig.new({from: owner})
    //   await goldfinchConfig.initialize(owner)

    //   fidu = await Fidu.new({from: owner})
    //   await fidu.__initialize__(owner, "Fidu", "FIDU", goldfinchConfig.address)
    // })

    describe("initialization", async () => {
      it("should not allow it to be called twice", async () => {
        return expect(fidu.__initialize__(person2, "Fidu", "FIDU", goldfinchConfig.address)).to.be.rejectedWith(
          /has already been initialized/
        )
      })
    })

    describe("ownership", async () => {
      it("should be owned by the owner", async () => {
        expect(await fidu.hasRole(OWNER_ROLE, owner)).to.be.true
      })
    })
  })

  describe("updateGoldfinchConfig", () => {
    describe("setting it", async () => {
      it("should allow the owner to set it", async () => {
        await goldfinchConfig.setAddress(CONFIG_KEYS.GoldfinchConfig, person2)
        return expectAction(() => fidu.updateGoldfinchConfig({from: owner})).toChange([
          [() => fidu.config(), {to: person2, bignumber: false}],
        ])
      })

      it("emits an event", async () => {
        const newConfig = await deployments.deploy("GoldfinchConfig", {from: owner})
        await goldfinchConfig.setAddress(CONFIG_KEYS.GoldfinchConfig, newConfig.address, {from: owner})
        const tx = await fidu.updateGoldfinchConfig()

        // expectEvent(tx, "GoldfinchConfigUpdated", {
        //   who: owner,
        //   configAddress: newConfig.address,
        // })
      })

      it("should disallow non-owner to set", async () => {
        const signer = await ethers.getSigner(person2 as string)
        return expect(fidu.connect(signer).updateGoldfinchConfig()).to.be.rejectedWith(/Must have minter role/)
      })
    })
  })

  describe("mintTo", async () => {
    beforeEach(async () => {
      // Use the full deployment so we have a pool, and the
      // mintTo function doesn't fail early on the assets/liabilites check
      const deployments = await testSetup()
      fidu = deployments.fidu
    })
    it("should allow the minter to call it", async () => {
      const signer = await ethers.getSigner(owner as string)
      return expect(fidu.connect(signer).mintTo(person2, bnToHex(bigVal(1)))).to.be.fulfilled
    })
    it("should not allow anyone else to call it", async () => {
      const signer = await ethers.getSigner(person2 as string)
      return expect(fidu.connect(signer).mintTo(person2, bnToHex(bigVal(1)))).to.be.rejectedWith(/minter role/)
    })
  })

  describe("burnFrom", async () => {
    beforeEach(async () => {
      // Use the full deployment so we have a pool, and the
      // burnFrom function doesn't fail early on the assets/liabilites check
      const deployments = await testSetup()
      const signer = await ethers.getSigner(owner as string)
      fidu = deployments.fidu
      await fidu.connect(signer).mintTo(person2, bnToHex(bigVal(1)))
    })

    it("should allow the minter to call it", async () => {
      const signer = await ethers.getSigner(owner as string)
      return expect(fidu.connect(signer).burnFrom(person2, bnToHex(bigVal(1)))).to.be.fulfilled
    })
    it("should not allow anyone else to call it", async () => {
      const signer = await ethers.getSigner(person2 as string)
      return expect(fidu.connect(signer).burnFrom(person2, bnToHex(bigVal(1)))).to.be.rejectedWith(/minter role/)
    })
  })
})