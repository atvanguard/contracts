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
  COUNTERPARTY_DEPOSIT: 1,
  TRANSFER: 2,
  COUNTERPARTY_TRANSFER: 3,
  BURN: 4
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
    console.log('childToken', childToken.toString('hex'))
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
    // assert.ok(exitor.equals(msg.sender))
    let inputTxBalance

    if (inputTxType === TxType.COUNTERPARTY_TRANSFER) {
      // event LogTransfer(
      //   address indexed token, address indexed from, address indexed to,
      //   uint256 amountOrTokenId, uint256 input1, uint256 input2, uint256 output1, uint256 output2);
      this.assertIncomingTransfer(inputItems[0], inputItems[3].slice(12), exitor)
      inputTxBalance = inputData.slice(-32)
    } else if (inputTxType === TxType.TRANSFER) {
      this.assertTransfer(inputItems[0], inputItems[2].slice(12), exitor)
      inputTxBalance = inputData.slice(96, 128)
    } else if (inputTxType === TxType.DEPOSIT) {
      // event Deposit(address indexed token, address indexed from, uint256 amountOrTokenId, uint256 input1, uint256 output1);
      this.assertDeposit(inputItems[0], inputData.slice(64), exitData.slice(32, 64), 'e', inputItems[2].slice(12), exitor)
      inputTxBalance = inputData.slice(64)
    }
    let exitTxOpeningBalance = exitData.slice(32, 64)
    this.assertEquality(inputTxBalance, exitTxOpeningBalance)

    const amountOrTokenId = exitData.slice(0, 32) // the next 32 + 32 bytes are input1 and output1

    // **** assertions on tx ***
    const sender = this.getAddressFromTx(utils.rlp.decode(exit.tx))
    assert.ok(
      exitor.equals(sender), // && sender.equals(msg.sender)
      'Tx signer is not exitor'
    )

    // calculate exit ID
    const exitId = this.getExitId(input.header.number, input.number, input.path, 0)
    const exitObject = { rootToken: rootToken.toString('hex'), amountOrTokenId, owner: exitor.toString('hex'), burnt: true }
    this._addExitToQueue(exitObject, exitId)
  }

  async exitInFlight(input, inputTxType, exit, exitTxType) {
    let inputItems = this.verifyReceiptAndTx(input)
    inputItems = inputItems[3][1]

    let exitTx = utils.rlp.decode(exit)
    // exitTx.forEach(e => console.log(e.toString('hex')))

    const childToken = inputItems[0]
    assert.ok(
      childToken.equals(exitTx[3]), // corresponds to "to" field in tx
      'Input and exit tx do not correspond to the same token'
    )
    // items[2] correspondes to "data" field in receipt
    const inputData = inputItems[2]
    inputItems = inputItems[1] // 1st log (0-based) - LogTransfer
    // now, inputItems[i] refers to i-th (0-based) topic in the topics array
    const rootToken = inputItems[1].slice(12)
    // assert root to child token mapping from the registry

    const exitor = this.getAddressFromTx(exitTx)
    let inputTxBalance
    if (inputTxType === TxType.COUNTERPARTY_TRANSFER) {
      // event LogTransfer(
      //   address indexed token, address indexed from, address indexed to,
      //   uint256 amountOrTokenId, uint256 input1, uint256 input2, uint256 output1, uint256 output2);
      this.assertIncomingTransfer(inputItems[0], inputItems[3].slice(12), exitor)
      inputTxBalance = inputData.slice(-32)
    } else if (inputTxType === TxType.TRANSFER) {
      this.assertTransfer(inputItems[0], inputItems[2].slice(12), exitor)
      inputTxBalance = inputData.slice(96, 128)
    } else if (inputTxType === TxType.DEPOSIT) {
      // event Deposit(address indexed token, address indexed from, uint256 amountOrTokenId, uint256 input1, uint256 output1);
      this.assertDeposit(inputItems[0], inputItems[2].slice(12), exitor)
      inputTxBalance = inputData.slice(64)
    } else if (inputTxType === TxType.COUNTERPARTY_DEPOSIT) {
      assert.ok(
        inputItems[0].toString('hex') === '4e2ca0515ed1aef1395f66b5303bb5d6f1bf9d61a353fa53f73f8ac9973fa9f6',
        'DEPOSIT_EVENT_SIGNATURE_NOT_FOUND'
      )
      inputTxBalance = inputData.slice(64)
    }

    // **** assertions on exit tx ***
    const funcSig = exitTx[5].slice(0, 4)
    const amountOrTokenId = exitTx[5].slice(-32)
    if (exitTxType === TxType.TRANSFER) {
      assert.ok(
        funcSig.equals(utils.keccak256('transfer(address,uint256)').slice(0, 4)),
        'funcSig doesnt match with transfer tx'
      )
    } else if (exitTxType === TxType.COUNTERPARTY_TRANSFER) {
      assert.ok(
        funcSig.equals(utils.keccak256('transfer(address,uint256)').slice(0, 4)),
        'funcSig doesnt match with transfer tx'
      )
    } else if (exitTxType === TxType.BURN) {
      assert.ok(
        funcSig.equals(utils.keccak256('withdraw(uint256)').slice(0, 4)),
        'funcSig doesnt match with withdraw tx'
      )
    }
    this.assertLte(inputTxBalance, amountOrTokenId)

    const exitId = this.getExitId(input.header.number, input.number, input.path, 0)
    const exitObject = { rootToken: rootToken.toString('hex'), amountOrTokenId, owner: exitor.toString('hex'), burnt: true }
    this._addExitToQueue(exitObject, exitId)
  }

  assertIncomingTransfer(eventSig, receiver, exitor) {
    assert.ok(
      eventSig.toString('hex') === 'e6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4',
      'LOG_TRANSFER_EVENT_SIGNATURE_NOT_FOUND'
    )
    assert.ok(
      receiver.equals(exitor),
      'Exitor is not the receiver of the input tx'
    )
  }

  assertTransfer(eventSig, sender, exitor) {
    assert.ok(
      eventSig.toString('hex') === 'e6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4',
      'LOG_TRANSFER_EVENT_SIGNATURE_NOT_FOUND'
    )
    assert.ok(
      sender.equals(exitor),
      'Exitor is not the sender of the input tx'
    )
  }

  assertDeposit(eventSig, depositor, exitor) {
    assert.ok(
      eventSig.toString('hex') === '4e2ca0515ed1aef1395f66b5303bb5d6f1bf9d61a353fa53f73f8ac9973fa9f6',
      'DEPOSIT_EVENT_SIGNATURE_NOT_FOUND'
    )
    assert.ok(
      depositor.equals(exitor),
      'Exitor is not the sender of the input tx'
    )
  }

  assertLte(amount1, amount2) {
    assert.ok(
      amount1.compare(amount2) <= 1,
      'Input tx closing balance is less than that being transferred'
    )
  }

  assertEquality(amount1, amount2) {
    assert.ok(
      amount1.compare(amount2) === 0,
      'Input tx closing balance doesnt match exit tx opening balance'
    )
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

module.exports = { WithdrawManager, TxType }
