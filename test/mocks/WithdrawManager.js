const Buffer = require('safe-buffer').Buffer
const BN = require('bn.js')
const moment = require('moment')
const utils = require('ethereumjs-util')
const PriorityQueue = require('js-priority-queue')
const assert = require('assert')

const MerkleTree = require('../helpers/merkle-tree')
const Proofs = require('../helpers/proofs')
const getBlockHeader = require('../helpers/blocks').getBlockHeader

const TxType = {
  DEPOSIT: 0,
  INCOMING_TRANSFER: 1,
  TRANSFER: 2
}

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

  async withdrawBurntTokens(input, inputTxType, exit) {
    let exitItems = this.verifyReceiptAndTx(exit)
    exitItems = exitItems[3][1]
    let inputItems = this.verifyReceiptAndTx(input)
    inputItems = inputItems[3][1]

    const childToken = inputItems[0]
    assert.ok(
      childToken.equals(exitItems[0]), // corresponds to "to" field in receipt
      'Input and exit tx do not correspond to the same token'
    )
    // items[2] correspondes to "data" field in receipt
    const inputData = inputItems[2]
    const exitData = exitItems[2]

    inputItems = inputItems[1] // 1st log (0-based) - LogTransfer
    // now, inputItems[i] refers to i-th (0-based) topic in the topics array

    exitItems = exitItems[1] // 1st log (0-based) - Withdraw
    // now, exitItems[i] refers to i-th (0-based) topic in the topics array
    assert.ok(
      exitItems[0].toString('hex') === 'ebff2602b3f468259e1e99f613fed6691f3a6526effe6ef3e768ba7ae7a36c4f',
      'WITHDRAW_EVENT_SIGNATURE_NOT_FOUND'
    )
    const rootToken = exitItems[1].slice(12)
    // console.log('rootToken', rootToken.toString('hex'))
    // assert root to child token mapping from the registry

    const exitor = exitItems[2].slice(12)
    if (inputTxType === TxType.INCOMING_TRANSFER) {
      // event LogTransfer(
      //   address indexed token, address indexed from, address indexed to,
      //   uint256 amountOrTokenId, uint256 input1, uint256 input2, uint256 output1, uint256 output2);
      assert.ok(
        inputItems[0].toString('hex') === 'e6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4',
        'LOG_TRANSFER_EVENT_SIGNATURE_NOT_FOUND'
      )
      // verify that closing balance of the inputTx is the opening balance of the exit
      assert.ok(
        inputData.slice(-32).equals(exitData.slice(32, 64)),
        'Input tx is not an incoming transfer'
      )
      const receiver = inputItems[3].slice(12)
      assert.ok(
        receiver.equals(exitor), // && sender.equals(msg.sender)
        'Exitor is not the receiver of the input tx'
      )
    } else if (inputTxType === TxType.TRANSFER) {
      assert.ok(
        inputItems[0].toString('hex') === 'e6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4',
        'LOG_TRANSFER_EVENT_SIGNATURE_NOT_FOUND'
      )
      assert.ok(
        inputData.slice(96, 128).equals(exitData.slice(32, 64)),
        'Input tx is not an outgoing transfer'
      )
      const sender = inputItems[2].slice(12)
      assert.ok(
        sender.equals(exitor), // && sender.equals(msg.sender)
        'Exitor is not the sender of the input tx'
      )
    } else if (inputTxType === TxType.DEPOSIT) {
      // event Deposit(address indexed token, address indexed from, uint256 amountOrTokenId, uint256 input1, uint256 output1);
      assert.ok(
        inputItems[0].toString('hex') === '4e2ca0515ed1aef1395f66b5303bb5d6f1bf9d61a353fa53f73f8ac9973fa9f6',
        'DEPOSIT_EVENT_SIGNATURE_NOT_FOUND'
      )
      assert.ok(
        inputData.slice(64).equals(exitData.slice(32, 64)),
        'Input tx is not a deposit tx'
      )
    }

    const amountOrTokenId = exitData.slice(0, 32).toString('hex') // the next 32 + 32 bytes are input1 and output1

    // **** assertions on tx ***
    const exitTx = utils.rlp.decode(exit.tx)
    const rawTx = exitTx.slice()
    rawTx[6] = Buffer.from('0d', 'hex')
    rawTx[7] = Buffer.from('', 'hex')
    rawTx[8] = Buffer.from('', 'hex')

    const sender = utils.pubToAddress(utils.ecrecover(
      utils.rlphash(rawTx), parseInt(exitTx[6].toString('hex'), 16), exitTx[7], exitTx[8], 13 // network id
    ))

    assert.ok(
      exitor.equals(sender), // && sender.equals(msg.sender)
      'Tx signer is not exitor'
    )

    // calculate exit ID
    const exitId = this.getExitId(input.header.number, input.number, input.path, 0)
    const exitObject = { rootToken: rootToken.toString('hex'), amountOrTokenId, owner: exitor.toString('hex'), burnt: true }
    this._addExitToQueue(exitObject, exitId)
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

module.exports = { WithdrawManager, TxType }
