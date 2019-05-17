import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import fs from 'fs'

import deployer from './helpers/deployer.js'
import logDecoder from './helpers/log-decoder.js'
import utils from 'ethereumjs-util'
import { getSig } from './mocks/MarketplaceUtils'

const sigUtils = require('eth-sig-util')

const rlp = utils.rlp
const web3Child = new web3.constructor(
  new web3.providers.HttpProvider('http://localhost:8546')
  // new web3.providers.HttpProvider('http://alpha-mainnet-bp.matic.today/ ')
)

chai
  .use(chaiAsPromised)
  .should()

contract('WithdrawManager', async function(accounts) {
  let contracts, childContracts
  const user = accounts[0].toLowerCase()
  const other = accounts[1].toLowerCase()
  const amount = 10 // web3.utils.toBN('10')
  // const amount = web3.utils.toBN('10').pow(web3.utils.toBN('18'))

  beforeEach(async function() {
    contracts = await deployer.freshDeploy()
    childContracts = await deployer.initializeChildChain(accounts[0])
  })

  it('withdrawBurntTokens - deposit', async function() {
    await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, user, amount, 'deposit.js' /* writeToFile */)
    let _withdrawTx = await childContracts.childToken.withdraw(amount)
    await writeToFile('deposit-burn.js', _withdrawTx.receipt)
  })

  it('withdrawBurntTokens - transfer - partialBurn', async function() {
    await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, user, amount)

    let _transferTx = await childContracts.childToken.transfer(other, web3.utils.toBN('3'))
    await writeToFile('transfer.js', _transferTx.receipt)
    // user has 6 tokens

    let _withdrawTx = await childContracts.childToken.withdraw(web3.utils.toBN('4')) // partial burn
    await writeToFile('partialBurn.js', _withdrawTx.receipt)
    // user is left with 3 token
  })

  it('withdrawBurntTokens - incomingTransfer - burn', async function() {
    await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, other, amount)

    let _transferTx = await childContracts.childToken.transfer(user, amount, {from: other})
    await writeToFile('incomingTransfer.js', _transferTx.receipt)
    // user has 6 (3 + 3) tokens

    let _withdrawTx = await childContracts.childToken.withdraw(amount) // full burn
    await writeToFile('burn.js', _withdrawTx.receipt)
  })

  describe('exitInFlight', async function() {
    it('depositTransferInFlight', async function() {
      await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, user, amount, 'exitInFlight/deposit-2.js')
      let _transferTx = await childContracts.childToken.transfer(other, web3.utils.toBN('3'))
      await writeToFile('exitInFlight/transfer-2.js', _transferTx.receipt)
    })

    it('counterPartyDepositAnd Transfer (or burn ) InFlight', async function() {
      await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, other, amount, 'exitInFlight/counterparty-deposit.js')
      let _transferTx = await childContracts.childToken.transfer(user, amount, {from: other})
      await writeToFile('exitInFlight/counterparty-transfer.js', _transferTx.receipt)
      let _withdrawTx = await childContracts.childToken.withdraw(amount) // full burn
      await writeToFile('exitInFlight/burn.js', _withdrawTx.receipt)
    })
  })

  describe('Marketplace', async function() {
    const tokenId = 5 //'0xAED'
    it.only('executeOrder', async function() {
      let depCount = 0
      contracts = await deployer.freshDeploy()
      childContracts = await deployer.initializeChildChain(accounts[0], {})
      const { childErc20: token1 } = await deployer.deployErc20(user)
      const { childErc721: token2 } = await deployer.deployErc721(user)
      await depositTokens(
        childContracts.childChain, '0xc46EB8c1ea86bC8c24f26D9FdF9B76B300FFFE43', user,
        amount, depCount++, 'marketplace/depositErc20.js')
      await depositTokens(
        childContracts.childChain, '0xc46EB8c1ea86bC8c24f26D9FdF9B76B300FFFE43', other,
        tokenId, depCount++, 'marketplace/depositErc20CounterParty.js')
      // for ERC721
      // await depositTokens(
      //   childContracts.childChain, '0xaCF8eCcdcA12a0eB6Ae4Fb1431e26c44E66dECdb', other,
      //   tokenId, depCount++, 'marketplace/depositErc721.js')
      const marketplace = await deployer.deployMarketplace()
      // let token1 = await _contracts.ChildERC20.at('0x35D886684ddEA239416960b648A1B78b2a62C3d7')
      // let token2 = await _contracts.ChildERC721.at('0x3d6F2EAE4A075558B3De4ecbB6FF5dA9B8e5be01')
      // let marketplace = await _contracts.Marketplace.at('0x26D2f2Dcf4Bf39C504812a6468d401a5d577EEB4')
      // console.log(token1.address, token2.address, marketplace.address)
      const privateKey1 = '0x9b28f36fbd67381120752d6172ecdcf10e06ab2d9a1367aac00cdcd6ac7855d3'
      const privateKey2 = '0xc8deb0bea5c41afe8e37b4d1bd84e31adff11b09c8c96ff4b605003cce067cd9'
      const orderId = '0x468fc9c005382579139846222b7b0aebc9182ba073b2455938a86d9753bfb078'
      const expiration = 0
      const payload1 = {
        privateKey: privateKey1,
        spender: marketplace.address,
        orderId: orderId,
        expiration: expiration,

        token1: token1.address,
        amount1: amount,
        token2: token2.address,
        amount2: tokenId
      }
      const obj1 = getSig(payload1)
      console.log(sigUtils.recoverTypedSignature({data: obj1.typedData, sig: obj1.sig}))

      const payload2 = {
        privateKey: privateKey2,
        spender: marketplace.address,
        orderId: orderId,
        expiration: expiration,

        token2: token1.address,
        amount2: amount,
        token1: token2.address,
        amount1: tokenId
      }
      const obj2 = getSig(payload2)
      console.log(sigUtils.recoverTypedSignature({data: obj2.typedData, sig: obj2.sig}))
      console.log(token1.address,
        obj1.sig,
        amount,

        token2.address,
        obj2.sig,
        tokenId,

        orderId,
        expiration,
        other)
      // const { receipt } = await token1.transferWithSig(obj1.sig, amount, utils.keccak256(''), expiration, other)
      // const { receipt } = await token1.yoyo()
      // console.dir(receipt, {depth: null})
      const { receipt: r } = await marketplace.executeOrder(
        token1.address,
        obj1.sig,
        amount,

        token2.address,
        obj2.sig,
        tokenId,

        orderId,
        expiration,
        other
      )
      await writeToFile('marketplace/executeOrder.js', r)
      console.dir(r, {depth: null})
    })
  })
})

async function deposit(depositManager, childChain, rootERC20, user, amount, file) {
  await rootERC20.approve(depositManager.address, amount)
  const result = await depositManager.depositERC20ForUser(rootERC20.address, user, amount)
  const logs = logDecoder.decodeLogs(result.receipt.rawLogs)
  const NewDepositBlockEvent = logs.find(log => log.event === 'NewDepositBlock')
  await depositTokens(childChain, rootERC20.address, user, amount, NewDepositBlockEvent.args.depositBlockId, file)
}

async function depositTokens(childChain, rootErc, user, amountOrTokenId, depositId, file) {
  let { receipt } = await childChain.depositTokens(rootErc, user, amountOrTokenId, depositId)
  if (file) writeToFile(file, receipt)
}

async function writeToFile(file, receipt) {
  const r = {
    tx: await web3Child.eth.getTransaction(receipt.transactionHash),
    receipt: await web3Child.eth.getTransactionReceipt(receipt.transactionHash),
    block: await web3Child.eth.getBlock(receipt.blockHash, true /* returnTransactionObjects */)
  }
  fs.writeFileSync(
    `./test/mocks/mockResponses/${file}`,
    `module.exports = ${JSON.stringify(r, null, 2)}`
  )
}
