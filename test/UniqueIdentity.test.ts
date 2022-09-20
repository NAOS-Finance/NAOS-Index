/* global web3 */

import {asNonNullable} from "../scripts/blockchain_scripts/utils"
import BN from 'bn.js'
import {expect, bigVal, expectAction, bnToHex, bnToBnjs} from "./testHelpers"
import {constants as ethersConstants} from "ethers"
import hre from "hardhat"
import {
  getContract,
  OWNER_ROLE,
  PAUSER_ROLE,
  SIGNER_ROLE,
  ETHERS_CONTRACT_PROVIDER,
  getEthersContract,
} from "../scripts/blockchain_scripts/deployHelpers"
import {UNIQUE_IDENTITY_METADATA_URI} from "../scripts/blockchain_scripts/uniqueIdentity/constants"
import {TestUniqueIdentity} from "../types"
import {
  BurnParams,
  BURN_MESSAGE_ELEMENT_TYPES,
  EMPTY_STRING_HEX,
  MintParams,
  MINT_MESSAGE_ELEMENT_TYPES,
  MINT_PAYMENT,
} from "./uniqueIdentityHelpers"
import {getCurrentTimestamp, SECONDS_PER_DAY} from "./testHelpers"
import {mint as mintHelper, burn as burnHelper, sign as signHelper} from "./uniqueIdentityHelpers"
import {deployBaseFixture} from "./util/fixtures"
const {deployments, ethers, web3} = hre

const setupTest = deployments.createFixture(async ({deployments}) => {
  const {deploy} = deployments
  const [_owner, _anotherUser, _anotherUser2, _anotherUser3] = await web3.eth.getAccounts()
  const owner = asNonNullable(_owner)
  const anotherUser = asNonNullable(_anotherUser)
  const anotherUser2 = asNonNullable(_anotherUser2)
  const uninitializedUniqueIdentityDeployer = asNonNullable(_anotherUser3)

  const deployed = await deployBaseFixture()

  const uniqueIdentity = deployed.uniqueIdentity

  const uninitializedUniqueIdentityDeployResult = await deploy("TestUniqueIdentity", {
    from: uninitializedUniqueIdentityDeployer,
    gasLimit: 4000000,
  })
  const uninitializedUniqueIdentity = await getEthersContract<TestUniqueIdentity>(
    "TestUniqueIdentity",
    {
      at: uninitializedUniqueIdentityDeployResult.address,
    }
  )

  return {
    owner,
    anotherUser,
    anotherUser2,
    uniqueIdentity,
    uninitializedUniqueIdentity,
    uninitializedUniqueIdentityDeployer,
  }
})

