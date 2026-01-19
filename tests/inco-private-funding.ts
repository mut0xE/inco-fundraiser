import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { IncoPrivateFunding } from "../target/types/inco_private_funding";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import "dotenv/config";
import incoTokenIdl from "./idl/inco_token.json";
import fs from "fs";
import nacl from "tweetnacl";
import { encryptValue } from "@inco/solana-sdk/encryption";
import { decrypt } from "@inco/solana-sdk/attested-decrypt";
import { hexToBuffer } from "@inco/solana-sdk/utils";

const INCO_LIGHTNING_PROGRAM_ID = new PublicKey(
  "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
);
const INPUT_TYPE = 0;
const DECIMALS = 9;
const TOKEN_MULTIPLIER = BigInt(1_000_000_000);
/**
 * Derives the allowance PDA for a given handle and allowed address
 */

function getAllowancePda(
  handle: bigint,
  allowedAddress: PublicKey
): [PublicKey, number] {
  const handleBuffer = Buffer.alloc(16);
  let h = handle;
  for (let i = 0; i < 16; i++) {
    handleBuffer[i] = Number(h & BigInt(0xff));
    h = h >> BigInt(8);
  }
  return PublicKey.findProgramAddressSync(
    [handleBuffer, allowedAddress.toBuffer()],
    INCO_LIGHTNING_PROGRAM_ID
  );
}

function formatBalance(plaintext: string): string {
  return (Number(plaintext) / 1e9).toFixed(9);
}
/**
 * Extracts a bigint handle from various Anchor return formats
 */
function extractHandleFromAnchor(anchorHandle: any): bigint {
  if (anchorHandle && anchorHandle._bn) {
    return BigInt(anchorHandle._bn.toString(10));
  }
  if (typeof anchorHandle === "object" && anchorHandle["0"]) {
    const nested = anchorHandle["0"];
    if (nested && nested._bn) return BigInt(nested._bn.toString(10));
    if (nested && nested.toString && nested.constructor?.name === "BN") {
      return BigInt(nested.toString(10));
    }
  }
  if (anchorHandle instanceof Uint8Array || Array.isArray(anchorHandle)) {
    const buffer = Buffer.from(anchorHandle);
    let result = BigInt(0);
    for (let i = buffer.length - 1; i >= 0; i--) {
      result = result * BigInt(256) + BigInt(buffer[i]);
    }
    return result;
  }
  if (typeof anchorHandle === "number" || typeof anchorHandle === "bigint") {
    return BigInt(anchorHandle);
  }
  return BigInt(0);
}
/**
 * Derive funding PDA
 */
function getFundingPda(
  creator: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault-1"), creator.toBuffer()],
    programId
  );
}

/**
 * Derives the vault token account PDA
 */
