use anchor_lang::prelude::*;
use inco_lightning::{
    cpi::{allow, e_add, new_euint128, Allow, Operation},
    Euint128, IncoLightning,
};
use inco_token::{
    cpi::{self, accounts::IncoTransfer},
    IncoAccount,
};

use crate::state::Funding;

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut)]
    ///CHECK:Source confidential token account
    pub depositer_token_account: AccountInfo<'info>,
    ///CHECK:Vault confidential token account
    #[account(mut,seeds = [
        b"vault-ata-1",
        funding.key().as_ref(),
        mint.key().as_ref(),
    ],
    bump)]
    pub vault_account: AccountInfo<'info>,
    ///CHECK:Mint confidential account
    pub mint: AccountInfo<'info>,
    #[account(mut,seeds = [b"vault-1", funding.creator.as_ref()], bump)]
    pub funding: Account<'info, Funding>,
    /// CHECK: Inco Lightning program
    #[account(address = IncoLightning::id())]
    pub inco_lightning_program: Program<'info, IncoLightning>,
    /// CHECK: Inco Token program
    pub inco_token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}
pub fn deposit_vault<'info>(
    ctx: Context<'_, '_, '_, 'info, Deposit<'info>>,
    amount: Vec<u8>,
) -> Result<()> {
    let inco = ctx.accounts.inco_lightning_program.to_account_info();
    let signer = ctx.accounts.signer.to_account_info();

    // let transfer_ctx = CpiContext::new(
    //     ctx.accounts.inco_token_program.to_account_info(),
    //     TransferChecked {
    //         source: ctx.accounts.depositer_token_account.to_account_info(),
    //         mint: ctx.accounts.mint.to_account_info(),
    //         destination: ctx.accounts.vault_account.to_account_info(),
    //         authority: ctx.accounts.signer.to_account_info(),
    //         inco_lightning_program: ctx.accounts.inco_lightning_program.to_account_info(),
    //         system_program: ctx.accounts.system_program.to_account_info(),
    //     },
    // );
    // let mint_data = IncoMint::try_deserialize(&mut &ctx.accounts.mint.data.borrow()[..])?;
    // cpi::transfer_checked(transfer_ctx, amount.clone(), 0, mint_data.decimals)?;
    // 1. Transfer confidential tokens to the vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.inco_token_program.to_account_info(),
        IncoTransfer {
            source: ctx.accounts.depositer_token_account.to_account_info(),
            destination: ctx.accounts.vault_account.to_account_info(),
            authority: ctx.accounts.signer.to_account_info(),
            inco_lightning_program: ctx.accounts.inco_lightning_program.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
        },
    );
    cpi::transfer(transfer_ctx, amount.clone(), 0)?;
    // 2. Update encrypted total raised
    let cpi_ctx = CpiContext::new(
        ctx.accounts.inco_lightning_program.to_account_info(),
        Operation {
            signer: signer.to_account_info(),
        },
    );
    // Create encrypted handle from ciphertext
    let encrypted_amount: Euint128 = new_euint128(cpi_ctx, amount, 0)?;
    let cpi_ctx = CpiContext::new(
        inco.clone(),
        Operation {
            signer: signer.clone(),
        },
    );
    let new_balance = e_add(
        cpi_ctx,
        ctx.accounts.funding.enc_total_raised,
        encrypted_amount,
        0,
    )?;
    ctx.accounts.funding.enc_total_raised = new_balance;
    ctx.accounts.funding.contributor_count += 1;
    let source_account =
        IncoAccount::try_deserialize(&mut &ctx.accounts.depositer_token_account.data.borrow()[..])?;

    let new_source_handle = source_account.amount;
    if ctx.remaining_accounts.len() >= 2 {
        let allow_ctx = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            Allow {
                allowance_account: ctx.remaining_accounts[0].clone(),
                signer: ctx.accounts.signer.to_account_info(),
                allowed_address: ctx.remaining_accounts[1].clone(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        );
        allow(
            allow_ctx,
            new_source_handle.0, // encrypted handle
            true,                // allow read
            *ctx.accounts.signer.key,
        )?;
        let vault_account =
            IncoAccount::try_deserialize(&mut &ctx.accounts.vault_account.data.borrow()[..])?;

        let new_vault_handle = vault_account.amount;

        let allow_ctx = CpiContext::new(
            ctx.accounts.inco_lightning_program.to_account_info(),
            Allow {
                allowance_account: ctx.remaining_accounts[2].clone(),
                signer: ctx.accounts.signer.to_account_info(),
                allowed_address: ctx.remaining_accounts[3].clone(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        );
        allow(
            allow_ctx,
            new_vault_handle.0,             // encrypted handle
            true,                           // allow read
            *&ctx.accounts.funding.creator, // creator pubkey
        )?;

        //     let allow_ctx = CpiContext::new(
        //         ctx.accounts.inco_lightning_program.to_account_info(),
        //         Allow {
        //             allowance_account: ctx.remaining_accounts[4].clone(),
        //             signer: ctx.accounts.signer.to_account_info(),
        //             allowed_address: ctx.remaining_accounts[5].clone(),
        //             system_program: ctx.accounts.system_program.to_account_info(),
        //         },
        //     );
        //     allow(
        //         allow_ctx,
        //         new_balance.0,               // encrypted handle
        //         true,                        // allow read
        //         *&ctx.accounts.signer.key(), // creator pubkey
        //     )?;
    }

    Ok(())
}
