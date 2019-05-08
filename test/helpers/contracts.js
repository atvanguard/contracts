export const RootChain = artifacts.require('RootChain')
export const Registry = artifacts.require('Registry')
export const StakeManager = artifacts.require('StakeManager')
export const DepositManager = artifacts.require('DepositManager')
export const DepositManagerProxy = artifacts.require('DepositManagerProxy')
export const WithdrawManager = artifacts.require('WithdrawManager')
export const WithdrawManagerProxy = artifacts.require('WithdrawManagerProxy')

// tokens
export const MaticWETH = artifacts.require('MaticWETH')
export const TestToken = artifacts.require('TestToken')
export const RootERC721 = artifacts.require('RootERC721')
export const ExitNFT = artifacts.require('ExitNFT.sol')

// child chain
export const ChildChain = artifacts.require('ChildChain')
export const ChildERC20 = artifacts.require('ChildERC20')
export const ChildERC721 = artifacts.require('ChildERC721')
export const Marketplace = artifacts.require('Marketplace')
// if you add a contract, change line 43 in log-decoder.js
