/* global web3 */
import hre, { ethers } from "hardhat"
import {constants as ethersConstants} from "ethers"
import {asNonNullable} from "../scripts/blockchain_scripts/utils"
import {getCurrentTimestamp, SECONDS_PER_DAY, ZERO_ADDRESS, expect, bnToHex, bnToBnjs} from "./testHelpers"
import {
  getContract,
  // getTruffleContract,
  getEthersContract,
  GO_LISTER_ROLE,
  OWNER_ROLE,
  PAUSER_ROLE,
  ETHERS_CONTRACT_PROVIDER,
} from "../scripts/blockchain_scripts/deployHelpers"
import {Verified, NAOSConfig, TestUniqueIdentity} from "../types"
import {mint} from "./uniqueIdentityHelpers"
import BN from 'bn.js'
import {DeployResult} from "hardhat-deploy/types"
import {expectEvent} from "@openzeppelin/test-helpers"
import {deployBaseFixture} from "./util/fixtures"
const {deployments, web3} = hre

const setupTest = deployments.createFixture(async ({deployments}) => {
  const {deploy} = deployments
  const [_owner, _anotherUser, _anotherUser2, _anotherUser3] = await web3.eth.getAccounts()
  const owner = asNonNullable(_owner)
  const anotherUser = asNonNullable(_anotherUser)
  const anotherUser2 = asNonNullable(_anotherUser2)
  const uninitializedGoDeployer = asNonNullable(_anotherUser3)

  const deployed = await deployBaseFixture()

  const naosConfig = deployed.naosConfig
  const uniqueIdentity = deployed.uniqueIdentity
  const go = deployed.verified

  const uninitializedGoDeployResult = await deploy("Verified", {
    from: uninitializedGoDeployer,
    gasLimit: 4000000,
  })
  const uninitializedGo = await getContract<Verified, any>("Verified", ETHERS_CONTRACT_PROVIDER, {
    at: uninitializedGoDeployResult.address,
  })

  return {
    owner,
    anotherUser,
    anotherUser2,
    go,
    uninitializedGo,
    uninitializedGoDeployer,
    naosConfig,
    uniqueIdentity,
  }
})

