import * as anchor from '@project-serum/anchor'
import { ProgramAccount, web3 } from '@project-serum/anchor'
import { PublicKey, SolanaProvider, TransactionEnvelope } from '@saberhq/solana-contrib'
import { ASSOCIATED_TOKEN_PROGRAM_ID, createMintInstructions, getATAAddress, TOKEN_PROGRAM_ID, u64, getTokenAccount } from '@saberhq/token-utils'
import { Token } from '@solana/spl-token'
import { Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { findEscrowAddress, findGovernorAddress, findLockerAddress, LockerWrapper, TribecaSDK } from '@tribecahq/tribeca-sdk'
import keypairFile from './keypair.json'
import type { Provider } from "@saberhq/solana-contrib";
import * as SPLToken from "@solana/spl-token";
import { 
  MerkleDistributorErrors, 
  MerkleDistributorSDK,
  MerkleDistributorWrapper,
  PendingDistributor,
  findClaimStatusKey, 
  findDistributorKey,
} from "@saberhq/merkle-distributor";
import { BalanceTree } from './utils/balance-tree';

const MAX_NUM_NODES = new u64(3);
const MAX_TOTAL_CLAIM = new u64(1_000_000_000_000);
const ZERO_BYTES32 = Buffer.alloc(32);

export const signer = Keypair.fromSecretKey(
  Uint8Array.from([97,46,44,175,15,110,7,237,243,15,55,50,158,227,91,232,109,165,63,244,59,126,23,13,93,71,241,70,180,56,221,33,142,67,104,248,208,129,43,80,134,141,191,238,249,147,90,77,210,45,251,174,145,27,89,173,190,201,123,173,222,199,92,207])
)

async function main() {

  const keypair = web3.Keypair.fromSeed(Uint8Array.from(keypairFile.slice(0, 32)))
  console.log('pubkey', keypair.publicKey.toString())
  const wallet = new anchor.Wallet(keypair)
  const connection = new web3.Connection('http://127.0.0.1:8899')
  const anchorProvider = new anchor.Provider(connection, wallet, {})
  anchor.setProvider(anchorProvider)

  const solanaProvider = SolanaProvider.init({
    connection,
    wallet,
    opts: {},
  })


  let cysMint = Keypair.fromSecretKey(
    Uint8Array.from([170, 204, 133, 206, 215, 135, 147, 69, 202, 136, 132, 212, 28, 149, 110, 252, 100, 236, 7, 172, 87, 170, 80, 207, 122, 181, 91, 120, 31, 198, 72, 62, 9, 54, 24, 114, 208, 200, 16, 126, 237, 6, 101, 43, 79, 108, 255, 88, 254, 188, 218, 124, 116, 214, 182, 25, 219, 28, 183, 227, 101, 197, 44, 71])
  ); // cxWg5RTK5AiSbBZh7NRg5btsbSrc8ETLXGf7tk3MUez
  const cysTx = new Transaction();  
  cysTx.add(
    // create account
    SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: cysMint.publicKey,
      space: SPLToken.MintLayout.span,
      lamports: await SPLToken.Token.getMinBalanceRentForExemptMint(connection),
      programId: SPLToken.TOKEN_PROGRAM_ID,
    }),
    // init mint
    SPLToken.Token.createInitMintInstruction(
      SPLToken.TOKEN_PROGRAM_ID, // program id, always token program id
      cysMint.publicKey, // mint account public key
      6, // decimals
      signer.publicKey, // mint authority (an auth to mint token)
      null // freeze authority (we use null first, the auth can let you freeze user's token account)
    )
  );
  cysTx.feePayer = solanaProvider.wallet.publicKey;
  cysTx.recentBlockhash = (await solanaProvider.connection.getLatestBlockhash()).blockhash;
  const txhash = await anchorProvider.send(cysTx, [signer, cysMint])
  console.log(`txhash: ${txhash}`);
  // solanaProvider.connection.getAccountInfo()
  const data = await SPLToken.Token.getAssociatedTokenAddress(
    SPLToken.ASSOCIATED_TOKEN_PROGRAM_ID, 
    SPLToken.TOKEN_PROGRAM_ID, 
    cysMint.publicKey, 
    signer.publicKey
    );
  console.log("Adta:  => ", data.toString());

  const merkleSdk = MerkleDistributorSDK.load({ provider: solanaProvider });

  // console.log("SDK: ", merkleSdk.);

    const kpOne = web3.Keypair.generate();
    const kpTwo = web3.Keypair.generate();
    const kpThree = web3.Keypair.generate();
    const kpFour = web3.Keypair.generate();
    const kpFive = web3.Keypair.generate();
    const allKps = [kpOne, kpTwo, kpThree, kpFour, kpFive];
    await Promise.all(
      allKps.map(async (kp) => {
        await solanaProvider.connection.requestAirdrop(
          kp.publicKey,
          LAMPORTS_PER_SOL
        );
      })
    );
    console.log("Done here")

    const claimAmountOne = new u64(100);
    const claimAmountTwo = new u64(101);
    const claimAmountThree = new u64(102);
    const claimAmountFour = new u64(103);
    const claimAmountFive = new u64(104);
    const tree = new BalanceTree([
      { account: kpOne.publicKey, amount: claimAmountOne },
      { account: kpTwo.publicKey, amount: claimAmountTwo },
      { account: kpThree.publicKey, amount: claimAmountThree },
      { account: kpFour.publicKey, amount: claimAmountFour },
      { account: kpFive.publicKey, amount: claimAmountFive }
    ]);
    const root = tree.getRoot()
    console.log("ROOT: ", root.toString());

    // const { distributor } = await createAndSeedDistributor(
    //   merkleSdk,
    //   MAX_NUM_NODES,
    //   MAX_TOTAL_CLAIM,
    //   tree.getRoot()
    // )
    // console.log("Wokring till distrib")

    const newDistributor = await merkleSdk.createDistributor({
      root,
      maxNumNodes: new u64(100),
      maxTotalClaim: new u64(100000000),
      tokenMint: cysMint.publicKey
    })
    console.log("DISTRIB: ", newDistributor.distributor.toString());
    console.log("ATA: ", newDistributor.distributorATA.toString());
    let txBuild = newDistributor.tx.build();
    txBuild.recentBlockhash = (await solanaProvider.connection.getLatestBlockhash()).blockhash;
    txBuild.feePayer = anchorProvider.wallet.publicKey;
    const str = txBuild.serializeMessage().toString('base64');
    console.log(`https://explorer.solana.com/tx/inspector?message=${encodeURIComponent(str)}&cluster=custom`) 
    let txSig = await anchorProvider.send(txBuild, newDistributor.tx.signers);
    console.log(`New Distributor::=>  ${txSig}`);
    console.log("Wokring right")
    
    // Seed merkle distributor with tokens
  const ix = SPLToken.Token.createMintToInstruction(
    TOKEN_PROGRAM_ID,
    cysMint.publicKey,
    newDistributor.distributorATA,
    anchorProvider.wallet.publicKey,
    [],
    new u64(100000000)
  );
  let txs = new Transaction()
  txs.add(ix)
  // const tx = new TransactionEnvelope(solanaProvider, [ix]);
  // let txBuild1 = tx.build();
  txs.feePayer = anchorProvider.wallet.publicKey;
  txs.recentBlockhash = (await anchorProvider.connection.getLatestBlockhash()).blockhash;
  const str1 = txs.serializeMessage().toString('base64');
  console.log(`https://explorer.solana.com/tx/inspector?message=${encodeURIComponent(str1)}&cluster=custom`) 
  let txSig1 = await anchorProvider.send(txs)
  console.log(`New Distributor Seeded::=>  ${txSig1}`);

  const distributorW = await merkleSdk.loadDistributor(newDistributor.distributor);
  console.log(distributorW.key.toString())
  await Promise.all(
    allKps.map(async (kp, index) => {
      const amount = new u64(100 + index);
      const proof = tree.getProof(index, kp.publicKey, amount);

      const tx = await distributorW.claim({
        index: new u64(index),
        amount,
        proof,
        claimant: kp.publicKey,
      });
      let txBuild = tx.build();
      txBuild.recentBlockhash = (await anchorProvider.connection.getLatestBlockhash()).blockhash;
      txBuild.feePayer = anchorProvider.wallet.publicKey;
      const str = txBuild.serializeMessage().toString('base64');
      console.log("Working right")
      console.log(`https://explorer.solana.com/tx/inspector?message=${encodeURIComponent(str)}&cluster=custom`) 
      console.log("Failing Here")
      let txSig = await anchorProvider.send(txBuild, [kp])
      console.log(`Verified::=>  ${txSig}`);

      const tokenAccountInfo = await getTokenAccount(
        solanaProvider,
        await getATAAddress({
          mint: distributorW.data.mint,
          owner: kp.publicKey,
        })
      );
    })
  )
}

main().then(
  () => process.exit(),
  (err) => {
    console.error(err)
    process.exit(-1)
  }
)