function getVaultAtaPda(
  funding: PublicKey,
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault-ata-1"), funding.toBuffer(), mint.toBuffer()],
    programId
  );
}
describe("inco-private-funding", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace
    .incoPrivateFunding as Program<IncoPrivateFunding>;
  const incoTokenProgram = new anchor.Program(
    incoTokenIdl as anchor.Idl,
    provider
  );
  let admin: Keypair; // Admin/deployer wallet
  let creator: Keypair; // Campaign creator
  let user1: Keypair; // First contributor
  let user2: Keypair; // Second contributor
  let mint: Keypair; // Token mint

  // Token accounts
  let user1TokenAccount: Keypair;
  let user2TokenAccount: Keypair;

  // PDAs
  let fundingPda: PublicKey;
  let vaultTokenAccount: PublicKey;

  console.log("Program ID:", program.programId.toBase58());

  async function decryptHandle(
    handle: string
  ): Promise<{ success: boolean; plaintext?: string; error?: string }> {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const result = await decrypt([handle], {
        address: admin.publicKey,
        signMessage: async (message: Uint8Array) =>
          nacl.sign.detached(message, admin.secretKey),
      });
      return { success: true, plaintext: result.plaintexts[0] };
    } catch (error: any) {
      const msg = error.message || error.toString();
      if (msg.toLowerCase().includes("not allowed"))
        return { success: false, error: "not_allowed" };
      if (msg.toLowerCase().includes("ciphertext"))
        return { success: false, error: "ciphertext_not_found" };
      return { success: false, error: msg };
    }
  }
  async function decryptHandleWithSigner(handle: string, signer: Keypair) {
    try {
      const res = await decrypt([handle], {
        address: signer.publicKey,
        signMessage: async (msg: Uint8Array) =>
          nacl.sign.detached(msg, signer.secretKey),
      });

      return { success: true, plaintext: res.plaintexts[0] };
    } catch (e: any) {
      const msg = e.message.toLowerCase();
      if (msg.includes("not allowed"))
        return { success: false, error: "not_allowed" };
      if (msg.includes("ciphertext"))
        return { success: false, error: "ciphertext_not_found" };
      return { success: false, error: msg };
    }
  }

  /**
   * Simulates a transaction and extracts handles for both source and destination
   */
  async function simulateTransferAndGetHandles(
    tx: anchor.web3.Transaction,
    sourcePubkey: PublicKey,
    destPubkey: PublicKey
  ): Promise<{ userHandle: bigint | null; vaultHandle: bigint | null }> {
    try {
      const { blockhash } = await provider.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = admin.publicKey;
      tx.sign(admin);
      const simulation = await provider.connection.simulateTransaction(
        tx,
        undefined,
        [sourcePubkey, destPubkey]
      );
      if (simulation.value.err) {
        console.error("Simulation Error:", simulation.value.logs);
        return { userHandle: null, vaultHandle: null };
      }
      const extractHandle = (accountData: any): bigint | null => {
        if (!accountData?.data) return null;
        const data = Buffer.from(accountData.data[0], "base64");
        const amountBytes = data.slice(72, 88);
        let handle = BigInt(0);
        for (let i = 15; i >= 0; i--) {
          handle = handle * BigInt(256) + BigInt(amountBytes[i]);
        }
        return handle;
      };

      return {
        userHandle: extractHandle(simulation.value.accounts?.[0]),
        vaultHandle: extractHandle(simulation.value.accounts?.[1]),
      };
    } catch {
      return { userHandle: null, vaultHandle: null };
    }
  }
  /**
   * Simulates a transaction and extracts the handle from an account
   */
  async function simulateAndGetHandle(
    tx: anchor.web3.Transaction,
    accountPubkey: PublicKey
  ): Promise<bigint | null> {
    try {
      const { blockhash } = await provider.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = admin.publicKey;
      tx.sign(admin);
      // tx.verifySignatures(false);
      const simulation = await provider.connection.simulateTransaction(
        tx,
        undefined,
        [accountPubkey]
      );
      if (simulation.value.err) {
        console.error("Simulation Error:", simulation.value.logs);
        return null;
      }

      if (simulation.value.accounts?.[0]?.data) {
        const data = Buffer.from(
          simulation.value.accounts[0].data[0],
          "base64"
        );
        const amountBytes = data.slice(72, 88);
        let handle = BigInt(0);
        for (let i = 15; i >= 0; i--) {
          handle = handle * BigInt(256) + BigInt(amountBytes[i]);
        }
        return handle;
      }
      return null;
    } catch {
      return null;
    }
  }
  before("Generate test keypairs", async () => {
    admin = (provider.wallet as any).payer as Keypair;
    creator = Keypair.generate();
    user1 = Keypair.generate();

    user2 = Keypair.generate();
    mint = Keypair.generate();

    user1TokenAccount = Keypair.generate();

    user2TokenAccount = Keypair.generate();

    console.log("\n" + "=".repeat(80));
    console.log("TEST ACCOUNTS GENERATED");
    console.log("=".repeat(80));
    console.log("Admin (Deployer):     ", admin.publicKey.toBase58());
    console.log("Creator (Campaign):   ", creator.publicKey.toBase58());
    console.log("User 1 (Contributor): ", user1.publicKey.toBase58());
    console.log("User 2 (Contributor): ", user2.publicKey.toBase58());
    console.log("Mint:                 ", mint.publicKey.toBase58());
    console.log(
      "User1 Token Account:  ",
      user1TokenAccount.publicKey.toBase58()
    );
    console.log(
      "User2 Token Account:  ",
      user2TokenAccount.publicKey.toBase58()
    );
    console.log("=".repeat(80) + "\n");

    // Derive PDAs
    [fundingPda] = getFundingPda(creator.publicKey, program.programId);
    [vaultTokenAccount] = getVaultAtaPda(
      fundingPda,
      mint.publicKey,
      program.programId
    );

    console.log("DERIVED PDAs");
    console.log("=".repeat(80));
    console.log("Funding PDA:          ", fundingPda.toBase58());
    console.log("Vault Token Account:  ", vaultTokenAccount.toBase58());
    console.log("=".repeat(80) + "\n");
  });
  // TEST 1: Initialize Mint
  it("1.Should initialize mint", async () => {
    console.log("\n Initializing token mint with 9 decimals...");

    const tx = await incoTokenProgram.methods
      .initializeMint(DECIMALS, admin.publicKey, admin.publicKey)
      .accounts({
        mint: mint.publicKey,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .signers([mint])
      .rpc();
    console.log("Mint initialized:", tx);
    const mintAccount = await (incoTokenProgram.account as any).incoMint.fetch(
      mint.publicKey
    );
    expect(mintAccount.isInitialized).to.be.true;
    expect(mintAccount.decimals).to.equal(DECIMALS);
    console.log("   Decimals:", mintAccount.decimals);
  });
  // TEST 2: Initialize Token Accounts
  it("2.Should initialize token accounts", async () => {
    const accounts = [
      { keypair: user1TokenAccount, name: "User1", owner: admin },
      { keypair: user2TokenAccount, name: "User2", owner: admin },
    ];
    console.log("\nInitializing token accounts...");

    for (const { keypair, name, owner } of accounts) {
      const tx = await incoTokenProgram.methods
        .initializeAccount()
        .accounts({
          account: keypair.publicKey,
          mint: mint.publicKey,
          owner: owner.publicKey,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        } as any)
        .signers([keypair])
        .rpc();
      console.log(`${name} token account initialized:`, tx);
    }
  });
  // // TEST 3: Mint Tokens to Users
  it("3. Mint 100 Tokens to Each User", async () => {
    const mintAmount = BigInt(100) * TOKEN_MULTIPLIER;
    const encryptedHex = await encryptValue(mintAmount);
    const users = [
      { account: user1TokenAccount, name: "User1" },
      { account: user2TokenAccount, name: "User2" },
    ];
    console.log("\nMinting 100 tokens to each user...");
    for (const { account, name } of users) {
      // Simulate to get handle
      const txForSim = await incoTokenProgram.methods
        .mintTo(hexToBuffer(encryptedHex), INPUT_TYPE)
        .accounts({
          mint: mint.publicKey,
          account: account.publicKey,
          mintAuthority: admin.publicKey,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .transaction();

      const newHandle = await simulateAndGetHandle(txForSim, account.publicKey);
      const [allowancePda] = getAllowancePda(newHandle!, admin.publicKey);
      // Execute mint
      const tx = await incoTokenProgram.methods
        .mintTo(hexToBuffer(encryptedHex), INPUT_TYPE)
        .accounts({
          mint: mint.publicKey,
          account: account.publicKey,
          mintAuthority: admin.publicKey,
          incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .remainingAccounts([
          { pubkey: allowancePda, isSigner: false, isWritable: true },
          {
            pubkey: admin.publicKey,
            isSigner: false,
            isWritable: false,
          },
        ])
        .rpc();

      console.log(`Minted to ${name}:`, tx);
      await new Promise((r) => setTimeout(r, 1000));

      const accountData = await (
        incoTokenProgram.account as any
      ).incoAccount.fetch(account.publicKey);

      const handle = extractHandleFromAnchor(accountData.amount);

      const decrypted = await decryptHandle(handle.toString());

      console.log(
        `   ${name} balance:`,
        decrypted.success
          ? `${formatBalance(decrypted.plaintext!)} tokens`
          : decrypted.error
      );
    }
  });
  //TEST 4: Initialize Funding Campaign
  it("4. Initialize Funding Campaign Vault", async () => {
    console.log("\nInitializing funding campaign vault...");

    // Execute initialization
    const tx = await program.methods
      .initialize()
      .accounts({
        signer: creator.publicKey,
        funding: fundingPda,
        vaultAta: vaultTokenAccount,
        mint: mint.publicKey,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        incoTokenProgram: incoTokenProgram.programId,
      } as any)
      .signers([creator])
      .rpc();
    console.log("Vault initialized:", tx);

    // Fetch and verify funding account
    const fundingAccount = await program.account.funding.fetch(fundingPda);
    console.log("\nFUNDING CAMPAIGN STATE");
    console.log("=".repeat(80));
    console.log("Creator:              ", fundingAccount.creator.toBase58());
    console.log("Vault Token Account:  ", fundingAccount.vaultAta.toBase58());
    console.log("Mint:                 ", fundingAccount.mint.toBase58());
    console.log(
      "Contributor Count:    ",
      fundingAccount.contributorCount.toString()
    );
    console.log("Is Finalized:         ", fundingAccount.isFinalized);
    console.log(
      "Created At:           ",
      new Date(fundingAccount.createdAt.toNumber() * 1000).toISOString()
    );
    console.log("=".repeat(80));
    const vaultIncoAccount = await (
      incoTokenProgram.account as any
    ).incoAccount.fetch(vaultTokenAccount);

    console.log("Decoded Vault IncoAccount:", {
      mint: vaultIncoAccount.mint.toBase58(),
      owner: vaultIncoAccount.owner.toBase58(),
      state: vaultIncoAccount.state,
      amount: vaultIncoAccount.amount,
      delegatedAmount: vaultIncoAccount.delegatedAmount,
      closeAuthority: vaultIncoAccount.closeAuthority,
    });
    const handle = extractHandleFromAnchor(vaultIncoAccount.amount);
    const encryptedValue = await decryptHandle(handle.toString());
    console.log("encryptValue => ", encryptedValue.plaintext);

    // Assertions
    expect(fundingAccount.creator.toBase58()).to.equal(
      creator.publicKey.toBase58()
    );
    expect(fundingAccount.vaultAta.toBase58()).to.equal(
      vaultTokenAccount.toBase58()
    );
    expect(fundingAccount.mint.toBase58()).to.equal(mint.publicKey.toBase58());
    expect(fundingAccount.contributorCount.toNumber()).to.equal(0);
    expect(fundingAccount.isFinalized).to.be.false;

    console.log("\nAll assertions passed!");
  });
  // TEST 5: User1 Deposits Tokens
  it("5. User1 Deposits 10 Tokens to Campaign", async () => {
    const depositAmount = BigInt(10) * TOKEN_MULTIPLIER; // 10 tokens
    const encryptedAmount = await encryptValue(depositAmount);
    console.log("\nUser 1 depositing 10 tokens...");

    const txForSim = await program.methods
      .deposit(hexToBuffer(encryptedAmount))
      .accounts({
        signer: admin.publicKey,
        depositerTokenAccount: user1TokenAccount.publicKey,
        vaultAccount: vaultTokenAccount,
        mint: mint.publicKey,
        funding: fundingPda,
        incoTokenProgram: incoTokenProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .transaction();

    // const user1Handle = await simulateAndGetHandle(
    //   txForSim,
    //   user1TokenAccount.publicKey
    // );
    const { userHandle, vaultHandle } = await simulateTransferAndGetHandles(
      txForSim,
      user1TokenAccount.publicKey,
      vaultTokenAccount
    );
    const fundingHandle = await simulateAndGetHandle(txForSim, fundingPda);

    const [sourceAllowancePda] = getAllowancePda(userHandle!, admin.publicKey);
    const [destAllowancePda] = getAllowancePda(vaultHandle!, admin.publicKey);
    // const [fundingAllowancePda] = getAllowancePda(
    //   fundingHandle!,
    //   admin.publicKey
    // );
    console.log("sourceAllowancePda", sourceAllowancePda);
    console.log("destAllowancePda", destAllowancePda);
    // console.log("fundingAllowancePda", fundingAllowancePda);

    const tx = await program.methods
      .deposit(hexToBuffer(encryptedAmount))
      .accounts({
        signer: admin.publicKey,
        depositerTokenAccount: user1TokenAccount.publicKey,
        vaultAccount: vaultTokenAccount,
        mint: mint.publicKey,
        funding: fundingPda,
        incoTokenProgram: incoTokenProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        { pubkey: sourceAllowancePda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: false, isWritable: false },
        { pubkey: destAllowancePda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: false, isWritable: false },
        // { pubkey: fundingAllowancePda, isSigner: false, isWritable: true },
        // { pubkey: admin.publicKey, isSigner: false, isWritable: false },
      ])
      .rpc();
    console.log("Deposit successful:", tx);
    await new Promise((r) => setTimeout(r, 1000));

    const user1Account = await (
      incoTokenProgram.account as any
    ).incoAccount.fetch(user1TokenAccount.publicKey);

    // console.log("user1", user1Account);

    const vaultAccount = await (
      incoTokenProgram.account as any
    ).incoAccount.fetch(vaultTokenAccount);

    // console.log("vaultAccount", vaultAccount);

    // const fundingAccount = await (program.account as any).Account.fetch(
    //   fundingPda
    // );

    const userResult = await decryptHandle(
      extractHandleFromAnchor(user1Account.amount).toString()
    );
    const vaultHandleOnChain = extractHandleFromAnchor(
      vaultAccount.amount
    ).toString();

    // const fundingHandleOnChain = extractHandleFromAnchor(
    //   fundingAccount.encTotalRaised
    // ).toString();

    const vaultResult = await decryptHandleWithSigner(
      vaultHandleOnChain,
      admin
    );
    // const fundingResult = await decryptHandleWithSigner(
    //   fundingHandleOnChain,
    //   admin
    // );
    console.log("\nPOST-DEPOSIT BALANCES");
    console.log("=".repeat(80));
    console.log(
      "User 1 balance:        ",
      userResult.success
        ? `${formatBalance(userResult.plaintext!)} tokens`
        : userResult.error
    );
    console.log(
      "Vault balance:        ",
      vaultResult.success
        ? `${formatBalance(vaultResult.plaintext!)} tokens`
        : vaultResult.error
    );
    // console.log(
    //   "Funding total raised:        ",
    //   fundingResult.success
    //     ? `${formatBalance(vaultResult.plaintext!)} tokens`
    //     : vaultResult.error
    // );
    console.log("=".repeat(80));
  });
  it("Should transfer 100 tokens", async () => {
    const transferAmount = BigInt(100) * TOKEN_MULTIPLIER;
    const encryptedHex = await encryptValue(transferAmount);

    const txForSim = await incoTokenProgram.methods
      .transfer(hexToBuffer(encryptedHex), INPUT_TYPE)
      .accounts({
        source: user1TokenAccount.publicKey,
        destination: vaultTokenAccount,
        authority: admin.publicKey,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .transaction();

    const { userHandle, vaultHandle } = await simulateTransferAndGetHandles(
      txForSim,
      user1TokenAccount.publicKey,
      vaultTokenAccount
    );

    const [sourceAllowancePda] = getAllowancePda(userHandle!, admin.publicKey);
    const [destAllowancePda] = getAllowancePda(vaultHandle!, admin.publicKey);

    const tx = await incoTokenProgram.methods
      .transfer(hexToBuffer(encryptedHex), INPUT_TYPE)
      .accounts({
        source: user1TokenAccount.publicKey,
        destination: vaultTokenAccount,
        authority: admin.publicKey,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        { pubkey: sourceAllowancePda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: false, isWritable: false },
        { pubkey: destAllowancePda, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: false, isWritable: false },
      ])
      .rpc();

    console.log("Transfer tx:", tx);
    await new Promise((r) => setTimeout(r, 5000));

    const sourceAccount = await (
      incoTokenProgram.account as any
    ).incoAccount.fetch(user1TokenAccount.publicKey);
    console.log("user1", sourceAccount);

    const destAccount = await (
      incoTokenProgram.account as any
    ).incoAccount.fetch(vaultTokenAccount);

    console.log("user2", destAccount);

    const sourceResult = await decryptHandle(
      extractHandleFromAnchor(sourceAccount.amount).toString()
    );
    const destResult = await decryptHandle(
      extractHandleFromAnchor(destAccount.amount).toString()
    );

    console.log(
      "Source balance:",
      sourceResult.success
        ? `${formatBalance(sourceResult.plaintext!)} tokens`
        : sourceResult.error
    );
    console.log(
      "Dest balance:",
      destResult.success
        ? `${formatBalance(destResult.plaintext!)} tokens`
        : destResult.error
    );
  });
});
