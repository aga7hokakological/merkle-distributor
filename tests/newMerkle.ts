import { chaiSolana, expectTX } from "@saberhq/chai-solana";
import {
  getTokenAccount,
  sleep,
  u64,
  ZERO,
} from "@saberhq/token-utils";
import type { SendTransactionError } from "@solana/web3.js";
import { Keypair, 
  LAMPORTS_PER_SOL, 
  Transaction,
  Connection,
  clusterApiUrl,
  SystemProgram,
} from "@solana/web3.js";
import { setProvider, web3 } from '@project-serum/anchor';
import * as anchor from '@project-serum/anchor';
import chai, { expect } from "chai";
import { 
  PublicKey, 
  SignerWallet,
  SolanaProvider, 
  TransactionEnvelope 
} from '@saberhq/solana-contrib';
import { 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  createMintInstructions, 
  getATAAddress, 
  TOKEN_PROGRAM_ID,
  SPLToken,
  createMint,
} from '@saberhq/token-utils';
import type { Provider } from '@saberhq/solana-contrib';
import { 
  MerkleDistributorErrors, 
  MerkleDistributorSDK,
  MerkleDistributorWrapper,
  PendingDistributor,
  findClaimStatusKey, 
  findDistributorKey,
} from "@saberhq/merkle-distributor";
import { BalanceTree } from './utils/balance-tree';
import keypairFile from './keypair.json';

chai.use(chaiSolana);

let solanaProvider: SolanaProvider;
const MAX_NUM_NODES = new u64(3);
const MAX_TOTAL_CLAIM = new u64(1_000_000_000_000);
const ZERO_BYTES32 = Buffer.alloc(32);
export const DEFAULT_TOKEN_DECIMALS = 6;

const newTokenMint = new web3.PublicKey('7VtacnoRgb65PPXoNZZcAku75ggjSGQHgysmLHwu3Gvg');

export const createAndSeedDistributor = async (
  sdk: MerkleDistributorSDK,
  maxTotalClaim: u64,
  maxNumNodes: u64,
  root: Buffer
): Promise<{
  mint: PublicKey;
  distributor: PublicKey;
  pendingDistributor: PendingDistributor;
}> => {
  const { provider } = sdk;
  const mint = newTokenMint;
  // await createMint(
  //   provider,
  //   provider.wallet.publicKey,
  //   DEFAULT_TOKEN_DECIMALS
  // );

  const pendingDistributor = await sdk.createDistributor({
    root,
    maxTotalClaim,
    maxNumNodes,
    tokenMint: mint,
  });
  // await expectTX(pendingDistributor.tx, "create merkle distributor").to.be.fulfilled;
  let txBuild = pendingDistributor.tx.build();
  txBuild.recentBlockhash = (await solanaProvider.connection.getLatestBlockhash()).blockhash;
  let txSig = await solanaProvider.send(txBuild, pendingDistributor.tx.signers)
  console.log(`Verified::=>  ${txSig}`);

  // Seed merkle distributor with tokens
  const ix = SPLToken.createMintToInstruction(
    TOKEN_PROGRAM_ID,
    mint,
    pendingDistributor.distributorATA,
    provider.wallet.publicKey,
    [],
    maxTotalClaim
  );
  const tx = new TransactionEnvelope(provider, [ix]);
  // await expectTX(tx, "seed merkle distributor with tokens").to.be.fulfilled;
  let txBuild1 = tx.build();
  txBuild.recentBlockhash = (await solanaProvider.connection.getLatestBlockhash()).blockhash;
  let txSig1 = await solanaProvider.send(txBuild1, tx.signers)
  console.log(`Verified::=>  ${txSig1}`);
  

  return {
    mint,
    distributor: pendingDistributor.distributor,
    pendingDistributor,
  };
};

// export async function createMint(
//   provider: Provider,
//   connection: web3.Connection,
//   authority?: PublicKey,
//   decimals?: number
// ): Promise<PublicKey> {
//   const keypair = web3.Keypair.fromSeed(Uint8Array.from(keypairFile.slice(0, 32)));
//   const tokenAccounts = await connection.getTokenAccountsByOwner(
//     keypair.publicKey,
//     {
//       programId: TOKEN_PROGRAM_ID,
//     }
//   );

//   const coin = 

//   return newTokenMint;
// };

async function main() {

    const keypair = web3.Keypair.fromSeed(Uint8Array.from(keypairFile.slice(0, 32)));
    console.log("pubkey: ", keypair.publicKey.toString());
    const wallet = new anchor.Wallet(keypair);
    const owner = wallet.publicKey;
    sleep(2000);
    // console.log(web3.clusterApiUrl('localnet'));
    const connection = new web3.Connection(web3.clusterApiUrl('devnet'), 'confirmed');
    const anchorProvider = new anchor.Provider(connection, wallet, {});
    anchor.setProvider(anchorProvider);

    solanaProvider = SolanaProvider.init({
      connection,
      wallet,
      opts: {},
    });

    const merkleSdk = MerkleDistributorSDK.load({ provider: solanaProvider });

    const kpOne = Keypair.generate();
    const kpTwo = Keypair.generate();
    const kpThree = Keypair.generate();
    const kpFour = Keypair.generate();
    const kpFive = Keypair.generate();
    const allKps = [kpOne, kpTwo, kpThree, kpFour, kpFive];
    await Promise.all(
      allKps.map(async (kp) => {
        await anchorProvider.connection.requestAirdrop(
          kp.publicKey,
          LAMPORTS_PER_SOL
        );
      })
    );

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

    const root = tree.getRoot();

    const { distributor } = await createAndSeedDistributor(
      merkleSdk,
      MAX_TOTAL_CLAIM,
      MAX_NUM_NODES,
      root,
    );

    const distributorW = await merkleSdk.loadDistributor(distributor);
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
        txBuild.recentBlockhash = (await solanaProvider.connection.getLatestBlockhash()).blockhash;
        let txSig = await solanaProvider.send(txBuild, tx.signers)
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
    console.error(err);
    process.exit(-1);
  }
);