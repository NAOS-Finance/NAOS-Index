import hre from "hardhat"
const { deployments, web3, ethers } = hre
import {
    expect,
    usdcVal,
    erc20Approve,
    erc20Transfer,
    bigVal,
    BN,
    SECONDS_PER_DAY
} from "./testHelpers"
import { CONFIG_KEYS } from "../scripts/blockchain_scripts/configKeys"
import { TRANCHES, interestAprAsBN } from "../scripts/blockchain_scripts/deployHelpers"
import { deployFixture, deployJuniorPoolWithNAOSFactoryFixture } from "./util/fixtures"

// eslint-disable-next-line no-unused-vars
let accounts, owner, deployer, user1, user2;
let user1Signer, user2Signer;
let rwa, naosConfig, reserve, usdc, indexPool, withdrawQueue, boostPool;

describe("WithdrawQueue", async function () {

    const setupTest = deployments.createFixture(async ({ deployments }) => {
        const { indexPool, usdc, rwa, naosConfig, withdrawQueue, boostPool } =
            await deployFixture()
        // Approve transfers for our test accounts
        await erc20Approve(usdc, indexPool.address, usdcVal(100000), [owner, deployer, user1, user2])
        // Some housekeeping so we have a usable creditDesk for tests, and a indexPool with funds
        await erc20Transfer(usdc, [user1, user2], usdcVal(100000), owner)

        await erc20Approve(rwa, withdrawQueue.address, bigVal(100000), [user1, user2])
        // Add all web3 accounts to the GoList
        await naosConfig.bulkAddToGoList(accounts)
        user1Signer = await ethers.getSigner(user1);
        user2Signer = await ethers.getSigner(user2);
        await indexPool.connect(user1Signer).deposit(String(usdcVal(10000)));
        await indexPool.connect(user2Signer).deposit(String(usdcVal(10000)));
        await boostPool.connect(user1Signer).deposit(String(bigVal(200)));
        await boostPool.connect(user2Signer).deposit(String(bigVal(800)));
        await withdrawQueue.addFeeTier(String(bigVal(300)), 40);
        await withdrawQueue.addFeeTier(String(bigVal(600)), 30);
        await withdrawQueue.addFeeTier(String(bigVal(900)), 20);

        // Set the reserve to a separate address for easier separation. The current owner account gets used for many things in tests.
        await naosConfig.setTreasuryReserve(reserve);

        return { indexPool, usdc, rwa, naosConfig, withdrawQueue, boostPool }
    })

    before(async () => {
        accounts = await web3.eth.getAccounts()
            ;[owner, deployer, user1, user2, reserve] = accounts
            ; ({ usdc, indexPool, rwa, naosConfig, withdrawQueue, boostPool } = await setupTest())
    })

    describe("withdraw situation", () => {
        it("it has the right initial setting", async () => {
            let feeTier0 = await withdrawQueue.feeTiers(0);
            expect(feeTier0.veNAOSAmount).to.be.equal(String(bigVal(0)));
            expect(feeTier0.fee).to.be.equal(50);
            let feeTier1 = await withdrawQueue.feeTiers(1);
            expect(feeTier1.veNAOSAmount).to.be.equal(String(bigVal(300)));
            expect(feeTier1.fee).to.be.equal(40);
            let feeTier2 = await withdrawQueue.feeTiers(2);
            expect(feeTier2.veNAOSAmount).to.be.equal(String(bigVal(600)));
            expect(feeTier2.fee).to.be.equal(30);
            let feeTier3 = await withdrawQueue.feeTiers(3);
            expect(feeTier3.veNAOSAmount).to.be.equal(String(bigVal(900)));
            expect(feeTier3.fee).to.be.equal(20);
            expect(await withdrawQueue.totalRegisteredAmount()).to.be.equal(0);
            expect(await withdrawQueue.queueIndex()).to.be.equal(0);
        })

        it("it rejects if there is no claimable amount", async () => {
            await expect(withdrawQueue.connect(user1Signer).claim()).to.be.revertedWith("no claimable tokens");
        })

        it("it rejects if the register amount exceeds ceiling", async () => {
            await expect(withdrawQueue.connect(user1Signer).register(String(bigVal(6000)))).to.be.revertedWith("invalid input");
        })

        context("there are two deposited orders", () => {
            before(async () => {
                await withdrawQueue.connect(user1Signer).register(String(bigVal(4000)));
                await withdrawQueue.connect(user2Signer).register(String(bigVal(3000)));
            })

            it("it has the right setting", async () => {
                let user1WithdrawData = await withdrawQueue.userWithdrawData(user1);
                let user2WithdrawData = await withdrawQueue.userWithdrawData(user2);
                let withdrawData1 = await withdrawQueue.withdrawQueue(0);
                let withdrawData2 = await withdrawQueue.withdrawQueue(1);

                expect(await withdrawQueue.totalRegisteredAmount()).to.be.equal("0");
                expect(user1WithdrawData.listInQueue).to.be.equal(false);
                expect(user1WithdrawData.queueIndex).to.be.equal("0");
                expect(user1WithdrawData.Claimable).to.be.equal(String(usdcVal(4000)));
                expect(user2WithdrawData.listInQueue).to.be.equal(false);
                expect(user2WithdrawData.queueIndex).to.be.equal("1");
                expect(user2WithdrawData.Claimable).to.be.equal(String(usdcVal(3000)));
                expect(withdrawData1.user).to.be.equal(user1);
                expect(withdrawData1.registeredAmount).to.be.equal(String(bigVal(4000)));
                expect(withdrawData1.remainingAmount).to.be.equal("0");
                expect(withdrawData1.withdrawAmount).to.be.equal(String(usdcVal(4000)));
                expect(withdrawData2.user).to.be.equal(user2);
                expect(withdrawData2.registeredAmount).to.be.equal(String(bigVal(3000)));
                expect(withdrawData2.remainingAmount).to.be.equal("0");
                expect(withdrawData2.withdrawAmount).to.be.equal(String(usdcVal(3000)));
            })
        })

        context("if there is no enough money in the pool", () => {
            before(async () => {
                let limit = usdcVal(10000)
                let interestApr = interestAprAsBN("25")
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
                await usdc.connect(user1Signer).approve(juniorPool.address, String(usdcVal(3000)))
                await juniorPool.connect(user1Signer).deposit(TRANCHES.Junior, String(usdcVal(3000)))
                await juniorPool.lockJuniorCapital()
                await indexPool.invest(juniorPool.address);
                await withdrawQueue.connect(user2Signer).register(String(bigVal(3000)));
            })

            it("it does not has enough liquidity", async () => {
                expect(await withdrawQueue.totalRegisteredAmount()).to.be.equal(String(bigVal(2000)));
                expect(await usdc.balanceOf(indexPool.address)).to.be.equal(String(usdcVal(0)));
            })

            it("it rejects if the user has already registered", async () => {
                await expect(withdrawQueue.connect(user2Signer).register(String(usdcVal(1000)))).to.be.revertedWith("user has listed in queue");
            })

            it("it partially withdraw the rwa tokens", async () => {
                let user2WithdrawData = await withdrawQueue.userWithdrawData(user2);
                let withdrawData3 = await withdrawQueue.withdrawQueue(2);
                expect(user2WithdrawData.listInQueue).to.be.equal(true);
                expect(user2WithdrawData.queueIndex).to.be.equal("2");
                expect(user2WithdrawData.Claimable).to.be.equal(String(usdcVal(3000).add(usdcVal(1000))));
                expect(withdrawData3.user).to.be.equal(user2);
                expect(withdrawData3.registeredAmount).to.be.equal(String(bigVal(3000)));
                expect(withdrawData3.remainingAmount).to.be.equal(String(bigVal(2000)));
                expect(withdrawData3.withdrawAmount).to.be.equal(String(usdcVal(1000)));
            })

            it("it withdraws the tokens with withdraw fee", async () => {
                let withdrawFeeDenominator = await naosConfig.getNumber(CONFIG_KEYS.WithdrawFeeDenominator);
                let treasury = await naosConfig.getAddress(CONFIG_KEYS.TreasuryReserve);
                let user1WithdrawData = await withdrawQueue.userWithdrawData(user1);
                let user2WithdrawData = await withdrawQueue.userWithdrawData(user2);
                expect(user1WithdrawData.Claimable).to.be.equal(String(usdcVal(4000)));
                expect(user2WithdrawData.Claimable).to.be.equal(String(usdcVal(3000).add(usdcVal(1000))));
                expect(await withdrawQueue.getFeeByUser(user1)).to.be.equal(50);
                expect(await withdrawQueue.getFeeByUser(user2)).to.be.equal(30);
                expect(await usdc.balanceOf(user1)).to.be.equal(String(usdcVal(87000)));
                expect(await usdc.balanceOf(user2)).equal(String(usdcVal(90000)));
                expect(await usdc.balanceOf(indexPool.address)).to.be.equal("0");
                expect(await usdc.balanceOf(withdrawQueue.address)).to.be.equal(String(usdcVal(8000)));
                let treasuryBalanceBefore = new BN(String(await usdc.balanceOf(treasury)));
                await withdrawQueue.connect(user1Signer).claim();
                let user1WithdrawFee = usdcVal(4000).mul(new BN(50)).div(new BN(String(withdrawFeeDenominator)));
                expect(await usdc.balanceOf(user1)).to.be.equal(String(usdcVal(87000).add(usdcVal(4000)).sub(user1WithdrawFee)));
                expect(await usdc.balanceOf(withdrawQueue.address)).to.be.equal(String(usdcVal(4000)));
                expect(await usdc.balanceOf(treasury)).to.be.equal(String(treasuryBalanceBefore.add(user1WithdrawFee)));
                await withdrawQueue.connect(user2Signer).claim();
                let user2WithdrawFee = usdcVal(4000).mul(new BN(30)).div(new BN(String(withdrawFeeDenominator)));
                expect(await usdc.balanceOf(user2)).to.be.equal(String(usdcVal(90000).add(usdcVal(4000)).sub(user2WithdrawFee)));
                expect(await usdc.balanceOf(withdrawQueue.address)).to.be.equal("0");
                expect(await usdc.balanceOf(treasury)).to.be.equal(String(treasuryBalanceBefore.add(user1WithdrawFee).add(user2WithdrawFee)));
            })

            context("update order", () => {
                it("it rejects if the user is not lised in queue", async () => {
                    await expect(withdrawQueue.connect(user1Signer).update(String(usdcVal(1000)))).to.be.revertedWith("empty user data");
                })

                it("it rejects if the updated amount exceeds remaining", async () => {
                    await expect(withdrawQueue.connect(user2Signer).update(String(bigVal(3000)))).to.be.revertedWith("no enough amount");
                })

                it("it updates the withdraw order", async () => {
                    let user2RWABefore = new BN(String(await rwa.balanceOf(user2)));
                    let queueRWABefore = new BN(String(await rwa.balanceOf(withdrawQueue.address)));
                    await withdrawQueue.connect(user2Signer).update(String(bigVal(500)));
                    let withdrawData3 = await withdrawQueue.withdrawQueue(2);
                    expect(withdrawData3.user).to.be.equal(user2);
                    expect(withdrawData3.registeredAmount).to.be.equal(String(bigVal(2500)));
                    expect(withdrawData3.remainingAmount).to.be.equal(String(bigVal(1500)));
                    expect(withdrawData3.withdrawAmount).to.be.equal(String(usdcVal(1000)));
                    expect(await rwa.balanceOf(user2)).to.be.equal(String(user2RWABefore.add(bigVal(500))));
                    expect(await rwa.balanceOf(withdrawQueue.address)).to.be.equal(String(queueRWABefore.sub(bigVal(500))));
                })
            })

            context("it has multiple orders", () => {
                before(async() => {
                    await withdrawQueue.connect(user1Signer).register(String(bigVal(5000)));
                })

                it("it has the right setting", async () => {
                    expect(await withdrawQueue.totalRegisteredAmount()).to.be.equal(String(bigVal(1500).add(bigVal(5000))));
                    let user1WithdrawData = await withdrawQueue.userWithdrawData(user1);
                    let user2WithdrawData = await withdrawQueue.userWithdrawData(user2);
                    expect(user1WithdrawData.listInQueue).to.be.equal(true);
                    expect(user1WithdrawData.queueIndex).to.be.equal(3);
                    expect(user1WithdrawData.Claimable).to.be.equal("0");
                    expect(user2WithdrawData.listInQueue).to.be.equal(true);
                    expect(user2WithdrawData.queueIndex).to.be.equal(2);
                    expect(user2WithdrawData.Claimable).to.be.equal("0");
                    let withdrawData4 = await withdrawQueue.withdrawQueue(3);
                    expect(withdrawData4.user).to.be.equal(user1);
                    expect(withdrawData4.registeredAmount).to.be.equal(String(bigVal(5000)));
                    expect(withdrawData4.remainingAmount).to.be.equal(String(bigVal(5000)));
                    expect(withdrawData4.withdrawAmount).to.be.equal(String(usdcVal(0)));
                })

                it("it updates without any changes because there is no enough liquidity", async () => {
                    await withdrawQueue.withdrawFromIndexPool();
                    expect(await withdrawQueue.queueIndex()).to.be.equal("2");
                    expect(await withdrawQueue.totalRegisteredAmount()).to.be.equal(String(bigVal(1500).add(bigVal(5000))));
                    let user1WithdrawData = await withdrawQueue.userWithdrawData(user1);
                    let user2WithdrawData = await withdrawQueue.userWithdrawData(user2);
                    expect(user1WithdrawData.listInQueue).to.be.equal(true);
                    expect(user1WithdrawData.queueIndex).to.be.equal(3);
                    expect(user1WithdrawData.Claimable).to.be.equal("0");
                    expect(user2WithdrawData.listInQueue).to.be.equal(true);
                    expect(user2WithdrawData.queueIndex).to.be.equal(2);
                    expect(user2WithdrawData.Claimable).to.be.equal("0");
                    let withdrawData3 = await withdrawQueue.withdrawQueue(2);
                    let withdrawData4 = await withdrawQueue.withdrawQueue(3);
                    expect(withdrawData3.user).to.be.equal(user2);
                    expect(withdrawData3.registeredAmount).to.be.equal(String(bigVal(2500)));
                    expect(withdrawData3.remainingAmount).to.be.equal(String(bigVal(1500)));
                    expect(withdrawData3.withdrawAmount).to.be.equal(String(usdcVal(1000)));
                    expect(withdrawData4.user).to.be.equal(user1);
                    expect(withdrawData4.registeredAmount).to.be.equal(String(bigVal(5000)));
                    expect(withdrawData4.remainingAmount).to.be.equal(String(bigVal(5000)));
                    expect(withdrawData4.withdrawAmount).to.be.equal(String(usdcVal(0)));
                })

                context("it has some liquidity for the partially withdrawn", () => {
                    before(async () => {
                        await indexPool.connect(user1Signer).deposit(String(usdcVal(2500)));
                        await withdrawQueue.withdrawFromIndexPool();
                    })

                    it("it updates the withdraw queue", async () => {
                        await withdrawQueue.withdrawFromIndexPool();
                        expect(await withdrawQueue.totalRegisteredAmount()).to.be.equal(String(bigVal(1500).add(bigVal(5000)).sub(bigVal(2500))));
                        expect(await withdrawQueue.queueIndex()).to.be.equal("3");
                        let user1WithdrawData = await withdrawQueue.userWithdrawData(user1);
                        let user2WithdrawData = await withdrawQueue.userWithdrawData(user2);
                        expect(user1WithdrawData.listInQueue).to.be.equal(true);
                        expect(user1WithdrawData.queueIndex).to.be.equal(3);
                        expect(user1WithdrawData.Claimable).to.be.equal(String(usdcVal(1000)));
                        expect(user2WithdrawData.listInQueue).to.be.equal(false);
                        expect(user2WithdrawData.queueIndex).to.be.equal(2);
                        expect(user2WithdrawData.Claimable).to.be.equal(String(usdcVal(1500)));
                        let withdrawData3 = await withdrawQueue.withdrawQueue(2);
                        let withdrawData4 = await withdrawQueue.withdrawQueue(3);
                        expect(withdrawData3.user).to.be.equal(user2);
                        expect(withdrawData3.registeredAmount).to.be.equal(String(bigVal(2500)));
                        expect(withdrawData3.remainingAmount).to.be.equal("0");
                        expect(withdrawData3.withdrawAmount).to.be.equal(String(usdcVal(2500)));
                        expect(withdrawData4.user).to.be.equal(user1);
                        expect(withdrawData4.registeredAmount).to.be.equal(String(bigVal(5000)));
                        expect(withdrawData4.remainingAmount).to.be.equal(String(bigVal(4000)));
                        expect(withdrawData4.withdrawAmount).to.be.equal(String(usdcVal(1000)));
                    })
                })
            })
        })

        context("withdraw fee tier", () => {
            it("it rejects if the input breaks the rules", async () => {
                await expect(withdrawQueue.setFeeTier(5, String(bigVal(1000)), 10)).to.be.revertedWith("Invalid index");
                await expect(withdrawQueue.setFeeTier(1, String(bigVal(300)), 60)).to.be.revertedWith("Failed to set fee tier (too large)");
                await expect(withdrawQueue.setFeeTier(2, String(bigVal(200)), 30)).to.be.revertedWith("veNOAS amount should be greater than previous one");
                await expect(withdrawQueue.setFeeTier(2, String(bigVal(600)), 41)).to.be.revertedWith("fee should be less than previous one");
                await expect(withdrawQueue.setFeeTier(2, String(bigVal(1000)), 30)).to.be.revertedWith("veNOAS amount should be less than next one");
                await expect(withdrawQueue.setFeeTier(2, String(bigVal(600)), 19)).to.be.revertedWith("fee should be greate than next one");

            })

            it("it updates the fee tier successfully", async () => {
                await withdrawQueue.setFeeTier(2, String(bigVal(700)), 35);
                await withdrawQueue.setFeeTier(3, String(bigVal(1200)), 10);

                let feeTier0 = await withdrawQueue.feeTiers(0);
                expect(feeTier0.veNAOSAmount).to.be.equal(String(bigVal(0)));
                expect(feeTier0.fee).to.be.equal(50);
                let feeTier1 = await withdrawQueue.feeTiers(1);
                expect(feeTier1.veNAOSAmount).to.be.equal(String(bigVal(300)));
                expect(feeTier1.fee).to.be.equal(40);
                let feeTier2 = await withdrawQueue.feeTiers(2);
                expect(feeTier2.veNAOSAmount).to.be.equal(String(bigVal(700)));
                expect(feeTier2.fee).to.be.equal(35);
                let feeTier3 = await withdrawQueue.feeTiers(3);
                expect(feeTier3.veNAOSAmount).to.be.equal(String(bigVal(1200)));
                expect(feeTier3.fee).to.be.equal(10);
            })
        })
    })

})