import { expect } from "chai";
import { ethers, deployments } from 'hardhat';
import { utils } from 'ethers';
import { parseUnits } from "ethers/lib/utils";

const USDCDecimal = 6;
const BUSDDecimal = 18;
const NAOSDecimal = 18;
const nUSDCMintAmount = utils.parseUnits('1000', USDCDecimal);
const nBUSDMintAmount = utils.parseUnits('1000', BUSDDecimal);
const NAOSMintAmount = utils.parseUnits('300000000', NAOSDecimal);
const user1NUSDCDepositAmount = utils.parseUnits('200', USDCDecimal);
const user2NUSDCDepositAmount = utils.parseUnits('400', USDCDecimal);
const user1NBUSDDepositAmount = utils.parseUnits('300', BUSDDecimal);
const user2NBUSDDepositAmount = utils.parseUnits('600', BUSDDecimal);
const user1BoostPoolDeposit = utils.parseUnits('400', NAOSDecimal);
const user2BoostPoolDeposit = utils.parseUnits('100', NAOSDecimal);
const totalBoostPoolDeposit = user1BoostPoolDeposit.add(user2BoostPoolDeposit);
const ONE_WEEK = 86400 * 7;
const ONE_YEAR = 86400 * 365;

describe("Index Staking Pool", () => {
  const setUp = deployments.createFixture(
    async () => {
      let deployer, governance, user1, user2;

      let TestERC20 = await ethers.getContractFactory("TestERC20");
      let TestBoostPool = await ethers.getContractFactory("TestBoostPool");
      let IndexStakingPool = await ethers.getContractFactory("IndexStakingPool");

      let signers = await ethers.getSigners();
      [deployer, governance, user1, user2, ...signers] = signers;

      let nUSDC = await TestERC20.deploy(nUSDCMintAmount, USDCDecimal);
      let nBUSD = await TestERC20.deploy(nBUSDMintAmount, BUSDDecimal);
      let NAOS = await TestERC20.deploy(NAOSMintAmount, NAOSDecimal);
      let boostPool = await TestBoostPool.deploy();
      let stakingPool = await IndexStakingPool.deploy(NAOS.address, boostPool.address, governance.address);

      await NAOS.transfer(stakingPool.address, NAOSMintAmount);
      await nUSDC.transfer(user1.address, user1NUSDCDepositAmount);
      await nUSDC.transfer(user2.address, user2NUSDCDepositAmount);
      await nBUSD.transfer(user1.address, user1NBUSDDepositAmount);
      await nBUSD.transfer(user2.address, user2NBUSDDepositAmount);
      await nUSDC.connect(user1).approve(stakingPool.address, user1NUSDCDepositAmount);
      await nUSDC.connect(user2).approve(stakingPool.address, user2NUSDCDepositAmount);
      await nBUSD.connect(user1).approve(stakingPool.address, user1NBUSDDepositAmount);
      await nBUSD.connect(user2).approve(stakingPool.address, user2NBUSDDepositAmount);

      await boostPool.connect(user1).deposit(user1BoostPoolDeposit);
      await boostPool.connect(user2).deposit(user2BoostPoolDeposit);

      await stakingPool.connect(governance).createPool(nUSDC.address);

      return {
        nUSDC, nBUSD, NAOS, boostPool, stakingPool, deployer, governance, user1, user2
      };
    })

  let calcUserWeight = (
    poolDeposited,
    userDeposited,
    boostPoolDepositedWeight,
    boostUserDepositedWeight
  ) => {
    let weighted = userDeposited.mul(40).div(100);
    if (boostPoolDepositedWeight > 0) {
      weighted = weighted.add(poolDeposited.mul(boostUserDepositedWeight).mul(60).div(boostPoolDepositedWeight).div(100));
      if (weighted >= userDeposited) {
        weighted = userDeposited;
      }
    }

    return weighted;
  }

  let calcUserReward = (userRewardWeight, poolRewardWeight, poolRewardRate, depositTime, startTime, endTime, vestingTime) => {
    let elapsedTime = endTime - depositTime;
    let reward = userRewardWeight.mul(poolRewardRate).mul(endTime - startTime).div(poolRewardWeight);
    if((endTime - depositTime) < vestingTime) {
      reward = reward.mul(elapsedTime).div(vestingTime);
    }
    return reward;
  }

  let getBlockTimestamp = async (tx) => {
    tx = await tx.wait();
    let block = await ethers.provider.getBlock(tx.blockNumber);
    return block.timestamp;
  }

  let timeFly = async (seconds) => {
    return await ethers.provider.send('evm_increaseTime', [seconds]);
  }

  let deployment;
  describe("set parameters", () => {
    context("set pools", () => {

      before(async () => {
        deployment = await setUp();
      });

      it("it has correct pool's parameter", async () => {
        expect((await deployment.stakingPool.poolCount()).toString()).to.equal("1");
        expect(await deployment.stakingPool.getPoolToken(0)).to.equal(deployment.nUSDC.address);
      })

      it("it rejects if it creates duplicated pool", async () => {
        await expect(
          deployment.stakingPool.connect(deployment.governance).createPool(deployment.nUSDC.address)
        ).to.be.revertedWith("token already has a pool");
      })

      it("it successfully creates the second pools", async () => {
        await deployment.stakingPool.connect(deployment.governance).createPool(deployment.nBUSD.address);
        expect((await deployment.stakingPool.poolCount()).toString()).to.equal("2");
        expect(await deployment.stakingPool.getPoolToken(0)).to.equal(deployment.nUSDC.address);
        expect(await deployment.stakingPool.getPoolToken(1)).to.equal(deployment.nBUSD.address);
      })

      context("set reward", () => {
        before(async () => {
          deployment = await setUp();
          await deployment.stakingPool.connect(deployment.governance).createPool(deployment.nBUSD.address);
        });

        it("it reject if the rewardWeight is out of range", async () => {
          await expect(
            deployment.stakingPool.connect(deployment.governance).setRewardWeights([1, 2, 3])
          ).to.be.revertedWith("StakingPools: weights length mismatch");
        })

        it("it sets the right reward", async () => {
          let rewardRate = utils.parseUnits('1', NAOSDecimal);
          let rewardWeights = [1, 3];
          let totalRewardWeight = rewardWeights[0] + rewardWeights[1];
          await deployment.stakingPool.connect(deployment.governance).setRewardRate(rewardRate);
          await deployment.stakingPool.connect(deployment.governance).setRewardWeights(rewardWeights);
          expect((await deployment.stakingPool.rewardRate()).toString()).to.equal(rewardRate.toString());
          expect((await deployment.stakingPool.getPoolRewardRate(0)).toString()).to.equal((rewardRate.mul(rewardWeights[0]).div(totalRewardWeight)).toString());
          expect((await deployment.stakingPool.getPoolRewardRate(1)).toString()).to.equal((rewardRate.mul(rewardWeights[1]).div(totalRewardWeight)).toString());
          expect((await deployment.stakingPool.totalRewardWeight()).toString()).to.equal(totalRewardWeight.toString());
          expect((await deployment.stakingPool.getPoolRewardWeight(0)).toString()).to.equal(rewardWeights[0].toString());
          expect((await deployment.stakingPool.getPoolRewardWeight(1)).toString()).to.equal(rewardWeights[1].toString());
        })
      })
    })
  });

  describe("deposit status", () => {
    beforeEach(async () => {
      deployment = await setUp();
      await deployment.stakingPool.connect(deployment.governance).createPool(deployment.nBUSD.address);
      await deployment.stakingPool.connect(deployment.governance).setRewardWeights([1, 3]);
    });

    it('it should be rejected if there is no enough tokens', async () => {
      await expect(
        deployment.stakingPool.connect(deployment.user1).deposit(deployment.user1.address, 0, user1NUSDCDepositAmount.add(1))
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    })

    it("it successfully deposits", async () => {
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user1.address, 0, user1NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user1.address, 1, user1NBUSDDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user2.address, 0, user2NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user2.address, 1, user2NBUSDDepositAmount);
      expect((await deployment.stakingPool.getPoolTotalDeposited(0)).toString()).equal(user1NUSDCDepositAmount.add(user2NUSDCDepositAmount).toString());
      expect((await deployment.stakingPool.getPoolTotalDeposited(1)).toString()).equal(user1NBUSDDepositAmount.add(user2NBUSDDepositAmount).toString());
      expect((await deployment.stakingPool.getUserOrderCount(0, deployment.user1.address)).toString()).equal("1");
      expect((await deployment.stakingPool.getUserOrderCount(1, deployment.user1.address)).toString()).equal("1");
      expect((await deployment.stakingPool.getUserOrderCount(0, deployment.user2.address)).toString()).equal("1");
      expect((await deployment.stakingPool.getUserOrderCount(1, deployment.user2.address)).toString()).equal("1");

      let order1 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user1.address, 0);
      let order2 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user1.address, 0);
      let order3 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user2.address, 0);
      let order4 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user2.address, 0);
      expect(order1.totalDeposited).equal(user1NUSDCDepositAmount.toString());
      expect(order2.totalDeposited).equal(user1NBUSDDepositAmount.toString());
      expect(order3.totalDeposited).equal(user2NUSDCDepositAmount.toString());
      expect(order4.totalDeposited).equal(user2NBUSDDepositAmount.toString());
      expect(order1.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount, user1NUSDCDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order2.totalDepositedWeight)
        .equal(calcUserWeight(user1NBUSDDepositAmount, user1NBUSDDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order3.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount.add(user2NUSDCDepositAmount), user2NUSDCDepositAmount, totalBoostPoolDeposit, user2BoostPoolDeposit));
      expect(order4.totalDepositedWeight)
        .equal(calcUserWeight(user1NBUSDDepositAmount.add(user2NBUSDDepositAmount), user2NBUSDDepositAmount, totalBoostPoolDeposit, user2BoostPoolDeposit));
    })

    it("it successfully deposits with different setting", async () => {
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user2.address, 0, user1NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user2.address, 1, user1NBUSDDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user1.address, 0, user2NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user1.address, 1, user2NBUSDDepositAmount);
      expect((await deployment.stakingPool.getPoolTotalDeposited(0)).toString()).equal(user1NUSDCDepositAmount.add(user2NUSDCDepositAmount).toString());
      expect((await deployment.stakingPool.getPoolTotalDeposited(1)).toString()).equal(user1NBUSDDepositAmount.add(user2NBUSDDepositAmount).toString());
      expect((await deployment.stakingPool.getUserOrderCount(0, deployment.user1.address)).toString()).equal("1");
      expect((await deployment.stakingPool.getUserOrderCount(1, deployment.user1.address)).toString()).equal("1");
      expect((await deployment.stakingPool.getUserOrderCount(0, deployment.user2.address)).toString()).equal("1");
      expect((await deployment.stakingPool.getUserOrderCount(1, deployment.user2.address)).toString()).equal("1");

      let order1 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user1.address, 0);
      let order2 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user1.address, 0);
      let order3 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user2.address, 0);
      let order4 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user2.address, 0);
      expect(order1.totalDeposited).equal(user2NUSDCDepositAmount.toString());
      expect(order2.totalDeposited).equal(user2NBUSDDepositAmount.toString());
      expect(order3.totalDeposited).equal(user1NUSDCDepositAmount.toString());
      expect(order4.totalDeposited).equal(user1NBUSDDepositAmount.toString());
      expect(order1.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount.add(user2NUSDCDepositAmount), user2NUSDCDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order2.totalDepositedWeight)
        .equal(calcUserWeight(user1NBUSDDepositAmount.add(user2NBUSDDepositAmount), user2NBUSDDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order3.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount, user1NUSDCDepositAmount, totalBoostPoolDeposit, user2BoostPoolDeposit));
      expect(order4.totalDepositedWeight)
        .equal(calcUserWeight(user1NBUSDDepositAmount, user1NBUSDDepositAmount, totalBoostPoolDeposit, user2BoostPoolDeposit));
    })

    it("it successfully deposits with different setting", async () => {
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user1.address, 0, user1NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user2.address, 1, user1NBUSDDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user1.address, 0, user2NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user2.address, 1, user2NBUSDDepositAmount);
      expect((await deployment.stakingPool.getPoolTotalDeposited(0)).toString()).equal(user1NUSDCDepositAmount.add(user2NUSDCDepositAmount).toString());
      expect((await deployment.stakingPool.getPoolTotalDeposited(1)).toString()).equal(user1NBUSDDepositAmount.add(user2NBUSDDepositAmount).toString());
      expect((await deployment.stakingPool.getUserOrderCount(0, deployment.user1.address)).toString()).equal("2");
      expect((await deployment.stakingPool.getUserOrderCount(0, deployment.user2.address)).toString()).equal("0");
      expect((await deployment.stakingPool.getUserOrderCount(1, deployment.user1.address)).toString()).equal("0");
      expect((await deployment.stakingPool.getUserOrderCount(1, deployment.user2.address)).toString()).equal("2");

      let order1 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user1.address, 0);
      let order2 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user1.address, 1);
      let order3 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user2.address, 0);
      let order4 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user2.address, 1);
      expect(order1.totalDeposited).equal(user1NUSDCDepositAmount.toString());
      expect(order2.totalDeposited).equal(user2NUSDCDepositAmount.toString());
      expect(order3.totalDeposited).equal(user1NBUSDDepositAmount.toString());
      expect(order4.totalDeposited).equal(user2NBUSDDepositAmount.toString());
      expect(order1.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount, user1NUSDCDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order2.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount.add(user2NUSDCDepositAmount), user2NUSDCDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order3.totalDepositedWeight)
        .equal(calcUserWeight(user1NBUSDDepositAmount, user1NBUSDDepositAmount, totalBoostPoolDeposit, user2BoostPoolDeposit));
      expect(order4.totalDepositedWeight)
        .equal(calcUserWeight(user1NBUSDDepositAmount.add(user2NBUSDDepositAmount), user2NBUSDDepositAmount, totalBoostPoolDeposit, user2BoostPoolDeposit));
    })
  })

  describe("withdraw status", () => {
    before(async () => {
      deployment = await setUp();
      await deployment.stakingPool.connect(deployment.governance).createPool(deployment.nBUSD.address);
      await deployment.stakingPool.connect(deployment.governance).setRewardWeights([1, 3]);
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user1.address, 0, user1NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user1.address, 1, user1NBUSDDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user2.address, 0, user2NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user1.address, 1, user2NBUSDDepositAmount);
    });

    it("it should be rejected if the input index is out of range", async () => {
      await expect(
        deployment.stakingPool.connect(deployment.user1).withdraw(0, [1, 2], [1, 2])
      ).to.be.revertedWith("invalid index");
      await expect(
        deployment.stakingPool.connect(deployment.user1).withdraw(0, [1], [1])
      ).to.be.revertedWith("invalid index");
    })

    it("it should be rejected if the input is invalid", async () => {
      await expect(
        deployment.stakingPool.connect(deployment.user1).withdraw(0, [1], [1, 2])
      ).to.be.revertedWith("inconsistent input index");
    })

    it("it should be rejected if the user redeem exceeds the deposited amount", async () => {
      await expect(
        deployment.stakingPool.connect(deployment.user1).withdraw(0, [0], [user1NUSDCDepositAmount.add(1)])
      ).to.be.revertedWith("No enough money for the withdrawn");
    })

    it("it withdraw successfully", async () => {
      await deployment.stakingPool.connect(deployment.user1).withdraw(1, [0, 1], [user1NBUSDDepositAmount, user1NBUSDDepositAmount]);
      await deployment.stakingPool.connect(deployment.user2).withdraw(0, [0], [user1NUSDCDepositAmount]);
      expect((await deployment.stakingPool.getPoolTotalDeposited(0)).toString()).equal(user2NUSDCDepositAmount.toString());
      expect((await deployment.stakingPool.getPoolTotalDeposited(1)).toString()).equal(user2NBUSDDepositAmount.sub(user1NBUSDDepositAmount).toString());
      expect((await deployment.stakingPool.getStakeTotalDeposited(0, deployment.user1.address, 0)).toString()).equal(user1NUSDCDepositAmount.toString());
      expect((await deployment.stakingPool.getStakeTotalDeposited(0, deployment.user2.address, 0)).toString()).equal(user2NUSDCDepositAmount.sub(user1NUSDCDepositAmount).toString());
      expect((await deployment.stakingPool.getStakeTotalDeposited(1, deployment.user1.address, 0)).toString()).equal("0");
      expect((await deployment.stakingPool.getStakeTotalDeposited(1, deployment.user1.address, 1)).toString()).equal(user2NBUSDDepositAmount.sub(user1NBUSDDepositAmount).toString());

      let order1 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user1.address, 0);
      let order2 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user2.address, 0);
      let order3 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user1.address, 0);
      let order4 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user1.address, 1);
      expect(order1.totalDeposited).equal(user1NUSDCDepositAmount.toString());
      expect(order2.totalDeposited).equal(user2NUSDCDepositAmount.sub(user1NUSDCDepositAmount).toString());
      expect(order3.totalDeposited).equal("0");
      expect(order4.totalDeposited).equal(user2NBUSDDepositAmount.sub(user1NBUSDDepositAmount).toString());
      expect(order1.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount, user1NUSDCDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order2.totalDepositedWeight)
        .equal(calcUserWeight(user2NUSDCDepositAmount, user2NUSDCDepositAmount.sub(user1NUSDCDepositAmount), totalBoostPoolDeposit, user2BoostPoolDeposit));
      expect(order3.totalDepositedWeight)
        .equal(calcUserWeight(user2NBUSDDepositAmount.sub(user1NBUSDDepositAmount), parseUnits("0", 0), totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order4.totalDepositedWeight)
        .equal(calcUserWeight(user2NBUSDDepositAmount.sub(user1NBUSDDepositAmount), user2NBUSDDepositAmount.sub(user1NBUSDDepositAmount), totalBoostPoolDeposit, user1BoostPoolDeposit));
    })
  })

  describe("claim rewards", () => {
    let order1, order2, order3, order4;
    before(async () => {
      deployment = await setUp();
      await deployment.stakingPool.connect(deployment.governance).createPool(deployment.nBUSD.address);
      await deployment.stakingPool.connect(deployment.governance).setRewardWeights([1, 3]);
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user1.address, 0, user1NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user1).deposit(deployment.user1.address, 1, user1NBUSDDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user2.address, 0, user2NUSDCDepositAmount);
      await deployment.stakingPool.connect(deployment.user2).deposit(deployment.user2.address, 1, user2NBUSDDepositAmount);
      await deployment.stakingPool.activateBoost(0, deployment.user1.address, [0]);
      await deployment.stakingPool.activateBoost(1, deployment.user1.address, [0]);
      await deployment.stakingPool.activateBoost(0, deployment.user2.address, [0]);
      await deployment.stakingPool.activateBoost(1, deployment.user2.address, [0]);
      order1 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user1.address, 0);
      order2 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user1.address, 0);
      order3 = await deployment.stakingPool.getUserStakeOrderByIndex(0, deployment.user2.address, 0);
      order4 = await deployment.stakingPool.getUserStakeOrderByIndex(1, deployment.user2.address, 0);
    });

    it("it has the rigth weight after activate boost", async () => {
      expect(order1.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount.add(user2NUSDCDepositAmount), user1NUSDCDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order2.totalDepositedWeight)
        .equal(calcUserWeight(user1NBUSDDepositAmount.add(user2NBUSDDepositAmount), user1NBUSDDepositAmount, totalBoostPoolDeposit, user1BoostPoolDeposit));
      expect(order3.totalDepositedWeight)
        .equal(calcUserWeight(user1NUSDCDepositAmount.add(user2NUSDCDepositAmount), user2NUSDCDepositAmount, totalBoostPoolDeposit, user2BoostPoolDeposit));
      expect(order4.totalDepositedWeight)
        .equal(calcUserWeight(user1NBUSDDepositAmount.add(user2NBUSDDepositAmount), user2NBUSDDepositAmount, totalBoostPoolDeposit, user2BoostPoolDeposit));
    });

    it("it rejects if there is no claimable rewards", async () => {
      await expect(deployment.stakingPool.connect(deployment.user1).claim(0, [0])).to.be.revertedWith("No claimable token");
      await expect(deployment.stakingPool.connect(deployment.user1).claim(1, [0])).to.be.revertedWith("No claimable token");
      await expect(deployment.stakingPool.connect(deployment.user2).claim(0, [0])).to.be.revertedWith("No claimable token");
      await expect(deployment.stakingPool.connect(deployment.user2).claim(1, [0])).to.be.revertedWith("No claimable token");
    })

    describe("set reward rate", () => {
      let rewardRate = utils.parseUnits('1', '18');
      let tolerance = 300;
      let rewardStartTimestamp;
      let user1FirstClaimTimestamp, user2FirstClaimTimestamp;
      let user1SecondClaimTimestamp, user2SecondClaimTimestamp;
      let user1ThirdClaimTimestamp, user2ThirdClaimTimestamp;
      let user1FirstClaimAmount, user2FirstClaimAmount;
      let user1SecondClaimAmount, user2SecondClaimAmount;
      let user1ThirdClaimAmount, user2ThirdClaimAmount;
      let pool0TotalWeight, pool1TotalWeight;
      let pool0RewardRate, pool1RewardRate;

      before(async () => {
        rewardStartTimestamp = await getBlockTimestamp(await deployment.stakingPool.connect(deployment.governance).setRewardRate(rewardRate));
      });

      it("it updates the right pool reward rate", async () => {
        pool0RewardRate = await deployment.stakingPool.getPoolRewardRate(0);
        pool1RewardRate = await deployment.stakingPool.getPoolRewardRate(1);
        expect(pool0RewardRate.toString()).equal(rewardRate.div(4).toString())
        expect(pool1RewardRate.toString()).equal(rewardRate.mul(3).div(4).toString())
      })

      it("it claims the right reward after one week", async () => {
        await timeFly(ONE_WEEK);
        user1FirstClaimTimestamp = await getBlockTimestamp(await deployment.stakingPool.connect(deployment.user1).claim(0, [0]));
        user2FirstClaimTimestamp = await getBlockTimestamp(await deployment.stakingPool.connect(deployment.user2).claim(1, [0]));
        user1FirstClaimAmount = await deployment.NAOS.balanceOf(deployment.user1.address);
        user2FirstClaimAmount = await deployment.NAOS.balanceOf(deployment.user2.address);
        pool0TotalWeight = await deployment.stakingPool.getPoolTotalDepositedWeight(0);
        pool1TotalWeight = await deployment.stakingPool.getPoolTotalDepositedWeight(1);

        expect(user1FirstClaimAmount.sub(calcUserReward(order1.totalDepositedWeight, pool0TotalWeight, pool0RewardRate, order1.depositTime, rewardStartTimestamp, user1FirstClaimTimestamp, ONE_YEAR)).abs()).to.be.at.most(tolerance);
        expect(user2FirstClaimAmount.sub(calcUserReward(order4.totalDepositedWeight, pool1TotalWeight, pool1RewardRate, order4.depositTime, rewardStartTimestamp, user2FirstClaimTimestamp, ONE_YEAR)).abs()).to.be.at.most(tolerance);
      })

      it("it claims the right reward after one year", async () => {
        await timeFly(ONE_YEAR);
        user1SecondClaimTimestamp = await getBlockTimestamp(await deployment.stakingPool.connect(deployment.user1).claim(1, [0]));
        user2SecondClaimTimestamp = await getBlockTimestamp(await deployment.stakingPool.connect(deployment.user2).claim(0, [0]));
        user1SecondClaimAmount = await deployment.NAOS.balanceOf(deployment.user1.address);
        user2SecondClaimAmount = await deployment.NAOS.balanceOf(deployment.user2.address);

        expect(user1SecondClaimAmount.sub(user1FirstClaimAmount).sub(calcUserReward(order2.totalDepositedWeight, pool1TotalWeight, pool1RewardRate, order2.depositTime, rewardStartTimestamp, user1SecondClaimTimestamp, ONE_YEAR)).abs()).to.be.at.most(tolerance);
        expect(user2SecondClaimAmount.sub(user2FirstClaimAmount).sub(calcUserReward(order3.totalDepositedWeight, pool0TotalWeight, pool0RewardRate, order3.depositTime, rewardStartTimestamp, user2SecondClaimTimestamp, ONE_YEAR)).abs()).to.be.at.most(tolerance);

        user1ThirdClaimTimestamp = await getBlockTimestamp(await deployment.stakingPool.connect(deployment.user1).claim(0, [0]));
        user2ThirdClaimTimestamp = await getBlockTimestamp(await deployment.stakingPool.connect(deployment.user2).claim(1, [0]));
        user1ThirdClaimAmount = await deployment.NAOS.balanceOf(deployment.user1.address);
        user2ThirdClaimAmount = await deployment.NAOS.balanceOf(deployment.user2.address);
        expect(user1ThirdClaimAmount.sub(user1SecondClaimAmount).sub(calcUserReward(order1.totalDepositedWeight, pool0TotalWeight, pool0RewardRate, order1.depositTime, user1FirstClaimTimestamp, user1ThirdClaimTimestamp, ONE_YEAR)).abs()).to.be.at.most(tolerance);
        expect(user2ThirdClaimAmount.sub(user2SecondClaimAmount).sub(calcUserReward(order4.totalDepositedWeight, pool1TotalWeight, pool1RewardRate, order4.depositTime, user2FirstClaimTimestamp, user2ThirdClaimTimestamp, ONE_YEAR)).abs()).to.be.at.most(tolerance);
      })
    });
  })
})