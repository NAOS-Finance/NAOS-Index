#!/bin/bash
echo 'set up testnet'
nohup npx hardhat node --network hardhat & 

echo 'decimal 6 stable coin test'

rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/JuniorPool.test.ts
NODE_ENV=test npx hardhat test test/Accountant.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/CreditLine.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/Deployment.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/DynamicLeverageRatioStrategy.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/FixedLeverageRatioStrategy.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/IndexPool.test.ts
npx hardhat test test/IndexStakingPool.test.ts --network hardhat
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/integration.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/JuniorPool.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/NAOSConfig.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/NAOSFactory.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/PoolTokens.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/RWA.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/UniqueIdentity.test.ts
rm -rf deployments/localhost && NODE_ENV=test npx hardhat run scripts/baseDeploy.ts && NODE_ENV=test npx hardhat test test/Verified.test.ts
rm -rf deployments/localhost && npx hardhat run scripts/baseDeploy.ts && npx hardhat test test/loanManager.test.ts
rm -rf deployments/localhost && npx hardhat run scripts/baseDeploy.ts && npx hardhat test test/WithdrawQueue.test.ts

echo 'decimal 18 stable coin test'
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/JuniorPool.test.ts
NODE_ENV=test npx hardhat test test/Accountant.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/CreditLine.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/Deployment.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/DynamicLeverageRatioStrategy.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/FixedLeverageRatioStrategy.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/IndexPool.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/integration.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/JuniorPool.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/NAOSConfig.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/NAOSFactory.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/PoolTokens.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/RWA.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/UniqueIdentity.test.ts
rm -rf deployments/localhost && USE_DECIMAL=18 NODE_ENV=test npx hardhat run scripts/baseDeploy18.ts && USE_DECIMAL=18 NODE_ENV=test npx hardhat test test/Verified.test.ts


