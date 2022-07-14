// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import {Math} from "@openzeppelin/contracts/math/Math.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20withDec} from "../interfaces/IERC20withDec.sol";
import {IVaultAdapter} from "../interfaces/IVaultAdapter.sol";

/// @title Pool
///
/// @dev A library which provides the Vault data struct and associated functions.
library Vault {
    using Vault for Data;
    using Vault for List;
    using SafeMath for uint256;

    struct Data {
        IVaultAdapter adapter;
        uint256 totalDeposited;
    }

    struct List {
        Data[] elements;
    }

    /// @dev Gets the total amount of assets deposited in the vault.
    ///
    /// @return the total assets.
    function totalValue(Data storage _self) internal view returns (uint256) {
        return _self.adapter.totalValue();
    }

    /// @dev Gets the token that the vault accepts.
    ///
    /// @return the accepted token.
    function token(Data storage _self) internal view returns (IERC20withDec) {
        return IERC20withDec(_self.adapter.token());
    }

    /// @dev Deposits funds from the caller into the vault.
    ///
    /// @param _amount the amount of funds to deposit.
    function deposit(Data storage _self, uint256 _amount) internal returns (uint256) {
        // Push the token that the vault accepts onto the stack to save gas.
        IERC20withDec _token = _self.token();

        _token.transfer(address(_self.adapter), _amount);
        _self.adapter.deposit(_amount);
        _self.totalDeposited = _self.totalDeposited.add(_amount);

        return _amount;
    }

    /// @dev Deposits the entire token balance of the caller into the vault.
    function depositAll(Data storage _self) internal returns (uint256) {
        IERC20withDec _token = _self.token();
        return _self.deposit(_token.balanceOf(address(this)));
    }

    /// @dev Withdraw deposited funds from the vault.
    ///
    /// @param _recipient the account to withdraw the tokens to.
    /// @param _amount    the amount of tokens to withdraw.
    function withdraw(
        Data storage _self,
        address _recipient,
        uint256 _amount
    ) internal returns (uint256, uint256) {
        (uint256 _withdrawnAmount, uint256 _decreasedValue) = _self.directWithdraw(_recipient, _amount);
        _self.totalDeposited = _self.totalDeposited.sub(_decreasedValue);
        return (_withdrawnAmount, _decreasedValue);
    }

    /// @dev Directly withdraw deposited funds from the vault.
    ///
    /// @param _recipient the account to withdraw the tokens to.
    /// @param _amount    the amount of tokens to withdraw.
    function directWithdraw(
        Data storage _self,
        address _recipient,
        uint256 _amount
    ) internal returns (uint256, uint256) {
        IERC20withDec _token = _self.token();

        uint256 _startingBalance = _token.balanceOf(_recipient);
        uint256 _startingTotalValue = _self.totalValue();

        _self.adapter.withdraw(_recipient, _amount);

        uint256 _endingBalance = _token.balanceOf(_recipient);
        uint256 _withdrawnAmount = _endingBalance.sub(_startingBalance);

        uint256 _endingTotalValue = _self.totalValue();
        uint256 _decreasedValue = _startingTotalValue.sub(_endingTotalValue);

        return (_withdrawnAmount, _decreasedValue);
    }

    /// @dev This function is used for harvest function to get the yield
    ///
    /// @param _recipient the account to withdraw the tokens to.
    /// @param _amount    the amount of tokens to withdraw.
    function indirectWithdraw(
        Data storage _self,
        address _recipient,
        uint256 _amount
    ) internal returns (uint256, uint256) {
        IERC20withDec _token = _self.token();

        uint256 _startingBalance = _token.balanceOf(_recipient);
        uint256 _startingTotalValue = _self.totalValue();

        _self.adapter.withdraw(_recipient, _amount);

        uint256 _endingBalance = _token.balanceOf(_recipient);
        uint256 _withdrawnAmount = _endingBalance.sub(_startingBalance);

        uint256 _endingTotalValue = _self.totalValue();
        uint256 _decreasedValue = _startingTotalValue.sub(_endingTotalValue);

        return (_withdrawnAmount, _decreasedValue);
    }

    /// @dev Withdraw all the deposited funds from the vault.
    ///
    /// @param _recipient the account to withdraw the tokens to.
    function withdrawAll(Data storage _self, address _recipient) internal returns (uint256, uint256) {
        return _self.withdraw(_recipient, _self.totalDeposited);
    }

    /// @dev Harvests yield from the vault.
    ///
    /// @param _recipient the account to withdraw the harvested yield to.
    function harvest(Data storage _self, address _recipient) internal returns (uint256, uint256) {
        if (_self.totalValue() <= _self.totalDeposited) {
            return (0, 0);
        }
        uint256 _withdrawAmount = _self.totalValue().sub(_self.totalDeposited);
        return _self.indirectWithdraw(_recipient, _withdrawAmount);
    }

    /// @dev Adds a element to the list.
    ///
    /// @param _element the element to add.
    function push(List storage _self, Data memory _element) internal {
        _self.elements.push(_element);
    }

    /// @dev Gets a element from the list.
    ///
    /// @param _index the index in the list.
    ///
    /// @return the element at the specified index.
    function get(List storage _self, uint256 _index) internal view returns (Data storage) {
        return _self.elements[_index];
    }

    /// @dev Gets the last element in the list.
    ///
    /// This function will revert if there are no elements in the list.
    ///
    /// @return the last element in the list.
    function last(List storage _self) internal view returns (Data storage) {
        return _self.elements[_self.lastIndex()];
    }

    /// @dev Gets the index of the last element in the list.
    ///
    /// This function will revert if there are no elements in the list.
    ///
    /// @return the index of the last element.
    function lastIndex(List storage _self) internal view returns (uint256) {
        uint256 _length = _self.length();
        return _length.sub(1, "Vault.List: empty");
    }

    /// @dev Gets the number of elements in the list.
    ///
    /// @return the number of elements.
    function length(List storage _self) internal view returns (uint256) {
        return _self.elements.length;
    }
}