describe("Verified", () => {
  let owner: string,
    anotherUser: string,
    anotherUser2: string,
    go: Verified,
    uninitializedGoDeployer: string,
    uninitializedGo: Verified,
    naosConfig: NAOSConfig,
    uniqueIdentity: TestUniqueIdentity

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({
      owner,
      anotherUser,
      anotherUser2,
      go,
      uninitializedGoDeployer,
      uninitializedGo,
      naosConfig,
      uniqueIdentity,
    } = await setupTest())
  })

  async function pause(): Promise<void> {
    expect(await go.paused()).to.equal(false)
    await go.pause()
    expect(await go.paused()).to.equal(true)
  }

  describe("setLegacyGoList", async () => {
    const testAddress = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

    describe("when set with a valid NAOSConfig address", async () => {
      let naosConfigWithGoList: NAOSConfig
      beforeEach(async () => {
        const newConfigDeployment = await deployments.deploy("NAOSConfig", {
          from: owner,
          skipIfAlreadyDeployed: false,
        })
        naosConfigWithGoList = await getEthersContract<NAOSConfig>("NAOSConfig", {
          at: newConfigDeployment.address,
        })

        await naosConfigWithGoList.initialize(owner)
        const signer = await ethers.getSigner(owner)
        await naosConfigWithGoList.connect(signer).addToGoList(testAddress)
        await go.setLegacyGoList(naosConfigWithGoList.address)
      })

      it("it should use the other config for the go list", async () => {
        expect(await go.verify(testAddress)).to.be.true
      })
    })

    describe("by default", async () => {
      it("works correctly", async () => {
        expect(await go.verify(testAddress)).to.be.false
        const signer = await ethers.getSigner(owner)
        await naosConfig.connect(signer).addToGoList(testAddress)
        expect(await go.verify(testAddress)).to.be.true
      })
    })
  })

  describe("initialize", () => {
    it("rejects zero address owner", async () => {
      const initialized = uninitializedGo.initialize(
        ethersConstants.AddressZero,
        naosConfig.address,
        uniqueIdentity.address
      )
      await expect(initialized).to.be.rejectedWith(/Owner and config and UniqueIdentity addresses cannot be empty/)
    })
    it("rejects zero address config", async () => {
      const initialized = uninitializedGo.initialize(owner, ethersConstants.AddressZero, uniqueIdentity.address)
      await expect(initialized).to.be.rejectedWith(/Owner and config and UniqueIdentity addresses cannot be empty/)
    })
    it("rejects zero address uniqueIdentity", async () => {
      const initialized = uninitializedGo.initialize(owner, naosConfig.address, ethersConstants.AddressZero)
      await expect(initialized).to.be.rejectedWith(/Owner and config and UniqueIdentity addresses cannot be empty/)
    })
    it("grants owner the owner and pauser roles", async () => {
      const signer = await ethers.getSigner(uninitializedGoDeployer)
      await uninitializedGo.connect(signer).initialize(owner, naosConfig.address, uniqueIdentity.address)
      expect(await uninitializedGo.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await uninitializedGo.hasRole(PAUSER_ROLE, owner)).to.equal(true)

      expect(await go.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await go.hasRole(PAUSER_ROLE, owner)).to.equal(true)
    })
    it("does not grant deployer the owner and pauser roles", async () => {
      const signer = await ethers.getSigner(uninitializedGoDeployer)
      await uninitializedGo.connect(signer).initialize(owner, naosConfig.address, uniqueIdentity.address)
      expect(await uninitializedGo.hasRole(OWNER_ROLE, uninitializedGoDeployer)).to.equal(false)
      expect(await uninitializedGo.hasRole(PAUSER_ROLE, uninitializedGoDeployer)).to.equal(false)
    })
    it("sets config and uniqueIdentity addresses in state", async () => {
      const signer = await ethers.getSigner(uninitializedGoDeployer)
      await uninitializedGo.connect(signer).initialize(owner, naosConfig.address, uniqueIdentity.address)
      expect(await uninitializedGo.config()).to.equal(naosConfig.address)
      expect(await uninitializedGo.uniqueIdentity()).to.equal(uniqueIdentity.address)

      expect(await go.config()).to.equal(naosConfig.address)
      expect(await go.uniqueIdentity()).to.equal(uniqueIdentity.address)
    })
    it("cannot be called twice", async () => {
      const signer = await ethers.getSigner(uninitializedGoDeployer)
      await uninitializedGo.connect(signer).initialize(owner, naosConfig.address, uniqueIdentity.address)
      await expect(
        uninitializedGo.connect(signer).initialize(anotherUser2, naosConfig.address, uniqueIdentity.address)
      ).to.be.rejectedWith(/Contract instance has already been initialized/)
    })
  })

  describe("updateNAOSConfig", () => {
    let newConfig: DeployResult

    beforeEach(async () => {
      newConfig = await deployments.deploy("NAOSConfig", {from: owner})
      await naosConfig.setNAOSConfig(newConfig.address)
    })

    it("rejects sender who lacks owner role", async () => {
      expect(await go.hasRole(OWNER_ROLE, anotherUser)).to.equal(false)
      const signer = await ethers.getSigner(anotherUser)
      await expect(go.connect(signer).updateNAOSConfig()).to.be.rejectedWith(
        /Must have admin role to perform this action/
      )
    })
    it("allows sender who has owner role", async () => {
      expect(await go.hasRole(OWNER_ROLE, owner)).to.equal(true)
      const signer = await ethers.getSigner(owner)
      await expect(go.connect(signer).updateNAOSConfig()).to.be.fulfilled
    })
    it("updates config address, emits an event", async () => {
      expect(await go.config()).to.equal(naosConfig.address)
      const signer = await ethers.getSigner(owner)
      const receipt = await go.connect(signer).updateNAOSConfig()
      expect(await go.config()).to.equal(newConfig.address)
      // expectEvent(receipt, "NAOSConfigUpdated", {
      //   who: owner,
      //   configAddress: newConfig.address,
      // })
    })

    context("paused", () => {
      it("does not reject", async () => {
        await pause()
        const signer = await ethers.getSigner(owner)
        await expect(go.connect(signer).updateNAOSConfig()).to.be.fulfilled
      })
    })
  })

  describe("go", () => {
    it("rejects zero address account", async () => {
      await expect(go.verify(ethersConstants.AddressZero)).to.be.rejectedWith(/Zero address is not go-listed/)
    })

    context("account with 0 balance UniqueIdentity token (id 0)", () => {
      beforeEach(async () => {
        const tokenId = new BN(0)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, bnToHex(tokenId)))).to.bignumber.equal(new BN(0))
      })

      context("account is on legacy go-list", () => {
        beforeEach(async () => {
          expect(await naosConfig.goList(anotherUser)).to.equal(false)
          expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
          const signer = await ethers.getSigner(owner)
          await naosConfig.connect(signer).addToGoList(anotherUser)
          expect(await naosConfig.goList(anotherUser)).to.equal(true)
        })

        it("returns true", async () => {
          expect(await go.verify(anotherUser)).to.equal(true)
        })
      })
      context("account is not on legacy go-list", () => {
        beforeEach(async () => {
          expect(await naosConfig.goList(anotherUser)).to.equal(false)
        })

        it("returns false", async () => {
          expect(await go.verify(anotherUser)).to.equal(false)
        })
      })
    })

    context("account with > 0 balance UniqueIdentity token (id 0)", () => {
      beforeEach(async () => {
        const tokenId = new BN(0)
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
        await mint(hre, uniqueIdentity, tokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, bnToHex(tokenId)))).to.bignumber.equal(expiresAt)
      })

      context("account is on legacy go-list", () => {
        beforeEach(async () => {
          expect(await naosConfig.goList(anotherUser)).to.equal(false)
          expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
          const signer = await ethers.getSigner(owner)
          await naosConfig.connect(signer).addToGoList(anotherUser)
          expect(await naosConfig.goList(anotherUser)).to.equal(true)
        })

        it("returns true", async () => {
          expect(await go.verify(anotherUser)).to.equal(true)
        })
      })

      context("account is not on legacy go-list", () => {
        beforeEach(async () => {
          expect(await naosConfig.goList(anotherUser)).to.equal(false)
        })

        it("returns true", async () => {
          expect(await go.verify(anotherUser)).to.equal(true)
        })
      })
    })

    context("verifyOnlyIdTypes", () => {
      it("Validates zero address", async () => {
        await expect(go.verifyOnlyIdTypes(ZERO_ADDRESS, [])).to.be.rejectedWith(/Zero address is not go-listed/)
      })

      it("returns true if has UID and not legacy golisted", async () => {
        const tokenId = new BN(0)
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
        await mint(hre, uniqueIdentity, tokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, bnToHex(tokenId)))).to.bignumber.equal(expiresAt)
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        expect(await go.verifyOnlyIdTypes(anotherUser, [bnToHex(tokenId)])).to.equal(true)
      })

      it("returns true if legacy golisted and doesnt have UID", async () => {
        const tokenId = new BN(0)
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        const signer = await ethers.getSigner(owner)
        await naosConfig.connect(signer).addToGoList(anotherUser)
        expect(await naosConfig.goList(anotherUser)).to.equal(true)
        expect(await go.verifyOnlyIdTypes(anotherUser, [bnToHex(tokenId)])).to.equal(true)
      })

      it("returns false if not legacy golisted and no included UID", async () => {
        const tokenId = new BN(0)
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
        await mint(hre, uniqueIdentity, tokenId, expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, bnToHex(tokenId)))).to.bignumber.equal(expiresAt)
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        expect(await go.verifyOnlyIdTypes(anotherUser, [1])).to.equal(false)
      })
    })

    // it("getSeniorPoolIdTypes", async () => {
    //   expect(await (await go.getSeniorPoolIdTypes()).map((x) => x.toNumber())).to.deep.equal([0, 1, 3, 4])
    // })

    context("goIndexPool", () => {
      it("Validates zero address", async () => {
        await expect(go.verifyIndexPool(ZERO_ADDRESS)).to.be.rejectedWith(/Zero address is not go-listed/)
      })

      // it("returns true if called by staking rewards contract", async () => {
      //   const uidTokenId = await uniqueIdentity.ID_TYPE_0()
      //   await uniqueIdentity.setSupportedUIDTypes([], [])
      //   expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, uidTokenId))).to.bignumber.equal(new BN(0))
      //   const stakingRewardsContract = await getContract<StakingRewards, StakingRewardsInstance>(
      //     "StakingRewards",
      //     ETHERS_CONTRACT_PROVIDER
      //   )
      //   await expect(go.verifyIndexPool(stakingRewardsContract.address)).to.be.fulfilled
      // })

      it("returns true if has non-US UID and not legacy golisted", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_0()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, bnToBnjs(uidTokenId), expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, uidTokenId))).to.bignumber.equal(expiresAt)
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.verifyIndexPool(anotherUser)).to.equal(true)
      })

      it("returns true if has US accredited UID and not legacy golisted", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_1()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, bnToBnjs(uidTokenId), expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, uidTokenId))).to.bignumber.equal(expiresAt)
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.verifyIndexPool(anotherUser)).to.equal(true)
      })

      // TODO: we don't support type3 and type4 currently
      it("returns false if has US entity UID and not legacy golisted", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_3()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, bnToBnjs(uidTokenId), expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, uidTokenId))).to.bignumber.equal(expiresAt)
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.verifyIndexPool(anotherUser)).to.equal(false)
      })

      it("returns true if has non US entity UID and not legacy golisted", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_4()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, bnToBnjs(uidTokenId), expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, uidTokenId))).to.bignumber.equal(expiresAt)
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.verifyIndexPool(anotherUser)).to.equal(false)
      })

      it("returns true if legacy golisted", async () => {
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        const signer = await ethers.getSigner(owner)
        await naosConfig.connect(signer).addToGoList(anotherUser)
        expect(await naosConfig.goList(anotherUser)).to.equal(true)
        expect(await go.verifyIndexPool(anotherUser)).to.equal(true)
      })

      it("returns false if not legacy golisted and no included UID", async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_2()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, bnToBnjs(uidTokenId), expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, uidTokenId))).to.bignumber.equal(expiresAt)
        expect(await naosConfig.goList(anotherUser)).to.equal(false)
        expect(await naosConfig.hasRole(GO_LISTER_ROLE, owner)).to.equal(true)
        expect(await go.verifyIndexPool(anotherUser)).to.equal(false)
      })
    })

    context("paused", () => {
      beforeEach(async () => {
        const uidTokenId = await uniqueIdentity.ID_TYPE_0()
        const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
        await uniqueIdentity.setSupportedUIDTypes([uidTokenId], [true])
        await mint(hre, uniqueIdentity, bnToBnjs(uidTokenId), expiresAt, new BN(0), owner, undefined, anotherUser)
        expect(bnToBnjs(await uniqueIdentity.expiration(anotherUser, uidTokenId))).to.bignumber.equal(expiresAt)
      })

      it("returns anyway", async () => {
        await pause()
        expect(await go.verify(anotherUser)).to.equal(true)
      })
    })
  })

  // describe("upgradeability", () => {
  //   it("is upgradeable", async () => {
  //     // TODO
  //   })
  // })
})
