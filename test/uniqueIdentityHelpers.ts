import hre from "hardhat"
import _ from "lodash"
import {keccak256} from "@ethersproject/keccak256"
import {pack} from "@ethersproject/solidity"
import {assertNonNullable} from "../scripts/blockchain_scripts/utils"
import {TestUniqueIdentity} from "../types"
// import {TransferSingle} from "../typechain/truffle/TestUniqueIdentity"
// import {BN, decodeLogs, getOnlyLog} from "./testHelpers"
import {BN} from "./testHelpers"
import {BigNumber, constants as ethersConstants} from "ethers"
import {HardhatRuntimeEnvironment} from "hardhat/types"
import {expect, bnToHex, bnToBnjs} from './testHelpers'

const {web3, ethers} = hre

export const MINT_MESSAGE_ELEMENT_TYPES = ["address", "uint256", "uint256", "address"]
export const EMPTY_STRING_HEX = web3.utils.asciiToHex("")
export const MINT_PAYMENT = new BN(0.00083e18)

export const BURN_MESSAGE_ELEMENT_TYPES = ["address", "uint256", "uint256", "address"]

export const sign = async (
  hre: HardhatRuntimeEnvironment,
  signerAddress: string,
  messageBaseElements: {types: string[]; values: Array<BN | string>},
  nonce: BN,
  overrideChainId?: BN
): Promise<string> => {
  const signer = (await hre.ethers.getSigners()).find((signer) => signer.address === signerAddress)
  assertNonNullable(signer)

  if (messageBaseElements.types.length !== messageBaseElements.values.length) {
    throw new Error("Invalid message elements")
  }

  // Append nonce and chainId to base elements of message.
  const chainId = overrideChainId || (await hre.getChainId())
  const types = messageBaseElements.types.concat(["uint256", "uint256"])
  const _values = messageBaseElements.values.concat([nonce, chainId])

  // Convert BN values to BigNumber, since ethers utils use BigNumber.
  const values = _values.map((val: BN | string) => (BN.isBN(val) ? BigNumber.from(val.toString()) : val))

  if (_.some(values, Array.isArray)) {
    // If we want to support signing a message whose elements can be arrays, we'd want to encode the values using
    // a utility corresponding to `abi.encode()`, rather than `abi.encodePacked()`, because packed encoding is
    // ambiguous for multiple parameters of dynamic type (cf. https://github.com/ethereum/solidity/blob/v0.8.4/docs/abi-spec.rst#non-standard-packed-mode).
    // This is something to keep in mind if we ever implement `mintBatch()` or `burnBatch()`, which would use
    // array parameters. For now, we're defensive here against this issue.
    throw new Error("Expected no array values.")
  }
  const encoded = pack(types, values)
  const hashed = keccak256(encoded)

  // Cf. https://github.com/ethers-io/ethers.js/blob/ce8f1e4015c0f27bf178238770b1325136e3351a/docs/v5/api/signer/README.md#note
  const arrayified = hre.ethers.utils.arrayify(hashed)
  return signer.signMessage(arrayified)
}

// export type MintParams = [BN, BN]
export type MintParams = [string, string]

export async function mint(
  hre: HardhatRuntimeEnvironment,
  uniqueIdentity: TestUniqueIdentity,
  tokenId: BN,
  expiresAt: BN,
  nonce: BN,
  signer: string,
  overrideMintParams?: MintParams,
  overrideFrom?: string,
  overrideChainId?: BN
): Promise<void> {

  const messageElements: [string, string, string, string] = [overrideFrom as string, bnToHex(tokenId), bnToHex(expiresAt), uniqueIdentity.address]
  const signature = await sign(
    hre,
    signer,
    {types: MINT_MESSAGE_ELEMENT_TYPES, values: messageElements},
    nonce,
    overrideChainId
  )

  const defaultMintParams: MintParams = [bnToHex(tokenId), bnToHex(expiresAt)]
  const mintParams: MintParams = overrideMintParams || defaultMintParams

  const defaultFrom = overrideFrom
  const from = overrideFrom || defaultFrom
  const eSigner = await ethers.getSigner(from as string)

  const receipt = await uniqueIdentity.connect(eSigner).mint(...mintParams, signature)

  const expiration = await uniqueIdentity.expiration(overrideFrom as string, bnToHex(tokenId))
  expect(bnToBnjs(expiration)).to.bignumber.equal(expiresAt)
  expect(bnToBnjs(await uniqueIdentity.nonces(overrideFrom as string))).to.bignumber.equal(nonce.add(new BN(1)))

  // Verify that event was emitted.
  // const transferEvent = getOnlyLog<TransferSingle>(
  //   decodeLogs(receipt.receipt.rawLogs, uniqueIdentity, "TransferSingle")
  // )
  // expect(transferEvent.args.operator).to.equal(from)
  // expect(transferEvent.args.from).to.equal(ethersConstants.AddressZero)
  // expect(transferEvent.args.to).to.equal(overrideFrom as string)
  // expect(transferEvent.args.id).to.bignumber.equal(bnToHex(tokenId))
  // expect(transferEvent.args.value).to.bignumber.equal(new BN(1))
}

export type BurnParams = [string, string, string]

export async function burn(
  hre: HardhatRuntimeEnvironment,
  uniqueIdentity: TestUniqueIdentity,
  recipient: string,
  tokenId: BN,
  expiresAt: BN,
  nonce: BN,
  signer: string,
  overrideBurnParams?: BurnParams,
  overrideFrom?: string,
  overrideChainId?: BN
): Promise<void> {

  const messageElements: [string, string, string, string] = [recipient, bnToHex(tokenId), bnToHex(expiresAt), uniqueIdentity.address]
  const signature = await sign(
    hre,
    signer,
    {types: BURN_MESSAGE_ELEMENT_TYPES, values: messageElements},
    nonce,
    overrideChainId
  )

  const defaultBurnParams: BurnParams = [recipient, bnToHex(tokenId), bnToHex(expiresAt)]
  const burnParams: BurnParams = overrideBurnParams || defaultBurnParams

  const defaultFrom = recipient
  const from = overrideFrom || defaultFrom
  const eSigner = await ethers.getSigner(from as string)

  const receipt = await uniqueIdentity.connect(eSigner).burn(...burnParams, signature)

  const expiration = await uniqueIdentity.expiration(recipient as string, bnToHex(tokenId))
  expect(bnToBnjs(expiration)).to.bignumber.equal(new BN(0))
  expect(bnToBnjs(await uniqueIdentity.nonces(recipient))).to.bignumber.equal(nonce.add(new BN(1)))

  // Verify that event was emitted.
  // const transferEvent = getOnlyLog<TransferSingle>(
  //   decodeLogs(receipt.receipt.rawLogs, uniqueIdentity, "TransferSingle")
  // )
  // expect(transferEvent.args.operator).to.equal(from)
  // expect(transferEvent.args.from).to.equal(recipient)
  // expect(transferEvent.args.to).to.equal(ethersConstants.AddressZero)
  // expect(transferEvent.args.id).to.bignumber.equal(bnToHex(tokenId))
  // expect(transferEvent.args.value).to.bignumber.equal(new BN(1))
}
