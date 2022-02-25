import { chaiSolana, expectTX } from "@saberhq/chai-solana";
import {
  getTokenAccount,
  u64,
  ZERO,
} from "@saberhq/token-utils";
import type { SendTransactionError } from "@solana/web3.js";
import { Keypair, 
  LAMPORTS_PER_SOL, 
  Transaction,
  SystemProgram
} from "@solana/web3.js";
import { Provider as AnchorProvider, setProvider, Program } from '@project-serum/anchor';
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
  createMint,
  SPLToken,
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
import { BalanceTree } from '../scripts/utils/balance-tree';
import { Merkle } from '../target/types/merkle';

chai.use(chaiSolana);

const tokenMint = new PublicKey('7VtacnoRgb65PPXoNZZcAku75ggjSGQHgysmLHwu3Gvg');

// CYS token mint
const cysMint = new PublicKey('cxWg5RTK5AiSbBZh7NRg5btsbSrc8ETLXGf7tk3MUez');


export const DEFAULT_TOKEN_DECIMALS = 6;
const MAX_NUM_NODES = new u64(3);
const MAX_TOTAL_CLAIM = new u64(1_000_000_000_000);
const ZERO_BYTES32 = Buffer.alloc(32);


export const createKeypairWithSOL = async (
  provider: Provider
): Promise<Keypair> => {
  const kp = Keypair.generate();
  await provider.connection.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL);
  return kp;
};

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
  const mint = await createMint(
    provider,
    provider.wallet.publicKey,
    DEFAULT_TOKEN_DECIMALS
  );

  const pendingDistributor = await sdk.createDistributor({
    root,
    maxTotalClaim,
    maxNumNodes,
    tokenMint: mint,
  });
  // await expectTX(pendingDistributor.tx, "create merkle distributor").to.be.fulfilled;
  let txBuild = pendingDistributor.tx.build();
  txBuild.recentBlockhash = (await AnchorProvider.env().connection.getLatestBlockhash()).blockhash;
  let txSig = await AnchorProvider.env().send(txBuild, pendingDistributor.tx.signers)
  console.log(`Distributor hash: ${txSig}`)

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
  txBuild.recentBlockhash = (await AnchorProvider.env().connection.getLatestBlockhash()).blockhash;
  let txSig1 = await AnchorProvider.env().send(txBuild1, tx.signers)
  console.log(`merkle distributor hash: ${txSig1}`)

  return {
    mint,
    distributor: pendingDistributor.distributor,
    pendingDistributor,
  };
};


