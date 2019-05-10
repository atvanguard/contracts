const WithdrawManager = require('./WithdrawManager').WithdrawManager
const utils = require('ethereumjs-util')
const assert = require('assert')
// const getSig = require('./MarketplaceUtils').getSig

// 6c618a0e = utils.keccak256('executeOrder(address,bytes,uint256,address,bytes,uint256,bytes32,uint256,address).slice(0, 4)
console.log(utils.keccak256('executeOrder(address,bytes,uint256,address,bytes,uint256,bytes32,uint256,address').slice(0, 4))
const EXECUTE_ORDER_SIG = Buffer.from('6c618a0e', 'hex')
class MarketplaceFraudProof extends WithdrawManager {
  /**
   * Use the exitor's and counterparty's balance (of the same token) as the input
   * @param {*} input0 Exitor's proof-of-balance for the token being exited from
   * @param {*} logIndex0
   * @param {*} input1 Counterparty's proof-of-balance for the token being exited from
   * @param {*} logIndex1
   * @param {*} counterParty The counterParty whom input1 belongs to
   * @param {*} exit The exit tx
   * @param {*} msgSender
   * @param {*} _counterParty Signer of exit (if not msgSender)
   */
  async startExitWithMarketplaceTx(input0, logIndex0, input1, logIndex1, counterParty, exit, msgSender, _counterParty) {
    // 1 input is for one's own proof-of-balance and the other input is for other party's balance
    const receipt0 = this.processReferenceTx(input0, logIndex0, msgSender)
    // receipt0.childToken is the token that the user wants to exit from
    let exitToken = receipt0.childToken
    const receipt1 = this.processReferenceTx(input1, logIndex1, counterParty)
    // assert self and counterparty's balance for the same token was referenced
    assert.ok(
      exitToken.equals(receipt1.childToken),
      'Input(s) do not correspond to the same child token'
    )
    assert.ok(
      receipt0.rootToken.equals(receipt1.rootToken),
      'Input(s) do not correspond to the same root token'
    )
    // assert child to root token mapping from registry

    let exitAmount = receipt0.inputTxClosingBalance
    const tx = this.processExitTx(exit, exitToken)

    // @todo Handle ERC721
    if (tx.address2.equals(msgSender)) {
      // exitor got token0 and transferred token1,
      // exitor could be trying to exit with either token depending on what they referenced in input0
      if (exitToken.equals(tx.token0)) {
        exitAmount += tx.tokenIdOrAmount0
      } else if (exitToken.equals(tx.token1)) {
        exitAmount -= tx.tokenIdOrAmount1
      }
    } else if (tx.address2.equals(counterParty)) {
      // exitor got token1 and transferred away token0
      if (exitToken.equals(tx.token0)) {
        exitAmount -= tx.tokenIdOrAmount0
      } else if (exitToken.equals(tx.token1)) {
        exitAmount += tx.tokenIdOrAmount1
      }
    }
    const exitId = receipt0.exitId.gt(receipt0.exitId) ? receipt0.exitId : receipt1.exitId
    const exitObject = { rootToken: receipt0.rootToken.toString('hex'), amountOrTokenId: exitAmount, owner: msgSender.toString('hex') }
    this._addExitToQueue(exitObject, exitId)
  }

  processExitTx(exit, exitToken) {
    let exitTx = utils.rlp.decode(exit)
    // exitTx.forEach(e => console.log(e.toString('hex')))
    const marketPlaceContract = exitTx[3] // corresponds to "to" field in tx
    // could optionally assert if a registry of marketPlace contracts is being maintained in the rootChain
    const funcSig = exitTx[5].slice(0, 4)
    assert.ok(
      funcSig.equals(EXECUTE_ORDER_SIG),
      'funcSig doesnt match'
    )
    const token0 = exitTx[5].slice(16, 36)
    const sig0 = exitTx[5].slice(36, 196)
    // verify transferWithSig sig0
    const tokenIdOrAmount0 = exitTx[5].slice(196, 228)
    const token1 = exitTx[5].slice(228, 260)
    const sig1 = exitTx[5].slice(260, 420)
    // verify transferWithSig sig1
    const tokenIdOrAmount1 = exitTx[5].slice(420, 452)
    const orderId = exitTx[5].slice(452, 484)
    const expiration = exitTx[5].slice(484, 516)
    // check expiration
    const address2 = exitTx[5].slice(516)
    // anyone can be the msgSender, so no assertions on that
    return { token0, tokenIdOrAmount0, token1, tokenIdOrAmount1, address2 }
  }
}

module.exports = MarketplaceFraudProof
