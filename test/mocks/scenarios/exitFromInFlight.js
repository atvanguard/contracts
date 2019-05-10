const utils = require('ethereumjs-util')
const assert = require('assert')

const WithdrawManager = require('../WithdrawManager').WithdrawManager
const MarketplaceWithdrawManager = require('../MarketplaceFraudProof')

const deposit = require('../mockResponses/exitInFlight/deposit')
const transfer = require('../mockResponses/exitInFlight/transfer')
// const deposit = require('../mockResponses/exitInFlight/deposit-2')
// const transfer = require('../mockResponses/exitInFlight/transfer-2')
const burn = require('../mockResponses/exitInFlight/burn')
const counterpartyDeposit = require('../mockResponses/exitInFlight/counterparty-deposit')
const counterpartyTransfer = require('../mockResponses/exitInFlight/counterparty-transfer')

const depositErc20 = require('../mockResponses/marketplace/depositErc20')
const depositErc721 = require('../mockResponses/marketplace/depositErc721')
const executeOrder = require('../mockResponses/marketplace/executeOrder')

const getBlockHeader = require('../../helpers/blocks').getBlockHeader
const MerkleTree = require('../../helpers/merkle-tree')
const Proofs = require('../../helpers/proofs')
const msgSender = Buffer.from('9fb29aac15b9a4b7f17c3385939b007540f4d791', 'hex')
const counterparty = Buffer.from('96C42C56fdb78294F96B0cFa33c92bed7D75F96a', 'hex')

async function depositTransferInFlight() {
  let withdrawManager = new WithdrawManager()
  const input = await build(deposit)
  const exit = await buildInFlight(transfer)
  await withdrawManager.startExit(input, 1, null, exit, msgSender)
}

async function counterPartyDepositAndTransferInFlight() {
  let withdrawManager = new WithdrawManager()
  const input = await build(counterpartyDeposit)
  const exit = await buildInFlight(counterpartyTransfer)
  await withdrawManager.startExit(input, 1, counterparty, exit, msgSender, counterparty)
}

async function counterPartyTransferAndBurnInFlight() {
  let withdrawManager = new WithdrawManager()
  const input = await build(counterpartyTransfer)
  const exit = await buildInFlight(burn)
  await withdrawManager.startExit(input, 1, counterparty, exit, msgSender)
}

async function marketPlaceInFlight() {
  let marketplaceWithdrawManager = new MarketplaceWithdrawManager()
  const input0 = await build(depositErc20)
  const input1 = await build(depositErc721)
  const exit = await buildInFlight(executeOrder)
  await marketplaceWithdrawManager.startExitWithMarketplaceTx(input0, 1, input0, 1, exit, Buffer.from(depositErc721.tx.from.slice(2), 'hex'))
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
  // console.log(Object.keys(receiptProof))
  // console.log(receiptProof)
  // assert.ok(Proofs.verifyTxProof(receiptProof), 'fail')
  // Proofs.verifyTxProof({})
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
  await depositTransferInFlight()
  await counterPartyDepositAndTransferInFlight()
  await counterPartyTransferAndBurnInFlight()
  // await marketPlaceInFlight()
}

execute().then()
