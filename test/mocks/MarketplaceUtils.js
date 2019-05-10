const sigUtils = require('eth-sig-util')
const utils = require('ethereumjs-util')

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

module.exports = { getSig }
