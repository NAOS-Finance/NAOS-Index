// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../protocol/core/BaseUpgradeablePausable.sol";
import "../protocol/core/CreditLine.sol";

contract TestCreditLine is CreditLine {
    function setJuniorPool(address _juniorPool) public onlyAdmin {
        require(_juniorPool != address(0), "junior pool should not be address 0");
        juniorPool = _juniorPool;
    }
}
