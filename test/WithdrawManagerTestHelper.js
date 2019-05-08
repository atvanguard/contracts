import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import fs from 'fs'

import deployer from './helpers/deployer.js'
import logDecoder from './helpers/log-decoder.js'
import utils from 'ethereumjs-util'
const sigUtils = require('eth-sig-util')

import * as _contracts from './helpers/contracts.js'

const rlp = utils.rlp
const web3Child = new web3.constructor(
  new web3.providers.HttpProvider('http://localhost:8546')
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

  // beforeEach(async function() {
  //   contracts = await deployer.freshDeploy()
  //   childContracts = await deployer.initializeChildChain(accounts[0])
  // })

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
      await deposit(contracts.depositManager, childContracts.childChain, childContracts.rootERC20, user, amount, 'exitInFlight-deposit.js')
      let _transferTx = await childContracts.childToken.transfer(other, web3.utils.toBN('3'))
      await writeToFile('exitInFlight/transfer.js', _transferTx.receipt)
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
    it.only('executeOrder', async function() {
      let depCount = 0
      contracts = await deployer.freshDeploy()
      childContracts = await deployer.initializeChildChain(accounts[0], {})
      const { childErc20: token1 } = await deployer.deployErc20(user)
      let r = await childContracts.childChain.depositTokens(
        '0xc46EB8c1ea86bC8c24f26D9FdF9B76B300FFFE43', user, amount, depCount++)
      // await token1.deposit(user, amount)
      const { childErc721: token2 } = await deployer.deployErc721(user)
      const tokenId = 599
      r = await childContracts.childChain.depositTokens(
        '0xaCF8eCcdcA12a0eB6Ae4Fb1431e26c44E66dECdb', other, tokenId, depCount++)
      const marketplace = await deployer.deployMarketplace()
      // let token1 = await _contracts.ChildERC20.at('0x35D886684ddEA239416960b648A1B78b2a62C3d7')
      // let token2 = await _contracts.ChildERC721.at('0x3d6F2EAE4A075558B3De4ecbB6FF5dA9B8e5be01')
      // let marketplace = await _contracts.Marketplace.at('0x26D2f2Dcf4Bf39C504812a6468d401a5d577EEB4')
      console.log(token1.address, token2.address, marketplace.address)
      const privateKey1 = '0x9b28f36fbd67381120752d6172ecdcf10e06ab2d9a1367aac00cdcd6ac7855d3'
      const privateKey2 = '0xc8deb0bea5c41afe8e37b4d1bd84e31adff11b09c8c96ff4b605003cce067cd9'
      const orderId = '0x468fc9c005382579139846222b7b0aebc9182ba073b2455938a86d9753bfb078'
      const expiration = 10000
      const obj1 = getSig({
        privateKey: privateKey1,
        spender: marketplace.address,
        orderId: orderId,
        expiration: expiration,

        token1: token1.address,
        amount1: amount,
        token2: token2.address,
        amount2: tokenId
      })
      console.log({
        privateKey: privateKey1,
        spender: marketplace.address,
        orderId: orderId,
        expiration: expiration,

        token1: token1.address,
        amount1: amount,
        token2: token2.address,
        amount2: tokenId
      })
      console.log(obj1)
      // console.log('obj1.data', obj1.data.toString('hex'))
      console.log(sigUtils.recoverTypedSignature({data: obj1.typedData, sig: obj1.sig}))

      const obj2 = getSig({
        privateKey: privateKey2,
        spender: marketplace.address,
        orderId: orderId,
        expiration: expiration,

        token2: token1.address,
        amount2: amount,
        token1: token2.address,
        amount1: tokenId
      })
      console.log({
        privateKey: privateKey2,
        spender: marketplace.address,
        orderId: orderId,
        expiration: expiration,

        token2: token1.address,
        amount2: amount,
        token1: token2.address,
        amount1: tokenId
      })
      console.log(obj2)
      // console.log('obj1.data', obj1.data.toString('hex'))
      console.log(sigUtils.recoverTypedSignature({data: obj2.typedData, sig: obj2.sig}))
      const { receipt } = await marketplace.executeOrder(
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
      console.dir(receipt, {depth: null})
    })
  })
})

async function deposit(depositManager, childChain, rootERC20, user, amount, file) {
  await rootERC20.approve(depositManager.address, amount)
  const result = await depositManager.depositERC20ForUser(rootERC20.address, user, amount)
  const logs = logDecoder.decodeLogs(result.receipt.rawLogs)
  const NewDepositBlockEvent = logs.find(log => log.event === 'NewDepositBlock')
  let { receipt } = await childChain.depositTokens(
    rootERC20.address, user, amount, NewDepositBlockEvent.args.depositBlockId)
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

function getSig({
  privateKey,
  spender,
  orderId,
  expiration,

  token1,
  amount1,
  token2,
  amount2
}) {
  const orderData = Buffer.concat([
    utils.toBuffer(orderId),
    utils.toBuffer(token2),
    utils.setLengthLeft(amount2, 32)
  ])
  const orderDataHash = utils.keccak256(orderData)

  const obj = getTransferSig({
    privateKey: privateKey,
    spender: spender,
    data: orderDataHash,
    tokenIdOrAmount: amount1,
    tokenAddress: token1,
    expiration: expiration
  })

  return obj
}

function getTransferSig({
  privateKey,
  spender,
  data,
  tokenAddress,
  tokenIdOrAmount,
  expiration
}) {
  const typedData = getTransferTypedData({
    tokenAddress,
    tokenIdOrAmount,
    spender,
    data,
    expiration
  })

  // console.log("transferWithSig datahash", sigUtils.typedSignatureHash(typedData))
  const sig = sigUtils.signTypedData(utils.toBuffer(privateKey), {
    data: typedData
  })

  const obj = {
    sig,
    tokenAddress,
    tokenIdOrAmount,
    spender,
    expiration,
    data: utils.toBuffer(data),
    typedData
  }

  return obj
}

function getTransferTypedData({
  tokenAddress,
  spender,
  tokenIdOrAmount,
  data,
  expiration
}) {
  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "contract", type: "address" }
      ],
      TokenTransferOrder: [
        { name: "spender", type: "address" },
        { name: "tokenIdOrAmount", type: "uint256" },
        { name: "data", type: "bytes32" },
        { name: "expiration", type: "uint256" }
      ]
    },
    domain: {
      name: "Matic Network",
      version: "1",
      chainId: 13,
      contract: tokenAddress
    },
    primaryType: "TokenTransferOrder",
    message: {
      spender,
      tokenIdOrAmount,
      data,
      expiration
    }
  }
}
