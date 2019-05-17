const Buffer = require('safe-buffer').Buffer
const BN = require('bn.js')
const moment = require('moment')
const utils = require('ethereumjs-util')
const PriorityQueue = require('js-priority-queue')
const assert = require('assert')

const MerkleTree = require('../helpers/merkle-tree')
const Proofs = require('../helpers/proofs')
const getBlockHeader = require('../helpers/blocks').getBlockHeader

// const HEADER_BLOCK_NUMBER_WEIGHT = new BN('10').pow(new BN('30'))
// const WITHDRAW_BLOCK_NUMBER_WEIGHT = new BN('10').pow(new BN('12'))
// const TX_INDEX_WEIGHT = new BN('10').pow(new BN('5'))

const HEADER_BLOCK_NUMBER_WEIGHT = new BN('10').pow(new BN('3'))
const WITHDRAW_BLOCK_NUMBER_WEIGHT = new BN('10').pow(new BN('2'))
const TX_INDEX_WEIGHT = new BN('10').pow(new BN('1'))
console.log(
  utils.keccak256('withdraw(uint256)').slice(0, 4)
)
class WithdrawManager {
  constructor(rootChain, registry, options) {
    this.rootChain = rootChain
    this.registry = registry
    this.ownerExits = {}
    this.exits = {}
    this.exitsQueues = {}
    this.options = options
  }

  async startExit(input, logIndex, counterParty, exit, msgSender, _counterParty) {
    let participant = counterParty || msgSender
    const { childToken, rootToken, inputTxClosingBalance, exitId } = this.processReferenceTx(input, logIndex, participant, options)
    let tx
    let burnt = false
    if (_counterParty) {
      tx = this.processExitTxCounterparty(exit, inputTxClosingBalance, counterParty, msgSender)
    } else {
      tx = this.processExitTx(exit, inputTxClosingBalance, msgSender)
      burnt = tx.burnt
    }
    // note that childToken comes from the log referenced; verifying here that the exit tx corresponds to the same token
    assert.ok(
      childToken.equals(tx.token),
      'Input and exit tx do not correspond to the same token'
    )
    // assert rootToken to childToken mapping
    const exitObject = { rootToken: rootToken.toString('hex'), amountOrTokenId: tx.exitAmount, owner: msgSender.toString('hex'), burnt }
    this._addExitToQueue(exitObject, exitId)
  }

  processReferenceTx(input, logIndex, participant) {
    let inputItems = this.verifyReceiptAndTx(input)
    inputItems = inputItems[3][logIndex] // 1st log (0-based)
    const childToken = inputItems[0] // "address" (contract address that emitted the log) field in the receipt
    const inputData = inputItems[2] // "data" field in the receipt
    // inputItems[i] refers to i-th (0-based) topic in the topics array
    inputItems = inputItems[1]
    console.log('inputItems', inputItems)
    const rootToken = inputItems[1].slice(12)

    let inputTxClosingBalance

    // Deposit
    if (inputItems[0].toString('hex') === '4e2ca0515ed1aef1395f66b5303bb5d6f1bf9d61a353fa53f73f8ac9973fa9f6') {
      // event Deposit(address indexed token, address indexed from, uint256 amountOrTokenId, uint256 input1, uint256 output1);
      console.log(participant, inputItems[2].slice(12))
      assert.ok(
        participant.equals(inputItems[2].slice(12)),
        'exitor and referenced deposit tx do not match'
      )
      inputTxClosingBalance = inputData.slice(64) // output1
    }
    // LogTransfer
    else if (inputItems[0].toString('hex') === 'e6497e3ee548a3372136af2fcb0696db31fc6cf20260707645068bd3fe97f3c4') {
      // event LogTransfer(
      //   address indexed token, address indexed from, address indexed to,
      //   uint256 amountOrTokenId, uint256 input1, uint256 input2, uint256 output1, uint256 output2)
      // console.log(participant, inputItems[2].slice(12), inputItems[3].slice(12))
      console.log(participant)
      // A. exitor transferred tokens
      if (participant.equals(inputItems[2].slice(12))) { // from
        // If from and to are same, that tx will also get picked here
        inputTxClosingBalance = inputData.slice(96, 128) // output1
      }
      // B. exitor received tokens
      else if (participant.equals(inputItems[3].slice(12))) { // to
        inputTxClosingBalance = inputData.slice(128) // output2
      }
      else {
        assert.ok(false, 'tx / log doesnt concern the participant')
      }
    }
    // Withdraw
    else if (inputItems[0].toString('hex') === 'ebff2602b3f468259e1e99f613fed6691f3a6526effe6ef3e768ba7ae7a36c4f') {
      // event Withdraw(address indexed token, address indexed from, uint256 amountOrTokenId, uint256 input1, uint256 output1)
      assert.ok(
        participant.equals(inputItems[2].slice(12)), // previously .slice wasnt there
        'Burn tx doesnt concern the participant'
      )
      inputTxClosingBalance = inputData.slice(64) // output1
    } else {
      assert.ok(false, 'Exit type not supported')
    }
    const exitId = this.getExitId(options.number, input.number, input.path, 0)
    // if (exitor) exitor = exitor.slice(12)
    return { childToken, rootToken, inputTxClosingBalance, exitId }
  }

