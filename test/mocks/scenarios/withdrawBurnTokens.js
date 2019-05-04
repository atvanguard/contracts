const utils = require('ethereumjs-util')
const assert = require('assert')

const WithdrawManager = require('../WithdrawManager').WithdrawManager
const TxType = require('../WithdrawManager').TxType

const deposit = require('../mockResponses/deposit')
const depositBurnReceipt = require('../mockResponses/deposit-burn')
const incomingTransfer = require('../mockResponses/incomingTransfer')
const burn = require('../mockResponses/burn')
const transfer = require('../mockResponses/transfer')
const partialBurn = require('../mockResponses/partialBurn')

const getBlockHeader = require('../../helpers/blocks').getBlockHeader
const MerkleTree = require('../../helpers/merkle-tree')
const Proofs = require('../../helpers/proofs')

async function incomingTransferFullBurn() {
  let withdrawManager = new WithdrawManager()
  const input = await build(incomingTransfer)
  const exit = await buildInFlight(burn)
  const msgSender = Buffer.from(burn.tx.from.slice(2), 'hex')
  await withdrawManager.startExit(input, TxType.COUNTERPARTY_TRANSFER, exit, msgSender)
}

async function depositBurn() {
  let withdrawManager = new WithdrawManager()
  const input = await build(deposit)
  const exit = await buildInFlight(depositBurnReceipt)
  const msgSender = Buffer.from(depositBurnReceipt.tx.from.slice(2), 'hex')
  await withdrawManager.startExit(input, TxType.DEPOSIT, exit, msgSender)
}

async function transferPartialBurn() {
  let withdrawManager = new WithdrawManager()
  const input = await build(transfer)
  const exit = await buildInFlight(partialBurn)
  const msgSender = Buffer.from(partialBurn.tx.from.slice(2), 'hex')
  await withdrawManager.startExit(input, TxType.TRANSFER, exit, msgSender)
}

function buildInFlight(event) {
  // no receipt, no block
  return Proofs.getTxBytes(event.tx)
}

let headerNumber = 0
async function build(event) {
  let blockHeader = getBlockHeader(event.block)
  let tree = new MerkleTree([blockHeader])
  let receiptProof = await Proofs.getReceiptProof(event.receipt, event.block, [event.receipt])
  let txProof = await Proofs.getTxProof(event.tx, event.block)
  // Proofs.verifyTxProof(receiptProof)
  headerNumber += 1
  return {
    header: { number: headerNumber, root: tree.getRoot(), start: event.receipt.blockNumber },
    receipt: Proofs.getReceiptBytes(event.receipt), // rlp encoded
    receiptParentNodes: receiptProof.parentNodes,
    // tx: Buffer.from(event.tx.raw.slice(2), 'hex'),
    tx: Proofs.getTxBytes(event.tx), // rlp encoded
    txParentNodes: txProof.parentNodes,
    path: receiptProof.path,
    number: event.receipt.blockNumber,
    timestamp: event.block.timestamp,
    // transactionsRoot: event.block.transactionsRoot,
    transactionsRoot: Buffer.from(event.block.transactionsRoot.slice(2), 'hex'),
    receiptsRoot: Buffer.from(event.block.receiptsRoot.slice(2), 'hex'),
    proof: await tree.getProof(blockHeader)
  }
}

async function execute() {
  await incomingTransferFullBurn()
  await depositBurn()
  await transferPartialBurn()
}

execute().then()
