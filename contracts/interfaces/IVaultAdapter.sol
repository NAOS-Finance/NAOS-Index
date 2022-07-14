// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "./IERC20withDec.sol";

/// Interface for all Vault Adapter V2 implementations.
interface IVaultAdapter {
    /// @dev Gets the token that the adapter accepts.
    function token() external view returns (IERC20withDec);

    /// @dev The total value of the assets deposited into the vault.
    function totalValue() external view returns (uint256);

    /// @dev Deposits funds into the vault.
    ///
    /// @param _amount  the amount of funds to deposit.
    function deposit(uint256 _amount) external;

    /// @dev Attempts to withdraw funds from the wrapped vault.
    ///
    /// The amount withdrawn to the recipient may be less than the amount requested.
    ///
    /// @param _recipient the recipient of the funds.
    /// @param _amount    the amount of funds to withdraw.
    function withdraw(address _recipient, uint256 _amount) external;

    /// @dev Attempts to withdraw funds from the wrapped vault.
    ///
    /// The amount withdrawn to the recipient may be less than the amount requested.
    ///
    /// @param _recipient the recipient of the funds.
    /// @param _amount    the amount of funds to withdraw.
    function harvest(address _recipient, uint256 _amount) external;
}