describe("merkle-distributor", () => {
  const anchorProvider = AnchorProvider.env();
  setProvider(anchorProvider);

  const solanaProvider = SolanaProvider.init({
    connection: anchorProvider.connection,
    wallet: anchorProvider.wallet,
    opts: anchorProvider.opts,
  });

  const program = anchor.workspace.LiquidityMining as Program<Merkle>;

  const merkleSdk = MerkleDistributorSDK.load({ provider: solanaProvider });

  // const payer =  solanaProvider.wallet.publicKey // how to get this Signer
  // const token = new Token(solanaProvider.connection, tokenMint, TOKEN_PROGRAM_ID, payer)

  let pendingDistributor: PendingDistributor;
  let distributorW: MerkleDistributorWrapper;

  it("Initialized!", async () => {
    const { pendingDistributor, mint } = await createAndSeedDistributor(
      merkleSdk,
      MAX_TOTAL_CLAIM,
      MAX_NUM_NODES,
      ZERO_BYTES32,
    );
    const { distributor, base, bump } = pendingDistributor;
    distributorW = await merkleSdk.loadDistributor(distributor);

    const { data } = distributorW;
    expect(data.bump).to.equal(bump);
    expect(data.maxNumNodes.toString()).to.equal(MAX_NUM_NODES.toString());
    expect(data.maxTotalClaim.toString()).to.equal(MAX_TOTAL_CLAIM.toString());
    expect(data.base).to.eqAddress(base);
    expect(data.mint).to.eqAddress(mint);
    expect(data.numNodesClaimed.toString()).to.equal(ZERO.toString());
    expect(data.root).to.deep.equal(Array.from(new Uint8Array(ZERO_BYTES32)));
    expect(data.totalAmountClaimed.toString()).to.equal(ZERO.toString());


    const tokenAccountInfo = await getTokenAccount(
      solanaProvider,
      distributorW.distributorATA
    );
    expect(tokenAccountInfo.mint).to.eqAddress(mint);
    expect(tokenAccountInfo.amount.toString()).to.equal(
      MAX_TOTAL_CLAIM.toString()
    );
  })



  context("claim", () => {
    // it("fails for empty proof", async () => {
    //   // const distributed = await merkleSdk.createDistributor(
        
    //   // )
    //   const { distributor } = await createAndSeedDistributor(
    //     merkleSdk,
    //     MAX_TOTAL_CLAIM,
    //     MAX_NUM_NODES,
    //     ZERO_BYTES32
    //   );
    //   const distributorW = await merkleSdk.loadDistributor(distributor);

    //   const claimantKP = Keypair.generate();
    //   const tx = await distributorW.claim({
    //     index: new u64(0),
    //     amount: new u64(10_000_000),
    //     proof: [],
    //     claimant: claimantKP.publicKey,
    //   });
    //   tx.addSigners(claimantKP);

    //   try {
    //     await tx.confirm();
    //   } catch (e) {
    //     const err = (e as { errors: Error[] }).errors[0] as Error;
    //     expect(err.message).to.include(
    //       `0x${MerkleDistributorErrors.InvalidProof.code.toString(16)}`
    //     );
    //   }
    // });

    it("success on three account tree", async () => {
      const kpOne = Keypair.generate();
      const kpTwo = Keypair.generate();
      const kpThree = Keypair.generate();
      const allKps = [kpOne, kpTwo, kpThree];
      await Promise.all(
        allKps.map(async (kp) => {
          await solanaProvider.connection.requestAirdrop(
            kp.publicKey,
            LAMPORTS_PER_SOL
          );
        })
      );

      const claimAmountOne = new u64(100);
      const claimAmountTwo = new u64(101);
      const claimAmountThree = new u64(102);
      const tree = new BalanceTree([
        { account: kpOne.publicKey, amount: claimAmountOne },
        { account: kpTwo.publicKey, amount: claimAmountTwo },
        { account: kpThree.publicKey, amount: claimAmountThree },
      ]);
      const { distributor } = await createAndSeedDistributor(
        merkleSdk,
        MAX_TOTAL_CLAIM,
        MAX_NUM_NODES,
        tree.getRoot()
      );
      console.log(distributor.toString())
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
          tx.addSigners(kp);
          // await expectTX(tx, `claim tokens; index ${index}`).to.be.fulfilled;
          let txBuild2 = tx.build();
          txBuild2.recentBlockhash = (await AnchorProvider.env().connection.getLatestBlockhash()).blockhash;
          let txSig2 = await AnchorProvider.env().send(txBuild2, tx.signers)
          console.log(`3 accounts hash: ${txSig2}`);

          const tokenAccountInfo = await getTokenAccount(
            solanaProvider,
            await getATAAddress({
              mint: distributorW.data.mint,
              owner: kp.publicKey,
            })
          );
          expect(tokenAccountInfo.amount.toString()).to.equal(
            amount.toString()
          );

          const claimStatus = await distributorW.getClaimStatus(new u64(index));
          expect(claimStatus.isClaimed).to.be.true;
          expect(claimStatus.claimant).to.eqAddress(kp.publicKey);
          expect(claimStatus.amount.toString()).to.equal(amount.toString());
        })
      );

      const expectedTotalClaimed = claimAmountOne
        .add(claimAmountTwo)
        .add(claimAmountThree);
      const tokenAccountInfo = await getTokenAccount(
        solanaProvider,
        distributorW.distributorATA
      );
      expect(tokenAccountInfo.amount.toString()).to.equal(
        MAX_TOTAL_CLAIM.sub(expectedTotalClaimed).toString()
      );

      await distributorW.reload();
      const { data } = distributorW;
      expect(data.numNodesClaimed.toNumber()).to.equal(allKps.length);
      expect(data.totalAmountClaimed.toString()).to.equal(
        expectedTotalClaimed.toString()
      );
    });

    // it("cannot allow two claims", async () => {
    //   const userKP = await createKeypairWithSOL(solanaProvider);

    //   const claimAmount = new u64(1_000_000);
    //   const tree = new BalanceTree([
    //     { account: userKP.publicKey, amount: claimAmount },
    //   ]);
    //   const { distributor } = await createAndSeedDistributor(
    //     merkleSdk,
    //     MAX_TOTAL_CLAIM,
    //     MAX_NUM_NODES,
    //     tree.getRoot()
    //   );
    //   const distributorW = await merkleSdk.loadDistributor(distributor);

    //   const claim1 = await distributorW.claim({
    //     index: new u64(0),
    //     amount: claimAmount,
    //     proof: tree.getProof(0, userKP.publicKey, claimAmount),
    //     claimant: userKP.publicKey,
    //   });
    //   // claim1.addSigners(userKP);
    //   // await expectTX(claim1, "claim tokens").to.be.fulfilled;
    //   let txBuild3 = claim1.build();
    //   txBuild3.recentBlockhash = (await AnchorProvider.env().connection.getLatestBlockhash()).blockhash;
    //   let txSig3 = await AnchorProvider.env().send(txBuild3, claim1.signers)
    //   console.log(`merkle distributor hash: ${txSig3}`)

    //   const claim2 = await distributorW.claim({
    //     index: new u64(0),
    //     amount: claimAmount,
    //     proof: tree.getProof(0, userKP.publicKey, claimAmount),
    //     claimant: userKP.publicKey,
    //   });
    //   claim2.addSigners(userKP);

    //   const [claimKey] = await findClaimStatusKey(new u64(0), distributorW.key);
    //   try {
    //     await claim2.confirm();
    //   } catch (e) {
    //     const err = (e as { errors: Error[] })
    //       .errors[0] as SendTransactionError;
    //     expect(err.logs?.join(" ")).to.have.string(
    //       `Allocate: account Address { address: ${claimKey.toString()}, base: None } already in use`
    //     );
    //   }
    // });

    // it("cannot claim more than proof", async () => {
    //   const userKP = await createKeypairWithSOL(solanaProvider);

    //   const claimAmount = new u64(1_000_000);
    //   const tree = new BalanceTree([
    //     { account: userKP.publicKey, amount: new u64(1_000_000) },
    //   ]);
    //   const { distributor } = await createAndSeedDistributor(
    //     merkleSdk,
    //     MAX_TOTAL_CLAIM,
    //     MAX_NUM_NODES,
    //     tree.getRoot()
    //   );
    //   const distributorW = await merkleSdk.loadDistributor(distributor);

    //   const tx = await distributorW.claim({
    //     index: new u64(0),
    //     amount: new u64(2_000_000),
    //     proof: tree.getProof(0, userKP.publicKey, claimAmount),
    //     claimant: userKP.publicKey,
    //   });
    //   tx.addSigners(userKP);

    //   try {
    //     await tx.confirm();
    //   } catch (e) {
    //     const err = (e as { errors: Error[] }).errors[0] as Error;
    //     expect(err.message).to.include(
    //       `0x${MerkleDistributorErrors.InvalidProof.code.toString(16)}`
    //     );
    //   }
    // });

    // it("cannot claim for address other than proof", async () => {
    //   const claimant = Keypair.generate().publicKey;
    //   const rogueKP = await createKeypairWithSOL(solanaProvider);

    //   const claimAmount = new u64(1_000_000);
    //   const tree = new BalanceTree([
    //     { account: claimant, amount: claimAmount },
    //   ]);
    //   const { distributor } = await createAndSeedDistributor(
    //     merkleSdk,
    //     MAX_TOTAL_CLAIM,
    //     MAX_NUM_NODES,
    //     tree.getRoot()
    //   );
    //   const distributorW = await merkleSdk.loadDistributor(distributor);

    //   const tx = await distributorW.claim({
    //     index: new u64(0),
    //     amount: new u64(2_000_000),
    //     proof: tree.getProof(0, claimant, claimAmount),
    //     claimant,
    //   });
    //   tx.addSigners(rogueKP);

    //   try {
    //     await tx.confirm();
    //   } catch (e) {
    //     const err = e as Error;
    //     expect(err.message).to.equal(
    //       `unknown signer: ${rogueKP.publicKey.toString()}`
    //     );
    //   }
    // });
  });
})