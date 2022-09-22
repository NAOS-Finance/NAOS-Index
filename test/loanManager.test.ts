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
  SECONDS_PER_DAY,
  expectProxyOwner
} from "./testHelpers"
import { CONFIG_KEYS } from "../scripts/blockchain_scripts/configKeys"
import { TRANCHES, interestAprAsBN } from "../scripts/blockchain_scripts/deployHelpers"
import { deployFixture, deployJuniorPoolWithNAOSFactoryFixture } from "./util/fixtures"
import { NAOSConfig__factory } from "../types"

// eslint-disable-next-line no-unused-vars
let accounts, owner, deployer, user1, user2;
let user1Signer, user2Signer;
let naosConfig, reserve, usdc, indexPool, loanManager;
let juniorPool1, creditLine1, pool1NFT, juniorPool2, creditLine2, pool2NFT;

describe("LoanManager", async function () {

  const setupTest = deployments.createFixture(async ({ deployments }) => {
    const { indexPool, usdc, naosConfig, loanManager } =
      await deployFixture()
    // Approve transfers for our test accounts
    await erc20Approve(usdc, indexPool.address, usdcVal(100000), [owner, deployer, user1, user2])
    // Some housekeeping so we have a usable creditDesk for tests, and a indexPool with funds
    await erc20Transfer(usdc, [user1, user2], usdcVal(100000), owner)

    // Add all web3 accounts to the GoList
    await naosConfig.bulkAddToGoList(accounts)
    user1Signer = await ethers.getSigner(user1);
    user2Signer = await ethers.getSigner(user2);
    await indexPool.connect(user1Signer).deposit(String(usdcVal(15000)));
    await indexPool.connect(user2Signer).deposit(String(usdcVal(15000)));

    // Set the reserve to a separate address for easier separation. The current owner account gets used for many things in tests.
    await naosConfig.setTreasuryReserve(reserve);

    let limit = usdcVal(10000)
    let interestApr = interestAprAsBN("25")
    let lateFeeApr = interestAprAsBN("0")
    const juniorFeePercent = new BN(20)
    let paymentPeriodInDays = new BN(1)
    let termInDays = new BN(365)
    const principalGracePeriodInDays = SECONDS_PER_DAY.mul(new BN(185))
    const fundableAt = new BN(0)
    let TestNFT = await ethers.getContractFactory("TestNFT");

    let pool1 = await deployJuniorPoolWithNAOSFactoryFixture({
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
      id: "JuniorPool1",
    })
    let juniorPool1 = pool1.juniorPool;
    let creditLine1 = pool1.creditLine;
    await usdc.connect(user1Signer).approve(juniorPool1.address, String(usdcVal(2000)))
    await juniorPool1.connect(user1Signer).deposit(TRANCHES.Junior, String(usdcVal(2000)))
    await juniorPool1.lockJuniorCapital()
    await indexPool.invest(juniorPool1.address);
    await advanceTime({ days: 2 });
    let pool1NFT = await TestNFT.deploy();

    let pool2 = await deployJuniorPoolWithNAOSFactoryFixture({
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
      id: "JuniorPool2",
    })
    let juniorPool2 = pool2.juniorPool;
    let creditLine2 = pool2.creditLine;
    await usdc.connect(user2Signer).approve(juniorPool2.address, String(usdcVal(2000)))
    await juniorPool2.connect(user2Signer).deposit(TRANCHES.Junior, String(usdcVal(2000)))
    await juniorPool2.lockJuniorCapital()
    await indexPool.invest(juniorPool2.address);
    let pool2NFT = await TestNFT.deploy();

    return { indexPool, usdc, naosConfig, loanManager, juniorPool1, creditLine1, pool1NFT, juniorPool2, creditLine2, pool2NFT }
  })

  before(async () => {
    accounts = await web3.eth.getAccounts()
      ;[owner, deployer, user1, user2, reserve] = accounts
      ; ({ usdc, indexPool, naosConfig, loanManager, juniorPool1, creditLine1, pool1NFT, juniorPool2, creditLine2, pool2NFT } = await setupTest())
  })

  context("set up the pools", () => {
    before(async () => {
      await loanManager.addPool(juniorPool1.address, pool1NFT.address);
      await loanManager.addPool(juniorPool2.address, pool2NFT.address);
      await loanManager.updateOperator(0, user1);
      await loanManager.updateOperator(1, user2);
    })

    it("it rejects if the pool address is invalid", async () => {
      await expect(loanManager.addPool(pool1NFT.address, juniorPool1.address)).to.be.revertedWith("invalid pool");
    })

    it("it rejects if it creates duplicated pools", async () => {
      await expect(loanManager.addPool(juniorPool1.address, pool1NFT.address)).to.be.revertedWith("Pool has been added");
    })

    it("it rejects if the pool id is invalid", async () => {
      await expect(loanManager.updateOperator(2, user2)).to.be.revertedWith("poolId out of range");
    })

    it("it has the right setting", async () => {
      expect((await loanManager.poolList(0)).toLowerCase()).to.be.equal(juniorPool1.address.toLowerCase());
      expect((await loanManager.poolList(1)).toLowerCase()).to.be.equal(juniorPool2.address.toLowerCase());
      let pool1Info = await loanManager.pools(juniorPool1.address);
      let pool2Info = await loanManager.pools(juniorPool2.address);
      expect(pool1Info.poolExist).to.be.equal(true);
      expect(pool1Info.juniorPoolAddress.toLowerCase()).to.be.equal(juniorPool1.address.toLowerCase());
      expect(pool1Info.token.toLowerCase()).to.be.equal(pool1NFT.address.toLowerCase());
      expect(pool2Info.poolExist).to.be.equal(true);
      expect(pool2Info.juniorPoolAddress.toLowerCase()).to.be.equal(juniorPool2.address.toLowerCase());
      expect(pool2Info.token.toLowerCase()).to.be.equal(pool2NFT.address.toLowerCase());
    })
  })

  context("lock loan token", () => {
    before(async () => {
      await pool1NFT.safeMint(user1, "test");
      await pool1NFT.safeMint(user1, "test");
      await pool2NFT.safeMint(user2, "test");
      await pool2NFT.safeMint(user2, "test");
      await pool1NFT.connect(user1Signer).setApprovalForAll(loanManager.address, true);
      await pool2NFT.connect(user2Signer).setApprovalForAll(loanManager.address, true);
      await loanManager.connect(user1Signer).lockLoan(0, 0);
      await loanManager.connect(user1Signer).lockLoan(0, 1);
      await loanManager.connect(user2Signer).lockLoan(1, 0);
    })

    it("it rejects if the sender is not operator of the pool", async () => {
      await expect(loanManager.connect(user1Signer).lockLoan(1, 1)).to.be.revertedWith("Sender is not the operator of the pool");
    })

    it("it rejects if the token has been locked", async () => {
      await expect(loanManager.connect(user1Signer).lockLoan(0, 0)).to.be.revertedWith("token has been locked");
    })

    it("it rejects if the token does not exist", async () => {
      await expect(loanManager.connect(user1Signer).lockLoan(0, 2)).to.be.revertedWith("ERC721: operator query for nonexistent token");
    })

    it("it has the rigth setting", async () => {
      expect((await pool1NFT.ownerOf(0)).toLowerCase()).to.be.equal(loanManager.address.toLowerCase());
      expect((await pool1NFT.ownerOf(1)).toLowerCase()).to.be.equal(loanManager.address.toLowerCase());
      expect((await pool2NFT.ownerOf(0)).toLowerCase()).to.be.equal(loanManager.address.toLowerCase());
    })

  })

  context("unlock loan token", () => {
    before(async () => {
      await juniorPool1.drawdown(String(usdcVal(4000)))
      await juniorPool1.drawdown(String(usdcVal(6000)))
    })

    it("it rejects if the sender is not operator of the pool", async () => {
      await expect(loanManager.connect(user2Signer).unlockLoan(0, 1)).to.be.revertedWith("Sender is not the operator of the pool");
    })

    it("it rejects if there is outstanding in the pool", async () => {
      await expect(loanManager.connect(user1Signer).unlockLoan(0, 0)).to.be.revertedWith("it has outstanding loans");
    })

    it("it rejects if the token is not locked", async () => {
      await expect(loanManager.connect(user2Signer).unlockLoan(1, 1)).to.be.revertedWith("token should be locked");
    })

    it("it unlocks successfully", async () => {
      await loanManager.connect(user2Signer).unlockLoan(1, 0);
      expect((await pool2NFT.ownerOf(0)).toLowerCase()).to.be.equal(user2.toLowerCase());
    })
  })

  context("liquidation process", () => {
    it("it rejects if it set the token price if the loan is liqudiated", async () => {
      await expect(loanManager.setTokenPrice(0, [1], [1])).to.be.revertedWith("The pool is not going through the liquidation process");
    })

    it("it rejects if the pool can't be liquidated", async () => {
      await expect(loanManager.liquidate(0)).to.be.revertedWith("No writedown amount");
    })

    context("when the loan is liquidated", () => {
      before(async () => {
        await advanceTime({ days: 121 });
        await loanManager.liquidate(0);
      })

      it("it rejects if the loan has been liqidated", async () => {
        await expect(loanManager.liquidate(0)).to.be.rejectedWith("The pool is going through the liquidation process");
      })

      it("it updated the liquidation status of the junior pool", async () => {
        expect(await juniorPool1.liquidated()).to.be.equal(2);
      })

      it("it has the right interest and principle accumulated and would not calculate anymore", async () => {
        let interestOwed = String(usdcVal(10000).mul(new BN(25)).mul(new BN(121)).div(new BN(100)).div(new BN(365)));
        expect(parseInt(String(((await creditLine1.interestOwed()).sub(interestOwed)).abs()))).to.be.lessThan(100);
        expect(await creditLine1.principalOwed()).to.be.equal(String(usdcVal(10000)));
        await advanceTime({ days: 5 });
        await juniorPool1.assess();
        expect(parseInt(String(((await creditLine1.interestOwed()).sub(interestOwed)).abs()))).to.be.lessThan(100);
        expect(await creditLine1.principalOwed()).to.be.equal(String(usdcVal(10000)));
      })

      it("it reduces the index pool token price", async () => {
        let newPrice = String(bigVal(1).mul(new BN(22000)).div(new BN(30000)));
        expect(parseInt(String(((await indexPool.sharePrice()).sub(newPrice)).abs()))).to.be.lessThanOrEqual(1);
      })

      context("repay the liquidated loan", () => {
        before(async () => {
          await loanManager.setTokenPrice(0, [0], [String(usdcVal(4000))]);
          await loanManager.updateLiquidator(0, user1, true);
        })

        it("it rejects if the input is invalid", async () => {
          await expect(loanManager.setTokenPrice(0, [2, 1], [1])).to.be.revertedWith("inconsist input length");
        })

        it("it rejects if the token is not locked", async () => {
          await expect(loanManager.setTokenPrice(0, [2], [1])).to.be.revertedWith("token should be locked");
        })

        it("it rejects if the sender is not the liquidator", async () => {
          await expect(loanManager.connect(user2Signer).liquidateLoan(0, 0)).to.be.revertedWith("Sender is not the liquidator of the pool");
        })

        it("it rejects if the token price is not set", async () => {
          await expect(loanManager.connect(user1Signer).liquidateLoan(0, 1)).to.be.revertedWith("price is not set");
        })

        it("it rejects if the token is not locked", async () => {
          await expect(loanManager.connect(user1Signer).liquidateLoan(0, [3])).to.be.revertedWith("token should be locked");
        })

        context("it liquidate the loan successfully", () => {
          before(async () => {
            await usdc.connect(user1Signer).approve(loanManager.address, String(usdcVal(4000)));
            await loanManager.connect(user1Signer).liquidateLoan(0, 0);
          })

          it("it checks the parameter", async () => {
            let interestOwed = String(usdcVal(10000).mul(new BN(25)).mul(new BN(121)).div(new BN(100)).div(new BN(365)));
            expect(parseInt(String(((await creditLine1.interestOwed()).sub(interestOwed)).abs()))).to.be.lessThan(100);
            expect(await creditLine1.principalOwed()).to.be.equal(String(usdcVal(6000)));
            let newPrice = String(bigVal(1).mul(new BN(26000)).div(new BN(30000)));
            expect(parseInt(String(((await indexPool.sharePrice()).sub(newPrice)).abs()))).to.be.lessThanOrEqual(1);
            expect((await pool1NFT.ownerOf(0)).toLowerCase()).to.be.equal(user1.toLowerCase());
            expect((await usdc.balanceOf(indexPool.address))).to.be.equal(String(usdcVal(18000)));
          })

          context("it liquidate the loan successfully", () => {
            before(async () => {
              await loanManager.setTokenPrice(0, [1], [String(usdcVal(6800))]);
              await usdc.connect(user1Signer).approve(loanManager.address, String(usdcVal(6800)));
              await loanManager.connect(user1Signer).liquidateLoan(0, 1);
            })
  
            it("it checks the parameter", async () => {
              let interestOwed = String(usdcVal(10000).mul(new BN(25)).mul(new BN(121)).div(new BN(100)).div(new BN(365)).sub(usdcVal(800)));
              expect(parseInt(String(((await creditLine1.interestOwed()).sub(interestOwed)).abs()))).to.be.lessThan(100);
              expect(await creditLine1.principalOwed()).to.be.equal(String(usdcVal(0)));
              let indexUSDCBalance = String(await usdc.balanceOf(indexPool.address));
              let indexInterestToShare = (new BN(indexUSDCBalance)).sub(usdcVal(22000)).mul(bigVal(1)).div(usdcVal(1)).div(new BN(30000));
              expect(await indexPool.sharePrice()).to.be.equal(String(bigVal(1).add(indexInterestToShare)));
            })

            it("it withdraws the money from junior pool", async () => {
              let indexUSDCBalance = await usdc.balanceOf(juniorPool1.address);
              let user1USDCBalanceBefore = await usdc.balanceOf(user1);
              await juniorPool1.connect(user1Signer).withdrawMax(1);
              expect(await usdc.balanceOf(user1)).to.be.equal(String(user1USDCBalanceBefore.add(indexUSDCBalance)));
            })
          })
        })
      })
    })
  })
})
