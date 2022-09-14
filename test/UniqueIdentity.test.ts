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

  //   describe("validates id", () => {
  //     beforeEach(async () => {
  //       await uniqueIdentity.setSupportedUIDTypes([0, 1], [true, false])
  //     })
  //     it("allows token id of 0", async () => {
  //       const tokenId = new BN(0)
  //       await expect(mint(tokenId, new BN(0), owner, undefined, recipient)).to.be.fulfilled
  //     })
  //     it("rejects token id > 0", async () => {
  //       const tokenId = new BN(1)
  //       await expect(mint(tokenId, new BN(0), owner, undefined, recipient)).to.be.rejectedWith(/Token id not supported/)
  //     })
  //   })

  //   describe("validation of mint amount", () => {
  //     it("rejects duplicative minting, i.e. where amount before minting is > 0", async () => {
  //       await mint(tokenId, new BN(0), owner, undefined, recipient)
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(recipient, bnToHex(new BN(0))))).to.bignumber.equal(new BN(1))
  //       await expect(mint(tokenId, new BN(1), owner, undefined, recipient)).to.be.rejectedWith(
  //         /Balance before mint must be 0/
  //       )
  //     })
  //   })

  //   it("updates state and emits an event", async () => {
  //     await expect(mint(tokenId, new BN(0), owner, undefined, recipient)).to.be.fulfilled
  //     // (State updates and event emitted are established in `mint()`.)
  //   })

  //   it("uses the expected amount of gas", async () => {
  //     const messageElements: [string, BN, BN, string] = [recipient, tokenId, timestamp, uniqueIdentity.address]
  //     const signature = await sign(owner, {types: MINT_MESSAGE_ELEMENT_TYPES, values: messageElements}, new BN(0))
  //     const mintParams: MintParams = [bnToHex(tokenId), bnToHex(timestamp)]
  //     const signer = await ethers.getSigner(recipient)
  //     const tx = await uniqueIdentity.connect(signer).mint(...mintParams, signature, {
  //       value: bnToHex(MINT_PAYMENT),
  //     })
  //     // const receipt = await tx.wait()
  //     // const tolerance = new BN(50)
  //     // expect(new BN(receipt.gasUsed)).to.bignumber.closeTo(new BN(88377), tolerance)
  //   })

  //   context("paused", () => {
  //     it("reverts", async () => {
  //       await pause()
  //       await expect(mint(tokenId, new BN(0), owner, undefined, recipient)).to.be.rejectedWith(
  //         /ERC1155Pausable: token transfer while paused/
  //       )
  //     })
  //   })
  // })

  // describe("safeTransferFrom", () => {
  //   let tokenId: BN

  //   beforeEach(async () => {
  //     tokenId = new BN(0)
  //     await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
  //     await mint(tokenId, new BN(0), owner, undefined, anotherUser)
  //   })

  //   describe("by token owner", () => {
  //     it("rejects because transfer is disabled", async () => {
  //       const amount = await uniqueIdentity.balanceOf(anotherUser, bnToHex(tokenId))
  //       const signer = await ethers.getSigner(anotherUser)
  //       await expect(
  //         uniqueIdentity.connect(signer).safeTransferFrom(anotherUser, anotherUser2, bnToHex(tokenId), amount, EMPTY_STRING_HEX)
  //       ).to.be.rejectedWith(/Only mint or burn transfers are allowed/)
  //     })

  //     context("paused", () => {
  //       it("reverts", async () => {
  //         await pause()
  //         const amount = await uniqueIdentity.balanceOf(anotherUser, bnToHex(tokenId))
  //         const signer = await ethers.getSigner(anotherUser)
  //         await expect(
  //           uniqueIdentity.connect(signer).safeTransferFrom(anotherUser, anotherUser2, bnToHex(tokenId), amount, EMPTY_STRING_HEX)
  //         ).to.be.rejectedWith(/Only mint or burn transfers are allowed/)
  //       })
  //     })
  //   })

  //   describe("by approved sender who is not token owner", () => {
  //     it("rejects because transfer is disabled", async () => {
  //       let signer = await ethers.getSigner(anotherUser)
  //       await uniqueIdentity.connect(signer).setApprovalForAll(anotherUser2, true)
  //       expect(await uniqueIdentity.isApprovedForAll(anotherUser, anotherUser2)).to.equal(true)
  //       const amount = await uniqueIdentity.balanceOf(anotherUser, bnToHex(tokenId))
  //       signer = await ethers.getSigner(anotherUser2)
  //       await expect(
  //         uniqueIdentity.connect(signer).safeTransferFrom(anotherUser, anotherUser2, bnToHex(tokenId), amount, EMPTY_STRING_HEX)
  //       ).to.be.rejectedWith(/Only mint or burn transfers are allowed/)
  //     })

  //     // context("paused", () => {
  //     //   it("reverts", async () => {
  //     //     await pause()
  //     //     let signer = await ethers.getSigner(anotherUser)
  //     //     await uniqueIdentity.connect(signer).setApprovalForAll(anotherUser2, true)
  //     //     expect(await uniqueIdentity.isApprovedForAll(anotherUser, anotherUser2)).to.equal(true)
  //     //     signer = await ethers.getSigner(anotherUser2)
  //     //     const amount = await uniqueIdentity.balanceOf(anotherUser, bnToHex(tokenId))
  //     //     await expect(
  //     //       uniqueIdentity.safeTransferFrom(anotherUser, anotherUser2, bnToHex(tokenId), amount, EMPTY_STRING_HEX)
  //     //     ).to.be.rejectedWith(/Only mint or burn transfers are allowed/)
  //     //   })
  //     // })
  //   })
  // })

  // describe("safeBatchTransferFrom", () => {
  //   let tokenId: BN

  //   beforeEach(async () => {
  //     tokenId = new BN(0)
  //     await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
  //     await mint(tokenId, new BN(0), owner, undefined, anotherUser)
  //   })

  //   describe("by token owner", () => {
  //     it("rejects because transfer is disabled", async () => {
  //       const amount = await uniqueIdentity.balanceOf(anotherUser, bnToHex(tokenId))
  //       const signer = await ethers.getSigner(anotherUser)
  //       await expect(
  //         uniqueIdentity.connect(signer).safeBatchTransferFrom(anotherUser, anotherUser2, [bnToHex(tokenId)], [amount], EMPTY_STRING_HEX)
  //       ).to.be.rejectedWith(/Only mint or burn transfers are allowed/)
  //     })

  //     context("paused", () => {
  //       it("reverts", async () => {
  //         await pause()
  //         const amount = await uniqueIdentity.balanceOf(anotherUser, bnToHex(tokenId))
  //         const signer = await ethers.getSigner(anotherUser)
  //         await expect(
  //           uniqueIdentity.connect(signer).safeBatchTransferFrom(anotherUser, anotherUser2, [bnToHex(tokenId)], [amount], EMPTY_STRING_HEX)
  //         ).to.be.rejectedWith(/Only mint or burn transfers are allowed/)
  //       })
  //     })
  //   })

  //   describe("by approved sender who is not token owner", () => {
  //     it("rejects because transfer is disabled", async () => {
  //       let signer = await ethers.getSigner(anotherUser)
  //       await uniqueIdentity.connect(signer).setApprovalForAll(anotherUser2, true)
  //       expect(await uniqueIdentity.isApprovedForAll(anotherUser, anotherUser2)).to.equal(true)
  //       const amount = await uniqueIdentity.balanceOf(anotherUser, bnToHex(tokenId))
  //       signer = await ethers.getSigner(anotherUser2)
  //       await expect(
  //         uniqueIdentity.connect(signer).safeBatchTransferFrom(anotherUser, anotherUser2, [bnToHex(tokenId)], [amount], EMPTY_STRING_HEX)
  //       ).to.be.rejectedWith(/Only mint or burn transfers are allowed/)
  //     })

  //     // context("paused", () => {
  //     //   it("reverts", async () => {
  //     //     await pause()
  //     //     let signer = await ethers.getSigner(anotherUser)
  //     //     await uniqueIdentity.connect(signer).setApprovalForAll(anotherUser2, true)
  //     //     expect(await uniqueIdentity.isApprovedForAll(anotherUser, anotherUser2)).to.equal(true)
  //     //     const amount = await uniqueIdentity.balanceOf(anotherUser, bnToHex(tokenId))
  //     //     signer = await ethers.getSigner(anotherUser2)
  //     //     await expect(
  //     //       uniqueIdentity.connect(signer).safeBatchTransferFrom(anotherUser, anotherUser2, [bnToHex(tokenId)], [amount], EMPTY_STRING_HEX)
  //     //     ).to.be.rejectedWith(/Only mint or burn transfers are allowed/)
  //     //   })
  //     // })
  //   })
  // })

  // describe("burn", () => {
  //   let recipient: string, tokenId: BN, timestamp: BN

  //   beforeEach(async () => {
  //     recipient = anotherUser
  //     tokenId = new BN(0)
  //     await uniqueIdentity.setSupportedUIDTypes([bnToHex(tokenId)], [true])
  //     timestamp = (await getCurrentTimestamp()).add(SECONDS_PER_DAY)

  //     await mint(tokenId, new BN(0), owner, undefined, recipient)
  //   })

  //   describe("validates signature", () => {
  //     it("rejects incorrect `to` address in hashed message", async () => {
  //       const incorrectTo = owner
  //       await expect(burn(recipient, tokenId, new BN(1), owner, [incorrectTo, bnToHex(tokenId), bnToHex(timestamp)])).to.be.rejectedWith(
  //         /Invalid signer/
  //       )
  //     })
  //     it("rejects incorrect `id` in hashed message", async () => {
  //       const incorrectId = tokenId.add(new BN(1))
  //       await expect(
  //         burn(recipient, tokenId, new BN(1), owner, [recipient, bnToHex(incorrectId), bnToHex(timestamp)])
  //       ).to.be.rejectedWith(/Invalid signer/)
  //     })
  //     it("rejects incorrect chain id in hashed message", async () => {
  //       const chainId = await hre.getChainId()
  //       expect(chainId).to.bignumber.equal(new BN(31337))
  //       const incorrectChainId = new BN(1)
  //       await expect(
  //         burn(recipient, tokenId, new BN(1), owner, undefined, undefined, incorrectChainId)
  //       ).to.be.rejectedWith(/Invalid signer/)
  //     })
  //     it("allows address with signer role", async () => {
  //       expect(await uniqueIdentity.hasRole(SIGNER_ROLE, owner)).to.equal(true)
  //       await expect(burn(recipient, tokenId, new BN(1), owner)).to.be.fulfilled
  //     })
  //     it("rejects address without signer role", async () => {
  //       expect(await uniqueIdentity.hasRole(SIGNER_ROLE, recipient)).to.equal(false)
  //       await expect(burn(recipient, tokenId, new BN(1), recipient)).to.be.rejectedWith(/Invalid signer/)
  //     })
  //     it("rejects an expired timestamp", async () => {
  //       timestamp = (await getCurrentTimestamp()).sub(SECONDS_PER_DAY)
  //       await expect(burn(recipient, tokenId, new BN(0), owner, [recipient, bnToHex(tokenId), bnToHex(timestamp)])).to.be.rejectedWith(
  //         /Signature has expired/
  //       )
  //     })
  //     it("rejects empty signature", async () => {
  //       const emptySignature = EMPTY_STRING_HEX
  //       const burnParams: BurnParams = [recipient, bnToHex(tokenId), bnToHex(timestamp)]
  //       const signer = await ethers.getSigner(recipient)
  //       await expect(
  //         uniqueIdentity.connect(signer).burn(...burnParams, emptySignature)
  //       ).to.be.rejectedWith(/ECDSA: invalid signature length/)
  //     })
  //     it("rejects an incorrect contract address", async () => {
  //       const messageElements: [string, BN, BN, string] = [recipient, tokenId, timestamp, owner]
  //       const signature = await sign(owner, {types: BURN_MESSAGE_ELEMENT_TYPES, values: messageElements}, new BN(1))
  //       const burnParams: BurnParams = [recipient, bnToHex(tokenId), bnToHex(timestamp)]
  //       const signer = await ethers.getSigner(recipient)
  //       await expect(
  //         uniqueIdentity.connect(signer).burn(...burnParams, signature)
  //       ).to.be.rejectedWith(/Invalid signer/)
  //     })
  //     it("rejects reuse of a signature", async () => {
  //       const messageElements: [string, BN, BN, string] = [recipient, tokenId, timestamp, uniqueIdentity.address]
  //       const signature = await sign(owner, {types: BURN_MESSAGE_ELEMENT_TYPES, values: messageElements}, new BN(1))
  //       const burnParams: BurnParams = [recipient, bnToHex(tokenId), bnToHex(timestamp)]
  //       const signer = await ethers.getSigner(recipient)
  //       await uniqueIdentity.connect(signer).burn(...burnParams, signature)
  //       await expect(
  //         uniqueIdentity.connect(signer).burn(...burnParams, signature)
  //       ).to.be.rejectedWith(/Invalid signer/)
  //     })
  //     it("allows any sender bearing a valid signature", async () => {
  //       await expect(burn(recipient, tokenId, new BN(1), owner, undefined, anotherUser2)).to.be.fulfilled
  //     })
  //   })

  //   describe("validates account", () => {
  //     it("rejects zero-address", async () => {
  //       const messageElements: [string, BN, BN, string] = [
  //         ethersConstants.AddressZero,
  //         tokenId,
  //         timestamp,
  //         uniqueIdentity.address,
  //       ]
  //       const signature = await sign(owner, {types: BURN_MESSAGE_ELEMENT_TYPES, values: messageElements}, new BN(0))
  //       const burnParams: BurnParams = [ethersConstants.AddressZero, bnToHex(tokenId), bnToHex(timestamp)]
  //       const signer = await ethers.getSigner(recipient)
  //       await expect(
  //         uniqueIdentity.connect(signer).burn(...burnParams, signature)
  //       ).to.be.rejectedWith(/ERC1155: burn from the zero address/)
  //     })
  //     it("allows account having token id", async () => {
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(recipient, bnToHex(tokenId)))).to.bignumber.equal(new BN(1))
  //       await expect(burn(recipient, tokenId, new BN(1), owner)).to.be.fulfilled
  //     })
  //     it("rejects account not having token id", async () => {
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(anotherUser2, bnToHex(tokenId)))).to.bignumber.equal(new BN(0))
  //       await expect(burn(anotherUser2, tokenId, new BN(0), owner)).to.be.rejectedWith(
  //         /ERC1155: burn amount exceeds balance/
  //       )
  //     })
  //   })

  //   describe("validates id", () => {
  //     it("allows for token id for which minting is supported", async () => {
  //       await expect(burn(recipient, tokenId, new BN(1), owner)).to.be.fulfilled
  //     })
  //     it("allows for token id for which minting is not supported", async () => {
  //       // Retaining the ability to burn a token of id for which minting is not supported is useful for at least two reasons:
  //       // (1) in case such tokens should never have been mintable but were somehow minted; (2) in case we have deprecated
  //       // the ability to mint tokens of that id.
  //       const unsupportedTokenId = tokenId.add(new BN(3))
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(recipient, bnToHex(unsupportedTokenId)))).to.bignumber.equal(new BN(0))
  //       await expect(mint(unsupportedTokenId, new BN(1), owner, undefined, recipient)).to.be.rejectedWith(
  //         /Token id not supported/
  //       )
  //       const value = new BN(1)
  //       await uniqueIdentity._mintForTest(recipient, bnToHex(unsupportedTokenId), bnToHex(value), EMPTY_STRING_HEX, {from: owner})
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(recipient, bnToHex(unsupportedTokenId)))).to.bignumber.equal(value)
  //       await expect(burn(recipient, unsupportedTokenId, new BN(2), owner)).to.be.fulfilled
  //     })
  //   })

  //   describe("validation of burn value", () => {
  //     it("rejects burn value less than amount on token", async () => {
  //       // The value in having this test is that it shows that the contract's burn function explicitly requires that
  //       // the entire balance have been burned.
  //       //
  //       // An implication of the behavior established by this test is, if the case ever arises in practice where a token
  //       // balance becomes > 1 (e.g. due to a bug or hack), we'd need to upgrade the contract to be able to burn that token.
  //       const unsupportedValue = new BN(2)
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(anotherUser2, bnToHex(tokenId)))).to.bignumber.equal(new BN(0))
  //       const signer = await ethers.getSigner(owner)
  //       await uniqueIdentity._mintForTest(anotherUser2, bnToHex(tokenId), bnToHex(unsupportedValue), EMPTY_STRING_HEX)
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(anotherUser2, bnToHex(tokenId)))).to.bignumber.equal(unsupportedValue)
  //       await expect(burn(anotherUser2, tokenId, new BN(1), owner)).to.be.rejectedWith(/Balance after burn must be 0/)
  //     })
  //     it("rejects burn value greater than amount on token", async () => {
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(anotherUser2, bnToHex(tokenId)))).to.bignumber.equal(new BN(0))
  //       await expect(burn(anotherUser2, tokenId, new BN(0), owner)).to.be.rejectedWith(
  //         /ERC1155: burn amount exceeds balance/
  //       )
  //     })
  //     it("allows burn value that equals amount on token", async () => {
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(recipient, bnToHex(tokenId)))).to.bignumber.equal(new BN(1))
  //       await expect(burn(recipient, tokenId, new BN(1), owner)).to.be.fulfilled
  //       expect(bnToBnjs(await uniqueIdentity.balanceOf(recipient, bnToHex(tokenId)))).to.bignumber.equal(new BN(0))
  //     })
  //   })

  //   it("updates state and emits an event", async () => {
  //     await expect(burn(recipient, tokenId, new BN(1), owner)).to.be.fulfilled
  //     // (State updates and event emitted are established in `burn()`.)
  //   })

  //   it("uses the expected amount of gas", async () => {
  //     const messageElements: [string, BN, BN, string] = [recipient, tokenId, timestamp, uniqueIdentity.address]
  //     const signature = await sign(owner, {types: BURN_MESSAGE_ELEMENT_TYPES, values: messageElements}, new BN(1))
  //     const burnParams: BurnParams = [recipient, bnToHex(tokenId), bnToHex(timestamp)]
  //     const signer = await ethers.getSigner(recipient)
  //     const tx = await uniqueIdentity.connect(signer).burn(...burnParams, signature)
  //     const tolerance = new BN(50)
  //     // const receipt - await tx.wait()
  //     // expect(new BN(receipt.receipt.gasUsed)).to.bignumber.closeTo(new BN(47598), tolerance)
  //   })

  //   // context("paused", () => {
  //   //   it("reverts", async () => {
  //   //     await pause()
  //   //     await expect(burn(recipient, tokenId, new BN(1), owner)).to.be.rejectedWith(
  //   //       /ERC1155Pausable: token transfer while paused/
  //   //     )
  //   //   })
  //   // })
  })
})
