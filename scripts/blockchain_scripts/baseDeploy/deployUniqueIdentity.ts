import {UniqueIdentity} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {Deployed} from "../baseDeploy"
import {
  ContractDeployer,
  getContract,
  getProtocolOwner,
  SIGNER_ROLE,
  ETHERS_CONTRACT_PROVIDER
} from "../deployHelpers"
import {DeployEffects} from "../migrations/deployEffects"
import {UNIQUE_IDENTITY_METADATA_URI} from "../uniqueIdentity/constants"

const logger = console.log

export async function deployUniqueIdentity({
  deployer,
  trustedSigner,
  deployEffects,
}: {
  deployer: ContractDeployer
  trustedSigner: string
  deployEffects: DeployEffects
}): Promise<Deployed<UniqueIdentity>> {
  const contractName = "UniqueIdentity"
  logger(`About to deploy ${contractName}...`)
  const {gf_deployer} = await deployer.getNamedAccounts()
  assertIsString(gf_deployer)
  const protocol_owner = await getProtocolOwner()
  const uniqueIdentity = await deployer.deploy(contractName, {
    from: gf_deployer,
    gasLimit: 4000000,
    proxy: {
      owner: protocol_owner,
      proxyContract: "EIP173Proxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [protocol_owner, UNIQUE_IDENTITY_METADATA_URI],
        },
      },
    },
  })
  const truffleContract = await getContract<
    UniqueIdentity,
    any
  >(contractName, ETHERS_CONTRACT_PROVIDER, {at: uniqueIdentity.address})
  const ethersContract = truffleContract.connect(await getProtocolOwner())

  await deployEffects.add({
    deferred: [await ethersContract.populateTransaction.grantRole(SIGNER_ROLE, trustedSigner)],
  })

  return {
    name: contractName,
    contract: truffleContract,
  }
}
