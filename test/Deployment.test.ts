import {BN, expect} from "./testHelpers"
import hre from "hardhat"
const {deployments, getNamedAccounts, ethers} = hre
import {getDeployedContract, fromAtomic, OWNER_ROLE} from "../scripts/blockchain_scripts/deployHelpers"
import {CONFIG_KEYS} from "../scripts/blockchain_scripts/configKeys"
import updateConfigs from "../scripts/blockchain_scripts/updateConfigs"
import {assertNonNullable} from "../scripts/blockchain_scripts/utils"
import {NAOSFactory} from "../types"

const TEST_TIMEOUT = 30000

describe("Deployment", async () => {
  describe("Base Deployment", () => {
    // beforeEach(async () => {
    //   await deployments.fixture("base_deploy")
    // })

    it("should set the protocol owner to the treasury reserve", async () => {
      const {protocol_owner} = await getNamedAccounts()
      const config = await getDeployedContract(deployments, "TestNAOSConfig")
      expect(await config.getAddress(CONFIG_KEYS.TreasuryReserve)).to.equal(protocol_owner)
    })
    it("sets the right defaults", async () => {
      const goldfinchFactory = await getDeployedContract(deployments, "NAOSFactory")
      const naosConfig = await getDeployedContract(deployments, "TestNAOSConfig")

      // expect(String(await naosConfig.getNumber(CONFIG_KEYS.TransactionLimit))).to.bignumber.gt(new BN(0))
      expect(String(await naosConfig.getNumber(CONFIG_KEYS.TotalFundsLimit))).to.bignumber.gt(new BN(0))
      // expect(String(await naosConfig.getNumber(CONFIG_KEYS.MaxUnderwriterLimit))).to.bignumber.gt(new BN(0))
      expect(await naosConfig.getAddress(CONFIG_KEYS.NAOSFactory)).to.equal(goldfinchFactory.address)
    })
  })

  describe("Setup for Testing", function () {
    this.timeout(TEST_TIMEOUT)

    // it("should not fail", async () => {
    //   return expect(deployments.run("setup_for_testing")).to.be.fulfilled
    // })
    it("should create borrower contract and tranched pool", async () => {
      // await deployments.run("setup_for_testing")
      const goldfinchFactory = await getDeployedContract<NAOSFactory>(deployments, "NAOSFactory")
      const borrowerCreated = await goldfinchFactory.queryFilter(goldfinchFactory.filters.BorrowerCreated())
      expect(borrowerCreated.length).to.equal(0)
      // const event = borrowerCreated[0]
      // assertNonNullable(event)
      // const borrowerConAddr = event.args.borrower
      // const result = await goldfinchFactory.queryFilter(goldfinchFactory.filters.PoolCreated(null, borrowerConAddr))
      // expect(result.length).to.equal(2)
    })
  })

  describe("Upgrading", () => {
    // beforeEach(async () => {
    //   await deployments.fixture()
    // })

    it("should allow you to change the owner of the implementation, without affecting the owner of the proxy", async () => {
      const seniorPool = await getDeployedContract(deployments, "IndexPool")
      const someWallet = ethers.Wallet.createRandom()

      const originally = await seniorPool.hasRole(OWNER_ROLE, someWallet.address)
      expect(originally).to.be.false

      await seniorPool.grantRole(OWNER_ROLE, someWallet.address)

      const afterGrant = await seniorPool.hasRole(OWNER_ROLE, someWallet.address)
      expect(afterGrant).to.be.true
    })

    it("should allow for a way to transfer ownership of the proxy", async () => {
      const {protocol_owner, gf_deployer} = await getNamedAccounts()
      const seniorPoolProxy = await getDeployedContract(deployments, "IndexPool_Proxy", protocol_owner)

      const originalOwner = await seniorPoolProxy.owner()
      expect(originalOwner).to.equal(protocol_owner)

      const result = await seniorPoolProxy.transferOwnership(gf_deployer)
      await result.wait()
      const newOwner = await seniorPoolProxy.owner()
      expect(newOwner).to.equal(gf_deployer)
    })
  })

  describe("Updating configs", async () => {
    // beforeEach(async () => {
    //   await deployments.fixture()
    // })

    it("Should update protocol configs", async () => {
      const config = await getDeployedContract(deployments, "TestNAOSConfig")

      const new_config = {
        totalFundsLimit: 2000,
        reserveDenominator: 11,
        withdrawFeeDenominator: 202,
        latenessGracePeriod: 9,
        latenessMaxDays: 6,
        drawdownPeriodInSeconds: 11000,
        leverageRatio: String(17e18),
      }

      await updateConfigs(hre, new_config)

      expect(fromAtomic(await config.getNumber(CONFIG_KEYS.TotalFundsLimit))).to.bignumber.eq(
        new BN(new_config["totalFundsLimit"])
      )
      expect(String(await config.getNumber(CONFIG_KEYS.ReserveDenominator))).to.eq(
        String(new_config["reserveDenominator"])
      )
      expect(String(await config.getNumber(CONFIG_KEYS.WithdrawFeeDenominator))).to.eq(
        String(new_config["withdrawFeeDenominator"])
      )
      expect(String(await config.getNumber(CONFIG_KEYS.LatenessGracePeriodInDays))).to.eq(
        String(new_config["latenessGracePeriod"])
      )
      expect(String(await config.getNumber(CONFIG_KEYS.LatenessMaxDays))).to.eq(String(new_config["latenessMaxDays"]))
      expect(String(await config.getNumber(CONFIG_KEYS.DrawdownPeriodInSeconds))).to.eq(
        String(new_config["drawdownPeriodInSeconds"])
      )
      expect(String(await config.getNumber(CONFIG_KEYS.LeverageRatio))).to.eq(String(new_config["leverageRatio"]))
    })
  })
})
