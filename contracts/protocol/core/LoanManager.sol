// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC721/IERC721.sol";
import "./BaseUpgradeablePausable.sol";
import "./ConfigHelper.sol";
import "../../interfaces/IERC20withDec.sol";
import "../../interfaces/IIndexPool.sol";
import "../../interfaces/IJuniorPool.sol";

contract LoanManager is BaseUpgradeablePausable {
    NAOSConfig public config;
    using ConfigHelper for NAOSConfig;

    struct TokenInfo {
        bool tokenLocked;
        bool priceIsSet;
        uint256 price;
    }

    struct PoolInfo {
        bool poolExist;
        address juniorPoolAddress;
        IERC721 token;
        uint256[] tokenList;
        mapping(uint256 => TokenInfo) tokenInfo;
    }

    address[] public poolList;
    mapping(address => PoolInfo) public pools;
    mapping(uint256 => address) public operator;
    mapping(uint256 => mapping(address => bool)) public liquidator;

    modifier onlyOperator(uint256 _poolId) {
        require(
            msg.sender == operator[_poolId],
            "Sender is not the operator of the pool"
        );
        _;
    }

    modifier onlyLiquidator(uint256 _poolId) {
        require(
            liquidator[_poolId][msg.sender],
            "Sender is not the liquidator of the pool"
        );
        _;
    }

    event operatorUpdated(uint256 poolId, address indexed operator);
    event poolCreated(address indexed juniorPoolAddress, address indexed token, uint256 poolId);
    event poolLiquidated(uint256 poolId);
    event loanLocked(uint256 poolId, uint256 tokenId);
    event loanUnlocked(uint256 poolId, uint256 tokenId);
    event loanPrcieSet(uint256 poolId, uint256[] tokenId, uint256[] price);
    event loanLiquidated(uint256 poolId, uint256 tokenId);

    function initialize(address owner, NAOSConfig _config) public initializer {
        require(owner != address(0) && address(_config) != address(0), "Owner and config addresses cannot be empty");
        __BaseUpgradeablePausable__init(owner);
        config = _config;
    }

    /**
    * @dev Add new tranche pool into the setting
    * @param _juniorPoolAddress The junior pool address
    * @param _token The collateral NFT address
    */
    function addPool(address _juniorPoolAddress, IERC721 _token)
        external
        onlyAdmin
        returns (uint256 _poolId)
    {
        PoolInfo storage pool = pools[_juniorPoolAddress];
        require(config.getPoolTokens().validPool(_juniorPoolAddress), "invalid pool");
        require(!pool.poolExist, "Pool has been added");
        require(_juniorPoolAddress != address(0), "invalid tranche pool address");
        require(address(_token) != address(0), "invalid token address");

        pool.poolExist = true;
        pool.juniorPoolAddress = _juniorPoolAddress;
        pool.token = _token;
        poolList.push(_juniorPoolAddress);

        emit poolCreated(_juniorPoolAddress, address(_token), poolList.length - 1);

        return poolList.length - 1;
    }

    /**
    * @dev Update pool's operator
    * @param _poolId The junior pool id
    * @param _operator The new operator address
    */
    function updateOperator(uint256 _poolId, address _operator)
        external
        onlyAdmin
    {
        require(_poolId < poolList.length, "poolId out of range");
        require(_operator != address(0), "invalid operator address");

        operator[_poolId] = _operator;

        emit operatorUpdated(_poolId, _operator);
    }

    /**
    * @dev Set the token price for the liquidation
    * @param _poolId The junior pool id
    * @param _tokenId The token id
    * @param _price The price of each token
    */
    function setTokenPrice(uint256 _poolId, uint256[] memory _tokenId, uint256[] memory _price) external onlyAdmin {
        PoolInfo storage pool = pools[poolList[_poolId]];
        require(pool.poolExist, "pool doesn't exist");
        require(_tokenId.length == _price.length, "inconsist input length");

        IJuniorPool juniorPool = IJuniorPool(pool.juniorPoolAddress);
        require(juniorPool.liquidated() == IJuniorPool.LiquidationProcess.Processing, "The pool is not going through the liquidation process");

        for(uint256 index; index < _tokenId.length; index++) {
            require(pool.tokenInfo[_tokenId[index]].tokenLocked, "token should be locked");
            pool.tokenInfo[_tokenId[index]].priceIsSet = true;
            pool.tokenInfo[_tokenId[index]].price = _price[index];
        }

        emit loanPrcieSet(_poolId, _tokenId, _price);
    }

    /**
    * @dev Lock the tokenized loan into the corresponding pool 
    * @param _poolId The junior pool id
    * @param _tokenId The token id
    */
    function lockLoan(uint256 _poolId, uint256 _tokenId) external onlyOperator(_poolId) {
        PoolInfo storage pool = pools[poolList[_poolId]];
        require(pool.poolExist, "pool doesn't exist");
        require(!pool.tokenInfo[_tokenId].tokenLocked, "token has been locked");

        IJuniorPool juniorPool = IJuniorPool(pool.juniorPoolAddress);
        require(juniorPool.liquidated() == IJuniorPool.LiquidationProcess.NotInProcess, "The pool is going through the liquidation process");

        pool.tokenInfo[_tokenId].tokenLocked = true;
        pool.token.transferFrom(msg.sender, address(this), _tokenId);

        emit loanLocked(_poolId, _tokenId);
    }

    /**
    * @dev Unlock the tokenized loan from the corresponding pool if the debt has been paid off
    * @param _poolId The junior pool id
    * @param _tokenId The token id
    */
    function unlockLoan(uint256 _poolId, uint256 _tokenId) external onlyOperator(_poolId) {
        PoolInfo storage pool = pools[poolList[_poolId]];
        require(pool.poolExist, "pool doesn't exist");
        require(pool.tokenInfo[_tokenId].tokenLocked, "token should be locked");
        require(!pool.tokenInfo[_tokenId].priceIsSet, "price is set");
        require(IJuniorPool(pool.juniorPoolAddress).totalDeployed() == 0, "it has outstanding loans");

        pool.tokenInfo[_tokenId].tokenLocked = false;
        pool.token.transferFrom(address(this), msg.sender, _tokenId);

        emit loanUnlocked(_poolId, _tokenId);
    }

    /**
    * @dev Initiate liquidation of the loan
    * @param _poolId The junior pool id
    */
    function liquidate(uint256 _poolId) external onlyAdmin {
        PoolInfo storage pool = pools[poolList[_poolId]];
        require(pool.poolExist, "pool doesn't exist");

        IJuniorPool juniorPool = IJuniorPool(pool.juniorPoolAddress);
        require(juniorPool.liquidated() == IJuniorPool.LiquidationProcess.NotInProcess, "The pool is going through the liquidation process");

        juniorPool.setLiquidated(IJuniorPool.LiquidationProcess.Starting);
        juniorPool.assess();
        config.getIndexPool().writedown(juniorPool);
        juniorPool.setLiquidated(IJuniorPool.LiquidationProcess.Processing);

        emit poolLiquidated(_poolId);
    }

    /**
    * @dev Pay the token and get the tokenized liquidated loan
    * @param _poolId The junior pool id
    * @param _tokenId The token id
    */
    function liquidateLoan(uint256 _poolId, uint256 _tokenId) external onlyLiquidator(_poolId) {
        PoolInfo storage pool = pools[poolList[_poolId]];
        require(pool.poolExist, "pool doesn't exist");
        require(pool.tokenInfo[_tokenId].tokenLocked, "token should be locked");
        require(pool.tokenInfo[_tokenId].priceIsSet, "price is not set");

        uint256 price = pool.tokenInfo[_tokenId].price;
        pool.tokenInfo[_tokenId].tokenLocked = false;
        pool.tokenInfo[_tokenId].priceIsSet = false;
        pool.tokenInfo[_tokenId].price = 0;

        IJuniorPool juniorPool = IJuniorPool(pool.juniorPoolAddress);
        require(juniorPool.liquidated() == IJuniorPool.LiquidationProcess.Processing, "The pool is not going through the liquidation process");

        IERC20withDec currency = config.getUSDC();
        currency.transferFrom(msg.sender, address(juniorPool.creditLine()), price);
        pool.token.transferFrom(address(this), msg.sender, _tokenId);

        // update juniorPool status
        juniorPool.assess();

        // update indexPool status
        IIndexPool indexPool = config.getIndexPool();
        uint256 juniorTokensCount = indexPool.juniorPoolTokensCount(juniorPool);
        for (uint256 i = 0; i < juniorTokensCount; i++) {
            uint256 juniorPoolTokenId = indexPool.juniorPoolTokens(juniorPool, i);
            indexPool.redeem(juniorPoolTokenId);
        }

        emit loanLiquidated(_poolId, _tokenId);
    }
}