describe("UniqueIdentity", () => {
  let owner: string,
    anotherUser: string,
    anotherUser2: string,
    uniqueIdentity: TestUniqueIdentity,
    uninitializedUniqueIdentityDeployer: string,
    uninitializedUniqueIdentity: TestUniqueIdentity

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-extra-semi
    ;({
      owner,
      anotherUser,
      anotherUser2,
      uniqueIdentity,
      uninitializedUniqueIdentityDeployer,
      uninitializedUniqueIdentity,
    } = await setupTest())
  })

  async function sign(
    signerAddress: string,
    messageBaseElements: {types: string[]; values: Array<BN | string>},
    nonce: BN
  ): Promise<string> {
    return signHelper(hre, signerAddress, messageBaseElements, nonce)
  }

  async function mint(
    tokenId: BN,
    nonce: BN,
    signer: string,
    overrideMintParams?: MintParams,
    overrideFrom?: string,
    overrideChainId?: BN
  ): Promise<void> {
    const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
    return mintHelper(
      hre,
      uniqueIdentity,
      tokenId,
      expiresAt,
      nonce,
      signer,
      overrideMintParams,
      overrideFrom,
      overrideChainId
    )
  }

  async function burn(
    recipient: string,
    tokenId: BN,
    nonce: BN,
    signer: string,
    overrideBurnParams?: BurnParams,
    overrideFrom?: string,
    overrideChainId?: BN
  ): Promise<void> {
    const expiresAt = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
    return burnHelper(
      hre,
      uniqueIdentity,
      recipient,
      tokenId,
      expiresAt,
      nonce,
      signer,
      overrideBurnParams,
      overrideFrom,
      overrideChainId
    )
  }

  async function pause(): Promise<void> {
    expect(await uniqueIdentity.paused()).to.equal(false)
    await uniqueIdentity.pause()
    expect(await uniqueIdentity.paused()).to.equal(true)
  }

  describe("initialize", () => {
    it("rejects zero address owner", async () => {
      const initialized = uninitializedUniqueIdentity.initialize(
        ethersConstants.AddressZero
      )
      await expect(initialized).to.be.rejectedWith(/Owner address cannot be empty/)
    })
    it("grants owner the owner, pauser, and signer roles", async () => {
      expect(await uniqueIdentity.hasRole(OWNER_ROLE, owner)).to.equal(true)
      expect(await uniqueIdentity.hasRole(PAUSER_ROLE, owner)).to.equal(true)
      expect(await uniqueIdentity.hasRole(SIGNER_ROLE, owner)).to.equal(true)
    })
    it("does not grant the deployer the owner, pauser, nor signer roles", async () => {
      const signer = await ethers.getSigner(uninitializedUniqueIdentityDeployer)
      await uninitializedUniqueIdentity.connect(signer).initialize(owner)
      expect(await uniqueIdentity.hasRole(OWNER_ROLE, uninitializedUniqueIdentityDeployer)).to.equal(false)
      expect(await uniqueIdentity.hasRole(PAUSER_ROLE, uninitializedUniqueIdentityDeployer)).to.equal(false)
      expect(await uniqueIdentity.hasRole(SIGNER_ROLE, uninitializedUniqueIdentityDeployer)).to.equal(false)
    })
    // it("cannot be called twice", async () => {
    //   const signer = await ethers.getSigner(uninitializedUniqueIdentityDeployer)
    //   await uninitializedUniqueIdentity.connect(signer).initialize(owner)
    //   await expect(
    //     uninitializedUniqueIdentity.connect(signer).initialize(anotherUser2)
    //   ).to.be.rejectedWith(/Initializable: contract is already initialized/)
    // })
    it("zero-address lacks signer role", async () => {
      expect(await uniqueIdentity.hasRole(SIGNER_ROLE, ethersConstants.AddressZero)).to.equal(false)
    })
  })

  describe("setSupportedUIDTypes", () => {
    it("requires sender to be admin", async () => {
      expect(await uniqueIdentity.hasRole(OWNER_ROLE, anotherUser)).to.equal(false)
      const signer = await ethers.getSigner(anotherUser)
      await expect(uniqueIdentity.connect(signer).setSupportedUIDTypes([], [])).to.be.rejectedWith(
        /Must have admin role to perform this action/
      )
    })

    it("checks the length of ids and values is equivalent", async () => {
      await expect(uniqueIdentity.setSupportedUIDTypes([1], [])).to.be.rejectedWith(/values and ids length mismatch/)
      await expect(uniqueIdentity.setSupportedUIDTypes([], [true])).to.be.rejectedWith(
        /values and ids length mismatch/
      )
    })

    it("properly sets supportedUIDTypes", async () => {
      await uniqueIdentity.setSupportedUIDTypes([0, 1], [true, true])
      expect(await uniqueIdentity.supportedUIDTypes(0)).to.equal(true)
      expect(await uniqueIdentity.supportedUIDTypes(1)).to.equal(true)
      await uniqueIdentity.setSupportedUIDTypes([0, 1], [true, false])
      expect(await uniqueIdentity.supportedUIDTypes(1)).to.equal(false)
    })
  })

  describe("expiration", () => {
    it("returns 0 for a non-minted token", async () => {
      const recipient = anotherUser
      expect(bnToBnjs(await uniqueIdentity.expiration(recipient, bnToHex(new BN(0))))).to.bignumber.equal(new BN(0))
    })
    it("returns the expiration for a minted token", async () => {
      const recipient = anotherUser
      const tokenId = new BN(0)
      await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
      await mint(tokenId, new BN(0), owner, undefined, recipient)
      expect(bnToBnjs(await uniqueIdentity.expiration(recipient, bnToHex(tokenId)))).to.bignumber.gt(new BN(1))
    })
    it("returns 0 for a token that was minted and then burned", async () => {
      const recipient = anotherUser
      const tokenId = new BN(0)
      await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
      await mint(tokenId, new BN(0), owner, undefined, recipient)
      await burn(recipient, tokenId, new BN(1), owner)
      expect(bnToBnjs(await uniqueIdentity.expiration(recipient, bnToHex(tokenId)))).to.bignumber.equal(new BN(0))
    })
  })

  describe("mint", () => {
    let recipient: string, tokenId: BN, timestamp: BN

    beforeEach(async () => {
      recipient = anotherUser
      tokenId = new BN(0)
      await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
      timestamp = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)
    })

    describe("validates signature", () => {
      it("rejects incorrect `id` in hashed message", async () => {
        const incorrectId = tokenId.add(new BN(1))
        await expect(mint(tokenId, new BN(0), owner, [bnToHex(incorrectId), bnToHex(timestamp)], recipient)).to.be.rejectedWith(
          /Invalid signer/
        )
      })
      it("rejects incorrect chain id in hashed message", async () => {
        const chainId = await hre.getChainId()
        expect(chainId).to.bignumber.equal(new BN(31337))
        const incorrectChainId = new BN(1)
        await expect(mint(tokenId, new BN(0), owner, undefined, recipient, incorrectChainId)).to.be.rejectedWith(
          /Invalid signer/
        )
      })
      const currentTime = () => Math.floor(((new Date).getTime() / 1000))
      it("allows address with signer role", async () => {
        expect(await uniqueIdentity.hasRole(SIGNER_ROLE, owner)).to.equal(true)
        await expect(mint(tokenId, new BN(0), owner, undefined, recipient)).to.be.fulfilled
      })
      it("rejects address without signer role", async () => {
        expect(await uniqueIdentity.hasRole(SIGNER_ROLE, recipient)).to.equal(false)
        await expect(mint(tokenId, new BN(0), recipient, undefined, recipient)).to.be.rejectedWith(/Invalid signer/)
      })
      it("rejects an expired timestamp", async () => {
        timestamp = (await getCurrentTimestamp()).sub(SECONDS_PER_DAY)
        await expect(mint(tokenId, new BN(0), owner, [bnToHex(tokenId), bnToHex(timestamp)], recipient)).to.be.rejectedWith(
          /Signature has expired/
        )
      })
      it("rejects empty signature", async () => {
        const emptySignature = EMPTY_STRING_HEX
        const mintParams: MintParams = [bnToHex(tokenId), bnToHex(timestamp)]
        const signer = await ethers.getSigner(recipient)
        await expect(
          uniqueIdentity.connect(signer).mint(...mintParams, emptySignature)
        ).to.be.rejectedWith(/InvalidSignatureLength/)
      })
      it("rejects an incorrect contract address", async () => {
        const messageElements: [string, BN, BN, string] = [recipient, tokenId, timestamp, owner]
        const signature = await sign(owner, {types: MINT_MESSAGE_ELEMENT_TYPES, values: messageElements}, new BN(0))
        const mintParams: MintParams = [bnToHex(tokenId), bnToHex(timestamp)]
        const signer = await ethers.getSigner(recipient)
        await expect(
          uniqueIdentity.connect(signer).mint(...mintParams, signature)
        ).to.be.rejectedWith(/Invalid signer/)
      })
      it("rejects reuse of a signature", async () => {
        const messageElements: [string, BN, BN, string] = [recipient, tokenId, timestamp, uniqueIdentity.address]
        const signature = await sign(owner, {types: MINT_MESSAGE_ELEMENT_TYPES, values: messageElements}, new BN(0))
        const mintParams: MintParams = [bnToHex(tokenId), bnToHex(timestamp)]
        const signer = await ethers.getSigner(recipient)
        await uniqueIdentity.connect(signer).mint(...mintParams, signature)
        await expect(
          uniqueIdentity.connect(signer).mint(...mintParams, signature)
        ).to.be.rejectedWith(/Invalid signer/)
      })
    })
  })
})
