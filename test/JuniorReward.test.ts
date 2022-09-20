import hre from "hardhat"
const { deployments, web3, ethers } = hre
import {
    expect,
    advanceTime,
    usdcVal,
    erc20Approve,
    erc20Transfer,
    bigVal,
    BN,
    SECONDS_PER_DAY
} from "./testHelpers"
import { TRANCHES, interestAprAsBN } from "../scripts/blockchain_scripts/deployHelpers"
import { deployFixture, deployJuniorPoolWithNAOSFactoryFixture } from "./util/fixtures"

// eslint-disable-next-line no-unused-vars
let accounts, owner, deployer, user1, user2;
let user1Signer, user2Signer;
let naosConfig, reserve, indexPool, usdc, naos, poolTokens, juniorRewards, juniorPool, creditLine;

describe("JuniorReward", async function () {
    const setupTest = deployments.createFixture(async ({ deployments }) => {
        const { usdc, naos, naosConfig, indexPool, poolTokens, juniorRewards } =
            await deployFixture()
        // Approve transfers for our test accounts
        await erc20Approve(usdc, indexPool.address, usdcVal(100000), [owner, deployer, user1, user2])
        // Some housekeeping so we have a usable creditDesk for tests, and a indexPool with funds
        await erc20Transfer(usdc, [user1, user2], usdcVal(100000), owner)

        // Add all web3 accounts to the GoList
        await naosConfig.bulkAddToGoList(accounts)
        user1Signer = await ethers.getSigner(user1);
        user2Signer = await ethers.getSigner(user2);
        await indexPool.connect(user1Signer).deposit(String(usdcVal(4000)));
        await indexPool.connect(user2Signer).deposit(String(usdcVal(4000)));

        // Set the reserve to a separate address for easier separation. The current owner account gets used for many things in tests.
        await naosConfig.setTreasuryReserve(reserve);

        let limit = usdcVal(10000)
        let interestApr = interestAprAsBN("10")
        let lateFeeApr = interestAprAsBN("0")
        const juniorFeePercent = new BN(20)
        let paymentPeriodInDays = new BN(1)
        let termInDays = new BN(365)
        const principalGracePeriodInDays = SECONDS_PER_DAY.mul(new BN(185))
        const fundableAt = new BN(0)

        const { juniorPool, creditLine } = await deployJuniorPoolWithNAOSFactoryFixture({
            usdcAddress: usdc.address,
            borrower: deployer,
            principalGracePeriodInDays,
            limit,
            interestApr,
            paymentPeriodInDays,
            termInDays,
            fundableAt,
            lateFeeApr,
            juniorFeePercent,
            id: "JuniorPool",
        })
        await usdc.connect(user1Signer).approve(juniorPool.address, String(usdcVal(500)))
        await juniorPool.connect(user1Signer).deposit(TRANCHES.Junior, String(usdcVal(500)))
        await usdc.connect(user2Signer).approve(juniorPool.address, String(usdcVal(1500)))
        await juniorPool.connect(user2Signer).deposit(TRANCHES.Junior, String(usdcVal(1500)))
        await juniorPool.lockJuniorCapital()
        await indexPool.invest(juniorPool.address);
        await juniorPool.drawdown(String(usdcVal(10000)));

        return { usdc, naos, naosConfig, indexPool, poolTokens, juniorRewards, juniorPool, creditLine }
    })

    before(async () => {
        accounts = await web3.eth.getAccounts()
            ;[owner, deployer, user1, user2, reserve] = accounts
            ; ({ usdc, naos, naosConfig, indexPool, poolTokens, juniorRewards, juniorPool, creditLine } = await setupTest())
    })

    describe("set up reward", () => {
        before(async () => {
            await juniorRewards.setRewardRate(String(bigVal(1)));
        })

        it("it rejects if the sender doesn't have admin role", async () => {
            await expect(juniorRewards.connect(user2Signer).setRewardRate(String(bigVal(1)))).to.be.revertedWith("Must have admin role to perform this action");
        })

        it("it checks the parameters", async () => {
            let poolToken1 = await poolTokens.getTokenInfo(1);
            let poolToken2 = await poolTokens.getTokenInfo(2);
            expect((await poolTokens.ownerOf("1")).toLowerCase()).to.be.equal(user1.toLowerCase());
            expect(poolToken1.pool.toLowerCase()).to.be.equal(juniorPool.address.toLowerCase());
            expect(poolToken1.principalAmount).to.be.equal(String(usdcVal(500)));
            expect((await poolTokens.ownerOf("2")).toLowerCase()).to.be.equal(user2.toLowerCase());
            expect(poolToken2.pool.toLowerCase()).to.be.equal(juniorPool.address.toLowerCase());
            expect(poolToken2.principalAmount).to.be.equal(String(usdcVal(1500)));
            expect(await juniorRewards.rewardRate()).to.be.equal(String(bigVal(1)));
        })
    })

    describe("claim reward", () => {
        before(async () => {
            await advanceTime({ days: 2 });
            await juniorPool.assess();
        });

        it("it checks the parameters", async () => {
            // 10000 * 0.1 / 365 * 2
            expect(await creditLine.interestOwed()).to.be.equal("5479452");
        })

        it("it doesn't have reward if it reaches MaxInterestDollarsEligible", async () => {
            expect(await juniorRewards.maxInterestDollarsEligible()).to.be.equal("0");
            await usdc.transfer(creditLine.address, "5479452");
            await juniorPool.assess();
            expect(await juniorRewards.totalInterestReceived()).to.be.equal("0");
            expect(await juniorRewards.poolTokenClaimableRewards(1)).to.be.equal("0");
            expect(await juniorRewards.poolTokenClaimableRewards(2)).to.be.equal("0");
        })

        context("it sets the maxInterestDollarsEligible and receives the interest", () => {
            before(async () => {
                await juniorRewards.setMaxInterestDollarsEligible(String(bigVal(100)));
                await advanceTime({ days: 2 });
                await usdc.transfer(creditLine.address, "5479452");
                await juniorPool.assess();
            });

            it("it checks the user rewards", async () => {
                // 500 * 1e6 * 1e18 / 1e6 * 2739726000000000 /1e18
                expect(await juniorRewards.poolTokenClaimableRewards(1)).to.be.equal("1369863000000000000");
                // 1500 * 1e6 * 1e18 / 1e6 * 2739726000000000 /1e18
                expect(await juniorRewards.poolTokenClaimableRewards(2)).to.be.equal("4109589000000000000");
                expect(await juniorRewards.totalInterestReceived()).to.be.equal("5479452");
                // 5479452 * 1e12 * 1e18 / (2000 * 1e6 * 1e12)
                expect(await juniorRewards.pools(juniorPool.address)).to.be.equal("2739726000000000");
            })

            context("claim reward", () => {
                it("it rejects if the user is not the owner of the pool", async()=> {
                    await expect(juniorRewards.connect(user1Signer).withdraw(2)).to.be.revertedWith("Must be owner of PoolToken");
                })

                it("it claims the rewards", async () => {
                    await erc20Transfer(naos, [juniorRewards.address] , bigVal(1000), owner);
                    await juniorRewards.connect(user1Signer).withdraw(1);
                    await juniorRewards.connect(user2Signer).withdraw(2);
                    expect(await naos.balanceOf(user1)).to.be.equal("1369863000000000000");
                    expect(await naos.balanceOf(user2)).to.be.equal("4109589000000000000");
                    expect(await naos.balanceOf(juniorRewards.address)).to.be.equal(String(bigVal(1000).sub(new BN("1369863000000000000")).sub(new BN("4109589000000000000"))));
                });
            })
        })
    })

})