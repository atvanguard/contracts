const Buffer = require('safe-buffer').Buffer
const BN = require('bn.js')
const moment = require('moment')
const utils = require('ethereumjs-util')
const PriorityQueue = require('js-priority-queue')
const assert = require('assert')

const MerkleTree = require('../helpers/merkle-tree')
const Proofs = require('../helpers/proofs')
const getBlockHeader = require('../helpers/blocks').getBlockHeader

// const TxType = {
//   DEPOSIT: 0,
//   COUNTERPARTY_DEPOSIT: 1,
//   TRANSFER: 2,
//   COUNTERPARTY_TRANSFER: 3,
//   BURN: 4,
//   MARKETPLACE_INCOMING: 5,
//   MARKETPLACE_OUTGOING: 6,
// }

// const HEADER_BLOCK_NUMBER_WEIGHT = new BN('10').pow(new BN('30'))
// const WITHDRAW_BLOCK_NUMBER_WEIGHT = new BN('10').pow(new BN('12'))
// const TX_INDEX_WEIGHT = new BN('10').pow(new BN('5'))

const HEADER_BLOCK_NUMBER_WEIGHT = new BN('10').pow(new BN('3'))
const WITHDRAW_BLOCK_NUMBER_WEIGHT = new BN('10').pow(new BN('2'))
const TX_INDEX_WEIGHT = new BN('10').pow(new BN('1'))

class WithdrawManager {
  constructor(rootChain, registry, options) {
    this.rootChain = rootChain
    this.registry = registry
    this.ownerExits = {}
    this.exits = {}
    this.exitsQueues = {}
    this.options = options
  }

  async startExit(input, logIndex, exit, msgSender) {
    const { childToken, rootToken, inputTxClosingBalance, counterParty, exitId } = this.processReferenceTx(input, logIndex, msgSender)
    console.log(msgSender)
    const { _counterParty, exitAmount, burnt, token } = this.processExitTx(exit, inputTxClosingBalance, msgSender)
    // Referencing counterParty deposit and then incoming transfer from that deposit
    if (counterParty && _counterParty) {
      assert.ok(
        counterParty.equals(_counterParty),
        'CounterParty txs do not match'
      )
    }
    // note that childToken comes from the log referenced; verifying here that the exit tx corresponds to the same token
    assert.ok(
      childToken.equals(token),
      'Input and exit tx do not correspond to the same token'
    )
    // assert rootToken to childToken mapping

    const exitObject = { rootToken: rootToken.toString('hex'), amountOrTokenId: exitAmount, owner: msgSender.toString('hex'), burnt }
    this._addExitToQueue(exitObject, exitId)
  }

  processReferenceTx(input, logIndex, exitor) {
    let inputItems = this.verifyReceiptAndTx(input)
    inputItems = inputItems[3][logIndex] // 1st log (0-based) - LogTransfer
    const childToken = inputItems[0] // "address" (contract address that emitted the log) field in the receipt
    const inputData = inputItems[2] // "data" field in the receipt
    // inputItems[i] refers to i-th (0-based) topic in the topics array
    inputItems = inputItems[1]
    const rootToken = inputItems[1].slice(12)

    let counterParty, inputTxClosingBalance

    if (inputItems[0].toString('hex') === '4e2ca0515ed1aef1395f66b5303bb5d6f1bf9d61a353fa53f73f8ac9973fa9f6') {
      // event Deposit(address indexed token, address indexed from, uint256 amountOrTokenId, uint256 input1, uint256 output1);
      if (!exitor.equals(inputItems[2].slice(12))) {
        // referencing counterparty deposit
        counterParty = inputItems[2].slice(12)
      }
      inputTxClosingBalance = inputData.slice(64) // output1
    } else if (inputItems[0].toString('hex') === 'e6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4') {
      // event LogTransfer(
      //   address indexed token, address indexed from, address indexed to,
      //   uint256 amountOrTokenId, uint256 input1, uint256 input2, uint256 output1, uint256 output2);
      if (exitor.equals(inputItems[2].slice(12))) { // from
        // If from and to are same, that tx will also get picked here
        inputTxClosingBalance = inputData.slice(96, 128) // output1
      } else if (exitor.equals(inputItems[3].slice(12))) { // to
        inputTxClosingBalance = inputData.slice(-32) // output2
      } else {
        assert.ok(false, 'Transfer tx doesnt concern the exitor')
      }
    } else if (inputItems[0].toString('hex') === 'ebff2602b3f468259e1e99f613fed6691f3a6526effe6ef3e768ba7ae7a36c4f') {
      // event Withdraw(address indexed token, address indexed from, uint256 amountOrTokenId, uint256 input1, uint256 output1
      assert.ok(exitor.equals(inputItems[2]), 'Burn tx doesnt concern the exitor')
      inputTxClosingBalance = inputData.slice(-32) // output1
    } else {
      assert.ok(false, 'Exit type not supported')
    }
    const exitId = this.getExitId(input.header.number, input.number, input.path, 0)
    // if (exitor) exitor = exitor.slice(12)
    return { childToken, rootToken, inputTxClosingBalance, counterParty, exitId }
  }

