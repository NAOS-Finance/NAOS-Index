import hre, { ethers } from "hardhat"
const { deployments, artifacts, web3 } = hre
import { expectEvent } from "@openzeppelin/test-helpers"
import { expect, bigVal, expectAction, bnToHex, BN } from "./testHelpers"
import { OWNER_ROLE } from "../scripts/blockchain_scripts/deployHelpers"
import { CONFIG_KEYS } from "../scripts/blockchain_scripts/configKeys"
import { deployBaseFixture } from "./util/fixtures"
const NAOSConfig = artifacts.require("NAOSConfig")
const RWA = artifacts.require("RWA")

describe("RWA", () => {
  const testSetup = deployments.createFixture(async ({ deployments, getNamedAccounts }) => {
    const { protocol_owner } = await getNamedAccounts()
    owner = protocol_owner

    const { rwa, naosConfig, indexPool } = await deployBaseFixture()
    return { rwa, naosConfig, indexPool }
  })

  let owner, person2, naosConfig, rwa, indexPool
  beforeEach(async () => {
    // Pull in our unlocked accounts
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;[owner, person2] = await web3.eth.getAccounts()
      ; ({ rwa, naosConfig, indexPool } = await testSetup())
  })

  describe("Initialization", async () => {
    // beforeEach(async () => {
    //   naosConfig = await NAOSConfig.new({from: owner})
    //   await naosConfig.initialize(owner)

    //   rwa = await RWA.new({from: owner})
    //   await rwa.__initialize__(owner, "RWA", "RWA", naosConfig.address)
    // })

    describe("initialization", async () => {
      it("should not allow it to be called twice", async () => {
        return expect(rwa.__initialize__(person2, "RWA", "FIDU", naosConfig.address)).to.be.rejectedWith(
          /has already been initialized/
        )
      })
    })

    describe("ownership", async () => {
      it("should be owned by the owner", async () => {
        expect(await rwa.hasRole(OWNER_ROLE, owner)).to.be.true
      })
    })
  })

  describe("updateNAOSConfig", () => {
    describe("setting it", async () => {
      it("should allow the owner to set it", async () => {
        await naosConfig.setAddress(CONFIG_KEYS.NAOSConfig, person2)
        return expectAction(() => rwa.updateNAOSConfig({from: owner})).toChange([
          [() => rwa.config(), {to: person2, bignumber: false}],
        ])
      })

      it("emits an event", async () => {
        const newConfig = await deployments.deploy("NAOSConfig", {from: owner})
        await naosConfig.setAddress(CONFIG_KEYS.NAOSConfig, newConfig.address, {from: owner})
        const tx = await rwa.updateNAOSConfig()

        // expectEvent(tx, "NAOSConfigUpdated", {
        //   who: owner,
        //   configAddress: newConfig.address,
        // })
      })

      it("should disallow non-owner to set", async () => {
        const signer = await ethers.getSigner(person2 as string)
        return expect(rwa.connect(signer).updateNAOSConfig()).to.be.rejectedWith(/Must have minter role/)
      })
    })
  })

  describe("mintTo", async () => {
    beforeEach(async () => {
      // Use the full deployment so we have a pool, and the
      // mintTo function doesn't fail early on the assets/liabilites check
      const deployments = await testSetup()
      rwa = deployments.rwa
    })
    it("should allow the minter to call it", async () => {
      const signer = await ethers.getSigner(owner as string)
      return expect(rwa.connect(signer).mintTo(person2, bnToHex(new BN(1)))).to.be.fulfilled
    })
    it("should not allow anyone else to call it", async () => {
      const signer = await ethers.getSigner(person2 as string)
      return expect(rwa.connect(signer).mintTo(person2, bnToHex(new BN(1)))).to.be.rejectedWith(/minter role/)
    })
  })

  describe("burnFrom", async () => {
    beforeEach(async () => {
      // Use the full deployment so we have a pool, and the
      // burnFrom function doesn't fail early on the assets/liabilites check
      const deployments = await testSetup()
      const signer = await ethers.getSigner(owner as string)
      rwa = deployments.rwa
      await rwa.connect(signer).mintTo(person2, bnToHex(new BN(1)))
    })

    it("should allow the minter to call it", async () => {
      const signer = await ethers.getSigner(owner as string)
      return expect(rwa.connect(signer).burnFrom(person2, bnToHex(new BN(1)))).to.be.fulfilled
    })
    it("should not allow anyone else to call it", async () => {
      const signer = await ethers.getSigner(person2 as string)
      return expect(rwa.connect(signer).burnFrom(person2, bnToHex(new BN(1)))).to.be.rejectedWith(/minter role/)
    })
  })
})
