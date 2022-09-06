import {Verified, NAOSConfig, UniqueIdentity} from "../../../types/contracts/protocol/core"
import {assertIsString} from "../utils"
import {Deployed} from "../baseDeploy"
import {CONFIG_KEYS} from "../configKeys"
import {
  ContractDeployer,
  getProtocolOwner,
  getContract,
  ETHERS_CONTRACT_PROVIDER,
  getEthersContract,
} from "../deployHelpers"
import {DeployEffects} from "../migrations/deployEffects"

const logger = console.log

export async function deployVerified(
  deployer: ContractDeployer,
  {
    configAddress,
    uniqueIdentity,
    deployEffects,
  }: {
    configAddress: string
    uniqueIdentity: Deployed<UniqueIdentity>
    deployEffects: DeployEffects
  }
): Promise<Deployed<Verified>> {
  const contractName = "Verified"
  logger(`About to deploy ${contractName}...`)
  const {gf_deployer} = await deployer.getNamedAccounts()
  assertIsString(gf_deployer)
  const protocol_owner = await getProtocolOwner()
  const go = await deployer.deploy(contractName, {
    from: gf_deployer,
    gasLimit: 4000000,
    proxy: {
      owner: protocol_owner,
      execute: {
        init: {
          methodName: "initialize",
          args: [protocol_owner, configAddress, uniqueIdentity.contract.address],
        },
      },
    },
  })
  const contract = await getContract<Verified, Verified>(contractName, ETHERS_CONTRACT_PROVIDER, {
    at: go.address,
  })

  const goldfinchConfig = (await getEthersContract<NAOSConfig>("NAOSConfig", {at: configAddress})).connect(
    await getProtocolOwner()
  )

  await deployEffects.add({
    deferred: [await goldfinchConfig.populateTransaction.setAddress(CONFIG_KEYS.Verified, contract.address)],
  })

  return {
    name: contractName,
    contract,
  }
}