  processExitTx(exit, inputTxClosingBalance, msgSender) {
    let exitTx = utils.rlp.decode(exit)
    // exitTx.forEach(e => console.log(e.toString('hex')))
    const token = exitTx[3] // corresponds to "to" field in tx
    const funcSig = exitTx[5].slice(0, 4)
    const amount = parseInt(exitTx[5].slice(-32).toString('hex'), 16)
    inputTxClosingBalance = parseInt(inputTxClosingBalance.toString('hex'), 16)

    const txSender = this.getAddressFromTx(exitTx)
    // const exitor = this.getAddressFromTx(exitTx)
    let exitAmount, burnt, _counterParty
    if (funcSig.equals(utils.keccak256('transfer(address,uint256)').slice(0, 4))) {
      // can be either incoming or outgoing transfer
      if (txSender.equals(msgSender)) {
        // outgoing transfer
        exitAmount = inputTxClosingBalance - amount
      } else if (exitTx[5].slice(16, 36).equals(msgSender) /* 1st parameter in transfer function call */) {
        // incoming transfer
        exitAmount = inputTxClosingBalance + amount
        _counterParty = txSender
      } else {
        assert.ok(false, 'The exit tx doesnt concern the exitor (msg.sender)')
      }
    } else if (funcSig.equals(utils.keccak256('withdraw(uint256)').slice(0, 4))) {
      assert.ok(
        txSender.equals(msgSender),
        'Transfer tx is not signed by the exitor (msg.sender)'
      )
      exitAmount = amount // exit with the amount burnt
      burnt = true
    } else {
      assert.ok(false, 'Exit tx type not supported')
    }
    return { _counterParty, exitAmount, burnt, token }
  }

  getAddressFromTx(tx) { // rlp decoded
    const rawTx = tx.slice()
    rawTx[6] = Buffer.from('0d', 'hex')
    rawTx[7] = Buffer.from('', 'hex')
    rawTx[8] = Buffer.from('', 'hex')

    return utils.pubToAddress(utils.ecrecover(
      utils.rlphash(rawTx), parseInt(tx[6].toString('hex'), 16), tx[7], tx[8], 13 // network id
    ))
  }

  verifyReceiptAndTx(input) {
    let { header, receipt, path, receiptParentNodes, number, timestamp, transactionsRoot, receiptsRoot, proof, tx, txParentNodes } = input
    const decodedReceipt = utils.rlp.decode(receipt)
    const decodedTx = utils.rlp.decode(tx)
    assert.ok(
      MerklePatriciaProof.verify(decodedReceipt, path, receiptParentNodes, receiptsRoot),
      'receiptProof failed'
    )
    assert.ok(
      MerklePatriciaProof.verify(decodedTx, path, txParentNodes, transactionsRoot),
      'txProof failed'
    )
    const blockHeader = getBlockHeader({ number, timestamp, transactionsRoot, receiptsRoot })
    assert.ok(
      new MerkleTree([blockHeader]).verify(
        blockHeader,
        parseInt(number, 10) - parseInt(header.start, 10),
        utils.toBuffer(header.root), // remove toBuffer
        proof
      ),
      'WITHDRAW_BLOCK_NOT_A_PART_OF_SUBMITTED_HEADER'
    )
    return decodedReceipt
  }

  _addExitToQueue(_exitObject, _exitId) {
    console.log(_exitObject, _exitId)
    let key = utils.keccak256(_exitObject.token, _exitObject.owner)
    // if (this.registry.isERC721[_exitObject.token]) {
    //   key = utils.keccak256(_exitObject.token, _exitObject.owner, _exitObject.receiptAmountOrNFTId)
    // } else {
    //   // validate amount
    //   // this.require(_exitObject.receiptAmountOrNFTId > 0, "CANNOT_EXIT_ZERO_AMOUNTS")
    //   key = utils.keccak256(_exitObject.token, _exitObject.owner)
    // }
    // validate token exit
    assert.ok(this.ownerExits[key] == null, 'EXIT_ALREADY_IN_PROGRESS')

    // Calculate priority.
    const token = _exitObject.rootToken
    console.log('in _addExitToQueue', token)
    const exitableAt = moment().add(7, 'days').valueOf()
    if (!this.exitsQueues[token]) this.createExitQueue(token)
    this.exitsQueues[token].queue({ exitableAt, exitId: _exitId })
    this.exits[_exitId] = _exitObject
    this.ownerExits[key] = _exitId

    // console.log(this.exitsQueues[token].dequeue())
    // // create NFT for exit UTXO
    // // ExitNFT(exitNFTContract).mint(_exitObject.owner, _exitId);
  }

  createExitQueue(token) {
    this.exitsQueues[token] = new PriorityQueue({ comparator: (a, b) => a.exitableAt - b.exitableAt })
  }

  getExitId(headerNumber, withdrawBlockNumber, txIndex, oIndex) {
    // console.log(headerNumber, withdrawBlockNumber, txIndex, oIndex)
    return new BN(headerNumber).mul(HEADER_BLOCK_NUMBER_WEIGHT)
      .add(new BN(withdrawBlockNumber).mul(WITHDRAW_BLOCK_NUMBER_WEIGHT))
      .add(new BN(txIndex).mul(TX_INDEX_WEIGHT))
      .add(new BN(oIndex))
  }
}

class MerklePatriciaProof {
  static verify(value, path, parentNodes, root) {
    return Proofs.verifyTxProof({ value, path, parentNodes, root })
  }
}

module.exports = { WithdrawManager }
