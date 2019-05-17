const utils = require('ethereumjs-util')
const assert = require('assert')

const WithdrawManager = require('../WithdrawManager').WithdrawManager

const deposit = require('../mockResponses/deposit')
const depositBurnReceipt = require('../mockResponses/deposit-burn')
const incomingTransfer = require('../mockResponses/incomingTransfer')
const burn = require('../mockResponses/burn')
const transfer = require('../mockResponses/transfer')
const partialBurn = require('../mockResponses/partialBurn')

const getBlockHeader = require('../../helpers/blocks').getBlockHeader
const MerkleTree = require('../../helpers/merkle-tree')
const Proofs = require('../../helpers/proofs')

const msgSender = Buffer.from('9fb29aac15b9a4b7f17c3385939b007540f4d791', 'hex')
const counterparty = Buffer.from('96C42C56fdb78294F96B0cFa33c92bed7D75F96a', 'hex')

async function incomingTransferFullBurn() {
  let withdrawManager = new WithdrawManager()
  const input = await build(incomingTransfer)
  // console.log(input.tx.length, input.txParentNodes.length, input.receipt.length, input.receiptParentNodes.length, input.path.length)
  const exit = await buildInFlight(burn)
  await withdrawManager.startExit(input, 1, counterparty, exit, msgSender, null)
}

async function depositBurn() {
  let withdrawManager = new WithdrawManager()
  const input = await build(deposit)
  const exit = await buildInFlight(depositBurnReceipt)
  await withdrawManager.startExit(input, 1, null, exit, msgSender, null)
}

async function transferPartialBurn() {
  let withdrawManager = new WithdrawManager()
  const input = await build(transfer)
  const exit = await buildInFlight(partialBurn)
  await withdrawManager.startExit(input, 1, null, exit, msgSender, null)
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
  assert.ok(Proofs.verifyTxProof(receiptProof), 'fail in js')
  return {
    header: { number: headerNumber++, root: tree.getRoot(), start: event.receipt.blockNumber },
    receipt: Proofs.getReceiptBytes(event.receipt), // rlp encoded
    receiptParentNodes: receiptProof.parentNodes,
    tx: Proofs.getTxBytes(event.tx), // rlp encoded
    txParentNodes: txProof.parentNodes,
    path: receiptProof.path,
    number: event.receipt.blockNumber,
    timestamp: event.block.timestamp,
    transactionsRoot: Buffer.from(event.block.transactionsRoot.slice(2), 'hex'),
    receiptsRoot: Buffer.from(event.block.receiptsRoot.slice(2), 'hex'),
    proof: await tree.getProof(blockHeader),
    options: { root: tree.getRoot(), start: event.receipt.blockNumber }
  }
}

async function execute() {
  await incomingTransferFullBurn()
  await depositBurn()
  await transferPartialBurn()
}

execute().then()