  processExitTxCounterparty(exit, inputTxClosingBalance, counterparty, msgSender) {
    let exitTx = utils.rlp.decode(exit)
    // exitTx.forEach(e => console.log(e.toString('hex')))
    const token = exitTx[3] // corresponds to "to" field in tx
    const funcSig = exitTx[5].slice(0, 4)
    const amount = parseInt(exitTx[5].slice(-32).toString('hex'), 16)
    inputTxClosingBalance = parseInt(inputTxClosingBalance.toString('hex'), 16)

    const txSender = this.getAddressFromTx(exitTx)
    assert.ok(
      txSender.equals(counterparty),
      'txSender is not counterparty'
    )
    let exitAmount
    if (funcSig.equals(utils.keccak256('transfer(address,uint256)').slice(0, 4))) {
      assert.ok(
        msgSender.equals(exitTx[5].slice(16, 36)), /* 1st parameter in transfer function call */
        'not an incoming transfer for txSender'
      )
      exitAmount = inputTxClosingBalance + amount // exit amount
    }
    return { token, exitAmount }
  }

  processExitTx(exit, inputTxClosingBalance, msgSender) {
    let exitTx = utils.rlp.decode(exit)
    // exitTx.forEach(e => console.log(e.toString('hex')))
    const token = exitTx[3] // corresponds to "to" field in tx
    const funcSig = exitTx[5].slice(0, 4)
    const amount = parseInt(exitTx[5].slice(-32).toString('hex'), 16)
    inputTxClosingBalance = parseInt(inputTxClosingBalance.toString('hex'), 16)

    const txSender = this.getAddressFromTx(exitTx)
    console.log(txSender, msgSender)
    assert.ok(
      txSender.equals(msgSender),
      'txSender is not msgSender'
    )
    let exitAmount, burnt
    if (funcSig.equals(utils.keccak256('transfer(address,uint256)').slice(0, 4))) {
      // outgoing transfer
      exitAmount = inputTxClosingBalance - amount
      // @todo self transfer
    } else if (funcSig.equals(utils.keccak256('withdraw(uint256)').slice(0, 4))) {
      exitAmount = amount // exit with the amount burnt
      burnt = true
    } else {
      assert.ok(false, 'Exit tx type not supported')
    }
    return { exitAmount, burnt, token }
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
    // input = utils.rlp.decode(input)
    const { headerNumber, receipt, receiptParentNodes, tx, txParentNodes, path, number, timestamp, transactionsRoot, receiptsRoot, proof, options } = input
    const decodedReceipt = utils.rlp.decode(receipt)
    assert.ok(
      MerklePatriciaProof.verify(decodedReceipt, path, receiptParentNodes, receiptsRoot),
      'receiptProof failed'
    )
    const decodedTx = utils.rlp.decode(tx)
    assert.ok(
      MerklePatriciaProof.verify(decodedTx, path, txParentNodes, transactionsRoot),
      'txProof failed'
    )
    const blockHeader = getBlockHeader({ number, timestamp, transactionsRoot, receiptsRoot })
    // get start and root from rootChain.headers(headerNumber)
    assert.ok(
      new MerkleTree([blockHeader]).verify(
        blockHeader,
        parseInt(number, 10) - parseInt(options.start, 10),
        utils.toBuffer(options.root), // remove toBuffer
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
    // console.log('in MerklePatriciaProof')
    // console.log({ value, path, parentNodes, root })
    return Proofs.verifyTxProof({ value, path, parentNodes, root })
  }
}

module.exports = { WithdrawManager }
