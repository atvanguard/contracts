const utils = require('ethereumjs-util')
const assert = require('assert')

const WithdrawManager = require('../WithdrawManager')
const withdrawManager = new WithdrawManager()
const transfer = require('../mockResponses/transfer')
const withdraw = require('../mockResponses/withdraw')

const getBlockHeader = require('../../helpers/blocks').getBlockHeader
const MerkleTree = require('../../helpers/merkle-tree')
const Proofs = require('../../helpers/proofs')

async function withdrawBurntTokens() {
  const inputTx = await build(transfer)
  const exitTx = await build(withdraw)
  await withdrawManager.withdrawBurntTokens(inputTx, exitTx)
  // await withdrawManager.withdrawBurntTokens(inputTx)
  // await withdrawManager.withdrawBurntTokens(
  //   headerNumber,
  //   // utils.bufferToHex(Buffer.concat(withdrawBlockProof)),
  //   utils.bufferToHex(Buffer.concat(withdrawBlockProof)),
  //   withdrawBlock.number,
  //   withdrawBlock.timestamp,
  //   utils.bufferToHex(withdrawBlock.transactionsRoot),
  //   utils.bufferToHex(withdrawBlock.receiptsRoot),
  //   utils.bufferToHex(rlp.encode(receiptProof.path)), // branch mask
  //   utils.bufferToHex(getTxBytes(withdrawTx)),
  //   utils.bufferToHex(rlp.encode(txProof.parentNodes)), // Merkle proof of the withdraw transaction
  //   utils.bufferToHex(getReceiptBytes(withdrawReceipt)),
  //   utils.bufferToHex(rlp.encode(receiptProof.parentNodes)),
  //   user,
  //   { receiptProof, rootChain: contracts.rootChain }
  // )
}

let headerNumber = 0

async function build(transfer) {
  let blockHeader = getBlockHeader(transfer.block)
  let tree = new MerkleTree([blockHeader])
  let receiptProof = await Proofs.getReceiptProof(transfer.receipt, transfer.block, [transfer.receipt])
  Proofs.verifyTxProof(receiptProof)
  headerNumber += 1
  return {
    header: { number: headerNumber, root: tree.getRoot(), start: transfer.receipt.blockNumber },
    receipt: Proofs.getReceiptBytes(transfer.receipt), // rlp encoded
    tx: Proofs.getTxBytes(transfer.receipt), // rlp encoded
    receiptParentNodes: receiptProof.parentNodes,
    path: receiptProof.path,
    number: transfer.receipt.blockNumber,
    timestamp: transfer.block.timestamp,
    transactionsRoot: transfer.block.transactionsRoot,
    receiptsRoot: Buffer.from(transfer.block.receiptsRoot.slice(2), 'hex'),
    proof: await tree.getProof(blockHeader)
  }
}

withdrawBurntTokens()
