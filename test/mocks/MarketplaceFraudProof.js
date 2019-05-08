const WithdrawManager = require('./WithdrawManager').WithdrawManager
const utils = require('ethereumjs-util')

const EXECUTE_ORDER_SIG = utils.keccak256('executeOrder(address,...)').slice(0, 4)
class MarketplaceFraudProof extends WithdrawManager {
  async startExitWithMarketplaceTx(input0, logIndex0, input1, logIndex1, exit, msgSender) {
    const receipt0 = this.processReferenceTx(input0, logIndex0, msgSender)
    const receipt1 = this.processReferenceTx(input1, logIndex1, msgSender)
  }

  processExitTx(exit, inputTxClosingBalance, receipt0, receipt1) {
    let exitTx = utils.rlp.decode(exit)
    // exitTx.forEach(e => console.log(e.toString('hex')))
    const token = exitTx[3] // corresponds to "to" field in tx
    const funcSig = exitTx[5].slice(0, 4)
    const amount = parseInt(exitTx[5].slice(-32).toString('hex'), 16)
    inputTxClosingBalance = parseInt(inputTxClosingBalance.toString('hex'), 16)
    assert.ok(
      funcSig.equals(WithdrawManager.EXECUTE_ORDER_SIG),
      'funcSig doesnt match the executeOrder signature'
    )
    // anyone can be the msgSender, so no assertions on that
    // verify sig0
    // verify sig0
  }
}

module.exports = MarketplaceFraudProof
const sigUtils = require('eth-sig-util')
// const obj1 = getSig({
//   privateKey: '0x9b28f36fbd67381120752d6172ecdcf10e06ab2d9a1367aac00cdcd6ac7855d3',
//   spender: '0xDae060f93a02a1dfAa8AbC274E045DE4636A4C00',
//   orderId: '0x468fc9c005382579139846222b7b0aebc9182ba073b2455938a86d9753bfb078',
//   expiration: 0,

//   token1: '0x867A142ed416390dF0C7e1a315DB5f13a30Bd747',
//   amount1: 10,
//   token2: '0xb59896D564CD06bCf06A8A064163D9c8FB0A6823',
//   amount2: 599
// })

const obj1 = getSig({ privateKey:
  '0x9b28f36fbd67381120752d6172ecdcf10e06ab2d9a1367aac00cdcd6ac7855d3',
 spender: '0x7196b50bC0a0fFAf649A5aBE47aaE26AAf580B2e',
 orderId:
  '0x468fc9c005382579139846222b7b0aebc9182ba073b2455938a86d9753bfb078',
 expiration: 356,
 token1: '0xC68069c676D482AF084C1f2B89703cFe08C04670',
 amount1: 10,
 token2: '0x76e8EB7499bf9b306ec290DB4aAe212A6eFE02dE',
 amount2: 1 })
console.log(obj1)
console.log(sigUtils.recoverTypedSignature({data: obj1.typedData, sig: obj1.sig}))
const o = Buffer.from(obj1.sig.slice(2), 'hex')
console.log(o.length)
// console.log(utils.pubToAddress(utils.ecrecover(
//   Buffer.from(obj1.sig.slice(2), 'hex'), parseInt(tx[6].toString('hex'), 16), tx[7], tx[8], 13 // network id
// )))
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
