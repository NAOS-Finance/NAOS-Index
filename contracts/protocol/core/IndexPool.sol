// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/drafts/IERC20Permit.sol";

import "../../interfaces/IIndexPool.sol";
import "../../interfaces/IPoolTokens.sol";
import "./Accountant.sol";
import "./BaseUpgradeablePausable.sol";
import "./ConfigHelper.sol";

import {FixedPointMath} from "../../library/FixedPointMath.sol";
import {IVaultAdapter} from "../../interfaces/IVaultAdapter.sol";
import {Vault} from "../../library/Vault.sol";

/**
 * @title Goldfinch's IndexPool contract
 * @notice Main entry point for senior LPs (a.k.a. capital providers)
 *  Automatically invests across borrower pools using an adjustable strategy.
 */
contract IndexPool is BaseUpgradeablePausable, IIndexPool {
  NAOSConfig public config;
  using ConfigHelper for NAOSConfig;
  using SafeMath for uint256;
  using Vault for Vault.Data;
  using Vault for Vault.List;


  uint256 public usdDecimals;
  
  mapping(IJuniorPool => uint256) public writedowns;

  /// @dev A mapping of adapter addresses to keep track of vault adapters that have already been added
  mapping(IVaultAdapter => bool) public adapters;

  /// @dev A list of all of the vaults. The last element of the list is the vault that is currently being used for
  /// deposits and withdraws. Vaults before the last element are considered inactive and are expected to be cleared.
  Vault.List private _vaults;

  /// @dev A flag indicating if the contract has been initialized yet.
  bool public initialized;

  /// @dev Resolution for all fixed point numeric parameters which represent percents. The resolution allows for a
  /// granularity of 0.01% increments.
  uint256 public constant PERCENT_RESOLUTION = 10000;

  uint256 public harvestFee;

  /// @dev Checks that the contract is in an initialized state.
  ///
  /// This is used over a modifier to reduce the size of the contract
  modifier expectInitialized() {
    require(initialized, "Vault not initialized.");
    _;
  }

  event DepositMade(address indexed capitalProvider, uint256 amount, uint256 shares);
  event WithdrawalMade(address indexed capitalProvider, uint256 userAmount);
  event InterestCollected(address indexed payer, uint256 amount);
  event PrincipalCollected(address indexed payer, uint256 amount);
  event ReserveFundsCollected(address indexed user, uint256 amount);

  event PrincipalWrittenDown(address indexed juniorPool, int256 amount);
  event InvestmentMadeInSenior(address indexed juniorPool, uint256 amount);
  event InvestmentMadeInJunior(address indexed juniorPool, uint256 amount);

  event NAOSConfigUpdated(address indexed who, address configAddress);

  event HarvestFeeUpdated(uint256 fee);
  event ActiveVaultUpdated(IVaultAdapter indexed adapter);
  event FundsFlushed(uint256 amount);
  event FundsHarvested(uint256 withdrawnAmount, uint256 decreasedValue);
  event FundsRecalled(uint256 indexed vaultId, uint256 withdrawnAmount, uint256 decreasedValue);

  function initialize(address owner, NAOSConfig _config) public initializer {
    require(owner != address(0) && address(_config) != address(0), "Owner and config addresses cannot be empty");

    __BaseUpgradeablePausable__init(owner);

    config = _config;
    // Initialize sharePrice to be identical to the legacy pool. This is in the initializer
    // because it must only ever happen once.
    // sharePrice = config.getPool().sharePrice();
    sharePrice = 1 ether;
    totalLoansOutstanding = 0;
    totalWritedowns = 0;

    IERC20withDec usdc = config.getUSDC();
    usdDecimals = uint256(usdc.decimals());
    // Sanity check the address
    usdc.totalSupply();

    bool success = usdc.approve(address(this), uint256(-1));
    require(success, "Failed to approve USDC");
  }

  /**
   * @notice Deposits `amount` USDC from msg.sender into the IndexPool, and grants you the
   *  equivalent value of FIDU tokens
   * @param amount The amount of USDC to deposit
   */
  function deposit(uint256 amount) public override whenNotPaused nonReentrant returns (uint256 depositShares) {
    require(config.getVerified().verifyIndexPool(msg.sender), "This address has not been go-listed");
    require(amount > 0, "Must deposit more than zero");
    // Check if the amount of new shares to be added is within limits
    depositShares = getNumShares(amount);
    uint256 potentialNewTotalShares = totalShares().add(depositShares);
    require(sharesWithinLimit(potentialNewTotalShares), "Deposit would put the senior pool over the total limit.");
    emit DepositMade(msg.sender, amount, depositShares);
    bool success = doUSDCTransfer(msg.sender, address(this), amount);
    require(success, "Failed to transfer for deposit");

    config.getRWA().mintTo(msg.sender, depositShares);
    return depositShares;
  }

  /**
   * @notice Identical to deposit, except it allows for a passed up signature to permit
   *  the Senior Pool to move funds on behalf of the user, all within one transaction.
   * @param amount The amount of USDC to deposit
   * @param v secp256k1 signature component
   * @param r secp256k1 signature component
   * @param s secp256k1 signature component
   */
  function depositWithPermit(
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) public override returns (uint256 depositShares) {
    IERC20Permit(config.usdcAddress()).permit(msg.sender, address(this), amount, deadline, v, r, s);
    return deposit(amount);
  }

  /**
   * @notice Withdraws USDC from the IndexPool to msg.sender, and burns the equivalent value of FIDU tokens
   * @param usdcAmount The amount of USDC to withdraw
   */
  function withdraw(uint256 usdcAmount) external override whenNotPaused nonReentrant returns (uint256 amount) {
    require(msg.sender == config.getWithdrawQueue(), "The address is not the withdraw queue");
    require(usdcAmount > 0, "Must withdraw more than zero");
    uint256 withdrawShares = getNumShares(usdcAmount);
    return _withdraw(usdcAmount, withdrawShares);
  }

  /**
   * @notice Withdraws USDC (denominated in FIDU terms) from the IndexPool to msg.sender
   * @param rwaAmount The amount of USDC to withdraw in terms of FIDU shares
   */
  function withdrawInRWA(uint256 rwaAmount) external override whenNotPaused nonReentrant returns (uint256 amount) {
    require(msg.sender == config.getWithdrawQueue(), "The address is not the withdraw queue");
    require(rwaAmount > 0, "Must withdraw more than zero");
    uint256 usdcAmount = getUSDCAmountFromShares(rwaAmount);
    uint256 withdrawShares = rwaAmount;
    return _withdraw(usdcAmount, withdrawShares);
  }

  /**
   * @notice Migrates to a new goldfinch config address
   */
  function updateNAOSConfig() external onlyAdmin {
    config = NAOSConfig(config.configAddress());
    emit NAOSConfigUpdated(msg.sender, address(config));
  }

  /**
   * @notice Invest in an IJuniorPool's senior tranche using the senior pool's strategy
   * @param pool An IJuniorPool whose senior tranche should be considered for investment
   */
  function invest(IJuniorPool pool) public override whenNotPaused nonReentrant {
    require(validPool(pool), "Pool must be valid");

    IIndexPoolStrategy strategy = config.getIndexPoolStrategy();
    uint256 amount = strategy.invest(pool);

    require(amount > 0, "Investment amount must be positive");

    approvePool(pool, amount);
    pool.deposit(uint256(IJuniorPool.Tranches.Senior), amount);

    emit InvestmentMadeInSenior(address(pool), amount);
    totalLoansOutstanding = totalLoansOutstanding.add(amount);
  }

  function estimateInvestment(IJuniorPool pool) public view override returns (uint256) {
    require(validPool(pool), "Pool must be valid");
    IIndexPoolStrategy strategy = config.getIndexPoolStrategy();
    return strategy.estimateInvestment(pool);
  }

  /**
   * @notice Redeem interest and/or principal from an IJuniorPool investment
   * @param tokenId the ID of an IPoolTokens token to be redeemed
   */
  function redeem(uint256 tokenId) public override whenNotPaused nonReentrant {
    IPoolTokens poolTokens = config.getPoolTokens();
    IPoolTokens.TokenInfo memory tokenInfo = poolTokens.getTokenInfo(tokenId);

    IJuniorPool pool = IJuniorPool(tokenInfo.pool);
    (uint256 interestRedeemed, uint256 principalRedeemed) = pool.withdrawMax(tokenId);

    _collectInterestAndPrincipal(address(pool), interestRedeemed, principalRedeemed);
  }

  /**
   * @notice Write down an IJuniorPool investment. This will adjust the senior pool's share price
   *  down if we're considering the investment a loss, or up if the borrower has subsequently
   *  made repayments that restore confidence that the full loan will be repaid.
   * @param tokenId the ID of an IPoolTokens token to be considered for writedown
   */
  function writedown(uint256 tokenId) public override whenNotPaused nonReentrant {
    IPoolTokens poolTokens = config.getPoolTokens();
    require(address(this) == poolTokens.ownerOf(tokenId), "Only tokens owned by the senior pool can be written down");

    IPoolTokens.TokenInfo memory tokenInfo = poolTokens.getTokenInfo(tokenId);
    IJuniorPool pool = IJuniorPool(tokenInfo.pool);
    require(validPool(pool), "Pool must be valid");

    uint256 principalRemaining = tokenInfo.principalAmount.sub(tokenInfo.principalRedeemed);

    (uint256 writedownPercent, uint256 writedownAmount) = _calculateWritedown(pool, principalRemaining);

    uint256 prevWritedownAmount = writedowns[pool];

    if (writedownPercent == 0 && prevWritedownAmount == 0) {
      return;
    }

    int256 writedownDelta = int256(prevWritedownAmount) - int256(writedownAmount);
    writedowns[pool] = writedownAmount;
    distributeLosses(writedownDelta);
    if (writedownDelta > 0) {
      // If writedownDelta is positive, that means we got money back. So subtract from totalWritedowns.
      totalWritedowns = totalWritedowns.sub(uint256(writedownDelta));
    } else {
      totalWritedowns = totalWritedowns.add(uint256(writedownDelta * -1));
    }
    emit PrincipalWrittenDown(address(pool), writedownDelta);
  }

  /**
   * @notice Calculates the writedown amount for a particular pool position
   * @param tokenId The token reprsenting the position
   * @return The amount in dollars the principal should be written down by
   */
  function calculateWritedown(uint256 tokenId) public view override returns (uint256) {
    IPoolTokens.TokenInfo memory tokenInfo = config.getPoolTokens().getTokenInfo(tokenId);
    IJuniorPool pool = IJuniorPool(tokenInfo.pool);

    uint256 principalRemaining = tokenInfo.principalAmount.sub(tokenInfo.principalRedeemed);

    (, uint256 writedownAmount) = _calculateWritedown(pool, principalRemaining);
    return writedownAmount;
  }

  /**
   * @notice Returns the net assests controlled by and owed to the pool
   */
  function assets() public view override returns (uint256) {
    uint256 assetsValue = config.getUSDC().balanceOf(address(this)).add(totalLoansOutstanding).sub(totalWritedowns);
    for (uint256 vaultId = 0; vaultId < _vaults.length(); vaultId++) {
      Vault.Data storage _vault = _vaults.get(vaultId);
      assetsValue = assetsValue.add(_vault.totalDeposited);
    }
    return assetsValue;
  }

  /**
   * @notice Converts and USDC amount to FIDU amount
   * @param amount USDC amount to convert to FIDU
   */
  function getNumShares(uint256 amount) public view override returns (uint256) {
    return usdcToRWA(amount).mul(rwaMantissa()).div(sharePrice);
  }

  /**
   * @dev Update Active Vault.
   * @param _adapter the vault adapter of the active vault.
   */
  function updateActiveVault(IVaultAdapter _adapter) external onlyAdmin {
    require(address(_adapter) != address(0), "Vault adapter cannot be zero address");
    if (vaultCount() == 0) {
      initialized = true;
    }
    _updateActiveVault(_adapter);
  }

  /// @dev Sets the harvest fee.
  ///
  /// This function reverts if the caller is not the current admin.
  ///
  /// @param _harvestFee the new harvest fee.
  function setHarvestFee(uint256 _harvestFee) external onlyAdmin {
    // Check that the harvest fee is within the acceptable range. Setting the harvest fee greater than 100% could
    // potentially break internal logic when calculating the harvest fee.
    require(_harvestFee <= PERCENT_RESOLUTION, "Harvest fee above maximum.");

    harvestFee = _harvestFee;

    emit HarvestFeeUpdated(_harvestFee);
  }

  /// @dev Flushes buffered tokens to the active vault.
  ///
  /// This function reverts if an emergency exit is active. This is in place to prevent the potential loss of
  /// additional funds.
  ///
  /// @return the amount of tokens flushed to the active vault.
  function flush() external expectInitialized returns (uint256) {
    return flushActiveVault();
  }

  /// @dev Internal function to flush buffered tokens to the active vault.
  ///
  /// This function reverts if an emergency exit is active. This is in place to prevent the potential loss of
  /// additional funds.
  ///
  /// @return the amount of tokens flushed to the active vault.
  function flushActiveVault() internal returns (uint256) {
    Vault.Data storage _activeVault = _vaults.last();
    uint256 _depositedAmount = _activeVault.depositAll();

    emit FundsFlushed(_depositedAmount);

    return _depositedAmount;
  }

  /// @dev Harvests yield from a vault.
  ///
  /// @param _vaultId the identifier of the vault to harvest from.
  ///
  /// @return the amount of funds that were harvested from the vault.
  function harvest(uint256 _vaultId) external expectInitialized returns (uint256, uint256) {
    Vault.Data storage _vault = _vaults.get(_vaultId);

    (uint256 _harvestedAmount, uint256 _decreasedValue) = _vault.harvest(address(this));

    if (_harvestedAmount > 0) {
      uint256 _feeAmount = _harvestedAmount.mul(harvestFee).div(PERCENT_RESOLUTION);

      if (_feeAmount > 0) {
        sendToReserve(_feeAmount, address(this));
      }

      uint256 harvestInterest = usdcToSharePrice(_harvestedAmount.sub(_feeAmount));
      sharePrice = sharePrice.add(harvestInterest);
    }

    emit FundsHarvested(_harvestedAmount, _decreasedValue);
    return (_harvestedAmount, _decreasedValue);
  }

  /// @dev Recalls an amount of deposited funds from a vault to this contract.
  ///
  /// @param _vaultId the identifier of the recall funds from.
  /// @param _amount the amount of tokens which will be recalled from the vault 
  ///
  /// @return the amount of funds that were recalled from the vault to this contract and the decreased vault value.
  function recall(uint256 _vaultId, uint256 _amount) external nonReentrant expectInitialized onlyAdmin returns (uint256, uint256) {
    return _recallFunds(_vaultId, _amount);
  }

  /// @dev Gets the number of vaults in the vault list.
  ///
  /// @return the vault count.
  function vaultCount() public view override returns (uint256) {
    return _vaults.length();
  }

  /// @dev Get the adapter of a vault.
  ///
  /// @param _vaultId the identifier of the vault.
  ///
  /// @return the vault adapter.
  function getVaultAdapter(uint256 _vaultId) external view returns (IVaultAdapter) {
    Vault.Data storage _vault = _vaults.get(_vaultId);
    return _vault.adapter;
  }

  /// @dev Get the total amount of the parent asset that has been deposited into a vault.
  ///
  /// @param _vaultId the identifier of the vault.
  ///
  /// @return the total amount of deposited tokens.
  function getVaultTotalDeposited(uint256 _vaultId) external view override returns (uint256) {
    Vault.Data storage _vault = _vaults.get(_vaultId);
    return _vault.totalDeposited;
  }

  /* Internal Functions */

  function _calculateWritedown(IJuniorPool pool, uint256 principal)
    internal
    view
    returns (uint256 writedownPercent, uint256 writedownAmount)
  {
    return
      Accountant.calculateWritedownForPrincipal(
        pool.creditLine(),
        principal,
        currentTime(),
        config.getLatenessGracePeriodInDays(),
        config.getLatenessMaxDays()
      );
  }

  function currentTime() internal view virtual returns (uint256) {
    return block.timestamp;
  }

  function distributeLosses(int256 writedownDelta) internal {
    if (writedownDelta > 0) {
      uint256 delta = usdcToSharePrice(uint256(writedownDelta));
      sharePrice = sharePrice.add(delta);
    } else {
      // If delta is negative, convert to positive uint, and sub from sharePrice
      uint256 delta = usdcToSharePrice(uint256(writedownDelta * -1));
      sharePrice = sharePrice.sub(delta);
    }
  }

  function rwaMantissa() public pure returns (uint256) {
    return uint256(10)**uint256(18);
  }

  function usdcMantissa() public view returns (uint256) {
    return uint256(10)**usdDecimals;
  }

  function usdcToRWA(uint256 amount) public view returns (uint256) {
    return amount.mul(rwaMantissa()).div(usdcMantissa());
  }

  function rwaToUSDC(uint256 amount) public view returns (uint256) {
    return amount.div(rwaMantissa().div(usdcMantissa()));
  }

  function getUSDCAmountFromShares(uint256 rwaAmount) internal view returns (uint256) {
    return rwaToUSDC(rwaAmount.mul(sharePrice).div(rwaMantissa()));
  }

  function sharesWithinLimit(uint256 _totalShares) internal view returns (bool) {
    return
      _totalShares.mul(sharePrice).div(rwaMantissa()) <=
      usdcToRWA(config.getNumber(uint256(ConfigOptions.Numbers.TotalFundsLimit)));
  }

  function doUSDCTransfer(
    address from,
    address to,
    uint256 amount
  ) internal returns (bool) {
    require(to != address(0), "Can't send to zero address");
    IERC20withDec usdc = config.getUSDC();
    return usdc.transferFrom(from, to, amount);
  }

  function _withdraw(uint256 usdcAmount, uint256 withdrawShares) internal returns (uint256 userAmount) {
    IRWA rwa = config.getRWA();
    // Determine current shares the address has and the shares requested to withdraw
    uint256 currentShares = rwa.balanceOf(msg.sender);
    // Ensure the address has enough value in the pool
    require(withdrawShares <= currentShares, "Amount requested is greater than what this address owns");

    emit WithdrawalMade(msg.sender, usdcAmount);

    uint256 currentAmount = config.getUSDC().balanceOf(address(this));
    // Pull the remaining funds from the active vault.
    if (usdcAmount > currentAmount) {
      Vault.Data storage _activeVault = _vaults.last();
      uint256 difference = usdcAmount.sub(currentAmount);
      require(_activeVault.totalDeposited >= difference, "no enough withdrawable tokens");
      _activeVault.withdraw(address(this), difference);
    }

    // Send the amounts
    bool success = doUSDCTransfer(address(this), msg.sender, usdcAmount);
    require(success, "Failed to transfer for withdraw");

    // Burn the shares
    rwa.burnFrom(msg.sender, withdrawShares);
    return userAmount;
  }

  function _collectInterestAndPrincipal(
    address from,
    uint256 interest,
    uint256 principal
  ) internal {
    uint256 increment = usdcToSharePrice(interest);
    sharePrice = sharePrice.add(increment);

    if (interest > 0) {
      emit InterestCollected(from, interest);
    }
    if (principal > 0) {
      emit PrincipalCollected(from, principal);
      totalLoansOutstanding = totalLoansOutstanding.sub(principal);
    }
  }

  /// @dev Updates the active vault.
  ///
  /// This function reverts if the vault adapter is the zero address, if the token that the vault adapter accepts
  /// is not the token that this contract defines as the parent asset, or if the contract has not yet been initialized.
  ///
  /// @param _adapter the adapter for the new active vault.
  function _updateActiveVault(IVaultAdapter _adapter) internal {
    require(_adapter.token() == config.getUSDC(), "Vault token mismatch.");
    require(!adapters[_adapter], "Vault adapter already in use");
    adapters[_adapter] = true;

    _vaults.push(Vault.Data({adapter: _adapter, totalDeposited: 0}));

    emit ActiveVaultUpdated(_adapter);
  }

  /// @dev Recalls an amount of funds from a vault to this contract.
  ///
  /// @param _vaultId the identifier of the recall funds from.
  /// @param _amount  the amount of funds to recall from the vault.
  ///
  /// @return the amount of funds that were recalled from the vault to this contract and the decreased vault value.
  function _recallFunds(uint256 _vaultId, uint256 _amount) internal returns (uint256, uint256) {
    Vault.Data storage _vault = _vaults.get(_vaultId);
    (uint256 _withdrawnAmount, uint256 _decreasedValue) = _vault.withdraw(address(this), _amount);

    emit FundsRecalled(_vaultId, _withdrawnAmount, _decreasedValue);

    return (_withdrawnAmount, _decreasedValue);
  }

  function sendToReserve(uint256 amount, address userForEvent) internal {
    emit ReserveFundsCollected(userForEvent, amount);
    bool success = doUSDCTransfer(address(this), config.reserveAddress(), amount);
    require(success, "Reserve transfer was not successful");
  }

  function usdcToSharePrice(uint256 usdcAmount) internal view returns (uint256) {
    return usdcToRWA(usdcAmount).mul(rwaMantissa()).div(totalShares());
  }

  function totalShares() internal view returns (uint256) {
    return config.getRWA().totalSupply();
  }

  function validPool(IJuniorPool pool) internal view returns (bool) {
    return config.getPoolTokens().validPool(address(pool));
  }

  function approvePool(IJuniorPool pool, uint256 allowance) internal {
    IERC20withDec usdc = config.getUSDC();
    bool success = usdc.approve(address(pool), allowance);
    require(success, "Failed to approve USDC");
  }
}