// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/Math.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@uniswap/lib/contracts/libraries/Babylonian.sol";

import {SafeERC20} from "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/SafeERC20.sol";
import "../protocol/core/ConfigHelper.sol";
import "../protocol/core/BaseUpgradeablePausable.sol";
import "../interfaces/IPoolTokens.sol";
import "../interfaces/IJuniorPool.sol";
import "../interfaces/IJuniorRewards.sol";

// Basically, Every time a interest payment comes back
// we keep a running total of dollars (totalInterestReceived) until it reaches the maxInterestDollarsEligible limit
// Every dollar of interest received from 0->maxInterestDollarsEligible
// has a allocated amount of rewards.

// When a PoolToken is minted, we set the mint price to the pool's current accRewardsPerPrincipalDollar
// Every time a PoolToken withdraws rewards, we determine the allocated rewards,
// increase that PoolToken's rewardsClaimed, and transfer the owner the NAOS

contract JuniorRewards is IJuniorRewards, BaseUpgradeablePausable {
  NAOSConfig public config;
  using ConfigHelper for NAOSConfig;
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  struct JuniorRewardsInfo {
    uint256 accRewardsPerPrincipalDollar; // accumulator naos per interest dollar
  }

  struct JuniorRewardsTokenInfo {
    uint256 rewardsClaimed; // naos claimed
    uint256 accRewardsPerPrincipalDollarAtMint; // Pool's accRewardsPerPrincipalDollar at PoolToken mint()
  }

  uint256 public maxInterestDollarsEligible; // interest $ eligible for naos rewards, times 1e18
  uint256 public totalInterestReceived; // counter of total interest repayments, times 1e6
  uint256 public rewardRate;
  uint256 public usdDecimals;

  mapping(uint256 => JuniorRewardsTokenInfo) public tokens; // poolTokenId -> JuniorRewardsTokenInfo

  mapping(address => JuniorRewardsInfo) public pools; // pool.address -> JuniorRewardsInfo

  // solhint-disable-next-line func-name-mixedcase
  function __initialize__(address owner, NAOSConfig _config) public initializer {
    require(owner != address(0) && address(_config) != address(0), "Owner and config addresses cannot be empty");
    __BaseUpgradeablePausable__init(owner);
    config = _config;

    IERC20withDec usdc = config.getUSDC();
    usdDecimals = uint256(usdc.decimals());
  }

  /**
   * @notice Calculates the accRewardsPerPrincipalDollar for a given pool,
   when a interest payment is received by the protocol
   * @param _interestPaymentAmount The amount of total dollars the interest payment
   */
  function allocateRewards(uint256 _interestPaymentAmount) external override onlyPool {
    // note: do not use a require statment because that will JuniorPool kill execution
    if (_interestPaymentAmount > 0) {
      _allocateRewards(_interestPaymentAmount);
    }
  }

  /**
   * @notice Set the max dollars across the entire protocol that are eligible for NAOS rewards
   * @param _maxInterestDollarsEligible The amount of interest dollars eligible for NAOS rewards, expects 10^18 value
   */
  function setMaxInterestDollarsEligible(uint256 _maxInterestDollarsEligible) public onlyAdmin {
    maxInterestDollarsEligible = _maxInterestDollarsEligible;
    emit JuniorRewardsSetMaxInterestDollarsEligible(_msgSender(), _maxInterestDollarsEligible);
  }

  /**
   * @notice When a pool token is minted for multiple drawdowns,
   set accRewardsPerPrincipalDollarAtMint to the current accRewardsPerPrincipalDollar price
   * @param tokenId Pool token id
   */
  function setPoolTokenAccRewardsPerPrincipalDollarAtMint(address poolAddress, uint256 tokenId) external override {
    require(_msgSender() == config.poolTokensAddress(), "Invalid sender!");
    require(config.getPoolTokens().validPool(poolAddress), "Invalid pool!");
    if (tokens[tokenId].accRewardsPerPrincipalDollarAtMint != 0) {
      return;
    }
    IPoolTokens poolTokens = config.getPoolTokens();
    IPoolTokens.TokenInfo memory tokenInfo = poolTokens.getTokenInfo(tokenId);
    require(poolAddress == tokenInfo.pool, "PoolAddress must equal PoolToken pool address");

    tokens[tokenId].accRewardsPerPrincipalDollarAtMint = pools[tokenInfo.pool].accRewardsPerPrincipalDollar;
  }

  function setRewardRate(uint256 _rewardRate) public onlyAdmin {
    rewardRate = _rewardRate;

    emit RewardRateUpdated(rewardRate);
  }

  /**
   * @notice Calculate the gross available naos rewards for a PoolToken
   * @param tokenId Pool token id
   * @return The amount of NAOS claimable
   */
  function poolTokenClaimableRewards(uint256 tokenId) public view returns (uint256) {
    IPoolTokens poolTokens = config.getPoolTokens();
    IPoolTokens.TokenInfo memory tokenInfo = poolTokens.getTokenInfo(tokenId);

    // Note: If a JuniorPool is oversubscribed, reward allocation's scale down proportionately.

    uint256 diffOfAccRewardsPerPrincipalDollar = pools[tokenInfo.pool].accRewardsPerPrincipalDollar.sub(
      tokens[tokenId].accRewardsPerPrincipalDollarAtMint
    );
    uint256 rewardsClaimed = tokens[tokenId].rewardsClaimed.mul(mantissa());

    /*
      equation for token claimable rewards:
        token.principalAmount
        * (pool.accRewardsPerPrincipalDollar - token.accRewardsPerPrincipalDollarAtMint)
        - token.rewardsClaimed
    */

    return
      usdcToAtomic(tokenInfo.principalAmount).mul(diffOfAccRewardsPerPrincipalDollar).sub(rewardsClaimed).div(
        mantissa()
      );
  }

  /**
   * @notice PoolToken request to withdraw multiple PoolTokens allocated rewards
   * @param tokenIds Array of pool token id
   */
  function withdrawMultiple(uint256[] calldata tokenIds) public {
    require(tokenIds.length > 0, "TokensIds length must not be 0");

    for (uint256 i = 0; i < tokenIds.length; i++) {
      withdraw(tokenIds[i]);
    }
  }

  /**
   * @notice PoolToken request to withdraw all allocated rewards
   * @param tokenId Pool token id
   */
  function withdraw(uint256 tokenId) public {
    uint256 totalClaimableRewards = poolTokenClaimableRewards(tokenId);
    uint256 poolTokenRewardsClaimed = tokens[tokenId].rewardsClaimed;
    IPoolTokens poolTokens = config.getPoolTokens();
    IPoolTokens.TokenInfo memory tokenInfo = poolTokens.getTokenInfo(tokenId);

    address poolAddr = tokenInfo.pool;
    require(config.getPoolTokens().validPool(poolAddr), "Invalid pool!");
    require(msg.sender == poolTokens.ownerOf(tokenId), "Must be owner of PoolToken");

    BaseUpgradeablePausable pool = BaseUpgradeablePausable(poolAddr);
    require(!pool.paused(), "Pool withdraw paused");

    tokens[tokenId].rewardsClaimed = poolTokenRewardsClaimed.add(totalClaimableRewards);
    config.getNAOS().safeTransfer(poolTokens.ownerOf(tokenId), totalClaimableRewards);
    emit JuniorRewardsClaimed(_msgSender(), tokenId, totalClaimableRewards);
  }

  /* Internal functions  */
  function _allocateRewards(uint256 _interestPaymentAmount) internal {
    uint256 _totalInterestReceived = totalInterestReceived;
    if (usdcToAtomic(_totalInterestReceived) >= maxInterestDollarsEligible) {
      return;
    }

    address _poolAddress = _msgSender();

    // Gross NAOS Rewards earned for incoming interest dollars
    uint256 newGrossRewards = _calculateNewGrossRewardsForInterestAmount(_interestPaymentAmount);

    IJuniorPool pool = IJuniorPool(_poolAddress);
    JuniorRewardsInfo storage _poolInfo = pools[_poolAddress];

    uint256 totalJuniorDeposits = pool.totalJuniorDeposits();
    if (totalJuniorDeposits == 0) {
      return;
    }

    _poolInfo.accRewardsPerPrincipalDollar = _poolInfo.accRewardsPerPrincipalDollar.add(
      newGrossRewards.mul(mantissa()).div(usdcToAtomic(totalJuniorDeposits))
    );

    totalInterestReceived = _totalInterestReceived.add(_interestPaymentAmount);
  }

  /**
   * @notice Calculate the rewards earned for a given interest payment
   * @param _interestPaymentAmount interest payment amount
   */
  function _calculateNewGrossRewardsForInterestAmount(uint256 _interestPaymentAmount)
    internal
    view
    returns (uint256)
  {
    // incoming interest payment
    uint256 interestPaymentAmount = usdcToAtomic(_interestPaymentAmount);

    // all-time interest payments prior to the incoming amount
    uint256 _previousTotalInterestReceived = usdcToAtomic(totalInterestReceived);

    // sum of new interest payment + previous total interest payments
    uint256 newTotalInterest = usdcToAtomic(
      atomicToUSDC(_previousTotalInterestReceived).add(atomicToUSDC(interestPaymentAmount))
    );

    // interest payment passed the maxInterestDollarsEligible cap, should only partially be rewarded
    if (newTotalInterest > maxInterestDollarsEligible) {
      interestPaymentAmount = interestPaymentAmount.sub(newTotalInterest.sub(maxInterestDollarsEligible));
      newTotalInterest = maxInterestDollarsEligible;
    }

    uint256 newGrossRewards = interestPaymentAmount.mul(rewardRate).div(mantissa());

    return newGrossRewards;
  }

  function mantissa() internal pure returns (uint256) {
    return uint256(10)**uint256(18);
  }

  function usdcMantissa() internal view returns (uint256) {
    return uint256(10)**usdDecimals;
  }

  function usdcToAtomic(uint256 amount) internal view returns (uint256) {
    return amount.mul(mantissa()).div(usdcMantissa());
  }

  function atomicToUSDC(uint256 amount) internal view returns (uint256) {
    return amount.div(mantissa().div(usdcMantissa()));
  }

  function updateNAOSConfig() external onlyAdmin {
    config = NAOSConfig(config.configAddress());
    emit NAOSConfigUpdated(_msgSender(), address(config));
  }

  /* ======== MODIFIERS  ======== */

  modifier onlyPool() {
    require(config.getPoolTokens().validPool(_msgSender()), "Invalid pool!");
    _;
  }

  /* ======== EVENTS ======== */
  event NAOSConfigUpdated(address indexed who, address configAddress);
  event JuniorRewardsClaimed(address indexed owner, uint256 indexed tokenId, uint256 amount);
  event JuniorRewardsSetMaxInterestDollarsEligible(address indexed owner, uint256 maxInterestDollarsEligible);
  event RewardRateUpdated(uint256 indexed rate);
}
