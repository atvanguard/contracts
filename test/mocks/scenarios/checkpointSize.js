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

async function withdrawBurntTokens() {
  const input = await build(incomingTransfer)
  input.proof = Buffer.concat(input.proof)
  input.txParentNodes = Buffer.concat(input.txParentNodes[0])
  input.receiptParentNodes = Buffer.concat(input.receiptParentNodes[0])
  console.log({
    proof: input.proof.length, // withdrawBlockProof
    path: input.path.length,
    tx: input.tx.length,
    txParentNodes: input.txParentNodes.length,
    receipt: input.receipt.length,
    receiptParentNodes: input.receiptParentNodes.length
  })
  console.log({
    proof: input.proof, // withdrawBlockProof
    path: input.path,
    tx: input.tx,
    txParentNodes: input.txParentNodes,
    receipt: input.receipt,
    receiptParentNodes: input.receiptParentNodes
  })
  let sz = input.proof.length // withdrawBlockProof
    + input.path.length
    + input.tx.length
    + input.txParentNodes.length
    + input.receipt.length
    + input.receiptParentNodes.length
    + 32 * 5 // other const size params
  console.log(sz / 1024, 'KB')
}

const NUM_BLOCKS = 256
const NUM_TXS = 65000
let headerNumber = 0
async function build(event) {
  let blockHeader = getBlockHeader(event.block)

  let blockHeaderList = []
  for (let i = 0; i < NUM_BLOCKS; i++) {
    blockHeaderList.push(blockHeader)
  }
  const block = clone(event.block)
  block.transactions = []
  const siblingReceipts = []
  for (let i = 0; i < NUM_TXS; i++) {
    block.transactions.push(clone(event.tx))
    siblingReceipts.push(clone(event.receipt))
  }
  let tree = new MerkleTree(blockHeaderList)
  let receiptProof = await Proofs.getReceiptProof(event.receipt, event.block, null, siblingReceipts)
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
  await withdrawBurntTokens()
}

execute().then()

function clone(obj) {
  return obj
  // return JSON.parse(JSON.stringify(obj))
}
